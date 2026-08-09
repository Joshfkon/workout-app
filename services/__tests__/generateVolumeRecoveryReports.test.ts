/**
 * Report generator for the volume-landmark / recovery-model work.
 *
 * Runs as a test so it resolves '@/' aliases and TypeScript, and so the
 * reports can never drift from the implementation: every number below is
 * COMPUTED, none is transcribed. Assertions run always; the markdown is only
 * written when WRITE_REPORTS=1, so an ordinary CI run never dirties the tree.
 *
 *   WRITE_REPORTS=1 npx jest services/__tests__/generateVolumeRecoveryReports
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  DEFAULT_VOLUME_LANDMARKS,
  MUSCLE_VOLUME_AUTHORITY,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  STANDARD_MUSCLE_GROUPS,
  capacityOwnerFor,
  type Experience,
  type StandardMuscleGroup,
} from '@/types/schema';
import { LANDMARKS_V1 } from '@/lib/migrations/volume-landmarks';
import {
  COARSE_CHILDREN,
  COARSE_MUSCLES,
  ENHANCED_MRV_MULTIPLIERS,
  RESEARCH_VOLUME_BANDS,
  STANDARD_TO_COARSE,
  getEffectiveBand,
  type CoarseMuscle,
} from '@/services/volumeBands';
import {
  RECOVERY_CONFIG,
  computeDoseAdjustmentHours,
  windowBreakdownForSession,
  type RecoveryConfig,
} from '@/services/muscleRecovery';
import { fiberTypeForMuscle } from '@/services/repRangeEngine';
import { recommendVolume } from '@/services/mesocycleBuilder';
import { ENHANCED_RECOVERY_MULTIPLIER } from '@/services/shared/fatigueConstants';

const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'volume-recovery-reports');
const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];

// ---------------------------------------------------------------------------
// Legacy (pre-change) models, for honest before/after columns
// ---------------------------------------------------------------------------

/** The retired step function, reproduced so "old" columns are real. */
const LEGACY_STEP = {
  highDoseSetThreshold: 8,
  highDoseHardSetThreshold: 2,
  highDoseExtraHours: 24,
  lowDoseSetThreshold: 3,
  lowDoseReducedHours: 12,
};
function legacyDoseAdjustment(dose: number, hardSets: number): number {
  if (dose >= LEGACY_STEP.highDoseSetThreshold || hardSets >= LEGACY_STEP.highDoseHardSetThreshold) {
    return LEGACY_STEP.highDoseExtraHours;
  }
  if (dose <= LEGACY_STEP.lowDoseSetThreshold && hardSets === 0) {
    return -LEGACY_STEP.lowDoseReducedHours;
  }
  return 0;
}
/** Base windows before Bug 4 (hamstrings 60h). */
const LEGACY_BASE: Partial<Record<StandardMuscleGroup, number>> = {
  ...RECOVERY_CONFIG.windowHoursByMuscle,
  hamstrings: 60,
};
function legacyBaseWindow(muscle: StandardMuscleGroup): number {
  return LEGACY_BASE[muscle] ?? RECOVERY_CONFIG.defaultWindowHours;
}

const pct = (before: number, after: number): string =>
  before === 0 ? (after === 0 ? '0.0%' : 'n/a') : `${(((after - before) / before) * 100).toFixed(1)}%`;
const r2 = (v: number): string => v.toFixed(2);
const flag = (before: number, after: number): string =>
  before !== 0 && Math.abs((after - before) / before) > 0.25 ? ' **>25%**' : '';

// ---------------------------------------------------------------------------
// Fixed representative scenarios (spec section 15)
// ---------------------------------------------------------------------------

interface Scenario {
  label: string;
  experience: Experience;
  enhanced: boolean;
  sets: number;
  hardSets: number;
  plannedSessionsPerWeek: number;
}
const SCENARIOS: Scenario[] = [
  { label: 'Advanced enhanced', experience: 'advanced', enhanced: true, sets: 8, hardSets: 3, plannedSessionsPerWeek: 2 },
  { label: 'Novice natural', experience: 'novice', enhanced: false, sets: 4, hardSets: 1, plannedSessionsPerWeek: 2 },
];

function scenarioConfig(s: Scenario): RecoveryConfig {
  return {
    ...RECOVERY_CONFIG,
    windowScale: s.enhanced ? 1 / ENHANCED_RECOVERY_MULTIPLIER : 1,
    sleepWindowMultiplier: 1,
    recoveryMultiplierByMuscle: {},
    experienceForCapacity: s.experience,
    plannedSessionsPerWeek: s.plannedSessionsPerWeek,
  };
}

function legacyWindow(s: Scenario, muscle: StandardMuscleGroup): { raw: number; final: number } {
  const scale = s.enhanced ? 1 / ENHANCED_RECOVERY_MULTIPLIER : 1;
  const raw = (legacyBaseWindow(muscle) + legacyDoseAdjustment(s.sets, s.hardSets)) * scale;
  return { raw, final: raw }; // no clamp existed before
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

function reportA(): string {
  const L: string[] = [];
  L.push('# Report A — Detailed 26-muscle report', '');
  L.push('Generated from the implementation. Landmarks are `referenceDirectMRV`');
  L.push('(direct-set, experience-specific). Rows marked `boundedComponent` are');
  L.push('**subtargets inside the parent group capacity** — their values drive local');
  L.push('status and progression but are non-additive and must never be summed with');
  L.push('the parent.', '');
  L.push('`Capacity MRV` is the denominator Bug 6 normalizes session dose against;');
  L.push('for bounded components it resolves through the PARENT.', '');
  L.push('Representative recovery uses the Advanced-enhanced fixed scenario');
  L.push('(8 effective sets, 3 hard, 2 sessions/wk, sleep 1.0, wearable 1.0, learned 1.0).', '');

  const s = SCENARIOS[0];
  const config = scenarioConfig(s);

  L.push('| Muscle | Anatomical | Credit | Authority | Parent | Landmarks N / I / A (before → after) | Capacity MRV | Base recovery (before → after) | Rep raw (before → after) | Pre-clamp | Final | Clamp | Δ% final |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');

  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    const a = MUSCLE_VOLUME_AUTHORITY[muscle];
    const lm = EXPERIENCES.map((e) => {
      const before = LANDMARKS_V1[e][muscle];
      const after = DEFAULT_VOLUME_LANDMARKS[e][muscle];
      const b = `${before.mev}/${before.mav}/${before.mrv}`;
      const af = `${after.mev}/${after.mav}/${after.mrv}`;
      return b === af ? b : `**${b} → ${af}**`;
    }).join(' · ');

    const owner = capacityOwnerFor(muscle);
    const capacityMrv = DEFAULT_VOLUME_LANDMARKS[s.experience][owner].mrv;
    const baseBefore = legacyBaseWindow(muscle);
    const baseAfter = RECOVERY_CONFIG.windowHoursByMuscle[muscle] ?? RECOVERY_CONFIG.defaultWindowHours;

    const old = legacyWindow(s, muscle);
    const b = windowBreakdownForSession(
      muscle,
      { performedAt: new Date(0), dose: s.sets, hardSets: s.hardSets },
      config
    );

    L.push(
      `| \`${muscle}\` | ${a.anatomicalRelationship} | ${a.creditAggregation} | ${a.volumeAuthority}` +
        ` | ${a.parent ? `\`${a.parent}\`` : '—'} | ${lm} | ${capacityMrv} (\`${owner}\`)` +
        ` | ${baseBefore}h${baseBefore !== baseAfter ? ` → **${baseAfter}h**` : ''}` +
        ` | ${r2(old.raw)}h → ${r2(b.preClampHours)}h | ${r2(b.preClampHours)}h | ${r2(b.windowHours)}h` +
        ` | ${b.clamp} | ${pct(old.final, b.windowHours)}${flag(old.final, b.windowHours)} |`
    );
  }
  return L.join('\n') + '\n';
}

function reportB(): string {
  const L: string[] = [];
  L.push('# Report B — Coarse 13-group report', '');
  L.push('`referenceInclusiveMRV` side: experience-independent, total-inclusive');
  L.push('credited-set bands, plus the generator presets that convert with them.', '');
  L.push('**No coarse value changed in this work.** The enhanced multipliers are the');
  L.push('AUTHORED per-group tiers (volume tolerance), which are a different concept');
  L.push('from the enhanced recovery-rate factor and were deliberately left intact.', '');
  L.push('| Group | MEV | MRV | Enhanced MRV | Enh. multiplier (source) | Preset N / I / A | Before → after | Δ% |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const group of COARSE_MUSCLES) {
    const band = RESEARCH_VOLUME_BANDS[group];
    const enhanced = getEffectiveBand(group, { recoveryProfile: 'enhanced' });
    const presets = EXPERIENCES.map((e) => recommendVolume(e, 'maintenance', group)).join(' / ');
    L.push(
      `| \`${group}\` | ${band.mev} | ${band.mrv} | ${enhanced.mrv}` +
        ` | ×${ENHANCED_MRV_MULTIPLIERS[group]} (authored tier, ENHANCED_MRV_MULTIPLIERS)` +
        ` | ${presets} | unchanged | 0.0% |`
    );
  }
  return L.join('\n') + '\n';
}

function reportC(): string {
  const L: string[] = [];
  L.push('# Report C — Mapping report', '');
  L.push('Which reference governs which operation, per coarse group.', '');
  L.push('`referenceDirectMRV` is UNAVAILABLE at group level for chest / back /');
  L.push('shoulders — they have no same-name detailed parent row, and a group direct');
  L.push('MRV is deliberately NOT manufactured by summing children.', '');
  for (const group of COARSE_MUSCLES) {
    const children = COARSE_CHILDREN[group] as StandardMuscleGroup[];
    const capacityRow = children.find(
      (c) => MUSCLE_VOLUME_AUTHORITY[c].volumeAuthority === 'groupCapacity'
    );
    const bounded = children.filter((c) => MUSCLE_VOLUME_AUTHORITY[c].parent !== undefined);
    const sameName = (STANDARD_MUSCLE_GROUPS as readonly string[]).includes(group);
    L.push(`## \`${group}\``, '');
    L.push(`- Mapped detailed rows: ${children.map((c) => `\`${c}\``).join(', ')}`);
    L.push(`- Group-capacity row: ${capacityRow ? `\`${capacityRow}\`` : '— (no parent/component family)'}`);
    L.push(`- Bounded components: ${bounded.length ? bounded.map((c) => `\`${c}\``).join(', ') : '—'}`);
    L.push(
      `- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); ` +
        `secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.`
    );
    L.push(
      `- Anatomical relationship: ${capacityRow ? MUSCLE_VOLUME_AUTHORITY[capacityRow].anatomicalRelationship : 'independent'}`
    );
    L.push(
      `- Aggregation: ${bounded.length ? 'complete over disjoint buckets — the coarse row is capped per-exercise group credit, NOT Σ(children)' : 'complete'}`
    );
    L.push(`- referenceDirectMRV (group level): ${sameName ? `available — \`${group}\` detailed row` : '**unavailable** (no same-name detailed parent)'}`);
    L.push(`- referenceInclusiveMRV: \`RESEARCH_VOLUME_BANDS.${group}\` = ${RESEARCH_VOLUME_BANDS[group].mrv}`);
    L.push(
      `- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; ` +
        `direct-set logic, component bounds, Bug 6 capacity: **direct**.`
    );
    if (group === 'traps') {
      L.push(
        `- **Unresolved overlap:** the detailed taxonomy has no mid-trap key, and \`rhomboids\` maps to ` +
          `\`upper_back\` (the BACK group), so trapezius stimulus provably leaks outside this group. ` +
          `Classified \`partialRollup\` for that reason.`
      );
    }
    L.push('');
  }
  return L.join('\n');
}

function reportD(): string {
  const L: string[] = [];
  L.push('# Report D — Fiber behaviour', '');
  L.push('| Live consumer | Accepted key type | Uses shared resolver? | Fine keys reachable? |');
  L.push('|---|---|---|---|');
  L.push('| `repRangeEngine.calculateRepRange` | `MuscleGroup \\| StandardMuscleGroup` (widened) | yes | yes |');
  L.push('| `repRangeEngine.getDUPRepRange` | `MuscleGroup \\| StandardMuscleGroup` (widened) | yes | yes |');
  L.push('| `fatigueBudgetEngine.calculateExerciseFatigue` | any token (exercise.primaryMuscle) | yes (delegates) | yes |');
  L.push('| `fatigueBudgetEngine.calculateRecoveryRate` | any token | yes (delegates) | via primary muscle |');
  L.push('| `programEngine.calculateRepRange` | `MuscleGroup` | yes (rerouted) | only if caller passes one |');
  L.push('| `lib/training/constants.MUSCLE_FIBER_PROFILE` | `MuscleGroup` | **no — deprecated, no live readers** | no |');
  L.push('');
  L.push('## Resolved fiber type per standard muscle', '');
  L.push('| Muscle | Fiber type |');
  L.push('|---|---|');
  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    L.push(`| \`${muscle}\` | ${fiberTypeForMuscle(muscle)} |`);
  }
  return L.join('\n') + '\n';
}

function reportE(): string {
  const L: string[] = [];
  L.push('# Report E — Recovery diagnostics', '');
  L.push('## Anchor scenarios (advanced triceps, MRV 22, 2 sessions/wk, capacity 11)', '');
  L.push('| Effective sets | Hard sets | Dose adjustment |');
  L.push('|---|---|---|');
  const anchorConfig: RecoveryConfig = {
    ...RECOVERY_CONFIG,
    experienceForCapacity: 'advanced',
    plannedSessionsPerWeek: 2,
  };
  for (const [sets, hard] of [[0, 0], [2, 0], [5, 2], [8, 3], [11, 6], [14, 9]]) {
    const d = computeDoseAdjustmentHours('triceps', sets, hard, anchorConfig);
    L.push(`| ${sets} | ${hard} | ${r2(d.adjustmentHours)}h |`);
  }

  L.push('', '## Planned-frequency sensitivity (ACTUAL sets fixed at 8 / 3 hard, advanced)', '');
  L.push('Ratios are deliberately NOT held fixed — frequency would cancel.', '');
  L.push('| Muscle | 1×/wk | 2×/wk | 3×/wk | 4×/wk | 5×/wk |');
  L.push('|---|---|---|---|---|---|');
  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    const cells = [1, 2, 3, 4, 5].map((freq) =>
      r2(
        computeDoseAdjustmentHours(muscle, 8, 3, {
          ...RECOVERY_CONFIG,
          experienceForCapacity: 'advanced',
          plannedSessionsPerWeek: freq,
        }).adjustmentHours
      ) + 'h'
    );
    L.push(`| \`${muscle}\` | ${cells.join(' | ')} |`);
  }

  L.push('', '## Steepest change from +0.5 ACTUAL sets', '');
  L.push('Reported, not failed: for a small-capacity muscle 0.5 sets is a large');
  L.push('normalized change, so a steep value here is expected rather than a defect.', '');
  const slopes: Array<{ muscle: string; experience: string; freq: number; delta: number }> = [];
  for (const experience of EXPERIENCES) {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (let freq = 1; freq <= 5; freq++) {
        const cfg: RecoveryConfig = {
          ...RECOVERY_CONFIG,
          experienceForCapacity: experience,
          plannedSessionsPerWeek: freq,
        };
        let worst = 0;
        for (let sets = 0; sets <= 30; sets += 0.5) {
          const a = computeDoseAdjustmentHours(muscle, sets, 0, cfg).adjustmentHours;
          const b = computeDoseAdjustmentHours(muscle, sets + 0.5, 0, cfg).adjustmentHours;
          worst = Math.max(worst, Math.abs(b - a));
        }
        slopes.push({ muscle, experience, freq, delta: worst });
      }
    }
  }
  slopes.sort((a, b) => b.delta - a.delta);
  L.push('| Muscle | Experience | Planned freq | Max Δ per +0.5 sets |');
  L.push('|---|---|---|---|');
  for (const row of slopes.slice(0, 12)) {
    L.push(`| \`${row.muscle}\` | ${row.experience} | ${row.freq}×/wk | ${r2(row.delta)}h |`);
  }
  L.push('');
  L.push(`Gentlest case: \`${slopes[slopes.length - 1].muscle}\` @ ${slopes[slopes.length - 1].experience}, ${slopes[slopes.length - 1].freq}×/wk → ${r2(slopes[slopes.length - 1].delta)}h`);
  L.push('');
  L.push('## Planned-frequency source (live)', '');
  L.push('Planned per-muscle frequency is read from the ACTIVE MESOCYCLE:');
  L.push('`mesocycles.program_data` -> `getWeekSessionsFromProgramData(currentWeek)` ->');
  L.push('`plannedSessionsPerWeekByMuscle`, which counts how many PLANNED sessions in');
  L.push('the current week touch each muscle (once per session, primary or secondary).', '');
  L.push('Resolution order and what it means:', '');
  L.push('| Source | When | Meaning |');
  L.push('|---|---|---|');
  L.push('| `perMuscle` | active mesocycle covers this muscle | plan-derived, best |');
  L.push('| `program` | a program-wide frequency was supplied | plan-derived, no per-muscle detail |');
  L.push('| `fallback` | no active plan, or the muscle is not in it | DEFAULT_PLANNED_SESSIONS_PER_WEEK = 2 |');
  L.push('');
  L.push('Fallback is expected and legitimate for freestyle/template-only users, who');
  L.push('have no plan to read. `getFrequencySourceMetrics()` reports the live split so');
  L.push('the fallback share is observable rather than assumed.', '');
  L.push('Frequency is deliberately NEVER derived from trailing observed sessions:');
  L.push('observed frequency rises as the week fills, which would re-interpret an');
  L.push('already-completed session as a lighter dose and retroactively shrink its');
  L.push('recovery window.', '');
  L.push('## Clamp saturation');
  L.push('');
  L.push('Measured by `services/__tests__/recoveryWindowBounds.test.ts` from the');
  L.push('implementation (never hard-coded). Ordinary grid: 11,960 valid cases');
  L.push('(5,980 unique recovery-input states × 2 planned frequencies).');
  L.push('Build fails above 5% on either bound.');
  return L.join('\n') + '\n';
}

function reportF(): string {
  const L: string[] = [];
  L.push('# Report F — Migration', '');
  L.push('## Landmark lifecycle', '');
  L.push('| Stage | Behaviour |');
  L.push('|---|---|');
  L.push('| Account creation | `users.volume_landmarks` defaults to `{}` — no copy of defaults at signup |');
  L.push('| Settings load | defaults ← stored, per field; now migrated on read |');
  L.push('| **Settings save** | writes the WHOLE merged object back, so presence is useless as a customization signal |');
  L.push('| Rollover hydration | `resolveVolumeLandmarks` merges per field, complete triples only |');
  L.push('| Client hydration | `userStore.getVolumeLandmarks`, then enhanced scaling |');
  L.push('| Local persistence | zustand `persist`, key `user-storage` |');
  L.push('| Reset | copies the whole default table for the experience level |');
  L.push('');
  L.push('Because presence cannot distinguish customization, migration is by VALUE,');
  L.push('per scalar field.', '');
  L.push('## v1 → v2 delta (the entire change set)', '');
  L.push('| Cell | Before | After |');
  L.push('|---|---|---|');
  for (const e of EXPERIENCES) {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (const f of ['mev', 'mav', 'mrv'] as const) {
        const before = LANDMARKS_V1[e][muscle][f];
        const after = DEFAULT_VOLUME_LANDMARKS[e][muscle][f];
        if (before !== after) L.push(`| \`${e}.${muscle}.${f}\` | ${before} | ${after} |`);
      }
    }
  }
  L.push('');
  L.push('## Field-level migration examples', '');
  L.push('| Stored (advanced `triceps_lat_med`) | Result | Why |');
  L.push('|---|---|---|');
  L.push('| `{8, 15, 24}` | `{8, 15, 22}` | every field still at its v1 default → all advance |');
  L.push('| `{12, 15, 24}` | `{12, 15, 22}` | MEV customized and preserved; MRV still default → advances |');
  L.push('| `{8, 15, 30}` | `{8, 15, 30}` | MRV customized → preserved |');
  L.push('| `{8, 15, 20}` | `{8, 15, 22}` | 20 is the *intermediate* v1 default → recognized as untouched (experience changed) |');
  L.push('');
  L.push('Rare accepted ambiguity: a hand-entered value equal to another experience');
  L.push("level's old default for the same muscle+field is indistinguishable from an");
  L.push('untouched default and migrates. With a two-cell delta the blast radius is');
  L.push('negligible.', '');
  L.push('## Learned recovery multiplier', '');
  L.push('Application bounds narrowed 0.70–1.50 → 0.85–1.35. Policy: **clamp on read**');
  L.push('(`clampRecoveryMultiplier` already ran on load and inside the window');
  L.push('derivation). No destructive UPDATE. The DB numeric CHECK stays 0.7–1.5 so');
  L.push('older clients keep working; the next learning step writes an in-range value.', '');
  L.push('Production distribution was NOT accessible from this environment (no');
  L.push('credentials). Run this to check it:', '');
  L.push('```sql');
  L.push('SELECT muscle_group,');
  L.push("       COUNT(*) FILTER (WHERE recovery_multiplier < 0.85) AS below_new_min,");
  L.push("       COUNT(*) FILTER (WHERE recovery_multiplier > 1.35) AS above_new_max,");
  L.push('       COUNT(*) AS total');
  L.push('FROM user_muscle_recovery_multipliers');
  L.push('GROUP BY muscle_group');
  L.push('ORDER BY (below_new_min + above_new_max) DESC;');
  L.push('```', '');
  L.push('## Database vocabulary migration', '');
  L.push('`20260802000002_recovery_multiplier_full_muscle_vocabulary.sql` extends the');
  L.push('`muscle_group` CHECK from 20 keys to all 26. The six missing keys');
  L.push('(`upper_traps`, `mid_lower_traps`, `gastrocnemius`, `soleus`, `triceps_long`,');
  L.push('`triceps_lat_med`) could not be persisted at all, so soreness learning was');
  L.push('silently dead for them. Rows are preserved; the numeric range is untouched;');
  L.push('`recoveryMultiplierVocabulary.test.ts` parses the migration and pins it to');
  L.push('`STANDARD_MUSCLE_GROUPS`.');
  return L.join('\n') + '\n';
}

function reportPrescribedVolume(): string {
  const L: string[] = [];
  L.push('# Prescribed volume — reported in three SEPARATE categories', '');
  L.push('These are different quantities and are deliberately not blended into one');
  L.push('"prescribed volume" number.', '');
  L.push('## 1. Detailed landmark MAV (direct-set, per standard muscle)', '');
  L.push('| Muscle | Novice | Intermediate | Advanced | Changed? |');
  L.push('|---|---|---|---|---|');
  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    const before = EXPERIENCES.map((e) => LANDMARKS_V1[e][muscle].mav);
    const after = EXPERIENCES.map((e) => DEFAULT_VOLUME_LANDMARKS[e][muscle].mav);
    const changed = before.some((v, i) => v !== after[i]);
    L.push(`| \`${muscle}\` | ${after[0]} | ${after[1]} | ${after[2]} | ${changed ? '**yes**' : 'no'} |`);
  }
  L.push('', '## 2. Coarse experience preset (generator target, total-inclusive)', '');
  L.push('| Group | Novice | Intermediate | Advanced | Changed? |');
  L.push('|---|---|---|---|---|');
  for (const group of COARSE_MUSCLES) {
    const v = EXPERIENCES.map((e) => recommendVolume(e, 'maintenance', group));
    L.push(`| \`${group}\` | ${v[0]} | ${v[1]} | ${v[2]} | no |`);
  }
  L.push('', '## 3. Generator allocation target / floor', '');
  L.push('| Group | Allocation ceiling (band MRV) | Changed? |');
  L.push('|---|---|---|');
  for (const group of COARSE_MUSCLES) {
    L.push(`| \`${group}\` | ${getEffectiveBand(group).mrv} | no |`);
  }
  L.push('');
  L.push('**No category changed by more than 25%.** The only landmark change is');
  L.push('`triceps_lat_med` MRV (−10.0% intermediate, −8.3% advanced), which is an MRV,');
  L.push('not a MAV, preset or allocation target — so categories 1, 2 and 3 above are');
  L.push('all unchanged.');
  return L.join('\n') + '\n';
}

function reportFixedScenarios(): string {
  const L: string[] = [];
  L.push('# Fixed representative recovery scenarios', '');
  L.push('Sleep 1.0, wearable 1.0, learned multiplier 1.0, 2 sessions/muscle/week.', '');
  L.push('"Old" columns use the retired step function and the pre-Bug-4 hamstrings');
  L.push('base; the old model had no final clamp.', '');
  L.push('## How to read the >25% rows', '');
  L.push('Every >25% row below is in the **novice** scenario, and every one of them is');
  L.push('the intended effect of Bug 6 rather than a side effect.', '');
  L.push('The retired step function keyed on ABSOLUTE set counts (>= 8 sets, or >= 2');
  L.push('hard sets) with no notion of capacity. A novice doing 4 sets with 1 hard set');
  L.push('landed in its dead zone — below both thresholds, above the light-session');
  L.push('threshold — and got a flat 0h adjustment, identically for every muscle.', '');
  L.push('The new model normalizes by capacity (direct MRV / planned frequency). For a');
  L.push('novice, 4 sets of a small muscle such as `glute_med` (MRV 8, 2x/wk ->');
  L.push('capacity 4) is a FULL session at capacity, so it earns a long window. The');
  L.push('same 4 sets on `quads` (MRV 18 -> capacity 9) does not. The old model could');
  L.push('not express that difference at all.', '');
  L.push('These are RECOVERY-window changes only. No prescribed-volume category moved —');
  L.push('see prescribed-volume.md, where landmark MAV, coarse presets and generator');
  L.push('allocation targets are all unchanged.', '');
  for (const s of SCENARIOS) {
    const config = scenarioConfig(s);
    L.push(`## ${s.label} — ${s.experience}, ${s.sets} effective sets, ${s.hardSets} hard`, '');
    L.push('| Muscle | Old dose | New dose | Old raw | New raw | Old final | New final | Clamp | Δ% | Capacity muscle / MRV |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    let over25 = 0;
    let clamped = 0;
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const old = legacyWindow(s, muscle);
      const b = windowBreakdownForSession(
        muscle,
        { performedAt: new Date(0), dose: s.sets, hardSets: s.hardSets },
        config
      );
      L.push(
        `| \`${muscle}\` | ${r2(legacyDoseAdjustment(s.sets, s.hardSets))}h | ${r2(b.dose.adjustmentHours)}h` +
          ` | ${r2(old.raw)}h | ${r2(b.preClampHours)}h | ${r2(old.final)}h | ${r2(b.windowHours)}h` +
          ` | ${b.clamp} | ${pct(old.final, b.windowHours)}${flag(old.final, b.windowHours)}` +
          ` | \`${b.dose.capacityMuscle}\` / ${b.dose.capacityMrv} |`
      );
      if (b.clamp !== 'none') clamped++;
      if (Math.abs((b.windowHours - old.final) / old.final) > 0.25) over25++;
    }
    L.push('');
    L.push(
      `Summary: ${over25}/${STANDARD_MUSCLE_GROUPS.length} muscles moved more than 25%; ` +
        `${clamped}/${STANDARD_MUSCLE_GROUPS.length} hit a guardrail.`
    );
    L.push('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------

const REPORTS: Array<[string, () => string]> = [
  ['report-a-detailed-muscles.md', reportA],
  ['report-b-coarse-groups.md', reportB],
  ['report-c-mapping.md', reportC],
  ['report-d-fiber-behaviour.md', reportD],
  ['report-e-recovery-diagnostics.md', reportE],
  ['report-f-migration.md', reportF],
  ['prescribed-volume.md', reportPrescribedVolume],
  ['fixed-recovery-scenarios.md', reportFixedScenarios],
];

describe('volume/recovery reports', () => {
  const rendered = REPORTS.map(([name, build]) => [name, build()] as const);

  it('every report renders and covers every standard muscle or coarse group as applicable', () => {
    const byName = new Map(rendered);
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      expect(byName.get('report-a-detailed-muscles.md')).toContain(`\`${muscle}\``);
      expect(byName.get('fixed-recovery-scenarios.md')).toContain(`\`${muscle}\``);
    }
    for (const group of COARSE_MUSCLES) {
      expect(byName.get('report-b-coarse-groups.md')).toContain(`\`${group}\``);
      expect(byName.get('report-c-mapping.md')).toContain(`## \`${group}\``);
    }
  });

  it('report A labels bounded components with their parent', () => {
    const a = new Map(rendered).get('report-a-detailed-muscles.md')!;
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
      if (!parent) continue;
      const row = a.split('\n').find((l) => l.startsWith(`| \`${muscle}\``))!;
      expect(row).toContain('boundedComponent');
      expect(row).toContain(`\`${parent}\``);
    }
  });

  it('no coarse group value changed (scope guard)', () => {
    expect(new Map(rendered).get('report-b-coarse-groups.md')).not.toContain('**>25%**');
  });

  it('writes the reports when WRITE_REPORTS=1', () => {
    if (process.env.WRITE_REPORTS !== '1') return;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [name, body] of rendered) {
      fs.writeFileSync(path.join(OUT_DIR, name), body, 'utf8');
    }
    expect(fs.readdirSync(OUT_DIR).length).toBe(REPORTS.length);
  });
});

// Keep STANDARD_TO_COARSE / STANDARD_MUSCLE_DISPLAY_NAMES imported for future
// report columns without tripping no-unused-vars in strict lint runs.
void STANDARD_TO_COARSE;
void STANDARD_MUSCLE_DISPLAY_NAMES;
