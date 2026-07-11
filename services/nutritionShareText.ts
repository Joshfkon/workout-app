/**
 * Wordle-style plain-text share encoding for the current day's nutrition.
 *
 * The Eat-tab sibling of services/workoutShareText.ts. Produces a compact,
 * emoji-encoded macro summary that survives pasting into iMessage/Slack/
 * anywhere without the app. Three rendering modes share ONE set of computed
 * band/pace/phase statuses — only the layout differs:
 *
 *   full     — the full macro grid (protein/carbs/fat/kcal) with targets:
 *
 *     HyperTrack 🍽️ Jul 10 · Bulk
 *
 *     🟩🟩🟩🟩🟩 Protein 175/155g✅
 *     🟩🟩🟩🟩⬜ Carbs 280/345g
 *     🟨🟨🟨🟨🟨 Fat 74/62g
 *     🟩🟩🟩🟩🟩 2,477 kcal
 *
 *     4 meals · 97% to target
 *
 *   compact  — one line per row, single-letter labels, no target values:
 *
 *     HyperTrack 🍽️ Jul 10 · Bulk
 *     🟩🟩🟩🟩🟩 P 175g✅
 *     🟩🟩🟩🟩⬜ C 280g
 *     🟨🟨🟨🟨🟨 F 74g
 *     🟩🟩🟩🟩🟩 2,477 kcal
 *     97% to target
 *
 *   minimal  — calories + protein only, one status square each:
 *
 *     HyperTrack 🍽️ Jul 10 · Bulk
 *     🟩 2,477 kcal · 97%
 *     🟩 175g protein✅
 *
 * Mid-window shares are graded against pace, not the full-day target (being at
 * 50% of calories at 2 PM is on pace). The pace marker rides the footer in
 * full/compact and the calorie line in minimal.
 *
 * Line width: every line must fit an iMessage bubble at iOS default text size.
 * `shareLineWidth` (emoji = 2 units, latin char = 1) makes that testable; the
 * design budget for the value rows is ~24 units (≈ 5 squares + 14 latin), with
 * the branded header the widest allowed element.
 *
 * Pure module: no DB calls, no side effects. All emoji are plain Unicode so
 * alignment survives proportional fonts. Nutrition data only — the mirror
 * image of the workout share's exclusion rule: never include body weight,
 * body composition, TDEE estimates, or any workout data.
 *
 * `now` is ALWAYS passed in (never read from the clock here) so the output is
 * deterministic and unit-testable. It is interpreted in local time — the same
 * convention as services/intakePacing.ts.
 */

import {
  DEFAULT_EATING_WINDOW,
  eatingWindowFraction,
  type EatingWindow,
  type PacingPhase,
} from '@/services/intakePacing';

const APP_NAME = 'HyperTrack';

const GREEN = '🟩';
const YELLOW = '🟨';
const RED = '🟥';
const WHITE = '⬜';
const HIT_SUFFIX = '✅';

const BAR_SEGMENTS = 5;

/** A macro target hit ≥95% of calories (or window closed) reads as done. */
const END_OF_DAY_CALORIE_FRACTION = 0.95;

/**
 * Emoji-aware width budget for an optional header suffix (the " · Wk N"
 * fragment): only appended when the header still fits an iMessage bubble.
 */
const HEADER_WIDTH_BUDGET = 30;

type Square = typeof GREEN | typeof YELLOW | typeof RED;

/** The three share layouts. All share the same band/pace/phase computation. */
export type NutritionShareMode = 'full' | 'compact' | 'minimal';

/** Every glyph counted as two width units by `shareLineWidth`. */
const WIDE_GLYPHS = [GREEN, YELLOW, RED, WHITE, '🍽️', HIT_SUFFIX, '⏱️', '📈', '📉'];

/**
 * Emoji-aware rendered width of one line: each emoji square / pictograph
 * counts as 2 units, every other code point as 1. Mirrors how an iMessage
 * bubble at default text size fills — the basis for the line-width guardrail.
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

/** Totals consumed so far today. Same shape as DailyMacroTotals. */
export interface NutritionShareTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Daily gram/calorie targets. Null when a macro has no target set. */
export interface NutritionShareTargets {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface NutritionShareDayLog {
  totals: NutritionShareTotals;
  /** Distinct eating occasions logged today (meal buckets with ≥1 entry). */
  mealsLogged: number;
}

export interface NutritionShareOptions {
  /** Wall-clock reference for the header date, pacing, and footer time. */
  now: Date;
  /** Eating window driving intraday pacing. Defaults to 07:00–21:00. */
  window?: EatingWindow;
  /** Current mesocycle week for the header (e.g. "Wk 1"), when it fits. */
  phaseWeek?: number | null;
  /** Privacy mode: strip every absolute number (see rule 7). */
  noNumbers?: boolean;
  /** Layout. Defaults to 'full'. */
  mode?: NutritionShareMode;
}

/** Which side of the target works against the phase goal. */
interface HarmDirection {
  under: boolean;
  over: boolean;
}

/** Local minutes-from-midnight (matches intakePacing's convention). */
function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

function capitalize(phase: PacingPhase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

/**
 * Band grading against the full-day target, phase-aware. `pct` is the
 * rounded integer percent of target consumed. Within the green band always
 * passes; beyond it, only the direction that works against the phase goal is
 * downgraded (the harmless direction stays green).
 */
function bandColor(
  pct: number,
  greenLimit: number,
  yellowLimit: number,
  harm: HarmDirection
): Square {
  const dev = pct - 100;
  if (Math.abs(dev) <= greenLimit) return GREEN;
  const harmful = dev < 0 ? harm.under : harm.over;
  if (!harmful) return GREEN;
  return Math.abs(dev) <= yellowLimit ? YELLOW : RED;
}

/** Calorie harm direction: bulk fears under, cut fears over, maint both. */
function calorieHarm(phase: PacingPhase): HarmDirection {
  return {
    under: phase === 'bulk' || phase === 'maintenance',
    over: phase === 'cut' || phase === 'maintenance',
  };
}

/**
 * Full-day (end-of-day) square color for one macro.
 * - Protein: ≥95% of target → green regardless of overage.
 * - Carbs/fat: ±15% green (flexible levers); under is harmless, over warns.
 * - Calories: ±5% green, ±10% yellow, beyond red — phase-aware direction.
 */
function fullDayColor(
  macro: 'protein' | 'carbs' | 'fat' | 'calories',
  pct: number,
  phase: PacingPhase
): Square {
  if (macro === 'protein') {
    if (pct >= 95) return GREEN;
    return pct >= 85 ? YELLOW : RED;
  }
  if (macro === 'carbs' || macro === 'fat') {
    return bandColor(pct, 15, 30, { under: false, over: true });
  }
  return bandColor(pct, 5, 10, calorieHarm(phase));
}

/**
 * Midday square color graded against PACE, not the full-day target — being at
 * 50% of calories at 2 PM is on pace, i.e. green. `paceRatio` is
 * (consumed/target) / expectedFraction.
 * - Protein gets a wider, soft check: behind only warns below 0.7 (rule 6),
 *   since protein is commonly back-loaded into dinner.
 * - Calories/carbs/fat: on pace within 0.85–1.15; beyond, only the phase's
 *   warning direction downgrades.
 */
function paceColor(
  macro: 'protein' | 'carbs' | 'fat' | 'calories',
  paceRatio: number,
  phase: PacingPhase
): Square {
  if (macro === 'protein') {
    if (paceRatio >= 0.7) return GREEN;
    return paceRatio >= 0.5 ? YELLOW : RED;
  }
  if (paceRatio >= 0.85 && paceRatio <= 1.15) return GREEN;
  const behind = paceRatio < 1;
  const harm = calorieHarm(phase);
  const harmful = behind ? harm.under : harm.over;
  if (!harmful) return GREEN;
  const far = paceRatio < 0.6 || paceRatio > 1.4;
  return far ? RED : YELLOW;
}

/** `round(min(actual/target, 1) * 5)` filled squares in `color`, rest ⬜. */
function buildBar(actual: number, target: number | null, color: Square): string {
  if (!target || target <= 0) return WHITE.repeat(BAR_SEGMENTS);
  const filled = Math.round(Math.min(actual / target, 1) * BAR_SEGMENTS);
  return color.repeat(filled) + WHITE.repeat(BAR_SEGMENTS - filled);
}

/** Rounded integer percent of target, or 0 when there is no target. */
function pctOf(actual: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  return Math.round((actual / target) * 100);
}

interface MacroRow {
  key: 'protein' | 'carbs' | 'fat' | 'calories';
  /** Full label ("Protein") for full mode. */
  label: string;
  /** Single-letter label ("P") for compact mode. */
  letter: string;
  actual: number;
  target: number | null;
  color: Square;
  /** ✅ — hit ≥100% of target while inside its band. */
  hit: boolean;
}

function timeLabel(now: Date): string {
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "Jul 10" — month + day, no weekday (weekday drops for line width). */
function monthDayLabel(now: Date): string {
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${now.getDate()}`;
}

/** "Fri" — weekday only, the digit-free header date for no-numbers mode. */
function weekdayLabel(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'short' });
}

function roundedLocale(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * The one-line header, shared by every mode:
 *   HyperTrack 🍽️ Jul 10 · Bulk
 * The weekday is dropped for width; the phase week is appended only when the
 * line still fits an iMessage bubble (it usually doesn't, given the brand).
 * No-numbers mode swaps the date for the digit-free weekday.
 */
function buildHeader(
  now: Date,
  phase: PacingPhase | null,
  phaseWeek: number | null,
  noNumbers: boolean
): string {
  const datePart = noNumbers ? weekdayLabel(now) : monthDayLabel(now);
  let header = `${APP_NAME} 🍽️ ${datePart}`;
  if (phase) {
    header += ` · ${capitalize(phase)}`;
    // Week carries a digit (dropped in no-numbers) and only rides along when
    // the header still fits — the phase word alone is enough otherwise.
    if (phaseWeek && !noNumbers) {
      const withWeek = `${header} · Wk ${phaseWeek}`;
      if (shareLineWidth(withWeek) <= HEADER_WIDTH_BUDGET) header = withWeek;
    }
  }
  return header;
}

interface ShareContext {
  rows: MacroRow[];
  byKey: Record<MacroRow['key'], MacroRow>;
  header: string;
  canPace: boolean;
  calorieRatio: number;
  mealsLogged: number;
  now: Date;
  fraction: number;
  noNumbers: boolean;
}

/**
 * Single source of truth for the nutrition share encoding. Deterministic:
 * same input, same output. Band statuses, the pace ratio, and phase logic are
 * computed ONCE here; `mode` only changes how they render.
 */
export function formatNutritionShareText(
  dayLog: NutritionShareDayLog,
  targets: NutritionShareTargets,
  phase: PacingPhase | null,
  options: NutritionShareOptions
): string {
  const {
    now,
    window = DEFAULT_EATING_WINDOW,
    phaseWeek = null,
    noNumbers = false,
    mode = 'full',
  } = options;
  const { totals, mealsLogged } = dayLog;

  const calorieTarget = targets.calories;
  const calorieRatio = calorieTarget && calorieTarget > 0 ? totals.calories / calorieTarget : 0;

  // End-of-day once the window has closed OR the day is effectively complete
  // (≥95% of calories). Without a calorie target there's no pace to grade, so
  // fall back to full-day band rules.
  const windowClosed = minutesOfDay(now) >= window.endMinutes;
  const isEndOfDay =
    windowClosed || !calorieTarget || calorieRatio >= END_OF_DAY_CALORIE_FRACTION;

  const fraction = eatingWindowFraction(now, window);
  // Before/at the very start of the window pace is undefined — grade neutral.
  const canPace = !isEndOfDay && fraction > 0;

  const gradingPhase: PacingPhase = phase ?? 'maintenance';

  const macroDefs: {
    key: MacroRow['key'];
    label: string;
    letter: string;
    actual: number;
    target: number | null;
  }[] = [
    { key: 'protein', label: 'Protein', letter: 'P', actual: totals.protein, target: targets.protein },
    { key: 'carbs', label: 'Carbs', letter: 'C', actual: totals.carbs, target: targets.carbs },
    { key: 'fat', label: 'Fat', letter: 'F', actual: totals.fat, target: targets.fat },
    { key: 'calories', label: 'Calories', letter: 'kcal', actual: totals.calories, target: calorieTarget },
  ];

  const rows: MacroRow[] = macroDefs.map(({ key, label, letter, actual, target }) => {
    let color: Square;
    if (!target || target <= 0) {
      color = GREEN;
    } else if (canPace) {
      const paceRatio = actual / target / fraction;
      color = paceColor(key, paceRatio, gradingPhase);
    } else {
      color = fullDayColor(key, pctOf(actual, target), gradingPhase);
    }
    const hit = !!target && target > 0 && actual >= target && color === GREEN;
    return { key, label, letter, actual, target, color, hit };
  });

  const byKey = rows.reduce(
    (acc, row) => ({ ...acc, [row.key]: row }),
    {} as Record<MacroRow['key'], MacroRow>
  );

  const ctx: ShareContext = {
    rows,
    byKey,
    header: buildHeader(now, phase, phaseWeek, noNumbers),
    canPace,
    calorieRatio,
    mealsLogged,
    now,
    fraction,
    noNumbers,
  };

  switch (mode) {
    case 'minimal':
      return renderMinimal(ctx).join('\n');
    case 'compact':
      return renderCompact(ctx).join('\n');
    case 'full':
    default:
      return renderFull(ctx).join('\n');
  }
}

/** ✅ tacked directly onto the preceding token (no space), when hit. */
function hitTag(hit: boolean): string {
  return hit ? HIT_SUFFIX : '';
}

/** Full macro-grid rendering (protein/carbs/fat/kcal with targets). */
function renderFull(ctx: ShareContext): string[] {
  const { rows, noNumbers } = ctx;
  const lines: string[] = [ctx.header, ''];

  for (const row of rows) {
    const bar = buildBar(row.actual, row.target, row.color);
    if (noNumbers) {
      lines.push(`${bar} ${row.label}${hitTag(row.hit)}`);
      continue;
    }
    if (row.key === 'calories') {
      // Target lives in the footer %, so the kcal row carries the count only.
      lines.push(`${bar} ${roundedLocale(row.actual)} kcal${hitTag(row.hit)}`);
    } else {
      const value =
        row.target != null
          ? `${row.label} ${Math.round(row.actual)}/${Math.round(row.target)}g`
          : `${row.label} ${Math.round(row.actual)}g`;
      lines.push(`${bar} ${value}${hitTag(row.hit)}`);
    }
  }

  lines.push('');
  lines.push(buildGridFooter(ctx, true));
  return lines;
}

/** Compact rendering: single-letter labels, no target values, no blank lines. */
function renderCompact(ctx: ShareContext): string[] {
  const { rows, noNumbers } = ctx;
  const lines: string[] = [ctx.header];

  for (const row of rows) {
    const bar = buildBar(row.actual, row.target, row.color);
    if (noNumbers) {
      const label = row.key === 'calories' ? 'kcal' : row.letter;
      lines.push(`${bar} ${label}${hitTag(row.hit)}`);
      continue;
    }
    if (row.key === 'calories') {
      lines.push(`${bar} ${roundedLocale(row.actual)} kcal${hitTag(row.hit)}`);
    } else {
      lines.push(`${bar} ${row.letter} ${Math.round(row.actual)}g${hitTag(row.hit)}`);
    }
  }

  lines.push(buildGridFooter(ctx, false));
  return lines;
}

/** Minimal rendering: calories + protein only, one status square each. */
function renderMinimal(ctx: ShareContext): string[] {
  const { byKey, canPace, calorieRatio, fraction, noNumbers } = ctx;
  const cal = byKey.calories;
  const protein = byKey.protein;

  let calorieLine: string;
  if (noNumbers) {
    const word = canPace
      ? paceStatus(calorieRatio, fraction).word.toLowerCase()
      : cal.color === GREEN
        ? 'on track'
        : 'in progress';
    calorieLine = `${cal.color} kcal ${word}`;
  } else if (canPace) {
    const { emoji, word } = paceStatus(calorieRatio, fraction);
    calorieLine = `${cal.color} ${roundedLocale(cal.actual)} kcal · ${emoji} ${word.toLowerCase()}`;
  } else {
    const pct = Math.round(calorieRatio * 100);
    calorieLine = `${cal.color} ${roundedLocale(cal.actual)} kcal · ${pct}%`;
  }

  const proteinLine = noNumbers
    ? `${protein.color} protein${hitTag(protein.hit)}`
    : `${protein.color} ${Math.round(protein.actual)}g protein${hitTag(protein.hit)}`;

  return [ctx.header, calorieLine, proteinLine];
}

/** ⏱️ On pace / 📈 Ahead / 📉 Behind from the calorie pace ratio. */
function paceStatus(calorieRatio: number, fraction: number): { emoji: string; word: string } {
  const ratio = fraction > 0 ? calorieRatio / fraction : 1;
  if (ratio > 1.15) return { emoji: '📈', word: 'Ahead' };
  if (ratio < 0.85) return { emoji: '📉', word: 'Behind' };
  return { emoji: '⏱️', word: 'On pace' };
}

/**
 * Footer for the full/compact grids. `withMeals` prepends the meal count
 * (full only — compact drops it). Midday shows the pace marker; end-of-day
 * shows percent-to-target; no-numbers keeps the words, drops the digits.
 */
function buildGridFooter(ctx: ShareContext, withMeals: boolean): string {
  const { rows, canPace, calorieRatio, mealsLogged, now, fraction, noNumbers } = ctx;

  if (canPace) {
    const { emoji, word } = paceStatus(calorieRatio, fraction);
    if (noNumbers) return `${emoji} ${word}`;
    const pct = Math.round(calorieRatio * 100);
    return `${emoji} ${word} · ${pct}% at ${timeLabel(now)}`;
  }

  if (noNumbers) {
    const allGreen = rows.every((r) => r.color === GREEN);
    return allGreen ? 'on track' : 'in progress';
  }

  const pct = Math.round(calorieRatio * 100);
  if (!withMeals) return `${pct}% to target`;
  const mealWord = `${mealsLogged} meal${mealsLogged === 1 ? '' : 's'}`;
  return `${mealWord} · ${pct}% to target`;
}
