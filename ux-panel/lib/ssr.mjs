/**
 * Semantic Similarity Rating (SSR) — Maier et al., "LLMs Reproduce Human
 * Purchase Intent via Semantic Similarity Elicitation of Likert Ratings"
 * (arXiv 2510.08338, §3.4 and Eqs. 7–9).
 *
 * The persona answers in free text; we never ask it for a number. The text is
 * embedded and compared to a set of five reference ("anchor") statements, one
 * per Likert point. The similarities become a probability mass function over
 * 1..5:
 *
 *   γ_r        = cos(v_anchor_r, v_text)                               (Eq. 7)
 *   p_i(r)     ∝ γ_r − min_r' γ_r' + ε·[r = argmin]                    (Eq. 8)
 *   p_i(r, T)  ∝ p_i(r)^(1/T)                                          (Eq. 9)
 *   p(r)       = mean over anchor sets i of p_i(r, T)
 *
 * Subtracting the minimum is what makes the pmf informative: raw cosine
 * similarities between short sentences all sit close together, so normalising
 * them directly gives an almost flat distribution. The paper used ε = 0 and
 * T = 1; both are configurable.
 *
 * Pure (no I/O, no embedding calls) so it is unit-tested with hand-built
 * vectors.
 */

export const LIKERT_POINTS = [1, 2, 3, 4, 5];

/**
 * Temperature for the "sharper" score shown beside the standard (T = 1) one.
 * At T = 1 the five probabilities come out nearly flat, so every mean lands
 * near 3. On the App Store calibration set, T = 0.3 matched real star
 * distributions better (mean KS 0.76 -> 0.89 for keep_using; see README).
 * The standard score stays the headline so runs remain comparable.
 */
export const SHARP_TEMPERATURE = 0.3;

/** Cosine similarity of two equal-length numeric vectors. */
export function cosine(a, b) {
  if (a.length !== b.length) throw new Error(`cosine: length mismatch ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Normalise non-negative weights to sum 1 (uniform if they are all zero). */
export function normalise(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return weights.map(() => 1 / weights.length);
  return weights.map((w) => w / total);
}

/**
 * Eq. 8 + Eq. 9 for one anchor set: five similarities → pmf over Likert 1..5.
 *
 * @param {number[]} sims  cosine similarity of the response to anchors 1..5
 * @param {{epsilon?: number, temperature?: number}} [opts]
 */
export function pmfFromSimilarities(sims, { epsilon = 0, temperature = 1 } = {}) {
  if (sims.length !== LIKERT_POINTS.length) {
    throw new Error(`pmfFromSimilarities: expected ${LIKERT_POINTS.length} similarities, got ${sims.length}`);
  }
  if (!(temperature > 0)) throw new Error('pmfFromSimilarities: temperature must be > 0');
  const min = Math.min(...sims);
  const argmin = sims.indexOf(min);
  const shifted = sims.map((s, r) => s - min + (r === argmin ? epsilon : 0));
  const base = normalise(shifted);
  if (temperature === 1) return base;
  return normalise(base.map((p) => Math.pow(p, 1 / temperature)));
}

/**
 * Full SSR for one response: average the per-set pmfs over every anchor set.
 *
 * @param {number[]} responseVec        embedding of the free-text answer
 * @param {number[][][]} anchorSetVecs  [set][likertPoint-1] → embedding
 * @param {{epsilon?: number, temperature?: number}} [opts]
 * @returns {number[]} pmf over Likert 1..5
 */
export function ssrPmf(responseVec, anchorSetVecs, opts = {}) {
  if (!anchorSetVecs.length) throw new Error('ssrPmf: need at least one anchor set');
  const perSet = anchorSetVecs.map((set) =>
    pmfFromSimilarities(set.map((anchor) => cosine(anchor, responseVec)), opts),
  );
  return meanPmf(perSet);
}

/** Element-wise mean of several pmfs. */
export function meanPmf(pmfs) {
  const out = LIKERT_POINTS.map(() => 0);
  if (!pmfs.length) return out;
  for (const p of pmfs) for (let r = 0; r < out.length; r++) out[r] += p[r] / pmfs.length;
  return out;
}

/** Expected Likert value Σ r·p(r) (the paper's mean-intent statistic, Eq. 2). */
export function expectedValue(pmf) {
  return pmf.reduce((s, p, i) => s + p * LIKERT_POINTS[i], 0);
}

/**
 * KS similarity between two pmfs on the same ordinal scale (paper Eq. 3):
 * 1 − max_r |F_x(r) − F_y(r)|. 1 means identical distributions.
 */
export function ksSimilarity(p, q) {
  let fp = 0;
  let fq = 0;
  let maxGap = 0;
  for (let r = 0; r < p.length; r++) {
    fp += p[r];
    fq += q[r];
    maxGap = Math.max(maxGap, Math.abs(fp - fq));
  }
  return 1 - maxGap;
}
