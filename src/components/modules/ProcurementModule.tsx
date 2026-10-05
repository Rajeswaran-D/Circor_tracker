import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { MaterialItem, PurchaseOrder, ProductLine } from '../../types';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { clampDateMax, todayLocal } from '../../services/calculationEngine';

export const ProcurementModule: React.FC = () => {
  const { purchaseOrders, updateMaterialItem, activeRole } = useApp();
  const today = todayLocal();

  const [selectedMat, setSelectedMat] = useState<{ po: PurchaseOrder; line: ProductLine; mat: MaterialItem } | null>(null);

  // Form edit state for GRN modal
  const [orderedDate, setOrderedDate] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [grnNumber, setGrnNumber] = useState('');
  const [inspectionResult, setInspectionResult] = useState<'Passed' | 'Rejected' | 'Pending'>('Pending');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [formError, setFormError] = useState('');

  const isPurchaseRole = activeRole === 'Project Management' || activeRole === 'Stores (Material Receipt)' || activeRole === 'SCM (Sub-Supplier PO)';

  const handleOpenEdit = (po: PurchaseOrder, line: ProductLine, mat: MaterialItem) => {
    const rawMs = line.milestones.find(m => m.key === 'raw_material');
    setSelectedMat({ po, line, mat });
    // A future baseline start must never prefill the ordered date (an order
    // placement is always in the past) — clamp it to today.
    setOrderedDate(clampDateMax(mat.orderedDate || rawMs?.committedBaselineStartDate || '', today));
    setExpectedDate(mat.expectedDate || rawMs?.committedBaselineEndDate || '');
    // Never prefill a received date from a future baseline date — an actual
    // receipt can only be recorded today or earlier.
    setReceivedDate(mat.receivedDate && mat.receivedDate <= today ? mat.receivedDate : '');
    setGrnNumber(mat.grnNumber || '');
    setInspectionResult(mat.inspectionResult || 'Pending');
    setInspectionNotes(mat.inspectionNotes || '');
    setFormError('');
  };

  const handleSaveMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMat) return;
    setFormError('');

    const result = updateMaterialItem({
      poId: selectedMat.po.id,
      productLineId: selectedMat.line.id,
      materialId: selectedMat.mat.id,
      orderedDate,
      expectedDate,
      receivedDate,
      grnNumber,
      inspectionResult,
      inspectionNotes,
      user: `${activeRole} User`,
      docRef: grnNumber || 'PO-MAT-UPDATE'
    });

    if (!result.success) {
      setFormError(result.error || 'Failed to update material record.');
      return;
    }

    setSelectedMat(null);
  };

  return (
    <div className="p-8 space-y-6 bg-slate-50 text-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Raw Material Procurement & GRN Tracker</h1>
          <p className="text-xs text-slate-500 mt-1">Itemized supplier lead times, critical path identification & incoming inspection certificates</p>
        </div>
        <div className="px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-800 font-mono text-xs font-semibold">
          Role: {activeRole} {isPurchaseRole ? '(Authorized)' : '(Read-Only)'}
        </div>
      </div>

      {/* Materials Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                <th className="py-3.5 px-4">PO / Line</th>
                <th className="py-3.5 px-4">Material Code & Description</th>
                <th className="py-3.5 px-4">Supplier</th>
                <th className="py-3.5 px-4 text-center">Lead Time</th>
                <th className="py-3.5 px-4">Critical Path</th>
                <th className="py-3.5 px-4">Ordered</th>
                <th className="py-3.5 px-4">Expected</th>
                <th className="py-3.5 px-4">GRN & Inspection</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {purchaseOrders.filter(po => po.status !== "Baseline Pending").flatMap(po => 
                po.productLines.flatMap(line => 
                  line.materials.map(mat => (
                    <tr key={mat.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-emerald-800">{po.poNumber}</div>
                        <div className="text-[10px] text-slate-400">{line.lineNumber}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{mat.itemCode}</div>
                        <div className="text-[11px] text-slate-600">{mat.description}</div>
                        <div className="text-[10px] text-slate-400">Qty: {mat.qty} {mat.unit}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-800 font-medium">{mat.supplierName}</td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-800">{mat.leadTimeDays}d</td>
                      <td className="py-3.5 px-4">
                        {mat.isCriticalPath ? (
                          <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-800 font-mono font-bold text-[10px]">
                            CRITICAL PATH
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">Standard</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">{mat.orderedDate || 'Pending'}</td>
                      <td className="py-3.5 px-4 font-mono text-emerald-800 font-bold">{mat.expectedDate || 'Pending'}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                          mat.inspectionResult === 'Passed' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                          mat.inspectionResult === 'Rejected' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                          'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                          {mat.inspectionResult || 'Pending'} {mat.grnNumber ? `(${mat.grnNumber})` : ''}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {po.isClosed || po.status === 'Completed' ? (
                          <span className="text-[11px] font-semibold text-emerald-800 flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Completed
                          </span>
                        ) : isPurchaseRole ? (
                          <button
                            onClick={() => handleOpenEdit(po, line, mat)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                          >
                            Update GRN
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Material Update Modal */}
      {selectedMat && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 shadow-2xl space-y-4 text-slate-800">
            <h2 className="font-bold text-base text-slate-900 border-b border-slate-100 pb-3">
              Flow #4: Update Material Status & GRN Inspection
            </h2>

            <form onSubmit={handleSaveMaterial} className="space-y-3.5 text-xs">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-start gap-2 font-medium">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="font-bold text-slate-900">{selectedMat.mat.itemCode}</div>
                <div className="text-[11px] text-slate-500">{selectedMat.mat.description} (Supplier: {selectedMat.mat.supplierName})</div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-600 mb-1">Ordered Date</label>
                  <input
                    type="date"
                    value={orderedDate}
                    onChange={(e) => setOrderedDate(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Expected Date</label>
                  <input
                    type="date"
                    min={orderedDate || undefined}
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Received Date</label>
                  <input
                    type="date"
                    min={orderedDate || undefined}
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">GRN Number *</label>
                  <input
                    type="text"
                    placeholder="GRN-2026-9041"
                    value={grnNumber}
                    onChange={(e) => setGrnNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Incoming Inspection Result *</label>
                  <select
                    value={inspectionResult}
                    onChange={(e) => setInspectionResult(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Passed">Passed (Approved for Shop Floor)</option>
                    <option value="Rejected">Rejected (Non-Conformance)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">QC / MTC Certificate Notes</label>
                <input
                  type="text"
                  placeholder="e.g. MTC EN 10204 3.1 verified. Radiography & PMI passed."
                  value={inspectionNotes}
                  onChange={(e) => setInspectionNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMat(null)}
                  className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
                  Save Material GRN Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
