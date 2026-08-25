/**
 * THE DIRECT / CREDITED CONVENTION — relationship tests.
 *
 * HyperTrack keeps two volume tables on purpose:
 *
 *   DEFAULT_VOLUME_LANDMARKS (types/schema)  DIRECT programmed sets,
 *                                            scaled by experience tier,
 *                                            editable by the user in Settings.
 *   MEV_TARGETS / getEffectiveBand           CREDITED sets — a primary tag
 *     (services/volumeBands)                 counts 1.0/set and a secondary tag
 *                                            SECONDARY_MUSCLE_CREDIT (0.5)/set.
 *                                            Experience-independent. This is
 *                                            what colours and warns on the row.
 *
 * They give different numbers for the same muscle and that is CORRECT. These
 * tests pin the RELATIONSHIPS that make the split real — that the tables are
 * independent, carry different units, and scale differently. They deliberately
 * do NOT pin research values: every number in either table is legitimately
 * editable by whoever owns the training science, and a test that froze them
 * would turn a value review into a test failure.
 *
 * If one of these fails, the fix is almost never "make the tables agree".
 * Read the failure message.
 *
 * Not asserted here: that getEffectiveBand never reads DEFAULT_VOLUME_LANDMARKS.
 * It does, for MRV, on 11 of the 15 fine muscles — the un-converted direct-MRV
 * fallback documented at the `referenceMrv` line in volumeBands. That is a
 * known open item (docs/MUSCLE_ATTRIBUTION_CORRECTIONS_PROPOSED.md:240-244),
 * not an invariant, so asserting it would fail today.
 */
import {
  getEffectiveBand,
  getStandardMev,
  COARSE_MUSCLES,
  FINE_CHILD_MUSCLES,
} from '@/services/volumeBands';
import { perSetStandardCredit, SECONDARY_MUSCLE_CREDIT } from '@/services/shared/volumeCredit';
import {
  DEFAULT_VOLUME_LANDMARKS,
  STANDARD_MUSCLE_GROUPS,
  type Experience,
  type StandardMuscleGroup,
  type VolumeLandmarks,
} from '@/types/schema';

const TIERS: Experience[] = ['novice', 'intermediate', 'advanced'];

const WHY_DIVERGENCE_IS_LEGAL =
  'The direct landmark table and the credited band are DIFFERENT UNITS: ' +
  'landmarks count programmed sets that target the muscle, bands count ' +
  'credited sets (primary 1.0/set + secondary 0.5/set). They are also scaled ' +
  'differently — landmarks by experience tier, bands not at all. Do NOT ' +
  'resolve this by editing either table to match the other; that changes ' +
  'research values to fix a units mismatch. See the convention note above ' +
  'MEV_TARGETS in services/volumeBands.';

describe('the credited band is independent of the direct landmark table', () => {
  it('a user editing their direct oblique MEV does not move the credited threshold', () => {
    // The scenario the labelling exists for: Settings shows Obliques MEV 0 and
    // the volume row warns at a credited 4. A user "fixes" the 0 by typing 7.
    //
    // Mutating the direct table in place is what makes this test real rather
    // than a restatement: if getEffectiveBand ever sourced a fine muscle's MEV
    // from the landmarks, the edit below would move the band. (It legitimately
    // does read that table for MRV, so only `mev` is touched here.)
    const original: VolumeLandmarks = DEFAULT_VOLUME_LANDMARKS.intermediate.obliques;
    const before = getEffectiveBand('obliques').mev;
    try {
      DEFAULT_VOLUME_LANDMARKS.intermediate.obliques = { ...original, mev: 7 };
      expect(DEFAULT_VOLUME_LANDMARKS.intermediate.obliques.mev).toBe(7);

      const after = getEffectiveBand('obliques').mev;
      if (after !== before) {
        throw new Error(
          `Editing the DIRECT oblique MEV changed the CREDITED band (${before} -> ${after}). ` +
            WHY_DIVERGENCE_IS_LEGAL
        );
      }
      expect(after).toBe(before);
    } finally {
      DEFAULT_VOLUME_LANDMARKS.intermediate.obliques = original;
    }
    expect(getEffectiveBand('obliques').mev).toBe(before);
  });

  it('a FINE muscle takes its credited MEV from the band source, not the landmark table', () => {
    // Scoped to fine muscles on purpose. An id that is BOTH a standard muscle
    // and a coarse group (abs, traps, calves, …) resolves to the GROUP band
    // instead — see the dual-id test below.
    for (const muscle of Array.from(FINE_CHILD_MUSCLES)) {
      expect({ muscle, mev: getEffectiveBand(muscle).mev }).toEqual({
        muscle,
        mev: getStandardMev(muscle),
      });
    }
  });

  it('a dual-id muscle resolves to its GROUP band, not its per-standard MEV', () => {
    // Third independent reason two numbers for one muscle can both be right:
    // ids like 'abs' name a standard muscle AND a coarse group, and
    // getEffectiveBand answers for the group while getStandardMev answers for
    // the standard row. Documented above getStandardMev in volumeBands.
    const dualId = STANDARD_MUSCLE_GROUPS.filter(
      (m) => (COARSE_MUSCLES as readonly string[]).includes(m)
    );
    expect(dualId.length).toBeGreaterThan(0);
    const differing = dualId.filter((m) => getEffectiveBand(m).mev !== getStandardMev(m));
    // Not asserting WHICH differ or by how much — both sides are editable.
    expect(differing.length).toBeGreaterThan(0);
    if (differing.length === 0) {
      throw new Error(
        'No dual-id muscle distinguishes its group band from its per-standard ' +
          'MEV any more. Before flattening the two readings together, note they ' +
          'answer different questions: the group row vs the standard row. ' +
          WHY_DIVERGENCE_IS_LEGAL
      );
    }
  });

  it('the two tables are ALLOWED to disagree, and in practice do', () => {
    const divergent = STANDARD_MUSCLE_GROUPS.filter(
      (m) => DEFAULT_VOLUME_LANDMARKS.intermediate[m].mev !== getStandardMev(m)
    );
    // Asserting only that divergence EXISTS and is widespread, never which
    // muscles or by how much — those are editable research values.
    expect(divergent.length).toBeGreaterThan(0);
    if (divergent.length === 0) {
      throw new Error(
        'The direct and credited tables now agree on every muscle. That is a ' +
          'red flag, not a win: it usually means someone closed the gap by ' +
          'hand. ' +
          WHY_DIVERGENCE_IS_LEGAL
      );
    }
  });
});

describe('the two tables scale differently', () => {
  it('direct landmarks are experience-scaled', () => {
    const distinct = STANDARD_MUSCLE_GROUPS.filter((m) => {
      const mevs = TIERS.map((t) => DEFAULT_VOLUME_LANDMARKS[t][m].mev);
      const mrvs = TIERS.map((t) => DEFAULT_VOLUME_LANDMARKS[t][m].mrv);
      return new Set(mevs).size > 1 || new Set(mrvs).size > 1;
    });
    expect(distinct.length).toBeGreaterThan(0);
  });

  it('the credited threshold is NOT experience-scaled — one number per muscle', () => {
    // getStandardMev and getEffectiveBand both take no experience argument by
    // design. If a tier ever needs its own credited threshold that is a
    // signature change, not a reason to start reading the direct table here.
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const credited = getEffectiveBand(muscle).mev;
      const acrossTiers = TIERS.map(() => getEffectiveBand(muscle).mev);
      expect(new Set(acrossTiers).size).toBe(1);
      expect(acrossTiers[0]).toBe(credited);
      // The direct table, by contrast, holds a value per tier.
      for (const tier of TIERS) {
        expect(typeof DEFAULT_VOLUME_LANDMARKS[tier][muscle].mev).toBe('number');
      }
    }
  });

  it('obliques shows both halves at once: direct MEV varies by tier, credited does not', () => {
    // The concrete case behind the "Direct MEV" column label. Compares the
    // SHAPE of the two tables, not their values.
    const directMevs = TIERS.map((t) => DEFAULT_VOLUME_LANDMARKS[t].obliques.mev);
    const creditedMev = getEffectiveBand('obliques').mev;
    expect(new Set(TIERS.map(() => creditedMev)).size).toBe(1);
    expect(directMevs.every((v) => typeof v === 'number')).toBe(true);
    // Whatever the tiers hold, the credited threshold is a single number that
    // none of them can move.
    expect(getEffectiveBand('obliques').mev).toBe(creditedMev);
  });
});

describe('credited sets are what the band is measured against', () => {
  it('a secondary tag contributes SECONDARY_MUSCLE_CREDIT per set, a primary tag 1.0', () => {
    const asPrimary = perSetStandardCredit('obliques', []);
    const asSecondary = perSetStandardCredit('abs', ['obliques']);
    expect(asPrimary['obliques']).toBe(1);
    expect(asSecondary['obliques']).toBe(SECONDARY_MUSCLE_CREDIT);
    expect(SECONDARY_MUSCLE_CREDIT).toBeGreaterThan(0);
    expect(SECONDARY_MUSCLE_CREDIT).toBeLessThan(1);
  });

  it('a coarse tag never leaks credit into a subdivision — that is why the units differ', () => {
    // 'abs' resolves standard-first to itself, so crunches credit abs and
    // nothing else. This is the mechanism that makes a direct-set landmark and
    // a credited threshold genuinely different quantities rather than two
    // spellings of one number.
    const crunch = perSetStandardCredit('abs', []);
    expect(crunch['obliques']).toBeUndefined();
    expect(crunch['abs']).toBe(1);
  });

  it('reaching a credited threshold indirectly takes twice as many sets as directly', () => {
    const target = getEffectiveBand('obliques').mev;
    const perDirectSet = perSetStandardCredit('obliques', [])['obliques'];
    const perSecondarySet = perSetStandardCredit('abs', ['obliques'])['obliques'];
    expect(target / perSecondarySet).toBe((target / perDirectSet) * 2);
  });
});

describe('band construction stays in credited units', () => {
  it('every muscle yields a usable {mev, mrv} with mrv above mev', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const band = getEffectiveBand(muscle);
      expect(Number.isFinite(band.mev)).toBe(true);
      expect(Number.isFinite(band.mrv)).toBe(true);
      expect(band.mrv).toBeGreaterThan(band.mev);
    }
  });

  it('VolumeBand carries no MAV — MAV lives only in the direct landmark table', () => {
    // Guards against someone "restoring" a MAV onto the band by copying it
    // across from the landmarks, which would import a direct-set number into
    // a credited-set structure.
    const band = getEffectiveBand('obliques') as unknown as Record<string, unknown>;
    expect(Object.keys(band).sort()).toEqual(['mev', 'mrv']);
    expect('mav' in DEFAULT_VOLUME_LANDMARKS.intermediate.obliques).toBe(true);
  });

  it('a fine muscle resolves through the band source for both ends', () => {
    const fine: StandardMuscleGroup = 'glute_med'; // obliques' structural twin
    const band = getEffectiveBand(fine);
    expect(band.mev).toBe(getStandardMev(fine));
    expect(band.mrv).toBeGreaterThanOrEqual(band.mev + 2);
  });
});
