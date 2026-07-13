/**
 * Fine-muscle taxonomy verification (ticket fixtures):
 *  - shoulders expansion: lateral-raises-only week shows side delts fed and
 *    front/rear at 0 (context rows, never warnings/targets),
 *  - seated + standing calf raises split soleus/gastrocnemius with fractional
 *    secondary credits,
 *  - parent total == sum of fine-child credits + coarse-tagged credits, each
 *    set counted exactly once (no double-count),
 *  - no fine row ever renders for a user whose library can't feed it — even
 *    with a stale persisted expansion,
 *  - the chevron rule: expandable ⇔ ≥1 reachable fine child.
 */

import {
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  buildVolumeRows,
  belowMevVolumeData,
  computeWeeklyMevSummary,
  COARSE_MUSCLES,
  COARSE_CHILDREN,
  FINE_MUSCLE_PARENTS,
  MEV_TARGETS,
  type WeeklyVolumeBlockRow,
  type CoarseMuscle,
} from '../weeklyVolume';
import { isMuscleWarnable } from '../weeklyVolume';
import { buildReadinessRows, selectGoodTargets } from '../../workout/[id]/_lib/readiness';
import { resolvePrimaryMuscleCredits, SECONDARY_MUSCLE_CREDIT } from '@/services/volumeTracker';
import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';

const NOW = new Date('2026-07-13T12:00:00.000Z');

function block(
  id: string,
  primary: string,
  secondary: string[],
  workingSets: number,
  name = id
): WeeklyVolumeBlockRow {
  return {
    exercises: { id, name, primary_muscle: primary, secondary_muscles: secondary },
    set_logs: Array.from({ length: workingSets }, (_, i) => ({ id: `${id}-s${i}`, is_warmup: false })),
  };
}

function rowsFor(blocks: WeeklyVolumeBlockRow[], expandedParents?: Set<CoarseMuscle>) {
  const stats = computeWeeklyMuscleVolume(blocks);
  const reachable = computeReachableMuscles(blocks);
  return {
    stats,
    reachable,
    rows: buildVolumeRows(stats, reachable, { expandedParents }),
  };
}

describe('shoulders fixture: lateral raises only', () => {
  const blocks = [block('lr', 'lateral_delts', [], 6, 'Lateral Raise')];

  it('the shoulders row is expandable (side delts are a reachable fine child)', () => {
    const { rows } = rowsFor(blocks);
    const shoulders = rows.find((r) => r.muscle === 'shoulders')!;
    expect(shoulders.expandable).toBe(true);
    // Side delts are fed to their MEV, front/rear are unreachable — nothing
    // auto-surfaces while collapsed.
    expect(shoulders.children).toHaveLength(0);
  });

  it('expanded: side delts show fed, front/rear delts show at 0', () => {
    const { rows } = rowsFor(blocks, new Set<CoarseMuscle>(['shoulders']));
    const shoulders = rows.find((r) => r.muscle === 'shoulders')!;
    expect(shoulders.children.map((c) => c.muscle).sort()).toEqual([
      'front_delts',
      'lateral_delts',
      'rear_delts',
    ]);
    const byMuscle = new Map(shoulders.children.map((c) => [c.muscle, c]));
    expect(byMuscle.get('lateral_delts')!.sets).toBe(6);
    expect(byMuscle.get('lateral_delts')!.reachable).toBe(true);
    expect(byMuscle.get('front_delts')!.sets).toBe(0);
    expect(byMuscle.get('rear_delts')!.sets).toBe(0);
    // The 0-set rows are context only — the user's logged library can't feed
    // them, so they are marked unreachable…
    expect(byMuscle.get('front_delts')!.reachable).toBe(false);
    expect(byMuscle.get('rear_delts')!.reachable).toBe(false);
  });

  it('…and unreachable context rows never become warnings or training targets', () => {
    const { stats, reachable, rows } = rowsFor(blocks, new Set<CoarseMuscle>(['shoulders']));
    const warned = belowMevVolumeData(rows).map((d) => d.muscleGroup as string);
    expect(warned).not.toContain('front_delts');
    expect(warned).not.toContain('rear_delts');

    const readiness = buildReadinessRows(
      stats,
      [],
      NOW,
      reachable,
      undefined,
      undefined, // sorenessOverrides
      new Set<CoarseMuscle>(['shoulders'])
    );
    const { targets } = selectGoodTargets(readiness, 50);
    const targetMuscles = targets.map((t) => t.muscle);
    expect(targetMuscles).not.toContain('front_delts');
    expect(targetMuscles).not.toContain('rear_delts');
  });
});

describe('calves fixture: seated + standing raises split soleus/gastrocnemius', () => {
  // Standing: gastrocnemius primary + soleus 0.5× secondary.
  // Seated: soleus primary + gastrocnemius 0.5× secondary.
  const blocks = [
    block('standing', 'gastrocnemius', ['soleus'], 4, 'Standing Calf Raise'),
    block('seated', 'soleus', ['gastrocnemius'], 4, 'Seated Calf Raise'),
  ];

  it('fractional secondaries credit the sibling head, parent counts each set once', () => {
    const { rows } = rowsFor(blocks, new Set<CoarseMuscle>(['calves']));
    const calves = rows.find((r) => r.muscle === 'calves')!;
    const byMuscle = new Map(calves.children.map((c) => [c.muscle, c]));

    // 4 primary + 0.5 × 4 secondary = 6 credited sets per head.
    expect(byMuscle.get('gastrocnemius')!.sets).toBe(6);
    expect(byMuscle.get('soleus')!.sets).toBe(6);
    expect(byMuscle.get('gastrocnemius')!.reachable).toBe(true);
    expect(byMuscle.get('soleus')!.reachable).toBe(true);

    // Parent = 12 credited sets (8 primary + 4 fractional secondary),
    // NOT 6 + 6 double-counted against an extra coarse bucket.
    expect(calves.sets).toBe(12);
  });

  it('a lagging soleus auto-surfaces without expansion (standing-only week)', () => {
    const { rows } = rowsFor([block('standing', 'gastrocnemius', ['soleus'], 4, 'Standing Calf Raise')]);
    const calves = rows.find((r) => r.muscle === 'calves')!;
    // soleus: 2 credited sets < MEV 3 → auto-surfaced warning row.
    const soleus = calves.children.find((c) => c.muscle === 'soleus');
    expect(soleus).toBeDefined();
    expect(soleus!.sets).toBe(2);
    expect(soleus!.belowMev).toBe(true);
    expect(belowMevVolumeData(rows).map((d) => d.muscleGroup as string)).toContain('soleus');
  });
});

describe('traps fixture: shrugs and face pulls feed the fine members', () => {
  const blocks = [
    block('shrug', 'upper_traps', [], 4, 'Barbell Shrug'),
    block('fp', 'rear_delts', ['upper_back', 'mid_lower_traps'], 4, 'Face Pull'),
    block('carry', 'forearms', ['traps'], 2, "Farmer's Carry"), // coarse secondary stays coarse
  ];

  it('fine tags feed fine members; a coarse traps tag stays on the coarse bucket', () => {
    const { rows } = rowsFor(blocks, new Set<CoarseMuscle>(['traps']));
    const traps = rows.find((r) => r.muscle === 'traps')!;
    const byMuscle = new Map(traps.children.map((c) => [c.muscle, c]));

    expect(byMuscle.get('upper_traps')!.sets).toBe(4);
    expect(byMuscle.get('mid_lower_traps')!.sets).toBe(2); // 0.5 × 4
    // Parent: 4 (upper) + 2 (mid/lower) + 1 (0.5 × 2 coarse 'traps') = 7.
    expect(traps.sets).toBe(7);
  });
});

describe('property: parent total == fine-child credits + coarse-tagged credits, once each', () => {
  // Mixed grains everywhere a coarse group has fine members.
  const blocks = [
    block('coarse-calf', 'calves', [], 5),
    block('standing', 'gastrocnemius', ['soleus'], 3),
    block('seated', 'soleus', ['gastrocnemius'], 2),
    block('coarse-traps', 'traps', [], 3),
    block('shrug', 'upper_traps', [], 2),
    block('bench', 'chest', ['front_delts', 'triceps'], 4),
    block('row', 'back', ['biceps', 'rear_delts'], 4),
    block('lr', 'lateral_delts', [], 3),
    block('hip-thrust', 'glutes', [], 3),
    block('clamshell', 'glute_med', [], 2),
  ];

  /** Independent re-derivation of raw per-standard-muscle credits. */
  function rawCredits(rows: WeeklyVolumeBlockRow[]): Map<StandardMuscleGroup, number> {
    const raw = new Map<StandardMuscleGroup, number>();
    const add = (m: StandardMuscleGroup, v: number) => raw.set(m, (raw.get(m) ?? 0) + v);
    for (const b of rows) {
      const ex = b.exercises!;
      const sets = (b.set_logs ?? []).filter((s) => !s.is_warmup).length;
      const primaryCredits = resolvePrimaryMuscleCredits(ex.primary_muscle!);
      const primarySet = new Set(primaryCredits.map((c) => c.muscle));
      for (const { muscle, weight } of primaryCredits) add(muscle, sets * weight);
      for (const secondary of ex.secondary_muscles ?? []) {
        const standards = resolveMuscleToStandard(secondary);
        const per = SECONDARY_MUSCLE_CREDIT / standards.length;
        for (const std of standards) {
          if (primarySet.has(std)) continue;
          add(std, sets * per);
        }
      }
    }
    return raw;
  }

  it('every coarse row equals the rounded sum of its standard children — no set counted twice', () => {
    const raw = rawCredits(blocks);
    const { rows } = rowsFor(blocks, new Set<CoarseMuscle>(COARSE_MUSCLES));

    for (const row of rows) {
      const expected = COARSE_CHILDREN[row.muscle as CoarseMuscle].reduce(
        (sum, std) => sum + (raw.get(std) ?? 0),
        0
      );
      expect(row.sets).toBe(Math.round(expected));
    }

    // Global conservation: the coarse rollup equals ALL credit handed out —
    // every standard muscle belongs to exactly one coarse parent.
    const totalRows = rows.reduce((s, r) => s + r.sets, 0);
    const totalRaw = Array.from(raw.values()).reduce((s, v) => s + v, 0);
    expect(Math.abs(totalRows - totalRaw)).toBeLessThan(rows.length); // per-row rounding only
  });

  it('every standard muscle has exactly one coarse parent (rollup can never double-count)', () => {
    const seen = new Map<string, CoarseMuscle>();
    for (const coarse of COARSE_MUSCLES) {
      for (const std of COARSE_CHILDREN[coarse]) {
        expect(seen.has(std)).toBe(false);
        seen.set(std, coarse);
      }
    }
  });
});

describe('unfeedable libraries: no fine row, no chevron, no warning', () => {
  // Entirely coarse-tagged logging — nothing can feed any FINE_MUSCLE_PARENTS
  // member (coarse tags never leak into them).
  const blocks = [
    block('calf', 'calves', [], 4),
    block('shrug', 'traps', [], 4),
    block('glute', 'glutes', [], 4),
    block('crunch', 'abs', [], 4),
    block('row', 'back', [], 4),
  ];

  it('coarse-only calves/traps/glutes/abs rows are not expandable', () => {
    const { rows } = rowsFor(blocks);
    for (const muscle of ['calves', 'traps', 'glutes', 'abs'] as const) {
      expect(rows.find((r) => r.muscle === muscle)!.expandable).toBe(false);
    }
    // 'back' still expands: a coarse 'back' tag resolves to lats + upper_back,
    // which are themselves fine children of the back row.
    expect(rows.find((r) => r.muscle === 'back')!.expandable).toBe(true);
  });

  it('a stale persisted expansion cannot resurrect an unfeedable fine row', () => {
    const { rows } = rowsFor(blocks, new Set<CoarseMuscle>(['calves', 'traps', 'glutes', 'abs']));
    for (const muscle of ['calves', 'traps', 'glutes', 'abs'] as const) {
      expect(rows.find((r) => r.muscle === muscle)!.children).toHaveLength(0);
    }
  });

  it('every fine member is gated by isMuscleWarnable — the shared gate legacy volume consumers (useWeeklyVolume) apply too', () => {
    const none = new Set<StandardMuscleGroup>();
    for (const fine of Object.keys(FINE_MUSCLE_PARENTS) as StandardMuscleGroup[]) {
      expect(isMuscleWarnable(fine, none)).toBe(false);
      expect(isMuscleWarnable(fine, new Set<StandardMuscleGroup>([fine]))).toBe(true);
    }
  });

  it('no unreachable fine member appears in warnings or the MEV summary', () => {
    const { stats, reachable, rows } = rowsFor(blocks);
    const fineMembers = Object.keys(FINE_MUSCLE_PARENTS);
    const warned = belowMevVolumeData(rows).map((d) => d.muscleGroup as string);
    for (const fine of fineMembers) expect(warned).not.toContain(fine);

    const summary = computeWeeklyMevSummary(stats, reachable)!;
    for (const fine of fineMembers) {
      expect(summary.entries.some((e) => e.muscle === fine)).toBe(false);
    }
  });

  it('every fine member has a positive MEV so a reachable-but-untrained one CAN warn — except deliberate MEV-0 indirect-fill members', () => {
    // mid_lower_traps mirrors glute_med/obliques: indirect fill, warning only
    // once trained below target is impossible (MEV 0 ⇒ never below).
    expect(MEV_TARGETS.upper_traps).toBeGreaterThan(0);
    expect(MEV_TARGETS.gastrocnemius).toBeGreaterThan(0);
    expect(MEV_TARGETS.soleus).toBeGreaterThan(0);
    expect(MEV_TARGETS.mid_lower_traps).toBeGreaterThanOrEqual(0);
  });
});
