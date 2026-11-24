import {
  SPLIT_CHOICES,
  oncePerWeekPriorities,
  splitLabel,
  splitMinDays,
  twiceWeeklySplitFor,
} from '../builderDefaults';
import { splitRotationLength } from '@/services/sessionBuilderWithFatigue';
import type { VolumeAdjustmentInput } from '@/services/mesocycleBuilder';

describe('split choices', () => {
  it('offers the five splits, each needing its rotation’s sessions', () => {
    expect(SPLIT_CHOICES.map((c) => c.split)).toEqual(['Full Body', 'Upper/Lower', 'PPL', 'Arnold', 'Bro Split']);
    for (const c of SPLIT_CHOICES) {
      expect(c.minDays).toBeGreaterThanOrEqual(splitRotationLength(c.split));
      expect(splitMinDays(c.split)).toBe(c.minDays);
    }
    expect(splitLabel('PPL')).toBe('Push / Pull / Legs');
  });

  it('suggests a twice-a-week split that fits the week', () => {
    expect(twiceWeeklySplitFor(3)).toBe('Full Body');
    expect(twiceWeeklySplitFor(5)).toBe('Upper/Lower');
    expect(twiceWeeklySplitFor(6)).toBe('PPL');
  });
});

describe('oncePerWeekPriorities', () => {
  const adjustments: VolumeAdjustmentInput[] = [
    { muscleGroup: 'hamstrings', volumeMultiplier: 1.2, reason: 'user_priority' },
    { muscleGroup: 'shoulders', head: 'lateral_delts', volumeMultiplier: 1.2, reason: 'user_priority' },
    { muscleGroup: 'calves', volumeMultiplier: 0.8, reason: 'dominant' },
  ];

  it('names the high priorities trained in one session a week', () => {
    const out = oncePerWeekPriorities(adjustments, {
      hamstrings: { frequency: 1 },
      shoulders: { frequency: 1 },
      calves: { frequency: 1 },
    });
    expect(out.map((o) => o.label)).toEqual(['Hamstrings', 'Side Delts']);
  });

  it('says nothing when the split trains them twice', () => {
    expect(oncePerWeekPriorities(adjustments, { hamstrings: { frequency: 2 }, shoulders: { frequency: 2 } })).toEqual([]);
    expect(oncePerWeekPriorities(adjustments, null)).toEqual([]);
  });
});
