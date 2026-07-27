/**
 * Muscle-attribution audit over every static attribution source in the repo
 * (volume-panel attribution defect, Phase 1).
 *
 * Sources audited:
 *   1. seed-db            — services/generated/seedExerciseTags.ts, the parsed
 *                           SQL corpus = the live stock `exercises` rows.
 *   2. service-fallback   — exerciseService.FALLBACK_EXERCISES (seed tags
 *                           overlaid; entries the seed doesn't know keep their
 *                           authored tags — that's where legacy coarse
 *                           primaries like Arnold Press 'shoulders' survive).
 *   3. program-template   — lib/training/constants.EXERCISE_DATABASE (the
 *                           program engine's candidate pool; never retagged).
 *
 * User-created custom exercises live only in the DB and are covered at
 * runtime by lib/migrations/coarsePrimaryRetag's dry-run report.
 *
 * The KNOWN_* lists below are the Phase 1 audit output, pinned: a NEW
 * failure anywhere fails this test loudly, and Phase 2 must shrink the lists
 * deliberately (review-gated), never silently.
 *
 * Print the full table with: AUDIT_VERBOSE=1 npx jest muscleAttributionAudit
 */

import {
  auditAttributionTable,
  attributionFailures,
  uniformSplitRows,
  droppedTokenRows,
  formatAttributionReport,
  perSetStandardCredit,
  type AttributionEntry,
} from '../muscleAttributionAudit';
import { SEED_EXERCISE_TAGS } from '../generated/seedExerciseTags';
import { FALLBACK_EXERCISES } from '../exerciseService';
import { EXERCISE_DATABASE } from '@/lib/training/constants';

function collectEntries(): AttributionEntry[] {
  const entries: AttributionEntry[] = [];
  for (const [name, tags] of Object.entries(SEED_EXERCISE_TAGS)) {
    entries.push({ name, source: 'seed-db', primary: tags.primary, secondaries: tags.secondaries });
  }
  for (const ex of FALLBACK_EXERCISES) {
    entries.push({
      name: ex.name,
      source: 'service-fallback',
      primary: ex.primaryMuscle,
      secondaries: ex.secondaryMuscles ?? [],
    });
  }
  for (const ex of EXERCISE_DATABASE) {
    entries.push({
      name: ex.name,
      source: 'program-template',
      primary: ex.primaryMuscle,
      secondaries: ex.secondaryMuscles ?? [],
    });
  }
  return entries;
}

const rows = auditAttributionTable(collectEntries());

describe('muscle attribution audit (Phase 1 — report only)', () => {
  it('prints the full table when AUDIT_VERBOSE is set', () => {
    if (process.env.AUDIT_VERBOSE) {
      // eslint-disable-next-line no-console
      console.log(formatAttributionReport(rows));
    }
  });

  it('perSetStandardCredit mirrors the live counter (⅓ head smear, 0.5 secondary)', () => {
    expect(perSetStandardCredit('shoulders', [])).toEqual({
      front_delts: 1 / 3,
      lateral_delts: 1 / 3,
      rear_delts: 1 / 3,
    });
    expect(perSetStandardCredit('lats', ['rear_delts'])).toEqual({
      lats: 1,
      rear_delts: 0.5,
    });
  });

  it('pins the known invariant failures (Phase 2 worklist — shrink only via review)', () => {
    const failures = attributionFailures(rows);
    expect(
      failures.map((r) => `${r.source} | ${r.name} | ${r.verdict} | rival ${r.rival}`)
    ).toMatchSnapshot();
  });

  it('pins the uniform head-split primaries (the coarse-smear mechanism class)', () => {
    const uniform = uniformSplitRows(rows);
    expect(uniform.map((r) => `${r.source} | ${r.name} | ${r.primary}`)).toMatchSnapshot();
  });

  it('pins tags that resolve to nothing (silently dropped credit)', () => {
    const dropped = droppedTokenRows(rows);
    expect(
      dropped.map((r) => `${r.source} | ${r.name} | dropped [${r.droppedTokens.join(', ')}]`)
    ).toMatchSnapshot();
  });
});
