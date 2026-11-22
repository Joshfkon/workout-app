/**
 * Anchor calibration against real star ratings: rank correlation, star
 * balancing, and the per-question summary (hand-built vectors, no model).
 */
import { balanceByStars, calibrateQuestion, ranks, ratingPmf, spearman } from '../lib/calibration.mjs';

describe('ranks and spearman', () => {
  it('averages tied ranks', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
  it('is 1 for any monotonic increasing relation and -1 for decreasing', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
  it('is 0 when one side is constant, and rejects mismatched lengths', () => {
    expect(spearman([1, 2, 3], [5, 5, 5])).toBe(0);
    expect(() => spearman([1], [1, 2])).toThrow(/length mismatch/);
  });
});

describe('ratingPmf and balanceByStars', () => {
  it('builds the empirical star distribution', () => {
    expect(ratingPmf([5, 5, 1, 3])).toEqual([0.25, 0, 0.25, 0, 0.5]);
  });
  it('caps each star level, keeping input order', () => {
    const r = [5, 5, 5, 1, 5, 1, 1].map((stars, i) => ({ stars, i }));
    expect(balanceByStars(r, 2).map((x) => x.i)).toEqual([0, 1, 3, 5]);
  });
});

describe('calibrateQuestion', () => {
  // Orthogonal anchors: anchor k points along axis k. A review "at" star s
  // points mostly along axis s-1, so SSR should recover the stars.
  const axis = (k: number, w = 1) => [0, 1, 2, 3, 4].map((i) => (i === k ? w : 0.1));
  const anchors = [[0, 1, 2, 3, 4].map((k) => axis(k))];
  const reviews = [1, 2, 3, 4, 5, 5, 1].map((stars, i) => ({ stars, app: i % 2 ? 'A' : 'B', vec: axis(stars - 1) }));

  const res = calibrateQuestion(reviews, anchors);

  it('tracks the stars when the text matches the anchors', () => {
    expect(res.spearman).toBeGreaterThan(0.95);
    expect(res.monotonic).toBe(true);
    expect(res.byStar.map((b) => b.n)).toEqual([2, 1, 1, 1, 2]);
  });

  it('reports each anchor set alone and a per-app distribution match', () => {
    expect(res.perSet).toHaveLength(1);
    expect(res.apps.map((a) => a.app).sort()).toEqual(['A', 'B']);
    for (const a of res.apps) expect(a.ks).toBeGreaterThan(0);
  });

  it('flags a non-monotonic mapping', () => {
    const flipped = reviews.map((r) => ({ ...r, stars: 6 - r.stars }));
    expect(calibrateQuestion(flipped, anchors).monotonic).toBe(false);
  });
});
