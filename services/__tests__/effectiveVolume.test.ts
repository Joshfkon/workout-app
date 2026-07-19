/**
 * Effective Volume — RIR-weighted set counting.
 *
 * Covers the single-source-of-truth weight table, the conservative
 * null/unknown-RIR rule (warn + weight 1.0, never drop), feedback parsing
 * from both in-memory and raw-JSONB shapes, and the weighted-sum helper.
 */

import {
  EFFECTIVE_VOLUME_WEIGHTS,
  UNKNOWN_RIR_WEIGHT,
  effectiveVolumeWeight,
  rirFromFeedback,
  sumEffectiveVolume,
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

  it('weights null RIR 1.0 (conservative) and logs a console warning', () => {
    expect(effectiveVolumeWeight(null)).toBe(UNKNOWN_RIR_WEIGHT);
    expect(effectiveVolumeWeight(undefined)).toBe(UNKNOWN_RIR_WEIGHT);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toMatch(/null\/unknown RIR/);
  });

  it('weights out-of-range RIR 1.0 and warns instead of dropping the set', () => {
    expect(effectiveVolumeWeight(-1)).toBe(UNKNOWN_RIR_WEIGHT);
    expect(effectiveVolumeWeight(7)).toBe(UNKNOWN_RIR_WEIGHT);
    expect(effectiveVolumeWeight(NaN)).toBe(UNKNOWN_RIR_WEIGHT);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('includes the caller context in the warning for traceability', () => {
    effectiveVolumeWeight(null, 'Back Squat');
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

  it('never drops a null-RIR set — it counts 1.0 with a warning', () => {
    expect(sumEffectiveVolume([2, null, 4])).toBeCloseTo(1.0 + 1.0 + 0.25, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
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
