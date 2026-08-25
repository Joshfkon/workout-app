import {
  exerciseHighlightData,
  heatmapRowsToMapData,
  SECONDARY_HIGHLIGHT_EMPHASIS,
} from '../adapters';
import { getEffectiveBand } from '@/services/volumeBands';
import type { VolumeHeatmapRow } from '@/app/(dashboard)/dashboard/_lib/volumeHeatmap';

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
    // 'triceps_long' resolves to the fine standard member 'triceps_long'
    // (the Phase 4 head split — no longer collapsed into coarse 'triceps').
    const data = exerciseHighlightData('shoulders', ['triceps_long', 'Chest Upper']);
    expect(data.front_delts).toEqual({ value: 1 });
    expect(data.lateral_delts).toEqual({ value: 1 });
    expect(data.rear_delts).toEqual({ value: 1 });
    expect(data.triceps_long).toEqual({ value: SECONDARY_HIGHLIGHT_EMPHASIS });
    expect(data.triceps).toBeUndefined();
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

describe('heatmapRowsToMapData', () => {
  const row = (
    muscle: VolumeHeatmapRow['muscle'],
    avgWeeklySets: number,
    heat: VolumeHeatmapRow['heat']
  ): VolumeHeatmapRow => ({
    muscle,
    displayName: muscle,
    avgWeeklySets,
    totalSets: avgWeeklySets * 4,
    band: getEffectiveBand(muscle),
    heat,
  });

  it('paints every standard child of a coarse row with the row\'s heat bucket', () => {
    const data = heatmapRowsToMapData([
      row('shoulders', 14, 'low'),
      row('calves', 0, 'untrained'),
    ]);
    // Shoulders fan out to all three delt heads with one shared datum.
    expect(data.front_delts).toEqual({ value: 14, heat: 'low' });
    expect(data.lateral_delts).toEqual({ value: 14, heat: 'low' });
    expect(data.rear_delts).toEqual({ value: 14, heat: 'low' });
    // Regionless coarse 'calves' still lights its whole area via the fine
    // members that own the artwork paths.
    expect(data.gastrocnemius).toEqual({ value: 0, heat: 'untrained' });
    expect(data.soleus).toEqual({ value: 0, heat: 'untrained' });
    // No row for chest → no datum → the map's neutral base tone.
    expect(data.chest_upper).toBeUndefined();
  });
});
