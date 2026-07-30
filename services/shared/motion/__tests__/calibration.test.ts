import { deriveCalibration, type TransitSample } from '../calibration';
import { dot, normalize, rotateAbout, scale, signedAngleAbout } from '../vec3';
import { DEG_TO_RAD, G_MPS2 } from '../constants';
import { DEFAULT_AXIS, DEFAULT_G_BOTTOM } from './synthetic';

// DEFAULT_G_BOTTOM deliberately has a component along the axis — a TILTED
// pivot (the case where the naive cross-product axis derivation is biased).
const axis = normalize(DEFAULT_AXIS)!;
const gBottom = scale(normalize(DEFAULT_G_BOTTOM)!, G_MPS2);
/** Physical convention: rotating the arm bottom→top by θ counter-rotates
 *  gravity in the phone frame: gTop = R(axis, −θ)·gBottom. */
const gAt = (deg: number) => rotateAbout(gBottom, axis, -deg * DEG_TO_RAD);

/** Transit gyro for a smooth bottom→top sweep of `deg` about `about`. */
function transitFor(deg: number, about = axis, durationMs = 2000, rateHz = 100): TransitSample[] {
  const dtMs = 1000 / rateHz;
  const n = Math.round(durationMs / dtMs);
  const samples: TransitSample[] = [];
  for (let i = 1; i <= n; i++) {
    const p = i / n;
    // Raised-cosine rate profile; integrates to exactly deg.
    const omega = ((deg * DEG_TO_RAD * Math.PI) / 2 / (durationMs / 1000)) * Math.sin(Math.PI * p);
    samples.push({ gyro: scale(about, omega), dtMs });
  }
  return samples;
}

describe('deriveCalibration', () => {
  it('derives the pivot axis and ROM exactly, even for a tilted (non-horizontal) pivot', () => {
    const result = deriveCalibration(gBottom, gAt(72), transitFor(72));
    expect(result.valid).toBe(true);
    expect(result.romDegrees!).toBeCloseTo(72, 1);
    expect(result.romFromGyroDegrees!).toBeCloseTo(72, 1);
    // Canonicalized so bottom→top is positive — that is exactly the true axis.
    expect(dot(result.pivotAxis!, axis)).toBeCloseTo(1, 4);
  });

  it('canonicalizes the axis sign so bottom→top rotation is always positive', () => {
    // Same machine, arm swinging the other way round the pivot: gravity
    // rotates by +60° and the transit gyro reads negative about `axis`.
    const gTop = rotateAbout(gBottom, axis, +60 * DEG_TO_RAD);
    const result = deriveCalibration(gBottom, gTop, transitFor(60, scale(axis, -1)));
    expect(result.valid).toBe(true);
    expect(result.romDegrees!).toBeCloseTo(60, 1);
    expect(dot(result.pivotAxis!, axis)).toBeCloseTo(-1, 4);
    // The invariant consumers rely on, independent of the raw axis direction:
    const angleAtTop = signedAngleAbout(result.pivotAxis!, gTop, gBottom);
    expect(angleAtTop! / DEG_TO_RAD).toBeCloseTo(60, 1);
  });

  it('falls back to the cross-product axis without transit data (horizontal pivot exact)', () => {
    // Horizontal pivot: gravity ⊥ axis, where the fallback is exact.
    const axisH = normalize({ x: 0, y: 0, z: 1 })!;
    const gH = scale(normalize({ x: 3, y: -9, z: 0 })!, G_MPS2);
    const gTopH = rotateAbout(gH, axisH, -45 * DEG_TO_RAD);
    const result = deriveCalibration(gH, gTopH);
    expect(result.valid).toBe(true);
    expect(result.romDegrees!).toBeCloseTo(45, 1);
    expect(result.romFromGyroDegrees).toBeNull();
    expect(Math.abs(dot(result.pivotAxis!, axisH))).toBeCloseTo(1, 4);
    expect(signedAngleAbout(result.pivotAxis!, gTopH, gH)! / DEG_TO_RAD).toBeCloseTo(45, 1);
  });

  it('invalidates when the phone shifted (gyro and gravity ROM disagree)', () => {
    // Gyro saw 72° of rotation but gravity only moved 50° — mount slipped.
    const result = deriveCalibration(gBottom, gAt(50), transitFor(72));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/disagree/i);
  });

  it('rejects identical references with no transit (arm never moved)', () => {
    const result = deriveCalibration(gBottom, gBottom);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/did not rotate/i);
  });

  it('rejects a transit sweep that is too small', () => {
    const result = deriveCalibration(gBottom, gAt(5), transitFor(5));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/full stroke/i);
  });

  it('rejects references that are not still gravity readings', () => {
    const moving = scale(gBottom, 1.6); // |a| ≈ 15.7 m/s² — mid-shove, not static
    const result = deriveCalibration(moving, gAt(60), transitFor(60));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/still/i);
  });

  it('rejects a mount whose axis is parallel to gravity (angle unreadable)', () => {
    // Pivot along gravity: gravity never changes direction; transit says the
    // axis IS the gravity direction → gravity ROM is undefined/zero.
    const gDown = scale(normalize({ x: 0, y: 0, z: -1 })!, G_MPS2);
    const axisDown = { x: 0, y: 0, z: -1 };
    const result = deriveCalibration(gDown, gDown, transitFor(60, axisDown));
    expect(result.valid).toBe(false);
  });
});
