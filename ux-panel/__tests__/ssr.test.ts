/**
 * SSR mapping (Maier et al., arXiv 2510.08338, Eqs. 7–9) — pure math, tested
 * with hand-built vectors so no embedding model is needed.
 */
import {
  cosine,
  normalise,
  pmfFromSimilarities,
  ssrPmf,
  meanPmf,
  expectedValue,
  ksSimilarity,
} from '../lib/ssr.mjs';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('cosine', () => {
  it('is 1 for parallel, 0 for orthogonal, -1 for opposite vectors', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it('returns 0 for a zero vector and throws on length mismatch', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(() => cosine([1], [1, 2])).toThrow(/length mismatch/);
  });
});

describe('normalise', () => {
  it('sums to 1, and falls back to uniform when all weights are zero', () => {
    expect(sum(normalise([1, 3]))).toBeCloseTo(1);
    expect(normalise([0, 0, 0, 0])).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});

describe('pmfFromSimilarities (Eq. 8)', () => {
  it('subtracts the minimum similarity, so the least similar anchor gets zero mass (ε = 0)', () => {
    const pmf = pmfFromSimilarities([0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(pmf[0]).toBe(0);
    expect(sum(pmf)).toBeCloseTo(1);
    // (s − min) = 0, .1, .2, .3, .4 → / 1.0
    expect(pmf.map((p) => +p.toFixed(6))).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it('is invariant to adding a constant to every similarity (why min-subtraction un-flattens the pmf)', () => {
    const a = pmfFromSimilarities([0.1, 0.2, 0.15, 0.3, 0.25]);
    const shifted = pmfFromSimilarities([0.6, 0.7, 0.65, 0.8, 0.75]);
    a.forEach((p, i) => expect(p).toBeCloseTo(shifted[i]));
    // Sharing a high common similarity (all ≈ 0.8) no longer flattens it.
    const compressed = pmfFromSimilarities([0.81, 0.82, 0.815, 0.83, 0.825]);
    expect(compressed[3]).toBeCloseTo(0.4);
  });

  it('ε gives the minimum anchor some mass', () => {
    const pmf = pmfFromSimilarities([0.5, 0.6, 0.7, 0.8, 0.9], { epsilon: 0.1 });
    expect(pmf[0]).toBeGreaterThan(0);
    expect(sum(pmf)).toBeCloseTo(1);
  });

  it('temperature (Eq. 9): T < 1 sharpens, T > 1 flattens, T = 1 is the identity', () => {
    const sims = [0.5, 0.6, 0.7, 0.8, 0.9];
    const base = pmfFromSimilarities(sims);
    const sharp = pmfFromSimilarities(sims, { temperature: 0.5 });
    const flat = pmfFromSimilarities(sims, { temperature: 3 });
    expect(sharp[4]).toBeGreaterThan(base[4]);
    expect(flat[4]).toBeLessThan(base[4]);
    expect(sum(sharp)).toBeCloseTo(1);
    expect(pmfFromSimilarities(sims, { temperature: 1 })).toEqual(base);
  });

  it('is uniform when every anchor is equally similar', () => {
    expect(pmfFromSimilarities([0.4, 0.4, 0.4, 0.4, 0.4])).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
  });

  it('rejects the wrong number of anchors and non-positive temperature', () => {
    expect(() => pmfFromSimilarities([1, 2, 3])).toThrow(/expected 5/);
    expect(() => pmfFromSimilarities([1, 2, 3, 4, 5], { temperature: 0 })).toThrow(/temperature/);
  });
});

describe('ssrPmf', () => {
  // Five orthogonal "anchor" directions; a response that points at anchor k
  // should put most mass on Likert point k+1.
  const basis = (k: number) => [0, 1, 2, 3, 4].map((i) => (i === k ? 1 : 0));
  const anchorSet = [0, 1, 2, 3, 4].map(basis);

  it('puts the mode on the anchor the response is closest to', () => {
    const response = [0.05, 0.1, 0.2, 0.3, 0.9];
    const pmf = ssrPmf(response, [anchorSet]);
    expect(pmf.indexOf(Math.max(...pmf))).toBe(4);
    expect(expectedValue(pmf)).toBeGreaterThan(4);
  });

  it('averages the per-set pmfs over several anchor sets', () => {
    const response = [0.9, 0.3, 0.2, 0.1, 0.05];
    const reversed = [...anchorSet].reverse();
    const pmf = ssrPmf(response, [anchorSet, reversed]);
    const expected = meanPmf([ssrPmf(response, [anchorSet]), ssrPmf(response, [reversed])]);
    pmf.forEach((p, i) => expect(p).toBeCloseTo(expected[i]));
    // Mirrored sets cancel out to a symmetric distribution centred on 3.
    expect(expectedValue(pmf)).toBeCloseTo(3);
  });

  it('needs at least one anchor set', () => {
    expect(() => ssrPmf([1], [])).toThrow(/at least one/);
  });
});

describe('expectedValue and ksSimilarity', () => {
  it('expected value is Σ r·p(r)', () => {
    expect(expectedValue([0, 0, 1, 0, 0])).toBe(3);
    expect(expectedValue([0.5, 0, 0, 0, 0.5])).toBe(3);
    expect(expectedValue([0, 0, 0, 0, 1])).toBe(5);
  });

  it('KS similarity is 1 for identical pmfs and 0 for opposite point masses', () => {
    const p = [0.1, 0.2, 0.4, 0.2, 0.1];
    expect(ksSimilarity(p, p)).toBeCloseTo(1);
    expect(ksSimilarity([1, 0, 0, 0, 0], [0, 0, 0, 0, 1])).toBeCloseTo(0);
    // Max CDF gap of a one-step shift of a point mass is 1.
    expect(ksSimilarity([0, 0, 1, 0, 0], [0, 0, 0, 1, 0])).toBeCloseTo(0);
    expect(ksSimilarity([0.5, 0.5, 0, 0, 0], [0.25, 0.75, 0, 0, 0])).toBeCloseTo(0.75);
  });

  it('meanPmf of nothing is all zeros', () => {
    expect(meanPmf([])).toEqual([0, 0, 0, 0, 0]);
  });
});
