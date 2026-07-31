import { deriveSweepCalibration } from '../calibration';
import { angleBetweenUnit, dot, normalize, scale } from '../vec3';
import { AXIS_QUALITY_MIN, G_MPS2, RAD_TO_DEG } from '../constants';
import { generateSweepSignal, type SyntheticRepSpec } from './synthetic';

// THE case the old two-hold derivation failed: a pivot axis skewed 45° from
// every phone axis (and far from perpendicular to gravity), where the
// minimal-rotation axis under-projects the gyro (field test: 47.4° gyro vs
// 72.0° gravity). The scatter-matrix estimate must nail it.
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

describe('deriveSweepCalibration', () => {
  it('recovers a 45°-skewed axis within 2° and the ROM within 1°', () => {
    const signal = generateSweepSignal(Array(3).fill(slowRep), sweepOpts);
    const result = deriveSweepCalibration(signal.samples);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
    // Axis within 2° of truth, sign resolved so concentric is positive.
    const axisErrDeg = angleBetweenUnit(result.pivotAxis!, SKEWED_AXIS) * RAD_TO_DEG;
    expect(axisErrDeg).toBeLessThan(2);
    expect(dot(result.pivotAxis!, SKEWED_AXIS)).toBeGreaterThan(0);
    // ROM within 1°.
    expect(Math.abs(result.romDegrees! - 72)).toBeLessThan(1);
    // 3 reps = 6 strokes.
    expect(result.strokeCount).toBe(6);
    // A clean single-DOF sweep is overwhelmingly planar.
    expect(result.axisQuality!).toBeGreaterThan(AXIS_QUALITY_MIN);
    expect(result.maxGravityResidualDeg!).toBeLessThan(3);
    expect(result.gravityRefBottom).not.toBeNull();
    expect(result.gravityRefTop).not.toBeNull();
  });

  it('discards in-hand handling: the estimate matches a handling-free sweep', () => {
    // Handling is fast multi-axis rotation; if it leaked into the scatter it
    // would both skew the axis and crater the quality metric.
    const signal = generateSweepSignal(Array(3).fill(slowRep), sweepOpts);
    const result = deriveSweepCalibration(signal.samples);
    expect(result.valid).toBe(true);
    expect(result.axisQuality!).toBeGreaterThan(AXIS_QUALITY_MIN * 2);
  });

  it('rejects multi-axis wobble with a low axis quality', () => {
    const signal = generateSweepSignal(Array(3).fill(slowRep), {
      ...sweepOpts,
      crossAxisWobble: { amplitudeRadps: 0.45, freqHz: 2.5 },
    });
    const result = deriveSweepCalibration(signal.samples);
    expect(result.valid).toBe(false);
    expect(result.axisQuality).not.toBeNull();
    expect(result.axisQuality!).toBeLessThan(AXIS_QUALITY_MIN);
    expect(result.reason).toMatch(/planar/i);
  });

  it('fires the gravity lower-bound invariant on an under-reading gyro', () => {
    // The field-test failure mode: gyro path captures only ~2/3 of the true
    // rotation (0.66 ≈ the observed 47.4/72.0). Gravity between endpoints
    // proves the under-read — hard rejection.
    const signal = generateSweepSignal(Array(3).fill(slowRep), {
      ...sweepOpts,
      gyroScale: 0.66,
    });
    const result = deriveSweepCalibration(signal.samples);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/below the gravity lower\s?bound/i);
  });

  it('rejects a sweep with too few strokes', () => {
    const signal = generateSweepSignal([slowRep], sweepOpts);
    const result = deriveSweepCalibration(signal.samples);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/2 slow full-range reps|stroke/i);
  });

  it('rejects inconsistent stroke lengths', () => {
    const signal = generateSweepSignal(
      [slowRep, { ...slowRep, romDeg: 40 }, slowRep],
      sweepOpts
    );
    const result = deriveSweepCalibration(signal.samples);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/inconsistent/i);
  });

  it('rejects a recording with no still mount periods', () => {
    // Reps only, no lead-in/trailing rest long enough to count as mounted.
    const signal = generateSweepSignal(
      [{ ...slowRep, restAfterMs: 300 }, { ...slowRep, restAfterMs: 300 }],
      { ...sweepOpts, leadInMs: 300 }
    );
    // Truncate the trailing handling+rest so no long rest exists at all.
    const cut = signal.samples.filter((s) => s.tMs < 1200 + 300 + 2 * 4900 - 1000);
    const result = deriveSweepCalibration(cut);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/still period/i);
  });
});
