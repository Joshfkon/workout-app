'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';
import { FatigueAlertList } from '@/components/workout/FatigueAlertBanner';
import { BASELINE_VOLUME_RECOMMENDATIONS } from '@/src/lib/training/adaptive-volume';
import type { MuscleGroup } from '@/types/schema';
import { MUSCLE_GROUPS } from '@/types/schema';

function VolumeProgressBar({
  muscle,
  currentSets,
  mev,
  optimal,
  mrv,
  confidence,
}: {
  muscle: MuscleGroup;
  currentSets: number;
  mev: number;
  optimal: number;
  mrv: number;
  confidence: 'low' | 'medium' | 'high';
}) {
  const muscleName = muscle.charAt(0).toUpperCase() + muscle.slice(1);

  // Calculate positions as percentages
  const maxDisplay = mrv * 1.2;
  const mevPos = (mev / maxDisplay) * 100;
  const optimalPos = (optimal / maxDisplay) * 100;
  const mrvPos = (mrv / maxDisplay) * 100;
  const currentPos = Math.min((currentSets / maxDisplay) * 100, 100);

  // Determine bar color based on current position
  const barColor = useMemo(() => {
    if (currentSets < mev) return 'bg-surface-500';
    if (currentSets <= optimal) return 'bg-success-500';
    if (currentSets <= mrv) return 'bg-warning-500';
    return 'bg-danger-500';
  }, [currentSets, mev, optimal, mrv]);

  const confidenceLabel = {
    low: 'Research defaults',
    medium: 'Learning',
    high: 'Personalized',
  };

  return (
    <div className="py-3 border-b border-surface-800 last:border-b-0">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-surface-200">{muscleName}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-500">{confidenceLabel[confidence]}</span>
          <span className="text-sm text-surface-400">
            {currentSets}/{mrv} sets
          </span>
        </div>
      </div>

      {/* Progress bar with zones */}
      <div className="relative h-4 bg-surface-800 rounded-full overflow-hidden">
        {/* MEV zone marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-surface-600"
          style={{ left: `${mevPos}%` }}
        />
        {/* Optimal zone highlight */}
        <div
          className="absolute top-0 bottom-0 bg-success-500/10"
          style={{ left: `${mevPos}%`, width: `${optimalPos - mevPos}%` }}
        />
        {/* MRV zone marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-danger-500/50"
          style={{ left: `${mrvPos}%` }}
        />
        {/* Current volume bar */}
        <div
          className={`absolute top-0 bottom-0 left-0 ${barColor} transition-all duration-300`}
          style={{ width: `${currentPos}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between text-xs text-surface-500 mt-1">
        <span style={{ marginLeft: `${mevPos - 2}%` }}>MEV</span>
        <span style={{ marginRight: `${100 - mrvPos - 2}%` }}>MRV</span>
      </div>
    </div>
  );
}

function CompareToResearchCard() {
  return (
    <Card className="p-4 mt-4">
      <h4 className="font-medium text-surface-200 mb-3">Research Comparison</h4>
      <p className="text-sm text-surface-400 mb-3">
        Your personalized volume recommendations compared to research averages:
      </p>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="text-center p-2 bg-surface-800/50 rounded">
          <p className="text-surface-500 text-xs">Lower than avg</p>
          <p className="text-primary-400 font-medium">3 muscles</p>
        </div>
        <div className="text-center p-2 bg-surface-800/50 rounded">
          <p className="text-surface-500 text-xs">At average</p>
          <p className="text-success-400 font-medium">7 muscles</p>
        </div>
        <div className="text-center p-2 bg-surface-800/50 rounded">
          <p className="text-surface-500 text-xs">Higher than avg</p>
          <p className="text-warning-400 font-medium">3 muscles</p>
        </div>
      </div>
      <Link
        href="/dashboard/learn/adaptive-volume"
        className="block mt-3 text-xs text-primary-400 hover:text-primary-300 text-center transition-colors"
      >
        Learn how we calculate this {'\u2192'}
      </Link>
    </Card>
  );
}

export default function VolumeProfilePage() {
  const {
    volumeProfile,
    volumeSummary,
    fatigueAlerts,
    latestAnalysis,
    isLoading,
  } = useAdaptiveVolume();

  // Calculate confidence summary
  const confidenceSummary = useMemo(() => {
    if (!volumeProfile) return { level: 'low', dataPoints: 0, mesocycles: 0 };

    const tolerances = Object.values(volumeProfile.muscleTolerance);
    const totalDataPoints = tolerances.reduce((sum, t) => sum + t.dataPoints, 0);
    const avgDataPoints = totalDataPoints / tolerances.length;

    let level: 'low' | 'medium' | 'high' = 'low';
    if (avgDataPoints >= 4) level = 'high';
    else if (avgDataPoints >= 2) level = 'medium';

    return {
      level,
      dataPoints: totalDataPoints,
      mesocycles: Math.floor(avgDataPoints),
    };
  }, [volumeProfile]);

  // Sort muscles by current usage (highest first)
  const sortedMuscles = useMemo(() => {
    return [...volumeSummary].sort((a, b) => b.percentOfMRV - a.percentOfMRV);
  }, [volumeSummary]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto pb-12">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-surface-800 rounded w-1/2" />
          <div className="h-4 bg-surface-800 rounded w-2/3" />
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 bg-surface-800 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-surface-100 mb-2">Your Volume Tolerance</h1>
        <p className="text-surface-400">
          {confidenceSummary.mesocycles === 0
            ? 'Using research-based defaults. Train for 3+ weeks to personalize.'
            : `Based on ${confidenceSummary.mesocycles} mesocycle${confidenceSummary.mesocycles > 1 ? 's' : ''} of data`}
        </p>
      </div>

      {/* Confidence Indicator */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-surface-400">Confidence Level</span>
            <h3 className="text-lg font-semibold text-surface-100 capitalize">
              {confidenceSummary.level}
            </h3>
          </div>
          <div className="flex gap-1">
            {['low', 'medium', 'high'].map((level, idx) => (
              <div
                key={level}
                className={`w-8 h-2 rounded-full ${
                  idx <= ['low', 'medium', 'high'].indexOf(confidenceSummary.level)
                    ? 'bg-primary-500'
                    : 'bg-surface-700'
                }`}
              />
            ))}
          </div>
        </div>
      </Card>

      {/* Fatigue Alerts */}
      {fatigueAlerts.length > 0 && (
        <div className="mb-6">
          <FatigueAlertList alerts={fatigueAlerts} />
        </div>
      )}

      {/* Volume Bars */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-surface-100">This Week&apos;s Volume</h3>
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <span className="w-3 h-3 rounded bg-success-500/20 border border-success-500/40" />
            <span>Optimal zone</span>
          </div>
        </div>

        <div className="divide-y divide-surface-800">
          {sortedMuscles.map(summary => {
            const tolerance = volumeProfile?.muscleTolerance[summary.muscle];
            const baseline = BASELINE_VOLUME_RECOMMENDATIONS[summary.muscle];

            return (
              <VolumeProgressBar
                key={summary.muscle}
                muscle={summary.muscle}
                currentSets={summary.currentSets}
                mev={tolerance?.estimatedMEV ?? baseline.mev}
                optimal={Math.round(((tolerance?.estimatedMEV ?? baseline.mev) + (tolerance?.estimatedMRV ?? baseline.mrv)) / 2)}
                mrv={tolerance?.estimatedMRV ?? baseline.mrv}
                confidence={tolerance?.confidence ?? 'low'}
              />
            );
          })}
        </div>
      </Card>

      {/* Enhanced Mode Toggle */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-surface-200">Enhanced Athlete Mode</h4>
            <p className="text-sm text-surface-500">
              PEDs significantly increase recovery capacity
            </p>
          </div>
          <div
            className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${
              volumeProfile?.isEnhanced ? 'bg-primary-500' : 'bg-surface-700'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white transition-transform ${
                volumeProfile?.isEnhanced ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </div>
        </div>
        {volumeProfile?.isEnhanced && (
          <p className="mt-2 text-xs text-primary-400">
            Volume baselines increased by 40% for enhanced recovery
          </p>
        )}
      </Card>

      {/* Compare to Research */}
      <CompareToResearchCard />

      {/* Recent Mesocycle Review Link */}
      {latestAnalysis && (
        <Card className="p-4 mt-6 bg-gradient-to-r from-purple-500/10 to-primary-500/10 border-purple-500/20">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-surface-200">Latest Mesocycle Review</h4>
              <p className="text-sm text-surface-500">
                See detailed analysis and recommendations
              </p>
            </div>
            <Link
              href="/dashboard/volume/review"
              className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-surface-200 font-medium rounded-lg transition-colors"
            >
              View Review
            </Link>
          </div>
        </Card>
      )}

      {/* Learn More */}
      <div className="mt-8 text-center">
        <Link
          href="/dashboard/learn/adaptive-volume"
          className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
        >
          How we learn your recovery capacity {'\u2192'}
        </Link>
      </div>
    </div>
  );
}
