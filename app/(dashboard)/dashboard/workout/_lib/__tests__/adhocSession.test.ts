import { isStaleEmptyAdhocSession, STALE_ADHOC_AGE_MS } from '../adhocSession';

describe('isStaleEmptyAdhocSession — stale ad-hoc auto-discard guard (P0-1)', () => {
  const NOW = 1_700_000_000_000;
  const old = new Date(NOW - STALE_ADHOC_AGE_MS - 60_000).toISOString(); // 4h1m ago
  const fresh = new Date(NOW - 60_000).toISOString(); // 1m ago
  const base = { state: 'in_progress', mesocycleId: null as string | null, startedAt: old };

  it('fires only when ALL of: in_progress + ad-hoc + 0 blocks + 0 sets + >4h', () => {
    expect(isStaleEmptyAdhocSession(base, 0, 0, NOW)).toBe(true);
  });

  it('does NOT fire with any exercise blocks present', () => {
    expect(isStaleEmptyAdhocSession(base, 1, 0, NOW)).toBe(false);
  });

  it('does NOT fire with any logged sets present', () => {
    expect(isStaleEmptyAdhocSession(base, 0, 1, NOW)).toBe(false);
  });

  it('does NOT fire when younger than 4h', () => {
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: fresh }, 0, 0, NOW)).toBe(false);
  });

  it('does NOT fire for mesocycle (programmed) sessions', () => {
    expect(isStaleEmptyAdhocSession({ ...base, mesocycleId: 'meso-1' }, 0, 0, NOW)).toBe(false);
  });

  it.each(['planned', 'completed', 'skipped'])('does NOT fire when state is %s', (state) => {
    expect(isStaleEmptyAdhocSession({ ...base, state }, 0, 0, NOW)).toBe(false);
  });

  it('does NOT fire when startedAt is null (never started)', () => {
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: null }, 0, 0, NOW)).toBe(false);
  });

  it('boundary: exactly 4h old does NOT fire (strictly greater-than)', () => {
    const exactly = new Date(NOW - STALE_ADHOC_AGE_MS).toISOString();
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: exactly }, 0, 0, NOW)).toBe(false);
  });

  it('boundary: one ms past 4h fires', () => {
    const justPast = new Date(NOW - STALE_ADHOC_AGE_MS - 1).toISOString();
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: justPast }, 0, 0, NOW)).toBe(true);
  });
});
