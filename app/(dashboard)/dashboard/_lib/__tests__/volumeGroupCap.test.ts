/**
 * Group set-credit cap — regression tests for the volume double-count bug.
 *
 * Reported symptoms (muscle-group screen, 2026-07):
 *   - Iso-Lateral Incline Press: 4 sets logged → Upper Chest 4 eff AND Lower
 *     Chest 2 eff → 6 eff at the Chest GROUP level. An exercise tagged
 *     primary-to-one-head + secondary-to-another-head-in-the-same-group
 *     credited the group 1.5 sets per performed set.
 *   - Shoulders group header 15.5 while the whole-group panel summed to 15.1
 *     (Arnold Press 4 sets → 6 group credit via front primary + side
 *     secondary; the 0.4 gap is one RIR-3 set weighted 0.6).
 *
 * The fix (services/shared/volumeCredit): per-set credit to any single muscle
 * group is capped at 1.0, applied per exercise block from the performed set
 * count — WITHIN-GROUP ONLY. RIR weighting applies on top of the cap.
 * Sub-muscle (head) counters stay independent and may overlap — that remains
 * correct behavior for per-head programming decisions.
 */

import {
  buildVolumeRows,
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  type WeeklyVolumeBlockRow,
} from '../weeklyVolume';
import {
  COARSE_MUSCLES,
  COARSE_CHILDREN,
  FINE_CHILD_MUSCLES,
  STANDARD_TO_COARSE,
  getEffectiveBand,
} from '@/services/volumeBands';
import { resolveMuscleToStandard } from '@/types/schema';

function block(
  id: string,
  name: string,
  primary: string,
  secondary: string[],
  rirs: number[]
): WeeklyVolumeBlockRow {
  return {
    exercises: { id, name, primary_muscle: primary, secondary_muscles: secondary },
    set_logs: rirs.map((rir, i) => ({
      id: `${id}-s${i}`,
      is_warmup: false,
      feedback: { repsInTank: rir },
    })),
  };
}

const rir2 = (n: number) => Array.from({ length: n }, () => 2);

/** Sum in integer tenths — the display precision — so "agrees exactly" means
 *  exactly what the user sees. */
const tenths = (v: number) => Math.round(v * 10);
const sumTenths = (vals: number[]) => vals.reduce((s, v) => s + tenths(v), 0);

function rowsFor(blocks: WeeklyVolumeBlockRow[]) {
  return buildVolumeRows(computeWeeklyMuscleVolume(blocks), computeReachableMuscles(blocks));
}

/** Coarse groups an exercise's tags touch (primary or secondary). */
function groupsTouched(primary: string, secondary: string[]): Set<string> {
  const out = new Set<string>();
  for (const token of [primary, ...secondary]) {
    for (const std of resolveMuscleToStandard(token)) {
      const coarse = STANDARD_TO_COARSE[std];
      if (coarse) out.add(coarse);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reported reconstruction: the Shoulders 15.5-vs-15.1 screen.
// Arnold Press is fine-tagged (front primary + side secondary — the Phase 3
// retag shape); the side-delt isolation has one RIR-3 set (weight 0.6).
// ---------------------------------------------------------------------------
const shouldersWeek: WeeklyVolumeBlockRow[] = [
  block('arnold', 'Arnold Press', 'front_delts', ['lateral_delts', 'triceps'], rir2(4)),
  block('lrc', 'Lateral Raise (Cable)', 'lateral_delts', [], [2, 2, 3]),
  block('rdm', 'Rear Delt Machine', 'rear_delts', ['upper_back'], rir2(3)),
  block('pd', 'Lat Pulldown', 'lats', ['biceps', 'upper_back', 'rear_delts'], rir2(4)),
  block('bench', 'Barbell Bench Press', 'chest', ['front_delts', 'triceps'], rir2(3)),
];

describe('reported reconstruction — Shoulders group (was header 15.5 / panel 15.1)', () => {
  const rows = rowsFor(shouldersWeek);
  const shoulders = rows.find((r) => r.muscle === 'shoulders')!;
  const byId = new Map(shoulders.exercises.map((e) => [e.id, e]));

  it('Arnold Press (4 sets, front primary + side secondary) credits the group ≤ 4, not 6', () => {
    expect(byId.get('arnold')!.sets).toBe(4);
    expect(byId.get('arnold')!.effective).toBe(4);
    expect(byId.get('arnold')!.performedSets).toBe(4);
  });

  it('group header drops from the inflated 15.5/15.1 to the capped 13.5/13.1', () => {
    expect(shoulders.sets).toBe(13.5);
    expect(shoulders.effectiveSets).toBe(13.1);
  });

  it('header === Σ(panel) exactly, both metrics, before display rounding', () => {
    expect(sumTenths(shoulders.exercises.map((e) => e.sets))).toBe(tenths(shoulders.sets));
    expect(sumTenths(shoulders.exercises.map((e) => e.effective))).toBe(
      tenths(shoulders.effectiveSets)
    );
  });

  it('sub-muscle counters still overlap (side delts keeps 5 raw / 4.6 eff)', () => {
    const side = shoulders.children.find((c) => c.muscle === 'lateral_delts')!;
    expect(side.sets).toBe(5); // Arnold secondary 2 + isolation 3 — BY DESIGN
    expect(side.effectiveSets).toBe(4.6); // one RIR-3 isolation set at 0.6
    const front = shoulders.children.find((c) => c.muscle === 'front_delts')!;
    expect(front.sets).toBe(5.5); // Arnold 4 direct + bench 1.5 indirect
  });

  it('cross-group inflow is NOT capped (bench still feeds shoulders 1.5 + triceps)', () => {
    // The cap is WITHIN-GROUP ONLY: a bench set legitimately credits chest 1.0
    // + front delts 0.5 + triceps 0.5 (total 2.0 across groups). Promoting the
    // cap to a global per-set cap would break the authored band calibration.
    expect(byId.get('bench')!.sets).toBe(1.5);
    const triceps = rows.find((r) => r.muscle === 'triceps')!;
    // bench 0.5×3 + arnold 0.5×4 = 3.5 indirect triceps credit.
    expect(triceps.sets).toBe(3.5);
  });
});

// ---------------------------------------------------------------------------
// Reported symptom 1: primary-to-one-head + secondary-to-the-other-head.
// ---------------------------------------------------------------------------
describe('same-group head overlap (Iso-Lateral Incline Press class)', () => {
  it('4 sets tagged chest_upper + [chest_lower] yield exactly 4 at the Chest group', () => {
    const blocks = [
      block('iso', 'Iso-Lateral Incline Press', 'chest_upper', ['chest_lower'], rir2(4)),
    ];
    const chest = rowsFor(blocks).find((r) => r.muscle === 'chest')!;
    expect(chest.sets).toBe(4);
    expect(chest.effectiveSets).toBe(4);
    // Heads keep their overlapping per-head credit for programming decisions.
    const upper = chest.children.find((c) => c.muscle === 'chest_upper')!;
    const lower = chest.children.find((c) => c.muscle === 'chest_lower')!;
    expect(upper.sets).toBe(4);
    expect(lower.sets).toBe(2);
  });

  it('a legacy coarse split (Cable Fly) is unchanged: 3 sets → 3 at group', () => {
    const blocks = [block('fly', 'Cable Fly', 'chest', ['front_delts'], rir2(3))];
    const chest = rowsFor(blocks).find((r) => r.muscle === 'chest')!;
    expect(chest.sets).toBe(3); // ½ + ½ per set sums to exactly 1.0 — cap is a no-op
  });

  it('RIR weighting applies ON TOP of the cap, not before it', () => {
    // 4 sets [2,2,2,3] → Σweights = 3.6. Uncapped group credit would be
    // 1.5/set; capped is 1.0/set, so effective = 1.0 × 3.6 = 3.6 — NOT
    // min(perf, 1.5 × 3.6) = 4 (cap-after-weighting) and NOT 3.6 × 1.5.
    const blocks = [
      block('iso', 'Iso-Lateral Incline Press', 'chest_upper', ['chest_lower'], [2, 2, 2, 3]),
    ];
    const chest = rowsFor(blocks).find((r) => r.muscle === 'chest')!;
    expect(chest.sets).toBe(4);
    expect(chest.effectiveSets).toBe(3.6);
  });
});

// ---------------------------------------------------------------------------
// General invariant: Σ(exercise credit toward G) ≤ Σ(sets touching G).
// ---------------------------------------------------------------------------
describe('group credit never exceeds performed sets touching the group', () => {
  // A deliberately overlap-heavy week across several groups.
  const week: WeeklyVolumeBlockRow[] = [
    ...shouldersWeek,
    block('iso', 'Iso-Lateral Incline Press', 'chest_upper', ['chest_lower'], rir2(4)),
    block('standing', 'Standing Calf Raise', 'gastrocnemius', ['soleus'], rir2(4)),
    block('seated', 'Seated Calf Raise', 'soleus', ['gastrocnemius'], rir2(2)),
    block('pullup', 'Pull-Ups', 'lats', ['biceps', 'upper_back', 'rear_delts', 'forearms'], rir2(3)),
    block('slht', 'Single Leg Hip Thrust', 'glutes', ['hamstrings', 'glute_med'], rir2(3)),
    block('legraise', 'Hanging Leg Raise', 'abs', ['obliques'], rir2(3)),
  ];
  const rows = rowsFor(week);

  it.each(COARSE_MUSCLES.map((m) => [m] as [string]))('%s: Σ credit ≤ Σ sets touching', (muscle) => {
    const row = rows.find((r) => r.muscle === muscle);
    if (!row) return;
    let performedTouching = 0;
    for (const b of week) {
      const ex = b.exercises!;
      if (groupsTouched(ex.primary_muscle!, ex.secondary_muscles || []).has(muscle)) {
        performedTouching += (b.set_logs || []).filter((s) => !s.is_warmup).length;
      }
    }
    expect(row.sets).toBeLessThanOrEqual(performedTouching + 1e-9);
    // Per-exercise form of the same invariant.
    for (const e of row.exercises) {
      expect(e.sets).toBeLessThanOrEqual(e.performedSets + 1e-9);
      expect(e.effective).toBeLessThanOrEqual(e.sets + 1e-9);
    }
  });

  it('every coarse header reconciles exactly with its panel (both metrics)', () => {
    for (const row of rows.filter((r) => r.sets > 0)) {
      expect(sumTenths(row.exercises.map((e) => e.sets))).toBe(tenths(row.sets));
      expect(sumTenths(row.exercises.map((e) => e.effective))).toBe(tenths(row.effectiveSets));
    }
  });
});

// ---------------------------------------------------------------------------
// Authoring invariant for the zone config (decision: bands stay AUTHORED).
// Group bands are independent research landmarks, deliberately NOT derived
// from sub-zones (sub-muscle zones legitimately overlap — deriving would
// re-introduce at the denominator the overlap the cap removed from the
// numerator). This check only catches band typos: a group's band must at
// least contain each child's own band edge.
// ---------------------------------------------------------------------------
describe('authored group bands dominate their fine children (typo guard)', () => {
  it.each(
    COARSE_MUSCLES.flatMap((coarse) =>
      (['standard', 'enhanced'] as const).map(
        (profile) => [coarse, profile] as [(typeof COARSE_MUSCLES)[number], 'standard' | 'enhanced']
      )
    )
  )('%s (%s): group mev/mrv ≥ every fine child mev/mrv', (coarse, profile) => {
    const ctx = { recoveryProfile: profile };
    const group = getEffectiveBand(coarse, ctx);
    for (const child of COARSE_CHILDREN[coarse]) {
      if (!FINE_CHILD_MUSCLES.has(child)) continue;
      const childBand = getEffectiveBand(child, ctx);
      expect(group.mev).toBeGreaterThanOrEqual(childBand.mev);
      expect(group.mrv).toBeGreaterThanOrEqual(childBand.mrv);
    }
  });
});
