/**
 * Pricing-study aggregation (Van Westendorp, take-rate curves, packages,
 * tipping features, recommendation, tier agreement), the per-persona flow
 * with the scripted fake model, and the report.
 */
import { vanWestendorp, takeCurve, acceptableMonthly, packageSummary, tippingFeatures, featureRanking, analyse, compareTiers, stanceAgreement, take } from '../pricing/analysis.mjs';
import { surveyPersona, scoreVerdicts, handsOnDigest, estimatePricingCost, DESIGN } from '../pricing/study.mjs';
import { pricingFakeLLM } from '../pricing/fake.mjs';
import { tourBlocks, TOUR } from '../pricing/tour.mjs';
import { COMPETITORS, PACKAGES, GG_PRICES, ggOrder, surveySystemPrompt, VW_TOOL, GG_TOOL, PLANS_TOOL, PACKAGES_TOOL } from '../pricing/questions.mjs';
import { PRICING_QUESTIONS, pricingAnchorHashes } from '../pricing/anchors.mjs';
import { renderPricingReport } from '../pricing/render.mjs';
import type { PricingRecord } from '../pricing/analysis.mjs';
import { samplePricingPersonas } from '../personas/pricing.mjs';

const YES = [0, 0, 0.1, 0.5, 0.4];
const NO = [0.5, 0.3, 0.1, 0.1, 0];
const vw = (a: number, b: number, c: number, d: number) => ({ tooCheap: a, cheap: b, expensive: c, tooExpensive: d, valid: true });

describe('vanWestendorp', () => {
  it('finds the four intersections on a known panel', () => {
    const r = vanWestendorp(Array(4).fill(vw(2, 4, 8, 12)));
    expect(r.n).toBe(4);
    expect(r.pmc).toBeCloseTo(3, 1);
    expect(r.ipp).toBeCloseTo(6, 1);
    expect(r.opp).toBeCloseTo(7, 1);
    expect(r.pme).toBeCloseTo(10, 1);
  });

  it('keeps the range ordered and inside the answers on a mixed panel', () => {
    const r = vanWestendorp([vw(1, 3, 6, 10), vw(2, 4, 8, 12), vw(2, 5, 9, 15), vw(3, 6, 10, 20), vw(1.5, 4, 7, 11)]);
    expect(r.pmc!).toBeLessThanOrEqual(r.opp!);
    expect(r.opp!).toBeLessThanOrEqual(r.pme!);
    expect(r.pmc!).toBeGreaterThanOrEqual(1);
    expect(r.pme!).toBeLessThanOrEqual(20);
    expect(r.medians!.cheap).toBe(4);
  });

  it('drops invalid answers and needs a minimum n', () => {
    const r = vanWestendorp([vw(1, 2, 3, 4), { ...vw(5, 3, 2, 1), valid: false }]);
    expect(r).toEqual(expect.objectContaining({ n: 1, dropped: 1, opp: null }));
  });
});

const rec = (seg: string, yesAt: number[], pkgYes: Record<string, boolean>, extra: Record<string, unknown> = {}): PricingRecord => ({
  personaId: `${seg}-${yesAt.join('')}`,
  segment: seg,
  experience: 'intermediate',
  vw: vw(2, 4, 8, 12),
  gg: {
    scores: Object.fromEntries(GG_PRICES.map((p) => [p, yesAt.includes(p) ? YES : NO])),
    sharp: Object.fromEntries(GG_PRICES.map((p) => [p, yesAt.includes(p) ? YES : NO])),
    yes: Object.fromEntries(GG_PRICES.map((p) => [p, yesAt.includes(p)])),
  },
  annual: { offers: [4, 6, 8].map((m) => ({ multiple: m, price: m * 5 - 0.01 })), scores: { 4: YES, 6: NO, 8: NO }, sharp: { 4: YES, 6: NO, 8: NO }, yes: { 4: true, 6: false, 8: false } },
  lifetime: { scores: { 49.99: YES, 79.99: NO, 99.99: NO }, sharp: { 49.99: YES, 79.99: NO, 99.99: NO }, yes: { 49.99: true, 79.99: false, 99.99: false } },
  packages: {
    scores: Object.fromEntries(Object.entries(pkgYes).map(([k, v]) => [k, v ? YES : NO])),
    sharp: Object.fromEntries(Object.entries(pkgYes).map(([k, v]) => [k, v ? YES : NO])),
    yes: pkgYes,
    stance: Object.fromEntries(Object.entries(pkgYes).map(([k, v]) => [k, v ? 'yes' : 'no'])),
    choice: Object.entries(pkgYes).find(([, v]) => v)?.[0] ?? 'none',
    ranking: DESIGN.features,
    oneThingLabel: DESIGN.features[5],
  },
  acceptableMonthly: Math.max(0, ...yesAt),
  ...extra,
}) as unknown as PricingRecord;

const records = [
  rec('lifting', [2.99, 4.99, 6.99, 9.99], { V1: true, V2: true, V3: false, V4: false }),
  rec('lifting', [2.99, 4.99, 6.99], { V1: false, V2: true, V3: false, V4: false }),
  rec('food-only', [2.99, 4.99], { V1: false, V2: false, V3: true, V4: true }),
  rec('food-only', [2.99], { V1: false, V2: false, V3: false, V4: false }),
];

describe('take-rate curves and revenue', () => {
  it('computes yes shares, SSR take-rates and a revenue index per price', () => {
    const c = takeCurve(records, 'gg', GG_PRICES);
    expect(c.map((r) => r.yesShare)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(c[0].take).toBeCloseTo(take(YES));
    // Revenue = price × yes share × 100; $4.99 × 0.75 beats $2.99 × 1 and $6.99 × 0.5.
    expect(c[1].revenuePer100).toBeCloseTo(374.25);
    expect(c[1].index).toBe(100);
    expect(c[4].index).toBe(0);
  });

  it("takes a persona's acceptable price as the highest price they said yes to", () => {
    expect(acceptableMonthly({ 2.99: true, 4.99: true, 6.99: false, 9.99: true, 12.99: false }, GG_PRICES)).toBe(9.99);
    expect(acceptableMonthly({ 2.99: false }, GG_PRICES)).toBeNull();
  });
});

describe('packages, tipping and features', () => {
  it('shares choices and per-variant yes', () => {
    const s = packageSummary(records, PACKAGES);
    expect(s.shares).toEqual(expect.objectContaining({ V1: 0.25, V2: 0.25, V3: 0.25, none: 0.25 }));
    expect(s.yesShare.V2).toBe(0.5);
  });

  it('counts what turns a "no" on today\'s Pro into a "yes"', () => {
    const t = tippingFeatures(records, PACKAGES);
    expect(t.noOnBase).toBe(3);
    expect(t.firmNoOnBase + t.maybeOnBase).toBe(3);
    const byVariant = Object.fromEntries(t.byVariant);
    expect(byVariant[PACKAGES[1].adds!]).toBe(1); // V2: AI food logging
    expect(byVariant[PACKAGES[2].adds!]).toBe(1); // V3: food-only tier
    expect(byVariant[PACKAGES[3].adds!]).toBe(1); // V4: check-ins
    expect(t.oneThing).toEqual([[DESIGN.features[5], 3]]);
  });

  it('ranks features by Borda score', () => {
    const f = featureRanking(records, DESIGN.features);
    expect(f[0]).toEqual({ feature: DESIGN.features[0], score: 1, n: 4 });
    expect(f.at(-1)!.score).toBe(0);
  });
});

describe('analyse / recommend / compareTiers', () => {
  const a = analyse(records, DESIGN);

  it('breaks results down by segment and experience', () => {
    expect(Object.keys(a.groups)).toEqual(['all', 'segment:food-only', 'segment:lifting', 'experience:intermediate']);
    expect(a.groups['segment:lifting']!.gg.find((r) => r.price === 6.99)!.yesShare).toBe(1);
  });

  it('recommends the highest-revenue price and the most chosen package, and says it is relative', () => {
    const r = a.recommendation;
    expect(r.price).toBe(4.99);
    expect(r.priceRunnerUp).toBe(6.99);
    expect(r.worstSegment).toBe('food-only');
    expect(r.package).toBe('V2'); // V1, V2, V3 tie on share; V2 has the higher take
    expect(r.inRange).toBe(true);
    expect(r.summary).toMatch(/relative/);
  });

  it('agrees with itself, and notices a reversed order', () => {
    expect(compareTiers(a, a)).toEqual(expect.objectContaining({ priceOrder: 1, samePrice: true, samePackage: true }));
    const flipped = analyse(records.map((r) => ({ ...r, gg: { ...r.gg, scores: Object.fromEntries(GG_PRICES.map((p, i) => [p, r.gg.scores![GG_PRICES[GG_PRICES.length - 1 - i]]])) } })), DESIGN);
    expect(compareTiers(a, flipped).priceOrder).toBeLessThan(0);
  });

  it('reports no package order agreement when one side has no preference (ties)', () => {
    const fake = (shares: number[], takes: number[]) => ({
      groups: { all: { gg: takes.map((take) => ({ take })), packages: { take: { V1: 0, V2: 0, V3: 0, V4: 0 }, shares: { V1: shares[0], V2: shares[1], V3: shares[2], V4: shares[3] } } } },
      recommendation: { price: 4.99, package: 'V1' },
    });
    const flat = fake([0.25, 0.25, 0.25, 0.25], [0.5, 0.4, 0.4, 0.2]);
    const ordered = fake([0.1, 0.2, 0.3, 0.4], [0.6, 0.5, 0.5, 0.1]);
    const c = compareTiers(flat as never, ordered as never);
    expect(c.packageOrder).toBeNull();
    expect(c.priceOrder).toBeCloseTo(1); // tied takes share an average rank on both sides
  });

  it('measures how often SSR agrees with the stated yes/no', () => {
    expect(stanceAgreement(records)).toEqual(expect.objectContaining({ n: 16, rate: 1 }));
    const wrong = [{ ...records[0], packages: { ...records[0].packages, sharp: { ...records[0].packages.sharp, V1: NO } } }];
    expect(stanceAgreement(wrong).rate).toBe(0.75);
  });
});

describe('the per-persona flow (fake model, stub scores)', () => {
  const persona = samplePricingPersonas({ n: 3, seed: 7 })[0];
  // Stub SSR: "Yes…" → YES, anything else → NO. The real scorer embeds.
  const score = async (text: string) => (/^yes/i.test(text) ? { pmf: YES, sharp: YES } : { pmf: NO, sharp: NO });
  const tour = tourBlocks({ preferImages: false });

  it('asks four blocks, all with the competitor list and the tour, and records text beside every number', async () => {
    const llm = pricingFakeLLM();
    const calls: any[] = [];
    const spy = { ...llm, call: async (p: any) => (calls.push(p), llm.call(p)) };
    const r = await surveyPersona({ llm: spy, persona, tour, seed: 7, score, nearestLabel: async () => 'A lower price' });
    expect(calls.map((c) => c.tools[0].name)).toEqual([VW_TOOL.name, GG_TOOL.name, PLANS_TOOL.name, PACKAGES_TOOL.name]);
    for (const c of calls) {
      const system = c.system.map((b: any) => b.text).join('\n');
      for (const comp of COMPETITORS) expect(system).toContain(comp.name);
      const user = c.messages[0].content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      expect(user).toContain(TOUR[1].caption);
      expect(user).toContain(persona.pricing.typicalWeek[0]);
    }
    expect(calls[1].messages[0].content.at(-1).text).toMatch(/several monthly prices/);
    expect(r.gg.order).toEqual(ggOrder(persona.id, 7));
    expect(r.vw.valid).toBe(true);
    expect(r.vw.answers!.bargain).toMatch(/^\$/);
    expect(Object.keys(r.gg.answers!).sort()).toEqual(GG_PRICES.map(String).sort());
    expect(Object.keys(r.annual.yes!)).toEqual(['4', '6', '8']);
    expect(r.packages.ranking).toHaveLength(DESIGN.features.length);
    expect(r.acceptableMonthly).toBeGreaterThan(0);
  });

  it('randomises the price order per persona but not per run', () => {
    const ps = samplePricingPersonas({ n: 20, seed: 1 });
    const orders = ps.map((p) => ggOrder(p.id, 1).join(','));
    expect(new Set(orders).size).toBeGreaterThan(5);
    expect(ggOrder(ps[0].id, 1)).toEqual(ggOrder(ps[0].id, 1));
  });

  it('uses the stated stance for yes/no and SSR only as the fallback', async () => {
    const s = await scoreVerdicts([['a', { answer: 'Definitely, cheaper than Strong.', why: '' }], ['b', { answer: 'That price is fine.', why: '' }]], 'subscribe', async () => ({ pmf: NO, sharp: NO }));
    expect(s.stance).toEqual({ a: 'yes', b: null });
    expect(s.yes).toEqual({ a: true, b: false });
  });
});

describe('hands-on digest', () => {
  it('tells the persona what they did, without the week verdict\'s Pro price answer', () => {
    const run = {
      journeyLabels: { 'log-meal': 'Log a meal' },
      results: [{ personaId: 'p', journeyId: 'log-meal', outcome: 'completed', summary: 'Logged oats.', review: { liked: 'Recents.', confusing: 'Units.' } }],
      weekReviews: [{ personaId: 'p', review: { switch: 'Yes.', switch_why: 'Faster.', pay_price: 'Not at $9.99.', best: 'Recents', dealbreaker: 'None' } }],
    };
    const d = handsOnDigest(run, 'p');
    expect(d).toContain('Log a meal: you got it done');
    expect(d).toContain('Recents.');
    expect(d).not.toContain('$9.99');
    expect(handsOnDigest(run, 'other')).toBe('');
  });
});

describe('cost estimate', () => {
  it('prices the survey per persona and adds the hands-on sessions', () => {
    const ps = samplePricingPersonas({ n: 100, seed: 1 });
    const e = estimatePricingCost({ n: 100, model: 'claude-sonnet-5-5' });
    expect(e.survey.calls).toBe(400);
    expect(e.high).toBeGreaterThan(e.expected);
    const h = estimatePricingCost({ n: 100, model: 'claude-sonnet-5-5', handsOnPersonas: ps.slice(0, 15) });
    expect(h.handsOn!.sessions).toBeGreaterThan(15 * 3);
    expect(h.expected).toBeGreaterThan(e.expected);
  });
});

describe('anchors and report', () => {
  it('has five-point anchor sets and a stable hash per question', () => {
    for (const q of PRICING_QUESTIONS) for (const set of q.anchorSets) expect(set).toHaveLength(5);
    const h = pricingAnchorHashes();
    expect(Object.keys(h)).toEqual(['subscribe', 'annual', 'lifetime', 'package']);
    expect(pricingAnchorHashes()).toEqual(h);
    expect(pricingAnchorHashes(PRICING_QUESTIONS.map((q) => ({ ...q, version: q.version + 1 })))).not.toEqual(h);
  });

  it('renders every section, labelled relative', () => {
    const personas = samplePricingPersonas({ n: 4, seed: 1 });
    const html = renderPricingReport({
      runId: 'r1',
      createdAt: '2026-11-23T00:00:00Z',
      n: 4,
      seed: 1,
      model: 'fake',
      embed: 'local',
      quotas: require('../personas/pricing.mjs').QUOTAS,
      tour: { mode: 'text' },
      anchorHashes: pricingAnchorHashes(),
      sharpTemperature: 0.3,
      design: { ...DESIGN, competitors: COMPETITORS },
      personas: personas.map((p) => ({ id: p.id, name: p.name, age: p.age, summary: p.summary, pricing: p.pricing })),
      responses: records,
      analysis: { survey: analyse(records, DESIGN) },
      cost: { dollars: 0 },
    });
    for (const s of ['Relative, not a forecast', 'Van Westendorp', 'Gabor-Granger', 'Annual', 'Lifetime', 'Package variants', 'tips a "no" into a "yes"', 'Recommended monthly price', 'scripted fake model']) expect(html).toContain(s);
    expect(html).toContain('Hevy $2.99/mo');
    expect(surveySystemPrompt()).toContain('RP Hypertrophy: $34.99/month');
  });
});
