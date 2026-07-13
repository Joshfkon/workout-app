import { exerciseHighlightData, SECONDARY_HIGHLIGHT_EMPHASIS } from '../adapters';

describe('exerciseHighlightData', () => {
  it('back extension: glutes full accent, hamstrings + erectors dimmed', () => {
    const data = exerciseHighlightData('glutes', ['hamstrings', 'erectors']);
    expect(data.glutes).toEqual({ value: 1 });
    expect(data.hamstrings).toEqual({ value: SECONDARY_HIGHLIGHT_EMPHASIS });
    expect(data.erectors).toEqual({ value: SECONDARY_HIGHLIGHT_EMPHASIS });
    expect(Object.keys(data)).toHaveLength(3);
  });

  it('resolves legacy and detailed tokens through the canonical resolver', () => {
    // Legacy coarse 'shoulders' fans out to all three delts; detailed
    // 'triceps_long' resolves to standard 'triceps'.
    const data = exerciseHighlightData('shoulders', ['triceps_long', 'Chest Upper']);
    expect(data.front_delts).toEqual({ value: 1 });
    expect(data.lateral_delts).toEqual({ value: 1 });
    expect(data.rear_delts).toEqual({ value: 1 });
    expect(data.triceps).toEqual({ value: SECONDARY_HIGHLIGHT_EMPHASIS });
    expect(data.chest_upper).toEqual({ value: SECONDARY_HIGHLIGHT_EMPHASIS });
  });

  it('primary wins when a muscle is tagged both primary and secondary', () => {
    const data = exerciseHighlightData('quads', ['quads', 'glutes']);
    expect(data.quads).toEqual({ value: 1 });
    expect(data.glutes).toEqual({ value: SECONDARY_HIGHLIGHT_EMPHASIS });
  });

  it('ignores unrecognized tokens and handles missing fields', () => {
    expect(exerciseHighlightData('not-a-muscle', undefined)).toEqual({});
    expect(exerciseHighlightData(null, ['also-nope'])).toEqual({});
  });
});
