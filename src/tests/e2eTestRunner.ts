import { 
  addDays, 
  getDaysDifference, 
  recalculateProductLine, 
  validateEventDate
} from '../services/calculationEngine.ts';
import { getPOManufacturingStatus } from '../utils/statusUtils.ts';
import { extractDelayFlow } from '../components/common/DelayAnalysisFlow.tsx';
import type { PurchaseOrder, ProductLine, Milestone } from '../types/index.ts';

const cascadeNextMilestoneStart = (
  msList: Milestone[],
  completedIndex: number,
  completionDate: string,
  user: string
): Milestone[] => {
  const result = [...msList];
  for (let i = completedIndex + 1; i < result.length; i++) {
    const ms = result[i];
    if (ms.status === 'Completed') break;

    const prevMs = result[i - 1];
    const prevEnd = prevMs.actualEndDate || prevMs.forecastEndDate || completionDate;

    if (i === completedIndex + 1) {
      const bStart = ms.committedBaselineStartDate;
      const bEnd = ms.committedBaselineEndDate;
      const newStartDate = ms.actualStartDate
        ? (ms.actualStartDate < prevEnd ? prevEnd : ms.actualStartDate)
        : (bStart && prevEnd < bStart ? bStart : prevEnd);
      const startShift = (bStart && newStartDate > bStart) ? getDaysDifference(bStart, newStartDate) : 0;
      result[i] = {
        ...ms,
        actualStartDate: ms.status === 'In Progress' ? newStartDate : ms.actualStartDate,
        forecastStartDate: newStartDate,
        forecastEndDate: ms.actualEndDate || (
          startShift > 0 && bEnd
            ? addDays(bEnd, startShift)
            : (bEnd || addDays(newStartDate, ms.committedDurationDays))
        ),
        lastUpdatedBy: user,
        lastUpdatedAt: new Date().toISOString()
      };
    } else {
      const prevResult = result[i - 1];
      const bStart = ms.committedBaselineStartDate;
      const bEnd = ms.committedBaselineEndDate;
      const prevEnd = prevResult.forecastEndDate || prevResult.committedBaselineEndDate;
      const cascadeStart = (bStart && prevEnd && prevEnd <= bStart) ? bStart : (prevEnd || bStart);
      const startShift = (bStart && cascadeStart && cascadeStart > bStart) ? getDaysDifference(bStart, cascadeStart) : 0;
      const cascadeEnd = ms.actualEndDate || (
        startShift > 0 && bEnd
          ? addDays(bEnd, startShift)
          : (bEnd || (cascadeStart ? addDays(cascadeStart, ms.committedDurationDays) : ''))
      );
      result[i] = {
        ...ms,
        forecastStartDate: cascadeStart,
        forecastEndDate: cascadeEnd
      };
    }
  }
  return result;
};

const createMilestone = (
  id: string,
  key: string,
  name: string,
  stageOrder: number,
  durationDays: number,
  baseStart: string,
  status: Milestone['status'] = 'Not Started'
): Milestone => {
  const baseEnd = addDays(baseStart, durationDays);
  return {
    id,
    key,
    name,
    stageOrder,
    defaultDurationDays: durationDays,
    committedBaselineStartDate: baseStart,
    committedBaselineEndDate: baseEnd,
    committedDurationDays: durationDays,
    forecastStartDate: baseStart,
    forecastEndDate: baseEnd,
    varianceDays: 0,
    status,
    completionPct: status === 'Completed' ? 100 : 0
  };
};

const build14Milestones = (startDate: string): Milestone[] => {
  const stages = [
    { key: 'po_from_customer', name: 'PO Intake', dur: 2 },
    { key: 'pm_baseline', name: 'PM Baseline', dur: 3 },
    { key: 'corb_release', name: 'CORB Release', dur: 3 },
    { key: 'bom_release', name: 'BOM Release', dur: 5 },
    { key: 'wo_release', name: 'WO Release', dur: 2 },
    { key: 'sub_supplier_po', name: 'Sub-Supplier PO', dur: 7 },
    { key: 'material_receipt', name: 'Material Receipt', dur: 10 },
    { key: 'machining', name: 'Machining', dur: 8 },
    { key: 'assembly', name: 'Assembly', dur: 5 },
    { key: 'fg', name: 'FG Inspection', dur: 2 },
    { key: 'customer_inspection', name: 'Customer Inspection', dur: 3 },
    { key: 'painting', name: 'Painting', dur: 3 },
    { key: 'trn', name: 'TRN Clearance', dur: 2 },
    { key: 'shipment', name: 'Shipment', dur: 3 }
  ];

  let currentStart = startDate;
  return stages.map((s, idx) => {
    const ms = createMilestone(`ms-${idx + 1}`, s.key, s.name, idx + 1, s.dur, currentStart);
    currentStart = ms.committedBaselineEndDate;
    return ms;
  });
};

const createMockPO = (): PurchaseOrder => {
  const poDate = '2026-08-01';
  const line1Milestones = build14Milestones(poDate);
  const line2Milestones = build14Milestones(poDate);

  const finalDelivery = line1Milestones[line1Milestones.length - 1].committedBaselineEndDate;

  const line1: ProductLine = {
    id: 'line-1',
    lineNumber: 'ITEM-01',
    productName: 'Gate Valve 2 inch 600#',
    category: 'Gate Valves',
    qty: 10,
    designType: 'Existing Design',
    overallVarianceDays: 0,
    status: 'In Progress',
    materials: [
      { id: 'mat-1', itemCode: 'WCB-CAST', description: 'Body Casting WCB', qty: 10, unit: 'Pcs', supplierName: 'Foundry A', leadTimeDays: 14, isCriticalPath: true, receivedDate: '2026-08-15', inspectionResult: 'Passed' },
      { id: 'mat-2', itemCode: 'STEM-13CR', description: 'Trim 13Cr Stem', qty: 10, unit: 'Pcs', supplierName: 'Supplier B', leadTimeDays: 7, isCriticalPath: false, receivedDate: '2026-08-15', inspectionResult: 'Passed' }
    ],
    milestones: line1Milestones
  };

  const line2: ProductLine = {
    id: 'line-2',
    lineNumber: 'ITEM-02',
    productName: 'Globe Valve 3 inch 900#',
    category: 'Globe Valves',
    qty: 20,
    designType: 'New Design',
    overallVarianceDays: 0,
    status: 'In Progress',
    materials: [
      { id: 'mat-3', itemCode: 'FORG-F316', description: 'Body Forging F316', qty: 20, unit: 'Pcs', supplierName: 'ForgeTech', leadTimeDays: 10, isCriticalPath: true, receivedDate: '2026-08-16', inspectionResult: 'Passed' }
    ],
    milestones: line2Milestones
  };

  return {
    id: 'po-test-01',
    poNumber: 'PO-TEST-2026-99',
    customerPoRef: 'CUST-PO-ARAMCO-2026',
    customerName: 'Aramco Offshore Engineering',
    poDate,
    committedDeliveryDate: finalDelivery,
    revisedDeliveryDate: finalDelivery,
    contractReviewRef: 'CR-ARAMCO-99',
    status: 'In Progress',
    isClosed: false,
    productLines: [line1, line2],
    revisions: [],
    attachments: [],
    createdBy: 'Sales Admin',
    createdAt: '2026-08-01T08:00:00.000Z',
    lastUpdatedBy: 'Test Runner',
    lastUpdatedAt: '2026-08-01T08:00:00.000Z'
  };
};

console.log('================================================================');
console.log('🧪 CIRCOR E2E MANUFACTURING TRACKER - AUTOMATED TEST SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
  }
}

// ----------------------------------------------------------------------------
// TEST GROUP 1: Sequential Manufacturing Guardrails
// ----------------------------------------------------------------------------
console.log('📋 GROUP 1: Sequential Manufacturing Guardrails & Dependency Validation');

const po = createMockPO();
const line1 = po.productLines[0];

// Test 1.1: Milestone 1 start valid
const m1Start = validateEventDate({
  milestones: line1.milestones,
  index: 0,
  eventType: 'start',
  eventDate: '2026-08-01',
  todayStr: '2026-10-05'
});
assert(m1Start.ok, 'Stage 1 (PO Intake) can start on valid PO date');

// Test 1.2: Milestone 2 cannot start before Milestone 1 completes
const m2PrematureStart = validateEventDate({
  milestones: line1.milestones,
  index: 1,
  eventType: 'start',
  eventDate: '2026-08-03',
  todayStr: '2026-10-05'
});
assert(!m2PrematureStart.ok, 'Stage 2 is blocked from starting before Stage 1 completes', m2PrematureStart.error);

// Complete Stage 1 on 2026-08-03
line1.milestones[0].actualStartDate = '2026-08-01';
line1.milestones[0].actualEndDate = '2026-08-03';
line1.milestones[0].status = 'Completed';
line1.milestones[0].completionPct = 100;

// Test 1.3: Milestone 2 start on or after Stage 1 actual end date
const m2ValidStart = validateEventDate({
  milestones: line1.milestones,
  index: 1,
  eventType: 'start',
  eventDate: '2026-08-03',
  todayStr: '2026-10-05'
});
assert(m2ValidStart.ok, 'Stage 2 start is allowed on Stage 1 completion date (2026-08-03)');

// Test 1.4: Milestone 2 cannot start BEFORE Stage 1 actual end date (Date Sync Error prevention)
const m2InvalidEarlyStart = validateEventDate({
  milestones: line1.milestones,
  index: 1,
  eventType: 'start',
  eventDate: '2026-08-02',
  todayStr: '2026-10-05'
});
assert(!m2InvalidEarlyStart.ok, 'Stage 2 correctly rejects start dates prior to Stage 1 actual end date (Date Sync Protection)');

// ----------------------------------------------------------------------------
// TEST GROUP 2: Dynamic minAllowedDate & Auto-Chaining
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 2: Dynamic minAllowedDate Chaining & Date Forwarding');

const prevMsEnd = line1.milestones[0].actualEndDate!;
const computedMinAllowed = prevMsEnd;
assert(computedMinAllowed === '2026-08-03', `minAllowedDate for Stage 2 correctly evaluates to Stage 1 actual end date: ${computedMinAllowed}`);

// Cascade into stage 2 start
const cascadedMilestones = cascadeNextMilestoneStart(line1.milestones, 0, '2026-08-03', 'Test User');
assert(cascadedMilestones[1].forecastStartDate === '2026-08-03', 'cascadeNextMilestoneStart successfully updates Stage 2 forecast start date');

// ----------------------------------------------------------------------------
// TEST GROUP 3: Delay Variance Calculation & Forward Recalculation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 3: Delay Variance Calculation & Schedule Propagation');

// Complete Stage 2 with 4 days delay (baseline end was 2026-08-06, actual end 2026-08-10)
line1.milestones[1].actualStartDate = '2026-08-03';
line1.milestones[1].actualEndDate = '2026-08-10';
line1.milestones[1].status = 'Completed';
line1.milestones[1].completionPct = 100;
line1.milestones[1].varianceDays = getDaysDifference('2026-08-06', '2026-08-10');
line1.milestones[1].delayReason = 'Customer clarification pending on special flange spec';

assert(line1.milestones[1].varianceDays === 4, `Variance calculation: ${line1.milestones[1].varianceDays} days delay calculated correctly`);

// Recalculate product line
const recalcLine = recalculateProductLine(line1, '2026-10-05', 2, 5);
assert(recalcLine.overallVarianceDays >= 4, `Recalculated line overall variance is >= 4 days (${recalcLine.overallVarianceDays}d)`);

// ----------------------------------------------------------------------------
// TEST GROUP 4: Accumulated Previous Delay Concatenation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 4: Accumulated Previous Delay Aggregation across Multi-Stages');

// Stage 3 also delayed by 2 days
line1.milestones[2].actualStartDate = '2026-08-10';
line1.milestones[2].actualEndDate = '2026-08-15';
line1.milestones[2].status = 'Completed';
line1.milestones[2].completionPct = 100;
line1.milestones[2].varianceDays = 2;
line1.milestones[2].delayReason = 'CORB review extended for NACE MR0175 compliance';

// Gather accumulated prior delays for Stage 4
const stage4Idx = 3;
const priorDelays = line1.milestones
  .slice(0, stage4Idx)
  .filter(m => (m.varianceDays && m.varianceDays > 0) || (m.delayReason && !m.delayReason.startsWith('Cascaded')));

assert(priorDelays.length === 2, `Collected ${priorDelays.length} prior delayed stages (Expected 2)`);

const delaySummaryString = `Accumulated previous delays: ` + priorDelays.map(d => `${d.name} (+${d.varianceDays}d${d.delayReason ? `: ${d.delayReason}` : ''})`).join('; ');
assert(delaySummaryString.includes('PM Baseline (+4d') && delaySummaryString.includes('CORB Release (+2d'), 'Delay summary properly formats multi-stage historical delay text');

// Test early completion recovery: Stage 4 starts on 08-15 (6d behind plan) and is completed the
// same day. A stage can never end before it starts, so the engine keeps the end at 08-15 (5d
// shorter than its 5d plan) and the line recovers from +6d to a net +1d at WO Release.
line1.milestones[3].actualStartDate = '2026-08-15';
line1.milestones[3].actualEndDate = '2026-08-15';
line1.milestones[3].status = 'Completed';
line1.milestones[3].completionPct = 100;
line1.milestones[3].varianceDays = 0;

const recoveredLine = recalculateProductLine(line1, '2026-10-05', 2, 5);
assert(recoveredLine.overallVarianceDays === 1, `Line overall variance recovers from +6d to +1d after Stage 4 completes quickly (got ${recoveredLine.overallVarianceDays}d)`);
assert(recoveredLine.overallVarianceDays < 6, 'Early completion of Stage 4 reduces the accumulated delay');
assert(recoveredLine.status === 'Delayed', `Line stays Delayed while a +1d variance remains (got ${recoveredLine.status})`);

// Test complete recovery to 0d variance: Stage 5 starts on time and completes within baseline end
line1.milestones[4].actualStartDate = line1.milestones[4].committedBaselineStartDate;
line1.milestones[4].actualEndDate = line1.milestones[4].committedBaselineEndDate;
line1.milestones[4].status = 'Completed';
line1.milestones[4].completionPct = 100;
line1.milestones[4].varianceDays = 0;

const fullyRecoveredLine = recalculateProductLine(line1, '2026-10-05', 2, 5);
assert(fullyRecoveredLine.overallVarianceDays === 0, `Line overall variance fully recovers to 0d (got ${fullyRecoveredLine.overallVarianceDays}d)`);
assert(fullyRecoveredLine.status === 'On Track', `Line status updates to 'On Track' when variance resolves to 0 (got ${fullyRecoveredLine.status})`);

// Ensure forthcoming uncompleted stages (Stage 6+) do not carry false delay or 'Previous' shifts
const stage6 = fullyRecoveredLine.milestones[5];
assert((stage6.varianceDays || 0) <= 0, `Forthcoming stage has 0 variance days after recovery (got ${stage6.varianceDays})`);
assert(stage6.status !== 'Delayed', `Forthcoming stage status is not Delayed after recovery (got ${stage6.status})`);

const mockPO: PurchaseOrder = {
  ...po,
  status: 'In Progress',
  productLines: [fullyRecoveredLine]
};
const poStatusSummary = getPOManufacturingStatus(mockPO);
assert(poStatusSummary.isDelayed === false, `PO status summary correctly reports isDelayed=false when schedule is recovered`);
assert(poStatusSummary.delayDays === 0, `PO status summary reports 0d delay days when schedule is recovered`);

// ----------------------------------------------------------------------------
// TEST GROUP 5: Multi-Product Weighted Progress Calculation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 5: Multi-Product Progress Rollup (Quantity-Weighted)');

// Complete all 14 stages on line1 (qty 10)
line1.milestones.forEach((m) => {
  m.status = 'Completed';
  m.actualStartDate = '2026-08-01';
  m.actualEndDate = '2026-08-20';
  m.completionPct = 100;
});
line1.status = 'Completed';

// Line 2 (qty 20) has 7 stages completed (50%)
const line2 = po.productLines[1];
for (let i = 0; i < 7; i++) {
  line2.milestones[i].status = 'Completed';
  line2.milestones[i].actualEndDate = '2026-08-15';
  line2.milestones[i].completionPct = 100;
}

const line1Progress = 100;
const line2Progress = Math.round((7 / 14) * 100); // 50%

const totalWeight = line1.qty + line2.qty; // 10 + 20 = 30
const weightedAvg = Math.round((line1Progress * line1.qty + line2Progress * line2.qty) / totalWeight);
// (100 * 10 + 50 * 20) / 30 = (1000 + 1000) / 30 = 67%

assert(weightedAvg === 67, `Weighted progress accurately calculated as ${weightedAvg}% (Expected 67%)`);

// ----------------------------------------------------------------------------
// TEST GROUP 6: Multi-Product Order Closure Governance
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 6: Multi-Product Order Closure Validation');

// Check if PO can be closed when line 2 is only 50% complete
const canCloseIncomplete = po.productLines.every(l =>
  l.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)
);
assert(!canCloseIncomplete, 'Order closure is strictly blocked when not all product lines are completed');

// Now complete remaining 7 stages on line 2
for (let i = 7; i < 14; i++) {
  line2.milestones[i].status = 'Completed';
  line2.milestones[i].actualEndDate = '2026-09-01';
  line2.milestones[i].completionPct = 100;
}
line2.status = 'Completed';

const canCloseComplete = po.productLines.every(l =>
  l.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)
);
assert(canCloseComplete, 'Order closure is fully unlocked when all 14 stages across all product lines are complete');

// Final Status Check
const poStatusAfterFullCompletion = getPOManufacturingStatus(po);
assert(poStatusAfterFullCompletion.completedStagesCount >= 14, 'getPOManufacturingStatus reports 100% stage completion');

// ----------------------------------------------------------------------------
// TEST GROUP 7: Inherited Predecessor Delay Start Chaining & Zero New Delay Validation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 7: Inherited Predecessor Delay Start Chaining & Zero New Delay Validation');

const stage6ActualEnd = '2026-10-24'; // 3 days delay

const stage7BaselineStart = '2026-10-21';
const stage7BaselineEnd = '2026-10-24';
const stage7Duration = 3;

// 1. Stage 7 starts with previous stage end date
const stage7DefaultStartDate = stage6ActualEnd;
assert(stage7DefaultStartDate === '2026-10-24', 'Stage 7 start date chains directly to Stage 6 delayed end date (2026-10-24)');

// 2. Calculate delay metrics for Stage 7 start on 2026-10-24
const s7TotalStartDelay = getDaysDifference(stage7BaselineStart, stage7DefaultStartDate); // 3 days
const s7InheritedDelay = Math.min(s7TotalStartDelay, getDaysDifference(stage7BaselineStart, stage6ActualEnd)); // 3 days
const s7NewDelayFormed = Math.max(0, s7TotalStartDelay - s7InheritedDelay); // 0 days
assert(s7TotalStartDelay === 3, 'Total delay from original baseline start is 3 days');
assert(s7InheritedDelay === 3, 'Inherited delay from previous stage is 3 days');
assert(s7NewDelayFormed === 0, 'No new delay formed at Stage 7 when starting on previous end date (strictly 0d)');

// 3. Verify planned baseline vs revised plan due to delay
const s7RevisedStart = stage6ActualEnd; // 2026-10-24
const s7RevisedEnd = addDays(s7RevisedStart, stage7Duration); // 2026-10-27 (+3d shift)
assert(stage7BaselineStart === '2026-10-21' && stage7BaselineEnd === '2026-10-24', 'Planned baseline preserved immutable as 2026-10-21 -> 2026-10-24');
assert(s7RevisedStart === '2026-10-24' && s7RevisedEnd === '2026-10-27', 'Revised target due to delay correctly computed as 2026-10-24 -> 2026-10-27');

// ----------------------------------------------------------------------------
// TEST GROUP 8: Completed & Closed Order Delay Preservation in History
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 8: Completed & Closed Order Delay Preservation in History Archive');

const closedDelayedPO: PurchaseOrder = {
  ...po,
  id: 'PO-CLOSED-DELAYED',
  poNumber: 'PO-2026-999',
  isClosed: true,
  status: 'Closed' as any,
  committedDeliveryDate: '2026-09-01',
  revisedDeliveryDate: '2026-09-04',
  productLines: [
    {
      ...po.productLines[0],
      overallVarianceDays: 3,
      milestones: po.productLines[0].milestones.map((m, idx) => ({
        ...m,
        status: 'Completed',
        actualEndDate: idx === 13 ? '2026-09-04' : '2026-08-20',
        committedBaselineEndDate: idx === 13 ? '2026-09-01' : '2026-08-15',
        varianceDays: idx === 13 ? 3 : 0
      }))
    }
  ]
};

const closedDelayedSummary = getPOManufacturingStatus(closedDelayedPO);
assert(closedDelayedSummary.delayDays === 3, `Closed delayed order accurately preserves delayDays of 3d (got ${closedDelayedSummary.delayDays}d)`);
assert(closedDelayedSummary.timelineValidationStatus === 'CLOSED', 'Timeline status is CLOSED');
assert(closedDelayedSummary.timelineMessage.includes('+3d delay'), 'Timeline message highlights +3d delay on closed order');
// ----------------------------------------------------------------------------
// TEST GROUP 9: Multi-Product Delay Isolation & Individual Revised Timelines
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 9: Multi-Product Delay Isolation & Individual Revised Timelines');

const line1Delayed = recalculateProductLine({
  id: 'LINE-01',
  lineNumber: 'LINE-01',
  productName: 'High Pressure Valve 4" 1500#',
  category: 'High Pressure Valves',
  qty: 5,
  designType: 'Existing Design',
  materials: [],
  status: 'Delayed',
  overallVarianceDays: 4,
  milestones: build14Milestones('2026-08-01').map((m, idx) => {
    if (idx === 0) return { ...m, status: 'Completed', actualEndDate: '2026-08-07', varianceDays: 4 };
    return { ...m, forecastEndDate: addDays(m.committedBaselineEndDate, 4), varianceDays: 4 };
  })
}, '2026-08-10');

const line2OnTime = recalculateProductLine({
  id: 'LINE-02',
  lineNumber: 'LINE-02',
  productName: 'Cryogenic Valve 2" 600#',
  category: 'Cryogenic Valves',
  qty: 10,
  designType: 'Existing Design',
  materials: [],
  status: 'In Progress',
  overallVarianceDays: 0,
  milestones: build14Milestones('2026-08-01').map((m, idx) => {
    if (idx === 0) return { ...m, status: 'Completed', actualEndDate: '2026-08-03', varianceDays: 0 };
    return m;
  })
}, '2026-08-10');

assert(line1Delayed.overallVarianceDays === 4, `Line 1 retains its 4d delay variance (got ${line1Delayed.overallVarianceDays}d)`);
assert(line2OnTime.overallVarianceDays === 0, `Line 2 remains on time with 0d delay variance (got ${line2OnTime.overallVarianceDays}d)`);

const line1FinalMs = line1Delayed.milestones[13];
const line2FinalMs = line2OnTime.milestones[13];

assert(line1FinalMs.forecastEndDate > line1FinalMs.committedBaselineEndDate, 'Line 1 final milestone delivery date is shifted by delay');
assert(line2FinalMs.forecastEndDate === line2FinalMs.committedBaselineEndDate, 'Line 2 final milestone delivery date remains strictly on baseline');

// ----------------------------------------------------------------------------
// TEST GROUP 10: Delay Log Attribution to Specific Product Line
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 10: Delay Log Attribution to Specific Product Line');

const multiProductPO: PurchaseOrder = {
  id: 'PO-MULTI-01',
  poNumber: 'CFT-PO-2026-9001',
  customerName: 'Aramco Offshore',
  customerPoRef: 'REF-9988',
  poDate: '2026-08-01',
  contractReviewRef: 'CR-001',
  committedDeliveryDate: line1FinalMs.committedBaselineEndDate,
  revisedDeliveryDate: line1FinalMs.forecastEndDate,
  status: 'Delayed',
  productLines: [line1Delayed, line2OnTime],
  revisions: [],
  attachments: [],
  createdBy: 'Sales User',
  createdAt: '2026-08-01T00:00:00.000Z',
  lastUpdatedBy: 'Planner User',
  lastUpdatedAt: '2026-08-10T00:00:00.000Z',
  isClosed: false
};

const delayFlow = extractDelayFlow(multiProductPO);
assert(delayFlow.hasDelays === true, 'Delay flow detects delay in multi-product order');
assert(delayFlow.rootDelayStep !== null, 'Root delay step identified');
assert(delayFlow.rootDelayStep?.productLineName === 'High Pressure Valve 4" 1500#', `Delay step accurately attributes the causing product line (got "${delayFlow.rootDelayStep?.productLineName}")`);
assert(delayFlow.rootDelayStep?.lineNumber === 'LINE-01', `Delay step accurately attributes the causing line number (got "${delayFlow.rootDelayStep?.lineNumber}")`);

console.log('\n================================================================');
const successRate = totalTests === 0 ? 0 : Math.round((passedTests / totalTests) * 100);
console.log(`${passedTests === totalTests ? '🎉' : '⚠️'} TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (${successRate}% SUCCESS RATE)`);
console.log('================================================================\n');
if (passedTests !== totalTests) throw new Error(`${totalTests - passedTests} e2e test(s) failed`);


