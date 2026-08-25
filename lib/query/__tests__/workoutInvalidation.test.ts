import { QueryClient } from '@tanstack/react-query';
import {
  WORKOUT_DERIVED_QUERY_PREFIXES,
  invalidateWorkoutDerivedCaches,
} from '../workoutInvalidation';

/**
 * Finishing a workout is the only moment the derived caches can learn about the
 * new session, so these prefixes are contract, not housekeeping. The recovery
 * feed in particular: the live session is deliberately excluded from the
 * recovery model (see `RecoverySession` in services/muscleRecovery), so if
 * 'muscle-readiness-history' ever drops off this list, a just-finished workout
 * silently keeps reading as "not trained yet" until its staleTime expires.
 */
describe('invalidateWorkoutDerivedCaches', () => {
  function seed(client: QueryClient, key: unknown[]) {
    client.setQueryData(key, { seeded: true });
  }

  it('invalidates every workout-derived prefix, including the recovery history feed', async () => {
    expect(WORKOUT_DERIVED_QUERY_PREFIXES).toContain('muscle-readiness-history');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [
      ['history', 'u1', 0],
      ['analytics', 'u1'],
      ['log', 'u1'],
      ['muscle-readiness-history', 'u1', '2026-08-15T00:00:00.000Z'],
    ];
    keys.forEach((key) => seed(client, key));

    await invalidateWorkoutDerivedCaches(client);

    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('leaves unrelated caches alone', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client, ['nutrition', 'u1', '2026-08-22']);

    await invalidateWorkoutDerivedCaches(client);

    expect(client.getQueryState(['nutrition', 'u1', '2026-08-22'])?.isInvalidated).toBe(false);
  });
});
