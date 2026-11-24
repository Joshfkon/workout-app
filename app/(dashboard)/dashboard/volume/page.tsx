'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { muscleDisplayName } from '@/lib/utils';
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';
import { useUserStore } from '@/stores';
import { FatigueAlertList } from '@/components/workout/FatigueAlertBanner';
import { AtrophyRiskAlert } from '@/components/analytics/AtrophyRiskAlert';
import { VolumeHeatmapCard } from '@/components/analytics/VolumeHeatmapCard';
import { WeeklyMevSummary } from '@/components/dashboard/WeeklyMevSummary';
import { VolumeRowContent, VolumeChildContent } from '@/components/analytics/VolumeZoneBar';
import {
  MuscleGroupList,
  useMuscleRowExpansion,
  withVisibleChildren,
} from '@/components/muscle/MuscleGroupList';
import { ContributingSets, SourcesDisclosure } from '@/components/muscle/ContributingSets';
import { RollingVolumeForecast } from '@/components/muscle/RollingVolumeForecast';
import { EnhancedAthleteModeCard } from '@/components/settings/EnhancedAthleteModeCard';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { volumeRowsToMapData } from '@/lib/muscleMap/adapters';
import type { MuscleId } from '@/lib/muscleMap/taxonomy';
import { useWeeklyMevSummary } from '@/hooks/useWeeklyMevSummary';
import {
  buildVolumeRows,
  belowMevVolumeData,
  STANDARD_TO_COARSE,
  type CoarseMuscle,
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
    valueClass: 'text-action',
    activeClass: 'ring-1 ring-action/60 bg-action/10',
  },
  {
    status: 'average',
    label: 'At average',
    valueClass: 'text-status-ok',
    activeClass: 'ring-1 ring-status-ok/60 bg-status-ok/10',
  },
  {
    status: 'higher',
    label: 'Higher than avg',
    valueClass: 'text-status-warn',
    activeClass: 'ring-1 ring-status-warn/60 bg-status-warn/10',
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
      <h4 className="font-medium text-ink mb-3">Research comparison</h4>
      <p className="text-body text-ink-2 mb-3">
        Your personalized volume recommendations compared to research averages.
        Tap a category to see which muscles and why:
      </p>
      <div className="grid grid-cols-3 gap-2 text-body">
        {COMPARISON_BUCKETS.map(({ status, label, valueClass, activeClass }) => (
          <button
            key={status}
            onClick={() => setOpenBucket((prev) => (prev === status ? null : status))}
            aria-expanded={openBucket === status}
            data-testid={`research-comparison-${status}`}
            className={`text-center p-2 rounded transition-colors ${
              openBucket === status ? activeClass : 'bg-fill/50 hover:bg-fill'
            }`}
          >
            <p className="text-ink-3 text-caption">{label}</p>
            <p className={`${valueClass} font-medium`}>
              {comparison[status].length} muscle{comparison[status].length === 1 ? '' : 's'}
            </p>
          </button>
        ))}
      </div>

      {openBucket && (
        <div className="mt-3 space-y-2" data-testid="research-comparison-detail">
          {openEntries.length === 0 ? (
            <p className="text-body text-ink-3 text-center py-2">
              No muscles in this category right now.
            </p>
          ) : (
            openEntries.map((entry) => (
              <div key={entry.muscle} className="p-3 bg-fill/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-body font-medium text-ink">
                    {muscleDisplayName(entry.muscle)}
                  </span>
                  <span
                    className={`text-caption font-medium ${
                      entry.status === 'average'
                        ? 'text-status-ok'
                        : entry.percentDiff > 0
                          ? 'text-status-warn'
                          : 'text-action'
                    }`}
                  >
                    {entry.status === 'average'
                      ? 'At average'
                      : `${entry.percentDiff > 0 ? '+' : ''}${entry.percentDiff}% vs research`}
                  </span>
                </div>
                <p className="text-caption text-ink-2 mt-1">
                  You: {entry.personalMev}&ndash;{entry.personalMrv} sets/wk
                  <span className="text-ink-3"> &middot; </span>
                  Research: {entry.researchMev}&ndash;{entry.researchMrv} sets/wk
                </p>
                {entry.reasons.map((reason) => (
                  <p key={reason} className="text-caption text-ink-3 mt-0.5">
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
        className="block mt-3 text-caption text-action text-center transition-colors"
      >
        Learn how we calculate this {'\u2192'}
      </Link>
    </Card>
  );
}

export default function VolumeProfilePage() {
  useDocumentTitle('Volume');
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
  // the "This week vs MEV" card can never disagree on count or zone-status.
  const { stats: volumeStats, reachable, dailyGroupSets } = useWeeklyMevSummary();

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
          <div className="h-8 bg-fill rounded w-1/2" />
          <div className="h-4 bg-fill rounded w-2/3" />
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 bg-fill rounded-lg" />
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
        <h1 className="text-large-title text-ink mb-2">Your volume tolerance</h1>
        <p className="text-ink-2">
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
            <span className="text-body text-ink-2">Confidence level</span>
            <h3 className="text-headline font-semibold text-ink capitalize">
              {confidenceSummary.level}
            </h3>
          </div>
          <div className="flex gap-1">
            {['low', 'medium', 'high'].map((level, idx) => (
              <div
                key={level}
                className={`w-8 h-2 rounded-full ${
                  idx <= ['low', 'medium', 'high'].indexOf(confidenceSummary.level)
                    ? 'bg-action'
                    : 'bg-sep'
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
          <h3 className="font-semibold text-ink">Body map</h3>
          <button
            onClick={() => setMapCollapsed(!mapCollapsed)}
            className="text-caption font-medium text-ink-3 hover:text-ink-2 transition-colors"
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

      {/* Long-window heatmap — average weekly volume vs MEV over a selectable
          2w–1y window, painted on the body map (reds/amber below MEV, greens
          darkening with volume). Complements the this-week map above. */}
      <VolumeHeatmapCard />

      {/* Volume Bars — shared coarse-row model. Green spans the whole MEV–MRV
          band; a bar only turns red past MRV. Tap a group to reveal its fine
          muscles; lagging (below-MEV) fine muscles surface automatically. */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-ink">This week&apos;s volume</h3>
          <div className="flex items-center gap-2 text-caption text-ink-3">
            <span className="w-3 h-3 rounded bg-status-ok/20 border border-status-ok/40" />
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
            renderRowDetail={(row) => {
              if (row.exercises.length === 0) return null;
              const daily = dailyGroupSets[row.muscle as CoarseMuscle];
              return (
                <>
                  {/* Group-scope panel: MuscleGroupList renders it at ROW level
                      (outside the child indent), and the scope label names the
                      group, so it can't read as a sub-muscle's breakdown.
                      groupScope adds the footnote for why the group total is
                      below the sum of the sub-muscle rows. */}
                  <ContributingSets
                    exercises={row.exercises}
                    muscle={row.muscle}
                    testIdPrefix="volume-sources"
                    scopeLabel={row.children.length > 0 ? `${row.displayName} · whole group` : row.displayName}
                    groupScope={row.children.length > 0}
                  />
                  {/* When does this rolling count fall off? Same zone colors as
                      the row bar and the body map. */}
                  {daily && (
                    <RollingVolumeForecast
                      daily={daily}
                      band={row.band}
                      muscle={row.muscle}
                      displayName={row.displayName}
                      testIdPrefix="volume-forecast"
                    />
                  )}
                </>
              );
            }}
            testIdPrefix="volume-row"
            rowClassName="py-3 border-b border-sep last:border-b-0"
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
        <Card className="p-4 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-ink">Latest training block review</h4>
              <p className="text-body text-ink-3">
                See detailed analysis and recommendations
              </p>
            </div>
            <Link
              href="/dashboard/volume/review"
              className="px-4 py-2 bg-action-tint text-action font-semibold rounded-button transition-colors"
            >
              View review
            </Link>
          </div>
        </Card>
      )}

      {/* Learn More */}
      <div className="mt-8 text-center">
        <Link
          href="/dashboard/learn/adaptive-volume"
          className="text-body text-ink-2 hover:text-ink transition-colors"
        >
          How we learn your recovery capacity {'\u2192'}
        </Link>
      </div>
    </div>
  );
}
