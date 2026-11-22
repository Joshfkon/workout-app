/**
 * Aggregation for the synthetic user panel: score distributions per journey,
 * friction clustering (how many personas hit the "same" problem), and
 * run-vs-run comparison. Pure — embeddings are passed in, never computed here.
 */
import { cosine, expectedValue, ksSimilarity, meanPmf } from './ssr.mjs';

/** Collapse ids out of a URL path so the same screen groups together. */
export function screenKey(urlOrPath) {
  let path = urlOrPath || '';
  try {
    path = new URL(urlOrPath, 'http://x').pathname;
  } catch {
    /* already a path */
  }
  return (
    path
      .split('/')
      .map((seg) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^\d+$/.test(seg) ? ':id' : seg,
      )
      .join('/')
      .replace(/\/+$/, '') || '/'
  );
}

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Per journey × question: the mean pmf over personas (the panel's
 * distribution), its expected value, and the spread of per-persona means.
 * An `all` pseudo-journey pools every result. When results also carry
 * sharper pmfs (`scoresSharp`, scored at a lower temperature), each cell gets
 * a `sharp` {pmf, mean} beside the standard one.
 *
 * @param {Array<{journeyId: string, scores?: Record<string, number[]>, scoresSharp?: Record<string, number[]>}>} results
 * @param {string[]} questionIds
 */
export function aggregateScores(results, questionIds) {
  const journeys = [...new Set(results.map((r) => r.journeyId))].sort();
  const groups = [...journeys.map((j) => [j, results.filter((r) => r.journeyId === j)]), ['all', results]];
  const out = {};
  for (const [journeyId, rs] of groups) {
    out[journeyId] = {};
    for (const q of questionIds) {
      const pmfs = rs.map((r) => r.scores?.[q]).filter(Boolean);
      const means = pmfs.map(expectedValue);
      const pmf = meanPmf(pmfs);
      const cell = { n: pmfs.length, pmf, mean: pmfs.length ? expectedValue(pmf) : NaN, sd: sd(means) };
      const sharp = rs.map((r) => r.scoresSharp?.[q]).filter(Boolean);
      if (sharp.length) {
        const sp = meanPmf(sharp);
        cell.sharp = { pmf: sp, mean: expectedValue(sp) };
      }
      out[journeyId][q] = cell;
    }
  }
  return out;
}

/**
 * Per-question anchor hashes of a run. Runs from before per-question hashes
 * map their whole-file hash through `legacy` (anchors.mjs LEGACY_ANCHOR_HASHES).
 */
export function runAnchorHashes(run, legacy = {}) {
  return run.anchorHashes ?? legacy[run.anchorsHash] ?? {};
}

/**
 * Questions two runs can be compared on: same embedding model, and the same
 * anchors for that question. Questions only one run asked are left out.
 */
export function comparableQuestions(a, b, legacy = {}) {
  if (!a || !b || a.embed !== b.embed) return [];
  const ha = runAnchorHashes(a, legacy);
  const hb = runAnchorHashes(b, legacy);
  return Object.keys(hb).filter((q) => ha[q] && ha[q] === hb[q]);
}

/** Compare two score tables ({group: {question: cell}}) on the given questions. */
export function compareScoreTables(ta, tb, questions) {
  ta ??= {}; // a run without week reviews stores weekScores: null
  tb ??= {};
  const out = {};
  for (const g of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
    out[g] = {};
    for (const q of questions) {
      const x = ta[g]?.[q];
      const y = tb[g]?.[q];
      if (!x && !y) continue;
      out[g][q] = {
        meanA: x?.mean ?? NaN,
        meanB: y?.mean ?? NaN,
        delta: (y?.mean ?? NaN) - (x?.mean ?? NaN),
        ks: x?.n && y?.n ? ksSimilarity(x.pmf, y.pmf) : NaN,
        sharpDelta: (y?.sharp?.mean ?? NaN) - (x?.sharp?.mean ?? NaN),
      };
    }
  }
  return out;
}

const SEVERITY_RANK = { blocker: 3, major: 2, minor: 1 };

/**
 * Greedy clustering of friction reports. Two reports are the "same" friction
 * when they were raised on the same screen and their descriptions' embeddings
 * have cosine ≥ threshold with the cluster centroid. Clusters are ranked by
 * the number of DISTINCT personas that hit them (a persona complaining twice
 * counts once), then by worst severity.
 *
 * @param {Array<{personaId: string, journeyId: string, screen: string, text: string,
 *   severity?: string, screenshot?: string, embedding: number[]}>} frictions
 * @param {{threshold?: number, sameScreenOnly?: boolean}} [opts]
 */
export function clusterFrictions(frictions, { threshold = 0.6, sameScreenOnly = true } = {}) {
  const ordered = [...frictions].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  );
  const clusters = [];
  for (const f of ordered) {
    const key = screenKey(f.screen);
    let best = null;
    let bestSim = -Infinity;
    for (const c of clusters) {
      if (sameScreenOnly && c.screen !== key) continue;
      const sim = cosine(c.centroid, f.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best && bestSim >= threshold) {
      best.items.push(f);
      const n = best.items.length;
      best.centroid = best.centroid.map((v, i) => v + (f.embedding[i] - v) / n);
    } else {
      clusters.push({ screen: key, centroid: [...f.embedding], items: [f] });
    }
  }
  return clusters
    .map((c) => {
      const personas = [...new Set(c.items.map((i) => i.personaId))];
      // Label: the member closest to the centroid (most representative).
      const label = [...c.items].sort((a, b) => cosine(b.embedding, c.centroid) - cosine(a.embedding, c.centroid))[0];
      const worst = c.items.reduce((w, i) => ((SEVERITY_RANK[i.severity] ?? 0) > (SEVERITY_RANK[w] ?? 0) ? i.severity : w), 'minor');
      return {
        screen: c.screen,
        label: label.text,
        personaCount: personas.length,
        personas,
        journeys: [...new Set(c.items.map((i) => i.journeyId))],
        severity: worst,
        screenshots: [...new Set(c.items.map((i) => i.screenshot).filter(Boolean))],
        items: c.items.map(({ embedding, ...rest }) => rest),
        centroid: c.centroid,
      };
    })
    .sort(
      (a, b) =>
        b.personaCount - a.personaCount ||
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
        b.items.length - a.items.length,
    );
}

/** Journey completion: share of persona runs that reached the goal. */
export function completionRates(results) {
  const out = {};
  for (const r of results) {
    out[r.journeyId] ??= { completed: 0, gaveUp: 0, ran: 0, errored: 0 };
    const o = out[r.journeyId];
    o.ran += 1;
    if (r.outcome === 'completed') o.completed += 1;
    else if (r.outcome === 'gave_up') o.gaveUp += 1;
    else if (r.outcome === 'error') o.errored += 1;
  }
  return out;
}

/**
 * Compare two runs' aggregates (B relative to A). Scores: mean shift and KS
 * similarity per journey × question. Frictions: clusters matched across runs
 * by same screen + centroid cosine ≥ threshold → persisting / new / resolved.
 */
export function compareRuns(a, b, { threshold = 0.6, questions = null } = {}) {
  // Default (no anchor info given): every question either run has, as before.
  const qs = questions ?? [...new Set([...Object.values(a.scores ?? {}), ...Object.values(b.scores ?? {}), ...Object.values(a.weekScores ?? {}), ...Object.values(b.weekScores ?? {})].flatMap((t) => Object.keys(t)))];
  const scores = compareScoreTables(a.scores, b.scores, qs);
  const weekScores = compareScoreTables(a.weekScores, b.weekScores, qs);
  const matchedA = new Set();
  const persisting = [];
  const added = [];
  for (const cb of b.frictions) {
    let best = -1;
    let bestSim = -Infinity;
    a.frictions.forEach((ca, i) => {
      if (matchedA.has(i) || ca.screen !== cb.screen) return;
      const sim = cosine(ca.centroid, cb.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    if (best >= 0 && bestSim >= threshold) {
      matchedA.add(best);
      persisting.push({ a: a.frictions[best], b: cb, personaDelta: cb.personaCount - a.frictions[best].personaCount });
    } else {
      added.push(cb);
    }
  }
  const resolved = a.frictions.filter((_, i) => !matchedA.has(i));
  return { scores, weekScores, frictions: { persisting, added, resolved } };
}

/**
 * Task ids behind a friction cluster whose session also hit a local
 * test-environment error (missing column/table). Such an issue may be the
 * environment, not the app, and must be verified before anyone acts on it.
 */
export function envTaintedTasks(cluster, results) {
  const tainted = new Set(results.filter((r) => (r.envErrors ?? []).length).map((r) => r.taskId));
  return [...new Set(cluster.items.map((it) => it.taskId).filter((t) => tainted.has(t)))];
}
