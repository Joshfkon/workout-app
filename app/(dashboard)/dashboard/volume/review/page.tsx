'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';
import type { MuscleOutcome, VolumeVerdict, ProgressionTrend } from '@/src/lib/training/adaptive-volume';
import type { MuscleGroup } from '@/types/schema';

function VerdictBadge({ verdict }: { verdict: VolumeVerdict }) {
  const config = useMemo(() => {
    switch (verdict) {
      case 'optimal':
        return {
          icon: '\u2705',
          text: 'OPTIMAL',
          className: 'bg-success-500/10 text-success-400 border-success-500/20',
        };
      case 'too_high':
        return {
          icon: '\u26A0\uFE0F',
          text: 'TOO HIGH',
          className: 'bg-danger-500/10 text-danger-400 border-danger-500/20',
        };
      case 'too_low':
        return {
          icon: '\uD83D\uDCC8',
          text: 'ROOM TO GROW',
          className: 'bg-primary-500/10 text-primary-400 border-primary-500/20',
        };
      case 'insufficient_data':
        return {
          icon: '\u2753',
          text: 'INSUFFICIENT DATA',
          className: 'bg-surface-700 text-surface-400 border-surface-600',
        };
    }
  }, [verdict]);

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${config.className}`}>
      {config.icon} {config.text}
    </span>
  );
}

function ProgressionIndicator({ trend, rate }: { trend: ProgressionTrend; rate: number }) {
  const config = useMemo(() => {
    switch (trend) {
      case 'improving':
        return { icon: '\u2191', color: 'text-success-400', label: 'Improving' };
      case 'maintaining':
        return { icon: '\u2192', color: 'text-surface-400', label: 'Maintaining' };
      case 'declining':
        return { icon: '\u2193', color: 'text-danger-400', label: 'Declining' };
    }
  }, [trend]);

  return (
    <span className={`flex items-center gap-1 ${config.color}`}>
      <span>{config.icon}</span>
      <span>
        {rate !== 0 ? `${rate > 0 ? '+' : ''}${rate.toFixed(1)}%/week` : config.label}
      </span>
    </span>
  );
}

function RirDriftIndicator({ drift }: { drift: number }) {
  const severity = useMemo(() => {
    if (drift > 2) return { label: 'concerning', color: 'text-danger-400', icon: '\u26A0\uFE0F' };
    if (drift > 1) return { label: 'elevated', color: 'text-warning-400', icon: '\u26A0' };
    return { label: 'normal', color: 'text-surface-400', icon: '' };
  }, [drift]);

  return (
    <span className={severity.color}>
      {drift.toFixed(1)} ({severity.label}) {severity.icon}
    </span>
  );
}

function MuscleOutcomeCard({ outcome }: { outcome: MuscleOutcome }) {
  const muscleName = outcome.muscle.charAt(0).toUpperCase() + outcome.muscle.slice(1);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-surface-100">{muscleName}</h3>
        <VerdictBadge verdict={outcome.volumeVerdict} />
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-surface-500">Avg Volume:</span>
          <span className="text-surface-200">{outcome.weeklySets.toFixed(0)} sets/week</span>
        </div>

        <div className="flex justify-between">
          <span className="text-surface-500">Progression:</span>
          <ProgressionIndicator trend={outcome.progressionTrend} rate={outcome.progressionRate} />
        </div>

        <div className="flex justify-between">
          <span className="text-surface-500">RIR Drift:</span>
          <RirDriftIndicator drift={outcome.rirDrift} />
        </div>

        <div className="flex justify-between">
          <span className="text-surface-500">Form:</span>
          <span className={outcome.formDegradation > 0.15 ? 'text-warning-400' : 'text-surface-200'}>
            {outcome.formDegradation > 0.15 ? 'Some degradation' : 'Maintained'}
          </span>
        </div>

        {outcome.volumeVerdict !== 'insufficient_data' && (
          <div className="pt-2 mt-2 border-t border-surface-800">
            <div className="flex justify-between">
              <span className="text-surface-500">Suggestion:</span>
              <span className="text-primary-400">
                {outcome.suggestedAdjustment > 0
                  ? `Increase to ${Math.round(outcome.weeklySets + outcome.suggestedAdjustment)} sets`
                  : outcome.suggestedAdjustment < 0
                  ? `Reduce to ${Math.round(outcome.weeklySets + outcome.suggestedAdjustment)} sets`
                  : `Maintain ${Math.round(outcome.weeklySets)} sets`}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-surface-500">Confidence:</span>
              <span className="text-surface-400">{outcome.confidence}%</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function MesocycleReviewPage() {
  const { latestAnalysis, volumeProfile, isLoading } = useAdaptiveVolume();

  const formatDateRange = useMemo(() => {
    if (!latestAnalysis) return '';
    const start = new Date(latestAnalysis.startDate);
    const end = new Date(latestAnalysis.endDate);
    const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
  }, [latestAnalysis]);

  const overallRecoveryConfig = useMemo(() => {
    if (!latestAnalysis) return null;
    switch (latestAnalysis.overallRecovery) {
      case 'under_recovered':
        return {
          icon: '\u26A0\uFE0F',
          text: 'Under-recovered',
          description: 'Volume was too high for your current recovery capacity',
          className: 'bg-danger-500/10 border-danger-500/20 text-danger-300',
        };
      case 'well_recovered':
        return {
          icon: '\u2705',
          text: 'Well Recovered',
          description: 'Volume was appropriate for your recovery capacity',
          className: 'bg-success-500/10 border-success-500/20 text-success-300',
        };
      case 'under_stimulated':
        return {
          icon: '\uD83D\uDCC8',
          text: 'Under-stimulated',
          description: 'You have capacity to handle more volume',
          className: 'bg-primary-500/10 border-primary-500/20 text-primary-300',
        };
    }
  }, [latestAnalysis]);

  const muscleOutcomes = useMemo(() => {
    if (!latestAnalysis) return [];
    return Object.values(latestAnalysis.muscleOutcomes)
      .filter(o => o.weeklySets > 0)
      .sort((a, b) => {
        // Sort by verdict importance
        const order: Record<VolumeVerdict, number> = {
          too_high: 0,
          too_low: 1,
          optimal: 2,
          insufficient_data: 3,
        };
        return order[a.volumeVerdict] - order[b.volumeVerdict];
      });
  }, [latestAnalysis]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto pb-12">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-surface-800 rounded w-1/2" />
          <div className="h-4 bg-surface-800 rounded w-1/3" />
          <div className="grid gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-surface-800 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!latestAnalysis) {
    return (
      <div className="max-w-3xl mx-auto pb-12">
        <Link
          href="/dashboard/volume"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-200 mb-8 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Volume
        </Link>

        <Card className="p-8 text-center">
          <span className="text-4xl mb-4 block">{'\uD83D\uDCCA'}</span>
          <h2 className="text-xl font-semibold text-surface-100 mb-2">No Mesocycle Analysis Yet</h2>
          <p className="text-surface-400 mb-4">
            Complete at least 3 weeks of training to generate your first mesocycle analysis.
          </p>
          <Link href="/dashboard/workout">
            <button className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg transition-colors">
              Start Training
            </button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Back Navigation */}
      <Link
        href="/dashboard/volume"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-200 mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Volume
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-surface-100 mb-2">Mesocycle Review</h1>
        <p className="text-surface-400">
          {formatDateRange} ({latestAnalysis.weeks} weeks)
        </p>
      </div>

      {/* Overall Recovery Status */}
      {overallRecoveryConfig && (
        <Card className={`p-4 mb-6 ${overallRecoveryConfig.className} border`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{overallRecoveryConfig.icon}</span>
            <div>
              <h3 className="font-semibold">{overallRecoveryConfig.text}</h3>
              <p className="text-sm opacity-80">{overallRecoveryConfig.description}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Muscle Outcomes */}
      <div className="space-y-4">
        {muscleOutcomes.map(outcome => (
          <MuscleOutcomeCard key={outcome.muscle} outcome={outcome} />
        ))}
      </div>

      {/* Apply Suggestions Button */}
      <div className="mt-8">
        <Card className="p-4 text-center bg-gradient-to-r from-primary-500/10 to-purple-500/10 border-primary-500/20">
          <h3 className="font-semibold text-surface-100 mb-2">Ready for Next Mesocycle?</h3>
          <p className="text-sm text-surface-400 mb-4">
            Apply these volume adjustments to optimize your next training block.
          </p>
          <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
            Apply Suggestions to Next Meso
          </button>
        </Card>
      </div>

      {/* Learn More Link */}
      <div className="mt-6 text-center">
        <Link
          href="/dashboard/learn/adaptive-volume"
          className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
        >
          Understanding this analysis {'\u2192'}
        </Link>
      </div>
    </div>
  );
}
