'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import { STANDARD_MUSCLE_DISPLAY_NAMES, type StandardMuscleGroup } from '@/types/schema';
import {
  MIN_SESSIONS_FOR_INSIGHT,
  getPaceDisplay,
  type MuscleGroupProgression,
  type ProgressionPace,
} from '@/services/progressionInsights';
import { MIN_TREND_SPAN_DAYS, type PlateauGoal } from '@/services/plateauDetector';

interface MuscleProgressionCardProps {
  groups: MuscleGroupProgression[];
  /** exerciseId -> display name, for the expanded per-exercise rows */
  exerciseNames?: Map<string, string>;
  /** Diet goal, used to explain what "on pace" means for the phase */
  goal?: PlateauGoal;
  /**
   * Days of history the rates are fitted over — the lift list's window
   * (LIFT_TREND_WINDOW_DAYS), since the card rolls up those same lifts.
   */
  windowDays?: number;
}

function muscleDisplayName(muscle: string): string {
  return (
    STANDARD_MUSCLE_DISPLAY_NAMES[muscle as StandardMuscleGroup] ??
    muscle.charAt(0).toUpperCase() + muscle.slice(1).replace(/_/g, ' ')
  );
}

function paceBadgeClasses(pace: ProgressionPace): string {
  switch (pace) {
    case 'ahead':
      return 'bg-status-ok-tint text-status-ok';
    case 'on_track':
      return 'bg-fill/60 text-ink';
    case 'behind':
      return 'bg-orange-500/10 text-orange-400';
    case 'plateaued':
      return 'bg-status-warn/10 text-status-warn';
    case 'calibrating':
    case 'insufficient_data':
      return 'bg-fill text-ink-2';
  }
}

/** Paces whose fitted rate is trustworthy enough to display. */
function paceHasRate(pace: ProgressionPace): boolean {
  return pace !== 'insufficient_data' && pace !== 'calibrating';
}

/** "+1.2% per week" — plain words, not "%/wk" (UX panel r20: jargon). */
export function formatWeeklyPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct}% per week`;
}

/**
 * Plain copy for muscles that can't be judged yet: the real threshold, each
 * muscle's progress toward it, and the next step. A muscle's count is its
 * best-trained lift's workouts (a pace appears once ANY of its lifts reaches
 * MIN_SESSIONS_FOR_INSIGHT) — worded like LiftTrendsCard's "N of 3 workouts".
 * A lift already at the threshold whose trend is still too noisy shows as
 * "settling" rather than a count that looks complete.
 */
export function buildingSummaryText(groups: MuscleGroupProgression[]): {
  lead: string;
  detail: string;
} {
  const min = MIN_SESSIONS_FOR_INSIGHT;
  const counted = groups.map((g) => ({
    name: muscleDisplayName(g.muscleGroup),
    sessions: g.insights.reduce((best, i) => Math.max(best, i.sessionsAnalyzed), 0),
  }));
  // A lift with its workouts but no rate yet: they're too close together in
  // time (progressionInsights' span gate), not short of workouts.
  const parts = counted.map((c) =>
    c.sessions >= min ? `${c.name} needs its workouts spread over ${MIN_TREND_SPAN_DAYS}+ days` : `${c.name} ${c.sessions} of ${min}`
  );
  const short = counted.filter((c) => c.sessions < min);
  let next = '';
  if (short.length > 0) {
    const closest = short.reduce((a, b) => (b.sessions > a.sessions ? b : a));
    const more = min - closest.sessions;
    next =
      short.length === 1
        ? ` Train ${closest.name} ${more} more time${more === 1 ? '' : 's'} to see its pace.`
        : ` Closest: ${closest.name}, ${more} more workout${more === 1 ? '' : 's'}.`;
  }
  return {
    lead: `A pace shows once one of a muscle's lifts has ${min} workouts:`,
    detail: `${parts.join(', ')}.${next}`,
  };
}

/** Plain explanation for a group rate clamped at the sanity ceiling. */
export function cappedRateText(names: string[]): string {
  const list = names.join(', ');
  const subject = names.length === 1 ? `${list}'s rate was` : `${list} rates were`;
  return `${subject} capped: it climbed faster than muscle realistically gains, which usually means a weight was mistyped or the equipment changed. Check recent sets for a typo; after a switch of machine or gym it settles in a few workouts.`;
}

/**
 * The card's subtitle: what the rate is, over what window, against what
 * expectation — and, plainly, that a muscle's rate is the AVERAGE of its
 * lifts, so it can sit below its fastest lift without contradicting it.
 */
export function muscleProgressionSubtitle(
  goal: PlateauGoal | undefined,
  expectedPct: number,
  windowDays?: number
): string {
  const normalizedGoal = goal === 'maintain' ? 'maintenance' : goal;
  const weeks = windowDays ? Math.round(windowDays / 7) : null;
  const over = weeks ? ` over the last ${weeks} weeks` : '';
  const average =
    " A muscle's rate is the average of its lifts, weighted by sets. Tap a muscle to see each lift.";
  if (normalizedGoal === 'cut') {
    return `How fast each muscle's lifts are getting stronger${over}. You're eating less to lose fat, so holding strength counts as on track.${average}`;
  }
  if (normalizedGoal === 'maintenance') {
    return `How fast each muscle's lifts are getting stronger${over}. You're eating to hold your weight, so holding strength counts as on track.${average}`;
  }
  return `How fast each muscle's lifts are getting stronger${over}, vs the ~${expectedPct}% a week expected at your level.${average}`;
}

/**
 * "Progression by muscle group" — how each muscle's lifts are trending vs
 * the expected E1RM gain rate for the user's experience level. Rows expand
 * to show per-exercise pace.
 *
 * Anchored as #muscle-progression for
 * /dashboard/analytics?tab=strength&section=muscle-progression (the Train
 * page's Progression card deep-links here).
 */

/** Behind pace with a ~0 rate: "Holding · below pace" (pure; exported for tests). */
export function flatBehindDisplay(group: { pace: string; avgWeeklyChangePct: number }): { label: string; tone: 'warning' } | null {
  return group.pace === 'behind' && Math.abs(group.avgWeeklyChangePct) < 0.05
    ? { label: 'Holding · below pace', tone: 'warning' }
    : null;
}

export function MuscleProgressionCard({ groups, exerciseNames, goal, windowDays }: MuscleProgressionCardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (muscle: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(muscle)) next.delete(muscle);
      else next.add(muscle);
      return next;
    });
  };

  if (groups.length === 0) return null;

  // Muscles with at least one confident lift render as full rows; muscles
  // that are only calibrating (post program switch) or only building history
  // collapse into single summary lines — a decimal rate is never shown for
  // them, and ~14 muted rows become two lines.
  const activeGroups = groups.filter((g) => paceHasRate(g.pace));
  const calibratingGroups = groups.filter((g) => g.pace === 'calibrating');
  const buildingGroups = groups.filter((g) => g.pace === 'insufficient_data');
  const buildingSummary = buildingSummaryText(buildingGroups);
  const cappedGroups = activeGroups.filter((g) => g.rateImplausible);

  const expectedPct = groups[0].expectedWeeklyPct;
  const subtitle = muscleProgressionSubtitle(goal, expectedPct, windowDays);

  return (
    <Card id="muscle-progression" padding="none" className="scroll-mt-4">
      <div className="p-4 border-b border-sep">
        <h3 className="font-medium text-ink">Strength by muscle</h3>
        <p className="text-caption text-ink-2 mt-0.5">{subtitle}</p>
      </div>
      <ul className="divide-y divide-sep">
        {activeGroups.map((group) => {
          const isOpen = expanded.has(group.muscleGroup);
          // A flat group "behind" the expected gain reads as a contradiction
          // next to rising lifts elsewhere; say what it is (UX panel).
          const display = flatBehindDisplay(group) ?? getPaceDisplay(group.pace);
          return (
            <li key={group.muscleGroup}>
              <button
                onClick={() => toggle(group.muscleGroup)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-fill/50 transition-colors"
                aria-expanded={isOpen}
              >
                {/* Name on its own line, rate + plateau count beneath —
                    nothing is ellipsized at phone width. */}
                <span className="flex-1 min-w-0">
                  <span className="block break-words text-subhead font-medium text-ink" data-testid="muscle-progression-name">
                    {muscleDisplayName(group.muscleGroup)}
                  </span>
                  <span className="flex flex-wrap gap-x-2">
                    {paceHasRate(group.pace) && (
                      <span
                        className={`whitespace-nowrap text-caption font-mono ${group.rateImplausible ? 'text-status-warn' : 'text-ink-2'}`}
                        data-testid="muscle-progression-rate"
                        title={
                          group.rateImplausible
                            ? 'Rate exceeded the plausibility ceiling and was capped — usually a data issue (equipment change or mislogged load), not real progress'
                            : undefined
                        }
                      >
                        {group.rateImplausible && '⚠ '}
                        {formatWeeklyPct(group.avgWeeklyChangePct)}
                      </span>
                    )}
                    {group.plateauedCount > 0 && (
                      <span className="whitespace-nowrap text-caption text-status-warn">
                        {group.plateauedCount} stalled
                      </span>
                    )}
                  </span>
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-caption font-medium leading-none flex-shrink-0 ${paceBadgeClasses(group.pace)}`}
                >
                  {display.label}
                </span>
                <svg
                  className={`w-4 h-4 text-ink-2 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <ul className="pb-2">
                  {group.insights.map((insight) => {
                    const insightDisplay = getPaceDisplay(insight.pace);
                    return (
                      <li
                        key={insight.exerciseId}
                        className="flex items-center gap-3 pl-8 pr-4 py-1.5"
                      >
                        <span className="flex-1 min-w-0 break-words text-subhead text-ink-2">
                          {exerciseNames?.get(insight.exerciseId) ?? 'Exercise'}
                        </span>
                        {paceHasRate(insight.pace) && (
                          <span className="flex-shrink-0 whitespace-nowrap text-caption font-mono text-ink-2">
                            {formatWeeklyPct(insight.weeklyChangePct)}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-caption font-medium leading-none flex-shrink-0 ${paceBadgeClasses(insight.pace)}`}
                        >
                          {insightDisplay.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {calibratingGroups.length > 0 && (
          <li
            className="px-4 py-3 text-caption text-ink-2"
            data-testid="muscle-progression-calibrating-summary"
          >
            <span className="font-medium text-ink-2">
              {calibratingGroups.length} rebuilding
            </span>{' '}
            after a program change — {calibratingGroups.map((g) => muscleDisplayName(g.muscleGroup)).join(', ')}.
            Rates return after 2–3 sessions on the new program.
          </li>
        )}
        {buildingGroups.length > 0 && (
          <li
            className="px-4 py-3 text-caption text-ink-2"
            data-testid="muscle-progression-building-summary"
          >
            <span className="font-medium text-ink-2">{buildingSummary.lead}</span>{' '}
            {buildingSummary.detail}
          </li>
        )}
        {cappedGroups.length > 0 && (
          <li
            className="px-4 py-3 text-caption text-status-warn"
            data-testid="muscle-progression-capped-note"
          >
            ⚠ {cappedRateText(cappedGroups.map((g) => muscleDisplayName(g.muscleGroup)))}
          </li>
        )}
      </ul>
    </Card>
  );
}
