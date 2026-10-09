import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { MilestoneStatus, DelayCategory, PurchaseOrder, ProductLine, Milestone } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { validateEventDate, getDaysDifference, mergeDelayReason, addDays } from '../../services/calculationEngine';
import { 
  Calendar, 
  CheckCircle2, 
  Lock, 
  AlertTriangle, 
  Play, 
  Edit3, 
  Layers, 
  LayoutGrid, 
  ChevronDown, 
  ChevronRight, 
  Sparkles,
  Archive,
  Eye,
  EyeOff,
  X
} from 'lucide-react';
import { CloseOrderModal } from '../modals/CloseOrderModal';
import { DelayAnalysisFlow } from '../common/DelayAnalysisFlow';

interface MilestoneModuleViewProps {
  stageKey: string;
  stageTitle: string;
  stageOrder: number;
  responsibleRole: string;
  description: string;
}

const ALL_14_STAGES = [
  { key: 'po_from_customer', label: '1. PO Intake' },
  { key: 'pm_baseline', label: '2. PM Baseline' },
  { key: 'corb_release', label: '3. CORB Release' },
  { key: 'bom_release', label: '4. BOM Release' },
  { key: 'wo_release', label: '5. WO Release' },
  { key: 'sub_supplier_po', label: '6. Sub-Supplier PO' },
  { key: 'material_receipt', label: '7. Material GRN' },
  { key: 'machining', label: '8. Machining' },
  { key: 'assembly', label: '9. Assembly' },
  { key: 'fg', label: '10. FG' },
  { key: 'customer_inspection', label: '11. Cust Insp' },
  { key: 'painting', label: '12. Painting' },
  { key: 'trn', label: '13. TRN' },
  { key: 'shipment', label: '14. Shipment' }
];

export const MilestoneModuleView: React.FC<MilestoneModuleViewProps> = ({
  stageKey,
  stageTitle,
  stageOrder,
  responsibleRole,
  description
}) => {
  const { purchaseOrders, acceptMilestone, updateMilestoneEvent, batchUpdateMilestoneEvents, activeRole } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  // Default is 'active' so completed orders do not clutter the work queue
  const [filterTab, setFilterTab] = useState<'active' | 'ready' | 'in_progress' | 'delayed' | 'completed'>('active');
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards');
  
  // Accordion state
  const [expandedPOs, setExpandedPOs] = useState<Record<string, boolean>>({});
  const [showCompletedLinesInCard, setShowCompletedLinesInCard] = useState<Record<string, boolean>>({});
  const [closingPO, setClosingPO] = useState<PurchaseOrder | null>(null);

  // Individual line editing state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Local form states per editing card
  const [formData, setFormData] = useState<{
    startDate: string;
    endDate: string;
    docRef: string;
    particularDetails: string;
    secondaryRef: string;
    status: MilestoneStatus;
    delayCategory: DelayCategory | '';
    delayReason: string;
    varianceDays: number;
  }>({
    startDate: '',
    endDate: '',
    docRef: '',
    particularDetails: '',
    secondaryRef: '',
    status: 'Not Started',
    delayCategory: '',
    delayReason: '',
    varianceDays: 0
  });

  // Batch Action Modal State
  const [batchModal, setBatchModal] = useState<{
    isOpen: boolean;
    po: PurchaseOrder | null;
    mode: 'start' | 'complete';
    selectedLineIds: string[];
    date: string;
    docRef: string;
    delayCategory: DelayCategory | '';
    delayReason: string;
  }>({
    isOpen: false,
    po: null,
    mode: 'start',
    selectedLineIds: [],
    date: new Date().toISOString().split('T')[0],
    docRef: '',
    delayCategory: '',
    delayReason: ''
  });

  const canManageStage = isMilestoneOwnedByRole(stageKey, activeRole);
  const todayStr = new Date().toISOString().split('T')[0];

  const togglePOExpand = (poId: string, defaultOpen = false) => {
    setExpandedPOs(prev => {
      const current = prev[poId] !== undefined ? prev[poId] : defaultOpen;
      return {
        ...prev,
        [poId]: !current
      };
    });
  };

  const isPOExpanded = (poId: string, defaultOpen = false) => {
    return expandedPOs[poId] !== undefined ? expandedPOs[poId] : defaultOpen;
  };

  const toggleShowCompletedLines = (poId: string) => {
    setShowCompletedLinesInCard(prev => ({
      ...prev,
      [poId]: !prev[poId]
    }));
  };

  // Helper to check if prerequisite stage is completed
  const isPrereqComplete = (line: ProductLine, targetMilestoneKey: string) => {
    const msIndex = (line.milestones || []).findIndex(m => m.key === targetMilestoneKey);
    if (msIndex <= 0) return true;
    const prevMs = line.milestones[msIndex - 1];
    return prevMs?.status === 'Completed' || Boolean(prevMs?.actualEndDate) || prevMs?.completionPct === 100;
  };

  // Group purchase orders and calculate stage rollup data
  const validPOs = purchaseOrders.filter(po => (stageKey === 'pm_baseline' || stageKey === 'baseline_review' || po.status !== 'Baseline Pending') && po.status !== 'Cancelled' && !po.isCancelled);

  const poStageGroups = validPOs.map(po => {
    const linesWithMs = (po.productLines || []).map(line => {
      const milestone = (line.milestones || []).find(m => m.key === stageKey);
      const isPrereqDone = isPrereqComplete(line, stageKey);
      const isDone = milestone?.status === 'Completed' || Boolean(milestone?.actualEndDate) || milestone?.completionPct === 100;
      const isStarted = Boolean(milestone?.actualStartDate) && !isDone;
      const isDelayed = milestone?.status === 'Delayed' || (typeof milestone?.varianceDays === 'number' && milestone.varianceDays > 0);
      const isReadyToStart = isPrereqDone && !isStarted && !isDone;
      const isReadyToComplete = isPrereqDone && isStarted && !isDone;

      return {
        line,
        milestone: milestone as Milestone,
        isPrereqDone,
        isDone,
        isStarted,
        isDelayed,
        isReadyToStart,
        isReadyToComplete
      };
    }).filter(item => item.milestone !== undefined);

    const totalLines = linesWithMs.length;
    const completedLines = linesWithMs.filter(l => l.isDone).length;
    const startedLines = linesWithMs.filter(l => l.isStarted).length;
    const delayedLines = linesWithMs.filter(l => l.isDelayed).length;
    const readyToStartLines = linesWithMs.filter(l => l.isReadyToStart).length;
    const readyToCompleteLines = linesWithMs.filter(l => l.isReadyToComplete).length;
    const lockedLines = linesWithMs.filter(l => !l.isPrereqDone).length;

    const isAllCompleted = totalLines > 0 && completedLines === totalLines;
    const hasActiveWork = readyToStartLines > 0 || readyToCompleteLines > 0 || startedLines > 0;
    const hasDelay = delayedLines > 0;

    return {
      po,
      lines: linesWithMs,
      totalLines,
      completedLines,
      startedLines,
      delayedLines,
      readyToStartLines,
      readyToCompleteLines,
      lockedLines,
      isAllCompleted,
      hasActiveWork,
      hasDelay
    };
  }).filter(group => group.totalLines > 0);

  // Overall KPI statistics
  const activePOGroups = poStageGroups.filter(g => !g.isAllCompleted && !g.po.isClosed && g.po.status !== 'Completed');
  const completedPOGroups = poStageGroups.filter(g => g.isAllCompleted || g.po.isClosed || g.po.status === 'Completed');

  const totalStagePOs = activePOGroups.length;
  const totalStageLines = activePOGroups.reduce((acc, g) => acc + g.totalLines, 0);
  const totalCompletedLines = poStageGroups.reduce((acc, g) => acc + g.completedLines, 0);
  const totalStartedLines = activePOGroups.reduce((acc, g) => acc + g.startedLines, 0);
  const totalDelayedLines = activePOGroups.reduce((acc, g) => acc + g.delayedLines, 0);
  const totalActionReadyLines = activePOGroups.reduce((acc, g) => acc + (g.readyToStartLines + g.readyToCompleteLines), 0);

  // Filtering based on search and tab
  const filteredPOGroups = poStageGroups.filter(group => {
    // Search Term Filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchesPO = group.po.poNumber.toLowerCase().includes(term) ||
                        group.po.customerName.toLowerCase().includes(term);
      const matchesLine = group.lines.some(l => l.line.productName.toLowerCase().includes(term) || l.line.lineNumber.toLowerCase().includes(term));
      if (!matchesPO && !matchesLine) return false;
    }

    // Default 'active': only show active/in-progress orders (exclude completed)
    if (filterTab === 'active') {
      return !group.isAllCompleted && !group.po.isClosed && group.po.status !== 'Completed';
    }
    if (filterTab === 'ready') {
      return !group.isAllCompleted && (group.readyToStartLines > 0 || group.readyToCompleteLines > 0);
    }
    if (filterTab === 'in_progress') {
      return !group.isAllCompleted && group.startedLines > 0;
    }
    if (filterTab === 'delayed') {
      return !group.isAllCompleted && group.hasDelay;
    }
    if (filterTab === 'completed') {
      return group.isAllCompleted || group.po.isClosed || group.po.status === 'Completed';
    }

    return true;
  });

  // Start edit for single line (opens custom date form)
  const handleStartEdit = (entryKey: string, milestone: Milestone) => {
    setEditingKey(entryKey);
    setErrorMessage(null);
    setSuccessMessage(null);
    setFormData({
      startDate: milestone.actualStartDate || milestone.forecastStartDate || milestone.committedBaselineStartDate || todayStr,
      endDate: milestone.actualEndDate || milestone.forecastEndDate || milestone.committedBaselineEndDate || todayStr,
      docRef: milestone.docRef || '',
      particularDetails: (milestone as any).particularDetails || '',
      secondaryRef: (milestone as any).secondaryRef || '',
      status: milestone.status || 'In Progress',
      delayCategory: milestone.delayCategory || '',
      delayReason: milestone.delayReason || '',
      varianceDays: milestone.varianceDays || 0
    });
  };

  // Save single line update from form
  const handleSaveStageUpdate = (poId: string, lineId: string, key: string, markComplete = false) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const targetPO = purchaseOrders.find(p => p.id === poId);
    const targetLine = targetPO?.productLines.find(l => l.id === lineId);
    if (!targetLine || !targetPO) return;

    const msIndex = (targetLine.milestones || []).findIndex(m => m.key === key || m.id === key);
    if (msIndex < 0) return;

    if (markComplete) {
      const effectiveCompDate = formData.endDate || todayStr;
      const delayReasonToUse = formData.delayReason.trim() || undefined;
      const delayCategoryToUse = formData.delayCategory || undefined;
      
      const compVal = validateEventDate({
        milestones: targetLine.milestones,
        index: msIndex,
        eventType: 'complete',
        eventDate: effectiveCompDate,
        todayStr
      });
      if (!compVal.ok) {
        setErrorMessage(compVal.error || 'Invalid completion date');
        return;
      }

      const compRes = updateMilestoneEvent({
        poId,
        productLineId: lineId,
        milestoneKey: key,
        eventType: 'complete',
        eventDate: effectiveCompDate,
        user: activeRole,
        docRef: formData.docRef || `COMP-${stageOrder}-${Date.now().toString().slice(-4)}`,
        delayCategory: delayCategoryToUse,
        delayReason: delayReasonToUse
      });

      if (!compRes.success) {
        setErrorMessage(compRes.error || 'Failed to complete stage');
        return;
      }
      setSuccessMessage(`Stage ${stageTitle} marked as Completed for ${targetLine.productName}.`);

      // If this was the final milestone or all lines are now completed, prompt for PO Closure
      const currentPO = purchaseOrders.find(p => p.id === poId);
      if (currentPO && !currentPO.isClosed) {
        const isOrderComplete = currentPO.productLines.every(l =>
          l.milestones.every(m => (l.id === lineId && m.key === key) ? true : (m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100))
        );
        if (isOrderComplete) {
          setTimeout(() => setClosingPO(currentPO), 600);
        }
      }
    } else {
      const effectiveStartDate = formData.startDate || todayStr;
      const delayReasonToUse = formData.delayReason.trim() || undefined;
      const delayCategoryToUse = formData.delayCategory || undefined;

      const startVal = validateEventDate({
        milestones: targetLine.milestones,
        index: msIndex,
        eventType: 'start',
        eventDate: effectiveStartDate,
        todayStr
      });
      if (!startVal.ok) {
        setErrorMessage(startVal.error || 'Invalid start date');
        return;
      }

      const startRes = updateMilestoneEvent({
        poId,
        productLineId: lineId,
        milestoneKey: key,
        eventType: 'start',
        eventDate: effectiveStartDate,
        targetEndDate: formData.endDate || undefined,
        user: activeRole,
        docRef: formData.docRef || `REF-${stageOrder}-${Date.now().toString().slice(-4)}`,
        delayCategory: delayCategoryToUse,
        delayReason: delayReasonToUse
      });

      if (!startRes.success) {
        setErrorMessage(startRes.error || 'Failed to update start date');
        return;
      }
      setSuccessMessage(`Stage ${stageTitle} started for ${targetLine.productName}.`);
    }

    setEditingKey(null);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // Open action modal for a single product line
  const openLineModal = (po: PurchaseOrder, line: ProductLine, mode: 'start' | 'complete') => {
    const msIndex = (line.milestones || []).findIndex(m => m.key === stageKey);
    const ms = (line.milestones || [])[msIndex];
    const prevMs = msIndex > 0 ? (line.milestones || [])[msIndex - 1] : null;

    // Initial date: start with previous milestone actual end date if available
    const defaultDate = mode === 'start'
      ? (ms?.actualStartDate || prevMs?.actualEndDate || ms?.committedBaselineStartDate || todayStr)
      : (ms?.actualEndDate || ms?.actualStartDate || prevMs?.actualEndDate || todayStr);

    setBatchModal({
      isOpen: true,
      po,
      mode,
      selectedLineIds: [line.id],
      date: defaultDate,
      docRef: `${mode === 'start' ? 'START' : 'COMP'}-${stageOrder}-${Date.now().toString().slice(-4)}`,
      delayCategory: '',
      delayReason: ''
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Open batch modal
  const openBatchModal = (group: typeof poStageGroups[0], mode: 'start' | 'complete') => {
    const readyLines = mode === 'start'
      ? group.lines.filter(l => l.isReadyToStart).map(l => l.line.id)
      : group.lines.filter(l => l.isPrereqDone && !l.isDone).map(l => l.line.id);

    const initialLineIds = readyLines.length > 0 ? readyLines : group.lines.filter(l => l.isPrereqDone && !l.isDone).map(l => l.line.id);

    let defaultBatchDate = '';
    initialLineIds.forEach(id => {
      const l = group.po.productLines.find(x => x.id === id);
      const idx = (l?.milestones || []).findIndex(m => m.key === stageKey);
      const prev = idx > 0 ? (l?.milestones || [])[idx - 1] : null;
      const targetMs = (l?.milestones || [])[idx];
      const targetDate = mode === 'start'
        ? (targetMs?.actualStartDate || prev?.actualEndDate || targetMs?.committedBaselineStartDate)
        : (targetMs?.actualEndDate || targetMs?.actualStartDate || prev?.actualEndDate);
      if (targetDate && (!defaultBatchDate || targetDate > defaultBatchDate)) {
        defaultBatchDate = targetDate;
      }
    });
    if (!defaultBatchDate) defaultBatchDate = todayStr;

    setBatchModal({
      isOpen: true,
      po: group.po,
      mode,
      selectedLineIds: initialLineIds,
      date: defaultBatchDate,
      docRef: `BATCH-${stageOrder}-${Date.now().toString().slice(-4)}`,
      delayCategory: '',
      delayReason: ''
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Execute batch update across selected lines
  const handleExecuteBatch = () => {
    if (!batchModal.po || batchModal.selectedLineIds.length === 0) return;

    setErrorMessage(null);
    const targetPO = batchModal.po;
    const eventType = batchModal.mode;
    const eventDate = batchModal.date;

    const itemsToUpdate: Array<{
      poId: string;
      productLineId: string;
      milestoneKey: string;
      eventType: 'start' | 'complete';
      eventDate: string;
      user: string;
      docRef: string;
      delayCategory?: DelayCategory;
      delayReason?: string;
    }> = [];

    const errors: string[] = [];

    for (const lineId of batchModal.selectedLineIds) {
      const line = targetPO.productLines.find(l => l.id === lineId);
      if (!line) continue;
      const msIndex = (line.milestones || []).findIndex(m => m.key === stageKey);
      if (msIndex < 0) continue;

      const targetMs = line.milestones[msIndex];
      const prevMs = msIndex > 0 ? line.milestones[msIndex - 1] : null;
      const prevEnd = prevMs?.actualEndDate || prevMs?.forecastEndDate;
      const baselineStart = targetMs.committedBaselineStartDate || targetPO.poDate;
      const baselineEnd = targetMs.committedBaselineEndDate || targetPO.committedDeliveryDate;

      let newDelayFormed = 0;
      if (eventType === 'start') {
        const totalDelay = (baselineStart && eventDate && eventDate > baselineStart) ? getDaysDifference(baselineStart, eventDate) : 0;
        const inheritedDelay = (baselineStart && prevEnd && prevEnd > baselineStart) ? Math.min(totalDelay, getDaysDifference(baselineStart, prevEnd)) : 0;
        newDelayFormed = Math.max(0, totalDelay - inheritedDelay);
      } else {
        const totalDelay = (baselineEnd && eventDate && eventDate > baselineEnd) ? getDaysDifference(baselineEnd, eventDate) : 0;
        const effectiveStart = targetMs.actualStartDate || ((baselineStart && prevEnd && prevEnd > baselineStart) ? prevEnd : baselineStart);
        const startDelay = (baselineStart && effectiveStart && effectiveStart > baselineStart) ? getDaysDifference(baselineStart, effectiveStart) : 0;
        const inheritedDelay = Math.min(totalDelay, startDelay);
        newDelayFormed = Math.max(0, totalDelay - inheritedDelay);
      }

      if (newDelayFormed > 0 && batchModal.selectedLineIds.length > 1) {
        setErrorMessage("When recording a delay, you must update the product lines individually.");
        return;
      }
      if (newDelayFormed > 0 && !batchModal.delayReason.trim()) {
        setErrorMessage("A delay reason is required.");
        return;
      }

      const delayReasonToUse = newDelayFormed > 0 ? batchModal.delayReason.trim() : undefined;
      const delayCategoryToUse = newDelayFormed > 0 ? (batchModal.delayCategory || undefined) : undefined;

      // Validate event date
      const val = validateEventDate({
        milestones: line.milestones,
        index: msIndex,
        eventType,
        eventDate,
        todayStr
      });

      if (!val.ok) {
        errors.push(`${line.productName}: ${val.error}`);
        continue;
      }

      // Auto-accept if not yet accepted
      if (!targetMs.acceptedAt) {
        acceptMilestone({ poId: targetPO.id, productLineId: line.id, milestoneKey: stageKey, user: activeRole });
      }

      itemsToUpdate.push({
        poId: targetPO.id,
        productLineId: line.id,
        milestoneKey: stageKey,
        eventType,
        eventDate,
        user: activeRole,
        docRef: batchModal.docRef || `BATCH-${stageOrder}-${Date.now().toString().slice(-4)}`,
        delayCategory: delayCategoryToUse,
        delayReason: delayReasonToUse
      });
    }

    if (itemsToUpdate.length > 0) {
      const res = batchUpdateMilestoneEvents(itemsToUpdate);
      if (!res.success) {
        errors.push(res.error || 'Batch update failed');
      }
    }

    if (errors.length > 0) {
      setErrorMessage(errors.join('; '));
    } else {
      setSuccessMessage(`Successfully ${eventType === 'start' ? 'started' : 'completed'} stage ${stageTitle} for all ${itemsToUpdate.length} product lines in ${targetPO.poNumber}!`);
      setTimeout(() => setSuccessMessage(null), 5000);

      // If batch completing stage 14 or completing all milestones across all products, prompt order closure
      if (eventType === 'complete' && !targetPO.isClosed) {
        const isOrderComplete = targetPO.productLines.every(l =>
          l.milestones.every(m => m.key === stageKey ? true : (m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100))
        );
        if (isOrderComplete || stageOrder === 14) {
          setTimeout(() => setClosingPO(targetPO), 600);
        }
      }
      setBatchModal(prev => ({ ...prev, isOpen: false }));
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              STAGE {stageOrder} OF 14
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              {responsibleRole}
            </span>
            {!canManageStage && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                VIEW ONLY
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black tracking-tight">{stageTitle}</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">{description}</p>
        </div>

        {/* View Mode Switcher & Search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white/10 p-1 rounded-xl border border-white/15">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'cards' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> PO Groups & Batch
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'matrix' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Stage Matrix Grid
            </button>
          </div>

          <input
            type="text"
            placeholder="Search PO #, Customer, Product..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="px-3.5 py-2 rounded-xl text-xs bg-white/10 text-white placeholder-slate-400 border border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono w-60"
          />
        </div>
      </div>

      {/* KPI Counters Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-400">Active Work Orders</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{totalStagePOs}</div>
          <div className="text-[10px] text-slate-500">{totalStageLines} active lines</div>
        </div>

        <div className="bg-white border border-emerald-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-emerald-800">Action Ready</div>
          <div className="text-xl font-black text-emerald-700 mt-0.5">{totalActionReadyLines}</div>
          <div className="text-[10px] text-emerald-600 font-medium">Ready for input</div>
        </div>

        <div className="bg-white border border-blue-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-blue-700">In Execution</div>
          <div className="text-xl font-black text-blue-800 mt-0.5">{totalStartedLines}</div>
          <div className="text-[10px] text-blue-600">Active on stage</div>
        </div>

        <div className="bg-white border border-rose-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-rose-700">Delayed / Variance</div>
          <div className="text-xl font-black text-rose-800 mt-0.5">{totalDelayedLines}</div>
          <div className="text-[10px] text-rose-600 font-medium">Schedule variance</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-500">Stage Completed</div>
          <div className="text-xl font-black text-emerald-800 mt-0.5">{totalCompletedLines}</div>
          <div className="text-[10px] text-slate-500">{completedPOGroups.length} POs passed</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-400">Assigned Role</div>
          <div className="text-xs font-bold text-slate-800 line-clamp-1">{responsibleRole}</div>
          <div className="text-[10px] font-mono text-emerald-700 font-semibold">{canManageStage ? 'Authorized' : 'Read-Only'}</div>
        </div>
      </div>

      {/* Actionable Feedback Banners */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs flex items-center gap-3 font-semibold shadow-2xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-300 text-rose-900 rounded-xl text-xs flex items-center gap-3 font-semibold shadow-2xs">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Filter Tabs - Defaults to Clean Active Work Queue */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterTab('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              filterTab === 'active'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            Active Orders ({activePOGroups.length})
          </button>

          <button
            onClick={() => setFilterTab('ready')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterTab === 'ready'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white text-emerald-800 hover:bg-emerald-50 border border-emerald-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            Ready for Action ({activePOGroups.filter(g => g.readyToStartLines > 0 || g.readyToCompleteLines > 0).length})
          </button>

          <button
            onClick={() => setFilterTab('in_progress')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              filterTab === 'in_progress'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-white text-blue-800 hover:bg-blue-50 border border-blue-200'
            }`}
          >
            In Execution ({activePOGroups.filter(g => g.startedLines > 0).length})
          </button>

          <button
            onClick={() => setFilterTab('delayed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterTab === 'delayed'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'bg-white text-rose-800 hover:bg-rose-50 border border-rose-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            Delayed ({activePOGroups.filter(g => g.hasDelay).length})
          </button>

          <button
            onClick={() => setFilterTab('completed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterTab === 'completed'
                ? 'bg-emerald-900 text-white shadow-xs'
                : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Archive className="w-3.5 h-3.5 text-slate-400" />
            Completed Archive ({completedPOGroups.length})
          </button>
        </div>

        <div className="text-xs text-slate-500 font-mono">
          Showing {filteredPOGroups.length} PO(s)
        </div>
      </div>

      {/* VIEW MODE 1: PO-GROUPED CARDS WITH BATCH ACTIONS */}
      {viewMode === 'cards' && (
        <div className="space-y-5">
          {filteredPOGroups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
              {filterTab === 'completed' 
                ? `No completed orders found for stage ${stageTitle}.`
                : `No active orders currently pending action for stage ${stageTitle}. All active work is up to date!`
              }
            </div>
          ) : (
            filteredPOGroups.map(group => {
              const po = group.po;
              const defaultOpen = false;
              const isExpanded = isPOExpanded(po.id, defaultOpen);
              const showCompletedLines = Boolean(showCompletedLinesInCard[po.id]);
              const hasDelayedProducts = group.delayedLines > 0;
              const delayedProductNames = group.lines.filter(l => l.isDelayed).map(l => `${l.line.productName} (+${l.milestone.varianceDays || 0}d)`);

              // Separate active lines and completed lines to avoid clumsy congestion
              const activeLines = group.lines.filter(l => !l.isDone);
              const completedLines = group.lines.filter(l => l.isDone);
              const linesToDisplay = showCompletedLines ? group.lines : (activeLines.length > 0 ? activeLines : completedLines);

              return (
                <div
                  key={po.id}
                  className={`bg-white border rounded-2xl shadow-xs transition-all overflow-hidden ${
                    group.isAllCompleted
                      ? 'border-emerald-200 bg-emerald-50/10'
                      : hasDelayedProducts
                      ? 'border-rose-200/80'
                      : group.startedLines > 0
                      ? 'border-blue-200/80'
                      : 'border-slate-200'
                  }`}
                >
                  {/* PO Accordion Header */}
                  <div className="p-4 sm:p-5 bg-slate-50/70 border-b border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    
                    {/* Left: PO & Customer Info */}
                    <div className="flex items-start sm:items-center gap-3">
                      <button
                        onClick={() => togglePOExpand(po.id, defaultOpen)}
                        className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 cursor-pointer mt-0.5 sm:mt-0 transition-colors"
                        title={isExpanded ? 'Collapse Product Lines' : 'Expand Product Lines'}
                      >
                        {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-700" /> : <ChevronRight className="w-5 h-5 text-slate-700" />}
                      </button>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-black text-sm text-emerald-900 bg-emerald-100/70 px-2.5 py-0.5 rounded-lg border border-emerald-300">
                            {po.poNumber}
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="font-bold text-slate-900 text-sm sm:text-base">{po.customerName}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 text-slate-700 border border-slate-300">
                            {group.totalLines} Product Line{group.totalLines > 1 ? 's' : ''}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1 font-mono">
                          <span>PO Date: <strong className="text-slate-700">{po.poDate}</strong></span>
                          <span>Delivery Due: <strong className="text-emerald-800">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong></span>
                          <span>Stage Progress: <strong className={group.isAllCompleted ? 'text-emerald-700' : hasDelayedProducts ? 'text-rose-700' : 'text-slate-800'}>
                            {group.completedLines}/{group.totalLines} Lines Passed
                          </strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Rollup Progress & Batch Action Controls */}
                    <div className="flex flex-wrap items-center gap-2.5 self-end lg:self-center">
                      
                      {/* Rollup Badges */}
                      <div className="flex items-center gap-1.5">
                        {group.completedLines > 0 && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            {group.completedLines}/{group.totalLines} Done
                          </span>
                        )}
                        {group.startedLines > 0 && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-blue-100 text-blue-800 border border-blue-300">
                            {group.startedLines} In Execution
                          </span>
                        )}
                        {hasDelayedProducts && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                            Delayed
                          </span>
                        )}
                        {group.lockedLines > 0 && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                            <Lock className="w-3 h-3 text-amber-700" />
                            {group.lockedLines} Locked
                          </span>
                        )}
                      </div>

                      {/* CLOSE ORDER BUTTON FOR FINISHED MULTI-PRODUCT ORDERS (PM / PM Baseline only) */}
                      {(activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)') && po.productLines.length > 0 && po.productLines.every(l => l.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)) && !po.isClosed && (
                        <button
                          onClick={() => setClosingPO(po)}
                          className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-md flex items-center gap-1.5 animate-pulse"
                          title="All stages finished across all product lines. Close and archive order."
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          Close Order (100% Done)
                        </button>
                      )}

                      {/* BATCH ACTION BUTTONS FOR AUTHORIZED ROLE */}
                      {canManageStage && !group.isAllCompleted && (
                        <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                          {group.readyToStartLines > 0 && (
                            <button
                              onClick={() => openBatchModal(group, 'start')}
                              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1.5"
                              title="Start this stage for all ready product lines in one click"
                            >
                              <Play className="w-3 h-3 fill-current text-emerald-400" />
                              Batch Start ({group.readyToStartLines})
                            </button>
                          )}

                          {group.lines.some(l => l.isPrereqDone && !l.isDone) && (
                            <button
                              onClick={() => openBatchModal(group, 'complete')}
                              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1.5"
                              title="Complete this stage for all ready lines in one click"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Batch Complete ({group.lines.filter(l => l.isPrereqDone && !l.isDone).length})
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Isolated Bottleneck Notice for Multi-Product Clarity */}
                  {hasDelayedProducts && group.lines.length > 1 && (
                    <div className="px-5 py-2.5 bg-rose-50/80 border-b border-rose-200/80 text-rose-950 text-xs flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>
                          <strong className="font-bold text-rose-900">Multi-Product Delay:</strong> <strong className="text-rose-900 underline">{delayedProductNames.join(', ')}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Product Lines List inside PO Accordion */}
                  {isExpanded && (
                    <div className="p-4 sm:p-5 space-y-4 bg-white">
                      
                      {/* Bold Root Cause Delay & Multi-Stage Waterfall Breakdown */}
                      {(hasDelayedProducts || po.status === 'Delayed' || po.productLines.some(l => (l.overallVarianceDays || 0) > 0)) && (
                        <DelayAnalysisFlow po={po} className="border-rose-200 shadow-sm" />
                      )}
                      
                      {/* Sub-header inside card: Toggle between Active Lines only vs All Lines */}
                      {group.completedLines > 0 && activeLines.length > 0 && (
                        <div className="flex items-center justify-between text-xs text-slate-500 pb-1 border-b border-slate-100">
                          <span className="font-semibold text-slate-700">
                            Showing {activeLines.length} active line(s) awaiting this stage
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleShowCompletedLines(po.id)}
                            className="text-[11px] font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1 cursor-pointer"
                          >
                            {showCompletedLines ? (
                              <>
                                <EyeOff className="w-3.5 h-3.5 text-slate-400" /> Hide {completedLines.length} Completed Line(s)
                              </>
                            ) : (
                              <>
                                <Eye className="w-3.5 h-3.5 text-emerald-600" /> View {completedLines.length} Completed Line(s)
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {linesToDisplay.map(({ line, milestone, isPrereqDone, isDone, isStarted }, lineIdx) => {
                        const entryKey = `${po.id}-${line.id}-${milestone.id}`;
                        const isEditing = editingKey === entryKey;

                        const msIndex = (line.milestones || []).findIndex(m => m.id === milestone.id || m.key === milestone.key);
                        const prevMilestone = msIndex > 0 ? (line.milestones || [])[msIndex - 1] : null;

                        const currVar = Math.max(0, typeof milestone.varianceDays === 'number' ? milestone.varianceDays : 0);
                        const prevVar = prevMilestone ? Math.max(0, typeof prevMilestone.varianceDays === 'number' ? prevMilestone.varianceDays : 0) : 0;
                        const stageDelta = Math.max(0, currVar - prevVar);
                        const isNewDelayHere = stageDelta > 0;
                        const hasInheritedShift = currVar > 0 && !isNewDelayHere;
                        const recoveredDays = isDone ? Math.max(0, prevVar - currVar) : 0;

                        const bStart = milestone.committedBaselineStartDate || po.poDate;
                        const bEnd = milestone.committedBaselineEndDate || po.committedDeliveryDate;
                        const isStartLate = Boolean(formData.startDate && formData.startDate > bStart);
                        const isEndLate = Boolean(formData.endDate && formData.endDate > bEnd);

                        const prevEffectiveEnd = prevMilestone ? (prevMilestone.actualEndDate || prevMilestone.forecastEndDate) : undefined;
                        const prevBaselineEnd = prevMilestone?.committedBaselineEndDate;
                        const activeInheritedDelay = (prevEffectiveEnd && prevBaselineEnd && prevEffectiveEnd > prevBaselineEnd)
                          ? getDaysDifference(prevBaselineEnd, prevEffectiveEnd)
                          : 0;

                        const isCardDelayed = isEditing && (
                          isEndLate ||
                          (!formData.endDate && isStartLate)
                        );
                        const cardDelayDays = isCardDelayed
                          ? (isEndLate
                              ? getDaysDifference(bEnd, formData.endDate)
                              : getDaysDifference(bStart, formData.startDate))
                          : 0;

                        return (
                          <div
                            key={entryKey}
                            className={`p-4 rounded-xl border transition-all ${
                              isDone
                                ? 'bg-emerald-50/20 border-emerald-200'
                                : !isPrereqDone
                                ? 'bg-amber-50/15 border-amber-200/70'
                                : isStarted
                                ? 'bg-blue-50/20 border-blue-200'
                                : isNewDelayHere
                                ? 'bg-rose-50/20 border-rose-200'
                                : 'bg-slate-50/50 border-slate-200'
                            }`}
                          >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                              
                              {/* Product Line Details */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-xs text-slate-500">#{lineIdx + 1}</span>
                                  <span className="font-bold text-slate-900 text-sm">{line.productName}</span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-50 text-purple-800 border border-purple-200">
                                    {line.designType}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                    Qty: {line.qty} Pcs
                                  </span>
                                </div>

                                {(() => {
                                  const linePlanStart = milestone.committedBaselineStartDate || po.poDate;
                                  const linePlanEnd = milestone.committedBaselineEndDate || po.committedDeliveryDate;
                                  const lineDur = Math.max(1, milestone.committedDurationDays || 1);
                                  const linePlanDuration = (linePlanStart && linePlanEnd) ? Math.max(1, getDaysDifference(linePlanStart, linePlanEnd)) : lineDur;

                                  const linePrevActualEnd = prevMilestone?.actualEndDate;
                                  const linePrevEffectiveEnd = linePrevActualEnd || prevMilestone?.forecastEndDate;
                                  const lineHasPrevDelayShift = Boolean(linePlanStart && linePrevEffectiveEnd && linePrevEffectiveEnd > linePlanStart);
                                  const lineShiftDays = (lineHasPrevDelayShift && linePlanStart && linePrevEffectiveEnd) ? getDaysDifference(linePlanStart, linePrevEffectiveEnd) : 0;

                                  const lineRevStart = milestone.actualStartDate || (lineHasPrevDelayShift ? linePrevEffectiveEnd : linePlanStart);
                                  const lineRevEnd = milestone.actualEndDate || (lineShiftDays > 0 && lineRevStart ? addDays(lineRevStart, linePlanDuration) : linePlanEnd);

                                  return (
                                    <div className="space-y-1 text-xs font-mono mt-1">
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
                                        <span>Planned Baseline: <strong className="text-slate-800">{linePlanStart} &rarr; {linePlanEnd}</strong> ({linePlanDuration}d planned)</span>
                                        {lineShiftDays > 0 ? (
                                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded border bg-amber-50 text-amber-800 border-amber-200">
                                            +{lineShiftDays}d shift from Stage {prevMilestone?.stageOrder || 'previous'} delay
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
                                            On original baseline
                                          </span>
                                        )}
                                      </div>
                                      {lineShiftDays > 0 && (
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-amber-900">
                                          <span className="text-amber-800">Revised Target: <strong className="text-amber-950">{lineRevStart} &rarr; {lineRevEnd}</strong></span>
                                          <span className="text-[10px] text-amber-700 font-medium">Starts with prev end date ({linePrevEffectiveEnd})</span>
                                        </div>
                                      )}
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                                        {milestone.actualStartDate && (
                                          <span className="text-blue-700">Actual Start: <strong className="text-blue-900">{milestone.actualStartDate}</strong></span>
                                        )}
                                        {milestone.actualEndDate && (
                                          <span className="text-emerald-700">Actual End: <strong className="text-emerald-900">{milestone.actualEndDate}</strong></span>
                                        )}
                                        {milestone.docRef && (
                                          <span className="text-slate-600">Doc: <strong>{milestone.docRef}</strong></span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Status Badge & Single Line Action Buttons */}
                              <div className="flex items-center gap-2 shrink-0">
                                {!isPrereqDone ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                                    <Lock className="w-3 h-3 text-amber-700" />
                                    Pending Stage {prevMilestone?.stageOrder}
                                  </span>
                                ) : isDone ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                    {isNewDelayHere 
                                      ? `Completed (+${stageDelta}d delay added)` 
                                      : currVar > 0 
                                      ? (recoveredDays > 0 
                                          ? `Completed (${recoveredDays === 1 ? '1 day' : `${recoveredDays} days`} delay resolved, Previous: +${currVar}d)` 
                                          : `Completed (Previous: +${currVar}d)`)
                                      : recoveredDays > 0 
                                      ? `Completed (${recoveredDays === 1 ? '1 day' : `${recoveredDays} days`} delay resolved)` 
                                      : 'Completed'}
                                  </span>
                                ) : isStarted ? (
                                  <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                                    isNewDelayHere ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-blue-100 text-blue-800 border-blue-300'
                                  }`}>
                                    {isNewDelayHere ? `In Execution (+${stageDelta}d delay added)` : hasInheritedShift ? `In Execution (Previous: +${currVar}d)` : 'In Execution'}
                                  </span>
                                ) : isNewDelayHere ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300">
                                    Delay (+{stageDelta}d)
                                  </span>
                                ) : hasInheritedShift ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                    Previous (+{currVar}d)
                                  </span>
                                ) : (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                    Ready to Start
                                  </span>
                                )}

                                {/* WORKING ACTION BUTTONS */}
                                {canManageStage && isPrereqDone && !isDone && (
                                  <div className="flex items-center gap-1.5">
                                    {!milestone.actualStartDate ? (
                                      <>
                                        <button
                                          onClick={() => openLineModal(po, line, 'start')}
                                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1"
                                          title="Select start date & begin stage"
                                        >
                                          <Play className="w-3.5 h-3.5 fill-current text-emerald-400" /> Start Stage...
                                        </button>
                                        <button
                                          onClick={() => openLineModal(po, line, 'complete')}
                                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                                          title="Select completion date & record finish directly"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete...
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => openLineModal(po, line, 'start')}
                                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1"
                                          title="Edit recorded start date"
                                        >
                                          <Edit3 className="w-3 h-3 text-slate-500" /> Edit Start
                                        </button>
                                        <button
                                          onClick={() => openLineModal(po, line, 'complete')}
                                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                                          title="Select completion date & record finish"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete...
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}

                                {canManageStage && isDone && !isEditing && (
                                  <button
                                    onClick={() => handleStartEdit(entryKey, milestone)}
                                    className="px-2.5 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Review or edit recorded dates"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" /> Edit
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Delay Reason Tag - only shown for genuine delays originating at this stage, never for inherited/cascaded shifts */}
                            {isNewDelayHere && milestone.delayReason && !milestone.delayReason.startsWith('Cascaded') && !milestone.delayReason.startsWith('Inherited') && (
                              <div className="mt-2.5 p-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-1.5 font-medium">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span><strong>Delay Reason:</strong> {milestone.delayReason}</span>
                              </div>
                            )}

                            {/* Inline Edit Form for Single Line */}
                            {isEditing && (() => {
                              const msPlanStart = milestone.committedBaselineStartDate || po.poDate;
                              const msPlanEnd = milestone.committedBaselineEndDate || po.committedDeliveryDate;
                              const dur = Math.max(1, milestone.committedDurationDays || 1);
                              const msPlanDuration = (msPlanStart && msPlanEnd) ? Math.max(1, getDaysDifference(msPlanStart, msPlanEnd)) : dur;

                              const prevEffectiveEnd = prevMilestone ? (prevMilestone.actualEndDate || prevMilestone.forecastEndDate) : undefined;
                              const msRevStart = milestone.actualStartDate || ((msPlanStart && prevEffectiveEnd && prevEffectiveEnd > msPlanStart) ? prevEffectiveEnd : msPlanStart);
                              const msStartShift = (msPlanStart && msRevStart && msRevStart > msPlanStart) ? getDaysDifference(msPlanStart, msRevStart) : 0;
                              const msRevEnd = msStartShift > 0 && msRevStart ? addDays(msRevStart, msPlanDuration) : msPlanEnd;

                              return (
                                <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono flex items-center gap-1.5">
                                      <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                                      Update Stage Dates for {line.productName}
                                    </div>
                                    <span className="font-mono text-[10px] font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                                      {msPlanDuration} days planned
                                    </span>
                                  </div>

                                  <div className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1 text-xs font-mono">
                                    <div className="flex items-center justify-between text-slate-600 text-[11px]">
                                      <span>Planned Baseline: <strong className="text-slate-800">{msPlanStart} &rarr; {msPlanEnd}</strong></span>
                                      <span className="text-[10px] text-slate-500 font-semibold">{msPlanDuration} days planned</span>
                                    </div>
                                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                                      <span className={msStartShift > 0 ? "text-amber-800" : "text-emerald-700"}>
                                        Revised Target: <strong className={msStartShift > 0 ? "text-amber-950" : "text-emerald-900"}>{msRevStart} &rarr; {msRevEnd}</strong>
                                      </span>
                                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                        msStartShift > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                                      }`}>
                                        {msStartShift > 0 ? `+${msStartShift}d shift from previous delay` : 'On original baseline'}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                      Stage Start Date {milestone.actualStartDate ? '(Actual)' : '(Target / Actual)'}
                                    </label>
                                    <input
                                      type="date"
                                      min={stageOrder === 1 ? addDays(todayStr, -7) : (prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate || undefined)}
                                      value={formData.startDate}
                                      onChange={e => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                      Stage End Date (Target / Actual)
                                    </label>
                                    <input
                                      type="date"
                                      min={formData.startDate || prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate || undefined}
                                      value={formData.endDate}
                                      onChange={e => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                    />
                                  </div>
                                </div>

                                {isCardDelayed && (
                                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-2.5 text-xs">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5 font-bold text-amber-900">
                                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                                        <span>Schedule Delay Detected (+{cardDelayDays}d late vs baseline target)</span>
                                      </div>
                                      {(() => {
                                        const netInheritedDelay = activeInheritedDelay;
                                        if (netInheritedDelay <= 0) return null;

                                        const prevMilestones = (line.milestones || []).slice(0, msIndex);
                                        const prevLineDelays = prevMilestones
                                          .map(m => {
                                            let days = 0;
                                            if (m.actualEndDate && m.committedBaselineEndDate) {
                                              days = Math.max(0, getDaysDifference(m.committedBaselineEndDate, m.actualEndDate));
                                            } else if (typeof m.varianceDays === 'number' && m.varianceDays > 0) {
                                              days = m.varianceDays;
                                            }
                                            return { ...m, calculatedDelayDays: days };
                                          })
                                          .filter(m => m.calculatedDelayDays > 0);

                                        return (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const breakdown = prevLineDelays.map(d => `Stage ${d.stageOrder}: +${d.calculatedDelayDays}d`).join(', ');
                                              const summaryText = `Inherited delay: +${netInheritedDelay}d${breakdown ? ` (${breakdown})` : ''}`;
                                              setFormData(prev => ({
                                                ...prev,
                                                delayReason: mergeDelayReason(prev.delayReason, summaryText),
                                                delayCategory: prev.delayCategory || prevLineDelays[prevLineDelays.length - 1]?.delayCategory || ''
                                              }));
                                            }}
                                            className="text-[10px] text-emerald-900 bg-white hover:bg-emerald-50 border border-emerald-300 font-bold px-2 py-0.5 rounded cursor-pointer transition-colors shadow-2xs"
                                          >
                                            Append Previous Delays (+{netInheritedDelay}d)
                                          </button>
                                        );
                                      })()}
                                    </div>

                                    {(() => {
                                      if (activeInheritedDelay <= 0) return null;
                                      const prevMilestones = (line.milestones || []).slice(0, msIndex);
                                      const prevLineDelays = prevMilestones
                                        .map((m, mIdx) => {
                                          const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                                          const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                                          const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                                          const stageDelta = currVar - prevVar;
                                          return { ...m, calculatedDelayDays: stageDelta };
                                        })
                                        .filter(m => m.calculatedDelayDays > 0);

                                      if (prevLineDelays.length === 0) return null;

                                      return (
                                        <div className="p-2 bg-amber-100/60 border border-amber-200/80 rounded-lg space-y-0.5 text-[10px] font-mono text-amber-900">
                                          <div className="font-bold text-amber-950">Preceding Delay Sources:</div>
                                          {prevLineDelays.map((d, i) => (
                                            <div key={i} className="truncate">
                                              • Stage {d.stageOrder}: {d.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.calculatedDelayDays}d Delay Added</strong>
                                              {d.delayReason && <span className="text-slate-600 font-normal"> — {d.delayReason}</span>}
                                            </div>
                                          ))}
                                          <div className="pt-0.5 font-bold text-amber-950 border-t border-amber-200/60 flex justify-between">
                                            <span>Total Cumulative Delay:</span>
                                            <span className="text-rose-700">+{activeInheritedDelay}d</span>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-[10px] font-bold text-amber-900 mb-1">
                                          Delay Category <span className="text-slate-400 font-normal">(Optional)</span>
                                        </label>
                                        <select
                                          value={formData.delayCategory}
                                          onChange={e => setFormData(prev => ({ ...prev, delayCategory: e.target.value as DelayCategory }))}
                                          className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs bg-white"
                                        >
                                          <option value="">Select Category (Optional)...</option>
                                          {prevMilestone && <option value="Internal">Preceding Stage Delay ({prevMilestone.name})</option>}
                                          <option value="Customer">Customer Dependency</option>
                                          <option value="Supplier">Supplier Delay</option>
                                          <option value="Internal">Internal Resource Deficit</option>
                                          <option value="Design">Technical / Design Complexity</option>
                                          <option value="Production">Production / Inspection Hold</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-bold text-amber-900 mb-1">
                                          Delay Reason <span className="text-slate-400 font-normal">(Optional)</span>
                                        </label>
                                        <input
                                          type="text"
                                          placeholder="Enter delay justification (Optional)..."
                                          value={formData.delayReason}
                                          onChange={e => setFormData(prev => ({ ...prev, delayReason: e.target.value }))}
                                          className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs bg-white"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}

                                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                                  <button
                                    type="button"
                                    onClick={() => setEditingKey(null)}
                                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  {!milestone.actualStartDate ? (
                                    <button
                                      type="button"
                                      onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, false)}
                                      className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1 shadow-2xs"
                                    >
                                      <Play className="w-3 h-3 fill-current" /> Save & Start Stage
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, false)}
                                      className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg cursor-pointer flex items-center gap-1"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" /> Save Start Date
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, true)}
                                    className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer shadow-xs flex items-center gap-1"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete
                                  </button>
                                </div>
                              </div>
                            );
                          })()}

                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW MODE 2: HIGH-DENSITY STAGE MATRIX GRID */}
      {viewMode === 'matrix' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm text-slate-900">Multi-Product Manufacturing Matrix</h2>
              <p className="text-xs text-slate-500 mt-0.5">High-density grid view of all 14 stages across every product line. Spotlighted on <strong className="text-emerald-800">{stageTitle}</strong>.</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Completed</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> In Progress</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Delayed</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span> Pending</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] font-mono">
                  <th className="py-3 px-3 min-w-44 sticky left-0 bg-slate-100/95 z-10">PO & Customer</th>
                  <th className="py-3 px-3 min-w-44">Product Line</th>
                  <th className="py-3 px-2 text-center">Qty</th>
                  {ALL_14_STAGES.map((st) => {
                    const isCurrentStageCol = st.key === stageKey;
                    return (
                      <th
                        key={st.key}
                        className={`py-3 px-2 text-center text-[10px] whitespace-nowrap ${
                          isCurrentStageCol ? 'bg-emerald-100 text-emerald-950 font-black border-x border-emerald-300' : ''
                        }`}
                      >
                        {st.label}
                      </th>
                    );
                  })}
                  <th className="py-3 px-3 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredPOGroups.flatMap(group =>
                  group.lines.map(({ line, milestone, isPrereqDone, isDone }) => {
                    const po = group.po;
                    const entryKey = `${po.id}-${line.id}-${milestone.id}`;

                    return (
                      <tr key={entryKey} className="hover:bg-slate-50 transition-colors">
                        {/* PO & Customer Column */}
                        <td className="py-2.5 px-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100">
                          <div className="font-mono font-bold text-xs text-emerald-800">{po.poNumber}</div>
                          <div className="text-[11px] text-slate-600 truncate max-w-40" title={po.customerName}>{po.customerName}</div>
                        </td>

                        {/* Product Line */}
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          <div className="truncate max-w-44" title={line.productName}>{line.productName}</div>
                          <div className="text-[10px] font-mono text-slate-400">{line.designType}</div>
                        </td>

                        {/* Qty */}
                        <td className="py-2.5 px-2 text-center font-mono text-slate-600 font-bold">
                          {line.qty}
                        </td>

                        {/* 14 Stages Chips */}
                        {ALL_14_STAGES.map((st, sIdx) => {
                          const ms = (line.milestones || []).find(m => m.key === st.key);
                          const isStageDone = ms?.status === 'Completed' || Boolean(ms?.actualEndDate);
                          const isStageStarted = Boolean(ms?.actualStartDate) && !isStageDone;
                          const isStageDelayed = ms?.status === 'Delayed' || (typeof ms?.varianceDays === 'number' && ms.varianceDays > 0);
                          const isCurrentStageCol = st.key === stageKey;

                          return (
                            <td
                              key={st.key}
                              className={`py-2 px-1 text-center ${
                                isCurrentStageCol ? 'bg-emerald-50/50 border-x border-emerald-200' : ''
                              }`}
                            >
                              <span
                                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-mono font-bold transition-transform hover:scale-110 cursor-pointer ${
                                  isStageDone
                                    ? 'bg-emerald-600 text-white shadow-2xs'
                                    : isStageStarted
                                    ? isStageDelayed
                                      ? 'bg-blue-600 text-white ring-2 ring-rose-400'
                                      : 'bg-blue-600 text-white ring-2 ring-blue-300'
                                    : isStageDelayed
                                    ? 'bg-rose-500 text-white ring-1 ring-rose-300'
                                    : 'bg-slate-200 text-slate-500'
                                }`}
                                title={`${st.label}: ${ms?.status || 'Pending'} (${ms?.actualEndDate || ms?.forecastEndDate || 'Planned'})`}
                              >
                                {isStageDone ? 'Done' : isStageStarted ? 'In Prog' : isStageDelayed ? 'Delay' : sIdx + 1}
                              </span>
                            </td>
                          );
                        })}

                        {/* Quick Action Button */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {canManageStage && isPrereqDone && !isDone && (
                            <div className="flex items-center justify-end gap-1">
                              {!milestone.actualStartDate ? (
                                <button
                                  onClick={() => openLineModal(po, line, 'start')}
                                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg cursor-pointer shadow-2xs flex items-center gap-1"
                                >
                                  <Play className="w-2.5 h-2.5 fill-current" /> Start
                                </button>
                              ) : (
                                <button
                                  onClick={() => openLineModal(po, line, 'complete')}
                                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg cursor-pointer shadow-2xs flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Complete
                                </button>
                              )}
                            </div>
                          )}
                          {isDone && (
                            <span className="text-[11px] font-mono font-bold text-emerald-700">Done</span>
                          )}
                          {!isPrereqDone && (
                            <span className="text-[11px] font-mono text-amber-700">Locked</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ACTION & DATE PROMPT MODAL */}
      {batchModal.isOpen && batchModal.po && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden space-y-4 text-slate-800">
            
            {/* Modal Header */}
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono font-bold uppercase text-emerald-400 tracking-wider">
                  STAGE EXECUTION • STAGE {stageOrder} OF 14 ({stageTitle})
                </div>
                <h3 className="text-lg font-black mt-0.5">
                  {batchModal.selectedLineIds.length === 1 ? (
                    batchModal.mode === 'start' ? 'Record Actual Start Date' : 'Record Actual Completion Date'
                  ) : (
                    batchModal.mode === 'start' ? 'Batch Record Start Date' : 'Batch Record Stage Completion'
                  )}
                </h3>
                <p className="text-xs text-slate-300">
                  {batchModal.po.poNumber} — {batchModal.po.customerName}
                </p>
              </div>

              <button
                onClick={() => setBatchModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-xs">
              
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Product Lines Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                    {batchModal.selectedLineIds.length === 1 
                      ? 'Target Product Line' 
                      : `Select Product Lines to Apply (${batchModal.selectedLineIds.length}/${batchModal.po.productLines.length})`
                    }
                  </label>
                  {batchModal.po.productLines.length > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBatchModal(prev => ({
                          ...prev,
                          selectedLineIds: batchModal.po?.productLines.filter(l => isPrereqComplete(l, stageKey)).map(l => l.id) || []
                        }))}
                        className="text-[10px] text-emerald-700 hover:text-emerald-900 font-bold underline cursor-pointer"
                      >
                        Select All Ready
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => setBatchModal(prev => ({ ...prev, selectedLineIds: [] }))}
                        className="text-[10px] text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-3 bg-slate-50">
                  {batchModal.po.productLines.map((line, idx) => {
                    const isPrereqDone = isPrereqComplete(line, stageKey);
                    const ms = line.milestones.find(m => m.key === stageKey);
                    const isDone = ms?.status === 'Completed' || Boolean(ms?.actualEndDate);
                    const isChecked = batchModal.selectedLineIds.includes(line.id);

                    return (
                      <label
                        key={line.id}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${
                          !isPrereqDone ? 'opacity-50 bg-slate-100 border-slate-200 cursor-not-allowed' :
                          isChecked ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold' :
                          'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            disabled={!isPrereqDone}
                            checked={isChecked}
                            onChange={e => {
                              if (e.target.checked) {
                                setBatchModal(prev => ({ ...prev, selectedLineIds: [...prev.selectedLineIds, line.id] }));
                              } else {
                                setBatchModal(prev => ({ ...prev, selectedLineIds: prev.selectedLineIds.filter(id => id !== line.id) }));
                              }
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>#{idx + 1} {line.productName} ({line.designType}) — Qty: {line.qty}</span>
                        </div>

                        <span className="text-[10px] font-mono">
                          {!isPrereqDone ? 'Locked' : isDone ? 'Completed' : ms?.actualStartDate ? 'In Progress' : 'Ready'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Date Inputs */}
              <div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {batchModal.mode === 'start' ? 'Actual Start Date' : 'Actual Completion Date'} <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={batchModal.date}
                    onChange={e => setBatchModal(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-mono font-bold text-slate-800 focus:border-emerald-600"
                  />
                  {(() => {
                    const sampleLine = batchModal.po.productLines[0];
                    const sampleMs = sampleLine?.milestones.find(m => m.key === stageKey);
                    const msPlanStart = sampleMs?.committedBaselineStartDate || batchModal.po.poDate;
                    const msPlanEnd = sampleMs?.committedBaselineEndDate || batchModal.po.committedDeliveryDate;
                    const msPlanDuration = sampleMs?.committedDurationDays || (msPlanStart && msPlanEnd ? getDaysDifference(msPlanStart, msPlanEnd) : 1);

                    const sampleMsIdx = sampleLine ? sampleLine.milestones.findIndex(m => m.key === stageKey) : -1;
                    const samplePrevMs = sampleMsIdx > 0 ? sampleLine.milestones[sampleMsIdx - 1] : null;
                    const samplePrevEnd = samplePrevMs?.actualEndDate || samplePrevMs?.forecastEndDate;
                    const sampleStartDelay = (msPlanStart && samplePrevEnd && samplePrevEnd > msPlanStart)
                      ? getDaysDifference(msPlanStart, samplePrevEnd)
                      : 0;

                    const msRevStart = sampleStartDelay > 0 && samplePrevEnd ? samplePrevEnd : msPlanStart;
                    const msRevEnd = sampleStartDelay > 0 ? addDays(msRevStart, msPlanDuration) : msPlanEnd;

                    return (
                      <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1 font-mono text-[11px]">
                        <div className="flex items-center justify-between text-slate-600">
                          <span>Planned Baseline: <strong className="text-slate-800">{msPlanStart} &rarr; {msPlanEnd}</strong></span>
                          <span className="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {msPlanDuration} days planned
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                          <span className={sampleStartDelay > 0 ? "text-amber-800" : "text-emerald-700"}>
                            Revised Target: <strong className={sampleStartDelay > 0 ? "text-amber-950" : "text-emerald-900"}>{msRevStart} &rarr; {msRevEnd}</strong>
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                            sampleStartDelay > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                          }`}>
                            {sampleStartDelay > 0 ? `+${sampleStartDelay}d shift from previous delay` : 'On original baseline'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Delay Reason & Previous Delays Section */}
              {(() => {
                const selectedLines = batchModal.po ? batchModal.po.productLines.filter(l => batchModal.selectedLineIds.includes(l.id)) : [];
                
                const allPreviousDelays = selectedLines.flatMap(l => {
                  const idx = (l.milestones || []).findIndex(m => m.key === stageKey);
                  const preceding = (l.milestones || []).slice(0, idx);
                  return preceding.map((m, mIdx) => {
                    const prevM = mIdx > 0 ? preceding[mIdx - 1] : null;
                    const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                    const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                    const stageDelta = currVar - prevVar;
                    return {
                      lineName: l.productName,
                      stageOrder: m.stageOrder,
                      stageName: m.name,
                      addedDelayDays: stageDelta,
                      delayReason: m.delayReason
                    };
                  }).filter(m => m.addedDelayDays > 0);
                });

                const stageMap = new Map<number, { stageOrder: number; stageName: string; addedDelay: number; delayReason?: string }>();
                allPreviousDelays.forEach(d => {
                  const existing = stageMap.get(d.stageOrder);
                  if (!existing) {
                    stageMap.set(d.stageOrder, {
                      stageOrder: d.stageOrder,
                      stageName: d.stageName,
                      addedDelay: d.addedDelayDays,
                      delayReason: d.delayReason
                    });
                  } else {
                    existing.addedDelay = Math.max(existing.addedDelay, d.addedDelayDays);
                  }
                });

                let maxTotalDelay = 0;
                let maxNetInheritedDelay = 0;
                let maxNewDelayFormed = 0;

                selectedLines.forEach(l => {
                  const mIdx = (l.milestones || []).findIndex(ms => ms.key === stageKey);
                  const ms = l.milestones[mIdx];
                  if (!ms) return;
                  const prevM = mIdx > 0 ? l.milestones[mIdx - 1] : null;
                  const prevEnd = prevM?.actualEndDate || prevM?.forecastEndDate;

                  const baselineStart = ms.committedBaselineStartDate || batchModal.po?.poDate;
                  const baselineEnd = ms.committedBaselineEndDate || batchModal.po?.committedDeliveryDate;

                  if (batchModal.mode === 'start') {
                    // Strictly: delay exists whenever start date exceeds baseline start date!
                    const totalDelay = (baselineStart && batchModal.date && batchModal.date > baselineStart)
                      ? getDaysDifference(baselineStart, batchModal.date)
                      : 0;
                    // Inherited delay from previous milestone pushing this stage's start date
                    const inheritedDelay = (baselineStart && prevEnd && prevEnd > baselineStart)
                      ? Math.min(totalDelay, getDaysDifference(baselineStart, prevEnd))
                      : 0;
                    const newDelay = Math.max(0, totalDelay - inheritedDelay);

                    if (totalDelay > maxTotalDelay) maxTotalDelay = totalDelay;
                    if (inheritedDelay > maxNetInheritedDelay) maxNetInheritedDelay = inheritedDelay;
                    if (newDelay > maxNewDelayFormed) maxNewDelayFormed = newDelay;
                  } else {
                    // Strictly: delay exists whenever completion date exceeds planned baseline end date! Even 1 date after plan is delay!
                    const totalDelay = (baselineEnd && batchModal.date && batchModal.date > baselineEnd)
                      ? getDaysDifference(baselineEnd, batchModal.date)
                      : 0;
                    const effectiveStart = ms.actualStartDate || ((baselineStart && prevEnd && prevEnd > baselineStart) ? prevEnd : baselineStart);
                    const startDelay = (baselineStart && effectiveStart && effectiveStart > baselineStart)
                      ? getDaysDifference(baselineStart, effectiveStart)
                      : 0;
                    const inheritedDelay = Math.min(totalDelay, startDelay);
                    const newDelay = Math.max(0, totalDelay - inheritedDelay);

                    if (totalDelay > maxTotalDelay) maxTotalDelay = totalDelay;
                    if (inheritedDelay > maxNetInheritedDelay) maxNetInheritedDelay = inheritedDelay;
                    if (newDelay > maxNewDelayFormed) maxNewDelayFormed = newDelay;
                  }
                });

                // Preceding delay sources are ONLY shown if this stage actually inherited a delay!
                // If the delay was resolved at an earlier stage, forthcoming stages have 0 inherited delay and do not display prior resolved delays.
                const consolidatedPreviousDelays = maxNetInheritedDelay > 0
                  ? Array.from(stageMap.values()).sort((a, b) => a.stageOrder - b.stageOrder)
                  : [];


                // 1. NO DELAY AT ALL (0d delay and within baseline schedule)
                if (maxTotalDelay <= 0) {
                  return (
                    <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between shadow-2xs">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Schedule Status: On Track — Selected date is within planned schedule.</span>
                      </div>
                      <span className="font-mono font-bold text-emerald-700 text-[10px] bg-white/80 px-2 py-0.5 rounded border border-emerald-200">
                        0d Delay
                      </span>
                    </div>
                  );
                }

                // 2. INHERITED DELAY ONLY (This stage did NOT cause a new delay)
                if (maxNewDelayFormed <= 0 && maxNetInheritedDelay > 0) {
                  return (
                    <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-blue-950 text-[11px] flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-blue-600" />
                          <span>Preceding Delay: <strong className="text-rose-700 font-mono">+{maxNetInheritedDelay}d Inherited</strong> (No new delay formed at Stage {stageOrder})</span>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-300">
                          Total Delay: +{maxTotalDelay}d
                        </span>
                      </div>

                      {consolidatedPreviousDelays.length > 0 && (
                        <div className="p-2 bg-blue-100/60 border border-blue-200/80 rounded-lg space-y-1 text-[10px] font-mono text-blue-900">
                          <div className="font-bold text-blue-950">Preceding Delay Sources:</div>
                          {consolidatedPreviousDelays.map((d, i) => (
                            <div key={i} className="truncate">
                              • Stage {d.stageOrder}: {d.stageName.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.addedDelay}d Delay Added</strong>
                              {d.delayReason && <span className="text-slate-600 font-normal"> — {d.delayReason}</span>}
                            </div>
                          ))}
                          <div className="pt-0.5 font-bold text-blue-950 border-t border-blue-200/60 flex justify-between">
                            <span>Total Cumulative Delay:</span>
                            <span className="text-rose-700 font-bold">+{maxTotalDelay}d</span>
                          </div>
                        </div>
                      )}

                      <div className="pt-1">
                        <input
                          type="text"
                          placeholder="Optional remarks or notes..."
                          value={batchModal.delayReason}
                          onChange={e => setBatchModal(prev => ({ ...prev, delayReason: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-xs bg-white font-medium placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  );
                }

                // 3. NEW DELAY FORMED AT THIS STAGE (Exceeded planned target)
                return (
                  <div className="p-3.5 bg-rose-50/90 border border-rose-300 rounded-xl space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-rose-950 text-[11px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        <span>New Delay Formed at Stage {stageOrder}: <strong className="text-rose-700 font-mono">+{maxNewDelayFormed}d Added</strong></span>
                      </div>
                      {maxNetInheritedDelay > 0 && (
                        <span className="text-[10px] font-mono text-slate-500">
                          (+{maxNetInheritedDelay}d prior inherited)
                        </span>
                      )}
                    </div>

                    {consolidatedPreviousDelays.length > 0 && (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-[10px] font-mono text-amber-900">
                        <div className="font-bold text-amber-950">Preceding Delay Sources:</div>
                        {consolidatedPreviousDelays.map((d, i) => (
                          <div key={i} className="truncate">
                            • Stage {d.stageOrder}: {d.stageName.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.addedDelay}d Delay Added</strong>
                            {d.delayReason && <span className="text-slate-600 font-normal"> — {d.delayReason}</span>}
                          </div>
                        ))}
                        <div className="pt-0.5 font-bold text-amber-950 border-t border-amber-200/60 flex justify-between">
                          <span>Total Cumulative Delay:</span>
                          <span className="text-rose-700 font-bold">+{maxTotalDelay}d</span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        value={batchModal.delayCategory}
                        onChange={e => setBatchModal(prev => ({ ...prev, delayCategory: e.target.value as DelayCategory }))}
                        className="w-full px-2.5 py-1.5 border border-rose-300 rounded-lg text-xs bg-white font-medium"
                      >
                        <option value="">Select Delay Category (Optional)</option>
                        <option value="Customer">Customer Dependency</option>
                        <option value="Supplier">Supplier Delay</option>
                        <option value="Internal">Internal Resource Deficit</option>
                        <option value="Design">Technical / Design Complexity</option>
                        <option value="Production">Production / Inspection Hold</option>
                      </select>

                      <input
                        type="text"
                        placeholder={`Reason for +${maxNewDelayFormed}d delay on Stage ${stageOrder} *`}
                        value={batchModal.delayReason}
                        onChange={e => setBatchModal(prev => ({ ...prev, delayReason: e.target.value }))}
                        className="w-full px-2.5 py-1.5 border border-rose-300 rounded-lg text-xs bg-white font-bold text-slate-800 focus:border-rose-600 placeholder:font-normal placeholder:text-rose-400"
                        required
                      />
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] font-mono text-slate-500">
                Applying to {batchModal.selectedLineIds.length} line(s)
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBatchModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={batchModal.selectedLineIds.length === 0 || !batchModal.date}
                  onClick={handleExecuteBatch}
                  className={`px-5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1.5 ${
                    batchModal.selectedLineIds.length > 0 && batchModal.date
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {batchModal.selectedLineIds.length === 1 
                    ? `Confirm & Record ${batchModal.mode === 'start' ? 'Start' : 'Complete'}`
                    : `Apply to ${batchModal.selectedLineIds.length} Product Line(s)`
                  }
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Close Order Modal */}
      {closingPO && (
        <CloseOrderModal
          isOpen={Boolean(closingPO)}
          onClose={() => setClosingPO(null)}
          po={closingPO}
        />
      )}

    </div>
  );
};
