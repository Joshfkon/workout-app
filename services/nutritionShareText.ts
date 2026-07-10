/**
 * Wordle-style plain-text share encoding for the current day's nutrition.
 *
 * The Eat-tab sibling of services/workoutShareText.ts. Produces a compact,
 * emoji-encoded macro summary that survives pasting into iMessage/Slack/
 * anywhere without the app:
 *
 *   HyperTrack 🍽️ Thu Jul 10
 *   Bulk · Wk 1
 *
 *   🟩🟩🟩🟩🟩 Protein 212 / 200g ✅
 *   🟩🟩🟩🟩⬜ Carbs 310 / 380g
 *   🟩🟩🟩🟩🟩 Fat 88 / 85g ✅
 *   🟩🟩🟩🟩⬜ 2,940 / 3,100 kcal
 *
 *   4 meals · 95% to target
 *
 * Mid-window shares are graded against pace (see rule 6 in the feature spec):
 *
 *   HyperTrack 🍽️ Thu Jul 10
 *   Bulk · Wk 1
 *
 *   🟩🟩🟩⬜⬜ Protein 118 / 200g
 *   🟩🟩🟩⬜⬜ Carbs 190 / 380g
 *   🟩🟩🟩⬜⬜ Fat 44 / 85g
 *   🟩🟩🟩⬜⬜ 1,610 / 3,100 kcal
 *
 *   ⏱️ On pace · 52% at 2:15 PM
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

type Square = typeof GREEN | typeof YELLOW | typeof RED;

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
  /** Current mesocycle week for header line 2 (e.g. "Wk 1"). */
  phaseWeek?: number | null;
  /** Privacy mode: strip every absolute number (see rule 7). */
  noNumbers?: boolean;
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
  label: string;
  actual: number;
  target: number | null;
  color: Square;
  /** ✅ — hit ≥100% of target while inside its band. */
  hit: boolean;
}

function timeLabel(now: Date): string {
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dateLabel(now: Date): string {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'short' });
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${month} ${now.getDate()}`;
}

/**
 * Single source of truth for the nutrition share encoding. Deterministic:
 * same input, same output.
 */
export function formatNutritionShareText(
  dayLog: NutritionShareDayLog,
  targets: NutritionShareTargets,
  phase: PacingPhase | null,
  options: NutritionShareOptions
): string {
  const { now, window = DEFAULT_EATING_WINDOW, phaseWeek = null, noNumbers = false } = options;
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

  const macroDefs: { key: MacroRow['key']; label: string; actual: number; target: number | null }[] = [
    { key: 'protein', label: 'Protein', actual: totals.protein, target: targets.protein },
    { key: 'carbs', label: 'Carbs', actual: totals.carbs, target: targets.carbs },
    { key: 'fat', label: 'Fat', actual: totals.fat, target: targets.fat },
    { key: 'calories', label: 'Calories', actual: totals.calories, target: calorieTarget },
  ];

  const rows: MacroRow[] = macroDefs.map(({ key, label, actual, target }) => {
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
    return { key, label, actual, target, color, hit };
  });

  const lines: string[] = [`${APP_NAME} 🍽️ ${noNumbers ? now.toLocaleDateString('en-US', { weekday: 'short' }) : dateLabel(now)}`];

  if (phase) {
    // Week carries a digit, so drop it in no-numbers mode.
    lines.push(phaseWeek && !noNumbers ? `${capitalize(phase)} · Wk ${phaseWeek}` : capitalize(phase));
  }

  lines.push('');
  for (const row of rows) {
    const bar = buildBar(row.actual, row.target, row.color);
    if (noNumbers) {
      // Bars + macro names + ✅ only — no digits anywhere.
      const label = row.key === 'calories' ? 'Calories' : row.label;
      lines.push(`${bar} ${label}${row.hit ? ` ${HIT_SUFFIX}` : ''}`);
      continue;
    }
    if (row.key === 'calories') {
      const value =
        row.target != null
          ? `${Math.round(row.actual).toLocaleString('en-US')} / ${Math.round(row.target).toLocaleString('en-US')} kcal`
          : `${Math.round(row.actual).toLocaleString('en-US')} kcal`;
      lines.push(`${bar} ${value}${row.hit ? ` ${HIT_SUFFIX}` : ''}`);
    } else {
      const value =
        row.target != null
          ? `${row.label} ${Math.round(row.actual)} / ${Math.round(row.target)}g`
          : `${row.label} ${Math.round(row.actual)}g`;
      lines.push(`${bar} ${value}${row.hit ? ` ${HIT_SUFFIX}` : ''}`);
    }
  }

  lines.push('');
  lines.push(buildFooter({ rows, canPace, calorieRatio, mealsLogged, now, phase: gradingPhase, fraction, noNumbers }));

  return lines.join('\n');
}

interface FooterInput {
  rows: MacroRow[];
  canPace: boolean;
  calorieRatio: number;
  mealsLogged: number;
  now: Date;
  phase: PacingPhase;
  fraction: number;
  noNumbers: boolean;
}

/** ⏱️ On pace / 📈 Ahead / 📉 Behind from the calorie pace ratio. */
function paceStatus(calorieRatio: number, fraction: number): { emoji: string; word: string } {
  const ratio = fraction > 0 ? calorieRatio / fraction : 1;
  if (ratio > 1.15) return { emoji: '📈', word: 'Ahead' };
  if (ratio < 0.85) return { emoji: '📉', word: 'Behind' };
  return { emoji: '⏱️', word: 'On pace' };
}

function buildFooter(input: FooterInput): string {
  const { rows, canPace, calorieRatio, mealsLogged, now, fraction, noNumbers } = input;

  if (canPace) {
    const { emoji, word } = paceStatus(calorieRatio, fraction);
    if (noNumbers) {
      // Keep the pace word; the time carries digits, so drop it.
      return `${emoji} ${word}`;
    }
    const pct = Math.round(calorieRatio * 100);
    return `${emoji} ${word} · ${pct}% at ${timeLabel(now)}`;
  }

  // End-of-day footer.
  if (noNumbers) {
    const allGreen = rows.every((r) => r.color === GREEN);
    return allGreen ? 'on track' : 'in progress';
  }
  const mealWord = `${mealsLogged} meal${mealsLogged === 1 ? '' : 's'}`;
  const pct = Math.round(calorieRatio * 100);
  return `${mealWord} · ${pct}% to target`;
}
