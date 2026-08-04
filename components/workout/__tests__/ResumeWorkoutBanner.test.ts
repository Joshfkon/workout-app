/**
 * Tests for the stale-empty-session predicate. It no longer gates a blocking
 * prompt — it only mutes the resume pill's "live" styling and copy.
 */

import { isStaleEmptySession, STALE_EMPTY_SESSION_MS } from '../ResumeWorkoutBanner';

describe('isStaleEmptySession', () => {
  const now = new Date('2026-07-11T12:00:00.000Z').getTime();

  it('is false when the session has logged sets, however old', () => {
    const started = new Date(now - 10 * 60 * 60 * 1000); // 10h ago
    expect(isStaleEmptySession(1, started, now)).toBe(false);
  });

  it('is false when there is no start time', () => {
    expect(isStaleEmptySession(0, null, now)).toBe(false);
  });

  it('is false for an empty session younger than the threshold', () => {
    const started = new Date(now - (STALE_EMPTY_SESSION_MS - 60_000)); // just under 4h
    expect(isStaleEmptySession(0, started, now)).toBe(false);
  });

  it('is true for an empty session older than the threshold', () => {
    const started = new Date(now - (STALE_EMPTY_SESSION_MS + 60_000)); // just over 4h
    expect(isStaleEmptySession(0, started, now)).toBe(true);
  });

  it('matches the wild repro shape (empty, opened well over 4h ago)', () => {
    const started = new Date(now - 5 * 60 * 60 * 1000); // 5h ago, zero sets
    expect(isStaleEmptySession(0, started, now)).toBe(true);
  });
});
