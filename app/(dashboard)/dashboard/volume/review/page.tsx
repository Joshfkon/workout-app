'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';
import { parseLocalDate } from '@/lib/utils';
import type { MuscleOutcome, VolumeVerdict, ProgressionTrend } from '@/src/lib/training/adaptive-volume';
import type { MuscleGroup } from '@/types/schema';

function VerdictBadge({ verdict }: { verdict: VolumeVerdict }) {
  const config = useMemo(() => {
    switch (verdict) {
      case 'optimal':
        return {
          icon: '\u2705',
          text: 'OPTIMAL',
          className: 'bg-status-ok/10 text-status-ok border-status-ok/20',
        };
      case 'too_high':
        return {
          icon: '\u26A0\uFE0F',
          text: 'TOO HIGH',
          className: 'bg-status-bad/10 text-status-bad border-status-bad/20',
        };
      case 'too_low':
        return {
          icon: '\uD83D\uDCC8',
          text: 'ROOM TO GROW',
          className: 'bg-action/10 text-action border-action/20',
        };
      case 'insufficient_data':
        return {
          icon: '\u2753',
          text: 'INSUFFICIENT DATA',
          className: 'bg-sep text-ink-2 border-sep',
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
        return { icon: '\u2191', color: 'text-status-ok', label: 'Improving' };
      case 'maintaining':
        return { icon: '\u2192', color: 'text-ink-2', label: 'Maintaining' };
      case 'declining':
        return { icon: '\u2193', color: 'text-status-bad', label: 'Declining' };
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
    if (drift > 2) return { label: 'concerning', color: 'text-status-bad', icon: '\u26A0\uFE0F' };
    if (drift > 1) return { label: 'elevated', color: 'text-status-warn', icon: '\u26A0' };
    return { label: 'normal', color: 'text-ink-2', icon: '' };
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
        <h3 className="text-headline font-semibold text-ink">{muscleName}</h3>
        <VerdictBadge verdict={outcome.volumeVerdict} />
      </div>

      <div className="space-y-2 text-body">
        <div className="flex justify-between">
          <span className="text-ink-3">Avg volume:</span>
          <span className="text-ink">{outcome.weeklySets.toFixed(0)} sets/week</span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-3">Progression:</span>
          <ProgressionIndicator trend={outcome.progressionTrend} rate={outcome.progressionRate} />
        </div>

        <div className="flex justify-between">
          <span className="text-ink-3">RIR drift:</span>
          <RirDriftIndicator drift={outcome.rirDrift} />
        </div>

        <div className="flex justify-between">
          <span className="text-ink-3">Form:</span>
          <span className={outcome.formDegradation > 0.15 ? 'text-status-warn' : 'text-ink'}>
            {outcome.formDegradation > 0.15 ? 'Some degradation' : 'Maintained'}
          </span>
        </div>

        {outcome.volumeVerdict !== 'insufficient_data' && (
          <div className="pt-2 mt-2 border-t border-sep">
            <div className="flex justify-between">
              <span className="text-ink-3">Suggestion:</span>
              <span className="text-action">
                {outcome.suggestedAdjustment > 0
                  ? `Increase to ${Math.round(outcome.weeklySets + outcome.suggestedAdjustment)} sets`
                  : outcome.suggestedAdjustment < 0
                  ? `Reduce to ${Math.round(outcome.weeklySets + outcome.suggestedAdjustment)} sets`
                  : `Maintain ${Math.round(outcome.weeklySets)} sets`}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-ink-3">Confidence:</span>
              <span className="text-ink-2">{outcome.confidence}%</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function MesocycleReviewPage() {
  useDocumentTitle('Volume Review');
  const { latestAnalysis, volumeProfile, isLoading } = useAdaptiveVolume();

  const formatDateRange = useMemo(() => {
    if (!latestAnalysis) return '';
    // Date-only values are LOCAL calendar days (new Date() would read them as
    // UTC midnight → the previous day west of UTC); timestamps pass through.
    const start = parseLocalDate(latestAnalysis.startDate);
    const end = parseLocalDate(latestAnalysis.endDate);
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
          className: 'bg-status-bad/10 border-status-bad/20 text-status-bad',
        };
      case 'well_recovered':
        return {
          icon: '\u2705',
          text: 'Well recovered',
          description: 'Volume was appropriate for your recovery capacity',
          className: 'bg-status-ok/10 border-status-ok/20 text-status-ok',
        };
      case 'under_stimulated':
        return {
          icon: '\uD83D\uDCC8',
          text: 'Under-stimulated',
          description: 'You have capacity to handle more volume',
          className: 'bg-action/10 border-action/20 text-action',
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
          <div className="h-8 bg-fill rounded w-1/2" />
          <div className="h-4 bg-fill rounded w-1/3" />
          <div className="grid gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-fill rounded-lg" />
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
          className="inline-flex items-center gap-2 text-ink-2 hover:text-ink mb-8 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to volume
        </Link>

        <Card className="p-8 text-center">
          <span className="text-4xl mb-4 block">{'\uD83D\uDCCA'}</span>
          <h2 className="text-title font-semibold text-ink mb-2">No mesocycle analysis yet</h2>
          <p className="text-ink-2 mb-4">
            Complete at least 3 weeks of training to generate your first mesocycle analysis.
          </p>
          <Link href="/dashboard/log">
            <button className="px-4 py-2 bg-action hover:bg-action text-on-action font-medium rounded-lg transition-colors">
              Start training
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
        className="inline-flex items-center gap-2 text-ink-2 hover:text-ink mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to volume
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-large-title text-ink mb-2">Mesocycle review</h1>
        <p className="text-ink-2">
          {formatDateRange} ({latestAnalysis.weeks} weeks)
        </p>
      </div>

      {/* Overall Recovery Status */}
      {overallRecoveryConfig && (
        <Card className={`p-4 mb-6 ${overallRecoveryConfig.className} border`}>
          <div className="flex items-center gap-3">
            <span className="text-title">{overallRecoveryConfig.icon}</span>
            <div>
              <h3 className="font-semibold">{overallRecoveryConfig.text}</h3>
              <p className="text-body opacity-80">{overallRecoveryConfig.description}</p>
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
        <Card className="p-4 text-center">
          <h3 className="font-semibold text-ink mb-2">Ready for your next mesocycle?</h3>
          <p className="text-body text-ink-2 mb-4">
            Apply these volume adjustments to optimize your next training block.
          </p>
          <button className="px-6 min-h-[44px] bg-action hover:brightness-110 text-on-action font-semibold rounded-button transition-colors">
            Apply suggestions to next meso
          </button>
        </Card>
      </div>

      {/* Learn More Link */}
      <div className="mt-6 text-center">
        <Link
          href="/dashboard/learn/adaptive-volume"
          className="text-body text-ink-2 hover:text-ink transition-colors"
        >
          Understanding this analysis {'\u2192'}
        </Link>
      </div>
    </div>
  );
}
