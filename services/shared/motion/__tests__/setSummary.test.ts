import type { CaptureRep } from '../captureAnalysis';
import {
  assessCaptureQuality,
  buildSetCallouts,
  computeVelocityLoss,
  SET_SUMMARY_CONFIG,
  velocityZone,
} from '../setSummary';

function mkRep(
  index: number,
  args: { meanW: number; ecc?: number; dwell?: number | null }
): CaptureRep {
  return {
    index,
    concentric: null as never,
    eccentric: null as never,
    concentricMs: 1000,
    eccentricMs: args.ecc ?? 1000,
    peakW: args.meanW * 1.6,
    meanWConcentric: args.meanW,
    romConcentricDeg: 70,
    romEccentricDeg: 70,
    romGravityDeg: null,
    bottomDwellMs: args.dwell === undefined ? (index === 0 ? null : 100) : args.dwell,
    turnaroundPeakAccelRadps2: null,
  };
}

const fromW = (ws: number[]) => ws.map((w, i) => mkRep(i, { meanW: w }));

describe('computeVelocityLoss', () => {
  it('uses the fastest rep as the baseline (real capture)', () => {
    const ws = [0.64, 0.69, 0.75, 0.69, 0.69, 0.64, 0.67, 0.62, 0.55, 0.42];
    const v = computeVelocityLoss(fromW(ws));
    expect(v.bestIndex).toBe(2); // rep 3
    expect(v.bestMeanW).toBe(0.75);
    expect(v.loss).toBeCloseTo(0.44, 2);
    expect(v.zone).toBe('near-failure');
    expect(v.perRep[2].relative).toBe(1);
    expect(v.perRep[9].relative).toBeCloseTo(0.56, 2);
    expect(v.perRep[0].relative).toBeCloseTo(0.8533, 3);
    expect(v.excludedIndices).toEqual([]);
  });

  it('hides the loss headline below 3 reps but still reports relative velocity', () => {
    const v = computeVelocityLoss(fromW([0.8, 0.6]));
    expect(v.loss).toBeNull();
    expect(v.zone).toBeNull();
    expect(v.bestIndex).toBe(0);
    expect(v.perRep[1].relative).toBeCloseTo(0.75);
  });

  it('excludes and flags reps with missing or non-positive mean velocity', () => {
    const reps = fromW([0.7, 0, 0.8, -0.1, 0.6]);
    reps.push(mkRep(5, { meanW: Number.NaN }));
    const v = computeVelocityLoss(reps);
    expect(v.excludedIndices).toEqual([1, 3, 5]);
    expect(v.perRep[1]).toMatchObject({ excluded: true, relative: null, meanW: null });
    expect(v.bestIndex).toBe(2);
    // Last VALID rep (rep 5, 0.6) is the loss endpoint.
    expect(v.loss).toBeCloseTo(0.25);
  });

  it('returns no baseline when every rep is invalid', () => {
    const v = computeVelocityLoss(fromW([0, 0, 0]));
    expect(v.bestIndex).toBeNull();
    expect(v.loss).toBeNull();
  });

  it('clamps loss at 0 when the last rep is the fastest', () => {
    const v = computeVelocityLoss(fromW([0.5, 0.6, 0.7]));
    expect(v.loss).toBe(0);
    expect(v.zone).toBe('fresh');
  });
});

describe('velocityZone', () => {
  it('maps loss to the configured zones', () => {
    const { hardFrom, nearFailureAbove } = SET_SUMMARY_CONFIG.zones;
    expect(velocityZone(hardFrom - 0.01)).toBe('fresh');
    expect(velocityZone(hardFrom)).toBe('hard');
    expect(velocityZone(nearFailureAbove)).toBe('hard');
    expect(velocityZone(nearFailureAbove + 0.01)).toBe('near-failure');
  });
});

describe('buildSetCallouts', () => {
  it('flags a sharp last-rep drop', () => {
    const ws = [0.64, 0.69, 0.75, 0.69, 0.69, 0.64, 0.67, 0.62, 0.55, 0.42];
    const callouts = buildSetCallouts(fromW(ws));
    expect(callouts.map((c) => c.text)).toEqual([
      'Rep 10 slowed sharply — likely close to failure.',
    ]);
  });

  it('flags the longest pause and the slowest eccentric outlier', () => {
    const reps = [
      mkRep(0, { meanW: 1.0 }),
      mkRep(1, { meanW: 1.0, dwell: 180 }),
      mkRep(2, { meanW: 0.95, ecc: 1600 }), // 1.6x median
      mkRep(3, { meanW: 0.9, dwell: 320 }),
      mkRep(4, { meanW: 0.9 }),
    ];
    const texts = buildSetCallouts(reps).map((c) => c.text);
    expect(texts).toEqual([
      'Rep 3 lowered noticeably slower.',
      'Paused 320 ms before rep 4.',
    ]);
  });

  it('emits nothing for an even set and never more than the configured max', () => {
    expect(buildSetCallouts(fromW([1, 1, 1, 1]))).toEqual([]);
    const busy = [
      mkRep(0, { meanW: 1.0 }),
      mkRep(1, { meanW: 1.0 }),
      mkRep(2, { meanW: 1.0, ecc: 2500, dwell: 400 }),
      mkRep(3, { meanW: 0.4 }),
    ];
    const out = buildSetCallouts(busy);
    expect(out.length).toBeLessThanOrEqual(SET_SUMMARY_CONFIG.callouts.max);
    expect(out.map((c) => c.kind)).toEqual(['sharp-drop', 'slow-eccentric', 'long-pause']);
  });

  it('skips the sharp-drop callout when the loss headline is hidden (< 3 reps)', () => {
    expect(buildSetCallouts(fromW([1.0, 0.4])).some((c) => c.kind === 'sharp-drop')).toBe(false);
  });
});

describe('assessCaptureQuality', () => {
  const clean = { droppedFrames: 0, tier: 'mounted' as const, lowConfidence: false };

  it('passes a clean capture', () => {
    expect(assessCaptureQuality(clean, { stopLatencyMs: 40, latencyWarnMs: 150 })).toEqual([]);
  });

  it('names each failed check', () => {
    const issues = assessCaptureQuality(
      { droppedFrames: 3, tier: 'handheld', lowConfidence: true },
      { stopLatencyMs: 400, latencyWarnMs: 150 }
    );
    expect(issues.map((i) => i.label)).toEqual([
      '3 dropped samples',
      'Phone not mounted',
      'Motion not single-axis',
      'Sensor lagging',
    ]);
    expect(assessCaptureQuality({ ...clean, tier: 'none' })[0].label).toBe('No still reference');
  });
});
