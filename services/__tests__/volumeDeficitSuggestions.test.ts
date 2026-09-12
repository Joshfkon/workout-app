/**
 * volumeDeficitSuggestions.test.ts — the remedy math behind the projection
 * panel's "Under min" suggestions: which rows get one, which remedy is
 * chosen, and that the set counts come from the canonical credit model.
 */

import {
  buildDeficitSuggestions,
  MAX_ADD_SETS_TO_BLOCK,
  MAX_TARGET_SETS,
  type DeficitMuscleRow,
  type SuggestionBlock,
} from '../volumeDeficitSuggestions';

function row(over: Partial<DeficitMuscleRow> = {}): DeficitMuscleRow {
  return {
    muscle: 'biceps',
    displayName: 'Biceps',
    projectedSets: 9,
    mev: 10,
    projectedUnderMin: true,
    deficitLockedIn: false,
    ...over,
  };
}

function block(over: Partial<SuggestionBlock> = {}): SuggestionBlock {
  return {
    blockId: 'b1',
    exerciseName: 'EZ-Bar Curl',
    primaryMuscle: 'biceps',
    secondaryMuscles: [],
    targetSets: 3,
    ...over,
  };
}

describe('buildDeficitSuggestions — which rows get a suggestion', () => {
  it('suggests nothing for a row in range', () => {
    expect(
      buildDeficitSuggestions([row({ projectedUnderMin: false, projectedSets: 12 })], [block()])
    ).toEqual([]);
  });

  it('suggests nothing for a LOCKED-IN deficit — recovery says no more quality sets', () => {
    expect(
      buildDeficitSuggestions([row({ deficitLockedIn: true })], [block()])
    ).toEqual([]);
  });

  it('suggests nothing when projected already meets the minimum despite the flag', () => {
    // Defensive: a caller passing an inconsistent row (flag set, no numeric
    // deficit) must not produce a "add 0 sets" suggestion.
    expect(
      buildDeficitSuggestions([row({ projectedSets: 10, mev: 10 })], [block()])
    ).toEqual([]);
  });

  it('keeps the input row order in the output', () => {
    const result = buildDeficitSuggestions(
      [
        row({ muscle: 'back', displayName: 'Back', projectedSets: 6.5, mev: 10 }),
        row({ muscle: 'biceps', displayName: 'Biceps' }),
      ],
      []
    );
    expect(result.map((s) => s.muscle)).toEqual(['back', 'biceps']);
  });
});

describe('buildDeficitSuggestions — add sets to a direct block', () => {
  it('offers +N sets on a block whose primary directly credits the group', () => {
    const [s] = buildDeficitSuggestions([row()], [block()]);
    expect(s.setsNeeded).toBe(1);
    expect(s.action).toEqual({
      kind: 'add_sets',
      blockId: 'b1',
      exerciseName: 'EZ-Bar Curl',
      addSets: 1,
    });
  });

  it('credits a legacy coarse primary as full direct work (within-group split sums to 1.0)', () => {
    // 'shoulders' primary splits front/lateral/rear ⅓ each — all inside the
    // shoulders group, so per-set group credit is 1.0 and 2 sets clear a
    // 2-set deficit.
    const [s] = buildDeficitSuggestions(
      [row({ muscle: 'shoulders', displayName: 'Shoulders', projectedSets: 10, mev: 12 })],
      [block({ blockId: 'press', exerciseName: 'Arnold Press', primaryMuscle: 'shoulders' })]
    );
    expect(s.action).toEqual({
      kind: 'add_sets',
      blockId: 'press',
      exerciseName: 'Arnold Press',
      addSets: 2,
    });
  });

  it('needs no float fudge when the deficit is exactly N credited sets', () => {
    const [s] = buildDeficitSuggestions([row({ projectedSets: 8, mev: 10 })], [block()]);
    expect((s.action as { addSets: number }).addSets).toBe(2);
  });

  it('rounds a fractional deficit up to whole sets', () => {
    const [s] = buildDeficitSuggestions([row({ projectedSets: 9.5, mev: 10 })], [block()]);
    expect(s.setsNeeded).toBe(1);
    expect((s.action as { addSets: number }).addSets).toBe(1);
  });

  it('prefers the direct block with the fewest target sets on equal credit', () => {
    const [s] = buildDeficitSuggestions(
      [row()],
      [
        block({ blockId: 'heavy', exerciseName: 'Barbell Curl', targetSets: 5 }),
        block({ blockId: 'light', exerciseName: 'Cable Curl', targetSets: 3 }),
      ]
    );
    expect((s.action as { blockId: string }).blockId).toBe('light');
  });
});

describe('buildDeficitSuggestions — falling back to add-an-exercise', () => {
  it('falls back when today has no block for the muscle at all', () => {
    const [s] = buildDeficitSuggestions(
      [row({ muscle: 'back', displayName: 'Back', projectedSets: 6.5, mev: 10 })],
      [block()] // only a curl — no back work
    );
    expect(s.setsNeeded).toBe(4); // ceil(10 − 6.5)
    expect(s.action).toEqual({ kind: 'add_exercise' });
  });

  it('never routes a deficit through secondary (half-credit) work', () => {
    // A row credits biceps 0.5/set as a secondary; clearing a 1-set deficit
    // through it would take 2 half-credit sets on the wrong primary.
    const [s] = buildDeficitSuggestions(
      [row()],
      [
        block({
          blockId: 'rows',
          exerciseName: 'Barbell Row',
          primaryMuscle: 'back',
          secondaryMuscles: ['biceps'],
        }),
      ]
    );
    expect(s.action).toEqual({ kind: 'add_exercise' });
  });

  it(`falls back when the fix would exceed ${MAX_ADD_SETS_TO_BLOCK} extra sets on one block`, () => {
    const [s] = buildDeficitSuggestions([row({ projectedSets: 6, mev: 10 })], [block()]);
    expect(s.setsNeeded).toBe(4);
    expect(s.action).toEqual({ kind: 'add_exercise' });
  });

  it(`falls back when the block has no headroom under the ${MAX_TARGET_SETS}-set target cap`, () => {
    const [s] = buildDeficitSuggestions(
      [row({ projectedSets: 8, mev: 10 })],
      [block({ targetSets: 9 })] // 9 + 2 > 10
    );
    expect(s.action).toEqual({ kind: 'add_exercise' });
  });

  it('ignores blocks with no primary muscle', () => {
    const [s] = buildDeficitSuggestions([row()], [block({ primaryMuscle: null })]);
    expect(s.action).toEqual({ kind: 'add_exercise' });
  });
});
