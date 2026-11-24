jest.mock('@/lib/supabase/client', () => ({ createUntypedClient: jest.fn() }));
import { isResumableSession, isStaleLeftover, type SessionResumeRow } from '@/lib/training/resumableSession';

const NOW = Date.parse('2026-11-24T18:00:00Z');
const HOUR = 3600e3;
const row = (o: Partial<SessionResumeRow>): SessionResumeRow => ({
  id: 's', state: 'in_progress', started_at: new Date(NOW - HOUR).toISOString(), mesocycle_id: null, exercise_blocks: [{ count: 3 }], ...o,
});

describe('isResumableSession', () => {
  it('an in-progress workout with exercises can be resumed', () => {
    expect(isResumableSession(row({}), NOW)).toBe(true);
  });
  it('a missing, finished or discarded workout cannot', () => {
    expect(isResumableSession(null, NOW)).toBe(false);
    expect(isResumableSession(row({ state: 'completed' }), NOW)).toBe(false);
    expect(isResumableSession(row({ state: 'auto_discarded' }), NOW)).toBe(false);
  });
  it('an empty ad-hoc leftover over 4 hours old cannot (the workout screen would archive it and go to Train)', () => {
    const leftover = row({ exercise_blocks: [{ count: 0 }], started_at: new Date(NOW - 6 * HOUR).toISOString() });
    expect(isResumableSession(leftover, NOW)).toBe(false);
    expect(isStaleLeftover(leftover, NOW)).toBe(true);
  });
  it('a fresh empty workout, or an empty programme session, still can', () => {
    expect(isResumableSession(row({ exercise_blocks: [{ count: 0 }] }), NOW)).toBe(true);
    const meso = row({ exercise_blocks: [{ count: 0 }], mesocycle_id: 'm', started_at: new Date(NOW - 6 * HOUR).toISOString() });
    expect(isResumableSession(meso, NOW)).toBe(true);
    expect(isStaleLeftover(meso, NOW)).toBe(false);
  });
});
