/**
 * Anchor calibration against real people: score App Store reviews (text +
 * the reviewer's own star rating) with SSR and measure how well the SSR
 * score tracks the stars. Pure functions; I/O lives in calibrate.mjs.
 *
 * Stars measure overall satisfaction, so they are the closest real-world
 * label for `keep_using`. The other questions are reported too, but a lower
 * correlation there is expected, not necessarily a defect.
 */
import { expectedValue, ksSimilarity, meanPmf, ssrPmf } from './ssr.mjs';

/** Ranks with ties averaged (1-based). */
export function ranks(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Spearman rank correlation (Pearson on tie-averaged ranks). */
export function spearman(xs, ys) {
  if (xs.length !== ys.length) throw new Error('length mismatch');
  if (xs.length < 2) return 0;
  return pearson(ranks(xs), ranks(ys));
}

/** Empirical pmf of integer 1–5 ratings. */
export function ratingPmf(stars) {
  const c = [0, 0, 0, 0, 0];
  for (const s of stars) c[s - 1]++;
  return c.map((x) => (stars.length ? x / stars.length : 0));
}

/**
 * Take at most `perStar` reviews of each star level, so a feed that is 80 %
 * five-star doesn't let "predict 5 for everything" look good. Deterministic:
 * keeps the first ones in input order.
 */
export function balanceByStars(reviews, perStar) {
  const seen = [0, 0, 0, 0, 0];
  return reviews.filter((r) => seen[r.stars - 1]++ < perStar);
}

/**
 * @param reviews  [{ stars, app, vec }]
 * @param anchorSetVecs  embedded anchor sets for one question
 * @returns per-question calibration summary
 */
export function calibrateQuestion(reviews, anchorSetVecs) {
  const pmfs = reviews.map((r) => ssrPmf(r.vec, anchorSetVecs));
  const ev = pmfs.map(expectedValue);
  const stars = reviews.map((r) => r.stars);
  const byStar = [1, 2, 3, 4, 5].map((s) => {
    const idx = stars.flatMap((x, i) => (x === s ? [i] : []));
    return { stars: s, n: idx.length, meanScore: idx.length ? idx.reduce((t, i) => t + ev[i], 0) / idx.length : null };
  });
  const present = byStar.filter((b) => b.n);
  const monotonic = present.every((b, i) => i === 0 || b.meanScore > present[i - 1].meanScore);
  // Each anchor set on its own, to find weak sets worth rewriting.
  const perSet = anchorSetVecs.map((set) => spearman(reviews.map((r) => expectedValue(ssrPmf(r.vec, [set]))), stars));
  // Distribution match per app, like the paper (predicted pmf vs real stars).
  const apps = [...new Set(reviews.map((r) => r.app))].map((app) => {
    const idx = reviews.flatMap((r, i) => (r.app === app ? [i] : []));
    const predicted = meanPmf(idx.map((i) => pmfs[i]));
    const actual = ratingPmf(idx.map((i) => stars[i]));
    return { app, n: idx.length, ks: ksSimilarity(predicted, actual), predictedMean: expectedValue(predicted), actualMean: expectedValue(actual) };
  });
  return { n: reviews.length, spearman: spearman(ev, stars), byStar, monotonic, perSet, apps };
}
