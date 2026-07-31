import { processMotionSamples, type MotionPipelineInput } from '../pipeline';
import { generateFromProfile, generateReps, type SyntheticRepSpec } from './synthetic';
import { INTEGRITY_MAX_ERROR_DEG } from '../constants';

const MOUNT_RADIUS_MM = 300;

function inputFrom(signal: ReturnType<typeof generateReps>): MotionPipelineInput {
  return {
    samples: signal.samples,
    pivotAxis: signal.axis,
    gravityRefBottom: signal.gBottom,
    mountRadiusMm: MOUNT_RADIUS_MM,
  };
}

const cleanRep: SyntheticRepSpec = {
  romDeg: 40,
  concentricMs: 1200,
  pauseTopMs: 400,
  eccentricMs: 1500,
  restAfterMs: 1500,
};

describe('processMotionSamples', () => {
  it('integrates a known constant angular velocity to the right angle', () => {
    // Triangle rep: constant +0.5 rad/s for 1 s up, pause, constant −0.5 down.
    const OMEGA = 0.5;
    const signal = generateFromProfile([
      { durMs: 1000, theta: () => 0, omega: () => 0 },
      { durMs: 1000, theta: (p) => OMEGA * p, omega: () => OMEGA },
      { durMs: 500, theta: () => OMEGA, omega: () => 0 },
      { durMs: 1000, theta: (p) => OMEGA * (1 - p), omega: () => -OMEGA },
      { durMs: 1500, theta: () => 0, omega: () => 0 },
    ]);
    const result = processMotionSamples(inputFrom(signal));

    expect(result.reps).toHaveLength(1);
    const rep = result.reps[0];
    expect(rep.rejected).toBe(false);
    // ROM = ω·T = 0.5 rad ≈ 28.65°
    expect(rep.romDegrees).toBeCloseTo(28.65, 0);
    expect(rep.concentricMs).toBeGreaterThan(900);
    expect(rep.concentricMs).toBeLessThan(1100);
    expect(rep.peakAngularVelocity_radps).toBeCloseTo(OMEGA, 1);
    // Mean over the moving samples of a constant-rate stroke ≈ the rate
    // (ramp edges from hysteresis backtracking pull it down slightly).
    expect(rep.meanAngularVelocity_radps).toBeGreaterThan(0.9 * OMEGA);
    // Handle velocity = r × mean ω, r = 0.3 m.
    expect(rep.meanHandleVelocity_mps).toBeCloseTo(0.3 * rep.meanAngularVelocity_radps, 6);
  });

  it('detects and measures a set of smooth (sinusoid-profile) reps', () => {
    const signal = generateReps(Array(5).fill(cleanRep), { gyroNoise: 0.01 });
    const result = processMotionSamples(inputFrom(signal));

    expect(result.reps).toHaveLength(5);
    for (const rep of result.reps) {
      expect(rep.rejected).toBe(false);
      expect(rep.romDegrees).toBeGreaterThan(38);
      expect(rep.romDegrees).toBeLessThan(42);
      expect(rep.concentricMs).toBeGreaterThan(1000);
      expect(rep.concentricMs).toBeLessThan(1400);
      expect(rep.eccentricMs).toBeGreaterThan(1300);
      expect(rep.eccentricMs).toBeLessThan(1700);
      expect(rep.gyroAngle_vs_gravityAngle_errorDeg).not.toBeNull();
      expect(rep.gyroAngle_vs_gravityAngle_errorDeg!).toBeLessThan(INTEGRITY_MAX_ERROR_DEG);
    }
    expect(result.clipDetected).toBe(false);
    expect(result.qualityFlags).not.toContain('no-reps-detected');
    expect(result.sampleRateHzMean).toBeGreaterThan(95);
  });

  it('subtracts a constant gyro bias estimated from the quiet period', () => {
    const signal = generateReps(Array(3).fill(cleanRep), { gyroBias: 0.03, gyroNoise: 0.005 });
    const result = processMotionSamples(inputFrom(signal));
    expect(result.reps).toHaveLength(3);
    for (const rep of result.reps) {
      expect(rep.rejected).toBe(false);
      expect(rep.romDegrees).toBeGreaterThan(38);
      expect(rep.romDegrees).toBeLessThan(42);
    }
  });

  it('ZUPT bounds drift that would otherwise reject reps (injected bias ramp)', () => {
    // Bias drifts 0 → 0.04 rad/s across the capture (≈2.3°/s at the end) —
    // far past the initial estimate. Without ZUPT the integrated angle walks
    // off; with ZUPT every rest interval re-zeros bias and drift.
    const drift = (tMs: number) => 0.04 * (tMs / 16000);
    const reps = Array(4).fill(cleanRep);

    const withZupt = processMotionSamples(
      inputFrom(generateReps(reps, { gyroBias: drift, gyroNoise: 0.005 }))
    );
    expect(withZupt.reps).toHaveLength(4);
    expect(withZupt.zuptCount).toBeGreaterThan(0);
    for (const rep of withZupt.reps) {
      expect(rep.rejected).toBe(false);
      expect(rep.gyroAngle_vs_gravityAngle_errorDeg!).toBeLessThan(INTEGRITY_MAX_ERROR_DEG);
    }

    const withoutZupt = processMotionSamples(
      inputFrom(generateReps(reps, { gyroBias: drift, gyroNoise: 0.005 })),
      { zuptEnabled: false }
    );
    // The drift the ZUPT was bounding is now visible to the integrity check:
    // at least the later reps must disagree with gravity beyond the limit.
    const rejected = withoutZupt.reps.filter((r) => r.rejected);
    expect(rejected.length).toBeGreaterThan(0);
    expect(
      rejected.some((r) => /forward-prediction|under-read/.test(r.rejectReason ?? ''))
    ).toBe(true);
  });

  it('rejects a rep containing an accelerometer clipping spike, keeps the rest', () => {
    // Rep timeline: lead-in 1000, rep duration 4600 each. Spike mid-rep-2.
    const spikeT = 1000 + 4600 + 2000;
    const signal = generateReps(Array(3).fill(cleanRep), {
      accelSpikes: [{ tMs: spikeT, valueMps2: 160 }],
    });
    const result = processMotionSamples(inputFrom(signal));

    expect(result.clipDetected).toBe(true);
    expect(result.qualityFlags).toContain('clipping-detected');
    expect(result.reps).toHaveLength(3);
    expect(result.reps[1].rejected).toBe(true);
    expect(result.reps[1].rejectReason).toMatch(/clipped/);
    expect(result.reps[0].rejected).toBe(false);
    expect(result.reps[2].rejected).toBe(false);
  });

  it('forward-prediction rejects reps when the gyro silently over-reads', () => {
    // A 15% gyro scale error on a 40° rep = 6° endpoint disagreement — the
    // exact "silently wrong data" failure the check exists to catch.
    const signal = generateReps(Array(3).fill(cleanRep), { gyroScale: 1.15 });
    const result = processMotionSamples(inputFrom(signal));

    expect(result.reps.length).toBeGreaterThan(0);
    for (const rep of result.reps) {
      expect(rep.rejected).toBe(true);
      expect(rep.rejectReason).toMatch(/forward-prediction/);
      expect(rep.gyroAngle_vs_gravityAngle_errorDeg!).toBeGreaterThan(INTEGRITY_MAX_ERROR_DEG);
    }
  });

  it('the gravity lower-bound invariant hard-rejects an under-reading gyro', () => {
    // Under-integration (wrong axis / wrong units / dropped samples): the
    // integrated angle lands BELOW what gravity alone proves — definitive
    // evidence, surfaced as a hard per-rep error.
    const signal = generateReps(Array(3).fill(cleanRep), { gyroScale: 0.7 });
    const result = processMotionSamples(inputFrom(signal));

    expect(result.reps.length).toBeGreaterThan(0);
    const underRead = result.reps.filter((r) => /under-read.*definitively wrong/.test(r.rejectReason ?? ''));
    expect(underRead.length).toBeGreaterThan(0);
    for (const rep of result.reps) expect(rep.rejected).toBe(true);
  });

  it('returns no reps (flagged) for an all-quiet capture', () => {
    const signal = generateReps([], { leadInMs: 4000 });
    const result = processMotionSamples(inputFrom(signal));
    expect(result.reps).toHaveLength(0);
    expect(result.qualityFlags).toContain('no-reps-detected');
  });

  it('verifies integrity via the strict-window fallback on brief (220 ms) turnarounds', () => {
    // 220 ms at the bottom between reps: too short to register as a rest
    // interval (>250 ms) but long enough for a validated gravity-reference
    // window (>=200 ms), so the fallback path must carry the check.
    const brief: SyntheticRepSpec = { ...cleanRep, restAfterMs: 220 };
    const signal = generateReps(
      [brief, brief, { ...cleanRep, restAfterMs: 2000 }],
      { gyroNoise: 0.005 }
    );
    const result = processMotionSamples(inputFrom(signal));

    expect(result.reps).toHaveLength(3);
    for (const rep of result.reps) {
      expect(rep.rejected).toBe(false);
      expect(rep.gyroAngle_vs_gravityAngle_errorDeg).not.toBeNull();
      expect(rep.gyroAngle_vs_gravityAngle_errorDeg!).toBeLessThan(INTEGRITY_MAX_ERROR_DEG);
    }
  });

  it('rejects reps whose endpoints never hold still for the 200 ms gravity window', () => {
    // Brisk touch-and-go: ~60 ms turnarounds with fast strokes leave well
    // under 200 ms below the 5 °/s stillness bound at each endpoint, so no
    // gravity reference may be issued — the reps must be rejected with the
    // stillness hint, never verified against a dynamic sample.
    const touchAndGo: SyntheticRepSpec = {
      romDeg: 40,
      concentricMs: 800,
      pauseTopMs: 60,
      eccentricMs: 800,
      restAfterMs: 60,
    };
    const signal = generateReps([touchAndGo, touchAndGo], { gyroNoise: 0.005 });
    const result = processMotionSamples(inputFrom(signal));

    const rejected = result.reps.filter((r) => r.rejected);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.some((r) => /still moving/.test(r.rejectReason ?? ''))).toBe(true);
  });

  it('never accepts a dynamic sample as a gravity reference (accel off at rests)', () => {
    // Rest windows exist and pass loose gating, but |a| sits ~0.5 m/s² off
    // gravity — outside the strict ±0.3 m/s² bound. Every endpoint gravity
    // reference must be refused and the reps rejected with the hint.
    const signal = generateReps(Array(3).fill(cleanRep), { restAccelScale: 1.05 });
    const result = processMotionSamples(inputFrom(signal));

    expect(result.reps.length).toBeGreaterThan(0);
    for (const rep of result.reps) {
      expect(rep.rejected).toBe(true);
      expect(rep.rejectReason).toMatch(/still moving/);
    }
    // And the ZUPT drift snap must not have consumed those unverified
    // directions either — θ never snaps to a gravity vector the strict
    // validator refused.
    expect(result.zuptCount).toBe(0);
  });

  it('returns an empty flagged result for a uselessly short sample buffer', () => {
    const signal = generateReps([cleanRep]);
    const result = processMotionSamples({ ...inputFrom(signal), samples: signal.samples.slice(0, 5) });
    expect(result.reps).toHaveLength(0);
    expect(result.qualityFlags).toContain('no-reps-detected');
    expect(result.durationMs).toBe(0);
  });

  it('counts dropped samples from measured dt gaps', () => {
    const signal = generateReps([cleanRep]);
    // Remove a 100 ms chunk mid-signal to simulate a main-thread stall.
    const gapStart = signal.samples.findIndex((s) => s.tMs > 2000);
    const samples = [...signal.samples.slice(0, gapStart), ...signal.samples.slice(gapStart + 10)];
    const result = processMotionSamples({ ...inputFrom(signal), samples });
    expect(result.droppedSampleCount).toBeGreaterThanOrEqual(9);
  });
});
