import React from 'react';
import type { PurchaseOrder, DelayCategory, ProductLine } from '../../types';
import { AlertCircle, CheckCircle2, Clock, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import { getDaysDifference } from '../../services/calculationEngine';

interface DelayAnalysisFlowProps {
  po: PurchaseOrder;
  lineId?: string;
  className?: string;
  showAllStages?: boolean;
}

export interface DelayStep {
  stageOrder: number;
  stageName: string;
  stageKey: string;
  varianceDays: number;
  delayDays: number;
  stageDelayAdded: number; // Exact days added by this specific stage
  cumulativeDelay: number;  // Running cumulative delay after this stage
  stageDelta: number;
  isRootCause: boolean;
  isRecovery: boolean;
  isAdditionalDelay: boolean;
  delayCategory?: DelayCategory;
  delayReason?: string;
  plannedDates: { start: string; end: string; duration: number };
  actualDates: { start?: string; end?: string; duration?: number };
}

/**
 * Extracts and calculates delay flow for a single product line.
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
  const delayedSteps: DelayStep[] = [];
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

    const currentVariance = typeof ms.varianceDays === 'number' ? ms.varianceDays : 0;
    const prevVariance = prevMs && typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0;

    let stageDelayAdded = 0;
    let stageTimeRecovered = 0;

    if (prevVariance <= 0) {
      if (currentVariance > 0) {
        stageDelayAdded = currentVariance;
      }
    } else {
      if (currentVariance > prevVariance) {
        stageDelayAdded = currentVariance - prevVariance;
      } else if (currentVariance < prevVariance) {
        stageTimeRecovered = prevVariance - currentVariance;
      }
    }

    if (stageDelayAdded > 0) {
      totalDaysDelayed += stageDelayAdded;

      const isRoot = !rootDelayStep;
      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: currentVariance,
        delayDays: stageDelayAdded,
        stageDelayAdded,
        cumulativeDelay: currentVariance,
        stageDelta: stageDelayAdded,
        isRootCause: isRoot,
        isRecovery: false,
        isAdditionalDelay: !isRoot,
        delayCategory: ms.delayCategory,
        delayReason: ms.delayReason,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration }
      };

      if (isRoot) {
        rootDelayStep = step;
      }

      delayedSteps.push(step);
    } else if (stageTimeRecovered > 0 && delayedSteps.length > 0) {
      totalDaysRecovered += stageTimeRecovered;

      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: currentVariance,
        delayDays: -stageTimeRecovered,
        stageDelayAdded: -stageTimeRecovered,
        cumulativeDelay: Math.max(0, currentVariance),
        stageDelta: -stageTimeRecovered,
        isRootCause: false,
        isRecovery: true,
        isAdditionalDelay: false,
        delayCategory: ms.delayCategory,
        delayReason: ms.delayReason,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration }
      };

      delayedSteps.push(step);
      recoverySteps.push(step);
    } else if (Boolean(ms.delayReason) && !ms.delayReason?.startsWith('Cascaded') && !ms.delayReason?.startsWith('Inherited')) {
      const historicalVariance = (ms.actualEndDate && ms.committedBaselineEndDate)
        ? Math.max(0, getDaysDifference(ms.committedBaselineEndDate, ms.actualEndDate))
        : (currentVariance > 0 ? currentVariance : 1);

      const isRoot = !rootDelayStep;
      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: currentVariance,
        delayDays: historicalVariance,
        stageDelayAdded: historicalVariance,
        cumulativeDelay: Math.max(0, currentVariance),
        stageDelta: historicalVariance,
        isRootCause: isRoot,
        isRecovery: false,
        isAdditionalDelay: !isRoot,
        delayCategory: ms.delayCategory,
        delayReason: ms.delayReason,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration }
      };

      if (isRoot) {
        rootDelayStep = step;
      }

      delayedSteps.push(step);
    }
  }

  const lastMilestoneVariance = milestones[milestones.length - 1]?.varianceDays || 0;
  const netVarianceDays = Math.max(0, lastMilestoneVariance);
  const aheadDays = lastMilestoneVariance < 0 && delayedSteps.length === 0 ? Math.abs(lastMilestoneVariance) : 0;
  const hasDelays = delayedSteps.length > 0 || netVarianceDays > 0;

  return {
    hasDelays,
    rootDelayStep,
    delaySteps: delayedSteps,
    allDelayOriginSteps: delayedSteps.filter(s => !s.isRecovery),
    recoverySteps,
    netVarianceDays,
    totalDaysDelayed,
    totalDaysRecovered,
    aheadDays
  };
}

/**
 * Extracts and calculates a clear-cut milestone-by-milestone delay breakdown across the PO or a target product line.
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
      isRecovered: res.totalDaysDelayed > 0 && res.netVarianceDays === 0
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

  // Combine unique delayed steps across lines
  const stepMap = new Map<string, DelayStep>();
  delayedLineResults.forEach(res => {
    res.delaySteps.forEach(step => {
      const existing = stepMap.get(step.stageKey);
      if (!existing || step.stageDelayAdded > existing.stageDelayAdded) {
        stepMap.set(step.stageKey, step);
      }
    });
  });

  const combinedDelaySteps = Array.from(stepMap.values()).sort((a, b) => a.stageOrder - b.stageOrder);
  const rootDelayStep = combinedDelaySteps.find(s => s.isRootCause) || combinedDelaySteps[0] || null;
  const hasDelays = combinedDelaySteps.length > 0 || maxNetVariance > 0;
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
    isRecovered: maxDaysDelayed > 0 && maxNetVariance === 0,
    aheadDays
  };
}

export const DelayAnalysisFlow: React.FC<DelayAnalysisFlowProps> = ({
  po,
  lineId,
  className = ''
}) => {
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

  // Clear-cut, professional Delay Report
  return (
    <div className={`bg-white border border-rose-200 rounded-2xl overflow-hidden shadow-xs space-y-0 ${className}`}>
      
      {/* 1. Header Summary */}
      <div className="p-4 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-sm text-white">
                {netVarianceDays === 0 ? 'Historical Delay & Recovery Log' : 'Milestone Delay Details'}
              </h3>
              {netVarianceDays > 0 ? (
                <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-rose-600 text-white shadow-2xs">
                  +{netVarianceDays} {netVarianceDays === 1 ? 'Day' : 'Days'} Total Delay
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-emerald-600 text-white shadow-2xs flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Schedule Recovered (0d Net Variance)
                </span>
              )}
              {totalDaysRecovered > 0 && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/25 text-emerald-200 border border-emerald-400/30 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-emerald-300" />
                  -{totalDaysRecovered}d Recovered
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              {netVarianceDays === 0
                ? `Historical delay (+${totalDaysDelayed}d) was successfully recovered by fast-tracking subsequent stages.`
                : delaySteps.length === 1 
                ? `1 stage recorded a delay (+${totalDaysDelayed}d total)`
                : `${delaySteps.length} stages recorded variance (+${totalDaysDelayed}d added${totalDaysRecovered > 0 ? `, -${totalDaysRecovered}d recovered` : ''})`
              }
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
      </div>

      {/* 2. Clear-cut Milestone Delay Cards */}
      <div className="p-4 space-y-3 bg-slate-50/50">
        <div className="flex items-center justify-between text-xs text-slate-600 font-bold px-1">
          <span className="flex items-center gap-1.5 text-slate-800">
            <Clock className="w-4 h-4 text-slate-600" />
            <span>Delayed Milestone Breakdown:</span>
          </span>
          <span className="text-[10px] font-mono text-slate-500 font-normal">
            Impact: +{netVarianceDays}d
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
                    ? 'border-emerald-300 bg-emerald-50/30'
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
                      Stage {step.stageOrder}. {step.stageName}
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

                {/* Delay Reason Explanation */}
                {step.delayReason ? (
                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-800 flex items-start gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-rose-700 block">
                        Reason / Notes:
                      </span>
                      <span className="font-medium text-slate-900 text-xs leading-relaxed">
                        {step.delayReason}
                      </span>
                    </div>
                  </div>
                ) : (
                  !isRecovery && (
                    <div className="text-[11px] text-slate-500 italic pl-1">
                      {step.isRootCause 
                        ? 'Initial delay originated at this manufacturing stage.' 
                        : `Additional schedule delay of +${step.stageDelayAdded}d accumulated during this stage.`
                      }
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};




