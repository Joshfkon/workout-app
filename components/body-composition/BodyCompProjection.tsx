'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { RangeIndicator } from './RangeIndicator';
import { generatePrediction } from '@/lib/actions/body-composition';
import type {
  BodyCompPrediction,
  DEXAScan,
  BodyCompRecommendation,
} from '@/src/lib/body-composition';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { kgToLbs, formatWeight } from '@/lib/utils';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface BodyCompProjectionProps {
  currentScan: DEXAScan;
  initialTargetWeight?: number;
}

export function BodyCompProjection({
  currentScan,
  initialTargetWeight,
}: BodyCompProjectionProps) {
  const { preferences } = useUserPreferences();
  const units = preferences?.units || 'lb';

  const [targetWeight, setTargetWeight] = useState<string>(
    initialTargetWeight
      ? units === 'lb'
        ? kgToLbs(initialTargetWeight).toFixed(0)
        : initialTargetWeight.toFixed(0)
      : ''
  );
  const [prediction, setPrediction] = useState<BodyCompPrediction | null>(null);
  const [recommendations, setRecommendations] = useState<BodyCompRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pRatioUsed, setPRatioUsed] = useState<number | null>(null);

  // Convert target weight to kg
  const targetWeightKg = targetWeight
    ? units === 'lb'
      ? parseFloat(targetWeight) / 2.20462
      : parseFloat(targetWeight)
    : null;

  // Generate prediction when target weight changes
  useEffect(() => {
    if (!targetWeightKg || targetWeightKg <= 0) {
      setPrediction(null);
      return;
    }

    const loadPrediction = async () => {
      setIsLoading(true);
      try {
        const result = await generatePrediction(targetWeightKg);
        if (result) {
          setPrediction(result.prediction);
          setRecommendations(result.recommendations);
          setPRatioUsed(result.prediction.assumptions.pRatioUsed);
        }
      } catch (error) {
        console.error('Error generating prediction:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPrediction();
  }, [targetWeightKg]);

  const weightUnit = units === 'lb' ? 'lbs' : 'kg';

  // Convert values for display
  const displayWeight = (kg: number) => {
    const value = units === 'lb' ? kgToLbs(kg) : kg;
    return value.toFixed(1);
  };

  // Calculate weight change
  const weightChange = targetWeightKg
    ? targetWeightKg - currentScan.totalMassKg
    : 0;
  const weightChangeDisplay = units === 'lb'
    ? kgToLbs(Math.abs(weightChange)).toFixed(1)
    : Math.abs(weightChange).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Uncertainty Warning */}
      <Card className="border-warning-500/30 bg-warning-500/5">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="text-warning-400 text-xl">⚠️</div>
            <div>
              <h4 className="font-medium text-warning-200 mb-1">Important</h4>
              <p className="text-sm text-surface-400">
                These are rough estimates with significant uncertainty. Actual results vary
                based on genetics, adherence, and factors we can't measure. Use as
                directional guidance, not precise targets.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Current (DEXA {new Date(currentScan.scanDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-surface-100">
                {displayWeight(currentScan.totalMassKg)}
              </p>
              <p className="text-xs text-surface-500 uppercase tracking-wider">{weightUnit}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-100">
                {currentScan.bodyFatPercent.toFixed(1)}%
              </p>
              <p className="text-xs text-surface-500 uppercase tracking-wider">Body Fat</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-100">
                {displayWeight(currentScan.leanMassKg)}
              </p>
              <p className="text-xs text-surface-500 uppercase tracking-wider">Lean {weightUnit}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target Weight Input */}
      <Card>
        <CardHeader>
          <CardTitle>Goal Weight</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Input
                label={`Target Weight (${weightUnit})`}
                type="number"
                step="0.5"
                value={targetWeight}
                onChange={(e) => setTargetWeight(e.target.value)}
                placeholder={units === 'lb' ? '165' : '75'}
              />
            </div>
            {targetWeightKg && (
              <div className="pb-3 text-sm text-surface-400">
                {weightChange < 0 ? 'Lose' : 'Gain'} {weightChangeDisplay} {weightUnit}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Prediction Results */}
      {isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="mt-4 text-surface-400">Calculating projection...</p>
          </CardContent>
        </Card>
      )}

      {prediction && !isLoading && (
        <>
          {/* Projection Card */}
          <Card>
            <CardHeader>
              <CardTitle>
                At Goal Weight: {displayWeight(prediction.targetWeight)} {weightUnit}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Range Indicators */}
              <RangeIndicator
                label="Body Fat %"
                pessimistic={prediction.bodyFatPercentRange.pessimistic}
                expected={prediction.bodyFatPercentRange.expected}
                optimistic={prediction.bodyFatPercentRange.optimistic}
                unit="%"
                showChange={{ from: currentScan.bodyFatPercent, label: 'from current' }}
                decimals={1}
                higherIsBetter={false}
              />

              <RangeIndicator
                label={`Fat Mass (${weightUnit})`}
                pessimistic={units === 'lb' ? kgToLbs(prediction.fatMassRange.pessimistic) : prediction.fatMassRange.pessimistic}
                expected={units === 'lb' ? kgToLbs(prediction.fatMassRange.expected) : prediction.fatMassRange.expected}
                optimistic={units === 'lb' ? kgToLbs(prediction.fatMassRange.optimistic) : prediction.fatMassRange.optimistic}
                unit={weightUnit}
                showChange={{
                  from: units === 'lb' ? kgToLbs(currentScan.fatMassKg) : currentScan.fatMassKg,
                  label: 'from current',
                }}
                decimals={1}
                higherIsBetter={false}
              />

              <RangeIndicator
                label={`Lean Mass (${weightUnit})`}
                pessimistic={units === 'lb' ? kgToLbs(prediction.leanMassRange.pessimistic) : prediction.leanMassRange.pessimistic}
                expected={units === 'lb' ? kgToLbs(prediction.leanMassRange.expected) : prediction.leanMassRange.expected}
                optimistic={units === 'lb' ? kgToLbs(prediction.leanMassRange.optimistic) : prediction.leanMassRange.optimistic}
                unit={weightUnit}
                showChange={{
                  from: units === 'lb' ? kgToLbs(currentScan.leanMassKg) : currentScan.leanMassKg,
                  label: 'from current',
                }}
                decimals={1}
                higherIsBetter={true}
              />
            </CardContent>
          </Card>

          {/* What This Means */}
          <Card>
            <CardHeader>
              <CardTitle>What This Means</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-surface-400 mb-4">
                If you lose {weightChangeDisplay} {weightUnit} total:
              </p>

              <div className="space-y-4">
                {/* Best Case */}
                <div className="p-3 bg-success-500/10 border border-success-500/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-success-400 font-medium">Best case:</span>
                    <span className="text-success-300">Almost all fat loss</span>
                  </div>
                  <p className="text-xs text-surface-400">
                    ({displayWeight(currentScan.fatMassKg - prediction.fatMassRange.optimistic)} {weightUnit} fat,{' '}
                    {displayWeight(currentScan.leanMassKg - prediction.leanMassRange.optimistic)} {weightUnit} lean)
                  </p>
                </div>

                {/* Expected */}
                <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-primary-400 font-medium">Expected:</span>
                    <span className="text-primary-300">Mostly fat loss</span>
                  </div>
                  <p className="text-xs text-surface-400">
                    ({displayWeight(currentScan.fatMassKg - prediction.fatMassRange.expected)} {weightUnit} fat,{' '}
                    {displayWeight(currentScan.leanMassKg - prediction.leanMassRange.expected)} {weightUnit} lean)
                  </p>
                </div>

                {/* Worst Case */}
                <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-warning-400 font-medium">Worst case:</span>
                    <span className="text-warning-300">More muscle loss</span>
                  </div>
                  <p className="text-xs text-surface-400">
                    ({displayWeight(currentScan.fatMassKg - prediction.fatMassRange.pessimistic)} {weightUnit} fat,{' '}
                    {displayWeight(currentScan.leanMassKg - prediction.leanMassRange.pessimistic)} {weightUnit} lean)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Confidence */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Confidence</CardTitle>
                <span
                  className={cn(
                    'px-3 py-1 text-sm rounded-full font-medium uppercase',
                    prediction.confidenceLevel === 'reasonable'
                      ? 'bg-success-500/20 text-success-400'
                      : prediction.confidenceLevel === 'moderate'
                      ? 'bg-warning-500/20 text-warning-400'
                      : 'bg-surface-700 text-surface-400'
                  )}
                >
                  {prediction.confidenceLevel}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-surface-400 mb-3">
                Factors affecting this estimate:
              </p>
              <ul className="space-y-2">
                {prediction.confidenceFactors.map((factor, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-surface-300">
                    <span className="text-surface-500">•</span>
                    {factor}
                  </li>
                ))}
              </ul>

              {recommendations.length > 0 && (
                <Link href="#recommendations">
                  <Button variant="secondary" className="w-full mt-4">
                    How to improve your results →
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Assumptions */}
          <Card>
            <CardHeader>
              <CardTitle>Assumptions Used</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-surface-500">Daily deficit</p>
                  <p className="text-surface-200 font-medium">
                    ~{Math.round(prediction.assumptions.avgDailyDeficit)} cal
                  </p>
                </div>
                <div>
                  <p className="text-surface-500">Daily protein</p>
                  <p className="text-surface-200 font-medium">
                    {Math.round(prediction.assumptions.avgDailyProtein)}g
                  </p>
                </div>
                <div>
                  <p className="text-surface-500">Weekly volume</p>
                  <p className="text-surface-200 font-medium">
                    {Math.round(prediction.assumptions.avgWeeklyVolume)} sets
                  </p>
                </div>
                <div>
                  <p className="text-surface-500">P-ratio</p>
                  <p className="text-surface-200 font-medium">
                    {prediction.assumptions.pRatioUsed.toFixed(2)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && !isLoading && (
        <div id="recommendations">
          <Card>
            <CardHeader>
              <CardTitle>How to Improve Your Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {recommendations.map((rec, i) => (
                <div
                  key={i}
                  className={cn(
                    'p-4 rounded-lg border',
                    rec.priority === 'high'
                      ? 'bg-danger-500/10 border-danger-500/20'
                      : rec.priority === 'medium'
                      ? 'bg-warning-500/10 border-warning-500/20'
                      : 'bg-primary-500/10 border-primary-500/20'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">
                      {rec.category === 'protein' && '🥩'}
                      {rec.category === 'training' && '🏋️'}
                      {rec.category === 'deficit' && '📉'}
                      {rec.category === 'general' && '💡'}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-surface-200">{rec.title}</h4>
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded uppercase',
                            rec.priority === 'high'
                              ? 'bg-danger-500/20 text-danger-400'
                              : rec.priority === 'medium'
                              ? 'bg-warning-500/20 text-warning-400'
                              : 'bg-primary-500/20 text-primary-400'
                          )}
                        >
                          {rec.priority}
                        </span>
                      </div>
                      <p className="text-sm text-surface-400 mb-2">{rec.description}</p>
                      {rec.currentValue && rec.targetValue && (
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-surface-500">
                            Current: <span className="text-surface-300">{rec.currentValue}</span>
                          </span>
                          <span className="text-surface-600">→</span>
                          <span className="text-surface-500">
                            Target: <span className="text-success-400">{rec.targetValue}</span>
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-surface-500 mt-2 italic">{rec.impact}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
