import React, { useState } from 'react';
import type { PurchaseOrder, DelayCategory, ProductLine } from '../../types';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import { getDaysDifference } from '../../services/calculationEngine';

interface DelayAnalysisFlowProps {
  po: PurchaseOrder;
  lineId?: string;
  className?: string;
  showAllStages?: boolean;
  defaultOpen?: boolean;
}

export interface DelayStep {
  stageOrder: number;
  stageName: string;
  stageKey: string;
  varianceDays: number;
  delayDays: number;
  stageDelayAdded: number; // Exact days added (+) or recovered (-) by this specific stage
  cumulativeDelay: number;  // Running cumulative delay after this stage
  stageDelta: number;
  isRootCause: boolean;
  isRecovery: boolean;
  isAdditionalDelay: boolean;
  delayCategory?: DelayCategory;
  delayReason?: string;
  plannedDates: { start: string; end: string; duration: number };
  actualDates: { start?: string; end?: string; duration?: number };
  productLineName?: string;
  lineNumber?: string;
  productLineId?: string;
  affectedProducts?: { lineId: string; lineNumber: string; productName: string; varianceDays: number; delayReason?: string }[];
}

/**
 * Extracts and calculates simple milestone-wise delay & recovery flow for a single product line.
 */
function extractLineDelayFlow(po: PurchaseOrder, line: ProductLine): {
  hasDelays: boolean;
  rootDelayStep: DelayStep | null;
  delaySteps: DelayStep[];
  allDelayOriginSteps: DelayStep[];
  recoverySteps: DelayStep[];
  netVarianceDays: number;
  totalDaysDelayed: number;
  totalDaysRecovered: number;
  aheadDays: number;
} {
  const milestones = line.milestones || [];
  const delaySteps: DelayStep[] = [];
  const recoverySteps: DelayStep[] = [];
  let rootDelayStep: DelayStep | null = null;
  let totalDaysDelayed = 0;
  let totalDaysRecovered = 0;

  for (let i = 0; i < milestones.length; i++) {
    const ms = milestones[i];
    const prevMs = i > 0 ? milestones[i - 1] : null;

    const plannedStart = ms.committedBaselineStartDate || po.poDate;
    const plannedEnd = ms.committedBaselineEndDate || po.committedDeliveryDate;
    const plannedDuration = ms.committedDurationDays || 1;

    const actualStart = ms.actualStartDate || ms.forecastStartDate;
    const actualEnd = ms.actualEndDate || ms.forecastEndDate;
    const actualDuration = (actualStart && actualEnd) ? Math.max(1, getDaysDifference(actualStart, actualEnd)) : undefined;

    // Direct variance at this milestone against its baseline target
    const currentVariance = typeof ms.varianceDays === 'number' ? ms.varianceDays : (
      actualEnd ? getDaysDifference(plannedEnd, actualEnd) : 0
    );

    // Active delay (non-negative)
    const activeVariance = Math.max(0, currentVariance);
    const prevActiveVariance = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;

    const delta = activeVariance - prevActiveVariance;

    // 1. Stage added new delay days and is actively delayed
    if (delta > 0 && activeVariance > 0) {
      totalDaysDelayed += delta;
      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: activeVariance,
        delayDays: delta,
        stageDelayAdded: delta,
        cumulativeDelay: activeVariance,
        stageDelta: delta,
        isRootCause: false,
        isRecovery: false,
        isAdditionalDelay: true,
        delayCategory: ms.delayCategory,
        delayReason: ms.delayReason,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration },
        productLineName: line.productName,
        lineNumber: line.lineNumber,
        productLineId: line.id,
        affectedProducts: [{ lineId: line.id, lineNumber: line.lineNumber, productName: line.productName, varianceDays: activeVariance, delayReason: ms.delayReason }]
      };

      delaySteps.push(step);
    } 
    // 2. Stage recovered existing delay (previous delay was reduced)
    else if (delta < 0 && prevActiveVariance > 0) {
      const recoveredDays = Math.min(prevActiveVariance, Math.abs(delta));
      totalDaysRecovered += recoveredDays;

      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: activeVariance,
        delayDays: delta,
        stageDelayAdded: -recoveredDays,
        cumulativeDelay: activeVariance,
        stageDelta: delta,
        isRootCause: false,
        isRecovery: true,
        isAdditionalDelay: false,
        delayCategory: ms.delayCategory,
        delayReason: ms.delayReason || `${recoveredDays}d recovered on this stage`,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration },
        productLineName: line.productName,
        lineNumber: line.lineNumber,
        productLineId: line.id,
        affectedProducts: [{ lineId: line.id, lineNumber: line.lineNumber, productName: line.productName, varianceDays: activeVariance }]
      };

      delaySteps.push(step);
      recoverySteps.push(step);
    } 
    // 3. Stage has an explicit user-entered delay reason and has active variance
    else if (Boolean(ms.delayReason) && !ms.delayReason?.startsWith('Cascaded') && !ms.delayReason?.startsWith('Inherited') && activeVariance > 0 && !delaySteps.some(s => s.stageKey === ms.key)) {
      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: activeVariance,
        delayDays: activeVariance,
        stageDelayAdded: activeVariance,
        cumulativeDelay: activeVariance,
        stageDelta: activeVariance,
        isRootCause: false,
        isRecovery: false,
        isAdditionalDelay: true,
        delayCategory: ms.delayCategory,
        delayReason: ms.delayReason,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration },
        productLineName: line.productName,
        lineNumber: line.lineNumber,
        productLineId: line.id,
        affectedProducts: [{ lineId: line.id, lineNumber: line.lineNumber, productName: line.productName, varianceDays: activeVariance, delayReason: ms.delayReason }]
      };

      delaySteps.push(step);
    }
  }

  // Prioritize the true delay origin:
  // 1. Stage where the user directly recorded an explicit delay reason
  // 2. Stage with the largest newly added delay (stageDelayAdded > 0)
  // 3. Earliest non-recovery delay step
  const nonRecoverySteps = delaySteps.filter(s => !s.isRecovery);
  const stepWithExplicitReason = nonRecoverySteps.find(s => s.delayReason && !s.delayReason.startsWith('Cascaded') && !s.delayReason.startsWith('Inherited'));
  const stepWithMaxAddedDelay = [...nonRecoverySteps].sort((a, b) => (b.stageDelayAdded || 0) - (a.stageDelayAdded || 0))[0];
  
  rootDelayStep = stepWithExplicitReason || stepWithMaxAddedDelay || nonRecoverySteps[0] || null;

  if (rootDelayStep) {
    delaySteps.forEach(s => {
      s.isRootCause = s.stageKey === rootDelayStep?.stageKey;
      s.isAdditionalDelay = !s.isRootCause && !s.isRecovery;
    });
  }

  const lastMilestoneVariance = milestones[milestones.length - 1]?.varianceDays || line.overallVarianceDays || 0;
  const netVarianceDays = Math.max(0, lastMilestoneVariance);
  const aheadDays = lastMilestoneVariance < 0 ? Math.abs(lastMilestoneVariance) : 0;
  const isLineDelayed = line.status === 'Delayed' || netVarianceDays > 0 || (line.overallVarianceDays || 0) > 0;
  const hasDelays = isLineDelayed && delaySteps.length > 0;

  return {
    hasDelays,
    rootDelayStep,
    delaySteps,
    allDelayOriginSteps: delaySteps.filter(s => !s.isRecovery),
    recoverySteps,
    netVarianceDays,
    totalDaysDelayed: hasDelays ? totalDaysDelayed : 0,
    totalDaysRecovered: hasDelays ? totalDaysRecovered : 0,
    aheadDays
  };
}

/**
 * Extracts and calculates milestone-by-milestone delay breakdown across the PO or a target product line.
 */
export function extractDelayFlow(po: PurchaseOrder, targetLineId?: string): {
  hasDelays: boolean;
  rootDelayStep: DelayStep | null;
  delaySteps: DelayStep[];
  allDelayOriginSteps: DelayStep[];
  recoverySteps: DelayStep[];
  allStepsWithVariance: DelayStep[];
  netVarianceDays: number;
  totalDaysDelayed: number;
  totalDaysRecovered: number;
  isRecovered: boolean;
  aheadDays: number;
} {
  if (!po || !po.productLines || po.productLines.length === 0) {
    return {
      hasDelays: false,
      rootDelayStep: null,
      delaySteps: [],
      allDelayOriginSteps: [],
      recoverySteps: [],
      allStepsWithVariance: [],
      netVarianceDays: 0,
      totalDaysDelayed: 0,
      totalDaysRecovered: 0,
      isRecovered: false,
      aheadDays: 0
    };
  }

  // If a specific line is requested, return that line's calculation
  if (targetLineId) {
    const line = po.productLines.find(l => l.id === targetLineId) || po.productLines[0];
    const res = extractLineDelayFlow(po, line);
    return {
      ...res,
      allStepsWithVariance: res.delaySteps,
      isRecovered: false
    };
  }

  // If no targetLineId is provided, analyze ALL product lines in the PO
  const allLineResults = po.productLines.map(line => extractLineDelayFlow(po, line));
  
  // Find all delayed lines
  const delayedLineResults = allLineResults.filter(r => r.hasDelays);

  // Highest net variance across all lines
  const maxNetVariance = Math.max(...allLineResults.map(r => r.netVarianceDays), 0);
  const maxDaysDelayed = Math.max(...allLineResults.map(r => r.totalDaysDelayed), 0);
  const maxDaysRecovered = Math.max(...allLineResults.map(r => r.totalDaysRecovered), 0);

  // Combine unique delayed steps across lines and attach all affected products
  const stepMap = new Map<string, DelayStep>();
  const affectedProductsMap = new Map<string, { lineId: string; lineNumber: string; productName: string; varianceDays: number; delayReason?: string }[]>();

  delayedLineResults.forEach(res => {
    res.delaySteps.forEach(step => {
      const existing = stepMap.get(step.stageKey);
      if (!existing || Math.abs(step.stageDelayAdded) > Math.abs(existing.stageDelayAdded)) {
        stepMap.set(step.stageKey, { ...step });
      }

      if (step.productLineId && step.productLineName) {
        const list = affectedProductsMap.get(step.stageKey) || [];
        if (!list.some(p => p.lineId === step.productLineId)) {
          list.push({
            lineId: step.productLineId,
            lineNumber: step.lineNumber || '',
            productName: step.productLineName,
            varianceDays: step.varianceDays,
            delayReason: step.delayReason
          });
          affectedProductsMap.set(step.stageKey, list);
        }
      }
    });
  });

  const combinedDelaySteps = Array.from(stepMap.values()).map(step => ({
    ...step,
    affectedProducts: affectedProductsMap.get(step.stageKey) || step.affectedProducts || []
  })).sort((a, b) => a.stageOrder - b.stageOrder);

  const combinedNonRecovery = combinedDelaySteps.filter(s => !s.isRecovery);
  const stepWithExplicitReason = combinedNonRecovery.find(s => s.delayReason && !s.delayReason.startsWith('Cascaded') && !s.delayReason.startsWith('Inherited'));
  const stepWithMaxAddedDelay = [...combinedNonRecovery].sort((a, b) => (b.stageDelayAdded || 0) - (a.stageDelayAdded || 0))[0];
  const rootDelayStep = stepWithExplicitReason || stepWithMaxAddedDelay || combinedDelaySteps.find(s => s.isRootCause) || combinedNonRecovery[0] || null;

  if (rootDelayStep) {
    combinedDelaySteps.forEach(s => {
      s.isRootCause = s.stageKey === rootDelayStep.stageKey;
      s.isAdditionalDelay = !s.isRootCause && !s.isRecovery;
    });
  }
  const isPODelayed = maxNetVariance > 0 || po.status === 'Delayed' || po.productLines.some(l => l.status === 'Delayed' || (l.overallVarianceDays || 0) > 0);
  const hasDelays = isPODelayed && combinedDelaySteps.length > 0;
  const aheadDays = !hasDelays ? Math.max(...allLineResults.map(r => r.aheadDays), 0) : 0;

  return {
    hasDelays,
    rootDelayStep,
    delaySteps: combinedDelaySteps,
    allDelayOriginSteps: combinedDelaySteps.filter(s => !s.isRecovery),
    recoverySteps: combinedDelaySteps.filter(s => s.isRecovery),
    allStepsWithVariance: combinedDelaySteps,
    netVarianceDays: maxNetVariance,
    totalDaysDelayed: maxDaysDelayed,
    totalDaysRecovered: maxDaysRecovered,
    isRecovered: false,
    aheadDays
  };
}

export const DelayAnalysisFlow: React.FC<DelayAnalysisFlowProps> = ({
  po,
  lineId,
  className = '',
  defaultOpen = false
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const {
    hasDelays,
    delaySteps,
    netVarianceDays,
    totalDaysDelayed,
    totalDaysRecovered,
    aheadDays
  } = extractDelayFlow(po, lineId);

  // When order has NO delays (on track or ahead of schedule)
  if (!hasDelays) {
    return (
      <div className={`p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-950 shadow-2xs ${className}`}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            {aheadDays > 0 ? <Sparkles className="w-4 h-4 text-emerald-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          </div>
          <div>
            <div className="font-bold text-slate-800 flex items-center gap-2">
              <span>{aheadDays > 0 ? `Schedule Status: Ahead of Baseline (-${aheadDays} Days)` : 'Schedule Status: 100% On Time'}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {aheadDays > 0 ? `${aheadDays}d Ahead` : 'On Track'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Target Delivery Date: <strong className="text-slate-700 font-mono">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong>
            </p>
          </div>
        </div>

        <div className="text-right hidden sm:block">
          <span className="text-[10px] font-mono text-emerald-700 bg-white px-2.5 py-1 rounded-md border border-emerald-200 font-semibold shadow-2xs">
            0 Days Delay
          </span>
        </div>
      </div>
    );
  }

  const effectiveDelayDays = netVarianceDays > 0 ? netVarianceDays : totalDaysDelayed;

  // Milestone-by-milestone delay & recovery report with collapsible dropdown
  return (
    <div className={`bg-white border border-rose-200 rounded-2xl overflow-hidden shadow-xs transition-all ${className}`}>
      
      {/* 1. Header Summary with Dropdown Toggle Arrow */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full text-left p-3.5 sm:p-4 bg-slate-900 hover:bg-slate-800 transition-colors text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none"
        title={isOpen ? 'Click to collapse delay log' : 'Click to expand delay log'}
      >
        <div className="flex items-center gap-3">
          <div className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition-colors shrink-0">
            {isOpen ? <ChevronDown className="w-4 h-4 text-rose-300" /> : <ChevronRight className="w-4 h-4 text-slate-300" />}
          </div>
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-xs sm:text-sm text-white">
                Milestone Delay &amp; Recovery Log
              </h3>
              <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-rose-600 text-white shadow-2xs">
                +{effectiveDelayDays} {effectiveDelayDays === 1 ? 'Day' : 'Days'} Net Delay
              </span>
              {totalDaysRecovered > 0 && (
                <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/25 text-emerald-200 border border-emerald-400/30 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-emerald-300" />
                  -{totalDaysRecovered}d Recovered
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              {delaySteps.length === 1 
                ? `1 stage recorded a delay (+${totalDaysDelayed}d total)`
                : `${delaySteps.length} stages recorded variance (+${totalDaysDelayed}d added${totalDaysRecovered > 0 ? `, -${totalDaysRecovered}d recovered` : ''})`
              } • <span className="text-rose-300 font-medium">{isOpen ? 'Click to collapse' : 'Click dropdown to expand'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          <div className="text-right px-3 py-1.5 rounded-lg bg-white/10 border border-white/10">
            <div className="text-[10px] uppercase font-mono text-slate-400">Revised Delivery Date</div>
            <div className="text-xs font-bold font-mono text-rose-300">
              {po.revisedDeliveryDate || po.committedDeliveryDate}
            </div>
          </div>
        </div>
      </button>

      {/* 2. Clear Milestone Delay & Recovery Cards (Collapsible Dropdown Body) */}
      {isOpen && (
        <div className="p-4 space-y-3 bg-slate-50/50 border-t border-slate-800/20 animate-fadeIn">
          <div className="flex items-center justify-between text-xs text-slate-600 font-bold px-1">
            <span className="flex items-center gap-1.5 text-slate-800">
              <Clock className="w-4 h-4 text-slate-600" />
              <span>Milestone Schedule Log:</span>
            </span>
            <span className="text-[10px] font-mono text-slate-500 font-normal">
              Net Impact: +{effectiveDelayDays}d
            </span>
          </div>

          <div className="space-y-2.5">
            {delaySteps.map((step, idx) => {
              const isRecovery = step.isRecovery;

              return (
                <div
                  key={step.stageKey + idx}
                  className={`p-3.5 rounded-xl border bg-white shadow-2xs transition-all space-y-2 ${
                    isRecovery
                      ? 'border-emerald-300 bg-emerald-50/20'
                      : step.isRootCause
                      ? 'border-rose-300 ring-1 ring-rose-200/70'
                      : 'border-amber-300'
                  }`}
                >
                  {/* Stage Title and Badges */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center font-bold text-[10px] font-mono">
                        {step.stageOrder}
                      </span>
                      
                      <span className="font-bold text-slate-900 text-xs">
                        Stage {step.stageOrder}: {step.stageName.replace(/^\d+\.\s*/, '')}
                      </span>

                      {isRecovery ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <Zap className="w-3 h-3 text-emerald-600" />
                          {step.stageDelayAdded}d Recovered
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                          step.isRootCause 
                            ? 'bg-rose-100 text-rose-800 border-rose-300' 
                            : 'bg-amber-100 text-amber-800 border-amber-300'
                        }`}>
                          +{step.stageDelayAdded} {step.stageDelayAdded === 1 ? 'Day Delay' : 'Days Delay'}
                        </span>
                      )}

                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        Running Total: <strong>+{step.cumulativeDelay}d</strong>
                      </span>

                      {step.delayCategory && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white text-slate-600 border border-slate-300">
                          {step.delayCategory}
                        </span>
                      )}
                    </div>

                    {/* Dates */}
                    <div className="text-[11px] font-mono text-slate-500 flex items-center gap-2 self-start sm:self-auto">
                      <span>Target: <strong>{step.plannedDates.end}</strong></span>
                      {step.actualDates.end && (
                        <span className="text-slate-800">| Actual: <strong>{step.actualDates.end}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Product Causing the Delay / Variance */}
                  {step.affectedProducts && step.affectedProducts.length > 0 ? (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Affected Product:</span>
                      {step.affectedProducts.map(p => (
                        <span key={p.lineId} className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 text-indigo-900 border border-indigo-200 flex items-center gap-1">
                          <span className="text-indigo-600 font-semibold">{p.lineNumber ? `${p.lineNumber}:` : ''}</span>
                          <span className="font-bold">{p.productName}</span>
                          <span className="text-rose-700">(+{p.varianceDays}d)</span>
                        </span>
                      ))}
                    </div>
                  ) : step.productLineName ? (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Affected Product:</span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 text-indigo-900 border border-indigo-200">
                        {step.lineNumber ? `${step.lineNumber}: ` : ''}{step.productLineName}
                      </span>
                    </div>
                  ) : null}

                  {/* Delay Reason Explanation */}
                  {step.delayReason && (
                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-800 flex items-start gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      <AlertCircle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isRecovery ? 'text-emerald-600' : 'text-rose-500'}`} />
                      <div className="space-y-0.5">
                        <span className={`text-[10px] font-mono font-bold uppercase tracking-wider block ${isRecovery ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {isRecovery ? 'Recovery Note:' : 'Reason / Root Cause:'}
                        </span>
                        <span className="font-medium text-slate-900 text-xs leading-relaxed">
                          {step.delayReason}
                        </span>
                        {step.productLineName && (
                          <span className="text-[10px] text-slate-500 font-mono block pt-0.5">
                            Recorded on: <strong className="text-slate-800">{step.lineNumber ? `${step.lineNumber} - ` : ''}{step.productLineName}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};




