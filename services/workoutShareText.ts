/**
 * Wordle-style plain-text share encoding for finished workouts.
 *
 * Produces a compact, emoji-encoded summary that survives pasting into
 * iMessage/Slack/anywhere without the app:
 *
 *   HyperTrack 💪 Shoulders & Arms
 *   Jul 8
 *
 *   🟩🟩🟩🟨  Incline Press 🏆
 *   🟩🟩🟩⬜  Lateral Raise
 *   ⬛⬛⬛  Nordic Curl
 *
 *   18 sets · 21,340 lb · 58 min · 🏆 2 PRs
 *   🟩 hit · 🟨 grind
 *
 * Pure module: no DB calls, no side effects. All emoji are plain Unicode so
 * alignment survives proportional fonts (the layout must read well ragged —
 * no space-padding beyond simple separators). Training data only: never
 * include body weight, body composition, calories, or nutrition data.
 *
 * Square encoding is a single binary judgment per working set, using the same
 * band logic the rest of the app grades sets by:
 *   🟩 hit  — reps landed in range at (or easier than) the planned effort
 *   🟨 miss — reps fell under range, OR the set was harder than planned
 *             (reps in reserve below target). See `isSetHit`.
 */

import type { WeightUnit } from '@/types/schema';

export interface ShareSet {
  reps: number;
  weightKg: number;
  /** RPE recorded for the set (1–10). RIR = 10 − rpe; drives the hit/miss square. */
  rpe: number;
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
  /** Planned rep range [min, max] — a set under `min` reads as a miss. */
  targetRepRange: [number, number];
  /** Planned reps in reserve — a set below it (harder than planned) is a miss. */
  targetRir: number;
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
const WHITE = '⬜';
const BLACK = '⬛';
const AMRAP_SUFFIX = '⚡';
const PR_MARKER = '🏆';

/** One legend line, appended only when the grid contains a miss. */
const LEGEND = `${GREEN} hit · ${YELLOW} grind`;

const LEG_MUSCLES = ['quad', 'hamstring', 'glute', 'calf', 'calves', 'adductor', 'abductor', 'leg'];
const ARM_MUSCLES = ['bicep', 'tricep', 'forearm', 'arm'];

/** Cryptic-mode emoji for a raw primaryMuscle string. Defaults to 🏋️. */
export function muscleEmoji(primaryMuscle: string | undefined): string {
  const muscle = (primaryMuscle || '').toLowerCase();
  if (LEG_MUSCLES.some((m) => muscle.includes(m))) return '🦵';
  if (ARM_MUSCLES.some((m) => muscle.includes(m))) return '💪';
  return '🏋️';
}

/**
 * Binary square judgment for one working set — the same band logic the live
 * app uses to grade a set (see `progressionEngine.calculateSetQuality`):
 *   🟩 hit  ← reps ≥ range min AND reps-in-reserve ≥ target (effort as planned
 *             or easier)
 *   🟨 miss ← reps under range, OR RIR below target (the set was harder than
 *             planned)
 * AMRAP sets are graded on reps alone: maximal effort *is* the plan there, so a
 * low RIR is success, not a grind.
 */
export function isSetHit(set: ShareSet, targetRepMin: number, targetRir: number): boolean {
  if (set.reps < targetRepMin) return false;
  if (set.isAmrap) return true;
  const rir = 10 - set.rpe;
  return rir >= targetRir;
}

/** Squares row for one exercise (no name). */
function buildSquares(exercise: ShareExercise): string {
  if (exercise.skipped || exercise.sets.length === 0) {
    return BLACK.repeat(Math.max(1, Math.min(MAX_SKIPPED_SQUARES, exercise.targetSets)));
  }
  const [targetRepMin] = exercise.targetRepRange;
  const countedSets = exercise.sets.filter((s) => !s.isDropset);
  let squares = countedSets
    .map(
      (s) =>
        (isSetHit(s, targetRepMin, exercise.targetRir) ? GREEN : YELLOW) +
        (s.isAmrap ? AMRAP_SUFFIX : '')
    )
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
  return `${buildSquares(exercise)}  ${label}${exercise.hasPR ? ` ${PR_MARKER}` : ''}`;
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

/**
 * Minute-granular duration for the compact footer: "58 min" under an hour,
 * "2h 57m" (or "3h" on the hour) at or above it, so a long session never
 * reads as "177 min".
 */
function formatFooterDuration(durationSeconds: number): string {
  const minutes = Math.max(0, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

function buildFooter(input: WorkoutShareTextInput): string {
  const performedSets = input.exercises.reduce((sum, e) => sum + e.sets.length, 0);
  const volumeKg = input.exercises.reduce((sum, e) => sum + exerciseVolumeKg(e), 0);
  const volume = input.unit === 'lb' ? volumeKg * KG_TO_LB : volumeKg;
  const volumeStr = Math.round(volume).toLocaleString('en-US');
  const prCount = input.exercises.filter((e) => e.hasPR).length;

  const parts = [
    `${performedSets} set${performedSets === 1 ? '' : 's'}`,
    `${volumeStr} ${input.unit}`,
    formatFooterDuration(input.durationSeconds),
  ];
  if (prCount > 0) parts.push(`${PR_MARKER} ${prCount} PR${prCount === 1 ? '' : 's'}`);
  if (input.streakWeeks && input.streakWeeks > 1) {
    parts.push(`📅 ${input.streakWeeks}-wk streak`);
  }
  return parts.join(' · ');
}

/** Every glyph counted as two width units by `shareLineWidth`. */
const WIDE_GLYPHS = [GREEN, YELLOW, WHITE, BLACK, AMRAP_SUFFIX, PR_MARKER, '💪', '🏋️', '🦵', '📅'];

/**
 * Emoji-aware rendered width of one line: each emoji square / pictograph counts
 * as 2 units, every other code point as 1 — mirroring how an iMessage bubble at
 * default text size fills. This is the share v2 line-width rule (shared in
 * spirit with the nutrition share); the guardrail keeps the emoji square grid
 * inside one bubble line so it never wraps mid-row.
 */
export function shareLineWidth(line: string): number {
  let rest = line;
  let width = 0;
  for (const glyph of WIDE_GLYPHS) {
    const parts = rest.split(glyph);
    width += (parts.length - 1) * 2;
    rest = parts.join('');
  }
  // Everything left is latin / digits / punctuation / spaces — 1 unit each.
  width += Array.from(rest).length;
  return width;
}

/**
 * Single source of truth for the share encoding. Deterministic: same input,
 * same output.
 */
export function formatWorkoutShareText(input: WorkoutShareTextInput): string {
  const exerciseLines = buildExerciseLines(input.exercises, input.cryptic ?? false);

  const lines: string[] = [`${APP_NAME} 💪 ${input.title}`];
  if (input.subtitle) lines.push(input.subtitle);
  lines.push('');
  lines.push(...exerciseLines);
  lines.push('');
  lines.push(buildFooter(input));
  // The legend answers "why yellow?" — shown only when a miss exists, so an
  // all-green share stays tight.
  if (exerciseLines.some((line) => line.includes(YELLOW))) {
    lines.push(LEGEND);
  }
  return lines.join('\n');
}
