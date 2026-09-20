/**
 * gymProximity — the picker's "which gym am I standing in" ranking.
 *
 * What must hold: distance math is sane at gym scales, a gym without learned
 * coordinates is never suggested OR ruled out (unknown ≠ far away), and the
 * nearby radius is a hard gate — being someone's closest gym from across
 * town must not read as "you're probably here".
 */
import {
  formatDistanceM,
  haversineMeters,
  NEARBY_GYM_RADIUS_M,
  rankGymsByDistance,
} from '../gymProximity';

// ~1 degree of latitude ≈ 111.32 km everywhere; use it as ground truth.
const P = { latitude: 40.0, longitude: -75.0 };

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(P, P)).toBe(0);
  });

  it('matches the 111 km-per-degree-latitude ground truth', () => {
    const oneDegNorth = { latitude: 41.0, longitude: -75.0 };
    expect(haversineMeters(P, oneDegNorth)).toBeGreaterThan(110_000);
    expect(haversineMeters(P, oneDegNorth)).toBeLessThan(112_500);
  });

  it('resolves distances at gym scale (100 m ≈ 0.0009° latitude)', () => {
    const hundredMeters = { latitude: 40.0009, longitude: -75.0 };
    const d = haversineMeters(P, hundredMeters);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe('rankGymsByDistance', () => {
  const here = { id: 'here', latitude: 40.0002, longitude: -75.0 }; // ~22 m
  const acrossTown = { id: 'far', latitude: 40.05, longitude: -75.0 }; // ~5.5 km
  const unknown = { id: 'unknown', latitude: null, longitude: null };

  it('suggests the closest gym inside the radius and distances the rest', () => {
    const result = rankGymsByDistance([acrossTown, here, unknown], P);
    expect(result.suggestedGymId).toBe('here');
    expect(result.distancesM.here).toBeLessThan(NEARBY_GYM_RADIUS_M);
    expect(result.distancesM.far).toBeGreaterThan(5000);
  });

  it('never suggests a gym outside the radius, even when it is the closest', () => {
    const result = rankGymsByDistance([acrossTown, unknown], P);
    expect(result.suggestedGymId).toBeNull();
    expect(result.distancesM.far).toBeGreaterThan(NEARBY_GYM_RADIUS_M);
  });

  it('gives a coordinate-less gym no distance entry at all', () => {
    const result = rankGymsByDistance([here, unknown], P);
    expect(result.distancesM).not.toHaveProperty('unknown');
  });

  it('picks the closer of two gyms inside the radius', () => {
    const alsoNear = { id: 'also-near', latitude: 40.003, longitude: -75.0 }; // ~330 m
    const result = rankGymsByDistance([alsoNear, here], P);
    expect(result.suggestedGymId).toBe('here');
  });
});

describe('formatDistanceM', () => {
  it('rounds metres to tens with a floor of 10', () => {
    expect(formatDistanceM(3)).toBe('~10 m away');
    expect(formatDistanceM(123)).toBe('~120 m away');
  });

  it('switches to kilometres near 1 km', () => {
    expect(formatDistanceM(2340)).toBe('~2.3 km away');
    expect(formatDistanceM(12_000)).toBe('~12 km away');
  });
});
