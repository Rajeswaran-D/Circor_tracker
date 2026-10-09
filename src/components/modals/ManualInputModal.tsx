import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { X, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { Milestone, ProductLine, PurchaseOrder } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { getDaysDifference, todayLocal, addDays } from '../../services/calculationEngine';

interface ManualInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  productLine: ProductLine;
  milestone: Milestone;
  eventType: 'start' | 'complete';
}

export const ManualInputModal: React.FC<ManualInputModalProps> = ({
  isOpen,
  onClose,
  po,
  productLine,
  milestone,
  eventType
}) => {
  const { updateMilestoneEvent, activeRole } = useApp();
  const todayStr = todayLocal();
  const msIndex = productLine.milestones.findIndex(m => m.key === milestone.key);
  const previousMs = msIndex > 0 ? productLine.milestones[msIndex - 1] : undefined;
  // Use actualEndDate as the authoritative previous end — this is what the chain must start from
  const previousMsActualEnd = previousMs?.actualEndDate;
  const prevEffectiveEnd = previousMsActualEnd || previousMs?.forecastEndDate;
  // Floor for completion date must only be an actual event (actual start or previous actual end)
  const currentMsStart = milestone.actualStartDate || previousMsActualEnd;

  const rawDefault = eventType === 'start'
    ? (milestone.actualStartDate || previousMsActualEnd || prevEffectiveEnd || milestone.committedBaselineStartDate || todayStr)
    : (milestone.actualEndDate || milestone.actualStartDate || previousMsActualEnd || todayStr);

  const defaultInitialDate = rawDefault;

  const [eventDate, setEventDate] = useState<string>(defaultInitialDate);
  const [backdateReason, setBackdateReason] = useState<string>('');
  const [customDelayReason, setCustomDelayReason] = useState<string>('');
  
  // Design Specific
  const [approvalRef, setApprovalRef] = useState<string>('');
  const [drawingNo, setDrawingNo] = useState<string>('');
  const [ecnNo, setEcnNo] = useState<string>('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setEventDate(defaultInitialDate);
    setBackdateReason('');
    setCustomDelayReason('');
    setErrorMessage(null);
  }, [isOpen, milestone.id, eventType, defaultInitialDate]);

  if (!isOpen) return null;

  const isRoleAuthorized = isMilestoneOwnedByRole(milestone.key, activeRole);
  const isPreviousDone = !previousMs || previousMs.status === 'Completed' || Boolean(previousMs.actualEndDate) || previousMs.completionPct === 100;

  const dur = Math.max(1, milestone.committedDurationDays || 1);
  const baselineStart = milestone.committedBaselineStartDate;
  const baselineEnd = milestone.committedBaselineEndDate;
  const baselineDuration = (baselineStart && baselineEnd) ? Math.max(1, getDaysDifference(baselineStart, baselineEnd)) : dur;

  let totalDelay = 0;
  let inheritedDelayDays = 0;
  let newDelayFormed = 0;
  let revisedTarget = '';

  if (eventType === 'start') {
    totalDelay = (baselineStart && eventDate > baselineStart)
      ? getDaysDifference(baselineStart, eventDate)
      : 0;
    inheritedDelayDays = (baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart)
      ? Math.min(totalDelay, getDaysDifference(baselineStart, prevEffectiveEnd))
      : 0;
    newDelayFormed = Math.max(0, totalDelay - inheritedDelayDays);
    revisedTarget = (baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart)
      ? prevEffectiveEnd
      : (baselineStart || '');
  } else {
    totalDelay = (baselineEnd && eventDate > baselineEnd)
      ? getDaysDifference(baselineEnd, eventDate)
      : 0;
    const effectiveStart = milestone.actualStartDate || ((baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart) ? prevEffectiveEnd : baselineStart);
    const startDelay = (baselineStart && effectiveStart && effectiveStart > baselineStart)
      ? getDaysDifference(baselineStart, effectiveStart)
      : 0;
    inheritedDelayDays = Math.min(totalDelay, startDelay);
    newDelayFormed = Math.max(0, totalDelay - inheritedDelayDays);

    revisedTarget = startDelay > 0 && effectiveStart ? addDays(effectiveStart, baselineDuration) : (baselineEnd || '');
  }

  const targetRevisedStart = milestone.actualStartDate || ((baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart) ? prevEffectiveEnd : (baselineStart || ''));
  const precedingStartDelay = (baselineStart && targetRevisedStart && targetRevisedStart > baselineStart)
    ? getDaysDifference(baselineStart, targetRevisedStart)
    : 0;
  const targetRevisedEnd = precedingStartDelay > 0 && targetRevisedStart
    ? addDays(targetRevisedStart, baselineDuration)
    : (baselineEnd || '');

  const isBackdated = eventDate < todayStr;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isRoleAuthorized) {
      setErrorMessage(`Unauthorized: Your active role (${activeRole}) is not permitted to complete milestone '${milestone.name}'. Exclusive access is restricted to its respective role.`);
      return;
    }

    if (!isPreviousDone) {
      setErrorMessage(`Milestone Locked: Milestone '${previousMs?.name}' must be marked completed first before '${milestone.name}' can be updated.`);
      return;
    }

    const effectiveDocRef = `WO-AUTO-${eventDate.replace(/-/g, '')}`;

    if (eventType === 'start' && previousMsActualEnd && eventDate < previousMsActualEnd) {
      setErrorMessage(`Start date cannot be earlier than previous milestone's actual end date (${previousMsActualEnd}).`);
      return;
    }

    if (eventType === 'complete' && currentMsStart && eventDate < currentMsStart) {
      setErrorMessage(`Completion date cannot be earlier than milestone start date (${currentMsStart}).`);
      return;
    }

    if (isBackdated && !backdateReason.trim()) {
      setErrorMessage('A written justification is mandatory for backdated event entries.');
      return;
    }

    if (milestone.key === 'design_approval' && eventType === 'complete' && !approvalRef.trim()) {
      setErrorMessage('Customer Drawing Approval Reference is mandatory for completing Design Stage.');
      return;
    }

    if (newDelayFormed > 0 && !customDelayReason.trim()) {
      setErrorMessage(`A delay reason is required because the date entered (${eventDate}) adds +${newDelayFormed}d delay beyond the revised plan (${revisedTarget}).`);
      return;
    }

    const effectiveDelayReason = customDelayReason.trim()
      ? customDelayReason.trim()
      : undefined;

    const res = updateMilestoneEvent({
      poId: po.id,
      productLineId: productLine.id,
      milestoneKey: milestone.key,
      eventType,
      eventDate,
      user: `${activeRole} User`,
      docRef: effectiveDocRef,
      backdateReason: isBackdated ? backdateReason : undefined,
      approvalRef: approvalRef || undefined,
      drawingNo: drawingNo || undefined,
      ecnNo: ecnNo || undefined,
      delayReason: effectiveDelayReason
    });

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to update milestone event');
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-800">
        
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-base">
                {eventType === 'start' && milestone.actualStartDate 
                  ? 'Edit / Re-enter Stage Start Date' 
                  : eventType === 'start' 
                  ? 'Record Stage Start Date' 
                  : 'Record Stage Completion'}
              </span>
              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border ${
                eventType === 'start' && milestone.actualStartDate 
                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                  : 'bg-emerald-100 text-emerald-800 border-emerald-300'
              }`}>
                {eventType === 'start' && milestone.actualStartDate ? 'EDIT START' : eventType.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">PO: {po.poNumber} | Line: {productLine.lineNumber}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          
          {!isRoleAuthorized && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg flex items-start gap-2.5 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Role Access Restricted:</span>
                <p className="mt-0.5">
                  Milestone <strong className="text-slate-900">'{milestone.name}'</strong> belongs to its dedicated department role. Your active role (<span className="font-bold text-amber-950">{activeRole}</span>) cannot modify or complete this stage.
                </p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-start gap-2.5 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Validation Error:</span>
                <p className="mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900">{milestone.name}</div>
              <span className="font-mono text-[10px] font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                {baselineDuration} days planned
              </span>
            </div>
            <div className="space-y-1.5 pt-1.5 border-t border-slate-200/60 font-mono text-[11px]">
              <div className="flex items-center justify-between text-slate-600">
                <span>Planned Baseline: <strong className="text-slate-800">{baselineStart || 'N/A'} &rarr; {baselineEnd || 'N/A'}</strong></span>
                <span className="text-[10px] text-slate-500 font-semibold">{baselineDuration} days planned</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/40">
                <span className={precedingStartDelay > 0 ? "text-amber-800" : "text-emerald-700"}>
                  Revised Target: <strong className={precedingStartDelay > 0 ? "text-amber-950" : "text-emerald-900"}>{targetRevisedStart || baselineStart || 'N/A'} &rarr; {targetRevisedEnd || baselineEnd || 'N/A'}</strong>
                </span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  precedingStartDelay > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                }`}>
                  {precedingStartDelay > 0 ? `+${precedingStartDelay}d shift from previous delay` : 'On original baseline'}
                </span>
              </div>
            </div>
          </div>

          {/* Event Date (Primary Input) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-slate-700 font-semibold">
                {eventType === 'start' ? (milestone.actualStartDate ? 'Re-enter Start Date' : 'Actual Start Date') : 'Actual Completion Date'} <span className="text-rose-600">*</span>
              </label>
              {eventType === 'start' && milestone.actualStartDate && (
                <span className="text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded font-mono">
                  Current: {milestone.actualStartDate}
                </span>
              )}
            </div>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-600 font-medium font-mono"
            />
          </div>

          {/* Status feedback & Delay Calculation */}
          {totalDelay <= 0 ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] font-semibold flex items-center justify-between">
              <span>Within Planned Time — No delay detected.</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            </div>
          ) : newDelayFormed > 0 ? (
            <div className="space-y-3">
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 text-[11px] font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>New Delay Formed at <strong>Stage {milestone.stageOrder}: {milestone.name.replace(/^\d+\.\s*/, '')}</strong>: <strong className="text-rose-700">+{newDelayFormed}d Added</strong></span>
                </div>
                {inheritedDelayDays > 0 && (
                  <span className="text-[10px] font-mono text-slate-500">(+{inheritedDelayDays}d prior inherited)</span>
                )}
              </div>
              <div className="space-y-2">
                {(() => {
                  const prevMilestones = (productLine.milestones || []).slice(0, msIndex);
                  const prevDelaysList = prevMilestones
                    .map((m, mIdx) => {
                      const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                      const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                      const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                      const stageDelta = currVar - prevVar;
                      return { ...m, calculatedDelayDays: stageDelta };
                    })
                    .filter(m => m.calculatedDelayDays > 0);

                  return (
                    <>
                      {inheritedDelayDays > 0 && prevDelaysList.length > 0 && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg space-y-0.5 text-[10px] font-mono text-amber-900">
                          <div className="font-bold text-amber-950">Preceding Delay Sources:</div>
                          {prevDelaysList.map((m, i) => (
                            <div key={i} className="truncate">
                              • Stage {m.stageOrder}: {m.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{m.calculatedDelayDays}d Delay Added</strong>
                              {m.delayReason && <span className="text-slate-600 font-normal"> — {m.delayReason}</span>}
                            </div>
                          ))}
                          <div className="pt-0.5 font-bold text-amber-950 border-t border-amber-200/60 flex justify-between">
                            <span>Total Cumulative Delay:</span>
                            <span className="text-rose-700 font-bold">+{totalDelay}d</span>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <label className="block text-rose-950 font-bold text-xs">
                  Reason for +{newDelayFormed}d Delay Formed at this Stage <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Explain reason for this stage's delay (e.g. Sub-tier casting delay / NDT re-inspection)..."
                  value={customDelayReason}
                  onChange={(e) => setCustomDelayReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-slate-900 font-bold text-xs focus:outline-none focus:border-rose-600 placeholder:font-normal placeholder:text-rose-400"
                  required
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-[11px] font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Preceding Delay: <strong className="text-rose-700 font-mono">+{inheritedDelayDays}d Inherited</strong> (No new delay formed at Stage {milestone.stageOrder})</span>
                </div>
                <span className="text-[10px] font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-300">
                  Total Delay: +{totalDelay}d
                </span>
              </div>

              {(() => {
                const prevMilestones = (productLine.milestones || []).slice(0, msIndex);
                const prevDelaysList = prevMilestones
                  .map((m, mIdx) => {
                    const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                    const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                    const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                    const stageDelta = currVar - prevVar;
                    return { ...m, calculatedDelayDays: stageDelta };
                  })
                  .filter(m => m.calculatedDelayDays > 0);

                if (inheritedDelayDays <= 0 || prevDelaysList.length === 0) return null;

                return (
                  <div className="p-2 bg-blue-100/60 border border-blue-200 rounded-lg space-y-0.5 text-[10px] font-mono text-blue-900">
                    <div className="font-bold text-blue-950">Preceding Delay Sources:</div>
                    {prevDelaysList.map((m, i) => (
                      <div key={i} className="truncate">
                        • Stage {m.stageOrder}: {m.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{m.calculatedDelayDays}d Delay Added</strong>
                        {m.delayReason && <span className="text-slate-600 font-normal"> — {m.delayReason}</span>}
                      </div>
                    ))}
                    <div className="pt-0.5 font-bold text-blue-950 border-t border-blue-200/60 flex justify-between">
                      <span>Total Cumulative Delay:</span>
                      <span className="text-rose-700 font-bold">+{totalDelay}d</span>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <label className="block text-slate-700 font-medium text-xs">
                  Optional Notes (defaults to 'Inherited delay (+{inheritedDelayDays}d)')
                </label>
                <input
                  type="text"
                  placeholder="Optional notes or remarks..."
                  value={customDelayReason}
                  onChange={(e) => setCustomDelayReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-blue-600 font-medium"
                />
              </div>
            </div>
          )}

          {isBackdated && (
            <div>
              <label className="block text-amber-800 font-semibold mb-1">
                Backdate Justification <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={2}
                placeholder="Explain reason for backdated entry..."
                value={backdateReason}
                onChange={(e) => setBackdateReason(e.target.value)}
                className="w-full px-3 py-2 bg-amber-50/50 border border-amber-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-amber-600"
              />
            </div>
          )}

          {/* Design Milestone Fields */}
          {milestone.key === 'design_approval' && eventType === 'complete' && (
            <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-lg space-y-3">
              <div className="font-bold text-emerald-900">Design Approval Sign-off Reference</div>
              <div>
                <label className="block text-slate-700 mb-1 font-semibold">Customer Approval Ref <span className="text-rose-600">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. PETRO-CAD-9921-APPROVED"
                  value={approvalRef}
                  onChange={(e) => setApprovalRef(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 mb-1">Drawing #</label>
                  <input
                    type="text"
                    placeholder="CFT-DWG-400-REV-C"
                    value={drawingNo}
                    onChange={(e) => setDrawingNo(e.target.value)}
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ECN #</label>
                  <input
                    type="text"
                    placeholder="ECN-2026-089"
                    value={ecnNo}
                    onChange={(e) => setEcnNo(e.target.value)}
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Logged by: {activeRole} User</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isRoleAuthorized}
                className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs ${
                  isRoleAuthorized
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
                {eventType === 'start' && milestone.actualStartDate 
                  ? 'Update Start Date' 
                  : eventType === 'start' 
                  ? 'Confirm & Record Start' 
                  : 'Complete Stage'}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
