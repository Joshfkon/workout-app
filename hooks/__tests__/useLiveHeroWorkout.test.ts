import { reconcileHeroWorkout } from '@/hooks/useLiveHeroWorkout';
import type { TodaysWorkout } from '@/components/dashboard/home/TodayHeroCard';

const hero: TodaysWorkout = { id: 's1', name: 'Today', state: 'in_progress', exercises: 1, completedSets: 2, totalSets: 4 };

describe('reconcileHeroWorkout', () => {
  it('keeps the hero while the live state is unknown or unchanged', () => {
    expect(reconcileHeroWorkout(hero, undefined)).toBe(hero);
    expect(reconcileHeroWorkout(hero, { found: true, state: 'in_progress' })).toBe(hero);
    expect(reconcileHeroWorkout(null, { found: false })).toBeNull();
  });

  it('drops a discarded ad-hoc workout (row deleted)', () => {
    expect(reconcileHeroWorkout(hero, { found: false })).toBeNull();
  });

  it('shows a discarded programme workout as planned with no sets', () => {
    expect(reconcileHeroWorkout(hero, { found: true, state: 'planned' })).toEqual({ ...hero, state: 'planned', completedSets: 0 });
  });

  it('follows a workout finished elsewhere, and drops any other state', () => {
    expect(reconcileHeroWorkout(hero, { found: true, state: 'completed' })?.state).toBe('completed');
    expect(reconcileHeroWorkout(hero, { found: true, state: 'skipped' })).toBeNull();
  });
});
