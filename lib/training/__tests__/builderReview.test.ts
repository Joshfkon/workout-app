/**
 * The builder review's skimmable pieces (UX panel round 20): per-muscle
 * status against MEV/MRV, what each priority changed, and the once-a-week
 * note that now names the per-session limit option.
 */
import {
  onceWeeklyCeilingNote,
  priorityCeilingHint,
  priorityEffectLine,
  volumeStatus,
  VOLUME_STATUS_LABEL,
} from '@/lib/training/builderDefaults';
import type { PriorityEffect } from '@/types/schema';

describe('volumeStatus', () => {
  it('reads worst first: MEV, MRV, short of target, in range', () => {
    expect(volumeStatus(8, 12, 8, 20)).toBe('below_mev');
    expect(volumeStatus(22, 22, 8, 20)).toBe('over_mrv');
    expect(volumeStatus(11, 20, 8, 22)).toBe('short');
    expect(volumeStatus(18, 20, 8, 22)).toBe('in_range');
    expect(VOLUME_STATUS_LABEL.in_range).toBe('In range');
  });
});

describe('priorityEffectLine', () => {
  const effect = (over: Partial<PriorityEffect>): PriorityEffect => ({
    muscleGroup: 'hamstrings',
    direction: 'up',
    before: 12,
    after: 19,
    sessionsPerWeek: 2,
    ...over,
  });

  it('says the gain in sets per week, with the numbers', () => {
    expect(priorityEffectLine(effect({}))).toBe('Hamstrings +7 sets/week from priority (12 → 19)');
  });

  it('names a head, keeps half sets, and says a loss with a minus sign', () => {
    expect(priorityEffectLine(effect({ muscleGroup: 'shoulders', head: 'lateral_delts', before: 8, after: 18.5 }))).toBe(
      'Side Delts +11 sets/week from priority (8 → 18.5)'
    );
    expect(priorityEffectLine(effect({ muscleGroup: 'calves', direction: 'down', before: 12, after: 10 }))).toBe(
      'Calves −2 sets/week from priority (12 → 10)'
    );
  });

  it('says plainly when nothing changed', () => {
    expect(priorityEffectLine(effect({ before: 11, after: 11 }))).toBe('Hamstrings: no change from priority (11 sets/week)');
  });
});

describe('priorityCeilingHint', () => {
  const onceWeekly: PriorityEffect = { muscleGroup: 'chest', direction: 'up', before: 11, after: 11, sessionsPerWeek: 1 };

  it('explains a once-a-week priority the per-session limit swallowed, offering the raise to advanced lifters', () => {
    expect(priorityCeilingHint(onceWeekly, 12, true)).toMatch(/once a week.*about 12 hard sets.*Raise the per-session limit \(up to 16\)/);
    expect(priorityCeilingHint(onceWeekly, 12, false)).toMatch(/second day, or pick a split that trains it twice/);
    expect(priorityCeilingHint(onceWeekly, 16, true)).not.toMatch(/Raise/);
  });

  it('is silent when the priority worked or the muscle is trained twice', () => {
    expect(priorityCeilingHint({ ...onceWeekly, after: 15 }, 12, true)).toBeNull();
    expect(priorityCeilingHint({ ...onceWeekly, sessionsPerWeek: 2 }, 12, true)).toBeNull();
  });
});

describe('onceWeeklyCeilingNote with the per-session limit option', () => {
  const chest = [{ muscle: 'chest' as const, delivered: 11, wanted: 20 }];

  it('mentions the option, honestly, to an advanced lifter below 16', () => {
    const note = onceWeeklyCeilingNote(chest, 'Bro Split', 12, true)!;
    expect(note).toMatch(/raise the per-session limit \(up to 16 hard sets\)/);
    expect(note).toMatch(/diminishing returns past ~10–12/);
  });

  it('says the chosen limit, and no option once it is at 16 or not offered', () => {
    expect(onceWeeklyCeilingNote(chest, 'Bro Split', 16, true)).toMatch(/holds about 16 hard sets/);
    expect(onceWeeklyCeilingNote(chest, 'Bro Split', 16, true)).not.toMatch(/raise the per-session limit/);
    expect(onceWeeklyCeilingNote(chest, 'Bro Split')).not.toMatch(/raise the per-session limit/);
  });
});
