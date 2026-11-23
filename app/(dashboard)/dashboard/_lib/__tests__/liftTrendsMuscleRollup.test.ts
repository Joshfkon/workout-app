/**
 * "Strength by muscle" must follow from the same lifts the lift list shows.
 *
 * Reproduces the UX-panel contradiction: an advanced lifter on a body-part
 * split saw EZ Bar Curl "+X%/wk, Rising" in the lift list while the muscle
 * card said Biceps "+0%/wk · Behind pace". The card ran over its own fetch
 * at a hidden 30-day range: with one arm day a week, a plate jump six weeks
 * ago sits outside 30 days, so every lift read flat there and rising over
 * the list's 12 weeks.
 */
import {
  computeLiftTrends,
  muscleProgressionInputFromRollup,
  LIFT_TREND_WINDOW_DAYS,
  type LiftTrendSessionRow,
} from '../liftTrends';
import { getMuscleGroupProgression } from '@/services/progressionInsights';

const REF = new Date('2026-11-23T12:00:00');

const ezCurl = { id: 'ex-ez', name: 'EZ Bar Curl', primary_muscle: 'biceps' };
const inclineCurl = { id: 'ex-incline', name: 'Incline Dumbbell Curl', primary_muscle: 'biceps' };
const pushdown = { id: 'ex-pushdown', name: 'Tricep Pushdown', primary_muscle: 'triceps' };

function block(
  exercise: { id: string; name: string; primary_muscle: string },
  weightKg: number
): NonNullable<LiftTrendSessionRow['exercise_blocks']>[number] {
  return {
    exercises: exercise,
    set_logs: [
      { weight_kg: weightKg, reps: 14, rpe: 7.5, is_warmup: false },
      { weight_kg: weightKg, reps: 12, rpe: 8, is_warmup: false },
      { weight_kg: weightKg, reps: 11, rpe: 8.5, is_warmup: false },
    ],
  };
}

/** Twelve weekly arm days, oldest first, ending two days before REF. */
function armDays(): LiftTrendSessionRow[] {
  const rows: LiftTrendSessionRow[] = [];
  for (let w = 0; w < 12; w++) {
    const d = new Date(REF);
    d.setDate(d.getDate() - 2 - (11 - w) * 7);
    d.setHours(7, 0, 0, 0);
    // EZ curl moves up one plate step every four weeks; the others hold.
    const ez = 30 + 2.5 * Math.floor(w / 4);
    rows.push({
      id: `s${w}`,
      completed_at: d.toISOString(),
      exercise_blocks: [block(ezCurl, ez), block(inclineCurl, 12.5), block(pushdown, 30)],
    });
  }
  return rows;
}

function rollupFor(sessions: LiftTrendSessionRow[]) {
  const summary = computeLiftTrends(sessions, 'bulk', REF, { includeRollup: true });
  const rollup = summary.rollup!;
  const input = muscleProgressionInputFromRollup(rollup);
  const groups = getMuscleGroupProgression({
    snapshotsByExercise: input.snapshotsByExercise,
    muscleByExercise: input.muscleByExercise,
    discontinuitiesByExercise: input.discontinuitiesByExercise,
    experience: 'advanced',
    referenceDate: REF,
    goal: rollup.goal,
    programStartDate: rollup.programStartDate,
  });
  return { summary, input, groups };
}

describe('Strength by muscle rolls up the lift list', () => {
  it('gives biceps the rate of its own rising curl, not +0%/wk Behind pace', () => {
    const { summary, input, groups } = rollupFor(armDays());

    const ezTrend = summary.lifts.find((l) => l.exerciseId === 'ex-ez')!;
    expect(ezTrend.direction).toBe('rising');

    const biceps = groups.find((g) => g.muscleGroup === 'biceps')!;
    // The muscle's per-lift rows ARE the list's lifts, same rate.
    const ezInsight = biceps.insights.find((i) => i.exerciseId === 'ex-ez')!;
    expect(ezInsight.weeklyChangePct).toBe(ezTrend.weeklyChangePct);
    expect(input.exerciseNames.get('ex-ez')).toBe('EZ Bar Curl');

    // The rollup is the set-weighted average of those lifts (one rising, one
    // flat), so it sits between them and is clearly positive.
    expect(biceps.avgWeeklyChangePct).toBeGreaterThan(0);
    expect(biceps.avgWeeklyChangePct).toBeLessThanOrEqual(ezTrend.weeklyChangePct);
    expect(biceps.pace).not.toBe('behind');
    expect(['on_track', 'ahead']).toContain(biceps.pace);

    // A muscle whose lifts really are flat still says so.
    const triceps = groups.find((g) => g.muscleGroup === 'triceps')!;
    expect(triceps.avgWeeklyChangePct).toBe(0);
  });

  it('the old hidden 30-day window read the same curl as flat (the bug)', () => {
    const cutoff = new Date(REF);
    cutoff.setDate(cutoff.getDate() - 30);
    const last30 = armDays().filter((s) => new Date(s.completed_at!) >= cutoff);
    const { groups } = rollupFor(last30);
    const biceps = groups.find((g) => g.muscleGroup === 'biceps')!;
    expect(biceps.avgWeeklyChangePct).toBe(0);
    // ...while the list's window is twelve weeks.
    expect(LIFT_TREND_WINDOW_DAYS).toBe(84);
  });

  it('only carries the rollup when asked (home tile payload unchanged)', () => {
    expect(computeLiftTrends(armDays(), 'bulk', REF).rollup).toBeUndefined();
  });
});
