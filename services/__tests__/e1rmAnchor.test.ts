import { bestQualifyingE1RM } from '../suggestionEngine/e1rmAnchor';
import {
  ANCHOR_QUALIFYING_SESSIONS,
  ANCHOR_MAX_AGE_DAYS,
} from '../suggestionEngine/constants';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-20T10:00:00Z');

describe('bestQualifyingE1RM (best qualifying set in the recent-session window)', () => {
  it('returns the max across candidates of recent sessions — no decay applied', () => {
    expect(
      bestQualifyingE1RM([
        { e1rmKg: 140, sessionId: 's1', timeMs: NOW - 9 * DAY },
        { e1rmKg: 136, sessionId: 's2', timeMs: NOW },
      ])
    ).toBe(140);
  });

  it('is calendar-independent: only session times matter, never "today"', () => {
    // The old decayed max slid downward as days passed and re-scaled when a
    // session was added. The new aggregation has no wall-clock reference.
    const history = [
      { e1rmKg: 150, sessionId: 'a', timeMs: NOW - 30 * DAY },
      { e1rmKg: 145, sessionId: 'b', timeMs: NOW - 20 * DAY },
    ];
    expect(bestQualifyingE1RM(history)).toBe(150);
  });

  it('excludes sessions older than ANCHOR_MAX_AGE_DAYS relative to the NEWEST session', () => {
    const stale = {
      e1rmKg: 200,
      sessionId: 'peak',
      timeMs: NOW - (ANCHOR_MAX_AGE_DAYS + 10) * DAY,
    };
    const recent = { e1rmKg: 140, sessionId: 'recent', timeMs: NOW };
    expect(bestQualifyingE1RM([stale, recent])).toBe(140);
    // Alone (a layoff comeback's only session IS the newest), the same old
    // session anchors itself — the guard is relative, never absolute.
    expect(bestQualifyingE1RM([stale])).toBe(200);
  });

  it('keeps only the newest ANCHOR_QUALIFYING_SESSIONS sessions', () => {
    // One candidate per session, newest first; values INCREASE with age so
    // the biggest values sit in the sessions that must be dropped.
    const candidates = Array.from(
      { length: ANCHOR_QUALIFYING_SESSIONS + 2 },
      (_, i) => ({
        e1rmKg: 100 + i * 10,
        sessionId: `s${i}`,
        timeMs: NOW - i * 3 * DAY,
      })
    );
    const keptMax = Math.max(
      ...candidates.slice(0, ANCHOR_QUALIFYING_SESSIONS).map((c) => c.e1rmKg)
    );
    expect(bestQualifyingE1RM(candidates)).toBe(keptMax);
    // The dropped (older, bigger) sessions must not have won.
    expect(bestQualifyingE1RM(candidates)).toBeLessThan(
      Math.max(...candidates.map((c) => c.e1rmKg))
    );
  });

  it('counts the window in SESSIONS, not sets', () => {
    // Many sets in one session consume ONE window slot.
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => ({
        e1rmKg: 120 + i,
        sessionId: 'big-session',
        timeMs: NOW,
      })),
      { e1rmKg: 140, sessionId: 'older', timeMs: NOW - 10 * DAY },
    ];
    expect(bestQualifyingE1RM(candidates)).toBe(140);
  });

  it('returns 0 when no candidate qualifies (callers treat as "no anchor")', () => {
    expect(bestQualifyingE1RM([])).toBe(0);
    expect(bestQualifyingE1RM([{ e1rmKg: 0, sessionId: 's', timeMs: NOW }])).toBe(0);
    expect(bestQualifyingE1RM([{ e1rmKg: -5, sessionId: 's', timeMs: NOW }])).toBe(0);
  });

  it('treats non-finite times as newest (no age)', () => {
    expect(
      bestQualifyingE1RM([
        { e1rmKg: 100, sessionId: 's1', timeMs: NaN },
        { e1rmKg: 90, sessionId: 's2', timeMs: NOW },
      ])
    ).toBe(100);
  });
});
