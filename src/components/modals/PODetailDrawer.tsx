import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { 
  X, 
  AlertTriangle, 
  Lock, 
  Package, 
  Wrench, 
  Play, 
  CheckSquare,
  CheckCircle2,
  Edit3,
  XCircle,
  ShieldAlert
} from 'lucide-react';
import { getPOManufacturingStatus, getStageFriendlyName } from '../../utils/statusUtils';
import { BaselineRevisionModal } from './BaselineRevisionModal';

interface PODetailDrawerProps {
  po: PurchaseOrder | null;
  onClose: () => void;
  onOpenManualInput: (po: PurchaseOrder, line: any, ms: any, type: 'start' | 'complete') => void;
  onOpenCancelModal?: (po: PurchaseOrder) => void;
}

export const PODetailDrawer: React.FC<PODetailDrawerProps> = ({
  po,
  onClose,
  onOpenManualInput,
  onOpenCancelModal
}) => {
  const { activeRole, closePurchaseOrder } = useApp();
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [closureNotes, setClosureNotes] = useState('');
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [closeNoteError, setCloseNoteError] = useState(false);
  const [selectedLineIndex, setSelectedLineIndex] = useState(0);

  const [closureError, setClosureError] = useState<string | null>(null);

  if (!po) return null;

  const statusSummary = getPOManufacturingStatus(po);
  const activeLineIndex = Math.min(selectedLineIndex, (po.productLines?.length || 1) - 1);
  const selectedLine = po.productLines[activeLineIndex] || po.productLines[0];

  const delayedLines = (po.productLines || []).filter(l => l.status === 'Delayed' || (l.overallVarianceDays && l.overallVarianceDays > 0));
  const onTrackLines = (po.productLines || []).filter(l => l.status !== 'Delayed' && (!l.overallVarianceDays || l.overallVarianceDays <= 0));

  const allMilestonesComplete = po.productLines.every(line =>
    line.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate))
  );

  const canClosePO = activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)';
  const canReviseBaseline = activeRole === 'Project Manager (PM Baseline)';
  const isAdmin = activeRole === 'Project Management';
  const hasPendingCancel = po.cancellationRequest?.status === 'Pending';

  const handleClosePO = () => {
    if (!closureNotes.trim()) {
      setCloseNoteError(true);
      return;
    }
    setCloseNoteError(false);
    const result = closePurchaseOrder(po.id, closureNotes, `${activeRole} User`);
    if (!result.success) {
      setClosureError(result.error || 'Failed to close order');
      return;
    }
    setClosureError(null);
    setShowClosePrompt(false);
    // Close the drawer so updated status is visible across tabs
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 flex justify-end">
        <div className="w-full max-w-2xl bg-white border-l border-slate-200 h-full flex flex-col shadow-2xl text-slate-800">
          
          {/* Header */}
          <div className="bg-slate-50 p-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-extrabold text-slate-900 text-lg">{po.poNumber}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                  po.status === 'Cancelled' || po.isCancelled ? 'bg-rose-100 border-rose-300 text-rose-800' :
                  statusSummary.isDelayed ? 'bg-rose-50 border-rose-200 text-rose-800' :
                  po.isClosed ? 'bg-slate-100 border-slate-200 text-slate-600' :
                  'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  {po.status === 'Cancelled' || po.isCancelled ? 'CANCELLED' : statusSummary.isDelayed ? `DELAYED (+${statusSummary.delayDays}d)` : po.isClosed ? 'CLOSED' : 'ON TIME'}
                </span>
                {hasPendingCancel && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 font-mono text-[10px] font-bold flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3 text-amber-600" /> CANCEL PENDING
                  </span>
                )}
                {po.isClosed && (
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-mono text-[10px] flex items-center gap-1">
                    <Lock className="w-3 h-3" /> CLOSED
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Customer: <span className="font-semibold text-slate-800">{po.customerName}</span> | Ref: {po.customerPoRef}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {canReviseBaseline && !po.isClosed && po.status !== 'Cancelled' && (
                <button
                  onClick={() => setShowRevisionModal(true)}
                  className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <Wrench className="w-3.5 h-3.5" /> Baseline Edit
                </button>
              )}

              {canClosePO && !po.isClosed && po.status !== 'Cancelled' && (
                <button
                  onClick={() => setShowClosePrompt(true)}
                  className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Close Order
                </button>
              )}

              {onOpenCancelModal && !po.isClosed && po.status !== 'Cancelled' && (
                <button
                  onClick={() => onOpenCancelModal(po)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1 border ${
                    hasPendingCancel
                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
                      : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                  }`}
                  title={isAdmin ? 'Decide on cancellation or cancel/delete order' : 'Request order cancellation with reason'}
                >
                  {hasPendingCancel ? (
                    <>
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      <span>{isAdmin ? 'Review Cancel' : 'Cancel Pending'}</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                      <span>{isAdmin ? 'Cancel / Delete' : 'Request Cancel'}</span>
                    </>
                  )}
                </button>
              )}

              <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50 text-xs">

            {/* PENDING CANCELLATION REQUEST BANNER */}
            {hasPendingCancel && po.cancellationRequest && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-amber-900 text-xs flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    Cancellation Request Awaiting Administrator Decision
                  </span>
                  {onOpenCancelModal && (
                    <button
                      onClick={() => onOpenCancelModal(po)}
                      className="px-2.5 py-1 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer"
                    >
                      {isAdmin ? 'Decide & Review' : 'View Request'}
                    </button>
                  )}
                </div>
                <div className="bg-white/80 p-3 rounded-lg border border-amber-200 text-slate-800 text-xs space-y-1">
                  <div className="font-semibold text-slate-900">
                    Reason: <span className="font-normal italic text-slate-700">"{po.cancellationRequest.reason}"</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Requested by: <span className="font-bold text-slate-700">{po.cancellationRequest.requestedBy}</span> ({po.cancellationRequest.requestedRole}) at {new Date(po.cancellationRequest.requestedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* CANCELLED ORDER BANNER */}
            {(po.status === 'Cancelled' || po.isCancelled) && (
              <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl space-y-1.5 shadow-xs">
                <div className="font-bold text-rose-900 text-xs flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 text-rose-600" />
                  Order Cancelled & Archived
                </div>
                <p className="text-slate-700 text-xs">
                  Reason: <span className="font-semibold italic text-slate-900">{po.cancellationReason || po.cancellationRequest?.reason || 'Cancelled by Administrator'}</span>
                </p>
                {po.cancelledBy && (
                  <p className="text-[10px] text-slate-500 font-mono">
                    Cancelled by {po.cancelledBy} on {po.cancelledAt ? new Date(po.cancelledAt).toLocaleString() : 'N/A'}
                  </p>
                )}
              </div>
            )}

            {showClosePrompt && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3 text-xs shadow-xs">
                <div className="font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" /> Confirm Order Closure
                </div>
                {!allMilestonesComplete ? (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 font-medium">
                    ⚠️ Cannot close order: Not all milestones have been completed across the product lines. Please complete all preceding milestones (such as dispatch and site delivery) first.
                  </div>
                ) : (
                  <p className="text-slate-700">
                    Closing this order locks all stages. Add closure notes below.
                  </p>
                )}
                <input
                  type="text"
                  disabled={!allMilestonesComplete}
                  placeholder="e.g. Delivered & signed off by customer on site — ref: DO-2026-09"
                  value={closureNotes}
                  onChange={(e) => { setClosureNotes(e.target.value); setCloseNoteError(false); }}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-xs text-slate-800 focus:outline-none ${!allMilestonesComplete ? 'opacity-50 cursor-not-allowed bg-slate-100' : closeNoteError ? 'border-rose-400 ring-1 ring-rose-300' : 'border-slate-200 focus:border-emerald-600'}`}
                />
                {closeNoteError && (
                  <p className="text-rose-700 text-[11px] font-semibold">Closure notes are required before closing.</p>
                )}
                {closureError && (
                  <p className="text-rose-700 text-[11px] font-semibold">{closureError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setShowClosePrompt(false); setCloseNoteError(false); setClosureError(null); }} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-medium cursor-pointer">
                    Cancel
                  </button>
                  <button
                    disabled={!allMilestonesComplete}
                    onClick={handleClosePO}
                    className={`px-3.5 py-1.5 rounded-lg font-bold shadow-xs ${allMilestonesComplete ? 'bg-amber-700 hover:bg-amber-800 text-white cursor-pointer' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
                  >
                    Confirm & Close Order
                  </button>
                </div>
              </div>
            )}

            {/* TIMELINE VALIDATION & SCHEDULE HEALTH CHECK STEP */}
            <div className={`p-4 rounded-xl border text-xs flex items-center justify-between gap-3 shadow-2xs ${
              statusSummary.timelineValidationStatus === 'CLOSED' ? 'bg-slate-100 border-slate-300 text-slate-700' :
              statusSummary.timelineValidationStatus === 'REQUIRES_REVISION_DELAYED' ? 'bg-rose-50 border-rose-200 text-rose-900' :
              'bg-emerald-50/90 border-emerald-200 text-emerald-950'
            }`}>
              <div className="flex items-center gap-2.5">
                {statusSummary.timelineValidationStatus === 'REQUIRES_REVISION_DELAYED' ? (
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                )}
                <div>
                  <div className="font-bold text-slate-900">
                    Step: Timeline Validation — {statusSummary.timelineValidationStatus === 'REQUIRES_REVISION_DELAYED' ? 'Delay Recorded — See Baseline for Reason' : 'Timeline Validated & On Track'}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">{statusSummary.timelineMessage}</p>
                </div>
              </div>

              {!po.isClosed && canReviseBaseline && (
                <button
                  onClick={() => setShowRevisionModal(true)}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold text-[11px] rounded-lg shrink-0 cursor-pointer shadow-2xs"
                >
                  {po.status === 'Baseline Pending' ? 'Approve Baseline' : statusSummary.isDelayed ? 'Review Baseline' : `Rev ${statusSummary.lastRevNum} Validated`}
                </button>
              )}
            </div>

            {/* MULTI-PRODUCT LINE SWITCHER TABS & ISOLATION */}
            {po.productLines && po.productLines.length > 1 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-emerald-700" />
                    Product Lines in this Order ({po.productLines.length})
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Select a product to view independent milestone track</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {po.productLines.map((line, idx) => {
                    const isSelected = idx === activeLineIndex;
                    const isLineDelayed = line.status === 'Delayed' || (line.overallVarianceDays && line.overallVarianceDays > 0);
                    const lineCompletedCount = (line.milestones || []).filter(m => m.status === 'Completed' || Boolean(m.actualEndDate)).length;

                    return (
                      <button
                        key={line.id || idx}
                        onClick={() => setSelectedLineIndex(idx)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-400/30 shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <span className="font-bold text-slate-900 text-xs line-clamp-1" title={line.productName}>
                            #{idx + 1} {line.productName}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 border ${
                            isLineDelayed
                              ? 'bg-rose-100 border-rose-300 text-rose-800'
                              : line.status === 'Completed'
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                              : 'bg-slate-200 border-slate-300 text-slate-700'
                          }`}>
                            {isLineDelayed ? `+${line.overallVarianceDays || 3}d Delay` : line.status || 'On Track'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-200/60">
                          <span>Qty: {line.qty || 1}</span>
                          <span>{lineCompletedCount}/14 Stages</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Delay Isolation Notice when only some products are delayed */}
                {delayedLines.length > 0 && onTrackLines.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> Multi-Product Schedule Variance Isolation:
                    </div>
                    <p className="text-[11px] text-slate-700 leading-relaxed">
                      Delay is isolated to <strong className="text-rose-800">{delayedLines.map(l => l.productName).join(', ')}</strong> (+{Math.max(...delayedLines.map(l => l.overallVarianceDays || 0))}d). Meanwhile, <strong className="text-emerald-800">{onTrackLines.map(l => l.productName).join(', ')}</strong> {onTrackLines.length === 1 ? 'is' : 'are'} on track with no schedule impact.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* LIVE MANUFACTURING CURRENT STATUS HERO CARD */}
            <div className={`p-5 rounded-2xl border shadow-xs space-y-4 ${
              (selectedLine?.status === 'Delayed' || (selectedLine?.overallVarianceDays && selectedLine?.overallVarianceDays > 0))
                ? 'bg-rose-500/5 border-rose-200 text-rose-900'
                : 'bg-emerald-500/5 border-emerald-200 text-emerald-950'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-slate-500">
                  CURRENT LIVE STATUS ({selectedLine?.productName})
                </span>
                <span className="text-xs font-mono font-bold text-slate-600">
                  Target Deadline: <span className="text-slate-900">{po.revisedDeliveryDate || po.committedDeliveryDate}</span>
                </span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-600 animate-ping"></span>
                    <h3 className="text-lg font-black tracking-tight text-slate-900">
                      {(() => {
                        const activeMs = selectedLine?.milestones.find(m => m.status !== 'Completed' && !m.actualEndDate);
                        return activeMs ? getStageFriendlyName(activeMs.key, selectedLine) : 'Delivered & Completed';
                      })()}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    Line #{activeLineIndex + 1}: <span className="font-semibold text-slate-800">{selectedLine?.productName}</span> ({selectedLine?.designType}) • Qty: {selectedLine?.qty || 1}
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-black font-mono text-emerald-700">
                    {Math.round(((selectedLine?.milestones.filter(m => m.status === 'Completed' || Boolean(m.actualEndDate)).length || 0) / 14) * 100)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">Line Completed</div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                <div 
                  className={`h-2.5 rounded-full transition-all duration-500 ${
                    (selectedLine?.status === 'Delayed' || (selectedLine?.overallVarianceDays && selectedLine?.overallVarianceDays > 0)) ? 'bg-rose-500' : 'bg-emerald-600'
                  }`}
                  style={{ width: `${Math.round(((selectedLine?.milestones.filter(m => m.status === 'Completed' || Boolean(m.actualEndDate)).length || 0) / 14) * 100)}%` }}
                ></div>
              </div>

              {/* Delay Banner if Selected Line is Delayed */}
              {(selectedLine?.status === 'Delayed' || (selectedLine?.overallVarianceDays && selectedLine?.overallVarianceDays > 0)) && (
                <div className="p-3 bg-rose-100/80 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-900 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">
                      {selectedLine.productName} is Delayed (+{selectedLine.overallVarianceDays || 3}d calculated variance):
                    </span>{' '}
                    <span>{selectedLine.milestones.find(m => m.delayReason)?.delayReason || 'Schedule running behind committed baseline for this product.'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* MANUFACTURING PIPELINE (STAGE BY STAGE FLOW FOR SELECTED PRODUCT) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-emerald-700" />
                  Manufacturing Stage Progress: {selectedLine?.productName} ({(selectedLine?.milestones || []).filter(m => m.status === 'Completed' || Boolean(m.actualEndDate)).length}/14 Completed)
                </h3>
                <span className="text-[10px] font-mono text-slate-400">Shop-Floor Execution</span>
              </div>

              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                {selectedLine?.milestones.map((ms, index) => {
                  const isCompleted = ms.status === 'Completed' || Boolean(ms.actualEndDate);
                  const isStarted = Boolean(ms.actualStartDate) && !isCompleted;
                  const isInProgress = (isStarted || ms.status === 'In Progress') && !isCompleted;
                  const isPendingBaseline = po.status === 'Baseline Pending';
                  const activeStageIdx = selectedLine.milestones.findIndex(m => m.status !== 'Completed' && !m.actualEndDate);
                  const isCurrent = !isPendingBaseline && index === activeStageIdx;
                  const isDelayed = (ms.status === 'Delayed' || (typeof ms.varianceDays === 'number' && ms.varianceDays > 0)) && !isCompleted;
                  const friendlyName = getStageFriendlyName(ms.key, selectedLine);

                  const displayStartDate = ms.actualStartDate || ms.forecastStartDate || ms.committedBaselineStartDate || po.poDate || 'Pending';
                  const displayEndDate = ms.actualEndDate || ms.forecastEndDate || ms.committedBaselineEndDate || 'Pending';

                  return (
                    <React.Fragment key={ms.id}>
                    <div className="relative flex items-start justify-between gap-4 group">
                      
                      {/* Node Bullet Icon */}
                      <div className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                        isCompleted ? 'bg-emerald-600 border-emerald-600 text-white' :
                        isInProgress ? 'bg-blue-600 border-blue-600 text-white ring-2 ring-blue-400/40' :
                        isDelayed ? 'bg-rose-500 border-rose-500 text-white' :
                        isCurrent ? 'bg-emerald-100 border-emerald-600 text-emerald-800 ring-2 ring-emerald-400/30' :
                        'bg-slate-100 border-slate-300 text-slate-400'
                      }`}>
                        {isCompleted ? '✓' : ms.stageOrder}
                      </div>

                      {/* Stage Information */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${isCurrent ? 'text-emerald-950 text-sm' : isCompleted ? 'text-slate-800' : 'text-slate-500'}`}>
                            {friendlyName}
                          </span>

                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                            isCompleted ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                            isInProgress ? (isDelayed ? 'bg-blue-50 border-blue-300 text-blue-900 shadow-2xs' : 'bg-blue-50 border-blue-200 text-blue-800 shadow-2xs') :
                            isPendingBaseline ? 'bg-amber-50 border-amber-200 text-amber-800' :
                            isDelayed ? 'bg-rose-50 border-rose-200 text-rose-800' :
                            'bg-slate-100 border-slate-200 text-slate-500'
                          }`}>
                            {isCompleted ? 'Completed' :
                             isInProgress ? (isDelayed && ms.varianceDays && ms.varianceDays > 0 ? `IN EXECUTION (+${ms.varianceDays}d)` : 'IN EXECUTION') :
                             isPendingBaseline ? 'Baseline Pending' :
                             isDelayed ? 'Delayed' :
                             'Not Started'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono mt-1 text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200/80">
                          <div>
                            <span className="text-slate-400 font-semibold uppercase">{isStarted ? 'Actual Start:' : 'Planned Start:'}</span>{' '}
                            <span className={`font-bold ${isStarted ? 'text-blue-700' : 'text-slate-800'}`}>
                              {displayStartDate}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 font-semibold uppercase">{isCompleted ? 'Actual End Date:' : 'Planned/Forecast End:'}</span>{' '}
                            <span className={`font-bold ${isCompleted ? 'text-emerald-700' : 'text-slate-800'}`}>
                              {displayEndDate}
                            </span>
                          </div>
                          {isCompleted && ms.actualEndDate && (
                            <div className="text-emerald-700 font-semibold">
                              ✓ Passed on {ms.actualEndDate}
                            </div>
                          )}
                        </div>

                        {/* Display explicit delay reason on the milestone where delay was entered/occurred */}
                        {ms.delayReason && !ms.delayReason.startsWith('Cascaded delay from preceding') && (
                          <div className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded-lg mt-1.5 border border-rose-100 flex items-center gap-1.5 font-medium">
                            <span className="font-bold">Reason:</span> {ms.delayReason}
                          </div>
                        )}

                        {/* For upcoming downstream milestones impacted by schedule shift, show simply the delay days count */}
                        {isDelayed && (!ms.delayReason || ms.delayReason.startsWith('Cascaded delay from preceding')) && ms.varianceDays && ms.varianceDays > 0 && !isCompleted && (
                          <div className="text-[11px] text-amber-800 bg-amber-50/80 p-1.5 px-2.5 rounded-lg mt-1.5 border border-amber-200/70 inline-flex items-center gap-1 font-mono font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            <span>Baseline Delay: <strong className="text-amber-900 font-bold">+{ms.varianceDays} {ms.varianceDays === 1 ? 'day' : 'days'}</strong></span>
                          </div>
                        )}
                      </div>

                      {/* Quick Record Action Buttons - STRICTLY FOR ACTIVE MILESTONE ONLY */}
                      {!po.isClosed && po.status !== 'Completed' && !isPendingBaseline && isCurrent && (() => {
                        const isAuthorizedForMilestone = isMilestoneOwnedByRole(ms.key, activeRole);
                        if (!isAuthorizedForMilestone) return null;

                        return (
                          <div className="shrink-0 flex items-center gap-1.5">
                            {!ms.actualStartDate ? (
                              <button
                                onClick={() => onOpenManualInput(po, selectedLine, ms, 'start')}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-md text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Play className="w-3 h-3 text-slate-600" /> Record Start
                              </button>
                            ) : (
                              <button
                                onClick={() => onOpenManualInput(po, selectedLine, ms, 'start')}
                                className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-md text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                                title="Edit / Re-enter Start Date"
                              >
                                <Edit3 className="w-3 h-3 text-slate-500" /> Edit Start
                              </button>
                            )}
                            <button
                              onClick={() => onOpenManualInput(po, selectedLine, ms, 'complete')}
                              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-[10px] font-bold shadow-xs flex items-center gap-1 cursor-pointer"
                            >
                              <CheckSquare className="w-3 h-3" /> Mark Complete
                            </button>
                          </div>
                        );
                      })()}
                      
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* RAW MATERIALS CRITICAL PATH SUMMARY FOR SELECTED PRODUCT */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-emerald-700" /> Raw Materials Bill of Materials: {selectedLine?.productName}
                </h4>
                <span className="text-[10px] font-mono text-slate-400">{selectedLine?.materials?.length || 0} Item(s)</span>
              </div>

              <div className="space-y-2">
                {(!selectedLine?.materials || selectedLine.materials.length === 0) ? (
                  <div className="p-3 bg-slate-50 rounded-xl text-center text-slate-400 text-xs">
                    Standard materials assigned.
                  </div>
                ) : (
                  selectedLine.materials.map((mat) => (
                    <div key={mat.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{mat.itemCode}</span>
                          {mat.isCriticalPath && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 font-mono text-[9px] font-bold border border-rose-200">
                              CRITICAL
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                            mat.inspectionResult === 'Passed' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                          }`}>
                            GRN: {mat.inspectionResult || 'Pending'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">{mat.description}</p>
                      </div>
                      <div className="text-right text-[10px] font-mono text-slate-500">
                        <div>Supplier: {mat.supplierName}</div>
                        <div>Lead Time: {mat.leadTimeDays}d | Expected: {mat.expectedDate || 'Pending'}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500 font-mono">
            <span>Last Updated: {po.lastUpdatedAt.split('T')[0]} by {po.lastUpdatedBy}</span>
            <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg cursor-pointer">
              Close Panel
            </button>
          </div>

        </div>
      </div>

      {showRevisionModal && (
        <BaselineRevisionModal
          isOpen={showRevisionModal}
          onClose={() => setShowRevisionModal(false)}
          po={po}
        />
      )}
    </>
  );
};
