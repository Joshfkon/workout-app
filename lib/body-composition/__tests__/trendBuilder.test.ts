import {
  buildPersonalizedBodyCompTrend,
  type TrendDexaRow,
  type TrendProfileRows,
  type TrendWaistRow,
  type TrendWeightRow,
} from '@/lib/body-composition/trendBuilder';
import { buildAnchoredBodyCompTrend } from '@/services/bodyCompAnchor';
import { computeWaistTrend } from '@/services/waistTrend';
import { cmToIn, inputWeightToKg } from '@/lib/utils';

const HEIGHT_CM = 188;

// Bulk history with two clean, strongly lean-dominant surplus pairs
// (fat fractions ≈ 0.23 / 0.20 → learned lean split ≈ 0.63, far enough from
// the 0.5 default that the projection shift survives the trend's 0.1 kg
// rounding) and weigh-ins after the newest scan — the segment the
// personalization steers.
const scans: TrendDexaRow[] = [
  { scan_date: '2025-11-20', body_fat_percent: 19.6, lean_mass_kg: 58.0, fat_mass_kg: 15.0, weight_kg: 76.5, bone_mass_kg: 3.1 },
  { scan_date: '2026-03-10', body_fat_percent: 19.7, lean_mass_kg: 60.0, fat_mass_kg: 15.6, weight_kg: 79.1, bone_mass_kg: 3.1 },
  { scan_date: '2026-07-05', body_fat_percent: 19.7, lean_mass_kg: 62.0, fat_mass_kg: 16.1, weight_kg: 81.6, bone_mass_kg: 3.1 },
];

const weights: TrendWeightRow[] = [
  { logged_at: '2026-01-15', weight: 171.5, unit: 'lb' },
  { logged_at: '2026-05-10', weight: 178.0, unit: 'lb' },
  { logged_at: '2026-07-12', weight: 183.0, unit: 'lb' },
  { logged_at: '2026-07-18', weight: 184.3, unit: 'lb' },
];

const waist: TrendWaistRow[] = [
  { logged_at: '2026-04-01', waist: 84.0 },
  { logged_at: '2026-05-01', waist: 84.6 },
  { logged_at: '2026-06-01', waist: 85.1 },
];

const bulkProfile: TrendProfileRows = {
  user: { height_cm: HEIGHT_CM, goal: 'bulk', sex: 'male', age: 32 },
  volumeProfile: { training_age: 'intermediate', is_enhanced: false },
};

/** The pre-personalization pipeline, byte-for-byte (old call-site code). */
function legacyTrend(includeWaist: boolean) {
  return buildAnchoredBodyCompTrend(
    weights.map((row) => ({
      date: row.logged_at,
      weightKg: inputWeightToKg(Number(row.weight), row.unit ?? 'lb'),
    })),
    scans.map((scan) => ({
      date: scan.scan_date,
      bodyFatPercent: Number(scan.body_fat_percent),
      leanMassKg: Number(scan.lean_mass_kg),
      fatMassKg: Number(scan.fat_mass_kg),
      weightKg: scan.weight_kg != null ? Number(scan.weight_kg) : undefined,
      boneMassKg: scan.bone_mass_kg != null ? Number(scan.bone_mass_kg) : null,
    })),
    includeWaist
      ? {
          waistTrend: computeWaistTrend(
            waist
              .filter((r) => r.waist != null)
              .map((r) => ({ date: r.logged_at, waistIn: cmToIn(Number(r.waist)) }))
          )
            .filter((p) => !p.isOutlier)
            .map((p) => ({ date: p.date, trendIn: p.trendIn })),
        }
      : {}
  );
}

describe('buildPersonalizedBodyCompTrend', () => {
  it('is deterministic — both call sites get identical output for identical rows', () => {
    const a = buildPersonalizedBodyCompTrend({ weights, scans, waist, profile: bulkProfile });
    const b = buildPersonalizedBodyCompTrend({ weights, scans, waist, profile: bulkProfile });
    expect(b.trend).toEqual(a.trend);
    expect(b.projection).toEqual(a.projection);
  });

  it('no usable history → trend byte-identical to the pre-change pipeline', () => {
    // Maintenance goal: personalization must not engage.
    const result = buildPersonalizedBodyCompTrend({
      weights,
      scans,
      waist,
      profile: {
        user: { ...bulkProfile.user!, goal: 'maintenance' },
        volumeProfile: bulkProfile.volumeProfile,
      },
    });
    expect(result.projection).toBeNull();
    expect(result.trend).toEqual(legacyTrend(true));
  });

  it('missing profile rows → projection off, trend still builds (pre-change output)', () => {
    const result = buildPersonalizedBodyCompTrend({ weights, scans, waist, profile: null });
    expect(result.projection).toBeNull();
    expect(result.trend).toEqual(legacyTrend(true));

    const noVolume = buildPersonalizedBodyCompTrend({
      weights,
      scans,
      waist,
      profile: { user: bulkProfile.user, volumeProfile: null },
    });
    // Personalization can still engage from users-row data alone; training
    // age just falls back inside the heuristic. Trend stays well-formed.
    expect(noVolume.trend.length).toBe(result.trend.length);
  });

  it('with usable history: ONLY the post-latest-scan points move', () => {
    const personalized = buildPersonalizedBodyCompTrend({
      weights,
      scans,
      waist,
      profile: bulkProfile,
    });
    expect(personalized.projection).not.toBeNull();
    expect(personalized.projection!.direction).toBe('surplus');
    expect(personalized.projection!.leanRatio).toBeGreaterThan(0.5);

    const baseline = legacyTrend(true);
    expect(personalized.trend.length).toBe(baseline.length);
    for (let i = 0; i < baseline.length; i++) {
      const b = baseline[i];
      const p = personalized.trend[i];
      expect(p.date).toBe(b.date);
      if (p.date > '2026-07-05') {
        // Learned bulk split (> 0.5 lean) → more of the +gain lands on lean,
        // less on fat, than the neutral default.
        expect(p.leanMassKg).toBeGreaterThan(b.leanMassKg);
        expect(p.fatMassKg).toBeLessThan(b.fatMassKg);
        expect(p.weightKg).toBe(b.weightKg);
      } else {
        expect(p).toEqual(b);
      }
    }
  });

  it('waist rows shape the interior identically to the legacy client pipeline', () => {
    // Same rows with and without waist: interiors differ (bend), while scan
    // anchors stay exact — proving waist flows through the shared builder
    // the same way the Body tab used to wire it.
    const withWaist = buildPersonalizedBodyCompTrend({
      weights,
      scans,
      waist,
      profile: null,
    });
    const withoutWaist = buildPersonalizedBodyCompTrend({
      weights,
      scans,
      waist: [],
      profile: null,
    });
    expect(withWaist.trend).toEqual(legacyTrend(true));
    expect(withoutWaist.trend).toEqual(legacyTrend(false));
    const anchorsA = withWaist.trend.filter((p) => p.kind === 'dexa');
    const anchorsB = withoutWaist.trend.filter((p) => p.kind === 'dexa');
    expect(anchorsA).toEqual(anchorsB);
  });
});
