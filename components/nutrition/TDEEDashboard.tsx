'use client';

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
} from '@/lib/nutrition/adaptive-tdee';
import { calculateFFMI } from '@/services/bodyCompEngine';
import {
  calculatePRatio,
  predictWeightGainComposition,
  type PRatioInputs,
  type BodyCompProjection,
} from '@/lib/body-composition/p-ratio';

interface TDEEDashboardProps {
  estimate: TDEEEstimate | null;
  formulaEstimate: TDEEEstimate | null;
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
  onRefresh?: () => void;
  onSetTarget?: () => void;
}

export function TDEEDashboard({
  estimate,
  formulaEstimate,
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
  onRefresh,
  onSetTarget,
}: TDEEDashboardProps) {
  const [showDetails, setShowDetails] = useState(false);

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
          if (!heightCm || !currentWeight) return null;
          
          // Both currentWeight and prediction.predictedWeight are in lbs
          const currentWeightKg = currentWeight / 2.20462;
          const predictedWeightKg = prediction.predictedWeight / 2.20462; // prediction.predictedWeight is already in lbs
          const weightChangeKg = predictedWeightKg - currentWeightKg;
          
          // Can't predict composition without baseline - use fallback if height is available
          const currentBodyFat = bodyFatPercent || 
            (latestDexaScan ? (latestDexaScan.fat_mass_kg / latestDexaScan.weight_kg) * 100 : null) ||
            (heightCm ? 15 : null); // Default 15% if we have height but no body fat data
          
          if (!currentBodyFat) return null;
          
          const currentLeanMassKg = currentWeightKg * (1 - currentBodyFat / 100);
          
          // Calculate energy balance for P-ratio
          if (!activeEstimate) return null;
          
          const dailyDeficit = activeEstimate.estimatedTDEE - (targetCalories || prediction.assumedDailyCalories);
          // Energy balance: negative = deficit, positive = surplus
          const energyBalancePercent = (dailyDeficit / activeEstimate.estimatedTDEE) * 100;
          
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
            personalPRatioHistory: undefined, // TODO: Calculate from DEXA scan history if available
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
                <h3 className="text-base font-semibold text-surface-100">Weight Projection</h3>
                <p className="text-xs text-surface-500">
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
              <div className="py-2 border-b border-surface-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-surface-400">Current</span>
                  <span className="text-sm font-semibold text-surface-100">
                    {currentWeight.toFixed(1)} lbs
                  </span>
                </div>
                {currentFFMI && currentBodyFatPercent && (
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-surface-500">FFMI:</span>
                    <span className="text-surface-300">{currentFFMI.normalizedFfmi.toFixed(1)}</span>
                    <span className="text-surface-500 ml-3">BF%:</span>
                    <span className="text-surface-300">{currentBodyFatPercent.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {/* Projections */}
              {predictions.slice(0, 4).map((prediction) => {
                const bodyComp = projectBodyComposition(prediction);
                return (
                  <div
                    key={prediction.targetDate}
                    className="py-2 border-b border-surface-800 last:border-0"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-surface-400">
                        In {prediction.daysFromNow} days
                        <span className="text-xs text-surface-500 ml-1">
                          ({new Date(prediction.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
                        </span>
                      </span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-surface-100">
                          {prediction.predictedWeight} lbs
                        </span>
                        <span className="text-xs text-surface-500 ml-1">
                          (±{((prediction.confidenceRange[1] - prediction.confidenceRange[0]) / 2).toFixed(1)})
                        </span>
                      </div>
                    </div>
                    {bodyComp && (
                      <div className="mt-2 p-2 bg-surface-800/30 rounded text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-surface-500">Body Fat %</span>
                          <div className="flex items-center gap-1">
                            <span className="text-surface-500">{bodyComp.bodyFatPercent.pessimistic.toFixed(0)}%</span>
                            <span className="text-surface-400">→</span>
                            <span className="text-surface-200 font-medium">{bodyComp.bodyFatPercent.expected.toFixed(0)}%</span>
                            <span className="text-surface-400">→</span>
                            <span className="text-success-400">{bodyComp.bodyFatPercent.optimistic.toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-surface-500">FFMI</span>
                          <div className="flex items-center gap-1">
                            <span className="text-surface-500">{bodyComp.ffmi.pessimistic.toFixed(1)}</span>
                            <span className="text-surface-400">→</span>
                            <span className="text-surface-200 font-medium">{bodyComp.ffmi.expected.toFixed(1)}</span>
                            <span className="text-surface-400">→</span>
                            <span className="text-success-400">{bodyComp.ffmi.optimistic.toFixed(1)}</span>
                          </div>
                        </div>
                        {bodyComp.confidenceLevel === 'low' && (
                          <p className="text-surface-500 mt-1 text-[10px]">
                            ⚠️ Wide uncertainty range - log DEXA scans to improve
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {targetWeight && activeEstimate.confidence !== 'unstable' && (
            <div className="mt-4 p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
              <p className="text-xs text-primary-300">
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
              className="block mt-4 text-center text-xs text-surface-500 hover:text-surface-400 transition-colors"
            >
              How accurate is this? →
            </Link>
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
