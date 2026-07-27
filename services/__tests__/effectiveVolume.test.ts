/**
 * Effective Volume — RIR-weighted set counting.
 *
 * Covers the single-source-of-truth weight table, the unrated-RIR rule
 * (excluded from the effective sum and SURFACED as a count — never max
 * credit for missing data), feedback parsing from both in-memory and
 * raw-JSONB shapes, and the weighted-sum helpers.
 *
 * NOTE: earlier revisions of this file pinned the old unknown → 1.0 rule as
 * expected behavior. That rule was itself a defect (missing data receiving
 * maximum credit, inflating effective volume until eff ≡ sets everywhere);
 * these tests now pin the corrected semantics.
 */

import {
  EFFECTIVE_VOLUME_WEIGHTS,
  effectiveVolumeWeight,
  rirFromFeedback,
  sumEffectiveVolume,
  summarizeEffectiveVolume,
  formatEffectiveVolume,
} from '../effectiveVolume';

describe('EFFECTIVE_VOLUME_WEIGHTS', () => {
  it('defines exactly the agreed weight per RIR value', () => {
    expect(EFFECTIVE_VOLUME_WEIGHTS).toEqual({ 0: 1.0, 1: 1.0, 2: 1.0, 3: 0.6, 4: 0.25 });
  });
});

describe('effectiveVolumeWeight', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each([
    [0, 1.0],
    [1, 1.0],
    [2, 1.0],
    [3, 0.6],
    [4, 0.25],
  ])('weights RIR %i as %f without warning', (rir, weight) => {
    expect(effectiveVolumeWeight(rir)).toBe(weight);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null (unrated, excluded) for a missing RIR — never max credit', () => {
    expect(effectiveVolumeWeight(null)).toBeNull();
    expect(effectiveVolumeWeight(undefined)).toBeNull();
    // Missing data is an expected legacy state; the unrated COUNT is the
    // surfacing mechanism, not a per-set warning.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats out-of-range RIR as unrated and warns (malformed, not merely missing)', () => {
    expect(effectiveVolumeWeight(-1)).toBeNull();
    expect(effectiveVolumeWeight(7)).toBeNull();
    expect(effectiveVolumeWeight(NaN)).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(2); // NaN is missing-shaped, not out-of-range
  });

  it('includes the caller context in the out-of-range warning for traceability', () => {
    effectiveVolumeWeight(9, 'Back Squat');
    expect(warnSpy.mock.calls[0][0]).toContain('Back Squat');
  });

  it('rounds fractional RIR to the nearest table key', () => {
    expect(effectiveVolumeWeight(2.4)).toBe(1.0);
    expect(effectiveVolumeWeight(2.6)).toBe(0.6);
  });
});

describe('rirFromFeedback', () => {
  it('reads repsInTank from an in-memory feedback object', () => {
    expect(rirFromFeedback({ repsInTank: 4, form: 'clean' })).toBe(4);
    expect(rirFromFeedback({ repsInTank: 0, form: 'ugly' })).toBe(0);
  });

  it('parses a raw JSONB string payload (DB row shape)', () => {
    expect(rirFromFeedback(JSON.stringify({ repsInTank: 3, form: 'clean' }))).toBe(3);
  });

  it('returns null for missing/malformed feedback instead of deriving from RPE', () => {
    expect(rirFromFeedback(null)).toBeNull();
    expect(rirFromFeedback(undefined)).toBeNull();
    expect(rirFromFeedback({})).toBeNull();
    expect(rirFromFeedback('not json')).toBeNull();
    expect(rirFromFeedback({ repsInTank: 'two' })).toBeNull();
  });
});

describe('sumEffectiveVolume', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('sums the weights of a mixed-RIR session', () => {
    // 0 → 1.0, 1 → 1.0, 2 → 1.0, 3 → 0.6, 4 → 0.25
    expect(sumEffectiveVolume([0, 1, 2, 3, 4])).toBeCloseTo(3.85, 5);
  });

  it('excludes a null-RIR set from the sum (surfaced via summarize, not inflated)', () => {
    expect(sumEffectiveVolume([2, null, 4])).toBeCloseTo(1.0 + 0.25, 5);
  });

  it('summarizeEffectiveVolume reports the rated/unrated split', () => {
    expect(summarizeEffectiveVolume([2, null, 4, undefined])).toEqual({
      effectiveSets: 1.25,
      ratedSets: 2,
      unratedSets: 2,
    });
  });

  it('a fully-unrated session reads 0 effective of N — never N of N', () => {
    expect(summarizeEffectiveVolume([null, null, null])).toEqual({
      effectiveSets: 0,
      ratedSets: 0,
      unratedSets: 3,
    });
  });

  it('returns 0 for an empty session', () => {
    expect(sumEffectiveVolume([])).toBe(0);
  });
});

describe('formatEffectiveVolume', () => {
  it('renders whole numbers without a decimal and fractions with one', () => {
    expect(formatEffectiveVolume(14)).toBe('14');
    expect(formatEffectiveVolume(14.2)).toBe('14.2');
    expect(formatEffectiveVolume(14.25)).toBe('14.3');
    expect(formatEffectiveVolume(0)).toBe('0');
  });
});
