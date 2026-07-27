/**
 * Header ⇄ counted-sets-list reconciliation on the REFERENCE reconstruction
 * from the shoulders volume-card audit (docs: the "23.1 eff / 23 vs list 23.7"
 * bug). The fixture reproduces the user's exact week:
 *
 *   - Arnold Press           8 working sets, coarse legacy 'shoulders' primary
 *                            (⅓ credit per delt head), ONE set at RIR 3
 *   - Lateral Raise (Machine) 3 sets, coarse 'shoulders' (⅓/head)
 *   - Lateral Raise (Cable)   2 sets, coarse 'shoulders' (⅓/head)
 *   - Cable Upright Row       3 sets, lateral_delts primary
 *   - Lat Pulldown            4 sets, rear_delts secondary (0.5×4 = 2.0)
 *   - DB/BB Bench, Cable Fly  3 sets each, front_delts secondary (1.5 each)
 *   - Machine Chest Press     2 sets, front_delts secondary (1.0)
 *
 * Ground truth: raw credited shoulders sets 23.5 exactly; effective 23.1
 * (7 × 1.0 + 0.6 for the RIR-3 Arnold set, split across heads). Heads:
 * front 9.833 / side 7.333 / rear 6.333 raw.
 *
 * The old pipeline displayed Arnold 8.1 / Lateral Raise (Cable) 2.1 (per-merge
 * rounding drift), a header raw of 23 (IEEE-754: 23.499999999999996), and a
 * list that summed to neither header metric. These tests pin the fix: round
 * once at emission, sum-preserving, both metrics carried per exercise.
 */

import {
  buildVolumeRows,
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  type WeeklyVolumeBlockRow,
  type VolumeRow,
} from '../weeklyVolume';

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

// The reference week. One Arnold set at RIR 3 (weight 0.6) is the entire
// raw-vs-effective gap: 23.5 raw → 23.1 effective.
const blocks: WeeklyVolumeBlockRow[] = [
  block('arnold', 'Arnold Press', 'shoulders', [], [...rir2(7), 3]),
  block('lrm', 'Lateral Raise (Machine)', 'shoulders', [], rir2(3)),
  block('lrc', 'Lateral Raise (Cable)', 'shoulders', [], rir2(2)),
  block('cur', 'Cable Upright Row', 'lateral_delts', ['traps', 'biceps'], rir2(3)),
  block('pd', 'Lat Pulldown', 'lats', ['biceps', 'upper_back', 'rear_delts'], rir2(4)),
  block('db', 'Dumbbell Bench Press', 'chest', ['front_delts', 'triceps'], rir2(3)),
  block('bb', 'Barbell Bench Press', 'chest', ['front_delts', 'triceps'], rir2(3)),
  block('fly', 'Cable Fly', 'chest', ['front_delts'], rir2(3)),
  block('mcp', 'Machine Chest Press', 'chest', ['front_delts', 'triceps'], rir2(2)),
];

const stats = computeWeeklyMuscleVolume(blocks);
const reachable = computeReachableMuscles(blocks);
const rows = buildVolumeRows(stats, reachable);
const shoulders = rows.find((r) => r.muscle === 'shoulders')!;

/** Sum a list in integer tenths — the display precision — so "agrees exactly"
 *  means exactly what the user sees, with no float dust in the assertion. */
const tenths = (v: number) => Math.round(v * 10);
const sumTenths = (vals: number[]) => vals.reduce((s, v) => s + tenths(v), 0);

describe('reference reconstruction — shoulders header', () => {
  it('raw header is 23.5 (not 23 via IEEE-754, not 24 via naive half-up)', () => {
    expect(shoulders.sets).toBe(23.5);
  });

  it('effective header is 23.1 (one RIR-3 Arnold set at weight 0.6)', () => {
    expect(shoulders.effectiveSets).toBe(23.1);
  });

  it('head rows carry the true one-decimal credit (front 9.8 / side 7.3 / rear 6.3)', () => {
    const child = (m: string) => shoulders.children.find((c) => c.muscle === m)!;
    expect(child('front_delts').sets).toBe(9.8);
    expect(child('lateral_delts').sets).toBe(7.3);
    expect(child('rear_delts').sets).toBe(6.3);
    expect(child('front_delts').effectiveSets).toBe(9.7);
    expect(child('lateral_delts').effectiveSets).toBe(7.2);
    expect(child('rear_delts').effectiveSets).toBe(6.2);
  });

  it('front delts at 9.8 is IN ZONE under its total-inclusive band (2–14) — normal press+shoulder training is not structurally red', () => {
    const front = shoulders.children.find((c) => c.muscle === 'front_delts')!;
    expect(front.band).toEqual({ mev: 2, mrv: 14 });
    expect(front.zone).toBe('in_zone');
    // No head is lagging in the reference week, so the parent keeps success.
    expect(shoulders.laggingChildren).toBe(false);
  });
});

describe('reference reconstruction — counted-sets list', () => {
  const byId = new Map(shoulders.exercises.map((e) => [e.id, e]));

  it('shows the true credited counts — no phantom 0.1s from per-merge rounding', () => {
    expect(byId.get('arnold')!.sets).toBe(8); // was 8.1
    expect(byId.get('lrc')!.sets).toBe(2); // was 2.1
    expect(byId.get('lrm')!.sets).toBe(3);
    expect(byId.get('cur')!.sets).toBe(3);
    expect(byId.get('pd')!.sets).toBe(2); // 4 raw sets × 0.5 rear-delt credit
    expect(byId.get('db')!.sets).toBe(1.5);
    expect(byId.get('bb')!.sets).toBe(1.5);
    expect(byId.get('fly')!.sets).toBe(1.5);
    expect(byId.get('mcp')!.sets).toBe(1);
  });

  it('carries effective volume per exercise (Arnold 7.6 = 8.0 raw − 0.4)', () => {
    expect(byId.get('arnold')!.effective).toBe(7.6);
    expect(byId.get('lrm')!.effective).toBe(3);
  });

  it('list sum === header, exactly, for BOTH metrics', () => {
    expect(sumTenths(shoulders.exercises.map((e) => e.sets))).toBe(tenths(shoulders.sets));
    expect(sumTenths(shoulders.exercises.map((e) => e.effective))).toBe(
      tenths(shoulders.effectiveSets)
    );
  });

  it('every entry carries the sets actually PERFORMED, un-split (Phase 3)', () => {
    // Credited counts are fractions of these — the panel renders
    // "8 sets → 2.7 credited" so its inputs are visible.
    expect(byId.get('arnold')!.performedSets).toBe(8);
    expect(byId.get('pd')!.performedSets).toBe(4); // credited 2 (0.5 secondary)
    expect(byId.get('db')!.performedSets).toBe(3); // credited 1.5
    expect(byId.get('mcp')!.performedSets).toBe(2); // credited 1
  });

  it('merging heads into the group row never sums performed work', () => {
    // Arnold appears on all three head rows (⅓ credit each); the group entry
    // still reports 8 performed sets, not 24 — and each head row reports the
    // same 8 (the SAME performed work, differently credited).
    const child = (m: string) => shoulders.children.find((c) => c.muscle === m)!;
    for (const m of ['front_delts', 'lateral_delts', 'rear_delts']) {
      expect(child(m).exercises.find((e) => e.id === 'arnold')!.performedSets).toBe(8);
    }
    expect(byId.get('arnold')!.performedSets).toBe(8);
  });

  it('every child list also sums exactly to its own header (both metrics)', () => {
    for (const child of shoulders.children) {
      expect(sumTenths(child.exercises.map((e) => e.sets))).toBe(tenths(child.sets));
      expect(sumTenths(child.exercises.map((e) => e.effective))).toBe(
        tenths(child.effectiveSets)
      );
    }
  });
});

describe('reconciliation holds for every coarse row (not just shoulders)', () => {
  it.each(rows.filter((r) => r.sets > 0).map((r): [string, VolumeRow] => [r.muscle, r]))(
    '%s: Σ(list) === header for raw and effective',
    (_muscle, row) => {
      expect(sumTenths(row.exercises.map((e) => e.sets))).toBe(tenths(row.sets));
      expect(sumTenths(row.exercises.map((e) => e.effective))).toBe(tenths(row.effectiveSets));
    }
  );
});

describe('direct vs indirect composition (Phase 5) — reference data, pre-retag tags', () => {
  it('front delts: direct 4.33 raw (Arnold ⅓ + coarse laterals ⅓s), indirect 5.5 (presses)', () => {
    const frontStat = stats.find((s) => s.muscle === 'front_delts')!;
    expect(frontStat.directSets).toBeCloseTo(4.3333, 3); // 8/3 + 3/3 + 2/3
    expect(frontStat.indirectSets).toBeCloseTo(5.5, 9); // 1.5+1.5+1.5+1.0 bench credit
    expect(frontStat.sets).toBeCloseTo(9.8333, 3);

    const front = shoulders.children.find((c) => c.muscle === 'front_delts')!;
    expect(front.directSets).toBe(4.3);
    // Direct effective: Arnold's RIR-3 set lives in the direct share
    // (7.6/3 = 2.533) + 1.0 + 0.667 = 4.2.
    expect(front.directEffectiveSets).toBe(4.2);
  });

  it('single-pass invariant: direct + indirect === total to the epsilon, every muscle, both metrics', () => {
    for (const s of stats) {
      expect(s.directSets + s.indirectSets).toBeCloseTo(s.sets, 9);
      expect(s.directEffectiveSets + s.indirectEffectiveSets).toBeCloseTo(s.effectiveSets, 9);
    }
  });

  it('counted-sets entries carry composition: bench variants are indirect-only, Arnold is direct-only', () => {
    const byId = new Map(shoulders.exercises.map((e) => [e.id, e]));
    for (const benchId of ['db', 'bb', 'fly', 'mcp']) {
      expect(byId.get(benchId)!.direct).toBe(0);
      expect(byId.get(benchId)!.indirect).toBeGreaterThan(0);
    }
    expect(byId.get('arnold')!.direct).toBe(8);
    expect(byId.get('arnold')!.indirect).toBe(0);
  });
});

describe('direct vs indirect composition — AFTER the Phase 3 retag mappings (fixture only)', () => {
  // The confirmed 3b mappings applied in-fixture: Arnold → front_delts +
  // lateral_delts secondary; both lateral raises → lateral_delts.
  const retagged: WeeklyVolumeBlockRow[] = [
    block('arnold', 'Arnold Press', 'front_delts', ['lateral_delts'], [...rir2(7), 3]),
    block('lrm', 'Lateral Raise (Machine)', 'lateral_delts', [], rir2(3)),
    block('lrc', 'Lateral Raise (Cable)', 'lateral_delts', [], rir2(2)),
    block('cur', 'Cable Upright Row', 'lateral_delts', ['traps', 'biceps'], rir2(3)),
    block('pd', 'Lat Pulldown', 'lats', ['biceps', 'upper_back', 'rear_delts'], rir2(4)),
    block('db', 'Dumbbell Bench Press', 'chest', ['front_delts', 'triceps'], rir2(3)),
    block('bb', 'Barbell Bench Press', 'chest', ['front_delts', 'triceps'], rir2(3)),
    block('fly', 'Cable Fly', 'chest', ['front_delts'], rir2(3)),
    block('mcp', 'Machine Chest Press', 'chest', ['front_delts', 'triceps'], rir2(2)),
  ];
  const retagStats = computeWeeklyMuscleVolume(retagged);
  const byMuscle = new Map(retagStats.map((s) => [s.muscle, s]));

  it('front: 8 direct (Arnold) + 5.5 indirect (presses); side: 8 direct + 4 indirect (Arnold secondary); rear: 2 indirect only', () => {
    const front = byMuscle.get('front_delts')!;
    expect(front.directSets).toBeCloseTo(8, 9);
    expect(front.indirectSets).toBeCloseTo(5.5, 9);

    const side = byMuscle.get('lateral_delts')!;
    expect(side.directSets).toBeCloseTo(8, 9); // 3 + 2 + 3 (upright row)
    expect(side.indirectSets).toBeCloseTo(4, 9); // Arnold 0.5 × 8

    const rear = byMuscle.get('rear_delts')!;
    expect(rear.directSets).toBeCloseTo(0, 9);
    expect(rear.indirectSets).toBeCloseTo(2, 9); // pulldown 0.5 × 4
  });

  it('invariant holds post-retag too: direct + indirect === total to the epsilon', () => {
    for (const s of retagStats) {
      expect(s.directSets + s.indirectSets).toBeCloseTo(s.sets, 9);
      expect(s.directEffectiveSets + s.indirectEffectiveSets).toBeCloseTo(s.effectiveSets, 9);
    }
  });
});

describe('zero direct work + sufficient indirect renders in-zone (the "pressing covers it" case)', () => {
  it('front delts fed only by bench secondaries (5.5 ≥ MEV 2) is in_zone, not under', () => {
    const pressesOnly: WeeklyVolumeBlockRow[] = [
      block('db', 'Dumbbell Bench Press', 'chest', ['front_delts', 'triceps'], rir2(3)),
      block('bb', 'Barbell Bench Press', 'chest', ['front_delts', 'triceps'], rir2(3)),
      block('fly', 'Cable Fly', 'chest', ['front_delts'], rir2(3)),
      block('mcp', 'Machine Chest Press', 'chest', ['front_delts', 'triceps'], rir2(2)),
    ];
    const s = computeWeeklyMuscleVolume(pressesOnly);
    const reach = computeReachableMuscles(pressesOnly);
    const shouldersRow = buildVolumeRows(s, reach).find((r) => r.muscle === 'shoulders')!;
    const front = shouldersRow.children.find((c) => c.muscle === 'front_delts')!;

    expect(front.directSets).toBe(0);
    expect(front.sets).toBe(5.5); // all indirect
    expect(front.zone).toBe('in_zone'); // 5.5 ≥ MEV 2 — zone judges the TOTAL
    expect(front.belowMev).toBe(false);
  });
});
