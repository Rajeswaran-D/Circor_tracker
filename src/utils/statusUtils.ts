import type { PurchaseOrder, MilestoneStatus } from '../types';

export interface POStatusSummary {
  currentStageKey: string;
  currentStageName: string;
  statusTag: MilestoneStatus;
  progressPercent: number;
  completedStagesCount: number;
  totalStagesCount: number;
  isDelayed: boolean;
  delayDays: number;
  delayedStageName?: string;
  delayReason?: string;
  activeMilestone?: any;
  productLineName: string;
  designType: string;
  timelineValidationStatus: 'VALIDATED_OK' | 'REQUIRES_REVISION_DELAYED' | 'CLOSED';
  timelineMessage: string;
  lastRevNum: number;
}

export function getPOManufacturingStatus(po: PurchaseOrder): POStatusSummary {
  if (!po.productLines || po.productLines.length === 0) {
    return {
      currentStageKey: 'po_from_customer',
      currentStageName: '1. Customer PO Review & Intake',
      statusTag: 'In Progress',
      progressPercent: 0,
      completedStagesCount: 0,
      totalStagesCount: 11,
      isDelayed: false,
      delayDays: 0,
      productLineName: 'Manufacturing Line',
      designType: 'Existing Design',
      timelineValidationStatus: 'VALIDATED_OK',
      timelineMessage: 'Timeline Validated — Standard Schedule',
      lastRevNum: 0
    };
  }

  const lineEntries = po.productLines.flatMap(line =>
    (line.milestones || []).map(milestone => ({ line, milestone }))
  );
  const firstLine = po.productLines[0];
  const firstLineMilestones = firstLine?.milestones || [];
  const totalStagesCount = 14;
  const completedStagesCount = firstLineMilestones.filter(m => m.status === 'Completed').length;
  const progressPercent = Math.round((completedStagesCount / 14) * 100);

  const allCompleted = completedStagesCount >= 14;
  const isOrderFinished = po.isClosed || po.status === 'Completed' || allCompleted;

  // Find the earliest active milestone across every product line.
  const activeEntry = lineEntries
    .filter(({ milestone }) => milestone.status !== 'Completed' && !milestone.actualEndDate)
    .sort((a, b) => a.milestone.stageOrder - b.milestone.stageOrder)[0]
    || lineEntries.sort((a, b) => b.milestone.stageOrder - a.milestone.stageOrder)[0];
  const line = activeEntry?.line || firstLine;
  const milestones = line?.milestones || [];
  const activeMilestone = activeEntry?.milestone || milestones[milestones.length - 1];

  // Highest net forecasted delay across all product lines in the PO
  const maxPOVariance = Math.max(...po.productLines.map(l => l.overallVarianceDays || 0), 0);

  // Active delayed entries on currently executing or un-recovered stages
  const activeDelayedEntries = lineEntries
    .filter(({ milestone }) => 
      !milestone.actualEndDate && 
      (milestone.status === 'Delayed' || (typeof milestone.varianceDays === 'number' && milestone.varianceDays > 0))
    )
    .sort((a, b) => a.milestone.stageOrder - b.milestone.stageOrder);

  // Historical delayed entries where a delay reason was recorded
  const historicalDelayedEntries = lineEntries
    .filter(({ milestone }) => 
      milestone.status === 'Delayed' || 
      Boolean(milestone.delayReason) || 
      (typeof milestone.varianceDays === 'number' && milestone.varianceDays > 0)
    )
    .sort((a, b) => a.milestone.stageOrder - b.milestone.stageOrder);

  const delayedEntry = activeDelayedEntries[0] || historicalDelayedEntries[0];

  let stageName = activeMilestone ? getStageFriendlyName(activeMilestone.key, line) : '1. Customer PO Intake';

  if (isOrderFinished) {
    stageName = '14. Delivered & Completed';
  }

  const statusTag: MilestoneStatus = isOrderFinished 
    ? 'Completed' 
    : (activeMilestone?.actualStartDate || activeMilestone?.status === 'In Progress' ? 'In Progress' : (activeMilestone?.status || 'In Progress'));

  // An order is delayed if there is an active schedule variance or active delayed stage
  const isDelayed = !isOrderFinished && (
    po.status === 'Delayed' ||
    maxPOVariance > 0 ||
    po.productLines.some(productLine => productLine.status === 'Delayed' || (productLine.overallVarianceDays || 0) > 0) ||
    activeDelayedEntries.length > 0 ||
    (activeMilestone && (activeMilestone.status === 'Delayed' || (activeMilestone.varianceDays || 0) > 0))
  );

  // Delayed stage name matches the active delayed stage or root delay source
  const delayedStageName = isDelayed
    ? (activeDelayedEntries[0] 
        ? getStageFriendlyName(activeDelayedEntries[0].milestone.key, activeDelayedEntries[0].line) 
        : (delayedEntry ? getStageFriendlyName(delayedEntry.milestone.key, delayedEntry.line) : (activeMilestone ? getStageFriendlyName(activeMilestone.key, line) : 'Production')))
    : undefined;

  // Net delay variance days correctly tallied from active overall variance
  const delayDays = isDelayed
    ? (maxPOVariance > 0
        ? maxPOVariance
        : (activeMilestone && typeof activeMilestone.varianceDays === 'number' && activeMilestone.varianceDays > 0)
          ? activeMilestone.varianceDays
          : (activeDelayedEntries[0] && typeof activeDelayedEntries[0].milestone.varianceDays === 'number' && activeDelayedEntries[0].milestone.varianceDays > 0)
            ? activeDelayedEntries[0].milestone.varianceDays
            : (delayedEntry && typeof delayedEntry.milestone.varianceDays === 'number' && delayedEntry.milestone.varianceDays > 0)
              ? delayedEntry.milestone.varianceDays
              : 0)
    : 0;

  const delayReason = isDelayed
    ? (activeDelayedEntries[0]?.milestone.delayReason || delayedEntry?.milestone.delayReason || delayedEntry?.line.delayReason || activeMilestone?.delayReason || line.delayReason)
    : undefined;

  const lastRevNum = (po.revisions && po.revisions.length > 0) ? po.revisions.length - 1 : 0;

  let timelineValidationStatus: 'VALIDATED_OK' | 'REQUIRES_REVISION_DELAYED' | 'CLOSED' = 'VALIDATED_OK';
  let timelineMessage = `Timeline Validated — On schedule for delivery on ${po.revisedDeliveryDate || po.committedDeliveryDate} (Rev ${lastRevNum} Approved)`;

  if (po.status === 'Baseline Pending') {
    timelineValidationStatus = 'REQUIRES_REVISION_DELAYED';
    timelineMessage = `Baseline Pending — Awaiting PM review and initial baseline approval before work release.`;
  } else if (isOrderFinished) {
    timelineValidationStatus = 'CLOSED';
    timelineMessage = `Order Closed & Delivered — Final Rev ${lastRevNum} Locked`;
  } else if (isDelayed) {
    timelineValidationStatus = 'REQUIRES_REVISION_DELAYED';
    timelineMessage = `Timeline Action Required — +${delayDays}d delay calculated at ${delayedStageName || 'Production'}. Formal baseline review needed.`;
  }

  return {
    currentStageKey: activeMilestone?.key || 'po_from_customer',
    currentStageName: stageName,
    statusTag,
    progressPercent: isOrderFinished ? 100 : progressPercent,
    completedStagesCount: isOrderFinished ? totalStagesCount : completedStagesCount,
    totalStagesCount,
    isDelayed,
    delayDays,
    delayedStageName,
    delayReason,
    activeMilestone,
    productLineName: line.productName,
    designType: line.designType,
    timelineValidationStatus,
    timelineMessage,
    lastRevNum
  };
}

export function getStageFriendlyName(key: string, _line?: any): string {
  switch (key) {
    case 'po_from_customer': return '1. Customer Purchase Order (PO)';
    case 'pm_baseline':
    case 'baseline_review': return '2. Baseline Review & Planning';
    case 'corb_release': return '3. CORB Release';
    case 'bom_release': return '4. BOM Release';
    case 'wo_release': return '5. Work Order (WO) Release';
    case 'sub_supplier_po': return '6. Sub-Supplier PO';
    case 'material_receipt':
    case 'raw_material':
    case 'incoming_inspection': return '7. Material Receipt (GRN)';
    case 'machining': return '8. Machining & Fabrication';
    case 'assembly':
    case 'production': return '9. Assembly';
    case 'fg':
    case 'qc_pass': return '10. Finished Goods (FG)';
    case 'customer_inspection': return '11. Customer Inspection';
    case 'painting': return '12. Painting';
    case 'trn': return '13. TRN';
    case 'shipment':
    case 'dispatch':
    case 'delivery': return '14. Shipment & Dispatch';
    default: return key;
  }
}
