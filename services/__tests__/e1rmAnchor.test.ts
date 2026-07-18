import { decayedE1RMMax } from '../suggestionEngine/e1rmAnchor';
import { E1RM_RECENCY_TAU_DAYS } from '../suggestionEngine/constants';

/**
 * Fix 3 (audit failure mode #3): the e1RM anchor decays candidates by
 * CALENDAR AGE (exp(-age/tau), tau = 45 days), age relative to the newest
 * candidate, before taking the max — so a stale peak fades instead of
 * prescribing today's targets, while fresh data keeps full weight.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-17T10:00:00Z');

describe('decayedE1RMMax', () => {
  it('tau is the documented named constant', () => {
    expect(E1RM_RECENCY_TAU_DAYS).toBe(45);
  });

  it('a 10-month-old peak loses to a recent cluster 15% lower', () => {
    const entries = [
      { e1rmKg: 160, timeMs: NOW - 300 * DAY }, // stale pre-cut peak
      { e1rmKg: 136, timeMs: NOW - 7 * DAY },
      { e1rmKg: 134, timeMs: NOW - 3 * DAY },
      { e1rmKg: 136, timeMs: NOW }, // newest — full weight
    ];
    // Anchor tracks the recent cluster: the decayed peak is worth
    // 160 * e^(-300/45) ≈ 0.2 kg in the comparison.
    expect(decayedE1RMMax(entries)).toBeCloseTo(136, 5);
  });

  it('a 30-day-old peak keeps ~51% of its influence', () => {
    const peak = { e1rmKg: 100, timeMs: NOW - 30 * DAY };
    const factor = Math.exp(-30 / E1RM_RECENCY_TAU_DAYS);
    expect(factor).toBeGreaterThan(0.5);
    // Recent value below the decayed peak → the decayed peak still leads...
    expect(decayedE1RMMax([peak, { e1rmKg: 49, timeMs: NOW }])).toBeCloseTo(100 * factor, 5);
    // ...but a recent value above it wins outright.
    expect(decayedE1RMMax([peak, { e1rmKg: 55, timeMs: NOW }])).toBe(55);
  });

  it('the newest candidate always keeps full weight (no deflation of fresh data)', () => {
    // Actively-trained exercise whose best e1RM IS the newest session: the
    // anchor is exactly the raw value — the no-regression guarantee.
    const entries = [
      { e1rmKg: 138, timeMs: NOW - 4 * DAY },
      { e1rmKg: 141.18, timeMs: NOW },
    ];
    expect(decayedE1RMMax(entries)).toBe(141.18);
  });

  it('a layoff history is rebased to its own newest session, not the wall clock', () => {
    // All sessions months old (returning lifter): the newest of them carries
    // weight 1, so the anchor is that session's raw e1RM — not near-zero.
    const entries = [
      { e1rmKg: 120, timeMs: NOW - 200 * DAY },
      { e1rmKg: 118, timeMs: NOW - 210 * DAY },
    ];
    expect(decayedE1RMMax(entries)).toBe(120);
  });

  it('entries with invalid dates are treated as fresh; empty input returns 0', () => {
    expect(decayedE1RMMax([])).toBe(0);
    expect(decayedE1RMMax([{ e1rmKg: 100, timeMs: NaN }])).toBe(100);
    expect(
      decayedE1RMMax([
        { e1rmKg: 100, timeMs: NaN },
        { e1rmKg: 90, timeMs: NOW },
      ])
    ).toBe(100);
  });
});
