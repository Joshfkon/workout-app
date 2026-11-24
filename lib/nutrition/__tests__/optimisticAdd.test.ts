import {
  buildPendingRows,
  dropPendingRows,
  isPendingFoodLogId,
  reconcileSavedRows,
  totalsWith,
} from '../optimisticAdd';
import type { FoodLogEntry } from '@/types/nutrition';

const row = (id: string, calories = 100, protein: number | null = 10): FoodLogEntry => ({
  id,
  user_id: 'u1',
  logged_at: '2026-11-24',
  meal_type: 'lunch',
  food_name: id,
  serving_size: '1 serving',
  servings: 1,
  calories,
  protein,
  carbs: 0,
  fat: 0,
  source: 'manual',
  food_id: null,
  nutritionix_id: null,
  created_at: '2026-11-24T12:00:00Z',
});

describe('optimistic food-log adds', () => {
  it('builds placeholder rows on the day, shaped like saved rows', () => {
    let n = 0;
    const [pending] = buildPendingRows(
      [{ food_name: 'Greek yogurt', serving_size: '170 g', servings: 1, calories: 100, protein: 17, carbs: 6, fat: 0, meal_type: 'lunch' }],
      { day: '2026-11-24', createdAt: 'x', nextId: () => String(++n) }
    );
    expect(isPendingFoodLogId(pending.id)).toBe(true);
    expect(pending).toMatchObject({ logged_at: '2026-11-24', meal_type: 'lunch', calories: 100, protein: 17, source: 'manual' });
  });

  it('swaps placeholders for saved rows in place', () => {
    const prev = [row('a'), row('pending-1'), row('b')];
    const out = reconcileSavedRows(prev, ['pending-1'], [row('real-1')]);
    expect(out.map((r) => r.id)).toEqual(['a', 'real-1', 'b']);
  });

  it('appends the saved rows if a refetch dropped the placeholders, never twice', () => {
    expect(reconcileSavedRows([row('a')], ['pending-1'], [row('real-1')]).map((r) => r.id)).toEqual(['a', 'real-1']);
    expect(
      reconcileSavedRows([row('a'), row('real-1')], ['pending-1'], [row('real-1')]).map((r) => r.id)
    ).toEqual(['a', 'real-1']);
  });

  it('drops placeholders after a failed save', () => {
    expect(dropPendingRows([row('a'), row('pending-1')], ['pending-1']).map((r) => r.id)).toEqual(['a']);
  });

  it('adds rows to the day totals (null protein counts as 0)', () => {
    expect(totalsWith({ calories: 500, protein: 40 }, [row('x', 100, null), row('y', 50, 5)])).toEqual({
      calories: 650,
      protein: 45,
    });
  });
});
