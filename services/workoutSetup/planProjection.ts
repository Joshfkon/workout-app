/**
 * planProjection — what a draft plan does to the week, and how long it takes.
 *
 * Volume: weekly credited sets so far (the readiness sheet's number) plus the
 * plan's credited sets through the SAME per-set group credit the volume model
 * counts with (perSetGroupCredits: primary 1.0 / secondary 0.5, capped 1.0 per
 * group per set). Duration: the app-wide planned-session model. Nothing here is
 * a second volume or duration model — both are compositions of existing ones.
 *
 * Pure: no React, no Supabase, no clock.
 */

import { perSetGroupCredits } from '@/services/shared/volumeCredit';
import { estimatePlannedSessionMinutes } from '@/services/workoutDurationEstimator';
import type { CoarseMuscle } from '@/services/volumeBands';
import type { StandardMuscleGroup } from '@/types/schema';
import {
  STABILIZER_REGION_LABEL,
  trackedStabilizersOf,
} from './exerciseMeta';
import type {
  PlanItem,
  SetupExercise,
  SetupGroupState,
  SetupReadinessStatus,
  StabilizerLoadLevel,
} from './types';

export type ProjectedZone = 'below' | 'in' | 'over';

export interface GroupProjection {
  group: CoarseMuscle;
  displayName: string;
  status: SetupReadinessStatus;
  selected: boolean;
  weeklyCredited: number;
  /** Credited sets the plan adds (rounded to 0.1). */
  planned: number;
  /** weeklyCredited + planned (rounded to 0.1). */
  projected: number;
  zoneMin: number;
  zoneMax: number;
  zone: ProjectedZone;
}

export type PlanWarningKind =
  | 'over_zone_max'
  | 'below_zone_min'
  | 'over_time_budget'
  | 'fatigued_stabilizer'
  | 'group_not_ready';

export interface PlanWarning {
  kind: PlanWarningKind;
  severity: 'info' | 'warn';
  message: string;
  group?: CoarseMuscle;
  itemId?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Credited group sets the plan adds, keyed by coarse group. */
export function plannedCreditByGroup(
  items: readonly PlanItem[],
  exercisesById: ReadonlyMap<string, SetupExercise>
): Map<CoarseMuscle, number> {
  const out = new Map<CoarseMuscle, number>();
  for (const item of items) {
    const ex = exercisesById.get(item.exerciseId);
    if (!ex) continue;
    for (const { group, credit } of perSetGroupCredits(ex.primaryMuscle, ex.secondaryMuscles)) {
      out.set(group, (out.get(group) ?? 0) + credit * item.sets);
    }
  }
  return out;
}

function zoneFor(projected: number, min: number, max: number): ProjectedZone {
  if (projected < min) return 'below';
  if (projected > max) return 'over';
  return 'in';
}

/**
 * Per-group weekly projection. Returns every selected group plus any other
 * group the plan touches (e.g. triceps via bench press), selected first in
 * `selectedGroups` order, then the rest by planned credit.
 */
export function projectPlanVolume(
  items: readonly PlanItem[],
  exercisesById: ReadonlyMap<string, SetupExercise>,
  groupStates: readonly SetupGroupState[],
  selectedGroups: readonly CoarseMuscle[]
): GroupProjection[] {
  const planned = plannedCreditByGroup(items, exercisesById);
  const selected = new Set(selectedGroups);
  const stateByGroup = new Map(groupStates.map((g) => [g.group, g]));

  const rows: GroupProjection[] = [];
  const push = (group: CoarseMuscle) => {
    const state = stateByGroup.get(group);
    if (!state) return;
    const add = planned.get(group) ?? 0;
    const projected = round1(state.weeklyCredited + add);
    rows.push({
      group,
      displayName: state.displayName,
      status: state.status,
      selected: selected.has(group),
      weeklyCredited: state.weeklyCredited,
      planned: round1(add),
      projected,
      zoneMin: state.zoneMin,
      zoneMax: state.zoneMax,
      zone: zoneFor(projected, state.zoneMin, state.zoneMax),
    });
  };

  selectedGroups.forEach(push);
  Array.from(planned.entries())
    .filter(([group, credit]) => !selected.has(group) && credit > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([group]) => push(group));
  return rows;
}

/** Estimated minutes for the plan (app-wide duration model, warmups included). */
export function estimatePlanMinutes(
  items: readonly PlanItem[],
  exercisesById: ReadonlyMap<string, SetupExercise>
): number {
  return estimatePlannedSessionMinutes(
    items.map((item) => {
      const ex = exercisesById.get(item.exerciseId);
      return {
        sets: item.sets,
        restSeconds: item.restSeconds,
        mechanic: ex?.mechanic ?? 'compound',
        muscle: ex?.primaryMuscle ?? null,
      };
    })
  );
}

export interface PlanWarningInput {
  items: readonly PlanItem[];
  exercisesById: ReadonlyMap<string, SetupExercise>;
  projection: readonly GroupProjection[];
  estimatedMinutes: number;
  timeBudgetMin: number | null;
  stabilizerLoad: Partial<Record<StandardMuscleGroup, StabilizerLoadLevel>>;
}

/** Deterministic plan warnings for the footer (and the AI payload's context). */
export function planWarnings(input: PlanWarningInput): PlanWarning[] {
  const out: PlanWarning[] = [];
  for (const row of input.projection) {
    if (row.zone === 'over' && row.planned > 0) {
      out.push({
        kind: 'over_zone_max',
        severity: 'warn',
        group: row.group,
        message: `${row.displayName} will exceed zone max (${row.projected} / ${row.zoneMax})`,
      });
    }
  }
  for (const row of input.projection) {
    if (!row.selected) continue;
    if (row.status === 'fatigued' || row.status === 'recovering') {
      out.push({
        kind: 'group_not_ready',
        severity: row.status === 'fatigued' ? 'warn' : 'info',
        group: row.group,
        message: `${row.displayName} is still ${row.status} — sets reduced`,
      });
    }
  }
  if (input.timeBudgetMin != null && input.estimatedMinutes > input.timeBudgetMin) {
    out.push({
      kind: 'over_time_budget',
      severity: 'warn',
      message: `~${input.estimatedMinutes} min — over your ${input.timeBudgetMin} min budget`,
    });
  }
  const flagged = new Set<string>();
  for (const item of input.items) {
    const ex = input.exercisesById.get(item.exerciseId);
    if (!ex) continue;
    const high = trackedStabilizersOf(ex).filter((s) => input.stabilizerLoad[s] === 'high');
    if (high.length === 0 || flagged.has(item.itemId)) continue;
    flagged.add(item.itemId);
    const regions = high.map((s) => STABILIZER_REGION_LABEL[s] ?? s).join(' & ');
    out.push({
      kind: 'fatigued_stabilizer',
      severity: 'warn',
      itemId: item.itemId,
      message: `${ex.name} loads your ${regions}, which is still fatigued`,
    });
  }
  for (const row of input.projection) {
    if (row.selected && row.zone === 'below') {
      out.push({
        kind: 'below_zone_min',
        severity: 'info',
        group: row.group,
        message: `${row.displayName} still ${round1(row.zoneMin - row.projected)} below zone min`,
      });
    }
  }
  return out;
}
