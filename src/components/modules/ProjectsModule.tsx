import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder, ProductLine } from '../../types';
import { CheckCircle2, Edit3 } from 'lucide-react';

interface ProjectsModuleProps {
  onSelectPO: (po: PurchaseOrder) => void;
  onOpenManualInput: (po: PurchaseOrder, line: ProductLine, ms: any, type: 'start' | 'complete') => void;
}

export const ProjectsModule: React.FC<ProjectsModuleProps> = ({ onSelectPO, onOpenManualInput }) => {
  const { purchaseOrders } = useApp();
  const validPOs = purchaseOrders.filter(po => po.status !== "Baseline Pending");
  const [selectedPoId, setSelectedPoId] = useState<string>(validPOs[0]?.id || '');
  const [viewMode, setViewMode] = useState<'gantt' | 'table'>('gantt');

  const selectedPO = validPOs.find(p => p.id === selectedPoId) || validPOs[0];

  return (
    <div className="p-8 space-y-6 bg-slate-50 text-slate-800">
      
      {/* Module Title & Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Project Master Schedule & Gantt Timeline</h1>
          <p className="text-xs text-slate-500 mt-1">Baseline vs Actual vs Forecast milestone timeline & critical path guardrails</p>
        </div>

        <div className="flex items-center gap-3">
          {/* PO Selector */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-xs">
            <span className="text-slate-500 font-mono">PO:</span>
            <select
              value={selectedPoId}
              onChange={(e) => setSelectedPoId(e.target.value)}
              className="bg-transparent font-bold text-emerald-800 focus:outline-none cursor-pointer"
            >
              {validPOs.map(po => (
                <option key={po.id} value={po.id} className="bg-white text-slate-800">
                  {po.poNumber} - {po.customerName}{po.isClosed ? ' (Closed)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Toggle View Mode */}
          <div className="flex bg-white border border-slate-200 rounded-lg p-1 text-xs shadow-xs">
            <button
              onClick={() => setViewMode('gantt')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'gantt' ? 'bg-emerald-700 text-white font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Gantt Timeline View
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'table' ? 'bg-emerald-700 text-white font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Milestone Table View
            </button>
          </div>
        </div>
      </div>

      {/* Selected PO Summary Header */}
      {selectedPO && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between text-xs shadow-xs">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-bold text-emerald-800 text-base">{selectedPO.poNumber}</span>
              <span className="text-slate-600 font-medium">| Customer: {selectedPO.customerName}</span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px] font-semibold">
                Contract Ref: {selectedPO.contractReviewRef}
              </span>
              {selectedPO.isClosed && <span className="px-2.5 py-0.5 rounded-full bg-slate-200 border border-slate-300 text-slate-700 font-mono text-[10px] font-bold">CLOSED</span>}
            </div>
            <div className="flex items-center gap-5 text-slate-500 text-[11px] font-mono mt-1.5">
              <span>Committed Delivery: <strong className="text-slate-800">{selectedPO.committedDeliveryDate}</strong></span>
              <span>Revised Delivery: <strong className="text-emerald-700">{selectedPO.revisedDeliveryDate}</strong></span>
              <span>Status: <strong className="text-amber-700">{selectedPO.status}</strong></span>
            </div>
          </div>

          <button
            onClick={() => onSelectPO(selectedPO)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Open PO Drawer & History
          </button>
        </div>
      )}

      {/* Main View Area */}
      {selectedPO && (
        <div className="space-y-6">
          {selectedPO.productLines.map((line) => (
            <div key={line.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              
              {/* Product Line Header */}
              <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center justify-between font-semibold text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-emerald-800 font-mono font-bold text-sm">{line.lineNumber}:</span>
                  <span className="text-slate-900 text-sm font-bold">{line.productName}</span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-mono font-semibold">
                    {line.designType}
                  </span>
                </div>

                <div className="flex items-center gap-4 font-mono text-[11px] text-slate-600">
                  <span>Category: {line.category}</span>
                  <span>Qty: {line.qty} Pcs</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                    line.overallVarianceDays > 0 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  }`}>
                    Overall Variance: {line.overallVarianceDays > 0 ? `+${line.overallVarianceDays}d` : `${line.overallVarianceDays}d`}
                  </span>
                </div>
              </div>

              {/* View 1: Gantt Visualization */}
              {viewMode === 'gantt' && (
                <div className="p-5 space-y-4">
                  
                  {/* Legend */}
                  <div className="flex items-center gap-6 text-[11px] text-slate-500 font-mono border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3.5 h-2.5 bg-slate-300 rounded-xs"></div>
                      <span>Committed Baseline</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3.5 h-2.5 bg-emerald-600 rounded-xs"></div>
                      <span>Actual Recorded</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3.5 h-2.5 bg-rose-500 rounded-xs"></div>
                      <span>Forecast Overrun</span>
                    </div>
                  </div>

                  {/* Gantt Bar Rows */}
                  <div className="space-y-3.5 divide-y divide-slate-100">
                    {line.milestones.map((ms) => {
                      const isDelayed = ms.status === 'Delayed';
                      const isAtRisk = ms.status === 'At Risk';
                      const isCompleted = ms.status === 'Completed';

                      return (
                        <div key={ms.id} className="pt-3 flex items-center justify-between gap-6 text-xs">
                          {/* Milestone Name & Status */}
                          <div className="w-64 shrink-0">
                            <div className="flex items-center gap-1.5 font-bold text-slate-800">
                              <span>{ms.stageOrder}. {ms.name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                              <span>{ms.committedDurationDays}d baseline</span>
                              <span className={`font-bold ${ms.varianceDays > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                Var: {ms.varianceDays > 0 ? `+${ms.varianceDays}d` : `${ms.varianceDays}d`}
                              </span>
                            </div>
                          </div>

                          {/* Gantt Bar Graph */}
                          <div className="flex-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5">
                            {/* Baseline Bar */}
                            <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                              <span className="w-16">Baseline:</span>
                              <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden relative">
                                <div className="bg-slate-400 h-full w-3/4 rounded-full"></div>
                              </div>
                              <span className="w-20 text-right font-medium">{ms.committedBaselineEndDate}</span>
                            </div>

                            {/* Actual / Forecast Bar */}
                            <div className="flex items-center gap-2 text-[10px] font-mono">
                              <span className="w-16 text-slate-500">Forecast:</span>
                              <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden relative">
                                <div className={`h-full rounded-full ${
                                  isCompleted ? 'bg-emerald-600 w-3/4' :
                                  isDelayed ? 'bg-rose-500 w-full' :
                                  isAtRisk ? 'bg-amber-500 w-4/5' :
                                  'bg-emerald-500 w-3/4'
                                }`}></div>
                              </div>
                              <span className={`w-20 text-right font-bold ${
                                isCompleted ? 'text-emerald-700' : isDelayed ? 'text-rose-700' : 'text-slate-800'
                              }`}>
                                {ms.forecastEndDate}
                              </span>
                            </div>
                          </div>

                          {/* Quick Action Button */}
                          <div className="shrink-0 flex items-center justify-end gap-1.5">
                            {ms.status !== 'Completed' && (
                              <>
                                {ms.actualStartDate && (
                                  <button
                                    onClick={() => onOpenManualInput(selectedPO, line, ms, 'start')}
                                    className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-md text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                                    title="Edit / Re-enter Start Date"
                                  >
                                    <Edit3 className="w-3 h-3 text-slate-500" /> Edit Start
                                  </button>
                                )}
                                <button
                                  onClick={() => onOpenManualInput(selectedPO, line, ms, ms.actualStartDate ? 'complete' : 'start')}
                                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                                    ms.actualStartDate
                                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs'
                                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                                  }`}
                                >
                                  {ms.actualStartDate ? 'Complete' : 'Record Start'}
                                </button>
                              </>
                            )}
                            {ms.status === 'Completed' && (
                              <span className="text-[11px] text-emerald-700 font-mono font-bold flex items-center justify-end gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Done
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                </div>
              )}

              {/* View 2: Table Format */}
              {viewMode === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                        <th className="py-3 px-3">#</th>
                        <th className="py-3 px-3">Milestone Stage</th>
                        <th className="py-3 px-3">Baseline Start</th>
                        <th className="py-3 px-3">Baseline End</th>
                        <th className="py-3 px-3">Actual Start</th>
                        <th className="py-3 px-3">Actual / Forecast End</th>
                        <th className="py-3 px-3 text-center">Variance</th>
                        <th className="py-3 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {line.milestones.map((ms) => (
                        <tr key={ms.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono text-slate-400">{ms.stageOrder}</td>
                          <td className="py-2.5 px-3 font-bold text-slate-900">{ms.name}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">{ms.committedBaselineStartDate}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">{ms.committedBaselineEndDate}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-800">{ms.actualStartDate || '-'}</td>
                          <td className="py-2.5 px-3 font-mono text-emerald-800 font-bold">{ms.actualEndDate || ms.forecastEndDate}</td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold">
                            <span className={ms.varianceDays > 0 ? 'text-rose-700' : ms.varianceDays < 0 ? 'text-emerald-700' : 'text-slate-500'}>
                              {ms.varianceDays > 0 ? `+${ms.varianceDays}d` : `${ms.varianceDays}d`}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                              ms.status === 'Completed' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                              ms.status === 'Delayed' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                              ms.status === 'At Risk' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                              'bg-slate-100 border-slate-200 text-slate-700'
                            }`}>
                              {ms.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          ))}
        </div>
      )}

    </div>
  );
};
