import { analyzeCapture } from '../captureAnalysis';
import { deriveCalibrationFromAnalysis } from '../calibration';
import { angleBetweenUnit, normalize, scale } from '../vec3';
import { G_MPS2, RAD_TO_DEG } from '../constants';
import { generateReps, generateSweepSignal, type SyntheticRepSpec } from './synthetic';

const SKEWED_AXIS = normalize({ x: 1, y: 1, z: 1 })!;
const G_BOTTOM = scale(normalize({ x: 2, y: -8, z: -5 })!, G_MPS2);

const slowRep: SyntheticRepSpec = {
  romDeg: 72,
  concentricMs: 2000,
  pauseTopMs: 600,
  eccentricMs: 2000,
  restAfterMs: 1500,
};

const sweepOpts = { axis: SKEWED_AXIS, gBottom: G_BOTTOM, gyroNoise: 0.004 };

function derive(samples: ReturnType<typeof generateReps>['samples']) {
  return deriveCalibrationFromAnalysis(analyzeCapture(samples), samples);
}

describe('deriveCalibrationFromAnalysis', () => {
  it('is eligible for a clean mounted sweep, with axis and ROM recovered', () => {
    const signal = generateSweepSignal(Array(3).fill(slowRep), sweepOpts);
    const result = derive(signal.samples);

    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
    const axisErrDeg = angleBetweenUnit(result.pivotAxis!, SKEWED_AXIS) * RAD_TO_DEG;
    expect(axisErrDeg).toBeLessThan(3);
    expect(Math.abs(result.romDegrees! - 72)).toBeLessThan(3);
    expect(result.axisQuality!).toBeGreaterThan(5);
    expect(result.gravityRefBottom).not.toBeNull();
    expect(result.gravityRefTop).not.toBeNull();
    // Endpoint refs must actually differ (bottom vs top of the stroke) and
    // by no more than the gyro ROM (gravity is a lower bound).
    const gravSpanDeg =
      angleBetweenUnit(result.gravityRefBottom!, result.gravityRefTop!) * RAD_TO_DEG;
    expect(gravSpanDeg).toBeGreaterThan(20);
    expect(gravSpanDeg).toBeLessThanOrEqual(result.romDegrees! + 3);
  });

  it("tier 'none' blocks saving and says the phone appears hand-held (not 'hold still longer')", () => {
    // Rests exist but the gyro never settles under the handheld bound —
    // constant slow rotation rides on everything.
    const signal = generateReps(Array (3).fill(slowRep), { gyroNoise: 0.02, gyroBias: 0.3 });
    const analysis = analyzeCapture(signal.samples);
    const result = deriveCalibrationFromAnalysis(analysis, signal.samples);

    expect(analysis.tier).toBe('none');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/hand-?held|no still period/i);
    expect(result.reason).not.toMatch(/hold still longer/i);
    // The analysis itself still delivered reps and velocity.
    expect(analysis.reps).toHaveLength(3);
  });

  it('reports hand-held appearance specifically when still-ish windows were too noisy', () => {
    // Gyro tremor above the mounted bound but inside the handheld band
    // during rests, while the accel direction wanders (loose grip): still
    // windows exist, but the ~5° cone fails.
    const signal = generateReps(Array(3).fill(slowRep), {
      gyroNoise: 0.08,
      restAccelScale: 1.0,
    });
    // Corrupt accel direction during rests: add a slow direction wobble.
    const samples = signal.samples.map((s, i) => ({
      ...s,
      accel: {
        x: s.accel.x + 2.2 * Math.sin(i / 20),
        y: s.accel.y + 2.2 * Math.cos(i / 26),
        z: s.accel.z,
      },
    }));
    const analysis = analyzeCapture(samples);
    if (analysis.tier === 'none') {
      const result = deriveCalibrationFromAnalysis(analysis, samples);
      expect(result.reason).toMatch(/hand-?held/i);
    } else {
      // If a clean sub-window survived the wobble, handheld is the correct
      // outcome — the point is it must never claim 'mounted'.
      expect(analysis.tier).toBe('handheld');
    }
  });

  it('rejects multi-DOF motion with a planarity reason, not a stillness one', () => {
    const signal = generateSweepSignal(Array(3).fill(slowRep), {
      ...sweepOpts,
      crossAxisWobble: { amplitudeRadps: 0.95, freqHz: 1.7 },
    });
    const result = derive(signal.samples);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/axis quality/i);
  });

  it('enforces the calibration axis-quality contract, not the display-confidence 0.8', () => {
    // Moderate wobble: PC1 share sits ABOVE the 0.8 display threshold (no
    // low-confidence label) but axis quality λ1/(λ2+λ3) is below the
    // calibration contract's AXIS_QUALITY_MIN — saving must still refuse.
    const signal = generateSweepSignal(Array(3).fill(slowRep), {
      ...sweepOpts,
      crossAxisWobble: { amplitudeRadps: 0.45, freqHz: 1.7 },
    });
    const analysis = analyzeCapture(signal.samples);
    expect(analysis.pc1VarianceShare).toBeGreaterThan(0.8); // not display-flagged
    expect(analysis.lowConfidence).toBe(false);
    const result = deriveCalibrationFromAnalysis(analysis, signal.samples);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/axis quality/i);
  });

  it('refuses endpoint gravity refs that were never validated as still', () => {
    // Mounted lead-in gives a qualifying stillness window, but the reps are
    // touch-and-go: no strict rest at the tops, so the persisted gravity
    // references cannot be read — saving must refuse with the pause hint,
    // never average turnaround dynamics into a "gravity" vector.
    const touchAndGo: SyntheticRepSpec = {
      romDeg: 72,
      concentricMs: 1500,
      pauseTopMs: 60,
      eccentricMs: 1500,
      restAfterMs: 60,
    };
    const signal = generateSweepSignal(
      [touchAndGo, touchAndGo, { ...touchAndGo, restAfterMs: 1500 }],
      sweepOpts
    );
    const result = derive(signal.samples);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/held still|pause/i);
  });

  it('requires at least 2 reps', () => {
    const signal = generateSweepSignal([slowRep], sweepOpts);
    const result = derive(signal.samples);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/2 /);
  });

  it('handles an empty/motionless capture without axis or quality', () => {
    const signal = generateReps([], { leadInMs: 4000 });
    const result = derive(signal.samples);
    expect(result.eligible).toBe(false);
    expect(result.pivotAxis).toBeNull();
    expect(result.axisQuality).toBeNull();
    expect(result.reason).toMatch(/2 /);
  });
});
