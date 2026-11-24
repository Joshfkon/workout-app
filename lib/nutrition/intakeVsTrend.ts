/**
 * Plain-words explanation of the "kcal under goal" figure on Weight & trends,
 * and how logged intake relates to the weight trend the user actually sees.
 *
 * Panel finding (Priya, r19): "The 750 kcal under goal figure was also
 * unexplained, and it seems very large next to a slow 0.3 kg/week loss."
 *
 * What the numbers are (and are not):
 *   - "under goal" is AVERAGE LOGGED INTAKE minus the CALORIE GOAL. The goal
 *     for a cut already sits below the estimated burn, so this gap is not the
 *     deficit; it is on top of the planned one.
 *   - The deficit that should move the scale is logged intake vs the
 *     ESTIMATED BURN (the same "Your metabolism" number). That predicts a
 *     weekly change at ~7700 kcal per kg (3500 per lb, the constant the TDEE
 *     engine uses).
 *   - When the scale moves less than predicted, the usual reasons are food
 *     that isn't logged or a burn estimate that is still settling.
 *
 * Pure: no I/O, no clock.
 */

export const KCAL_PER_KG = 7700;
export const KCAL_PER_LB = 3500;

export interface IntakeVsTrendInput {
  /** Average logged kcal over the days that count (complete days). */
  avgIntakeKcal: number;
  /** How many days that average covers. */
  daysLogged: number;
  /** The calorie goal, if one is set. */
  goalKcal: number | null;
  /** Estimated daily burn (TDEE), if known. */
  burnKcal: number | null;
  /** True when the burn estimate is still settling (not yet 'stable'). */
  burnSettling: boolean;
  /** Observed weight trend, in `unit` per week (negative = losing). */
  observedPerWeek: number | null;
  unit: 'kg' | 'lb';
}

export interface IntakeVsTrendExplanation {
  /** "On the 12 days you logged, you averaged 1,120 kcal: 752 under your 1,872 kcal goal." */
  goalLine: string | null;
  /** "Against your estimated burn of 2,300 kcal a day, that is 1,180 kcal a day under, about −1.1 kg a week." */
  burnLine: string | null;
  /** How that compares with the weight trend, and the usual reasons for a gap. */
  trendLine: string | null;
  /** Expected change per week from intake vs burn, in `unit`. */
  expectedPerWeek: number | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

/** Gap between expected and observed rate (per week) worth explaining. */
export function rateGapThreshold(unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? 0.25 : 0.5;
}

/** Weekly weight change implied by a daily intake − burn balance. */
export function expectedWeeklyChange(dailyBalanceKcal: number, unit: 'kg' | 'lb'): number {
  return (dailyBalanceKcal * 7) / (unit === 'kg' ? KCAL_PER_KG : KCAL_PER_LB);
}

export function explainIntakeVsTrend(input: IntakeVsTrendInput): IntakeVsTrendExplanation {
  const { avgIntakeKcal, daysLogged, goalKcal, burnKcal, burnSettling, observedPerWeek, unit } = input;
  const days = `${daysLogged} day${daysLogged === 1 ? '' : 's'}`;

  let goalLine: string | null = null;
  if (goalKcal && goalKcal > 0) {
    const gap = Math.round(goalKcal - avgIntakeKcal);
    const where =
      Math.abs(gap) < 25
        ? `right at your ${fmt(goalKcal)} kcal goal`
        : `${fmt(Math.abs(gap))} ${gap > 0 ? 'under' : 'over'} your ${fmt(goalKcal)} kcal goal`;
    goalLine = `On the ${days} you logged, you averaged ${fmt(avgIntakeKcal)} kcal a day: ${where}.`;
    if (burnKcal && burnKcal > 0 && goalKcal < burnKcal && gap > 0) {
      goalLine += ' Your goal is already set below your burn, so that gap is on top of the planned deficit.';
    }
  }

  if (!burnKcal || burnKcal <= 0) {
    return { goalLine, burnLine: null, trendLine: null, expectedPerWeek: null };
  }

  const balance = avgIntakeKcal - burnKcal;
  const expected = expectedWeeklyChange(balance, unit);
  const balanceText =
    Math.abs(balance) < 25
      ? 'about even with it'
      : `${fmt(Math.abs(balance))} kcal a day ${balance < 0 ? 'under' : 'over'} it`;
  const burnLine =
    `Against your estimated burn of ${fmt(burnKcal)} kcal a day, your logged intake is ${balanceText}, ` +
    `which would mean about ${signed(expected)} ${unit} a week.`;

  let trendLine: string | null = null;
  if (observedPerWeek !== null && Number.isFinite(observedPerWeek)) {
    const observedText = `Your weight trend shows ${signed(observedPerWeek)} ${unit} a week`;
    const gap = observedPerWeek - expected;
    const threshold = rateGapThreshold(unit);
    const settlingNote = burnSettling
      ? ' Yours is still settling: it firms up after a few weeks of regular weigh-ins and full days of logging.'
      : '';
    if (Math.abs(gap) < threshold) {
      trendLine = `${observedText}, which matches.`;
    } else if (gap > 0) {
      // The scale is higher than predicted: less loss, or more gain.
      const what = expected < 0 && observedPerWeek < 0 ? 'a slower loss than that' : 'more on the scale than that predicts';
      trendLine =
        `${observedText}: ${what}. A gap like this usually means some food or drinks aren't getting logged, ` +
        `or the burn estimate is still settling.${settlingNote}`;
    } else {
      // The scale is lower than predicted: more loss, or less gain.
      const what = expected > 0 && observedPerWeek > 0 ? 'a slower gain than that' : 'less on the scale than that predicts';
      trendLine =
        `${observedText}: ${what}. A gap like this usually means the burn estimate is still settling ` +
        `(you may burn more than it says), or water weight is shifting.${settlingNote}`;
    }
  }

  return { goalLine, burnLine, trendLine, expectedPerWeek: expected };
}
