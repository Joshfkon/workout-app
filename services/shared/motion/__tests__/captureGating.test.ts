import { analyzeCapture, type CaptureAnalysis, type CaptureRep } from '../captureAnalysis';
import { captureUnclearLine, gateCapture } from '../captureGating';
import { buildObservations } from '../observations';
import { buildSetCallouts, computeVelocityLoss } from '../setSummary';
import { generateReps, type SyntheticRepSpec } from './synthetic';

const rep = (over: Partial<SyntheticRepSpec> = {}): SyntheticRepSpec => ({
  romDeg: 60,
  concentricMs: 1000,
  pauseTopMs: 300,
  eccentricMs: 1300,
  restAfterMs: 600,
  ...over,
});

const analyze = (reps: SyntheticRepSpec[]) =>
  analyzeCapture(generateReps(reps, { gyroNoise: 0.005, sampleRateHz: 60 }).samples);

describe('gateCapture — regression: 18,710 ms gap, 20 detected vs 15 logged', () => {
  // 5 setup strokes, an 18.71 s pause (re-seat / rest), then the 15-rep set.
  const specs = [
    ...Array.from({ length: 4 }, () => rep()),
    rep({ restAfterMs: 18_710 }),
    ...Array.from({ length: 15 }, () => rep()),
  ];
  const analysis = analyze(specs);

  it('the detector really sees 20 reps and an ~18.7 s dwell (the old failure input)', () => {
    expect(analysis.reps).toHaveLength(20);
    expect(Math.max(...analysis.reps.map((r) => r.bottomDwellMs ?? 0))).toBeGreaterThan(18_000);
  });

  it('splits at the pause, keeps the 15-rep block, and comes out LOW confidence', () => {
    const g = gateCapture(analysis, 15);
    expect(g.rawRepCount).toBe(20);
    expect(g.reps).toHaveLength(15);
    expect(g.splitPauseMs).toBeGreaterThan(18_000);
    expect(g.confidence).toBe('low');
    expect(captureUnclearLine(g)).toMatch(/^Capture unclear: paused 18\.\d s mid-capture\. Logged reps used\.$/);
  });

  it('never reports the pause as a dwell anywhere downstream', () => {
    const g = gateCapture(analysis, 15);
    for (const r of g.reps) expect(r.bottomDwellMs ?? 0).toBeLessThan(5_000);
    const text = [
      ...buildSetCallouts(g.reps, computeVelocityLoss(g.reps)).map((c) => c.text),
      ...buildObservations(g.reps).lines,
    ].join('\n');
    expect(text).not.toMatch(/18\s?\d{3}\s?ms|18710/);
  });

  it('flags the count mismatch when the pause is not there to split on', () => {
    const g = gateCapture(analyze(Array.from({ length: 20 }, () => rep())), 15);
    expect(g.splitPauseMs).toBeNull();
    expect(g.confidence).toBe('low');
    expect(g.lowReasons[0]).toBe('sensor counted 20 reps, you logged 15');
  });
});

describe('gateCapture — rules', () => {
  /** Minimal reps with contiguous spans on a synthetic time base. */
  function mk(roms: number[], gapsMs: number[] = []): CaptureAnalysis {
    const tMs: number[] = [];
    let t = 0;
    const reps: CaptureRep[] = roms.map((rom, i) => {
      t += gapsMs[i] ?? 300;
      const start = tMs.push(t) - 1;
      t += 2000;
      const end = tMs.push(t) - 1;
      return {
        index: i,
        concentric: { dir: 1, startIdx: start, endIdx: start, durationMs: 1000, romDeg: rom, peakW: 1, meanW: 0.8, romGravityDeg: null },
        eccentric: { dir: -1, startIdx: end, endIdx: end, durationMs: 1000, romDeg: rom, peakW: 1, meanW: 0.8, romGravityDeg: null },
        concentricMs: 1000,
        eccentricMs: 1000,
        peakW: 1,
        meanWConcentric: 0.8,
        romConcentricDeg: rom,
        romEccentricDeg: rom,
        romGravityDeg: null,
        bottomDwellMs: i === 0 ? null : gapsMs[i] ?? 300,
        turnaroundPeakAccelRadps2: i === 0 ? null : 2,
      };
    });
    return { reps, tMs } as unknown as CaptureAnalysis;
  }

  it('a clean set matching the log is confident', () => {
    const g = gateCapture(mk(Array(10).fill(60)), 10);
    expect(g.confidence).toBe('ok');
    expect(g.reps).toHaveLength(10);
    expect(captureUnclearLine(g)).toBeNull();
  });

  it('tolerates a mismatch within 2 reps / 15%', () => {
    expect(gateCapture(mk(Array(13).fill(60)), 15).confidence).toBe('ok');
    expect(gateCapture(mk(Array(12).fill(60)), 15).confidence).toBe('low');
    // 15% binds before 2 on a short set: 5 logged, 4 counted → 20% → low.
    expect(gateCapture(mk(Array(4).fill(60)), 5).confidence).toBe('low');
  });

  it('drops partials from the count and velocity; > 25% partials is low confidence', () => {
    const one = gateCapture(mk([60, 60, 60, 60, 60, 60, 60, 25]), 7);
    expect(one.partialRepCount).toBe(1);
    expect(one.reps).toHaveLength(7);
    expect(one.confidence).toBe('ok');

    const many = gateCapture(mk([60, 60, 60, 60, 60, 25, 20, 20]), 5);
    expect(many.partialRepCount).toBe(3);
    expect(many.confidence).toBe('low');
    expect(many.lowReasons).toContain('3 of 8 movements were partial');
  });

  it('keeps the longest block, re-indexes, and strips the pause from its first rep', () => {
    const g = gateCapture(mk(Array(9).fill(60), [300, 300, 300, 7000]), null);
    expect(g.reps).toHaveLength(6);
    expect(g.reps.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(g.reps[0].bottomDwellMs).toBeNull();
    expect(g.reps[0].turnaroundPeakAccelRadps2).toBeNull();
    expect(g.splitPauseMs).toBe(7000);
  });
});
