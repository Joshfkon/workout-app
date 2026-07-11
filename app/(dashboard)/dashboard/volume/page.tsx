'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';
import { useUserStore } from '@/stores';
import { FatigueAlertList } from '@/components/workout/FatigueAlertBanner';
import { AtrophyRiskAlert } from '@/components/analytics/AtrophyRiskAlert';
import { WeeklyMevSummary } from '@/components/dashboard/WeeklyMevSummary';
import { VolumeZoneBar } from '@/components/analytics/VolumeZoneBar';
import { EnhancedAthleteModeCard } from '@/components/settings/EnhancedAthleteModeCard';
import { useWeeklyMevSummary } from '@/hooks/useWeeklyMevSummary';
import {
  buildVolumeRows,
  belowMevVolumeData,
  type CoarseMuscle,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

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
    fatigueAlerts,
    latestAnalysis,
    isLoading,
    refreshProfile,
  } = useAdaptiveVolume();

  const { user } = useUserStore();
  const userGoal = user?.goal ?? 'maintenance';

  // Which coarse groups the user expanded to reveal all fine children.
  const [expandedRows, setExpandedRows] = useState<Set<CoarseMuscle>>(new Set());
  const toggleRow = (muscle: CoarseMuscle) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(muscle) ? next.delete(muscle) : next.add(muscle);
      return next;
    });

  // Below-MEV muscles for the atrophy-risk warning come from the SAME coarse
  // rows the bars render (shared counter + band), so the warning, the bars and
  // the "This Week vs MEV" card can never disagree on count or zone-status.
  const { stats: volumeStats, reachable, loaded: volumeLoaded } = useWeeklyMevSummary();

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

  // Coarse-row presentation model over the SHARED secondary-credit counter —
  // the same rows the readiness sheet, widget and warning render, so counts and
  // zone-status agree everywhere. The volume page's old primary-only counting
  // (and its separate MEV/MRV taxonomy) is retired.
  const volumeRows = useMemo(
    () => buildVolumeRows(volumeStats, reachable, { expandedParents: expandedRows }),
    [volumeStats, reachable, expandedRows]
  );

  // Find muscles below MEV (for atrophy risk alert) — same coarse rows as bars.
  // Gate on the weekly-volume load: before it resolves, stats are [] and every
  // muscle would falsely read below MEV (spurious atrophy alert).
  const musclesBelowMev = useMemo(
    () => (volumeLoaded ? belowMevVolumeData(volumeRows) : []),
    [volumeLoaded, volumeRows]
  );

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

      {/* This week vs MEV — same data pipeline as the home "Weekly volume"
          tile and wk-1 ramp banner, so the tapped numbers match on landing.
          Below-MEV muscles are flagged here at the top of the page. */}
      <WeeklyMevSummary />

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

      {/* Atrophy Risk Alert - shows muscles below MEV with cut warning */}
      {musclesBelowMev.length > 0 && (
        <div className="mb-6">
          <AtrophyRiskAlert
            musclesBelowMev={musclesBelowMev}
            userGoal={userGoal}
          />
        </div>
      )}

      {/* Volume Bars — shared coarse-row model. Green spans the whole MEV–MRV
          band; a bar only turns red past MRV. Tap a group to reveal its fine
          muscles; lagging (below-MEV) fine muscles surface automatically. */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-surface-100">This Week&apos;s Volume</h3>
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <span className="w-3 h-3 rounded bg-success-500/20 border border-success-500/40" />
            <span>MEV–MRV zone</span>
          </div>
        </div>

        {volumeLoaded ? (
          <div>
            {volumeRows.map((row) => (
              <VolumeZoneBar
                key={row.key}
                row={row}
                expanded={expandedRows.has(row.muscle as CoarseMuscle)}
                onToggle={() => toggleRow(row.muscle as CoarseMuscle)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3 animate-pulse" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-surface-800 rounded" />
            ))}
          </div>
        )}
      </Card>

      {/* Enhanced Mode Toggle — same persisted profile field as Settings.
          persistEnhancedAthleteMode syncs this page's volume profile too;
          refresh so the rescaled MEV/MRV estimates show immediately. */}
      <div className="mb-6">
        <EnhancedAthleteModeCard onChanged={() => refreshProfile()} />
      </div>

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
