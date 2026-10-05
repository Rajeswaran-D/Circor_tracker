import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { MilestoneStatus, DelayCategory } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { validateEventDate, getDaysDifference } from '../../services/calculationEngine';
import { 
  Calendar, 
  CheckCircle2, 
  Lock,
  AlertCircle,
  AlertTriangle,
  Play,
  Edit3
} from 'lucide-react';

interface MilestoneModuleViewProps {
  stageKey: string;
  stageTitle: string;
  stageOrder: number;
  responsibleRole: string;
  description: string;
}

export const MilestoneModuleView: React.FC<MilestoneModuleViewProps> = ({
  stageKey,
  stageTitle,
  stageOrder,
  responsibleRole,
  description
}) => {
  const { purchaseOrders, acceptMilestone, updateMilestoneEvent, activeRole } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
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

  const canManageStage = isMilestoneOwnedByRole(stageKey, activeRole);

  // Gather all product lines and their stage milestone across approved orders
  const stageEntries = purchaseOrders
    .filter(po => po.status !== 'Baseline Pending')
    .flatMap(po =>
      (po.productLines || []).flatMap(line => {
        const milestone = (line.milestones || []).find(m => m.key === stageKey);
        return milestone ? [{ po, line, milestone }] : [];
      })
    );

  const filteredEntries = stageEntries.filter(({ po, line }) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      po.poNumber.toLowerCase().includes(term) ||
      po.customerName.toLowerCase().includes(term) ||
      line.productName.toLowerCase().includes(term)
    );
  });

  const isPreviousMilestoneComplete = ({ line, milestone }: typeof stageEntries[number]) => {
    const milestoneIndex = line.milestones.findIndex(item => item.id === milestone.id || item.key === milestone.key);
    const previousMilestone = milestoneIndex > 0 ? line.milestones[milestoneIndex - 1] : undefined;
    return milestoneIndex === 0 || previousMilestone?.status === 'Completed' || Boolean(previousMilestone?.actualEndDate);
  };

  const activeEntries = filteredEntries.filter(entry =>
    !entry.po.isClosed && entry.po.status !== 'Completed' &&
    entry.milestone.status !== 'Completed' && !entry.milestone.actualEndDate && isPreviousMilestoneComplete(entry)
  );
  const completedEntries = filteredEntries.filter(entry => entry.milestone.status === 'Completed' || Boolean(entry.milestone.actualEndDate));
  const orderedEntries = [...activeEntries, ...completedEntries];

  const handleStartEdit = (entryKey: string, milestone: any) => {
    setEditingKey(entryKey);
    setErrorMessage(null);
    setFormData({
      startDate: milestone.actualStartDate || milestone.forecastStartDate || milestone.committedBaselineStartDate || new Date().toISOString().split('T')[0],
      endDate: milestone.actualEndDate || milestone.forecastEndDate || milestone.committedBaselineEndDate || new Date().toISOString().split('T')[0],
      docRef: milestone.docRef || '',
      particularDetails: milestone.particularDetails || '',
      secondaryRef: milestone.secondaryRef || '',
      status: milestone.status || 'In Progress',
      delayCategory: milestone.delayCategory || '',
      delayReason: milestone.delayReason || '',
      varianceDays: milestone.varianceDays || 0
    });
  };

  const handleSaveStageUpdate = (poId: string, lineId: string, key: string, markComplete = false) => {
    setErrorMessage(null);
    const todayStr = new Date().toISOString().split('T')[0];

    const targetPO = purchaseOrders.find(p => p.id === poId);
    const targetLine = targetPO?.productLines.find(l => l.id === lineId);
    if (!targetLine || !targetPO) return;

    const msIndex = (targetLine.milestones || []).findIndex(m => m.key === key || m.id === key);
    if (msIndex < 0) return;

    const targetMilestone = targetLine.milestones[msIndex];
    const baselineStart = targetMilestone.committedBaselineStartDate || targetPO.poDate;
    const baselineEnd = targetMilestone.committedBaselineEndDate || targetPO.committedDeliveryDate;

    const isStartDelayed = formData.startDate > baselineStart;
    const isEndDelayed = formData.endDate > baselineEnd;
    const isDelayed = isStartDelayed || isEndDelayed;

    const delayReasonToUse = formData.delayReason.trim() || (isDelayed ? `Schedule variance against baseline target (${isEndDelayed ? baselineEnd : baselineStart}).` : undefined);
    const delayCategoryToUse = formData.delayCategory || (isDelayed ? 'Internal' : undefined);

    if (markComplete) {
      // Record Completion with user selected date
      const effectiveCompDate = formData.endDate || todayStr;
      
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
    } else {
      // Record Start / Update Stage with user selected date
      const effectiveStartDate = formData.startDate || todayStr;

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
    }

    setEditingKey(null);
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

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search PO # or Customer..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="px-3.5 py-2 rounded-xl text-xs bg-white/10 text-white placeholder-slate-400 border border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono w-64"
          />
        </div>
      </div>

      {/* Stage Items Grid */}
      <div className="space-y-4">
        {orderedEntries.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
            No current or completed orders found for stage <span className="font-semibold">{stageTitle}</span>.
          </div>
        ) : (
          orderedEntries.map(({ po, line, milestone }, entryIndex) => {
            const entryKey = `${po.id}-${line.id}-${milestone.id}`;
            const isEditing = editingKey === entryKey;
            const msStatus = milestone.status;

            // Sequential Prerequisite Check
            const msIndex = (line.milestones || []).findIndex(m => m.id === milestone.id || m.key === milestone.key);
            const prevMilestone = msIndex > 0 ? (line.milestones || [])[msIndex - 1] : null;
            const isPrevCompleted = msIndex === 0 || (prevMilestone && (prevMilestone.status === 'Completed' || Boolean(prevMilestone.actualEndDate)));

            const bStart = milestone.committedBaselineStartDate || po.poDate;
            const bEnd = milestone.committedBaselineEndDate || po.committedDeliveryDate;
            const isStartLate = formData.startDate > bStart;
            const isEndLate = formData.endDate > bEnd;
            const isCardDelayed = isStartLate || isEndLate;
            const cardDelayDays = isCardDelayed
              ? Math.max(
                  isEndLate ? getDaysDifference(bEnd, formData.endDate) : 0,
                  isStartLate ? getDaysDifference(bStart, formData.startDate) : 0
                )
              : 0;

            return (
              <React.Fragment key={entryKey}>
              {(entryIndex === 0 && activeEntries.length > 0) && (
                <div className="px-1 pt-2 pb-1 text-sm font-bold text-slate-900">Current / Active</div>
              )}
              {(entryIndex === activeEntries.length && completedEntries.length > 0) && (
                <div className="px-1 pt-5 pb-1 text-sm font-bold text-emerald-800">Completed</div>
              )}
              <div 
                className={`bg-white border rounded-2xl shadow-xs transition-all ${
                  !isPrevCompleted ? 'border-amber-200/80 bg-amber-50/10' :
                  msStatus === 'Completed' || milestone.actualEndDate ? 'border-emerald-200 bg-emerald-50/20' :
                  milestone.actualStartDate || msStatus === 'In Progress' ? 'border-blue-200 bg-blue-50/20' :
                  msStatus === 'Delayed' ? 'border-rose-200 bg-rose-50/20' :
                  'border-slate-200'
                }`}
              >
                {/* Card Top Row */}
                <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {po.poNumber}
                      </span>
                      <span className="text-slate-400">•</span>
                      <span className="font-bold text-slate-900 text-sm">{po.customerName}</span>
                      <span className="text-slate-400">•</span>
                      <span className="text-xs font-semibold text-slate-600">{line.productName} ({line.designType})</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Order Overall: <strong className="font-mono text-slate-900">{po.poDate}</strong> &rarr; <strong className="font-mono text-emerald-800">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong></span>
                      </div>
                      <span className="text-slate-300">|</span>
                      <span className="font-bold text-slate-700">Stage Schedule:</span>
                      <span>Planned Start: <strong className="text-slate-900 font-mono">{milestone.committedBaselineStartDate || po.poDate}</strong></span>
                      <span>Planned End: <strong className="text-slate-900 font-mono">{milestone.committedBaselineEndDate || po.committedDeliveryDate}</strong></span>
                      {milestone.actualStartDate && <span>Actual Start: <strong className="text-blue-700 font-mono">{milestone.actualStartDate}</strong></span>}
                      {milestone.actualEndDate && <span>Actual End: <strong className="text-emerald-700 font-mono">{milestone.actualEndDate}</strong></span>}
                      <span>•</span>
                      <span>Target Duration: <strong className="text-slate-700">{milestone.committedDurationDays}d</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {!isPrevCompleted ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold font-mono bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1.5 shadow-2xs">
                        <Lock className="w-3.5 h-3.5 text-amber-700" /> Pending Stage {prevMilestone?.stageOrder}
                      </span>
                    ) : (
                      <span className={`px-3 py-1 rounded-full text-xs font-bold font-mono border ${
                        msStatus === 'Completed' || milestone.actualEndDate ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                        milestone.actualStartDate || msStatus === 'In Progress' ? (msStatus === 'Delayed' || (milestone.varianceDays && milestone.varianceDays > 0) ? 'bg-blue-50 text-blue-900 border-blue-300' : 'bg-blue-100 text-blue-800 border-blue-300') :
                        msStatus === 'Delayed' ? 'bg-rose-100 text-rose-800 border-rose-300' :
                        'bg-slate-100 text-slate-600 border-slate-300'
                      }`}>
                        {msStatus === 'Completed' || milestone.actualEndDate ? 'Completed' :
                         milestone.actualStartDate || msStatus === 'In Progress' ? (msStatus === 'Delayed' || (milestone.varianceDays && milestone.varianceDays > 0) ? `In Execution (+${milestone.varianceDays}d)` : 'In Execution') :
                         msStatus === 'Delayed' ? 'Delayed' :
                         'Not Started'}
                      </span>
                    )}

                    {canManageStage && isPrevCompleted && !isEditing && (
                      milestone.status === 'Completed' ? (
                        <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">Completed</span>
                      ) : (
                        <button onClick={() => {
                          if (!milestone.acceptedAt) {
                            acceptMilestone({ poId: po.id, productLineId: line.id, milestoneKey: milestone.key, user: activeRole });
                          }
                          handleStartEdit(entryKey, milestone);
                        }} className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5">
                          {milestone.actualStartDate ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete / Edit Start
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 fill-current" /> Record Start
                            </>
                          )}
                        </button>
                      )
                    )}

                    {!canManageStage && (
                      <span className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-xl text-xs font-medium border border-slate-200">
                        Read Only • {responsibleRole}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Editing Form OR Read-Only Display */}
                {isEditing ? (
                  <div className="p-5 bg-slate-50/80 border-b border-slate-200 space-y-4">
                    {errorMessage && (
                      <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2 font-medium">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{errorMessage}</span>
                      </div>
                    )}

                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                      Assign Baseline & Actual Dates for {stageTitle}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-bold text-slate-600">
                            Stage Start Date {milestone.actualStartDate ? '(Actual / Re-enter)' : '(Target / Actual)'}
                          </label>
                          {milestone.actualStartDate && (
                            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Started: {milestone.actualStartDate}
                            </span>
                          )}
                        </div>
                        <input
                          type="date"
                          min={prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate || undefined}
                          value={formData.startDate}
                          onChange={e => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-mono"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-mono"
                        />
                      </div>

                      <div className="hidden">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Doc Ref / Approval No.
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. DOC-2026-9981"
                          value={formData.docRef}
                          onChange={e => setFormData(prev => ({ ...prev, docRef: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white"
                        />
                      </div>
                    </div>

                    {isCardDelayed && (
                      <div className="p-3.5 bg-amber-50 border border-amber-300/80 rounded-xl space-y-2.5 shadow-2xs">
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>Stage Schedule Delay Detected (+{cardDelayDays}d later than baseline target)</span>
                        </div>
                        <p className="text-[11px] text-amber-800 leading-relaxed">
                          Selected date exceeds the baseline schedule target ({isEndLate ? `Planned End: ${bEnd}` : `Planned Start: ${bStart}`}). Please select a Delay Category and enter a Reason for Delay below.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="block text-[10px] font-bold text-amber-900 mb-1">
                              Delay Category <span className="text-rose-600">*</span>
                            </label>
                            <select
                              value={formData.delayCategory}
                              onChange={e => setFormData(prev => ({ ...prev, delayCategory: e.target.value as DelayCategory }))}
                              className="w-full px-3 py-1.5 border border-amber-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                            >
                              <option value="">Select Delay Category...</option>
                              {prevMilestone && <option value="Internal">Preceding Milestone Delay ({prevMilestone.name})</option>}
                              <option value="Customer">Customer Dependency</option>
                              <option value="Supplier">Supplier Delay</option>
                              <option value="Internal">Internal Resource Deficit</option>
                              <option value="Design">Technical / Design Complexity</option>
                              <option value="Production">Production / Inspection Hold</option>
                            </select>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[10px] font-bold text-amber-900">
                                Reason for Delay <span className="text-rose-600">*</span>
                              </label>
                              {prevMilestone && (
                                <button
                                  type="button"
                                  onClick={() => setFormData(prev => ({
                                    ...prev,
                                    delayCategory: prev.delayCategory || 'Internal',
                                    delayReason: `Cascaded delay from preceding stage: ${prevMilestone.name}${prevMilestone.delayReason ? ` (${prevMilestone.delayReason})` : ''}`
                                  }))}
                                  className="text-[10px] text-emerald-800 hover:text-emerald-950 font-bold underline cursor-pointer"
                                >
                                  ⚡ Use Previous Milestone Delay
                                </button>
                              )}
                            </div>
                            <input
                              type="text"
                              placeholder="Enter reason for schedule delay..."
                              value={formData.delayReason}
                              onChange={e => setFormData(prev => ({ ...prev, delayReason: e.target.value }))}
                              className="w-full px-3 py-1.5 border border-amber-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Stage Specific Particular Inputs */}
                    <div className="hidden bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                      <div className="text-[11px] font-bold text-slate-700 uppercase font-mono">
                        {stageTitle} Particular Details & Verification Notes
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            {stageOrder === 1 ? 'Customer Contact / PO Terms' :
                             stageOrder === 2 ? 'Baseline Target Lead Time Notes' :
                             stageOrder === 3 ? 'CORB Review Board Approval #' :
                             stageOrder === 4 ? 'BOM Part List & Drawing Rev #' :
                             stageOrder === 5 ? 'Work Order No & Shop Routing' :
                             stageOrder === 6 ? 'Goods Receipt Note (GRN) #' :
                             stageOrder === 7 ? 'Machine Tool ID & Fab Log' :
                             stageOrder === 8 ? 'Assembly Line & Test Cert #' :
                             stageOrder === 9 ? 'QC Inspection Cert & Stamp #' :
                             'Dispatch Tracking & Carrier'}
                          </label>
                          <input
                            type="text"
                            placeholder="Enter specific reference details..."
                            value={formData.secondaryRef}
                            onChange={e => setFormData(prev => ({ ...prev, secondaryRef: e.target.value }))}
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            Operational Stage Notes / Status Comments
                          </label>
                          <input
                            type="text"
                            placeholder="Enter stage completion notes..."
                            value={formData.particularDetails}
                            onChange={e => setFormData(prev => ({ ...prev, particularDetails: e.target.value }))}
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Form Controls */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                      <div className="flex items-center gap-2">
                        <label className="hidden text-xs font-bold text-slate-700">Status:</label>
                        <select
                          value={formData.status}
                          onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as MilestoneStatus }))}
                          className="hidden px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium"
                        >
                          <option value="Not Started">Not Started</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="Delayed">Delayed</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingKey(null)}
                          className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                        >
                          Cancel
                        </button>
                        {!milestone.actualStartDate ? (
                          <button
                            type="button"
                            onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, false)}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 shadow-2xs"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" /> Record Start
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, false)}
                            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-semibold rounded-xl cursor-pointer flex items-center gap-1.5"
                            title="Save updated / re-entered start date"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-500" /> Update Start Date
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, true)}
                          className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl cursor-pointer shadow-xs flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-3 bg-slate-50/50 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-4">
                    <div className="flex flex-wrap items-center gap-4">
                      <span>Assigned Start: <strong className="font-mono text-slate-800">{milestone.actualStartDate || milestone.forecastStartDate || milestone.committedBaselineStartDate || 'Pending'}</strong></span>
                      <span>Assigned End: <strong className="font-mono text-slate-800">{milestone.actualEndDate || milestone.forecastEndDate || milestone.committedBaselineEndDate || 'Pending'}</strong></span>
                      {milestone.docRef && <span>Doc Ref: <strong className="font-mono text-emerald-800">{milestone.docRef}</strong></span>}
                    </div>
                    {milestone.status === 'Completed' ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Milestone Passed
                      </span>
                    ) : msStatus === 'Delayed' || (milestone.varianceDays && milestone.varianceDays > 0) ? (
                      milestone.delayReason && !milestone.delayReason.startsWith('Cascaded delay from preceding') ? (
                        <span className="text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg font-medium text-[11px] flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <strong className="font-bold">Reason:</strong> {milestone.delayReason}
                        </span>
                      ) : (
                        <span className="text-amber-800 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-lg font-mono font-medium text-[11px] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                          <span>Baseline Delay: <strong className="text-amber-900 font-bold">+{milestone.varianceDays || 0}d</strong></span>
                        </span>
                      )
                    ) : null}
                  </div>
                )}

                {!isPrevCompleted && (
                  <div className="px-5 py-3 bg-amber-50/50 border-t border-amber-100 text-amber-900 text-xs flex items-center gap-2 font-medium">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Stage {stageOrder} ({stageTitle}) will become available once Stage {prevMilestone?.stageOrder} ({prevMilestone?.name}) is marked Completed.</span>
                  </div>
                )}
              </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
};
