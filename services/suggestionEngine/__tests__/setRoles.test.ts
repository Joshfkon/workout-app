/**
 * Tests for services/suggestionEngine/setRoles.ts
 */

import {
  inferSetRole,
  resolveSetRole,
  sessionTopSetWeightKg,
  inferRolesForSession,
} from '../setRoles';
import { RAMP_ROLE_MAX_FRACTION } from '../constants';

describe('sessionTopSetWeightKg', () => {
  it('returns the heaviest non-warmup load', () => {
    expect(
      sessionTopSetWeightKg([
        { weightKg: 90 },
        { weightKg: 140 },
        { weightKg: 160 },
        { weightKg: 160 },
      ])
    ).toBe(160);
  });

  it('ignores warmups', () => {
    expect(
      sessionTopSetWeightKg([{ weightKg: 200, isWarmup: true }, { weightKg: 100 }])
    ).toBe(100);
  });

  it('returns 0 for an empty session', () => {
    expect(sessionTopSetWeightKg([])).toBe(0);
  });
});

describe('inferSetRole', () => {
  it('classifies the failure-case feeder set (90 vs 160 top) as ramp', () => {
    // 90 / 160 = 0.5625 < 0.75 → ramp
    expect(inferSetRole(90, 160)).toBe('ramp');
  });

  it('classifies the working sets (140, 160 vs 160 top) as working', () => {
    expect(inferSetRole(140, 160)).toBe('working'); // 0.875 >= 0.75
    expect(inferSetRole(160, 160)).toBe('working');
  });

  it('uses RAMP_ROLE_MAX_FRACTION as the boundary (at the threshold is working)', () => {
    const top = 200;
    const atThreshold = top * RAMP_ROLE_MAX_FRACTION; // 150
    expect(inferSetRole(atThreshold, top)).toBe('working');
    expect(inferSetRole(atThreshold - 0.01, top)).toBe('ramp');
  });

  it('treats everything as working when there is no top set to compare against', () => {
    expect(inferSetRole(50, 0)).toBe('working');
  });
});

describe('resolveSetRole', () => {
  it('lets a user working tag beat a ramp inference', () => {
    // Load says ramp, but the user tagged it working → working.
    expect(resolveSetRole('working', 90, 160)).toBe('working');
  });

  it('lets a user ramp tag beat a working inference', () => {
    expect(resolveSetRole('ramp', 160, 160)).toBe('ramp');
  });

  it('falls back to inference with no tag', () => {
    expect(resolveSetRole(null, 90, 160)).toBe('ramp');
    expect(resolveSetRole(undefined, 140, 160)).toBe('working');
  });
});

describe('inferRolesForSession', () => {
  it('backfills roles across a session and skips warmups', () => {
    const roles = inferRolesForSession([
      { weightKg: 40, isWarmup: true },
      { weightKg: 90 }, // feeder
      { weightKg: 140 },
      { weightKg: 160 },
      { weightKg: 160 },
    ]);
    expect(roles).toEqual([null, 'ramp', 'working', 'working', 'working']);
  });
});
