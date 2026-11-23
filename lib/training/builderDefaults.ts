import { detectSplit } from '@/services/suggestedWorkout';
import type { StandardMuscleGroup } from '@/types/schema';
import type { VolumeAdjustmentInput } from '@/services/mesocycleBuilder';
import type { MuscleGroup } from '@/types/schema';
import { COARSE_MUSCLES, getEffectiveBand, type BandContext, type CoarseMuscle } from '@/services/volumeBands';

/** Days of history the builder reads to prefill the schedule. */
export const BUILDER_HISTORY_DAYS = 28;

export interface BuilderHistoryDefaults {
  /** Sessions per week over the window (2–7), or null with too little history. */
  daysPerWeek: number | null;
  /** The split the history reads as, when it reads as one. */
  splitKind: 'body_part' | 'ppl' | null;
  /** One line for the builder, e.g. "From your last 4 weeks: 5 sessions a week, a body-part split." */
  summary: string | null;
}

/**
 * Builder defaults from what the lifter has actually been doing. The builder
 * opened at 4 days / Upper-Lower for everyone; an advanced lifter on a 5-day
 * body-part split (UX panel) read that as the app not knowing him. Pure.
 *
 * @param sessions completed sessions in the last BUILDER_HISTORY_DAYS days,
 *   oldest first, each as its exercises' standard primary muscles.
 * @param spanDays days the history actually covers (first session → today),
 *   so 15 sessions over 3 weeks reads 5 a week, not 15 / 4 weeks. Defaults to
 *   the full window.
 */
export function builderDefaultsFromHistory(
  sessions: StandardMuscleGroup[][],
  spanDays: number = BUILDER_HISTORY_DAYS
): BuilderHistoryDefaults {
  // Fewer than two weeks' worth of sessions says little about a schedule.
  if (sessions.length < 4) return { daysPerWeek: null, splitKind: null, summary: null };
  const weeks = Math.min(BUILDER_HISTORY_DAYS, Math.max(7, spanDays)) / 7;
  const perWeek = Math.min(7, Math.max(2, Math.round(sessions.length / weeks)));
  const split = detectSplit(sessions);
  const splitKind = split?.kind ?? null;
  const splitText = splitKind === 'body_part' ? ', a body-part split' : splitKind === 'ppl' ? ', push/pull/legs' : '';
  return {
    daysPerWeek: perWeek,
    splitKind,
    summary: `From your recent training: ${perWeek} sessions a week${splitText}.`,
  };
}

/** A row of user_muscle_priorities (1 = high … 5 = low). */
export interface MusclePriorityRow {
  muscle_group: MuscleGroup;
  priority: number;
}

/**
 * Settings → Muscle priorities as the generator's volume adjustments, with
 * the same multipliers the imbalance engine applies (services/
 * measurementImbalanceEngine): 1 → +20%, 2 → +10%, 4 → −5%, 5 → −10%. The
 * builder never passed them, so "bring up my side delts" changed nothing.
 */
export function priorityVolumeAdjustments(rows: MusclePriorityRow[]): VolumeAdjustmentInput[] {
  const out: VolumeAdjustmentInput[] = [];
  for (const row of rows) {
    const m =
      row.priority === 1 ? 1.2 : row.priority === 2 ? 1.1 : row.priority === 4 ? 0.95 : row.priority === 5 ? 0.9 : 1;
    if (m === 1) continue;
    out.push({ muscleGroup: row.muscle_group, volumeMultiplier: m, reason: row.priority <= 2 ? 'user_priority' : 'dominant' });
  }
  return out;
}

/** The plan's weekly sets per coarse muscle with its MEV–MRV band (pure). */
export function plannedVolumeWithBands(
  volumePerMuscle: Record<string, { sets: number } | number>,
  /** Same recovery profile the generator clamped with (enhanced MRVs are higher). */
  ctx?: BandContext
): { muscle: CoarseMuscle; sets: number; mev: number; mrv: number }[] {
  const out: { muscle: CoarseMuscle; sets: number; mev: number; mrv: number }[] = [];
  for (const muscle of COARSE_MUSCLES) {
    const v = volumePerMuscle[muscle];
    const sets = typeof v === 'number' ? v : v?.sets;
    if (!sets) continue;
    const band = getEffectiveBand(muscle, ctx);
    out.push({ muscle, sets, mev: band.mev, mrv: band.mrv });
  }
  return out;
}



/** Standard (fine) muscle → the coarse group the volume bands use. */
const FINE_TO_COARSE: Record<string, CoarseMuscle> = {
  chest_upper: 'chest', chest_lower: 'chest',
  front_delts: 'shoulders', lateral_delts: 'shoulders', rear_delts: 'shoulders', rotator_cuff: 'shoulders',
  lats: 'back', upper_back: 'back',
  triceps_long: 'triceps', triceps_lat_med: 'triceps',
  upper_traps: 'traps', mid_lower_traps: 'traps',
  gastrocnemius: 'calves', soleus: 'calves',
  glute_med: 'glutes', obliques: 'abs',
};

function coarseOf(muscle: string): CoarseMuscle | null {
  const m = muscle.toLowerCase();
  if ((COARSE_MUSCLES as readonly string[]).includes(m)) return m as CoarseMuscle;
  return FINE_TO_COARSE[m] ?? null;
}

/** The weeks/sessions shape the builder reads (FullProgramRecommendation). */
interface ProgramWeeks {
  mesocycleWeeks?: {
    isDeload: boolean;
    volumeModifier: number;
    sessions: { exercises: { exercise: { primaryMuscle: string }; sets: number }[] }[];
  }[];
}

/**
 * Direct working sets per coarse muscle that the PEAK week's sessions
 * actually contain (the last non-deload week with the highest volume). The
 * weekly target is what the plan aims for; a session is also bounded by its
 * time, exercise count and fatigue budget, so with one day per muscle the
 * days held far fewer sets than the table promised (chest 9 vs 17 — UX
 * panel: "the volume table contradicts the workout structure"). Pure.
 */
export function deliveredSetsAtPeak(program: ProgramWeeks | null | undefined): Partial<Record<CoarseMuscle, number>> {
  const weeks = (program?.mesocycleWeeks ?? []).filter((w) => !w.isDeload);
  if (weeks.length === 0) return {};
  const peak = weeks.reduce((best, w) => (w.volumeModifier >= best.volumeModifier ? w : best), weeks[0]);
  const out: Partial<Record<CoarseMuscle, number>> = {};
  for (const session of peak.sessions) {
    for (const ex of session.exercises) {
      const coarse = coarseOf(ex.exercise.primaryMuscle);
      if (!coarse) continue;
      out[coarse] = (out[coarse] ?? 0) + ex.sets;
    }
  }
  return out;
}

/** A planned muscle whose sessions fit clearly fewer sets than its target. */
export function isUnderDelivered(target: number, delivered: number | undefined): boolean {
  return delivered !== undefined && target > 0 && delivered < target * 0.85;
}
