import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { X, AlertTriangle, ShieldCheck, CheckCircle2, RefreshCw } from 'lucide-react';
import type { PurchaseOrder } from '../../types';
import { addDays, todayLocal } from '../../services/calculationEngine';

type FlowMilestone = {
  key: string;
  name: string;
  durationDays: number;
};

interface BaselineRevisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
}

export const BaselineRevisionModal: React.FC<BaselineRevisionModalProps> = ({
  isOpen,
  onClose,
  po
}) => {
  const { addBaselineRevision, activeRole, canDo } = useApp();
  // We allow submission for anyone; the backend enforces they only edit their owned milestones.
  const isOwnerOrAdmin = activeRole === 'Project Management' || canDo('canApproveBaseline');

  const today = todayLocal();

  const [reason, setReason] = useState<string>('');
  const [flowMode, setFlowMode] = useState<'recommended' | 'custom'>('recommended');
  const [baselineStartDate, setBaselineStartDate] = useState<string>(today);
  const [durationChanges, setDurationChanges] = useState<{ [key: string]: number }>({});
  const [customFlows, setCustomFlows] = useState<Record<string, FlowMilestone[]>>({});
  const [draggedMilestone, setDraggedMilestone] = useState<{ lineId: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const initialStart = po.productLines[0]?.milestones[0]?.committedBaselineStartDate || po.poDate || todayLocal();
    setReason('');
    setFlowMode('recommended');
    setBaselineStartDate(initialStart);
    setError(null);
    setDraggedMilestone(null);

    const initialMap: { [key: string]: number } = {};
    po.productLines.forEach(line => {
      line.milestones.forEach(ms => {
        initialMap[`${line.id}_${ms.key}`] = ms.committedDurationDays;
      });
    });
    setDurationChanges(initialMap);

    const initialFlows: Record<string, FlowMilestone[]> = {};
    po.productLines.forEach(line => {
      initialFlows[line.id] = line.milestones.map(ms => ({
        key: ms.key,
        name: ms.name,
        durationDays: ms.committedDurationDays
      }));
    });
    setCustomFlows(initialFlows);
  }, [isOpen, po.id]);

  if (!isOpen) return null;

  // Determine if this is the initial baseline approval or a re-revision
  const isInitialApproval = po.status === 'Baseline Pending';
  // Actual shop-floor execution has started if any downstream stage (stageOrder > 2) has recorded actual start/end dates
  const flowAlreadyStarted = !isInitialApproval && po.productLines.some(line =>
    line.milestones.some(ms => ms.stageOrder > 2 && Boolean(ms.actualStartDate || ms.actualEndDate))
  );

  const handleDurationChange = (lineId: string, milestoneKey: string, val: number) => {
    setDurationChanges(prev => ({
      ...prev,
      [`${lineId}_${milestoneKey}`]: Math.max(1, val)
    }));
  };

  const updateCustomMilestone = (lineId: string, key: string, changes: Partial<FlowMilestone>) => {
    setCustomFlows(prev => ({
      ...prev,
      [lineId]: (prev[lineId] || []).map(ms => ms.key === key ? { ...ms, ...changes } : ms)
    }));
  };

  const addCustomMilestone = (lineId: string) => {
    const key = `custom_${lineId}_${Date.now()}`;
    setCustomFlows(prev => ({
      ...prev,
      [lineId]: [...(prev[lineId] || []), { key, name: 'New milestone', durationDays: 1 }]
    }));
  };

  const deleteCustomMilestone = (lineId: string, key: string) => {
    setCustomFlows(prev => ({
      ...prev,
      [lineId]: (prev[lineId] || []).filter(ms => ms.key !== key)
    }));
  };

  const reorderCustomMilestone = (lineId: string, targetKey: string) => {
    if (!draggedMilestone || draggedMilestone.lineId !== lineId || draggedMilestone.key === targetKey) return;

    setCustomFlows(prev => {
      const flow = [...(prev[lineId] || [])];
      const sourceIndex = flow.findIndex(ms => ms.key === draggedMilestone.key);
      const targetIndex = flow.findIndex(ms => ms.key === targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const [moved] = flow.splice(sourceIndex, 1);
      flow.splice(targetIndex, 0, moved);
      return { ...prev, [lineId]: flow };
    });
    setDraggedMilestone(null);
  };

  const nextRevNum = po.revisions.length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (flowAlreadyStarted) {
      setError('Cannot revise baseline after actual work has started. Update milestones through the production modules.');
      return;
    }

    // Custom flows must stay valid: at least one milestone per line, durations >= 1 day.
    if (flowMode === 'custom') {
      const emptyLine = po.productLines.find(line => (customFlows[line.id] || []).length === 0);
      if (emptyLine) {
        setError(`Custom flow for ${emptyLine.lineNumber} must contain at least one milestone.`);
        return;
      }
      const invalidDuration = po.productLines
        .flatMap(line => customFlows[line.id] || [])
        .find(ms => !Number.isFinite(ms.durationDays) || ms.durationDays < 1);
      if (invalidDuration) {
        setError(`Duration for milestone '${invalidDuration.name}' must be at least 1 day.`);
        return;
      }
    }

    // Build list of changed durations (empty is allowed — locking Rev 0 without changes)
    const changesList: { lineId: string; milestoneKey: string; newDuration: number }[] = [];

    po.productLines.forEach(line => {
      line.milestones.forEach(ms => {
        const key = `${line.id}_${ms.key}`;
        const newDur = durationChanges[key];
        if (newDur !== undefined && newDur !== ms.committedDurationDays) {
          changesList.push({
            lineId: line.id,
            milestoneKey: ms.key,
            newDuration: newDur
          });
        }
      });
    });

    const res = addBaselineRevision({
      poId: po.id,
      reason: reason.trim() || (isInitialApproval ? 'Baseline reviewed and approved.' : `Baseline re-revised (Rev ${nextRevNum}).`),
      docRef: `BL-REV-${nextRevNum}-${today.replace(/-/g, '')}`,
      user: `${activeRole} User`,
      baselineStartDate,
      changes: changesList,
      milestoneFlows: flowMode === 'custom'
        ? po.productLines.map(line => ({ lineId: line.id, milestones: customFlows[line.id] || [] }))
        : undefined
    });

    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Failed to lock baseline revision');
    }
  };

  const getSchedule = (line: PurchaseOrder['productLines'][number]) => {
    const flow = flowMode === 'custom'
      ? customFlows[line.id] || []
      : line.milestones.map(ms => ({ key: ms.key, name: ms.name, durationDays: durationChanges[`${line.id}_${ms.key}`] || ms.committedDurationDays }));
    let nextStart = baselineStartDate || line.milestones[0]?.committedBaselineStartDate || today;

    return flow.map((milestone, index) => {
      const startDate = nextStart;
      const endDate = addDays(startDate, Math.max(1, milestone.durationDays));
      nextStart = endDate;
      return { ...milestone, index, startDate, endDate };
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] text-slate-800">
        
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 text-base">
                {isInitialApproval ? 'Approve Initial Baseline' : `Issue Baseline Re-Revision (Rev ${nextRevNum})`}
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border ${
                isInitialApproval
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}>
                {isInitialApproval ? 'INITIAL APPROVAL' : 'RE-BASELINE'}
              </span>
              {flowAlreadyStarted && (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 font-mono text-[10px] font-bold border border-rose-200">
                  FLOW STARTED — READ ONLY
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">PO: {po.poNumber} | Customer: {po.customerName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center text-xs">
            <div>
              <span className="text-slate-500">Current Revision:</span>
              <strong className="text-emerald-800 font-mono ml-1">
                {isInitialApproval ? 'None (Pending)' : `Rev ${po.revisions.length - 1}`}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Approver Role:</span> <strong className="text-emerald-700">{activeRole}</strong>
            </div>
          </div>

          {flowAlreadyStarted && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-xs text-rose-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div>
                <p className="font-bold">Re-baseline not available — actual work has already started.</p>
                <p className="mt-0.5 text-rose-700">One or more milestones have actual start/end dates recorded. The approved baseline schedule is now locked. Use the production modules to track progress against the existing plan.</p>
              </div>
            </div>
          )}

          {!isInitialApproval && !flowAlreadyStarted && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-xs text-amber-800">
              <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <p className="font-bold">Re-Baseline Revision — Rev {nextRevNum}</p>
                <p className="mt-0.5">You are modifying the approved baseline schedule. This will update all committed dates. Provide a clear negotiation reason below.</p>
              </div>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Baseline Start Date
            </label>
            <input
              type="date"
              value={baselineStartDate}
              onChange={(e) => setBaselineStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:border-emerald-600"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {isInitialApproval ? 'Notes' : 'Re-Baseline Negotiation Reason'}
              {!isInitialApproval && <span className="text-rose-600 ml-1">*</span>}
              {isInitialApproval && <span className="text-slate-400 font-normal"> (Optional)</span>}
            </label>
            <input
              type="text"
              disabled={flowAlreadyStarted}
              placeholder={isInitialApproval ? 'e.g. Baseline reviewed and confirmed with customer' : 'e.g. Customer approved scope extension — engineering review required'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-slate-700">Milestone Flow</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFlowMode('recommended')}
                className={`px-3 py-2 rounded-lg border text-left text-xs font-semibold cursor-pointer ${flowMode === 'recommended' ? 'bg-emerald-50 border-emerald-500 text-emerald-800' : 'bg-white border-slate-200 text-slate-600'}`}
              >
                Recommended Flow
                <span className="block text-[10px] font-normal text-slate-500 mt-0.5">Use the product schedule</span>
              </button>
              <button
                type="button"
                onClick={() => setFlowMode('custom')}
                className={`px-3 py-2 rounded-lg border text-left text-xs font-semibold cursor-pointer ${flowMode === 'custom' ? 'bg-emerald-50 border-emerald-500 text-emerald-800' : 'bg-white border-slate-200 text-slate-600'}`}
              >
                Custom Flow
                <span className="block text-[10px] font-normal text-slate-500 mt-0.5">Edit or add milestones</span>
              </button>
            </div>
          </div>

          {/* Product Lines & Milestones Duration Editor */}
          <div className="space-y-4">
            <h4 className="font-bold text-emerald-800 uppercase tracking-wider text-[11px]">
              Negotiated Milestone Durations (Days)
            </h4>

            {po.productLines.map(line => (
              <div key={line.id} className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 font-bold text-slate-900 flex justify-between">
                  <span>{line.lineNumber}: {line.productName}</span>
                  <span className="text-[10px] text-slate-500 font-normal">Type: {line.designType}</span>
                </div>

                <div className="p-4 divide-y divide-slate-200">
                  {(flowMode === 'custom' ? customFlows[line.id] || [] : line.milestones.map(ms => ({ key: ms.key, name: ms.name, durationDays: ms.committedDurationDays }))).map(ms => {
                    const originalMs = line.milestones.find(item => item.key === ms.key);
                    const key = `${line.id}_${ms.key}`;
                    const currentDur = flowMode === 'custom' ? ms.durationDays : (durationChanges[key] || ms.durationDays);
                    const diff = originalMs ? currentDur - originalMs.committedDurationDays : currentDur;

                    return (
                      <div
                        key={ms.key}
                        draggable={flowMode === 'custom'}
                        onDragStart={() => setDraggedMilestone({ lineId: line.id, key: ms.key })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => reorderCustomMilestone(line.id, ms.key)}
                        className={`py-2.5 flex items-center justify-between gap-3 text-xs ${flowMode === 'custom' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <div className="flex-1">
                          {flowMode === 'custom' ? (
                            <input
                              value={ms.name}
                              onChange={(e) => updateCustomMilestone(line.id, ms.key, { name: e.target.value })}
                              className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                            />
                          ) : (
                            <span className="font-semibold text-slate-800">{ms.name}</span>
                          )}
                          <span className="text-[10px] text-slate-500 ml-2">Recommended: {originalMs?.committedDurationDays || ms.durationDays}d</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {flowMode === 'custom' && (
                            <button
                              type="button"
                              onClick={() => deleteCustomMilestone(line.id, ms.key)}
                              title="Delete milestone"
                              className="p-1 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <span className="text-[11px] text-slate-500 font-mono">Duration:</span>
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={currentDur}
                            disabled={flowMode === 'recommended'}
                            onChange={(e) => flowMode === 'custom'
                              ? updateCustomMilestone(line.id, ms.key, { durationDays: parseInt(e.target.value) || 1 })
                              : handleDurationChange(line.id, ms.key, parseInt(e.target.value) || 1)}
                            className="w-16 px-2 py-1 bg-white border border-slate-200 rounded-lg text-center text-xs font-mono text-emerald-800 font-bold"
                          />
                          <span className={`w-12 text-center text-[11px] font-mono font-bold ${
                            diff > 0 ? 'text-rose-700' : diff < 0 ? 'text-emerald-700' : 'text-slate-400'
                          }`}>
                            {diff > 0 ? `+${diff}d` : diff < 0 ? `${diff}d` : '0d'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {flowMode === 'custom' && (
                  <button
                    type="button"
                    onClick={() => addCustomMilestone(line.id)}
                    className="w-full px-4 py-2 border-t border-slate-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                  >
                    + Add milestone
                  </button>
                )}

                <div className="border-t border-slate-200 bg-white p-4 space-y-2">
                  <h5 className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">Calculated Schedule</h5>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 text-[11px]">
                    <div className="font-semibold text-slate-500">Milestone</div>
                    <div className="font-semibold text-slate-500">Duration</div>
                    <div className="font-semibold text-slate-500">Start</div>
                    <div className="font-semibold text-slate-500">End</div>
                    {getSchedule(line).map(milestone => (
                      <React.Fragment key={`schedule-${milestone.key}`}>
                        <div className="text-slate-700 truncate">{milestone.index + 1}. {milestone.name}</div>
                        <div className="font-mono text-slate-600">{milestone.durationDays}d</div>
                        <div className="font-mono text-slate-600">{milestone.startDate}</div>
                        <div className="font-mono font-semibold text-emerald-700">{milestone.endDate}</div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!flowAlreadyStarted && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-slate-700 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                {isInitialApproval
                  ? `Approving will lock Rev ${nextRevNum} and release this order to all shop-floor modules.`
                  : `Saving will lock Re-Baseline Rev ${nextRevNum} and recalculate all committed dates.`
                }
              </span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer"
            >
              {flowAlreadyStarted ? 'Close' : 'Cancel'}
            </button>
            {!flowAlreadyStarted && (
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                {isInitialApproval ? (
                  <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" /> Approve Baseline & Start Progress</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5 text-emerald-200" /> Save Re-Baseline Rev {nextRevNum}</>
                )}
              </button>
            )}
            {!isOwnerOrAdmin && !flowAlreadyStarted && (
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                You can only revise durations for your assigned stages.
              </div>
            )}
          </div>

        </form>

      </div>
    </div>
  );
};
