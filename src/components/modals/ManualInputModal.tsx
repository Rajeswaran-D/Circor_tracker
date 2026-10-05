import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { X, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { Milestone, ProductLine, PurchaseOrder } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { getDaysDifference, todayLocal } from '../../services/calculationEngine';

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
  const previousMsEnd = previousMsActualEnd
    || (previousMs ? (previousMs.forecastEndDate || previousMs.committedBaselineEndDate) : undefined);
  // Minimum selectable date for start events: must be >= previous milestone's actual end date if available
  const startMinDate = previousMsActualEnd || milestone.committedBaselineStartDate;
  const currentMsStart = milestone.actualStartDate || previousMsActualEnd || milestone.committedBaselineStartDate;

  const rawDefault = eventType === 'start'
    ? (milestone.actualStartDate || previousMsActualEnd || milestone.committedBaselineStartDate || todayStr)
    : (milestone.actualEndDate || milestone.actualStartDate || milestone.committedBaselineEndDate || todayStr);

  const defaultInitialDate = rawDefault;

  const [eventDate, setEventDate] = useState<string>(defaultInitialDate);
  const [backdateReason, setBackdateReason] = useState<string>('');
  const [customDelayReason, setCustomDelayReason] = useState<string>('');
  
  // Design Specific
  const [approvalRef, setApprovalRef] = useState<string>('');
  const [drawingNo, setDrawingNo] = useState<string>('');
  const [ecnNo, setEcnNo] = useState<string>('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isRoleAuthorized = isMilestoneOwnedByRole(milestone.key, activeRole);
  const isPreviousDone = !previousMs || previousMs.status === 'Completed';

  const comparisonDate = eventType === 'start' ? milestone.committedBaselineStartDate : milestone.committedBaselineEndDate;
  const isDelayedDate = eventDate > comparisonDate;
  const isBackdated = eventDate < todayStr;
  const delayDaysCount = isDelayedDate ? Math.max(1, getDaysDifference(comparisonDate, eventDate)) : 0;

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

    if (eventType === 'start' && previousMsEnd && eventDate < previousMsEnd) {
      setErrorMessage(`Start date cannot be earlier than previous milestone's end date (${previousMsEnd}).`);
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

    if (isDelayedDate && !customDelayReason.trim()) {
      setErrorMessage('A delay reason is required when the selected date is later than the baseline.');
      return;
    }

    const effectiveDelayReason = isDelayedDate
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

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="font-bold text-slate-900 text-xs">{milestone.name}</div>
            <div className="flex justify-between text-[11px] text-slate-500 mt-1 font-mono">
              <span>Planned {eventType === 'start' ? 'Start' : 'End'}: <strong className="text-slate-700">{comparisonDate}</strong></span>
              <span>Default Duration: {milestone.committedDurationDays} days</span>
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
              min={eventType === 'start' ? (previousMsEnd || startMinDate) : currentMsStart}
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-600 font-medium font-mono"
            />
          </div>

          {/* Status feedback & Delay Calculation */}
          {!isDelayedDate ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] font-semibold flex items-center justify-between">
              <span>Within Planned Time — No delay detected.</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Delay Detected at <strong>{milestone.name}</strong>: +{delayDaysCount} days delay formed.</span>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-700 font-semibold">
                    Actual Reason for Delay <span className="text-rose-600">*</span>
                  </label>
                  {previousMs && (
                    <button
                      type="button"
                      onClick={() => setCustomDelayReason(`Delay cascaded from previous stage: ${previousMs.name}${previousMs.delayReason ? ` (${previousMs.delayReason})` : ''}`)}
                      className="text-[10px] text-emerald-800 hover:text-emerald-950 font-bold underline cursor-pointer"
                    >
                      ⚡ Use Previous Milestone Delay
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Explain reason for delay (e.g. Sub-tier casting delay / NDT test re-inspection)..."
                  value={customDelayReason}
                  onChange={(e) => setCustomDelayReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-600"
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
