/**
 * Pricing-study persona sampler: a 100-sample matches the quota table, the
 * same seed gives the same personas, and each persona has the shape the
 * panel's agent and hands-on journeys already use.
 */
import { samplePricingPersonas, quotaBalancedSubset, allocate, shares, rng, QUOTAS } from '../personas/pricing.mjs';
import { personaRunsJourney, journeyById } from '../journeys.mjs';

const TOL = 0.03;
const norm = (w: Record<string, number>) => {
  const t = Object.values(w).reduce((s, x) => s + x, 0);
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / t]));
};
function expectShares(observed: Record<string, number>, target: Record<string, number>, tol = TOL) {
  for (const [k, v] of Object.entries(norm(target))) expect(Math.abs((observed[k] ?? 0) - v)).toBeLessThanOrEqual(tol);
}

describe('samplePricingPersonas', () => {
  const ps = samplePricingPersonas({ n: 100, seed: 1 });

  it('draws 100 personas with unique ids', () => {
    expect(ps).toHaveLength(100);
    expect(new Set(ps.map((p) => p.id)).size).toBe(100);
  });

  it('matches the overall quotas (segment, income, experience) within tolerance', () => {
    expectShares(shares(ps, 'segment'), QUOTAS.segment);
    expectShares(shares(ps, 'income'), QUOTAS.income);
    expectShares(shares(ps, 'experienceLevel'), QUOTAS.experience);
  });

  it('matches gender, age band and current app within each segment', () => {
    for (const seg of Object.keys(QUOTAS.segment) as Array<keyof typeof QUOTAS.gender>) {
      const inSeg = (p: { pricing: { segment: string } }) => p.pricing.segment === seg;
      // Within-segment strata are 25–45 personas, so rounding moves a share by up to ~2–4 points.
      expectShares(shares(ps, 'gender', inSeg), QUOTAS.gender[seg], 0.04);
      expectShares(shares(ps, 'ageBand', inSeg), QUOTAS.age[seg], 0.04);
      expectShares(shares(ps, 'currentApp', inSeg), QUOTAS.currentApp[seg], 0.04);
    }
  });

  it('is reproducible: same seed, same personas; another seed, different ones', () => {
    expect(samplePricingPersonas({ n: 100, seed: 1 })).toEqual(ps);
    const other = samplePricingPersonas({ n: 100, seed: 2 });
    expect(other.map((p) => p.id)).not.toEqual(ps.map((p) => p.id));
    expectShares(shares(other, 'segment'), QUOTAS.segment);
  });

  it('keeps ages inside their bands and spend consistent with the current app', () => {
    const ranges: Record<string, [number, number]> = { '18-24': [18, 24], '25-39': [25, 39], '40-54': [40, 54], '55+': [55, 68], '18-29': [18, 29], '30-49': [30, 49], '50+': [50, 70] };
    for (const p of ps) {
      const [lo, hi] = ranges[p.pricing.ageBand];
      expect(p.age).toBeGreaterThanOrEqual(lo);
      expect(p.age).toBeLessThanOrEqual(hi);
      if (['notes', 'none'].includes(p.pricing.currentApp)) expect(p.pricing.monthlySpend).toBe(0);
      if (p.pricing.currentApp === 'macrofactor') expect(p.pricing.monthlySpend).toBe(11.99);
      expect(p.pricing.spendLine).toMatch(/^You pay \$[\d.]+ a month for fitness apps today\.$/);
    }
  });

  it('gives every persona the panel shape plus a concrete typical week', () => {
    for (const p of ps) {
      for (const k of ['id', 'name', 'age', 'summary', 'goals', 'experience', 'patience', 'techComfort', 'previousApps', 'account']) expect(p).toHaveProperty(k);
      expect(p.account).toEqual(expect.objectContaining({ goal: expect.any(String), units: expect.stringMatching(/^(lb|kg)$/), sex: expect.any(String), history: expect.any(String) }));
      expect(p.pricing.typicalWeek.length).toBeGreaterThan(0);
      expect(p.pricing.featuresTouched.length).toBeGreaterThan(0);
    }
  });

  it('routes journeys like the hand-written panel: food-only skips workouts, advanced lifters plan training', () => {
    const food = ps.find((p) => p.pricing.segment === 'food-only')!;
    expect(personaRunsJourney(food, journeyById('log-workout'))).toBe(false);
    expect(food.account.history).toBe('food-only');
    const adv = ps.find((p) => p.pricing.segment !== 'food-only' && p.pricing.experienceLevel === 'advanced')!;
    expect(personaRunsJourney(adv, journeyById('plan-training'))).toBe(true);
    const beg = ps.find((p) => p.pricing.experienceLevel === 'beginner')!;
    expect(personaRunsJourney(beg, journeyById('plan-training'))).toBe(false);
  });
});

describe('quotaBalancedSubset', () => {
  const ps = samplePricingPersonas({ n: 100, seed: 1 });
  it('takes N personas spread across segments in proportion', () => {
    const sub = quotaBalancedSubset(ps, 15);
    expect(sub).toHaveLength(15);
    const segs = shares(sub, 'segment');
    expect(Object.keys(segs).sort()).toEqual(['both', 'food-only', 'lifting']);
    expectShares(segs, QUOTAS.segment, 0.1);
    expect(quotaBalancedSubset(ps, 15)).toEqual(sub);
  });
});

describe('allocate / rng', () => {
  it('allocates exactly n by largest remainder', () => {
    expect(allocate(10, { a: 0.45, b: 0.3, c: 0.25 })).toEqual({ a: 5, b: 3, c: 2 });
    expect(Object.values(allocate(7, { a: 1, b: 1, c: 1 })).reduce((s, x) => s + x, 0)).toBe(7);
  });
  it('is seeded', () => {
    const a = rng('x');
    const b = rng('x');
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    expect(rng('y').next()).not.toBe(rng('x').next());
  });
});
