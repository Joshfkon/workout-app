/**
 * Pricing-study aggregation (PRICING_STUDY.md §4). Pure: response records in,
 * tables out. Everything here is RELATIVE: option A vs option B for a
 * segment, never a forecast of real take-up or revenue.
 *
 *   take-rate    the panel's mean SSR mass on "probably / definitely yes"
 *                (Likert 4 + 5), the top-two-box of market research. SSR at
 *                T = 1 is compressed toward 3, so take-rates sit in a narrow
 *                band; only their ORDER across prices and options means much.
 *   said yes     per persona (`block.yes[key]`, set by study.scoreVerdicts):
 *                the Yes/No/Maybe the answer opens with when clear, else the
 *                sharper (T = 0.3) SSR pmf puts ≥ 50 % on 4 + 5. Used where a
 *                per-person yes/no is needed (the acceptable monthly price,
 *                "what tips a no into a yes", the "yes" shares).
 *   revenue      price × share saying yes × 100 personas per month, and an
 *                index with the best price in that group = 100. NOT the SSR
 *                take-rate: at T = 1 a flat "No" still keeps ~0.3 of its mass
 *                on 4 + 5, the same at every price, so price × take-rate
 *                always favoured the highest price (seen in the first dry
 *                run: $9.99 and $12.99 both at 0.29, $12.99 "best").
 */

export const take = (pmf) => (pmf ? pmf[3] + pmf[4] : NaN);
export const saidYes = (sharpPmf) => !!sharpPmf && sharpPmf[3] + sharpPmf[4] >= 0.5;
/** A record's yes/no for one key of a block (falls back to sharp SSR for records without `yes`). */
export const yesOf = (blockRec, key) => {
  const k = String(key);
  if (!blockRec) return null;
  if (blockRec.yes && k in blockRec.yes) return blockRec.yes[k];
  return blockRec.sharp?.[k] ? saidYes(blockRec.sharp[k]) : null;
};
const yesShareOf = (recs, block, key) => {
  const ys = recs.map((r) => yesOf(r[block], key)).filter((y) => y !== null);
  return ys.length ? ys.filter(Boolean).length / ys.length : NaN;
};

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

/** Groups the report breaks results down by. */
export function groupings(records) {
  const segs = [...new Set(records.map((r) => r.segment))].sort();
  const exps = ['beginner', 'intermediate', 'advanced'].filter((e) => records.some((r) => r.experience === e));
  return [
    { id: 'all', label: 'All', filter: () => true },
    ...segs.map((s) => ({ id: `segment:${s}`, label: s, kind: 'segment', filter: (r) => r.segment === s })),
    ...exps.map((e) => ({ id: `experience:${e}`, label: e, kind: 'experience', filter: (r) => r.experience === e })),
  ];
}

// ---------------------------------------------------------------------------
// Van Westendorp
// ---------------------------------------------------------------------------

/**
 * Van Westendorp price sensitivity from valid threshold sets.
 *   too cheap / cheap curves: share whose threshold is ≥ p (they fall as p rises)
 *   expensive / too expensive: share whose threshold is ≤ p (they rise)
 *   OPP  optimal price point       too cheap ∩ too expensive
 *   IPP  indifference price point  cheap ∩ expensive
 *   PMC  marginal cheapness        too cheap ∩ not cheap (1 − cheap)
 *   PME  marginal expensiveness    too expensive ∩ not expensive (1 − expensive)
 * The acceptable range is [PMC, PME]. Needs `minN` valid responses.
 *
 * @param {Array<{tooCheap:number, cheap:number, expensive:number, tooExpensive:number, valid?:boolean}>} rows
 */
export function vanWestendorp(rows, { minN = 3, step = 0.01 } = {}) {
  const ok = rows.filter((r) => r && r.valid !== false && [r.tooCheap, r.cheap, r.expensive, r.tooExpensive].every(Number.isFinite));
  const out = { n: ok.length, dropped: rows.length - ok.length, pmc: null, opp: null, ipp: null, pme: null };
  if (ok.length < minN) return out;
  const n = ok.length;
  const share = (pred) => ok.filter(pred).length / n;
  const curves = {
    tooCheap: (p) => share((r) => r.tooCheap >= p),
    cheap: (p) => share((r) => r.cheap >= p),
    expensive: (p) => share((r) => r.expensive <= p),
    tooExpensive: (p) => share((r) => r.tooExpensive <= p),
  };
  const max = Math.max(...ok.map((r) => r.tooExpensive)) + step;
  /**
   * Where the falling curve meets the rising one. Step curves from a small
   * panel often meet in a flat gap (both 0 between the last "too cheap" and
   * the first "too expensive"), so the crossing is the midpoint between the
   * first price where falling ≤ rising and the first where falling < rising.
   */
  const cross = (falling, rising) => {
    let touch = null;
    for (let i = 0; i * step <= max; i++) {
      const p = i * step;
      const f = falling(p);
      const r = rising(p);
      if (touch == null && f <= r) touch = p;
      if (touch != null && f < r) return round2((touch + p) / 2);
    }
    return touch == null ? null : round2(touch);
  };
  out.opp = cross(curves.tooCheap, curves.tooExpensive);
  out.ipp = cross(curves.cheap, curves.expensive);
  out.pmc = cross(curves.tooCheap, (p) => 1 - curves.cheap(p));
  out.pme = cross((p) => 1 - curves.expensive(p), curves.tooExpensive);
  out.medians = {
    tooCheap: median(ok.map((r) => r.tooCheap)),
    cheap: median(ok.map((r) => r.cheap)),
    expensive: median(ok.map((r) => r.expensive)),
    tooExpensive: median(ok.map((r) => r.tooExpensive)),
  };
  return out;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

// ---------------------------------------------------------------------------
// Take-rate curves
// ---------------------------------------------------------------------------

/**
 * Take-rate per price point for one block of answers (gg, annual, lifetime).
 * Reads `record[block].scores|sharp|yes[priceKey]`.
 * @returns {Array<{price:number, n:number, take:number, takeSharp:number, yesShare:number, revenuePer100:number, index:number}>}
 */
export function takeCurve(records, block, prices) {
  const rows = prices.map((price) => {
    const k = String(price);
    const pmfs = records.map((r) => r[block]?.scores?.[k]).filter(Boolean);
    const sharp = records.map((r) => r[block]?.sharp?.[k]).filter(Boolean);
    const t = mean(pmfs.map(take));
    return { price, n: pmfs.length, take: t, takeSharp: mean(sharp.map(take)), yesShare: yesShareOf(records, block, price) };
  });
  for (const r of rows) r.revenuePer100 = r.price * r.yesShare * 100;
  const best = Math.max(...rows.map((r) => r.revenuePer100).filter(Number.isFinite));
  for (const r of rows) r.index = best > 0 ? (100 * r.revenuePer100) / best : NaN;
  return rows;
}

/**
 * Annual offers differ per persona (multiples of THEIR acceptable price), so
 * they are grouped by multiple, with the mean offered price alongside.
 */
export function annualCurve(records, multiples) {
  return multiples.map((m) => {
    const rs = records.filter((r) => r.annual?.scores?.[String(m)]);
    const pmfs = rs.map((r) => r.annual.scores[String(m)]);
    return {
      multiple: m,
      n: pmfs.length,
      meanPrice: mean(rs.map((r) => r.annual.offers.find((o) => o.multiple === m)?.price).filter(Number.isFinite)),
      take: mean(pmfs.map(take)),
      yesShare: yesShareOf(rs, 'annual', m),
    };
  });
}

/** The highest Gabor-Granger price a persona said yes to (`yesByPrice`: key → boolean), else null. */
export function acceptableMonthly(yesByPrice, prices) {
  const yes = prices.filter((p) => yesByPrice?.[String(p)] === true);
  return yes.length ? Math.max(...yes) : null;
}

// ---------------------------------------------------------------------------
// Packages and features
// ---------------------------------------------------------------------------

/** Share choosing each variant (plus 'none' and unparsed), and mean take per variant. */
export function packageSummary(records, packages) {
  const n = records.length;
  const choice = Object.fromEntries([...packages.map((v) => v.id), 'none', 'unclear'].map((id) => [id, 0]));
  for (const r of records) choice[r.packages?.choice ?? 'unclear'] = (choice[r.packages?.choice ?? 'unclear'] ?? 0) + 1;
  return {
    n,
    shares: Object.fromEntries(Object.entries(choice).map(([k, c]) => [k, n ? c / n : NaN])),
    take: Object.fromEntries(packages.map((v) => [v.id, mean(records.map((r) => r.packages?.scores?.[v.id]).filter(Boolean).map(take))])),
    yesShare: Object.fromEntries(packages.map((v) => [v.id, yesShareOf(records, 'packages', v.id)])),
  };
}

/**
 * What tips a "no" into a "yes". Among personas who would NOT pay for today's
 * Pro (V1, sharp), count (a) each other variant they WOULD pay for, by the
 * feature it adds, and (b) the feature their "one thing that would make you
 * pay" answer was matched to.
 */
export function tippingFeatures(records, packages) {
  const base = packages[0].id;
  // Everyone who did not say yes to today's Pro, split by what they did say:
  // most lifters answer "maybe" at a low price, and reporting all of them as
  // "would not pay" overstated the refusals (round 19 report: "98 of 100").
  const noOnBase = records.filter((r) => yesOf(r.packages, base) === false);
  const maybeOnBase = noOnBase.filter((r) => r.packages?.stance?.[base] === 'maybe').length;
  const byVariant = {};
  for (const v of packages.slice(1)) byVariant[v.adds ?? v.id] = noOnBase.filter((r) => yesOf(r.packages, v.id) === true).length;
  const oneThing = {};
  for (const r of noOnBase) if (r.packages?.oneThingLabel) oneThing[r.packages.oneThingLabel] = (oneThing[r.packages.oneThingLabel] ?? 0) + 1;
  const sortDesc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return { noOnBase: noOnBase.length, maybeOnBase, firmNoOnBase: noOnBase.length - maybeOnBase, byVariant: sortDesc(byVariant), oneThing: sortDesc(oneThing) };
}

/**
 * How often SSR agrees with the stance a would-buy answer opened with, over
 * every answer whose stance is a clear yes or no. A low rate means the anchors
 * (or the embedding) misread these answers, and the take-rates deserve less
 * weight than the "yes" shares.
 */
export function stanceAgreement(records, blocks = ['gg', 'annual', 'lifetime', 'packages']) {
  let n = 0;
  let agree = 0;
  let unclear = 0;
  for (const r of records)
    for (const b of blocks)
      for (const [k, stance] of Object.entries(r[b]?.stance ?? {})) {
        if (stance !== 'yes' && stance !== 'no') {
          unclear += 1;
          continue;
        }
        n += 1;
        if (saidYes(r[b].sharp?.[k]) === (stance === 'yes')) agree += 1;
      }
  return { n, agree, rate: n ? agree / n : NaN, unclear };
}

/** Borda score per feature (1 = always ranked first, 0 = always last), best first. */
export function featureRanking(records, features) {
  const k = features.length;
  const pts = Object.fromEntries(features.map((f) => [f, []]));
  for (const r of records) {
    const rank = r.packages?.ranking;
    if (!rank?.length) continue;
    rank.forEach((f, i) => pts[f]?.push(k > 1 ? (k - 1 - i) / (k - 1) : 1));
  }
  return features.map((f) => ({ feature: f, score: mean(pts[f]), n: pts[f].length })).sort((a, b) => (b.score || 0) - (a.score || 0));
}

// ---------------------------------------------------------------------------
// Whole-study analysis and recommendation
// ---------------------------------------------------------------------------

/**
 * @param {Array<object>} records  response records of ONE tier
 * @param {{ggPrices:number[], annualMultiples:number[], lifetimePrices:number[], packages:Array<{id,name,price,adds}>, features:string[]}} design
 */
export function analyse(records, design) {
  const groups = {};
  for (const g of groupings(records)) {
    const rs = records.filter(g.filter);
    groups[g.id] = {
      label: g.label,
      kind: g.kind ?? 'all',
      n: rs.length,
      vw: vanWestendorp(rs.map((r) => r.vw)),
      gg: takeCurve(rs, 'gg', design.ggPrices),
      annual: annualCurve(rs, design.annualMultiples),
      lifetime: takeCurve(rs, 'lifetime', design.lifetimePrices),
      packages: packageSummary(rs, design.packages),
      acceptableMedian: median(rs.map((r) => r.acceptableMonthly).filter(Number.isFinite)),
    };
  }
  return {
    n: records.length,
    groups,
    tipping: tippingFeatures(records, design.packages),
    features: featureRanking(records, design.features),
    stanceAgreement: stanceAgreement(records),
    recommendation: recommend(groups, design, tippingFeatures(records, design.packages)),
  };
}

const money = (x) => `$${x.toFixed(2)}`;

/**
 * The recommended monthly price and package, the runners-up, and the
 * segment served worst. Price: highest relative revenue (all personas) among
 * the tested points; package: most chosen option (mean take breaks ties).
 */
export function recommend(groups, design, tipping = null) {
  const all = groups.all;
  if (!all || !all.n) return { summary: 'No responses to analyse.' };
  const byRevenue = [...all.gg].filter((r) => Number.isFinite(r.revenuePer100)).sort((a, b) => b.revenuePer100 - a.revenuePer100);
  const price = byRevenue[0]?.price ?? null;
  const priceRunnerUp = byRevenue[1]?.price ?? null;
  const vw = all.vw;
  const inRange = price != null && vw.pmc != null && vw.pme != null ? price >= vw.pmc && price <= vw.pme : null;
  const pk = all.packages;
  const ranked = design.packages
    .map((v) => ({ ...v, share: pk.shares[v.id] ?? 0, take: pk.take[v.id] ?? 0 }))
    .sort((a, b) => b.share - a.share || b.take - a.take);
  const pkg = ranked[0];
  const pkgRunnerUp = ranked[1];
  const segs = Object.entries(groups).filter(([, g]) => g.kind === 'segment' && g.n);
  const atPrice = segs.map(([id, g]) => ({ id, label: g.label, take: g.gg.find((r) => r.price === price)?.yesShare ?? NaN })).filter((s) => Number.isFinite(s.take));
  const worst = atPrice.sort((a, b) => a.take - b.take)[0] ?? null;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const summary = [
    price != null
      ? `Of the tested monthly prices, ${money(price)} gives the highest relative revenue across all ${all.n} personas${priceRunnerUp != null ? `, with ${money(priceRunnerUp)} the runner-up` : ''}.`
      : 'No price stood out.',
    vw.pmc != null && vw.pme != null
      ? `The Van Westendorp acceptable range is ${money(vw.pmc)}–${money(vw.pme)} (optimal ${vw.opp != null ? money(vw.opp) : '–'}), so ${money(price ?? 0)} ${inRange ? 'sits inside it' : 'falls outside it, which argues for the runner-up or a price nearer the range'}.`
      : 'Too few complete price thresholds for a Van Westendorp range.',
    pkg ? `The package most often chosen is ${pkg.id} (${pkg.name}, ${pct(pkg.share)} of personas)${pkgRunnerUp ? `, ahead of ${pkgRunnerUp.id} (${pkgRunnerUp.name}, ${pct(pkgRunnerUp.share)})` : ''}; ${pct(pk.shares.none ?? 0)} would choose none.` : '',
    worst ? `At ${money(price)}, the segment served worst is ${worst.label} (${pct(worst.take)} say yes).` : '',
    tipping?.byVariant?.[0]?.[1] > 0
      ? `Of the ${tipping.noOnBase} who did not say yes to today's Pro (${tipping.firmNoOnBase} no, ${tipping.maybeOnBase} maybe), the addition that most often turns them into a yes is "${tipping.byVariant[0][0]}" (${tipping.byVariant[0][1]}).`
      : '',
    'All of this is relative, from synthetic personas: confirm the winner with a real price test.',
  ]
    .filter(Boolean)
    .join(' ');
  return { price, priceRunnerUp, inRange, package: pkg?.id ?? null, packageRunnerUp: pkgRunnerUp?.id ?? null, worstSegment: worst?.label ?? null, summary };
}

/**
 * Does the hands-on tier agree with the survey tier for the SAME personas?
 * Spearman rank correlation of the take-rate order across prices and of the
 * package-share order (PRICING_STUDY.md §2: if they disagree, trust hands-on).
 */
export function compareTiers(survey, handsOn) {
  // Average ranks for ties, then Pearson on the ranks (the tie-correct
  // Spearman). A constant side has no order to agree with: null.
  const order = (xs) => {
    const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const ranks = Array(xs.length);
    for (let s = 0; s < idx.length; ) {
      let e = s;
      while (e + 1 < idx.length && idx[e + 1][0] === idx[s][0]) e++;
      for (let k = s; k <= e; k++) ranks[idx[k][1]] = (s + e) / 2;
      s = e + 1;
    }
    return ranks;
  };
  const spearman = (a, b) => {
    if (a.length < 2 || a.some((x) => !Number.isFinite(x)) || b.some((x) => !Number.isFinite(x))) return null;
    const ra = order(a);
    const rb = order(b);
    const mean = (r) => r.reduce((s, x) => s + x, 0) / r.length;
    const ma = mean(ra);
    const mb = mean(rb);
    let num = 0, va = 0, vb = 0;
    for (let i = 0; i < ra.length; i++) {
      num += (ra[i] - ma) * (rb[i] - mb);
      va += (ra[i] - ma) ** 2;
      vb += (rb[i] - mb) ** 2;
    }
    if (va === 0 || vb === 0) return null;
    return num / Math.sqrt(va * vb);
  };
  const ids = Object.keys(survey.groups.all.packages.take);
  return {
    priceOrder: spearman(survey.groups.all.gg.map((r) => r.take), handsOn.groups.all.gg.map((r) => r.take)),
    packageOrder: spearman(ids.map((id) => survey.groups.all.packages.shares[id]), ids.map((id) => handsOn.groups.all.packages.shares[id])),
    samePrice: survey.recommendation.price === handsOn.recommendation.price,
    samePackage: survey.recommendation.package === handsOn.recommendation.package,
  };
}
