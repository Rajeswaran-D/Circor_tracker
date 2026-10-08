import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder } from '../../types';
import { ROLE_PERMISSIONS } from '../../types';
import { X, Wrench, CheckCircle2, Play, Save, AlertTriangle } from 'lucide-react';
import { getPOManufacturingStatus } from '../../utils/statusUtils';
import { clampDateMax, todayLocal, getDaysDifference, addDays } from '../../services/calculationEngine';

interface UpdateStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
}

export const UpdateStatusModal: React.FC<UpdateStatusModalProps> = ({
  isOpen,
  onClose,
  po: poProp
}) => {
  const { updateOrderStatus, activeRole, purchaseOrders } = useApp();
  // Always read fresh PO from context to avoid stale-prop sync issues
  const po = poProp ? (purchaseOrders.find(p => p.id === poProp.id) ?? poProp) : null;

  const [selectedStageKey, setSelectedStageKey] = useState<string>('production');
  const [selectedLineId, setSelectedLineId] = useState<string>('');
  const [statusAction, setStatusAction] = useState<'In Progress' | 'Completed'>('In Progress');
  const [completionDate, setCompletionDate] = useState<string>('');
  const [workNotes, setWorkNotes] = useState<string>('');
  const [delayReasonInput, setDelayReasonInput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const today = todayLocal();

  useEffect(() => {
    if (po) {
      const lines = po.productLines;
      // Default to the line that is furthest behind (earliest active stage) so
      // the form always opens on the true bottleneck of the order.
      const defaultLine = lines.length > 0
        ? lines.slice().sort((a, b) => {
            const aActive = a.milestones.find(m => m.status !== 'Completed');
            const bActive = b.milestones.find(m => m.status !== 'Completed');
            return (aActive?.stageOrder ?? 99) - (bActive?.stageOrder ?? 99);
          })[0]
        : undefined;
      setSelectedLineId(defaultLine?.id || '');

      const milestones = defaultLine?.milestones || [];
      const activeMs = milestones.find(m => m.status !== 'Completed') || milestones[milestones.length - 1];
      const targetStageKey = activeMs?.key || 'production';

      const msIdx = milestones.findIndex(m => m.key === targetStageKey);
      const prev = msIdx > 0 ? milestones[msIdx - 1] : undefined;
      // Chain anchor: previous milestone's actual end when it exists, then its
      // planned end. Clamped to today so a future planned end can never make
      // the default value fall outside the selectable range.
      const prevEnd = prev?.actualEndDate
        || (prev ? (prev.forecastEndDate || prev.committedBaselineEndDate) : undefined);
      const rawInitial = prevEnd || activeMs?.committedBaselineStartDate || today;
      const initialDate = clampDateMax(rawInitial, today);

      setSelectedStageKey(targetStageKey);
      setStatusAction('In Progress');
      setWorkNotes('');
      setDelayReasonInput('');
      setCompletionDate(initialDate);
      setErrorMsg('');
    }
  }, [po?.id]);

  if (!isOpen || !po || po.isClosed || po.status === 'Completed') return null;

  const summary = getPOManufacturingStatus(po);
  const lines = po.productLines;
  // Everything in the form is derived from the SELECTED line — never blindly
  // from line 1. On multi-line POs each line has its own milestone chain.
  const selectedLine = lines.find(l => l.id === selectedLineId) || lines[0];
  const milestones = selectedLine?.milestones || [];
  
  // Find current active uncompleted milestone
  const activeMs = milestones.find(m => m.status !== 'Completed') || milestones[milestones.length - 1];
  const activeIndex = milestones.findIndex(m => m.key === activeMs?.key);

  const rawStages = [
    { key: 'po_from_customer',      name: '1. Customer PO Intake' },
    { key: 'pm_baseline',           name: '2. PM Baseline & Plan' },
    { key: 'corb_release',          name: '3. CORB Release' },
    { key: 'bom_release',           name: '4. BOM Release' },
    { key: 'wo_release',            name: '5. Work Order Release' },
    { key: 'material_receipt',      name: '7. Material Receipt (GRN)' },
    { key: 'machining',             name: '8. Machining' },
    { key: 'assembly',              name: '9. Assembly & Testing' },
    { key: 'qc_pass',               name: '10. Quality Control & Inspection' },
    { key: 'shipment',              name: '11. Final Shipment & Dispatch' },
  ];

  const rolePerms = ROLE_PERMISSIONS[activeRole];
  const allowedKeys: string[] | 'ALL' = rolePerms?.allowedMilestones ?? [];

  // Build the selector from the PO's actual milestone list so custom stages remain available.
  const stageNames = new Map(rawStages.map(stage => [stage.key, stage.name]));
  const allStages = milestones.map(ms => ({
    key: ms.key,
    name: stageNames.get(ms.key) || `${ms.stageOrder}. ${ms.name.replace(/^\d+\.\s*/, '')}`
  }));

  // Slot users can only see/act on their own milestone; PM can see all.
  const selectableStages = allStages.filter((st, idx) => {
    const msObj = milestones.find(m => m.key === st.key);
    if (!msObj || msObj.status === 'Completed') return false;
    const isOwnedByRole = allowedKeys === 'ALL' || allowedKeys.includes(st.key);
    if (!isOwnedByRole) return false;
    return idx === activeIndex;
  });

  const finalStages = selectableStages.length > 0 
    ? selectableStages 
    : [allStages.find(st => st.key === activeMs?.key) || allStages[allStages.length - 1] || rawStages[0]];

  const selectedMsIndex = milestones.findIndex(m => m.key === selectedStageKey);
  const previousMs = selectedMsIndex > 0 ? milestones[selectedMsIndex - 1] : undefined;
  // Authoritative previous end: prefer actual end date
  const previousMsActualEnd = previousMs?.actualEndDate;
  const previousMsEnd = previousMsActualEnd
    || (previousMs ? (previousMs.forecastEndDate || previousMs.committedBaselineEndDate) : undefined);
  const currentMs = milestones[selectedMsIndex];
  const currentMsStart = currentMs
    ? (currentMs.actualStartDate || previousMsActualEnd)
    : undefined;

  // Date-picker range. The floor must NEVER exceed max (today) or the picker
  // becomes unusable — so forecast/baseline fallbacks that land in the future
  // are dropped instead of being used as a minimum.
  // - In Progress (start): floor = previous milestone's ACTUAL end (the chain
  //   anchor). No arbitrary day-cap: backdated starts remain possible.
  // - In Progress (start): floor = previous milestone's end date.
  // - Completed: floor = the milestone's own start date or previous milestone's end date.
  const inputMin = statusAction === 'In Progress'
    ? (previousMsEnd || undefined)
    : (currentMs?.actualStartDate || previousMsEnd || undefined);

  const handleLineSelect = (lineId: string) => {
    setSelectedLineId(lineId);
    setErrorMsg('');
    const line = po?.productLines.find(l => l.id === lineId);
    const ms = line?.milestones || [];
    const lineActiveMs = ms.find(m => m.status !== 'Completed') || ms[ms.length - 1];
    const idx = ms.findIndex(m => m.key === lineActiveMs?.key);
    const prev = idx > 0 ? ms[idx - 1] : undefined;
    const prevEnd = prev?.actualEndDate
      || (prev ? (prev.forecastEndDate || prev.committedBaselineEndDate) : undefined);
    setSelectedStageKey(lineActiveMs?.key || 'production');
    setStatusAction('In Progress');
    setCompletionDate(clampDateMax(prevEnd || lineActiveMs?.committedBaselineStartDate || today, today));
  };

  const handleStageSelect = (stageKey: string) => {
    setSelectedStageKey(stageKey);
    const msIdx = milestones.findIndex(m => m.key === stageKey);
    const prev = msIdx > 0 ? milestones[msIdx - 1] : undefined;
    // Authoritative: prefer actualEndDate so chain is pinned to real events
    const prevActualEnd = prev?.actualEndDate;
    const prevEnd = prevActualEnd || (prev ? (prev.forecastEndDate || prev.committedBaselineEndDate) : undefined);
    const targetMs = milestones[msIdx];
    if (statusAction === 'In Progress') {
      setCompletionDate(clampDateMax(prevEnd || targetMs?.committedBaselineStartDate || today, today));
    } else {
      // Actual completion dates can never be in the future.
      setCompletionDate(clampDateMax(targetMs?.forecastEndDate || targetMs?.committedBaselineEndDate || today, today));
    }
  };

  const handleActionSelect = (action: 'In Progress' | 'Completed') => {
    setStatusAction(action);
    if (action === 'In Progress') {
      // Start date must be >= previous milestone's end date
      setCompletionDate(clampDateMax(previousMsEnd || currentMs?.committedBaselineStartDate || today, today));
    } else {
      setCompletionDate(clampDateMax(currentMs?.forecastEndDate || currentMs?.committedBaselineEndDate || today, today));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // Chain anchor clamped to today: a previous milestone whose planned end is
    // in the future must not dead-end the picker (no valid date would exist).
    const previousMsEndAnchor = previousMsEnd && previousMsEnd <= today ? previousMsEnd : undefined;

    if (statusAction === 'In Progress' && previousMsEndAnchor && completionDate < previousMsEndAnchor) {
      setErrorMsg(`Start date cannot be earlier than previous milestone's end date (${previousMsEndAnchor}).`);
      return;
    }

    if (statusAction === 'Completed' && currentMsStart && completionDate < currentMsStart) {
      setErrorMsg(`Completion date cannot be earlier than milestone's start date (${currentMsStart}).`);
      return;
    }

    const effectiveNotes = delayReasonInput.trim()
      ? `${workNotes ? workNotes + ' | ' : ''}Actual Delay Reason: ${delayReasonInput.trim()}`
      : workNotes;

    const res = updateOrderStatus({
      poId: po.id,
      productLineId: selectedLine?.id,
      stageKey: selectedStageKey,
      statusAction,
      workNotes: effectiveNotes,
      completionDate,
      user: `${activeRole} Operator`
    });

    if (res.success) {
      onClose();
    } else {
      setErrorMsg(res.error || 'Failed to update status');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-slate-50 p-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">Update Order Status</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {po.poNumber} — <span className="font-bold text-slate-800">{po.customerName}</span>
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 font-medium">
              {errorMsg}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">Current Status</span>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${
                summary.isDelayed ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                {summary.isDelayed ? 'Delayed' : 'On Track'}
              </span>
            </div>
            <div className="text-slate-700">{summary.currentStageName}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500">
              <span>Started: <strong className="text-slate-700">{activeMs?.actualStartDate || 'Not started'}</strong></span>
              <span>Completed: <strong className="text-slate-700">{activeMs?.actualEndDate || 'Not completed'}</strong></span>
            </div>
            {summary.isDelayed && (
              <div className="text-[11px] text-rose-700 font-semibold">
                Delay: {summary.delayedStageName || summary.currentStageName} ({summary.delayDays > 0 ? `+${summary.delayDays} days` : 'calculated'})
              </div>
            )}
          </div>

          {/* Select Product Line (multi-line POs have independent chains) */}
          {lines.length > 1 && (
            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 flex items-center justify-between">
                <span>Select Product Line</span>
                <span className="text-[10px] font-mono text-slate-400">Each line has its own flow</span>
              </label>
              <select
                value={selectedLine?.id}
                onChange={(e) => handleLineSelect(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer text-xs"
              >
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.lineNumber}: {line.productName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Select Manufacturing Stage */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900 flex items-center justify-between">
              <span>Select Work Stage</span>
              <span className="text-[10px] font-mono text-slate-400">Active Uncompleted Stage</span>
            </label>
            <select
              value={selectedStageKey}
              onChange={(e) => handleStageSelect(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer text-xs"
            >
              {finalStages.map((st) => (
                <option key={st.key} value={st.key}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>

          {statusAction === 'In Progress' && previousMs && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] space-y-1">
              <div className="font-bold text-slate-800">Previous milestone: {previousMs.name}</div>
              <div className="text-slate-500">
                Planned end: <strong className="text-slate-700">{previousMs.committedBaselineEndDate || 'Not scheduled'}</strong>
              </div>
              {(previousMs.actualEndDate || previousMs.forecastEndDate) && (previousMs.actualEndDate || previousMs.forecastEndDate || '') > previousMs.committedBaselineEndDate && (
                <div className="text-rose-700 font-semibold">
                  Delayed end: {previousMs.actualEndDate || previousMs.forecastEndDate}
                </div>
              )}
            </div>
          )}

          {/* Milestone Schedule Info (Planned days & Revised Target dates) */}
          {currentMs && (() => {
            const bStart = currentMs.committedBaselineStartDate || po.poDate;
            const bEnd = currentMs.committedBaselineEndDate || po.committedDeliveryDate;
            const dur = Math.max(1, currentMs.committedDurationDays || 1);
            const planDuration = (bStart && bEnd) ? Math.max(1, getDaysDifference(bStart, bEnd)) : dur;

            const prevEffectiveEnd = previousMs ? (previousMs.actualEndDate || previousMs.forecastEndDate) : undefined;
            const revStart = currentMs.actualStartDate || ((bStart && prevEffectiveEnd && prevEffectiveEnd > bStart) ? prevEffectiveEnd : bStart);
            const startShift = (bStart && revStart && revStart > bStart) ? getDaysDifference(bStart, revStart) : 0;
            const revEnd = startShift > 0 && revStart ? addDays(revStart, planDuration) : bEnd;

            return (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between text-slate-700">
                  <span>Planned Baseline: <strong className="text-slate-900">{bStart} &rarr; {bEnd}</strong></span>
                  <span className="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 text-[10px]">
                    {planDuration} days planned
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                  <span className={startShift > 0 ? "text-amber-800" : "text-emerald-700"}>
                    Revised Target: <strong className={startShift > 0 ? "text-amber-950" : "text-emerald-900"}>{revStart} &rarr; {revEnd}</strong>
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    startShift > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                  }`}>
                    {startShift > 0 ? `+${startShift}d shift from previous delay` : 'On original baseline'}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Event Date */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900 flex items-center justify-between">
              <span>{statusAction === 'Completed' ? 'Completion Date' : 'Start Date'}</span>
              <span className="text-[10px] font-mono text-slate-500">Delay is calculated automatically</span>
            </label>
            <input
              type="date"
              min={inputMin}
              value={completionDate || today}
              onChange={(e) => setCompletionDate(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 text-xs font-mono"
            />
          </div>

          {/* Select Status Action */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900">Work Condition / Action</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleActionSelect('In Progress')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  statusAction === 'In Progress'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Play className="w-3.5 h-3.5" /> In Progress
              </button>

              <button
                type="button"
                onClick={() => handleActionSelect('Completed')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  statusAction === 'Completed'
                    ? 'bg-emerald-700 border-emerald-800 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Stage Complete
              </button>

            </div>
          </div>

          {/* Delay Reason Field - Clearly distinguishing new stage delays vs inherited delays */}
          {currentMs && Boolean(
            (statusAction === 'In Progress' && currentMs.committedBaselineStartDate && completionDate > currentMs.committedBaselineStartDate) ||
            (statusAction !== 'In Progress' && currentMs.committedBaselineEndDate && completionDate > currentMs.committedBaselineEndDate)
          ) && (
            (() => {
              const prevEffectiveEnd = previousMs ? (previousMs.actualEndDate || previousMs.forecastEndDate) : undefined;
              const baselineStart = currentMs.committedBaselineStartDate;
              const baselineEnd = currentMs.committedBaselineEndDate;

              let totalDelay = 0;
              let netInheritedDelay = 0;
              let newDelayFormed = 0;

              if (statusAction === 'In Progress') {
                totalDelay = (baselineStart && completionDate > baselineStart)
                  ? getDaysDifference(baselineStart, completionDate)
                  : 0;
                netInheritedDelay = (baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart)
                  ? Math.min(totalDelay, getDaysDifference(baselineStart, prevEffectiveEnd))
                  : 0;
                newDelayFormed = Math.max(0, totalDelay - netInheritedDelay);
              } else {
                totalDelay = (baselineEnd && completionDate > baselineEnd)
                  ? getDaysDifference(baselineEnd, completionDate)
                  : 0;
                const effectiveStart = currentMs.actualStartDate || ((baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart) ? prevEffectiveEnd : baselineStart);
                const startDelay = (baselineStart && effectiveStart && effectiveStart > baselineStart)
                  ? getDaysDifference(baselineStart, effectiveStart)
                  : 0;
                netInheritedDelay = Math.min(totalDelay, startDelay);
                newDelayFormed = Math.max(0, totalDelay - netInheritedDelay);
              }

              const prevMilestones = milestones.slice(0, selectedMsIndex);
              const prevDelaysList = prevMilestones
                .map((m, mIdx) => {
                  const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                  const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                  const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                  const stageDelta = currVar - prevVar;
                  return { ...m, calculatedDelayDays: stageDelta };
                })
                .filter(m => m.calculatedDelayDays > 0);

              if (newDelayFormed > 0) {
                return (
                  <div className="space-y-2 p-3.5 bg-rose-50/90 border border-rose-300 rounded-xl">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-rose-950 text-xs flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        <span>New Delay Formed on Stage {currentMs.stageOrder}: <strong className="text-rose-700 font-mono">+{newDelayFormed}d Added</strong></span>
                      </label>
                      {netInheritedDelay > 0 && (
                        <span className="text-[10px] font-mono text-slate-500">
                          (+{netInheritedDelay}d prior inherited)
                        </span>
                      )}
                    </div>

                    {netInheritedDelay > 0 && prevDelaysList.length > 0 && (
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

                    <input
                      type="text"
                      placeholder={`Reason for +${newDelayFormed}d delay formed on Stage ${currentMs.stageOrder} *`}
                      value={delayReasonInput}
                      onChange={(e) => setDelayReasonInput(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-xs text-slate-900 font-bold focus:outline-none focus:border-rose-600 placeholder:font-normal placeholder:text-rose-400"
                      required
                    />
                  </div>
                );
              }

              return (
                <div className="space-y-2 p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-blue-950 text-xs flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-blue-600" />
                      <span>Preceding Delay: <strong className="text-rose-700 font-mono">+{netInheritedDelay}d Inherited</strong> (No new delay caused by Stage {currentMs.stageOrder})</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-300">
                      Total Delay: +{totalDelay}d
                    </span>
                  </div>

                  {prevDelaysList.length > 0 && (
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
                  )}

                  <input
                    type="text"
                    placeholder="Optional remarks or notes..."
                    value={delayReasonInput}
                    onChange={(e) => setDelayReasonInput(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600 font-medium placeholder:text-slate-400"
                  />
                </div>
              );
            })()
          )}

          {/* Work Description / Notes */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900">
              Work Notes / Status Description
            </label>
            <textarea
              rows={3}
              placeholder="Describe current shop-floor work or delay reasons..."
              value={workNotes}
              onChange={(e) => setWorkNotes(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-medium placeholder:text-slate-400"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4 text-emerald-200" />
              <span>Save Status Update</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
