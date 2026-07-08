/**
 * Wordle-style plain-text share encoding for finished workouts.
 *
 * Produces a compact, emoji-encoded summary that survives pasting into
 * iMessage/Slack/anywhere without the app:
 *
 *   HyperTrack 💪 Shoulders & Arms
 *   Jul 8
 *
 *   🟩🟩🟩🟨  Incline Press 🔥
 *   🟩🟩🟩⬜  Lateral Raise
 *   ⬛⬛⬛  Nordic Curl
 *
 *   18 sets · 21,340 lb · 58 min · 🔥2 PRs
 *
 * Pure module: no DB calls, no side effects. All emoji are plain Unicode so
 * alignment survives proportional fonts (the layout must read well ragged —
 * no space-padding beyond simple separators). Training data only: never
 * include body weight, body composition, calories, or nutrition data.
 */

import type { SetQuality, WeightUnit } from '@/types/schema';

export interface ShareSet {
  quality: SetQuality;
  reps: number;
  weightKg: number;
  /** AMRAP set — rendered as its earned color plus a ⚡ suffix. */
  isAmrap?: boolean;
  /**
   * Dropset child (setType 'dropset' hanging off a parent set). Counts
   * toward totals but gets no square of its own — the parent's square
   * already represents the planned set.
   */
  isDropset?: boolean;
}

export interface ShareExercise {
  name: string;
  /** Raw primaryMuscle string; drives the cryptic-mode emoji. */
  primaryMuscle?: string;
  targetSets: number;
  /** Performed working sets in order. Empty when the exercise was skipped. */
  sets: ShareSet[];
  /** Exercise skipped entirely — rendered as up to 3 ⬛ squares. */
  skipped?: boolean;
  hasPR?: boolean;
}

export interface WorkoutShareTextInput {
  /** e.g. "Shoulders & Arms" */
  title: string;
  /** e.g. "Jul 8" or "Arnold · Wk 1 · Day 2" */
  subtitle?: string;
  /** Performed order. */
  exercises: ShareExercise[];
  durationSeconds: number;
  unit: WeightUnit;
  /** Replace exercise names with muscle-group emoji (no-spoiler mode). */
  cryptic?: boolean;
  /** Optional weekly streak for the footer, e.g. 12 → "📅 12-wk streak". */
  streakWeeks?: number;
}

const APP_NAME = 'HyperTrack';

/** Max exercise rows before collapsing smallest-volume rows into "+N more". */
const MAX_EXERCISE_ROWS = 8;
/** Rows kept when collapsing (plus one "+N more" line). */
const ROWS_WHEN_COLLAPSED = 7;
/** Cap on squares shown in the "+N more" collapse line. */
const MAX_COLLAPSE_SQUARES = 12;
/** Max ⬛ squares rendered for a fully skipped exercise. */
const MAX_SKIPPED_SQUARES = 3;

const GREEN = '🟩';
const YELLOW = '🟨';
const RED = '🟥';
const WHITE = '⬜';
const BLACK = '⬛';
const AMRAP_SUFFIX = '⚡';
const PR_SUFFIX = '🔥';

/**
 * Set-classification → square mapping:
 * stimulative → 🟩, effective → 🟨, junk → 🟥.
 * Excessive (RPE 10 grind) reads as effective-but-grinding → 🟨.
 */
const QUALITY_SQUARES: Record<SetQuality, string> = {
  stimulative: GREEN,
  effective: YELLOW,
  excessive: YELLOW,
  junk: RED,
};

const LEG_MUSCLES = ['quad', 'hamstring', 'glute', 'calf', 'calves', 'adductor', 'abductor', 'leg'];
const ARM_MUSCLES = ['bicep', 'tricep', 'forearm', 'arm'];

/** Cryptic-mode emoji for a raw primaryMuscle string. Defaults to 🏋️. */
export function muscleEmoji(primaryMuscle: string | undefined): string {
  const muscle = (primaryMuscle || '').toLowerCase();
  if (LEG_MUSCLES.some((m) => muscle.includes(m))) return '🦵';
  if (ARM_MUSCLES.some((m) => muscle.includes(m))) return '💪';
  return '🏋️';
}

/** Squares row for one exercise (no name). */
function buildSquares(exercise: ShareExercise): string {
  if (exercise.skipped || exercise.sets.length === 0) {
    return BLACK.repeat(Math.max(1, Math.min(MAX_SKIPPED_SQUARES, exercise.targetSets)));
  }
  const countedSets = exercise.sets.filter((s) => !s.isDropset);
  let squares = countedSets
    .map((s) => QUALITY_SQUARES[s.quality] + (s.isAmrap ? AMRAP_SUFFIX : ''))
    .join('');
  // Planned sets not performed (partial skip) render as ⬜.
  const missing = exercise.targetSets - countedSets.length;
  if (missing > 0) squares += WHITE.repeat(missing);
  return squares;
}

function exerciseVolumeKg(exercise: ShareExercise): number {
  return exercise.sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
}

function exerciseLine(exercise: ShareExercise, cryptic: boolean): string {
  const label = cryptic ? muscleEmoji(exercise.primaryMuscle) : exercise.name;
  return `${buildSquares(exercise)}  ${label}${exercise.hasPR ? ` ${PR_SUFFIX}` : ''}`;
}

/**
 * If more than MAX_EXERCISE_ROWS exercises, keep the largest-volume rows in
 * performed order and collapse the rest into a single "+N more" line.
 */
function buildExerciseLines(exercises: ShareExercise[], cryptic: boolean): string[] {
  if (exercises.length <= MAX_EXERCISE_ROWS) {
    return exercises.map((e) => exerciseLine(e, cryptic));
  }

  const byVolumeDesc = exercises
    .map((exercise, index) => ({ exercise, index, volume: exerciseVolumeKg(exercise) }))
    .sort((a, b) => b.volume - a.volume);
  const keptIndices = new Set(byVolumeDesc.slice(0, ROWS_WHEN_COLLAPSED).map((e) => e.index));

  const lines = exercises
    .filter((_, index) => keptIndices.has(index))
    .map((e) => exerciseLine(e, cryptic));

  const collapsed = exercises.filter((_, index) => !keptIndices.has(index));
  const collapsedSquares = collapsed.map(buildSquares).join('');
  // Squares are multi-code-unit; slice by code points, not UTF-16 units.
  const squareChars = Array.from(collapsedSquares);
  const shownSquares =
    squareChars.length > MAX_COLLAPSE_SQUARES
      ? squareChars.slice(0, MAX_COLLAPSE_SQUARES).join('') + '…'
      : collapsedSquares;
  lines.push(`+${collapsed.length} more · ${shownSquares}`);
  return lines;
}

const KG_TO_LB = 2.20462;

function buildFooter(input: WorkoutShareTextInput): string {
  const performedSets = input.exercises.reduce((sum, e) => sum + e.sets.length, 0);
  const volumeKg = input.exercises.reduce((sum, e) => sum + exerciseVolumeKg(e), 0);
  const volume = input.unit === 'lb' ? volumeKg * KG_TO_LB : volumeKg;
  const volumeStr = Math.round(volume).toLocaleString('en-US');
  const minutes = Math.round(input.durationSeconds / 60);
  const prCount = input.exercises.filter((e) => e.hasPR).length;

  const parts = [
    `${performedSets} set${performedSets === 1 ? '' : 's'}`,
    `${volumeStr} ${input.unit}`,
    `${minutes} min`,
  ];
  if (prCount > 0) parts.push(`${PR_SUFFIX}${prCount} PR${prCount === 1 ? '' : 's'}`);
  if (input.streakWeeks && input.streakWeeks > 1) {
    parts.push(`📅 ${input.streakWeeks}-wk streak`);
  }
  return parts.join(' · ');
}

/**
 * Single source of truth for the share encoding. Deterministic: same input,
 * same output.
 */
export function formatWorkoutShareText(input: WorkoutShareTextInput): string {
  const lines: string[] = [`${APP_NAME} 💪 ${input.title}`];
  if (input.subtitle) lines.push(input.subtitle);
  lines.push('');
  lines.push(...buildExerciseLines(input.exercises, input.cryptic ?? false));
  lines.push('');
  lines.push(buildFooter(input));
  return lines.join('\n');
}
