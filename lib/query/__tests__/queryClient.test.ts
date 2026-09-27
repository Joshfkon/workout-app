import { shouldPersistQueryKey } from '../queryClient';

describe('shouldPersistQueryKey', () => {
  it('persists the readiness feed (setup picker works on a same-day offline relaunch)', () => {
    expect(shouldPersistQueryKey(['muscle-readiness-history', 'u1', '2026-09-20T00:00:00.000Z'])).toBe(true);
    expect(shouldPersistQueryKey(['muscle-readiness-history', 'u1', 'known', '2026-08-30T00:00:00.000Z'])).toBe(true);
  });

  it('persists the setup catalog and recent sessions via their prefixes', () => {
    expect(shouldPersistQueryKey(['exercises', 'setup-catalog'])).toBe(true);
    expect(shouldPersistQueryKey(['history', 'setup-recent', 'u1'])).toBe(true);
  });

  it('keeps unlisted keys memory-only', () => {
    expect(shouldPersistQueryKey(['mesocycle-plan', 'u1'])).toBe(false);
  });
});
