import type {
  Milestone,
  ProductLine,
  MaterialItem,
  MilestoneStatus,
  DelayCategory,
  RectificationAction,
  CategoryTemplate,
  ProductMasterItem,
  DesignType
} from '../types';

// ---------------------------------------------------------------------------
// Date primitives — the single source of truth for every date in the system.
// All dates are handled as strict YYYY-MM-DD calendar strings so that string
// comparison, sorting and arithmetic all agree with the visible calendar day.
// ---------------------------------------------------------------------------

export function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function formatDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns the LOCAL calendar date (YYYY-MM-DD).
 * Using UTC-based "today" (toISOString) shifts the app's calendar day for
 * any timezone ahead of/behind UTC, so every "today" in the app must use this.
 */
export function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Validates a strict YYYY-MM-DD calendar date string.
 * The round-trip check rejects impossible days (2026-02-31) that `Date` would
 * otherwise silently roll over into a *different* day.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parsed = parseDate(dateStr);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatDate(parsed) === dateStr;
}

/** Clamps a date string so it never exceeds maxStr (safe for ISO YYYY-MM-DD). */
export function clampDateMax(dateStr: string, maxStr: string): string {
  if (!dateStr) return dateStr;
  return dateStr > maxStr ? maxStr : dateStr;
}

/** Clamps a date string so it never falls below minStr (safe for ISO YYYY-MM-DD). */
export function clampDateMin(dateStr: string, minStr: string): string {
  if (!dateStr) return dateStr;
  return dateStr < minStr ? minStr : dateStr;
}

/** Keeps a date inside [minStr, maxStr]. Returns undefined if the range is empty. */
export function clampDateRange(dateStr: string, minStr: string, maxStr: string): string | undefined {
  if (!dateStr) return undefined;
  if (minStr > maxStr) return undefined;
  return clampDateMax(clampDateMin(dateStr, minStr), maxStr);
}

export function addDays(dateStr: string, days: number): string {
  if (!isValidDateString(dateStr) || !Number.isFinite(days)) return dateStr;
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return formatDate(d);
}

export function getDaysDifference(startStr: string, endStr: string): number {
  if (!isValidDateString(startStr) || !isValidDateString(endStr)) return 0;
  const s = parseDate(startStr);
  const e = parseDate(endStr);
  const diffTime = e.getTime() - s.getTime();
  return Math.round(diffTime / (1000 * 3600 * 24));
}

/** Latest of a set of optional dates (undefined-safe; never returns ""). */
export function latestDate(...dates: (string | undefined)[]): string | undefined {
  return dates.filter((d): d is string => Boolean(d)).sort().slice(-1)[0];
}

/** Earliest of a set of optional dates (undefined-safe; never returns ""). */
export function earliestDate(...dates: (string | undefined)[]): string | undefined {
  return dates.filter((d): d is string => Boolean(d)).sort()[0];
}

// ---------------------------------------------------------------------------
// Milestone chain helpers
// ---------------------------------------------------------------------------

/** Authoritative end of a milestone: real event first, then forecast, then plan. */
export function milestoneEffectiveEnd(ms?: Milestone | null): string | undefined {
  if (!ms) return undefined;
  return ms.actualEndDate || ms.forecastEndDate || ms.committedBaselineEndDate || undefined;
}

/**
 * The earliest date a milestone may be started on (its "chain anchor").
 *
 * Only a REAL event — the previous milestone's actual end — is a hard floor. A
 * forecast/planned end that has already passed is also enforceable. A planned
 * end still in the future must NEVER be used as a floor: doing so leaves the
 * picker with no selectable date and makes the stage impossible to record.
 */
export function chainAnchorDate(milestones: Milestone[], index: number, _todayStr?: string): string | undefined {
  if (index <= 0) return undefined;
  const prev = milestones[index - 1];
  if (!prev) return undefined;
  if (prev.actualEndDate) return prev.actualEndDate;
  return undefined;
}

export interface EventDateValidation {
  ok: boolean;
  error?: string;
}

/**
 * The one validator every milestone start/complete entry point uses (modals and
 * context alike), so the error a user sees is exactly the rule that is enforced.
 */
export function validateEventDate(params: {
  milestones: Milestone[];
  index: number;
  eventType: 'start' | 'complete';
  eventDate: string;
  todayStr: string;
}): EventDateValidation {
  const { milestones, index, eventType, eventDate, todayStr } = params;
  const ms = milestones[index];
  if (!ms) return { ok: false, error: 'Milestone not found.' };

  if (!isValidDateString(eventDate)) {
    return { ok: false, error: `Invalid date "${eventDate}". Expected a real calendar date (YYYY-MM-DD).` };
  }

  if (index > 0) {
    const prev = milestones[index - 1];
    const isPrevComplete = prev.status === 'Completed' || Boolean(prev.actualEndDate) || prev.completionPct === 100;
    if (!isPrevComplete) {
      return { ok: false, error: `Dependency Error: Cannot start or complete until the previous milestone (${prev.name}) is Completed.` };
    }
  }

  const anchor = chainAnchorDate(milestones, index, todayStr);

  if (eventType === 'start') {
    if (anchor && eventDate < anchor) {
      return {
        ok: false,
        error: `Date Sync Error: Start date (${eventDate}) cannot be earlier than the previous milestone's actual end date (${anchor}).`
      };
    }
    return { ok: true };
  }

  const startFloor = ms.actualStartDate || anchor;
  if (startFloor && eventDate < startFloor) {
    return {
      ok: false,
      error: `Date Sync Error: Completion date (${eventDate}) cannot be earlier than the milestone start date (${startFloor}).`
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Line-level normalization — every line mutation funnels through here so that
// no code path can persist an impossible date combination.
// ---------------------------------------------------------------------------

/**
 * Heals a line's STORED dates so the persisted state always satisfies:
 *   - actual events are never in the future
 *   - a milestone never ends before it starts
 *   - a milestone never starts before the previous milestone really ended
 *   - an "end without a start" is re-anchored instead of stored half-recorded
 * Forecast dates, variance and status are always derived afterwards by
 * `recalculateProductLine`, so they are never trusted from storage.
 */
export function normalizeLineDates(line: ProductLine, todayStr: string): ProductLine {
  if (!line.milestones || line.milestones.length === 0) return line;

  const normalized: Milestone[] = [];

  for (let i = 0; i < line.milestones.length; i++) {
    const ms: Milestone = { ...line.milestones[i] };

    let start = ms.actualStartDate;
    let end = ms.actualEndDate;

    if (start && !isValidDateString(start)) start = undefined;
    if (end && !isValidDateString(end)) end = undefined;

    if (end && !start) {
      const anchor = chainAnchorDate(normalized, i, todayStr);
      const fallback = anchor && anchor <= end ? anchor : ms.committedBaselineStartDate;
      start = fallback && fallback <= end ? fallback : end;
    }

    if (start) {
      const anchor = chainAnchorDate(normalized, i, todayStr);
      if (anchor && start < anchor) start = anchor;
    }

    if (start && end && end < start) end = start;
    if (!start && end) end = undefined;

    ms.actualStartDate = start;
    ms.actualEndDate = end;
    normalized.push(ms);
  }

  return { ...line, milestones: normalized };
}

/**
 * Heals a material's STORED dates: an order/receipt is always in the past and a
 * receipt can never precede its order. When an invalid receipt is dropped, the
 * inspection outcome that depended on it is dropped too — otherwise the module
 * shows a "Passed" GRN for a material that was never received.
 */
export function normalizeMaterialDates(materials: MaterialItem[], _todayStr: string): MaterialItem[] {
  return materials.map(material => {
    const ms: MaterialItem = { ...material };

    if (ms.orderedDate && !isValidDateString(ms.orderedDate)) {
      ms.orderedDate = undefined;
    }

    let received = ms.receivedDate;
    if (received && !isValidDateString(received)) {
      received = undefined;
    }
    if (received && ms.orderedDate && received < ms.orderedDate) {
      // If received date is earlier than order date, set order date to received date
      ms.orderedDate = received;
    }
    // A receipt with no order is kept and order date defaulted to received
    if (received && !ms.orderedDate) {
      ms.orderedDate = received;
    }

    if (ms.receivedDate !== received) {
      ms.receivedDate = received;
      if (!received) {
        ms.grnNumber = undefined;
        ms.inspectionResult = undefined;
        ms.inspectionNotes = undefined;
      }
    }

    if (ms.expectedDate) {
      if (!isValidDateString(ms.expectedDate)) {
        ms.expectedDate = undefined;
      } else {
        const lead = Number.isFinite(ms.leadTimeDays) && ms.leadTimeDays >= 0 ? ms.leadTimeDays : 0;
        const floor = ms.orderedDate ? addDays(ms.orderedDate, lead) : undefined;
        if (floor && ms.expectedDate < floor) ms.expectedDate = floor;
      }
    }

    return ms;
  });
}

// ---------------------------------------------------------------------------
// Dependency rules
// ---------------------------------------------------------------------------

/**
 * Checks if production can start based on dependency rules:
 * Rule 1: Design & BOM must be approved (Milestone 4 BOM Release completed).
 * Rule 2: All critical path materials must be received and GRN inspection passed.
 */
export function canProductionStart(productLine: ProductLine): { allowed: boolean; reason?: string } {
  const designMs = productLine.milestones.find(m => m.key === 'bom_release' || m.key === 'design_approval');
  const isDesignDone = !designMs || designMs.status === 'Completed' || Boolean(designMs.actualEndDate) || designMs.completionPct === 100;
  if (designMs && !isDesignDone) {
    return {
      allowed: false,
      reason: `Design & BOM stage '${designMs.name}' is not yet completed/approved (BOM release approval required).`
    };
  }

  const pendingCriticalMaterials = productLine.materials.filter(
    m => m.isCriticalPath && m.inspectionResult !== 'Passed'
  );

  if (pendingCriticalMaterials.length > 0) {
    const names = pendingCriticalMaterials.map(m => `${m.itemCode} (${m.supplierName})`).join(', ');
    return {
      allowed: false,
      reason: `Critical material incoming inspection pending for: ${names}. All critical path materials must have Passed GRN inspection.`
    };
  }

  return { allowed: true };
}

/**
 * Checks if procurement can start based on dependency rules:
 * - New design: procurement starts ONLY after design & BOM approval.
 */
export function canProcurementStart(productLine: ProductLine): { allowed: boolean; reason?: string } {

  if (productLine.designType === 'New Design') {
    const designMs = productLine.milestones.find(m => m.key === 'bom_release' || m.key === 'design_approval');
    if (designMs && designMs.status !== 'Completed') {
      return {
        allowed: false,
        reason: `For New Design product lines, procurement starts ONLY after Design & BOM approval (Stage 4 BOM Release).`
      };
    }
  }

  return { allowed: true };
}

/**
 * Identifies the critical path item among materials (longest lead time).
 */
export function updateMaterialCriticalPath(materials: MaterialItem[]): MaterialItem[] {
  if (materials.length === 0) return materials;

  let maxLead = -1;
  materials.forEach(m => {
    if (m.leadTimeDays > maxLead) maxLead = m.leadTimeDays;
  });

  return materials.map(m => ({
    ...m,
    isCriticalPath: m.leadTimeDays === maxLead
  }));
}

// ---------------------------------------------------------------------------
// Schedule generation — used by BOTH the order-intake preview and the actual PO
// creation, so the date a user is shown is always the date that gets saved.
// ---------------------------------------------------------------------------

/** Resolves the material list for a product line, falling back to catalog defaults. */
export function resolveLineMaterials(params: {
  providedMaterials?: MaterialItem[];
  catalogItem?: ProductMasterItem;
  qty: number;
  lineId: string;
}): MaterialItem[] {
  const { providedMaterials, catalogItem, qty, lineId } = params;
  if (providedMaterials && providedMaterials.length > 0) return providedMaterials;
  return (catalogItem?.defaultMaterials || []).map((m, idx) => ({
    id: `mat-${lineId}-${idx + 1}`,
    itemCode: m.itemCode,
    description: m.description,
    qty: qty || 1,
    unit: 'Pcs',
    supplierName: m.supplierName,
    leadTimeDays: m.leadTimeDays,
    isCriticalPath: m.isCriticalPath,
    inspectionResult: 'Pending' as const
  }));
}

/**
 * Builds a committed baseline milestone chain from a category template.
 * `raw_material` takes the longest material lead time when one is defined, so
 * the plan reflects real procurement instead of the template's nominal value.
 */
export function buildTemplateSchedule(params: {
  template?: CategoryTemplate;
  designType: DesignType;
  materials: MaterialItem[];
  startDate: string;
  lineId: string;
}): Milestone[] {
  const { template, materials, startDate, lineId } = params;

  const rawMaterialLeadTime = materials.length > 0
    ? Math.max(...materials.map(m => m.leadTimeDays))
    : 14;

  let durations = (template?.milestoneDurations || []).filter(m => Boolean(m.milestoneKey));
  
  // If template is empty or uses legacy keys, fallback to standard 14 aligned stages
  if (durations.length === 0 || !durations.some(m => m.milestoneKey === 'po_from_customer')) {
    durations = [
      { milestoneKey: 'po_from_customer', milestoneName: '1. Customer Purchase Order (PO)', durationDays: 1 },
      { milestoneKey: 'pm_baseline', milestoneName: '2. Baseline Review & Planning', durationDays: 3 },
      { milestoneKey: 'corb_release', milestoneName: '3. CORB Release', durationDays: 2 },
      { milestoneKey: 'bom_release', milestoneName: '4. BOM Release', durationDays: 4 },
      { milestoneKey: 'wo_release', milestoneName: '5. Work Order Release', durationDays: 2 },
      { milestoneKey: 'sub_supplier_po', milestoneName: '6. Sub-Supplier PO', durationDays: 3 },
      { milestoneKey: 'material_receipt', milestoneName: '7. Material Receipt (GRN)', durationDays: 14 },
      { milestoneKey: 'machining', milestoneName: '8. Machining', durationDays: 14 },
      { milestoneKey: 'assembly', milestoneName: '9. Assembly', durationDays: 5 },
      { milestoneKey: 'fg', milestoneName: '10. FG', durationDays: 2 },
      { milestoneKey: 'customer_inspection', milestoneName: '11. Customer Inspection', durationDays: 2 },
      { milestoneKey: 'painting', milestoneName: '12. Painting', durationDays: 2 },
      { milestoneKey: 'trn', milestoneName: '13. TRN', durationDays: 1 },
      { milestoneKey: 'shipment', milestoneName: '14. Final Shipment & Dispatch', durationDays: 5 },
    ];
  }

  let runningDate = startDate;

  return durations.map((m, idx) => {
    const duration = Math.max(
      1,
      (m.milestoneKey === 'material_receipt' || m.milestoneKey === 'raw_material') && rawMaterialLeadTime > 0 ? rawMaterialLeadTime : m.durationDays
    );
    const msStart = runningDate;
    const msEnd = addDays(msStart, duration);
    runningDate = msEnd;

    return {
      id: `ms-${lineId}-${idx + 1}`,
      key: m.milestoneKey,
      name: m.milestoneName,
      stageOrder: idx + 1,
      defaultDurationDays: duration,
      committedBaselineStartDate: msStart,
      committedBaselineEndDate: msEnd,
      committedDurationDays: duration,
      forecastStartDate: msStart,
      forecastEndDate: msEnd,
      varianceDays: 0,
      status: 'Not Started' as MilestoneStatus,
      completionPct: 0
    };
  });
}

/** Last committed date across every line — the order's delivery date. */
export function getOrderDeliveryDate(productLines: ProductLine[], fallbackStart: string): string {
  const ends = productLines
    .map(line => line.milestones[line.milestones.length - 1]?.committedBaselineEndDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  return ends[ends.length - 1] || addDays(fallbackStart, 60);
}

// ---------------------------------------------------------------------------
// Core recalculation
// ---------------------------------------------------------------------------

/**
 * Recalculates milestone forecast dates, variances, and status rollups for a
 * Product Line. This is the ONLY place derived date state is produced: it
 * normalizes stored dates first so an impossible combination can never survive
 * a save, whatever endpoint triggered it.
 */
export function recalculateProductLine(
  productLine: ProductLine,
  todayStr: string,
  atRiskThreshold: number = 3,
  delayedThreshold: number = 7
): ProductLine {
  const healedLine = normalizeLineDates(
    { ...productLine, materials: normalizeMaterialDates(productLine.materials, todayStr) },
    todayStr
  );

  const milestones = healedLine.milestones;
  if (milestones.length === 0) {
    return { ...healedLine, overallVarianceDays: 0, status: 'Not Started' };
  }

  let currentForecastStart = milestones[0].committedBaselineStartDate || todayStr;

  // The longest outstanding or actual received material arrival drives material receipt.
  let maxMaterialArrivalDate = currentForecastStart;
  healedLine.materials.forEach(mat => {
    const arrival = mat.receivedDate || (mat.expectedDate ? clampDateMin(mat.expectedDate, todayStr) : undefined);
    if (arrival && arrival > maxMaterialArrivalDate) {
      maxMaterialArrivalDate = arrival;
    }
  });

  const updatedMilestones: Milestone[] = [];

  for (let msIndex = 0; msIndex < milestones.length; msIndex++) {
    const ms = milestones[msIndex];
    let forecastStart = ms.committedBaselineStartDate || currentForecastStart;

    if (msIndex > 0) {
      const prevMs = updatedMilestones[msIndex - 1];
      const prevEnd = milestoneEffectiveEnd(prevMs);
      if (prevEnd && prevEnd > forecastStart) {
        forecastStart = prevEnd;
      }
    }

    if (ms.key === 'material_receipt' || ms.key === 'raw_material') {
      if (maxMaterialArrivalDate > forecastStart) {
        forecastStart = maxMaterialArrivalDate;
      }
    }

    if (ms.actualStartDate) {
      const prevEnd = msIndex > 0 ? milestoneEffectiveEnd(updatedMilestones[msIndex - 1]) : undefined;
      forecastStart = prevEnd && ms.actualStartDate < prevEnd ? prevEnd : ms.actualStartDate;
    }

    // A milestone always occupies at least one day, so its start can never equal
    // (or overtake) its own end.
    const duration = Math.max(1, ms.committedDurationDays || 1);
    const startDelay = (ms.committedBaselineStartDate && forecastStart > ms.committedBaselineStartDate)
      ? getDaysDifference(ms.committedBaselineStartDate, forecastStart)
      : 0;
    const forecastEnd = ms.actualEndDate || (
      startDelay > 0 && ms.committedBaselineEndDate
        ? addDays(ms.committedBaselineEndDate, startDelay)
        : (ms.committedBaselineEndDate || addDays(forecastStart, duration))
    );

    const effEnd = ms.actualEndDate || forecastEnd;
    const varianceDays = effEnd > ms.committedBaselineEndDate 
      ? Math.max(1, getDaysDifference(ms.committedBaselineEndDate, effEnd))
      : getDaysDifference(ms.committedBaselineEndDate, effEnd);

    let status: MilestoneStatus = ms.status;
    let delayCategory = ms.delayCategory;
    let delayReason = ms.delayReason && !ms.delayReason.startsWith('Inherited delay') && !ms.delayReason.startsWith('Cascaded delay')
      ? ms.delayReason
      : undefined;
    let delayOwner = ms.delayOwner;

    const delayedSub = ms.subdivisions?.find(s => s.status === 'Delayed');
    const hasInPrepSub = ms.subdivisions?.some(s => s.status === 'In Progress');
    const allSubsDone = ms.subdivisions && ms.subdivisions.length > 0 && ms.subdivisions.every(s => s.status === 'Done');

    if (delayedSub) {
      status = 'Delayed';
      if (delayedSub.delayCause) delayCategory = delayedSub.delayCause;
      if (delayedSub.delayNote) delayReason = delayedSub.delayNote;
      if (delayedSub.ownerLabel || delayedSub.ownerSlot) delayOwner = delayedSub.ownerLabel || delayedSub.ownerSlot;
    } else if (ms.actualEndDate) {
      status = 'Completed';
    } else if (ms.actualStartDate || hasInPrepSub) {
      // Actively started milestones are in progress/execution; delays are tracked in varianceDays / delayReason
      if (varianceDays > atRiskThreshold && varianceDays <= delayedThreshold) {
        status = 'At Risk';
      } else if (varianceDays > delayedThreshold) {
        status = 'Delayed';
      } else {
        status = 'In Progress';
      }
    } else if (varianceDays > delayedThreshold) {
      status = 'Delayed';
    } else if (varianceDays > atRiskThreshold) {
      status = 'At Risk';
    } else {
      if (allSubsDone) {
        status = 'In Progress';
      } else {
        status = 'Not Started';
      }
    }

    currentForecastStart = forecastEnd;

    updatedMilestones.push({
      ...ms,
      forecastStartDate: forecastStart,
      forecastEndDate: forecastEnd,
      varianceDays,
      status,
      delayCategory,
      delayReason,
      delayOwner
    });
  }

  // The overall line variance is governed by the final milestone delivery variance
  // If an upcoming milestone finishes early and recovers the schedule, final variance will correctly reflect the net delay or 0
  const finalMilestone = updatedMilestones[updatedMilestones.length - 1];
  const finalVariance = finalMilestone ? finalMilestone.varianceDays : 0;
  const overallVarianceDays = Math.max(0, finalVariance);

  let lineStatus: MilestoneStatus = 'Not Started';
  const allCompleted = updatedMilestones.length > 0 && updatedMilestones.every(m => m.status === 'Completed');
  const hasActiveDelayed = updatedMilestones.some(m => !m.actualEndDate && m.status === 'Delayed');
  const hasActiveAtRisk = updatedMilestones.some(m => !m.actualEndDate && m.status === 'At Risk');

  if (allCompleted) {
    lineStatus = 'Completed';
  } else if (hasActiveDelayed || overallVarianceDays > 0) {
    lineStatus = 'Delayed';
  } else if (hasActiveAtRisk) {
    lineStatus = 'At Risk';
  } else if (updatedMilestones.some(m => m.status === 'In Progress' || m.status === 'Completed' || Boolean(m.actualStartDate))) {
    lineStatus = 'On Track';
  }

  return {
    ...healedLine,
    milestones: updatedMilestones,
    overallVarianceDays,
    status: lineStatus
  };
}

// ---------------------------------------------------------------------------
// Corrective action proposals
// ---------------------------------------------------------------------------

/**
 * Generates rule-based corrective action proposals for delayed or at-risk milestones.
 */
export function generateSuggestedRectifications(
  poNumber: string,
  line: ProductLine,
  ms: Milestone,
  _category: DelayCategory
): RectificationAction[] {
  const actions: RectificationAction[] = [];
  const now = new Date().toISOString();
  // Unique-per-action id suffix: two rules can fire in the same millisecond.
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (ms.key === 'raw_material' || ms.key === 'material_receipt' || ms.key === 'sub_supplier_po' || ms.key === 'incoming_inspection') {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Expedite',
      title: 'Air freight express dispatch for critical long-lead material',
      description: 'Authorize express air freight shipment directly from tier-1 casting foundry to save transit lead time.',
      impactDaysSaved: Math.min(ms.varianceDays, 5),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Purchase Manager',
      status: 'Proposed'
    });
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Alternate Supplier',
      title: 'Engage secondary pre-approved foundry for urgent billet supply',
      description: 'Switch remaining 30% valve body forgings to secondary audited supplier (Sandvik Materials).',
      impactDaysSaved: Math.min(ms.varianceDays, 8),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Procurement Head',
      status: 'Proposed'
    });
  } else if (ms.key === 'design_approval' || ms.key === 'bom_release' || ms.key === 'corb_release' || ms.key === 'pm_baseline') {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Parallel Review',
      title: 'Initiate concurrent preliminary BOM release to procurement',
      description: 'Release long-lead raw material specifications to purchase team before final 3D CAD sign-off.',
      impactDaysSaved: Math.min(ms.varianceDays, 6),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Lead Design Engineer',
      status: 'Proposed'
    });
  } else if (ms.key === 'production' || ms.key === 'machining' || ms.key === 'assembly' || ms.key === 'fg' || ms.key === 'painting' || ms.key === 'qc_pass') {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Added Shift',
      title: 'Authorize 2nd shift machining & weekend Hydro-testing',
      description: 'Schedule additional overtime shift on 5-axis CNC cell to recover machining schedule.',
      impactDaysSaved: Math.min(ms.varianceDays, 4),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Production Superintendent',
      status: 'Proposed'
    });
  } else {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Formal Baseline Change Note',
      title: 'Issue formal Baseline Revision request to customer',
      description: `Submit contract revision for '${ms.name}' with formal delay justification for customer approval.`,
      impactDaysSaved: 0,
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Sales Account Director',
      status: 'Proposed'
    });
  }

  return actions;
}

/**
 * Idempotently merges user notes with an inherited delay summary without stacking duplicate text.
 */
export function mergeDelayReason(existingReason: string = '', inheritedSummary: string = ''): string {
  if (!inheritedSummary) return existingReason;
  const cleanExisting = (existingReason || '')
    .split(/\s*\|\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('Inherited delay') && !s.startsWith('Delay cascaded from'));

  if (cleanExisting.length > 0) {
    return `${cleanExisting.join(' | ')} | ${inheritedSummary}`;
  }
  return inheritedSummary;
}
