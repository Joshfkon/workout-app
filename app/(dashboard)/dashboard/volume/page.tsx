'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';
import { useUserStore } from '@/stores';
import { FatigueAlertList } from '@/components/workout/FatigueAlertBanner';
import { AtrophyRiskAlert } from '@/components/analytics/AtrophyRiskAlert';
import { WeeklyMevSummary } from '@/components/dashboard/WeeklyMevSummary';
import { VolumeRowContent, VolumeChildContent } from '@/components/analytics/VolumeZoneBar';
import {
  MuscleGroupList,
  useMuscleRowExpansion,
  withVisibleChildren,
} from '@/components/muscle/MuscleGroupList';
import { ContributingSets, SourcesDisclosure } from '@/components/muscle/ContributingSets';
import { EnhancedAthleteModeCard } from '@/components/settings/EnhancedAthleteModeCard';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { volumeRowsToMapData } from '@/lib/muscleMap/adapters';
import type { MuscleId } from '@/lib/muscleMap/taxonomy';
import { useWeeklyMevSummary } from '@/hooks/useWeeklyMevSummary';
import {
  buildVolumeRows,
  belowMevVolumeData,
  STANDARD_TO_COARSE,
  type VolumeRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import {
  compareProfileToResearch,
  type ResearchComparisonStatus,
  type UserVolumeProfile,
} from '@/src/lib/training/adaptive-volume';

/**
 * The body-map section is collapsible so bar-preferrers lose nothing; the
 * choice is remembered across visits (localStorage, default expanded).
 */
const MAP_COLLAPSED_STORAGE_KEY = 'hypertrack:volume-map-collapsed';

function readMapCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MAP_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistMapCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MAP_COLLAPSED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* localStorage unavailable — degrade to in-memory. */
  }
}

const COMPARISON_BUCKETS: {
  status: ResearchComparisonStatus;
  label: string;
  valueClass: string;
  activeClass: string;
}[] = [
  {
    status: 'lower',
    label: 'Lower than avg',
    valueClass: 'text-primary-400',
    activeClass: 'ring-1 ring-primary-500/60 bg-primary-500/10',
  },
  {
    status: 'average',
    label: 'At average',
    valueClass: 'text-success-400',
    activeClass: 'ring-1 ring-success-500/60 bg-success-500/10',
  },
  {
    status: 'higher',
    label: 'Higher than avg',
    valueClass: 'text-warning-400',
    activeClass: 'ring-1 ring-warning-500/60 bg-warning-500/10',
  },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function CompareToResearchCard({ volumeProfile }: { volumeProfile: UserVolumeProfile | null }) {
  const [openBucket, setOpenBucket] = useState<ResearchComparisonStatus | null>(null);

  const comparison = useMemo(
    () => (volumeProfile ? compareProfileToResearch(volumeProfile) : null),
    [volumeProfile]
  );
  if (!comparison) return null;

  const openEntries = openBucket ? comparison[openBucket] : [];

  return (
    <Card className="p-4 mt-4">
      <h4 className="font-medium text-surface-200 mb-3">Research Comparison</h4>
      <p className="text-sm text-surface-400 mb-3">
        Your personalized volume recommendations compared to research averages.
        Tap a category to see which muscles and why:
      </p>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {COMPARISON_BUCKETS.map(({ status, label, valueClass, activeClass }) => (
          <button
            key={status}
            onClick={() => setOpenBucket((prev) => (prev === status ? null : status))}
            aria-expanded={openBucket === status}
            data-testid={`research-comparison-${status}`}
            className={`text-center p-2 rounded transition-colors ${
              openBucket === status ? activeClass : 'bg-surface-800/50 hover:bg-surface-800'
            }`}
          >
            <p className="text-surface-500 text-xs">{label}</p>
            <p className={`${valueClass} font-medium`}>
              {comparison[status].length} muscle{comparison[status].length === 1 ? '' : 's'}
            </p>
          </button>
        ))}
      </div>

      {openBucket && (
        <div className="mt-3 space-y-2" data-testid="research-comparison-detail">
          {openEntries.length === 0 ? (
            <p className="text-sm text-surface-500 text-center py-2">
              No muscles in this category right now.
            </p>
          ) : (
            openEntries.map((entry) => (
              <div key={entry.muscle} className="p-3 bg-surface-800/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-surface-200">
                    {capitalize(entry.muscle)}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      entry.status === 'average'
                        ? 'text-success-400'
                        : entry.percentDiff > 0
                          ? 'text-warning-400'
                          : 'text-primary-400'
                    }`}
                  >
                    {entry.status === 'average'
                      ? 'At average'
                      : `${entry.percentDiff > 0 ? '+' : ''}${entry.percentDiff}% vs research`}
                  </span>
                </div>
                <p className="text-xs text-surface-400 mt-1">
                  You: {entry.personalMev}&ndash;{entry.personalMrv} sets/wk
                  <span className="text-surface-600"> &middot; </span>
                  Research: {entry.researchMev}&ndash;{entry.researchMrv} sets/wk
                </p>
                {entry.reasons.map((reason) => (
                  <p key={reason} className="text-xs text-surface-500 mt-0.5">
                    {reason}
                  </p>
                ))}
              </div>
            ))
          )}
        </div>
      )}

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

  // Below-MEV muscles for the atrophy-risk warning come from the SAME coarse
  // rows the bars render (shared counter + band), so the warning, the bars and
  // the "This Week vs MEV" card can never disagree on count or zone-status.
  const { stats: volumeStats, reachable } = useWeeklyMevSummary();

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
  const recoveryProfile = user?.enhancedAthleteMode ? ('enhanced' as const) : ('standard' as const);
  const volumeRows = useMemo(
    () => buildVolumeRows(volumeStats, reachable, { recoveryProfile }),
    [volumeStats, reachable, recoveryProfile]
  );

  // Shared hierarchy expansion (persisted per user for this surface); lagging
  // (below-MEV) fine children stay pinned visible even while collapsed.
  const expansion = useMuscleRowExpansion('volume', volumeRows);
  // Pinned = reachable AND lagging; unreachable context rows only show on expand.
  const pinLaggingChild = useCallback((child: VolumeRow) => child.belowMev && child.reachable, []);
  // Rows narrowed to the children actually on screen — the body map and the
  // tap-to-scroll targets must match the visible bars, not the full hierarchy.
  const visibleRows = useMemo(
    () => withVisibleChildren(volumeRows, expansion.expanded, pinLaggingChild, expansion.collapsed),
    [volumeRows, expansion.expanded, expansion.collapsed, pinLaggingChild]
  );

  // Find muscles below MEV (for atrophy risk alert) — same coarse rows as bars.
  const musclesBelowMev = useMemo(
    () => belowMevVolumeData(volumeRows),
    [volumeRows]
  );

  // Body map over the SAME rows the bars render (zone per coarse row, rendered
  // fine children override) — the map is a view, it computes nothing itself.
  const [mapCollapsed, setMapCollapsedState] = useState(() => readMapCollapsed());
  const setMapCollapsed = (value: boolean) => {
    setMapCollapsedState(value);
    persistMapCollapsed(value);
  };
  const mapData = useMemo(() => volumeRowsToMapData(visibleRows), [visibleRows]);
  // Standard muscles that have their own (fine child) bar row on screen —
  // taps on those scroll to the child row, everything else to the coarse row.
  const renderedChildMuscles = useMemo(
    () => new Set(visibleRows.flatMap((row) => row.children.map((c) => c.muscle))),
    [visibleRows]
  );
  const scrollToMuscleRow = useCallback(
    (muscle: MuscleId) => {
      const target = renderedChildMuscles.has(muscle) ? muscle : STANDARD_TO_COARSE[muscle];
      document
        .querySelector(`[data-testid="volume-row-${target}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [renderedChildMuscles]
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

      {/* Body map — the same rows as the bars below, painted on the figure.
          Tapping a muscle scrolls to its bar row. */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-surface-100">Body Map</h3>
          <button
            onClick={() => setMapCollapsed(!mapCollapsed)}
            className="text-xs font-medium text-surface-500 hover:text-surface-300 transition-colors"
            data-testid="volume-map-toggle"
            aria-expanded={!mapCollapsed}
          >
            {mapCollapsed ? 'Show' : 'Hide'}
          </button>
        </div>
        {!mapCollapsed && (
          <MuscleMap
            data={mapData}
            mode="volume"
            view="both"
            onMuscleTap={scrollToMuscleRow}
            className="h-64 mt-3"
            data-testid="volume-muscle-map"
          />
        )}
      </Card>

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

        <div>
          <MuscleGroupList
            rows={volumeRows}
            expansion={expansion}
            renderRow={(row) => <VolumeRowContent row={row} />}
            renderChild={(child) => (
              // Tapping a fine-child bar toggles its own counted-sets breakdown.
              <SourcesDisclosure
                exercises={child.exercises}
                muscle={child.muscle}
                displayName={child.displayName}
                testIdPrefix="volume-sources"
              >
                <VolumeChildContent child={child} />
              </SourcesDisclosure>
            )}
            pinChild={pinLaggingChild}
            // Expanding a row also reveals WHERE its weekly count came from —
            // and gives chevronless single-muscle groups (Biceps, Quads, …)
            // something to expand to.
            renderRowDetail={(row) =>
              row.exercises.length > 0 ? (
                // The scope label keeps this group-wide panel (rendered below
                // the last fine child) from reading as that child's breakdown.
                <ContributingSets
                  exercises={row.exercises}
                  muscle={row.muscle}
                  testIdPrefix="volume-sources"
                  scopeLabel={row.children.length > 0 ? `${row.displayName} · whole group` : row.displayName}
                />
              ) : null
            }
            testIdPrefix="volume-row"
            rowClassName="py-3 border-b border-surface-800 last:border-b-0"
          />
        </div>
      </Card>

      {/* Enhanced Mode Toggle — same persisted profile field as Settings.
          persistEnhancedAthleteMode syncs this page's volume profile too;
          refresh so the rescaled MEV/MRV estimates show immediately. */}
      <div className="mb-6">
        <EnhancedAthleteModeCard onChanged={() => refreshProfile()} />
      </div>

      {/* Compare to Research */}
      <CompareToResearchCard volumeProfile={volumeProfile} />

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
