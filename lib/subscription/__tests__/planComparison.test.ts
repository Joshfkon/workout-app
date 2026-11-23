import { TIER_FEATURES } from '@/lib/stripe';
import { planComparisonRows, planFeatureList } from '../planComparison';

describe('plan comparison (from TIER_FEATURES)', () => {
  it('lists every plan feature once, with no roll-up lines', () => {
    const rows = planComparisonRows();
    const own = (['free', 'pro', 'elite'] as const).flatMap((tier) =>
      TIER_FEATURES[tier].features.filter((f) => !f.startsWith('Everything in'))
    );
    expect(rows.map((r) => r.feature)).toEqual(own);
    expect(new Set(own).size).toBe(own.length);
  });

  it('gives each higher plan everything below it', () => {
    const rows = planComparisonRows();
    const row = (feature: string) => rows.find((r) => r.feature === feature);
    expect(row('Exercise history')).toEqual({ feature: 'Exercise history', free: true, pro: true, elite: true });
    expect(row('AI mesocycle builder')).toEqual({ feature: 'AI mesocycle builder', free: false, pro: true, elite: true });
    expect(row('AI Coach (personalized advice)')).toMatchObject({ free: false, pro: false, elite: true });
  });

  it('never sells a feature no plan lists', () => {
    const all = planComparisonRows().map((r) => r.feature);
    expect(all).not.toContain('DEXA scan tracking');
  });

  it('per-plan lists are the TIER_FEATURES lists', () => {
    expect(planFeatureList('pro')).toEqual([...TIER_FEATURES.pro.features]);
  });
});
