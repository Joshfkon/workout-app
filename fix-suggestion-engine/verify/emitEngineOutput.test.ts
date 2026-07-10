/**
 * Verification step 1 — emit the REAL engine output for the failure case.
 *
 * Runs the actual services/setRecommender.recommendSeedForSlot for the
 * ISO-Lateral Low Row set-1 scenario (both the inferred ramp role and the
 * user-tagged working role) and writes the result to engine-output.json. The
 * Playwright step then renders the banner/provenance from THIS file, so the
 * screenshots are provably driven by engine output, not hand-typed numbers.
 *
 * Numbers are in lb-equivalent units (engine is unit-agnostic; inc = 2.5).
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { recommendSeedForSlot } from '../../services/setRecommender';

const RANGE: [number, number] = [8, 12];
const E1RM = 252.5;
const RECENT_TOP_WORKING = 160;

it('emits engine output for the failure case (working + ramp)', () => {
  const working = recommendSeedForSlot({
    role: 'working',
    targetRepRange: RANGE,
    targetRir: 2,
    minIncrementKg: 2.5,
    anchorE1RMKg: E1RM,
    recentWorkingWeightKg: RECENT_TOP_WORKING,
    prevWeightKg: 90,
    prevReps: 13,
    prevRir: 4,
  });

  const ramp = recommendSeedForSlot({
    role: 'ramp',
    targetRepRange: RANGE,
    targetRir: 2,
    minIncrementKg: 2.5,
    anchorE1RMKg: E1RM,
    recentWorkingWeightKg: RECENT_TOP_WORKING,
    prevWeightKg: 90,
    prevReps: 13,
    prevRir: 4,
  });

  // The wrong output must be impossible.
  expect(working.weightKg).toBeGreaterThanOrEqual(170);
  expect(working.weightKg).toBeLessThanOrEqual(190);
  expect(ramp.showRirTarget).toBe(false);

  const out = {
    scenario: 'ISO-Lateral Low Row — set 1',
    unit: 'lbs',
    history: '90×13@4, 140×14@2.5, 160×8@2.5, 160×11@1',
    storedE1RM: E1RM,
    target: { repRange: RANGE, rir: 2 },
    recentTopWorkingWeight: RECENT_TOP_WORKING,
    working: {
      weight: working.weightKg,
      repRange: working.repRange,
      rir: working.rir,
      showRir: working.showRirTarget,
      role: working.role,
      anchorSource: working.anchorSource,
      clamped: working.clamped,
      engineVersion: working.engineVersion,
    },
    ramp: {
      weight: ramp.weightKg,
      repRange: ramp.repRange,
      showRir: ramp.showRirTarget,
      role: ramp.role,
      anchorSource: ramp.anchorSource,
      engineVersion: ramp.engineVersion,
    },
    // The exact string the OLD engine produced (must not be reproducible).
    forbiddenOldOutput: '92.5 × 13 @ 2 RIR — up 2.5 lbs vs last session — it was clearly too light',
  };

  writeFileSync(join(__dirname, 'engine-output.json'), JSON.stringify(out, null, 2));
  expect(out.working.weight).not.toBe(92.5);
});
