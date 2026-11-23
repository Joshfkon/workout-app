import { detectSplit } from '@/services/suggestedWorkout';
import {
  STANDARD_MUSCLE_DISPLAY_NAMES,
  priorityHeadParent,
  type MuscleGroup,
  type PeriodizationModel,
  type RecoveryFactors,
  type StandardMuscleGroup,
} from '@/types/schema';
import type { VolumeAdjustmentInput } from '@/services/mesocycleBuilder';
import { COARSE_MUSCLES, getEffectiveBand, type BandContext, type CoarseMuscle } from '@/services/volumeBands';
import { perSetCredits } from '@/services/shared/volumeCredit';
import { creditedSetsByGroup, peakTrainingWeek } from '@/services/sessionBuilderWithFatigue';
import { muscleDisplayName } from '@/lib/utils';

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

/** A row of user_muscle_priorities (1 = high … 5 = low): a coarse group or
 *  one of its prioritizable heads (MUSCLE_PRIORITY_HEADS). */
export interface MusclePriorityRow {
  muscle_group: MuscleGroup | StandardMuscleGroup;
  priority: number;
}

/**
 * Settings → Muscle priorities as the generator's volume adjustments, with
 * the same multipliers the imbalance engine applies (services/
 * measurementImbalanceEngine): 1 → +20%, 2 → +10%, 4 → −5%, 5 → −10%. The
 * builder never passed them, so "bring up my side delts" changed nothing.
 *
 * A HEAD row (side delts, upper chest…) moves its parent group's weekly
 * target by half as much (one head is part of the group) and carries the
 * head, which steers that group's exercise choice toward it (session
 * builder headEmphasisFrom).
 */
export function priorityVolumeAdjustments(rows: MusclePriorityRow[]): VolumeAdjustmentInput[] {
  const out: VolumeAdjustmentInput[] = [];
  for (const row of rows) {
    const m =
      row.priority === 1 ? 1.2 : row.priority === 2 ? 1.1 : row.priority === 4 ? 0.95 : row.priority === 5 ? 0.9 : 1;
    if (m === 1) continue;
    const reason = row.priority <= 2 ? 'user_priority' : 'dominant';
    const parent = priorityHeadParent(row.muscle_group);
    if (parent) {
      out.push({
        muscleGroup: parent,
        head: row.muscle_group as StandardMuscleGroup,
        volumeMultiplier: Math.round((1 + (m - 1) / 2) * 1000) / 1000,
        reason,
      });
    } else {
      out.push({ muscleGroup: row.muscle_group as MuscleGroup, volumeMultiplier: m, reason });
    }
  }
  return out;
}

/** "Side Delts" for a head, "Shoulders" for a group. */
export function priorityLabel(a: Pick<VolumeAdjustmentInput, 'muscleGroup' | 'head'>): string {
  return a.head ? STANDARD_MUSCLE_DISPLAY_NAMES[a.head] : muscleDisplayName(a.muscleGroup);
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



type PlanExercise = {
  exercise: { primaryMuscle: string; secondaryMuscles?: string[] };
  sets: number;
  reps?: { targetRIR?: number };
};

/** One generated week, as the builder reads it (MesocycleWeek). */
interface PlanWeek {
  weekNumber?: number;
  isDeload: boolean;
  volumeModifier: number;
  intensityModifier?: number;
  rpeTarget?: { min: number; max: number };
  sessions: { exercises: PlanExercise[] }[];
}

/** The weeks/sessions shape the builder reads (FullProgramRecommendation). */
interface ProgramWeeks {
  mesocycleWeeks?: PlanWeek[];
}

/**
 * CREDITED working sets per coarse muscle (primary 1, secondary 0.5, the
 * shared counter — services/shared/volumeCredit perSetGroupCredits) that the
 * PEAK week's sessions actually contain (the last non-deload week with the
 * highest volume) — the same currency as the targets and MEV–MRV bands. The
 * weekly target is what the plan aims for; a session is also bounded by its
 * time, exercise count and fatigue budget, so with one day per muscle the
 * days held far fewer sets than the table promised (chest 9 vs 17 — UX
 * panel: "the volume table contradicts the workout structure"). Pure.
 */
export function deliveredSetsAtPeak(program: ProgramWeeks | null | undefined): Partial<Record<CoarseMuscle, number>> | null {
  // null = no generated weeks to read (not "every muscle got 0").
  const peak = peakTrainingWeek(program?.mesocycleWeeks ?? []);
  return peak ? creditedSetsByGroup(peak.sessions) : null;
}

/** A planned muscle whose sessions fit clearly fewer sets than its target
 *  (a muscle absent from the generated week counts as 0). */
export function isUnderDelivered(target: number, delivered: number | undefined): boolean {
  return target > 0 && (delivered ?? 0) < target * 0.85;
}

/** A muscle whose sets sit at or under its minimum effective volume. */
export function isAtOrBelowMev(sets: number | undefined, mev: number): boolean {
  return (sets ?? 0) <= mev;
}

export interface RirRange {
  min: number;
  max: number;
}

/** "2 RIR" or "1–2 RIR". */
export function formatRir(r: RirRange): string {
  return r.min === r.max ? `${r.min} RIR` : `${r.min}–${r.max} RIR`;
}

/**
 * The RIR a week prescribes: the range of its exercises' target RIR (what
 * each set card will say), else the week's RPE target read as RIR (10 − RPE).
 */
export function weekRir(week: PlanWeek): RirRange | null {
  // `reps` here is the prescription object (RepRangeConfig); only its
  // targetRIR is read, never a rep count, so set modality does not apply.
  const rirs = week.sessions.flatMap((s) =>
    s.exercises.map(({ reps: prescription }) => prescription?.targetRIR).filter((r): r is number => typeof r === 'number')
  );
  if (rirs.length > 0) return { min: Math.min(...rirs), max: Math.max(...rirs) };
  if (week.rpeTarget) {
    return { min: Math.max(0, 10 - week.rpeTarget.max), max: Math.max(0, 10 - week.rpeTarget.min) };
  }
  return null;
}

export interface PlanWeekSummary {
  weekNumber: number;
  isDeload: boolean;
  /** Share of the weekly target this week programs (1 = 100%). */
  volumeModifier: number;
  /** Share of working loads (1 = 100%); null when not stored. */
  intensityModifier: number | null;
  rir: RirRange | null;
  /** Credited sets per coarse muscle the week's sessions contain. */
  sets: Partial<Record<CoarseMuscle, number>>;
}

/**
 * Every generated week: its credited sets per muscle, volume and load
 * shares and RIR. Panel: "Show sets per muscle for every week, ramping from
 * MEV toward MRV" — the review only showed the peak week. Pure.
 */
export function weekByWeekPlan(program: ProgramWeeks | null | undefined): PlanWeekSummary[] {
  return (program?.mesocycleWeeks ?? []).map((w, i) => ({
    weekNumber: w.weekNumber ?? i + 1,
    isDeload: w.isDeload,
    volumeModifier: w.volumeModifier,
    intensityModifier: typeof w.intensityModifier === 'number' ? w.intensityModifier : null,
    rir: weekRir(w),
    sets: creditedSetsByGroup(w.sessions),
  }));
}

/** "W1 12 → W3 14 → W4 18 → deload 9": a muscle's ramp. Week 1, every
 *  change, the last training week and the deload; unchanged weeks between
 *  are left out. */
export function rampLine(weeks: PlanWeekSummary[], muscle: CoarseMuscle): string {
  const parts: string[] = [];
  let last: number | null = null;
  weeks.forEach((w, i) => {
    const sets = Math.round(w.sets[muscle] ?? 0);
    const isLastTraining = !w.isDeload && (i === weeks.length - 1 || !!weeks[i + 1]?.isDeload);
    if (w.isDeload) parts.push(`deload ${sets}`);
    else if (last === null || sets !== last || isLastTraining) parts.push(`W${w.weekNumber} ${sets}`);
    if (!w.isDeload) last = sets;
  });
  return parts.join(' → ');
}

/** "W1–2 3 RIR → W3 2 RIR → W4–5 1 RIR → Deload 4 RIR" (equal weeks run
 *  together). */
export function rirLine(weeks: PlanWeekSummary[]): string {
  const runs: { from: number; to: number; rir: string; deload: boolean }[] = [];
  for (const w of weeks) {
    if (!w.rir) continue;
    const rir = formatRir(w.rir);
    const prev = runs[runs.length - 1];
    if (!w.isDeload && prev && !prev.deload && prev.rir === rir) prev.to = w.weekNumber;
    else runs.push({ from: w.weekNumber, to: w.weekNumber, rir, deload: w.isDeload });
  }
  return runs
    .map((r) => `${r.deload ? 'Deload' : r.from === r.to ? `W${r.from}` : `W${r.from}–${r.to}`} ${r.rir}`)
    .join(' → ');
}

export interface DeloadSummary {
  weekNumber: number;
  volumePercent: number;
  /** Working loads as a share of normal, when stored. */
  loadPercent: number | null;
  rir: RirRange | null;
}

/** The deload week's actual prescription (volume, loads, RIR). Pure. */
export function deloadSummary(weeks: PlanWeekSummary[]): DeloadSummary | null {
  const d = weeks.find((w) => w.isDeload);
  if (!d) return null;
  return {
    weekNumber: d.weekNumber,
    volumePercent: Math.round(d.volumeModifier * 100),
    loadPercent: d.intensityModifier === null ? null : Math.round(d.intensityModifier * 100),
    rir: d.rir,
  };
}

/**
 * One sentence on why the volume ramps the way it does, from the plan's own
 * periodization model and week modifiers (panel: "nothing explained why
 * week 1 starts at 80% volume"). Pure.
 */
export function rampExplanation(model: PeriodizationModel, weeks: PlanWeekSummary[]): string {
  const training = weeks.filter((w) => !w.isDeload);
  if (training.length === 0) return '';
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const first = training[0];
  const last = training[training.length - 1];
  const deload = weeks.find((w) => w.isDeload);
  const deloadPart = deload ? ` The deload drops to ${pct(deload.volumeModifier)} so fatigue clears before the next block.` : '';
  switch (model) {
    case 'linear':
    case 'daily_undulating': {
      const rotate = model === 'daily_undulating' ? ' Each week also rotates heavy, moderate and light days.' : '';
      return (
        `Week 1 runs at ${pct(first.volumeModifier)} of the target sets and climbs to ${pct(last.volumeModifier)} by week ${last.weekNumber}: ` +
        `starting below the target leaves room to add sets each week as you adapt, instead of opening at the ceiling.` +
        rotate +
        deloadPart
      );
    }
    case 'weekly_undulating':
      return (
        `High-volume weeks (${pct(first.volumeModifier)} of the target sets) alternate with lighter-volume, heavier weeks, ` +
        `so a deficit never stacks two hard weeks in a row.` +
        deloadPart
      );
    case 'block': {
      const phases: string[] = [];
      let start = training[0];
      for (let i = 1; i <= training.length; i++) {
        const w = training[i];
        if (!w || w.volumeModifier !== start.volumeModifier) {
          const end = training[i - 1];
          const span = start.weekNumber === end.weekNumber ? `week ${start.weekNumber}` : `weeks ${start.weekNumber}–${end.weekNumber}`;
          phases.push(`${span} at ${pct(start.volumeModifier)}`);
          if (w) start = w;
        }
      }
      return (
        `Block periodization: ${phases.join(', then ')} of the target sets. Volume is highest while loads are moderate ` +
        `and comes down as loads get heavier, because heavy sets cost more to recover from.` +
        deloadPart
      );
    }
    default:
      return deloadPart.trim();
  }
}

/**
 * Why the recovery profile scaled volume (panel: "an 85% volume modifier was
 * applied with no explanation"). Null when it did not. Pure.
 */
export function recoveryVolumeExplanation(rf: Pick<RecoveryFactors, 'volumeMultiplier' | 'volumeReasons'>): string | null {
  const pct = Math.round(rf.volumeMultiplier * 100);
  if (pct === 100) return null;
  const reasons = rf.volumeReasons ?? [];
  const why = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';
  return pct < 100
    ? `Your recovery profile sets weekly volume to ${pct}% of the standard targets${why}. Better sleep or lower stress in Settings raises it.`
    : `Your recovery profile allows ${pct}% of the standard targets${why}.`;
}

/**
 * Credited sets per prioritizable HEAD in the peak week (side delts, upper
 * chest…), so the review can show a head priority landing. Pure.
 */
export function headSetsAtPeak(
  program: ProgramWeeks | null | undefined,
  heads: StandardMuscleGroup[]
): Partial<Record<StandardMuscleGroup, number>> {
  const out: Partial<Record<StandardMuscleGroup, number>> = {};
  const peak = peakTrainingWeek(program?.mesocycleWeeks ?? []);
  if (!peak || heads.length === 0) return out;
  const wanted = new Set(heads);
  for (const session of peak.sessions) {
    for (const ex of session.exercises) {
      for (const { muscle, credit } of perSetCredits(ex.exercise.primaryMuscle, ex.exercise.secondaryMuscles ?? [])) {
        if (wanted.has(muscle)) out[muscle] = (out[muscle] ?? 0) + ex.sets * credit;
      }
    }
  }
  for (const k of Object.keys(out) as StandardMuscleGroup[]) out[k] = Math.round((out[k] ?? 0) * 10) / 10;
  return out;
}
