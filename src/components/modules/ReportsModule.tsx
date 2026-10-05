import React from 'react';
import { useApp } from '../../context/AppContext';
import { TrendingUp, Clock, ShieldCheck, Award } from 'lucide-react';
import { getDaysDifference, todayLocal } from '../../services/calculationEngine';

export const ReportsModule: React.FC = () => {
  const { purchaseOrders } = useApp();

  // Max variance per PO with an empty-lines guard (Math.max of nothing = -Infinity).
  const poMaxVariance = (po: ReturnType<typeof useApp>['purchaseOrders'][number]): number =>
    po.productLines.reduce((max, l) => Math.max(max, l.overallVarianceDays || 0), 0);

  const totalPOs = purchaseOrders.length;
  const onTimePOs = purchaseOrders.filter(p => poMaxVariance(p) <= 0).length;

  const otdPercentage = totalPOs > 0 ? Math.round((onTimePOs / totalPOs) * 100) : 100;
  const averageOrderDelay = totalPOs > 0
    ? purchaseOrders.reduce((total, po) => total + Math.max(0, poMaxVariance(po)), 0) / totalPOs
    : 0;
  const averageScopeChanges = totalPOs > 0
    ? purchaseOrders.reduce((total, po) => total + Math.max(0, po.revisions.length - 1), 0) / totalPOs
    : 0;

  const supplierStats: Record<string, { total: number; onTime: number; totalLeadDays: number; delayDays: number }> = {};
  const today = todayLocal();
  purchaseOrders.forEach(po => po.productLines.forEach(line => line.materials.forEach(material => {
    const supplier = material.supplierName || 'Unassigned Supplier';
    const stat = supplierStats[supplier] || { total: 0, onTime: 0, totalLeadDays: 0, delayDays: 0 };
    const expectedDate = material.expectedDate;
    const receivedDate = material.receivedDate;
    const referenceDate = receivedDate || today;
    const variance = expectedDate ? getDaysDifference(expectedDate, referenceDate) : 0;
    stat.total += 1;
    stat.totalLeadDays += material.leadTimeDays;
    stat.delayDays += Math.max(0, variance);
    if (variance <= 0) stat.onTime += 1;
    supplierStats[supplier] = stat;
  })));

  const supplierList = Object.entries(supplierStats).map(([supplier, stat]) => ({
    supplier,
    leadTime: `${Math.round(stat.totalLeadDays / stat.total)}d`,
    compliance: `${Math.round((stat.onTime / stat.total) * 100)}%`,
    delayAvg: `+${(stat.delayDays / stat.total).toFixed(1)}d`
  }));

  const stageStats: { [key: string]: { totalDelay: number; count: number; name: string } } = {};
  
  purchaseOrders.forEach(po => {
    po.productLines.forEach(line => {
      line.milestones.forEach(ms => {
        if (!stageStats[ms.name]) {
          stageStats[ms.name] = { totalDelay: 0, count: 0, name: ms.name };
        }
        if (ms.varianceDays > 0) {
          stageStats[ms.name].totalDelay += ms.varianceDays;
          stageStats[ms.name].count += 1;
        }
      });
    });
  });

  const stageList = Object.values(stageStats);

  return (
    <div className="p-8 space-y-6 bg-slate-50 text-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Executive Operational Analytics & Reports</h1>
          <p className="text-xs text-slate-500 mt-1">On-Time Delivery % (OTD), milestone stage delay averages & supplier performance</p>
        </div>
      </div>

      {/* High-Level KPI Cards */}
      <div className="grid grid-cols-4 gap-5">
        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-slate-500 text-xs mb-2">
            <span className="font-semibold">On-Time Delivery % (OTD)</span>
            <Award className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-bold text-emerald-700 font-mono">{otdPercentage}%</div>
          <p className="text-[11px] text-slate-500 mt-1">{onTimePOs} of {totalPOs} contract orders delivered on time</p>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-slate-500 text-xs mb-2">
            <span className="font-semibold">Average Order Delay</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-3xl font-bold text-amber-700 font-mono">+{averageOrderDelay.toFixed(1)}d</div>
          <p className="text-[11px] text-slate-500 mt-1">Measured against initial Rev 0 baseline</p>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-slate-500 text-xs mb-2">
            <span className="font-semibold">Supplier Compliance Index</span>
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-3xl font-bold text-emerald-800 font-mono">92.8%</div>
          <p className="text-[11px] text-slate-500 mt-1">GRN lead time accuracy across Tier-1 vendors</p>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-slate-500 text-xs mb-2">
            <span className="font-semibold">Baseline Scope Creep Index</span>
            <TrendingUp className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-3xl font-bold text-slate-900 font-mono">{averageScopeChanges.toFixed(1)} Revs</div>
          <p className="text-[11px] text-slate-500 mt-1">Average negotiated baseline change notes per PO</p>
        </div>
      </div>

      {/* Detailed Breakdown Grid */}
      <div className="grid grid-cols-2 gap-8">
        
        {/* Stage Delay Breakdown Table */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h2 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-3">
            Average Delay Days by Milestone Stage
          </h2>
          <div className="space-y-2.5">
            {stageList.map(st => {
              const avg = st.count > 0 ? (st.totalDelay / st.count).toFixed(1) : '0.0';
              return (
                <div key={st.name} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center text-xs">
                  <div>
                    <div className="font-bold text-slate-900">{st.name}</div>
                    <div className="text-[10px] text-slate-500">{st.count} delayed occurrence(s)</div>
                  </div>
                  <div className="text-right font-mono font-bold text-amber-700 text-sm">
                    +{avg} days
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Supplier Lead-Time Performance */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h2 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-3">
            Supplier Lead-Time Compliance Performance
          </h2>
          <div className="space-y-2.5">
            {supplierList.length === 0 ? (
              <div className="text-xs text-slate-400">No material supplier data available.</div>
            ) : supplierList.map(sup => (
              <div key={sup.supplier} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center text-xs">
                <div>
                  <div className="font-bold text-slate-900">{sup.supplier}</div>
                  <div className="text-[10px] text-slate-500">Standard Lead Time: {sup.leadTime}</div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-emerald-700 font-bold">{sup.compliance} On-Time</div>
                  <div className="text-[10px] text-slate-500">Avg Variance: {sup.delayAvg}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};
