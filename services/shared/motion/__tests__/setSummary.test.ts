import { assessCaptureQuality, computeVelocityLoss, effortZone } from '../setSummary';
import { MOTION_SET_CONFIG } from '../motionSetConfig';

const fromW = (ws: number[]) => ws.map((meanW, i) => ({ n: i + 1, meanW }));

describe('computeVelocityLoss (baseline = faster of first two clean reps)', () => {
  it('regression: clean reps of the setup-stroke capture → ≈ 0% loss', () => {
    const v = computeVelocityLoss(fromW([0.56, 0.52, 0.61, 0.61, 0.65, 0.64, 0.55, 0.64]));
    expect(v.baselineRep).toBe(1);
    expect(v.baselineW).toBe(0.56);
    expect(v.endW).toBeCloseTo(0.595);
    expect(v.loss).toBe(0); // ended faster than it started → floored
    expect(v.zone).toBe('easy');
  });

  it('averages the last two reps so one sloppy final rep cannot dominate', () => {
    const ws = [0.64, 0.69, 0.75, 0.69, 0.69, 0.64, 0.67, 0.62, 0.55, 0.42];
    const v = computeVelocityLoss(fromW(ws));
    expect(v.baselineRep).toBe(2); // 0.69 > 0.64
    expect(v.loss).toBeCloseTo((0.69 - (0.55 + 0.42) / 2) / 0.69, 5); // ≈ 29.7%
    expect(v.zone).toBe('moderate');
    expect(v.perRep[2].relative).toBeCloseTo(0.75 / 0.69); // can exceed 1
  });

  it('hides loss under 3 reps and excludes non-positive velocities', () => {
    expect(computeVelocityLoss(fromW([0.8, 0.6])).loss).toBeNull();
    const v = computeVelocityLoss(fromW([0, 0.7, 0.8, -0.1, 0.6, 0.5]));
    expect(v.excludedReps).toEqual([1, 4]);
    expect(v.baselineRep).toBe(3); // first two VALID reps are 2 and 3
    expect(v.loss).toBeCloseTo((0.8 - 0.55) / 0.8);
  });
});

describe('effortZone', () => {
  it('maps the configured zones', () => {
    const z = MOTION_SET_CONFIG.coach.effortZones;
    expect(effortZone(z.easyBelow - 0.01)).toBe('easy');
    expect(effortZone(z.easyBelow)).toBe('moderate');
    expect(effortZone(z.moderateBelow)).toBe('hard');
    expect(effortZone(z.hardUpTo)).toBe('hard');
    expect(effortZone(z.hardUpTo + 0.01)).toBe('near-failure');
  });
});

describe('assessCaptureQuality', () => {
  const clean = { droppedFrames: 0, tier: 'mounted' as const, pc1VarianceShare: 0.95 };

  it('passes a clean capture', () => {
    expect(assessCaptureQuality(clean, { stopLatencyMs: 40, latencyWarnMs: 150 })).toEqual([]);
  });

  it('uses the post-cleaning PC1 share when given', () => {
    const raw = { ...clean, pc1VarianceShare: 0.7 };
    expect(assessCaptureQuality(raw).map((i) => i.key)).toEqual(['pc1']);
    expect(assessCaptureQuality(raw, { pc1Share: 0.9 })).toEqual([]);
  });

  it('names each failed check', () => {
    const issues = assessCaptureQuality(
      { droppedFrames: 3, tier: 'handheld', pc1VarianceShare: 0.6 },
      { stopLatencyMs: 400, latencyWarnMs: 150 }
    );
    expect(issues.map((i) => i.label)).toEqual([
      '3 dropped samples',
      'Phone not mounted',
      'Motion in more than one direction',
      'Sensor lagging',
    ]);
  });
});
