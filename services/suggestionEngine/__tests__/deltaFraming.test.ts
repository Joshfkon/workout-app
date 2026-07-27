/**
 * INV-4 — delta framing must be position-matched, not last-set-matched.
 * The Arnold Press fixture case: prescribing 42.5 for set 4 after today's
 * 47.5 set 3, against last session's set 4 at 40, must read "up 2.5", never
 * "down 5".
 */

import { framePositionalDelta } from '../deltaFraming';

describe('framePositionalDelta', () => {
  it('Arnold Press set 4: frames vs the positional set (up 2.5), not the last set (down 5)', () => {
    const text = framePositionalDelta(42.5, 40, 4, 'lbs');
    expect(text).toBe('up 2.5 lbs vs set 4 last session');
    expect(text).not.toContain('down');
  });

  it('frames a genuine positional regression as down', () => {
    expect(framePositionalDelta(37.5, 40, 4, 'lbs')).toBe('down 2.5 lbs vs set 4 last session');
  });

  it('says "matches" on an exact positional repeat', () => {
    expect(framePositionalDelta(40, 40, 3, 'lbs')).toBe('matches set 3 last session');
  });

  it('says NOTHING without a positional reference (never falls back to the last set)', () => {
    expect(framePositionalDelta(42.5, undefined, 4, 'lbs')).toBeNull();
    expect(framePositionalDelta(42.5, 0, 4, 'lbs')).toBeNull();
  });

  it('guards malformed prescribed values', () => {
    expect(framePositionalDelta(NaN, 40, 4, 'lbs')).toBeNull();
    expect(framePositionalDelta(0, 40, 4, 'lbs')).toBeNull();
  });
});
