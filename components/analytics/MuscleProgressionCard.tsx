'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import { STANDARD_MUSCLE_DISPLAY_NAMES, type StandardMuscleGroup } from '@/types/schema';
import {
  getPaceDisplay,
  type MuscleGroupProgression,
  type ProgressionPace,
} from '@/services/progressionInsights';
import type { PlateauGoal } from '@/services/plateauDetector';

interface MuscleProgressionCardProps {
  groups: MuscleGroupProgression[];
  /** exerciseId -> display name, for the expanded per-exercise rows */
  exerciseNames?: Map<string, string>;
  /** Diet goal, used to explain what "on pace" means for the phase */
  goal?: PlateauGoal;
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
      return 'bg-emerald-500/10 text-emerald-400';
    case 'on_track':
      return 'bg-surface-700/60 text-surface-300';
    case 'behind':
      return 'bg-orange-500/10 text-orange-400';
    case 'plateaued':
      return 'bg-warning-500/10 text-warning-400';
    case 'calibrating':
    case 'insufficient_data':
      return 'bg-surface-800 text-surface-500';
  }
}

/** Paces whose fitted rate is trustworthy enough to display. */
function paceHasRate(pace: ProgressionPace): boolean {
  return pace !== 'insufficient_data' && pace !== 'calibrating';
}

function formatWeeklyPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct}%/wk`;
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
export function MuscleProgressionCard({ groups, exerciseNames, goal }: MuscleProgressionCardProps) {
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

  const expectedPct = groups[0].expectedWeeklyPct;
  const normalizedGoal = goal === 'maintain' ? 'maintenance' : goal;
  const subtitle =
    normalizedGoal === 'cut'
      ? 'E1RM trend · on a cut, holding strength counts as on track'
      : normalizedGoal === 'maintenance'
        ? 'E1RM trend · at maintenance, holding strength counts as on track'
        : `E1RM trend vs the ~${expectedPct}%/week expected for your level`;

  return (
    <Card id="muscle-progression" padding="none" className="scroll-mt-4">
      <div className="p-4 border-b border-surface-800">
        <h3 className="font-medium text-surface-100">Progression by muscle group</h3>
        <p className="text-xs text-surface-500 mt-0.5">{subtitle}</p>
      </div>
      <ul className="divide-y divide-surface-800">
        {activeGroups.map((group) => {
          const isOpen = expanded.has(group.muscleGroup);
          const display = getPaceDisplay(group.pace);
          return (
            <li key={group.muscleGroup}>
              <button
                onClick={() => toggle(group.muscleGroup)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-800/50 transition-colors"
                aria-expanded={isOpen}
              >
                <span className="flex-1 min-w-0 text-sm font-medium text-surface-200 truncate">
                  {muscleDisplayName(group.muscleGroup)}
                </span>
                {paceHasRate(group.pace) && (
                  <span
                    className={`text-xs font-mono ${group.rateImplausible ? 'text-warning-400' : 'text-surface-400'}`}
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
                  <span className="text-[11px] text-warning-400">
                    {group.plateauedCount} plateaued
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium leading-none flex-shrink-0 ${paceBadgeClasses(group.pace)}`}
                >
                  {display.label}
                </span>
                <svg
                  className={`w-4 h-4 text-surface-500 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
                        <span className="flex-1 min-w-0 text-sm text-surface-400 truncate">
                          {exerciseNames?.get(insight.exerciseId) ?? 'Exercise'}
                        </span>
                        {paceHasRate(insight.pace) && (
                          <span className="text-xs font-mono text-surface-500">
                            {formatWeeklyPct(insight.weeklyChangePct)}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium leading-none flex-shrink-0 ${paceBadgeClasses(insight.pace)}`}
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
            className="px-4 py-3 text-xs text-surface-500"
            data-testid="muscle-progression-calibrating-summary"
          >
            <span className="font-medium text-surface-400">
              {calibratingGroups.length} calibrating
            </span>{' '}
            after program change — {calibratingGroups.map((g) => muscleDisplayName(g.muscleGroup)).join(', ')}.
            Rates return after 2–3 sessions on the new program.
          </li>
        )}
        {buildingGroups.length > 0 && (
          <li
            className="px-4 py-3 text-xs text-surface-500"
            data-testid="muscle-progression-building-summary"
          >
            <span className="font-medium text-surface-400">
              {buildingGroups.length} building history
            </span>{' '}
            — {buildingGroups.map((g) => muscleDisplayName(g.muscleGroup)).join(', ')}.
          </li>
        )}
      </ul>
    </Card>
  );
}
