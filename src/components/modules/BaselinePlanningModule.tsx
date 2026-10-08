import React, { useState } from 'react';
import { Calendar, CheckCircle2, Lock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BaselineRevisionModal } from '../modals/BaselineRevisionModal';
import type { PurchaseOrder } from '../../types';
import { getPOManufacturingStatus } from '../../utils/statusUtils';

export const BaselinePlanningModule: React.FC = () => {
  const { purchaseOrders, activeRole } = useApp();
  const [reviewPO, setReviewPO] = useState<PurchaseOrder | null>(null);
  const isPM = activeRole === 'Project Manager (PM Baseline)' || activeRole === 'Project Management';

  const activeOrders = purchaseOrders.filter(po => !po.isClosed && po.status !== 'Completed');
  const completedOrders = purchaseOrders.filter(po => po.isClosed || po.status === 'Completed');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-cyan-500/20 text-cyan-200 border border-cyan-400/30">PM BASELINE CONTROL</span>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">FULL PROJECT PLAN</span>
        </div>
        <h1 className="text-2xl font-black tracking-tight">Baseline Planning and Review</h1>
        <p className="text-xs text-slate-300 mt-1 max-w-2xl">Review the complete milestone flow, configure durations and dates, then approve the baseline before execution begins.</p>
      </div>

      {/* Active Orders & Baseline Status */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-sm text-slate-900">Active Orders and Baseline Status</h2>
            <p className="text-xs text-slate-500 mt-0.5">Only the Project Manager can approve or edit a pending baseline.</p>
          </div>
          <span className="text-xs font-mono text-slate-500">{activeOrders.length} active order{activeOrders.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="divide-y divide-slate-100">
          {activeOrders.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No active orders pending or in progress.</div>
          ) : (
            activeOrders.map(po => {
              const firstLine = po.productLines[0];
              const firstMilestone = firstLine?.milestones[0];
              const lastMilestone = firstLine?.milestones[firstLine.milestones.length - 1];
              const isPending = po.status === 'Baseline Pending' && !po.isClosed;
              const statusSummary = getPOManufacturingStatus(po);
              const isDelayed = statusSummary.isDelayed;

              return (
                <div key={po.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-emerald-800">{po.poNumber}</span>
                      <span className="font-semibold text-slate-900">{po.customerName}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        isPending 
                          ? 'bg-amber-100 text-amber-900 border-amber-300' 
                          : isDelayed
                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                          : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      }`}>
                        {isPending ? 'Baseline Pending' : isDelayed ? `Delayed (+${statusSummary.delayDays}d)` : po.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                      <span className="font-bold text-slate-700">Planned Start: <strong className="font-mono text-slate-900">{firstMilestone?.committedBaselineStartDate || po.poDate}</strong></span>
                      <span className="font-bold text-slate-700">Planned End: <strong className="font-mono text-slate-900">{lastMilestone?.committedBaselineEndDate || po.committedDeliveryDate}</strong></span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" /> 
                        Delivery: <strong className={`font-mono ${isDelayed ? 'text-rose-700 font-bold' : ''}`}>{po.revisedDeliveryDate || po.committedDeliveryDate}</strong>
                      </span>
                    </div>
                    {isDelayed && statusSummary.delayedStageName && (
                      <div className="mt-1.5 text-[11px] font-medium text-rose-700 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        <span>Schedule delay formed at <strong>{statusSummary.delayedStageName}</strong> (+{statusSummary.delayDays}d late vs baseline target).</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {isPending ? (
                      isPM ? (
                        <button onClick={() => setReviewPO(po)} className="px-4 py-2 bg-cyan-700 hover:bg-cyan-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs">
                          <ShieldCheck className="w-4 h-4" /> Review Full Baseline
                        </button>
                      ) : (
                        <span className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">PM Review Required</span>
                      )
                    ) : (
                      <div className="flex items-center gap-2">
                        {isPM && isDelayed && (
                          <button
                            onClick={() => setReviewPO(po)}
                            className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" /> Review Schedule
                          </button>
                        )}
                        <span className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Baseline Locked
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Completed Orders Section */}
      {completedOrders.length > 0 && (
        <div className="bg-slate-50/80 border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-100/60 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm text-slate-900">Completed & Closed Orders</h2>
              <p className="text-xs text-slate-500 mt-0.5">Archived orders that have finished manufacturing and delivery closure.</p>
            </div>
            <span className="text-xs font-mono text-slate-500">{completedOrders.length} completed order{completedOrders.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="divide-y divide-slate-200/60">
            {completedOrders.map(po => {
              const firstLine = po.productLines[0];
              const lastMilestone = firstLine?.milestones[firstLine.milestones.length - 1];
              const statusSummary = getPOManufacturingStatus(po);

              return (
                <div key={po.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white/70">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-slate-700">{po.poNumber}</span>
                      <span className="font-semibold text-slate-800">{po.customerName}</span>
                      <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold flex items-center gap-1 ${
                        statusSummary.delayDays > 0 ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-slate-200 border-slate-300 text-slate-700'
                      }`}>
                        {statusSummary.delayDays > 0 ? (
                          <>
                            <AlertTriangle className="w-3 h-3 text-amber-700" />
                            Completed by delay of {statusSummary.delayDays} days
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            {po.isClosed ? 'Closed (On Time)' : 'Completed (On Time)'}
                          </>
                        )}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                      <span>Cust. Ref: <strong className="text-slate-700">{po.customerPoRef || 'N/A'}</strong></span>
                      <span>Lines: <strong className="text-slate-700">{po.productLines.length}</strong></span>
                      <span>Final End Date: <strong className="font-mono text-slate-700">{lastMilestone?.actualEndDate || po.committedDeliveryDate}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-slate-400" /> Archived Baseline
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reviewPO && (
        <BaselineRevisionModal isOpen onClose={() => setReviewPO(null)} po={reviewPO} />
      )}
    </div>
  );
};
