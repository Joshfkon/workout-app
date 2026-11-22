'use client';

import { IconChartBar, IconFlame, IconInfoCircle, IconScale, IconToolsKitchen2 } from '@tabler/icons-react';
import { useState, useMemo } from 'react';
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
import type { IntervalTDEEResult } from '@/lib/nutrition/interval-tdee';
import { TDEERegressionGraph } from './TDEERegressionGraph';
import { calculateFFMI } from '@/services/bodyCompEngine';
import {
  calculatePRatio,
  predictWeightGainComposition,
  type PRatioInputs,
  type BodyCompProjection,
} from '@/lib/body-composition/p-ratio';
import {
  selectUsablePRatioPairs,
  type ScanPairPRatio,
} from '@/services/compositionSpace';

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
  /** Interval-based estimate that drives the card's headline, subtitle,
   *  confidence framing and correctly-attributed warnings. */
  intervalEstimate?: IntervalTDEEResult | null;
  predictions: WeightPrediction[];
  dataQuality: DataQualityCheck;
  currentWeight: number | null;
  targetWeight?: number | null;
  targetCalories?: number | null;
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
  /**
   * Realized p-ratios between consecutive DEXA scan pairs
   * (computeScanPairPRatios output, date-ascending). Direction-matched,
   * noise-gated pairs feed calculatePRatio's personalPRatioHistory so the
   * projection learns the user's own partitioning.
   */
  scanPairPRatios?: ScanPairPRatio[];
  regressionAnalysis?: RegressionAnalysis | null;
  onRefresh?: () => void;
  onSetTarget?: () => void;
  onReset?: () => Promise<ResetResult>;
}

export function TDEEDashboard({
  estimate,
  formulaEstimate,
  intervalEstimate,
  predictions,
  dataQuality,
  currentWeight,
  targetWeight,
  targetCalories,
  heightCm,
  bodyFatPercent,
  avgDailyProteinGrams,
  avgWeeklyTrainingSets,
  trainingAge,
  isEnhanced,
  biologicalSex,
  chronologicalAge,
  latestDexaScan,
  scanPairPRatios,
  regressionAnalysis,
  onRefresh,
  onSetTarget,
  onReset,
}: TDEEDashboardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);

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
  // "Adaptive" now means the estimate is informed by the user's own data — the
  // interval blend or the legacy regression. Formula-only is the exception.
  const hasPersonalData =
    (intervalEstimate ? intervalEstimate.source === 'blended' : false) ||
    estimate?.source === 'regression' ||
    estimate?.source === 'blended';
  const isAdaptive = hasPersonalData;

  const confidenceColor = useMemo(() => {
    if (!activeEstimate) return 'text-ink-3';
    switch (activeEstimate.confidence) {
      case 'stable':
        return 'text-status-ok';
      case 'stabilizing':
        return 'text-status-warn';
      case 'unstable':
        return 'text-ink-2';
      default:
        return 'text-ink-3';
    }
  }, [activeEstimate]);

  // Confidence is a statement of how personalized the number is — NOT a
  // progress bar toward the feature unlocking. Low confidence still ships a
  // real (formula-leaning) answer, so the copy never says "collecting data".
  const confidenceLabel = useMemo(() => {
    if (!activeEstimate) return 'No data';
    switch (activeEstimate.confidence) {
      case 'stable':
        return 'Highly personalized';
      case 'stabilizing':
        return 'Personalizing as you log';
      case 'unstable':
        return 'Personalizing as you log';
      default:
        return 'Personalizing as you log';
    }
  }, [activeEstimate]);

  // Prefer the interval estimate for the headline figures; fall back to the
  // legacy estimate for callers that don't pass one.
  const displayTDEE = intervalEstimate?.estimatedTDEE ?? activeEstimate?.estimatedTDEE ?? 0;
  const displayBurnRate = intervalEstimate?.burnRatePerLb ?? activeEstimate?.burnRatePerLb ?? 0;
  const displayConfidenceScore =
    intervalEstimate?.confidenceScore ?? activeEstimate?.confidenceScore ?? 0;
  const baseSubtitle =
    intervalEstimate?.personalizationLabel ??
    (isAdaptive ? 'Personalized from your data' : 'Estimated from formula');
  // Note when wearable steps informed the formula prior's activity multiplier
  // (steps feed the prior only — never added on top of the blended estimate).
  const subtitle = formulaEstimate?.activityInformed
    ? `${baseSubtitle} · activity-informed`
    : baseSubtitle;
  // Correctly-attributed warnings (calories vs weight) take precedence over the
  // legacy generic data-quality issues.
  const cardWarnings = intervalEstimate?.warnings ?? [];

  if (!activeEstimate) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-fill flex items-center justify-center">
            <IconFlame size={28} className="text-orange-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-headline font-semibold text-ink">
              Start tracking your metabolism
            </h3>
            <p className="text-subhead text-ink-2 mt-1">
              Log your weight and nutrition daily to unlock personalized TDEE estimates.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-subhead text-ink-3">
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
            <div className="bg-orange-500/20 w-10 h-10 rounded-full flex items-center justify-center">
              <IconFlame size={20} className="text-orange-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-headline font-semibold text-ink">Your metabolism</h3>
              <p className="text-caption text-ink-3">{subtitle}</p>
            </div>
          </div>
          <Link
            href="/dashboard/learn/adaptive-tdee"
            className="text-caption text-action transition-colors"
          >
            How it works →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* TDEE Value */}
          <div>
            <p className="text-caption text-ink-3 mb-1">
              Estimated TDEE
            </p>
            <p className="text-large-title font-bold text-ink">
              {displayTDEE.toLocaleString()}
              <span className="text-headline font-normal text-ink-2 ml-1">cal/day</span>
            </p>
          </div>

          {/* Burn Rate */}
          <div>
            <p className="text-caption text-ink-3 mb-1">Burn rate</p>
            <p className="text-title font-bold text-ink">
              {displayBurnRate.toFixed(1)}
              <span className="text-subhead font-normal text-ink-2 ml-1">cal/lb</span>
            </p>
          </div>
        </div>

        {/* Confidence Indicator */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption text-ink-3">Personalization</span>
            <span className={`text-caption font-medium ${confidenceColor}`}>
              {displayConfidenceScore}%
            </span>
          </div>
          <div className="h-2 bg-fill rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                activeEstimate.confidence === 'stable'
                  ? 'bg-status-ok'
                  : activeEstimate.confidence === 'stabilizing'
                    ? 'bg-status-warn'
                    : 'bg-action'
              }`}
              style={{ width: `${Math.max(displayConfidenceScore, 4)}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className={`text-caption ${confidenceColor}`}>{confidenceLabel}</p>
            {intervalEstimate && intervalEstimate.usableIntervalDays > 0 && (
              <p className="text-caption text-ink-3">
                {intervalEstimate.weighInCount} weigh-ins · {intervalEstimate.usableIntervalDays} interval-days
              </p>
            )}
          </div>
        </div>

        {/* Formula Comparison — shown once the blend is informed by real data */}
        {isAdaptive && formulaEstimate && (
          <div className="mt-4 p-3 bg-fill/50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-caption text-ink-2">Formula estimate</span>
              <span className="text-subhead text-ink-2">
                {formulaEstimate.estimatedTDEE.toLocaleString()} cal/day
              </span>
            </div>
            {Math.abs(displayTDEE - formulaEstimate.estimatedTDEE) > 100 && (
              <p className="text-caption text-ink-3 mt-1">
                Your actual metabolism is{' '}
                {displayTDEE > formulaEstimate.estimatedTDEE ? 'higher' : 'lower'}{' '}
                than formulas predict by{' '}
                {Math.abs(displayTDEE - formulaEstimate.estimatedTDEE)} cal
              </p>
            )}
          </div>
        )}

        {/* Warnings — correctly attributed (missing calories vs missing weight) */}
        {cardWarnings.length > 0
          ? cardWarnings.slice(0, 2).map((warning, i) => (
              <div
                key={`${warning.kind}-${i}`}
                className="mt-4 p-3 bg-status-warn/10 border border-status-warn/20 rounded-lg"
              >
                <div className="flex items-start gap-2">
                  <span className="text-status-warn mt-px">
                    {warning.kind === 'missing_calories'
                      ? <IconToolsKitchen2 className="h-4 w-4" stroke={1.75} aria-hidden="true" />
                      : warning.kind === 'missing_weight'
                        ? <IconScale className="h-4 w-4" stroke={1.75} aria-hidden="true" />
                        : <IconInfoCircle className="h-4 w-4" stroke={1.75} aria-hidden="true" />}
                  </span>
                  <p className="flex-1 text-caption text-status-warn">{warning.message}</p>
                </div>
              </div>
            ))
          : !intervalEstimate && dataQuality.issues.length > 0 && (
              <div className="mt-4 p-3 bg-status-warn/10 border border-status-warn/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-status-warn">⚠</span>
                  <div className="flex-1">
                    <p className="text-caption text-status-warn">{dataQuality.issues[0]}</p>
                    {dataQuality.suggestions[0] && (
                      <p className="text-caption text-ink-2 mt-1">Tip: {dataQuality.suggestions[0]}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

        {/* View Details Toggle */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full mt-4 py-2 text-caption text-ink-2 hover:text-ink-2 transition-colors flex items-center justify-center gap-1"
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
            <CardTitle className="text-body">Estimate convergence</CardTitle>
            <p className="text-caption text-ink-3">
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
                    formatter={(value: number) => [`${value.toFixed(1)} cal/lb`, 'Burn rate']}
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
            <p className="text-caption text-ink-3 text-center mt-2">
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
            <CardTitle className="text-body">Recalculate TDEE</CardTitle>
            <p className="text-caption text-ink-3">
              Reset and recalculate your TDEE estimate from your weight data
            </p>
          </CardHeader>
          <CardContent>
            {/* Reset Result Display */}
            {resetResult && (
              <div
                className={`mb-4 p-4 rounded-lg border ${
                  resetResult.success
                    ? 'bg-status-ok/10 border-status-ok/20'
                    : 'bg-status-bad/10 border-status-bad/20'
                }`}
              >
                <p
                  className={`text-subhead font-medium ${
                    resetResult.success ? 'text-status-ok' : 'text-status-bad'
                  }`}
                >
                  {resetResult.success ? '✓ ' : '✗ '}
                  {resetResult.message}
                </p>

                {resetResult.success && resetResult.weightDataSummary.totalEntries > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-caption text-ink-2">Weight data summary:</p>
                    <div className="grid grid-cols-2 gap-2 text-caption">
                      <div className="flex justify-between">
                        <span className="text-ink-3">Total entries:</span>
                        <span className="text-ink-2">
                          {resetResult.weightDataSummary.totalEntries}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-3">In kg:</span>
                        <span className="text-ink-2">
                          {resetResult.weightDataSummary.entriesWithKgUnit}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-3">In lbs:</span>
                        <span className="text-ink-2">
                          {resetResult.weightDataSummary.entriesWithLbUnit}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-3">No unit:</span>
                        <span className="text-ink-2">
                          {resetResult.weightDataSummary.entriesWithNullUnit}
                        </span>
                      </div>
                    </div>

                    {resetResult.oldEstimate && resetResult.newEstimate && (
                      <div className="mt-3 pt-3 border-t border-sep">
                        <p className="text-caption text-ink-2 mb-2">Before → After:</p>
                        <div className="space-y-1 text-caption">
                          <div className="flex justify-between">
                            <span className="text-ink-3">TDEE:</span>
                            <span>
                              <span className="text-ink-2">
                                {resetResult.oldEstimate.tdee.toLocaleString()}
                              </span>
                              <span className="text-ink-3 mx-1">→</span>
                              <span className="text-status-ok">
                                {resetResult.newEstimate.tdee.toLocaleString()} cal/day
                              </span>
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-ink-3">Weight:</span>
                            <span>
                              <span className="text-ink-2">
                                {resetResult.oldEstimate.currentWeight.toFixed(1)}
                              </span>
                              <span className="text-ink-3 mx-1">→</span>
                              <span className="text-status-ok">
                                {resetResult.newEstimate.currentWeight.toFixed(1)} lbs
                              </span>
                            </span>
                          </div>
                          {resetResult.newEstimate.rSquared !== null && (
                            <div className="flex justify-between">
                              <span className="text-ink-3">R² correlation:</span>
                              <span className="text-status-ok">
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

            <p className="text-caption text-ink-3 mt-3 text-center">
              This will delete your current TDEE estimate and recalculate it fresh from your weight
              and calorie data.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Weight Predictions */}
      {predictions.length > 0 && currentWeight && (() => {
        // Calculate current body composition
        const currentWeightKg = currentWeight / 2.20462;
        const currentBodyFatPercent = bodyFatPercent || (heightCm ? 15 : null); // Default estimate if not available
        const currentLeanMassKg = currentBodyFatPercent 
          ? currentWeightKg * (1 - currentBodyFatPercent / 100)
          : null;
        const currentFFMI = heightCm && currentLeanMassKg
          ? calculateFFMI(currentLeanMassKg, heightCm)
          : null;

        // Helper function to project body composition using P-ratio
        const projectBodyComposition = (prediction: WeightPrediction): BodyCompProjection | null => {
          // Need minimum data
          if (!heightCm || !currentWeight) {
            return null;
          }

          // Both currentWeight and prediction.predictedWeight are in lbs
          const currentWeightKg = currentWeight / 2.20462;
          const predictedWeightKg = prediction.predictedWeight / 2.20462; // prediction.predictedWeight is already in lbs
          const weightChangeKg = predictedWeightKg - currentWeightKg;

          // Can't predict composition without baseline - use fallback if height is available
          const currentBodyFat = bodyFatPercent ||
            (latestDexaScan ? (latestDexaScan.fat_mass_kg / latestDexaScan.weight_kg) * 100 : null) ||
            (heightCm ? 15 : null); // Default 15% if we have height but no body fat data

          if (!currentBodyFat) {
            return null;
          }

          const currentLeanMassKg = currentWeightKg * (1 - currentBodyFat / 100);

          // Calculate energy balance for P-ratio
          if (!activeEstimate) {
            return null;
          }
          
          const dailyDeficit = activeEstimate.estimatedTDEE - (targetCalories || prediction.assumedDailyCalories);
          // Energy balance: negative = deficit, positive = surplus
          const energyBalancePercent = (dailyDeficit / activeEstimate.estimatedTDEE) * 100;
          
          // Learned partitioning: scan pairs matching THIS prediction's
          // direction (a gain projection learns only from surplus pairs, a
          // loss projection only from deficit pairs). Selection — noise
          // gates included — lives in selectUsablePRatioPairs so every
          // consumer filters identically. fatFraction is calculatePRatio's
          // p-ratio convention (share of the weight change that is fat) and
          // is non-null on every pair the selector keeps. Note: only the
          // loss path (calculatePRatio) consumes the history today;
          // predictWeightGainComposition ignores it by design.
          const usablePairs = selectUsablePRatioPairs(
            scanPairPRatios ?? [],
            weightChangeKg > 0 ? 'surplus' : 'deficit'
          );
          const personalPRatioHistory =
            usablePairs.length > 0
              ? usablePairs.map((pair) => pair.fatFraction as number)
              : undefined;

          // Build P-ratio inputs from available data
          const pRatioInputs: PRatioInputs = {
            avgDailyProteinGrams: avgDailyProteinGrams || 150, // Fallback
            avgDailyProteinPerKgBW: (avgDailyProteinGrams || 150) / currentWeightKg,
            avgWeeklyTrainingSets: avgWeeklyTrainingSets || 10, // Fallback
            avgDailyDeficitCals: dailyDeficit,
            energyBalancePercent, // Negative = deficit, positive = surplus
            currentBodyFatPercent: currentBodyFat,
            currentLeanMassKg,
            trainingAge: trainingAge || 'intermediate',
            isEnhanced: isEnhanced || false,
            biologicalSex: biologicalSex || 'male',
            chronologicalAge,
            personalPRatioHistory,
          };
          
          // Handle weight gain differently
          if (weightChangeKg > 0) {
            return predictWeightGainComposition(
              currentWeightKg,
              predictedWeightKg,
              currentBodyFat,
              heightCm,
              pRatioInputs
            );
          }
          
          // Weight loss projection
          const pRatioResult = calculatePRatio(pRatioInputs);
          const [pRatioLow, pRatioHigh] = pRatioResult.confidenceRange;
          const pRatioMid = pRatioResult.finalPRatio;
          
          const currentFatMassKg = currentWeightKg * (currentBodyFat / 100);
          
          // Pessimistic (low P-ratio = more muscle loss)
          const pessimisticFatLoss = weightChangeKg * pRatioLow;
          const pessimisticLeanLoss = weightChangeKg * (1 - pRatioLow);
          const pessimisticFatMass = currentFatMassKg + pessimisticFatLoss;
          const pessimisticLeanMass = currentLeanMassKg + pessimisticLeanLoss;
          const pessimisticBF = (pessimisticFatMass / predictedWeightKg) * 100;
          const pessimisticFFMI = calculateFFMI(pessimisticLeanMass, heightCm);
          
          // Expected (mid P-ratio)
          const expectedFatLoss = weightChangeKg * pRatioMid;
          const expectedLeanLoss = weightChangeKg * (1 - pRatioMid);
          const expectedFatMass = currentFatMassKg + expectedFatLoss;
          const expectedLeanMass = currentLeanMassKg + expectedLeanLoss;
          const expectedBF = (expectedFatMass / predictedWeightKg) * 100;
          const expectedFFMI = calculateFFMI(expectedLeanMass, heightCm);
          
          // Optimistic (high P-ratio = mostly fat loss)
          const optimisticFatLoss = weightChangeKg * pRatioHigh;
          const optimisticLeanLoss = weightChangeKg * (1 - pRatioHigh);
          const optimisticFatMass = currentFatMassKg + optimisticFatLoss;
          const optimisticLeanMass = currentLeanMassKg + optimisticLeanLoss;
          const optimisticBF = (optimisticFatMass / predictedWeightKg) * 100;
          const optimisticFFMI = calculateFFMI(optimisticLeanMass, heightCm);
          
          const rangeSpread = pRatioResult.confidenceRange[1] - pRatioResult.confidenceRange[0];
          const confidenceLevel = rangeSpread < 0.12
            ? 'high'      // Very narrow range, have DEXA calibration
            : rangeSpread < 0.18
            ? 'reasonable'
            : 'low';
          
          return {
            ffmi: {
              pessimistic: pessimisticFFMI.normalizedFfmi,
              expected: expectedFFMI.normalizedFfmi,
              optimistic: optimisticFFMI.normalizedFfmi,
            },
            bodyFatPercent: {
              pessimistic: pessimisticBF,
              expected: expectedBF,
              optimistic: optimisticBF,
            },
            pRatioUsed: pRatioMid,
            confidenceLevel,
            factors: pRatioResult.factors,
          };
        };

        return (
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-body font-semibold text-ink">Weight projection</h3>
                <p className="text-caption text-ink-3">
                  At {targetCalories?.toLocaleString() || predictions[0]?.assumedDailyCalories.toLocaleString()} cal/day
                </p>
              </div>
              {onSetTarget && (
                <Button variant="ghost" size="sm" onClick={onSetTarget}>
                  Adjust
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {/* Current */}
              <div className="py-2 border-b border-sep">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-subhead text-ink-2">Current</span>
                  <span className="text-subhead font-semibold text-ink">
                    {currentWeight.toFixed(1)} lbs
                  </span>
                </div>
                {currentFFMI && currentBodyFatPercent && (
                  <div className="flex items-center justify-between mt-2 text-caption">
                    <span className="text-ink-3">FFMI:</span>
                    <span className="text-ink-2">{currentFFMI.normalizedFfmi.toFixed(1)}</span>
                    <span className="text-ink-3 ml-3">BF%:</span>
                    <span className="text-ink-2">{currentBodyFatPercent.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {/* Projections */}
              {predictions.slice(0, 4).map((prediction) => {
                const bodyComp = projectBodyComposition(prediction);
                return (
                  <div
                    key={prediction.targetDate}
                    className="py-2 border-b border-sep last:border-0"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-subhead text-ink-2">
                        In {prediction.daysFromNow} days
                        <span className="text-caption text-ink-3 ml-1">
                          ({new Date(prediction.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
                        </span>
                      </span>
                      <div className="text-right">
                        <span className="text-subhead font-semibold text-ink">
                          {prediction.predictedWeight} lbs
                        </span>
                        <span className="text-caption text-ink-3 ml-1">
                          (±{((prediction.confidenceRange[1] - prediction.confidenceRange[0]) / 2).toFixed(1)})
                        </span>
                      </div>
                    </div>
                    {bodyComp ? (
                      <div className="mt-2 p-2 bg-fill/30 rounded text-caption">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-ink-3">Body Fat %</span>
                          <div className="flex items-center gap-1">
                            <span className="text-ink-3">{bodyComp.bodyFatPercent.pessimistic.toFixed(0)}%</span>
                            <span className="text-ink-2">→</span>
                            <span className="text-ink font-medium">{bodyComp.bodyFatPercent.expected.toFixed(0)}%</span>
                            <span className="text-ink-2">→</span>
                            <span className="text-status-ok">{bodyComp.bodyFatPercent.optimistic.toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-ink-3">FFMI</span>
                          <div className="flex items-center gap-1">
                            <span className="text-ink-3">{bodyComp.ffmi.pessimistic.toFixed(1)}</span>
                            <span className="text-ink-2">→</span>
                            <span className="text-ink font-medium">{bodyComp.ffmi.expected.toFixed(1)}</span>
                            <span className="text-ink-2">→</span>
                            <span className="text-status-ok">{bodyComp.ffmi.optimistic.toFixed(1)}</span>
                          </div>
                        </div>
                        {bodyComp.confidenceLevel === 'low' && (
                          <p className="text-ink-3 mt-1 text-caption">
                            Wide uncertainty range - log DEXA scans to improve
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2 p-2 bg-fill/30 rounded text-caption text-ink-3">
                        <p className="text-caption">
                          Body composition projection unavailable. 
                          {!heightCm && ' Height required.'}
                          {!activeEstimate && ' TDEE estimate required.'}
                          {!bodyFatPercent && !latestDexaScan && heightCm && ' Using default body fat estimate.'}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {targetWeight && activeEstimate.confidence !== 'unstable' && (
            <div className="mt-4 p-3 bg-action/10 border border-action/20 rounded-lg">
              <p className="text-caption text-action">
                <span className="font-semibold">Target {targetWeight} lbs:</span>{' '}
                Estimated in{' '}
                {Math.ceil(
                  Math.abs(currentWeight - targetWeight) /
                    Math.abs(
                      ((targetCalories || predictions[0]?.assumedDailyCalories || activeEstimate.estimatedTDEE) -
                        activeEstimate.estimatedTDEE) /
                        3500
                    )
                )}{' '}
                days
              </p>
            </div>
          )}

            <Link
              href="/dashboard/learn/adaptive-tdee"
              className="block mt-4 text-center text-caption text-ink-3 hover:text-ink-2 transition-colors"
            >
              How accurate is this? →
            </Link>
          </Card>
        );
      })()}

      {/* Data Collection Progress (legacy unlock framing) — suppressed when the
          interval estimator is active, since it always ships a usable number. */}
      {!isAdaptive && !intervalEstimate && (
        <Card className="p-4 bg-card/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-action/10 flex items-center justify-center">
              <IconChartBar size={18} className="text-action" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-subhead text-ink">Building your personal estimate</p>
              <p className="text-caption text-ink-3">
                {dataQuality.daysWithData} of 14 days logged
              </p>
            </div>
            <div className="text-right">
              <p className="text-subhead font-semibold text-action">
                {Math.round((dataQuality.daysWithData / 14) * 100)}%
              </p>
            </div>
          </div>
          <div className="mt-3 h-1.5 bg-fill rounded-full overflow-hidden">
            <div
              className="h-full bg-action transition-all duration-500"
              style={{ width: `${Math.min((dataQuality.daysWithData / 14) * 100, 100)}%` }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

export default TDEEDashboard;
