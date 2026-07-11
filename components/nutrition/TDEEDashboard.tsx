'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type {
  TDEEEstimate,
  WeightPrediction,
  DataQualityCheck,
  BurnRateHistoryPoint,
  RegressionAnalysis,
} from '@/lib/nutrition/adaptive-tdee';
import type { EnhancedTDEEEstimate } from '@/types/wearable';
import { TDEERegressionGraph } from './TDEERegressionGraph';
import { calculateFFMI } from '@/services/bodyCompEngine';
import {
  projectWeightTrajectory,
  type CompositionAnchors,
  type ProjectionPhase,
} from '@/services/weightProjection';

interface ResetResult {
  success: boolean;
  oldEstimate: {
    tdee: number;
    burnRate: number;
    currentWeight: number;
    confidence: string;
  } | null;
  newEstimate: {
    tdee: number;
    burnRate: number;
    currentWeight: number;
    confidence: string;
    dataPointsUsed: number;
    rSquared: number | null;
  } | null;
  weightDataSummary: {
    totalEntries: number;
    entriesWithKgUnit: number;
    entriesWithLbUnit: number;
    entriesWithNullUnit: number;
    dateRange: { earliest: string; latest: string } | null;
  };
  message: string;
}

interface TDEEDashboardProps {
  estimate: TDEEEstimate | EnhancedTDEEEstimate | null;
  formulaEstimate: TDEEEstimate | null;
  predictions: WeightPrediction[];
  dataQuality: DataQualityCheck;
  currentWeight: number | null;
  targetWeight?: number | null;
  targetCalories?: number | null;
  /** Current training phase — drives the projection direction sanity check. */
  phase?: ProjectionPhase | null;
  heightCm?: number | null;
  bodyFatPercent?: number | null;
  avgDailyProteinGrams?: number;
  avgWeeklyTrainingSets?: number;
  trainingAge?: 'beginner' | 'intermediate' | 'advanced';
  isEnhanced?: boolean;
  biologicalSex?: 'male' | 'female';
  chronologicalAge?: number;
  latestDexaScan?: {
    body_fat_percent: number;
    weight_kg: number;
    lean_mass_kg: number;
    fat_mass_kg: number;
  } | null;
  regressionAnalysis?: RegressionAnalysis | null;
  onRefresh?: () => void;
  onSetTarget?: () => void;
  onReset?: () => Promise<ResetResult>;
}

export function TDEEDashboard({
  estimate,
  formulaEstimate,
  predictions,
  dataQuality,
  currentWeight,
  targetWeight,
  targetCalories,
  phase,
  heightCm,
  bodyFatPercent,
  avgDailyProteinGrams,
  avgWeeklyTrainingSets,
  trainingAge,
  isEnhanced,
  biologicalSex,
  chronologicalAge,
  latestDexaScan,
  regressionAnalysis,
  onRefresh,
  onSetTarget,
  onReset,
}: TDEEDashboardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);

  // Weight Projection card is collapsed to a single-line summary by default.
  // The preference persists across sessions.
  const PROJECTION_PREF_KEY = 'hypertrack:weightProjectionExpanded';
  const [projectionExpanded, setProjectionExpanded] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setProjectionExpanded(window.localStorage.getItem(PROJECTION_PREF_KEY) === '1');
  }, []);
  const toggleProjection = () => {
    setProjectionExpanded((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PROJECTION_PREF_KEY, next ? '1' : '0');
      }
      return next;
    });
  };

  const handleReset = async () => {
    if (!onReset) return;

    setIsResetting(true);
    setResetResult(null);

    try {
      const result = await onReset();
      setResetResult(result);

      // Auto-refresh after successful reset
      if (result.success && onRefresh) {
        setTimeout(() => {
          onRefresh();
        }, 1500);
      }
    } catch (error) {
      setResetResult({
        success: false,
        oldEstimate: null,
        newEstimate: null,
        weightDataSummary: {
          totalEntries: 0,
          entriesWithKgUnit: 0,
          entriesWithLbUnit: 0,
          entriesWithNullUnit: 0,
          dateRange: null,
        },
        message: 'Failed to reset TDEE: ' + (error instanceof Error ? error.message : 'Unknown error'),
      });
    } finally {
      setIsResetting(false);
    }
  };

  const activeEstimate = estimate || formulaEstimate;
  const isAdaptive = estimate?.source === 'regression';

  const confidenceColor = useMemo(() => {
    if (!activeEstimate) return 'text-surface-500';
    switch (activeEstimate.confidence) {
      case 'stable':
        return 'text-success-400';
      case 'stabilizing':
        return 'text-warning-400';
      case 'unstable':
        return 'text-danger-400';
      default:
        return 'text-surface-500';
    }
  }, [activeEstimate]);

  const confidenceLabel = useMemo(() => {
    if (!activeEstimate) return 'No data';
    switch (activeEstimate.confidence) {
      case 'stable':
        return 'Estimate stabilized';
      case 'stabilizing':
        return 'Estimate stabilizing...';
      case 'unstable':
        return 'Collecting data...';
      default:
        return 'Unknown';
    }
  }, [activeEstimate]);

  if (!activeEstimate) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-surface-800 flex items-center justify-center">
            <span className="text-3xl">🔥</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-surface-100">
              Start Tracking Your Metabolism
            </h3>
            <p className="text-sm text-surface-400 mt-1">
              Log your weight and nutrition daily to unlock personalized TDEE estimates.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-surface-500">
            <span>0/{dataQuality.daysWithData || 14} days logged</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main TDEE Card */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center">
              <span className="text-xl">🔥</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-surface-100">Your Metabolism</h3>
              <p className="text-xs text-surface-500">
                {isAdaptive ? 'Personalized from your data' : 'Estimated from formula'}
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/learn/adaptive-tdee"
            className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
          >
            How it works →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* TDEE Value */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wide mb-1">
              Estimated TDEE
            </p>
            <p className="text-3xl font-bold text-surface-100">
              {activeEstimate.estimatedTDEE.toLocaleString()}
              <span className="text-lg font-normal text-surface-400 ml-1">cal/day</span>
            </p>
          </div>

          {/* Burn Rate */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wide mb-1">Burn Rate</p>
            <p className="text-2xl font-bold text-surface-100">
              {activeEstimate.burnRatePerLb.toFixed(1)}
              <span className="text-sm font-normal text-surface-400 ml-1">cal/lb</span>
            </p>
          </div>
        </div>

        {/* Confidence Indicator */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-surface-500">Confidence</span>
            <span className={`text-xs font-medium ${confidenceColor}`}>
              {activeEstimate.confidenceScore}%
            </span>
          </div>
          <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                activeEstimate.confidence === 'stable'
                  ? 'bg-success-500'
                  : activeEstimate.confidence === 'stabilizing'
                    ? 'bg-warning-500'
                    : 'bg-danger-500'
              }`}
              style={{ width: `${activeEstimate.confidenceScore}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className={`text-xs ${confidenceColor}`}>{confidenceLabel}</p>
            {isAdaptive && (
              <p className="text-xs text-surface-500">
                Based on {activeEstimate.dataPointsUsed} days
              </p>
            )}
          </div>
        </div>

        {/* Formula Comparison */}
        {isAdaptive && formulaEstimate && (
          <div className="mt-4 p-3 bg-surface-800/50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-surface-400">Formula estimate</span>
              <span className="text-sm text-surface-300">
                {formulaEstimate.estimatedTDEE.toLocaleString()} cal/day
              </span>
            </div>
            {Math.abs(activeEstimate.estimatedTDEE - formulaEstimate.estimatedTDEE) > 100 && (
              <p className="text-xs text-surface-500 mt-1">
                Your actual metabolism is{' '}
                {activeEstimate.estimatedTDEE > formulaEstimate.estimatedTDEE
                  ? 'higher'
                  : 'lower'}{' '}
                than formulas predict by{' '}
                {Math.abs(activeEstimate.estimatedTDEE - formulaEstimate.estimatedTDEE)} cal
              </p>
            )}
          </div>
        )}

        {/* Data Quality Warnings */}
        {dataQuality.issues.length > 0 && (
          <div className="mt-4 p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-warning-400">⚠</span>
              <div className="flex-1">
                <p className="text-xs text-warning-300">
                  {dataQuality.issues[0]}
                </p>
                {dataQuality.suggestions[0] && (
                  <p className="text-xs text-surface-400 mt-1">
                    Tip: {dataQuality.suggestions[0]}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* View Details Toggle */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full mt-4 py-2 text-xs text-surface-400 hover:text-surface-300 transition-colors flex items-center justify-center gap-1"
        >
          {showDetails ? 'Hide details' : 'View details'}
          <svg
            className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </Card>

      {/* TDEE Regression Analysis Graph - prominently displayed when we have data */}
      {regressionAnalysis && regressionAnalysis.dataPoints.length >= 5 && (
        <TDEERegressionGraph regressionAnalysis={regressionAnalysis} />
      )}

      {/* Convergence Chart (shown when expanded) */}
      {showDetails && activeEstimate.estimateHistory.length > 0 && (
        <Card className="p-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Estimate Convergence</CardTitle>
            <p className="text-xs text-surface-500">
              Watch your personal burn rate stabilize over time
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeEstimate.estimateHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#888' }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis
                    domain={[10, 18]}
                    tick={{ fontSize: 10, fill: '#888' }}
                    tickFormatter={(value) => `${value}`}
                    label={{
                      value: 'cal/lb',
                      angle: -90,
                      position: 'insideLeft',
                      fontSize: 10,
                      fill: '#888',
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    labelFormatter={(value) => `Date: ${value}`}
                    formatter={(value: number) => [`${value.toFixed(1)} cal/lb`, 'Burn Rate']}
                  />
                  <ReferenceLine
                    y={activeEstimate.burnRatePerLb}
                    stroke="#22c55e"
                    strokeDasharray="3 3"
                    label={{
                      value: 'Current',
                      position: 'right',
                      fontSize: 10,
                      fill: '#22c55e',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="burnRate"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-surface-500 text-center mt-2">
              {activeEstimate.confidence === 'stable'
                ? 'Your estimate has stabilized. Predictions should be accurate!'
                : 'Keep logging data for more accurate estimates'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Reset & Recalculate Section (shown when expanded) */}
      {showDetails && onReset && (
        <Card className="p-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Recalculate TDEE</CardTitle>
            <p className="text-xs text-surface-500">
              Reset and recalculate your TDEE estimate from your weight data
            </p>
          </CardHeader>
          <CardContent>
            {/* Reset Result Display */}
            {resetResult && (
              <div
                className={`mb-4 p-4 rounded-lg border ${
                  resetResult.success
                    ? 'bg-success-500/10 border-success-500/20'
                    : 'bg-danger-500/10 border-danger-500/20'
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    resetResult.success ? 'text-success-300' : 'text-danger-300'
                  }`}
                >
                  {resetResult.success ? '✓ ' : '✗ '}
                  {resetResult.message}
                </p>

                {resetResult.success && resetResult.weightDataSummary.totalEntries > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-surface-400">Weight Data Summary:</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-surface-500">Total entries:</span>
                        <span className="text-surface-300">
                          {resetResult.weightDataSummary.totalEntries}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-surface-500">In kg:</span>
                        <span className="text-surface-300">
                          {resetResult.weightDataSummary.entriesWithKgUnit}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-surface-500">In lbs:</span>
                        <span className="text-surface-300">
                          {resetResult.weightDataSummary.entriesWithLbUnit}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-surface-500">No unit:</span>
                        <span className="text-surface-300">
                          {resetResult.weightDataSummary.entriesWithNullUnit}
                        </span>
                      </div>
                    </div>

                    {resetResult.oldEstimate && resetResult.newEstimate && (
                      <div className="mt-3 pt-3 border-t border-surface-700">
                        <p className="text-xs text-surface-400 mb-2">Before → After:</p>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-surface-500">TDEE:</span>
                            <span>
                              <span className="text-surface-400">
                                {resetResult.oldEstimate.tdee.toLocaleString()}
                              </span>
                              <span className="text-surface-500 mx-1">→</span>
                              <span className="text-success-400">
                                {resetResult.newEstimate.tdee.toLocaleString()} cal/day
                              </span>
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-500">Weight:</span>
                            <span>
                              <span className="text-surface-400">
                                {resetResult.oldEstimate.currentWeight.toFixed(1)}
                              </span>
                              <span className="text-surface-500 mx-1">→</span>
                              <span className="text-success-400">
                                {resetResult.newEstimate.currentWeight.toFixed(1)} lbs
                              </span>
                            </span>
                          </div>
                          {resetResult.newEstimate.rSquared !== null && (
                            <div className="flex justify-between">
                              <span className="text-surface-500">R² correlation:</span>
                              <span className="text-success-400">
                                {(resetResult.newEstimate.rSquared * 100).toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <Button
              onClick={handleReset}
              disabled={isResetting}
              variant="outline"
              size="sm"
              className="w-full"
            >
              {isResetting ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Recalculating...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Reset &amp; Recalculate TDEE
                </>
              )}
            </Button>

            <p className="text-xs text-surface-500 mt-3 text-center">
              This will delete your current TDEE estimate and recalculate it fresh from your weight
              and calorie data.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Weight Projection */}
      {predictions.length > 0 && currentWeight && activeEstimate && (() => {
        // Composition anchors. Height is the gate; body fat falls back to the
        // latest DEXA scan, then a conservative 15% default.
        const currentBF =
          bodyFatPercent ??
          (latestDexaScan ? (latestDexaScan.fat_mass_kg / latestDexaScan.weight_kg) * 100 : null) ??
          (heightCm ? 15 : null);

        const composition: CompositionAnchors | null =
          heightCm && currentBF != null
            ? {
                heightCm,
                currentBodyFatPercent: currentBF,
                avgDailyProteinGrams: avgDailyProteinGrams ?? 150,
                avgWeeklyTrainingSets: avgWeeklyTrainingSets ?? 10,
                trainingAge: trainingAge ?? 'intermediate',
                isEnhanced: isEnhanced ?? false,
                biologicalSex: biologicalSex ?? 'male',
                chronologicalAge,
              }
            : null;

        const currentLeanMassKg =
          currentBF != null ? (currentWeight / 2.20462) * (1 - currentBF / 100) : null;
        const currentFFMI =
          heightCm && currentLeanMassKg != null
            ? calculateFFMI(currentLeanMassKg, heightCm).normalizedFfmi
            : null;

        // Single source of truth: the projection consumes the SAME TDEE shown on
        // the Metabolism card (activeEstimate). The calorie figure is the current
        // phase's target — never a value cached from a previous phase.
        const projectionTdee = activeEstimate.estimatedTDEE;
        const usedCalories =
          targetCalories ?? predictions[0]?.assumedDailyCalories ?? projectionTdee;
        const phaseValue: ProjectionPhase = phase ?? 'maintenance';

        const projection = projectWeightTrajectory({
          now: new Date(),
          currentWeightLbs: currentWeight,
          tdee: projectionTdee,
          targetCalories: usedCalories,
          phase: phaseValue,
          standardError: activeEstimate.standardError,
          horizonDays: predictions.slice(0, 4).map((p) => p.daysFromNow),
          composition,
        });

        const headline = projection.horizons[projection.horizons.length - 1];
        const headlineDate = new Date(headline.targetDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });

        const mismatchNote = projection.directionMismatch
          ? `This projection assumes ${usedCalories.toLocaleString()} cal/day, ${
              usedCalories < projectionTdee ? 'below' : 'above'
            } your estimated TDEE (${projectionTdee.toLocaleString()}) — check your calorie target.`
          : null;

        const fmt = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(1));

        return (
          <Card className="p-6" data-testid="weight-projection">
            {/* Header + single-line summary (collapsed by default) */}
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={toggleProjection}
                aria-expanded={projectionExpanded}
                data-testid="weight-projection-toggle"
                className="flex-1 min-w-0 text-left group"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-surface-100">Weight Projection</h3>
                  <svg
                    className={`w-4 h-4 text-surface-500 transition-transform ${projectionExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <p
                  className="text-xs text-surface-400 mt-1 truncate"
                  data-testid="weight-projection-summary"
                >
                  Projected: {fmt(headline.predictedWeightLbs)} lbs by {headlineDate} (±
                  {fmt(headline.marginLbs)}) · at {usedCalories.toLocaleString()} cal/day
                </p>
              </button>
              {onSetTarget && (
                <Button variant="ghost" size="sm" onClick={onSetTarget}>
                  Adjust
                </Button>
              )}
            </div>

            {/* Direction sanity check — surfaced whether collapsed or expanded */}
            {mismatchNote && (
              <div
                className="mt-3 p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg"
                data-testid="weight-projection-mismatch"
              >
                <p className="text-xs text-warning-300 flex items-start gap-2">
                  <span aria-hidden>⚠</span>
                  <span>{mismatchNote}</span>
                </p>
              </div>
            )}

            {projectionExpanded && (
              <>
                {/* Consolidated horizon table: one row per horizon */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm" data-testid="weight-projection-table">
                    <thead>
                      <tr className="text-xs text-surface-500 text-left">
                        <th className="font-normal pb-2">When</th>
                        <th className="font-normal pb-2 text-right">Weight</th>
                        <th className="font-normal pb-2 text-right">BF%</th>
                        <th className="font-normal pb-2 text-right">FFMI</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-surface-800">
                        <td className="py-2 text-surface-400">Current</td>
                        <td className="py-2 text-right font-semibold text-surface-100">
                          {currentWeight.toFixed(1)} lbs
                        </td>
                        <td className="py-2 text-right text-surface-300">
                          {currentBF != null ? `${currentBF.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 text-right text-surface-300">
                          {currentFFMI != null ? currentFFMI.toFixed(1) : '—'}
                        </td>
                      </tr>
                      {projection.horizons.map((h) => (
                        <tr key={h.targetDate} className="border-t border-surface-800">
                          <td className="py-2 text-surface-400">
                            {h.daysFromNow}d
                            <span className="text-xs text-surface-500 ml-1">
                              (
                              {new Date(h.targetDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                              )
                            </span>
                          </td>
                          <td className="py-2 text-right font-semibold text-surface-100">
                            {fmt(h.predictedWeightLbs)}
                            <span className="text-xs text-surface-500 ml-1">
                              (±{fmt(h.marginLbs)})
                            </span>
                          </td>
                          <td className="py-2 text-right text-surface-300">
                            {h.bodyFatPercent != null ? `${h.bodyFatPercent.toFixed(1)}%` : '—'}
                          </td>
                          <td className="py-2 text-right text-surface-300">
                            {h.ffmi != null ? h.ffmi.toFixed(1) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {targetWeight && activeEstimate.confidence !== 'unstable' && !projection.directionMismatch && (
                  <div className="mt-4 p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                    <p className="text-xs text-primary-300">
                      <span className="font-semibold">Target {targetWeight} lbs:</span>{' '}
                      Estimated in{' '}
                      {Math.ceil(
                        Math.abs(currentWeight - targetWeight) /
                          Math.abs(projection.dailyWeightChangeLbs || Infinity)
                      )}{' '}
                      days
                    </p>
                  </div>
                )}

                {/* One uncertainty warning for the whole card */}
                {(projection.confidenceLevel === 'low' || !composition) && (
                  <p
                    className="mt-3 text-xs text-surface-500"
                    data-testid="weight-projection-uncertainty"
                  >
                    ⚠️ Wide uncertainty range — log DEXA scans to improve accuracy.
                    {!composition && !heightCm && ' Add your height to project body composition.'}
                  </p>
                )}

                <Link
                  href="/dashboard/learn/adaptive-tdee"
                  className="block mt-4 text-center text-xs text-surface-500 hover:text-surface-400 transition-colors"
                >
                  How accurate is this? →
                </Link>
              </>
            )}
          </Card>
        );
      })()}

      {/* Data Collection Progress (when not enough data) */}
      {!isAdaptive && (
        <Card className="p-4 bg-surface-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-500/10 flex items-center justify-center">
              <span className="text-lg">📊</span>
            </div>
            <div className="flex-1">
              <p className="text-sm text-surface-200">Building your personal estimate</p>
              <p className="text-xs text-surface-500">
                {dataQuality.daysWithData} of 14 days logged
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-primary-400">
                {Math.round((dataQuality.daysWithData / 14) * 100)}%
              </p>
            </div>
          </div>
          <div className="mt-3 h-1.5 bg-surface-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 transition-all duration-500"
              style={{ width: `${Math.min((dataQuality.daysWithData / 14) * 100, 100)}%` }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

export default TDEEDashboard;
