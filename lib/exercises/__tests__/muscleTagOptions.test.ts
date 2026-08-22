/**
 * The tagging surfaces and the volume taxonomy have to agree.
 *
 * Volume rows for the subdivisions (Obliques, Glute Med, the trap and tricep
 * heads, gastroc/soleus) render whether or not anything has fed them — but only
 * a FINE tag can put sets on one, because a coarse token never leaks into its
 * subdivisions (resolveMuscleToStandard is standard-first). So a subdivision
 * that no picker can apply is a row permanently stuck at 0. That is exactly how
 * Obliques went invisible: it had a row, a band and artwork, and no way to tag
 * it outside the custom-exercise flow.
 */
import {
  ALL_MUSCLE_TAG_OPTIONS,
  MUSCLE_FILTER_OPTIONS,
  PRECISE_MUSCLE_GROUP_OPTIONS,
  GROUPED_MUSCLE_OPTIONS,
} from '../types';
import { FINE_CHILD_MUSCLES, COARSE_MUSCLES } from '@/services/volumeBands';
import { resolveMuscleToStandard, MUSCLE_GROUPS } from '@/types/schema';

const values = (options: { value: string }[]) => new Set(options.map((o) => o.value));

describe('every muscle a volume row can show is taggable', () => {
  it('ALL_MUSCLE_TAG_OPTIONS covers every fine child (the row-stuck-at-0 guard)', () => {
    const taggable = values(ALL_MUSCLE_TAG_OPTIONS);
    for (const fine of Array.from(FINE_CHILD_MUSCLES)) {
      expect(taggable.has(fine)).toBe(true);
    }
    expect(taggable.has('obliques')).toBe(true);
  });

  it('the filter chips cover them too, so oblique work is findable', () => {
    const filterable = values(MUSCLE_FILTER_OPTIONS);
    for (const fine of Array.from(FINE_CHILD_MUSCLES)) {
      expect(filterable.has(fine)).toBe(true);
    }
  });

  it('keeps every coarse group selectable as well', () => {
    const taggable = values(ALL_MUSCLE_TAG_OPTIONS);
    for (const coarse of MUSCLE_GROUPS) {
      expect(taggable.has(coarse)).toBe(true);
    }
    // One entry per group, plus one per subdivision — no duplicates.
    expect(ALL_MUSCLE_TAG_OPTIONS).toHaveLength(values(ALL_MUSCLE_TAG_OPTIONS).size);
    expect(ALL_MUSCLE_TAG_OPTIONS).toHaveLength(
      GROUPED_MUSCLE_OPTIONS.length +
        GROUPED_MUSCLE_OPTIONS.reduce((n, g) => n + g.subMuscles.length, 0)
    );
  });

  it('every offered token resolves to at least one standard muscle', () => {
    // An option that resolves to nothing would silently drop the user's tag.
    for (const option of ALL_MUSCLE_TAG_OPTIONS) {
      expect(resolveMuscleToStandard(option.value).length).toBeGreaterThan(0);
    }
  });

  it('the primary picker stays a subset — it drops splitting coarse groups only', () => {
    const precise = values(PRECISE_MUSCLE_GROUP_OPTIONS);
    const taggable = values(ALL_MUSCLE_TAG_OPTIONS);
    for (const value of Array.from(precise)) expect(taggable.has(value)).toBe(true);
    // Obliques is a legitimate primary (Russian Twist, Pallof Press, Side Plank).
    expect(precise.has('obliques')).toBe(true);
    // The splitting groups are the ones validateExercisePrimary rejects.
    for (const splitting of ['chest', 'back', 'shoulders']) {
      expect(precise.has(splitting)).toBe(false);
    }
  });

  it('labels a subdivision by its group so two lists never collide', () => {
    const obliques = ALL_MUSCLE_TAG_OPTIONS.find((o) => o.value === 'obliques')!;
    expect(obliques.label).toBe('Abs · Obliques');
    expect(MUSCLE_FILTER_OPTIONS.find((o) => o.value === 'obliques')!.label).toBe('Obliques');
    // Group labels stay distinct from their subdivisions' in both lists.
    expect(new Set(MUSCLE_FILTER_OPTIONS.map((o) => o.label)).size).toBe(
      MUSCLE_FILTER_OPTIONS.length
    );
  });

  it('offers a group for every coarse volume row except the legacy naming split', () => {
    // COARSE_MUSCLES and the legacy MUSCLE_GROUPS vocabulary describe the same
    // 14 groups; the tag options are built off the latter.
    expect(GROUPED_MUSCLE_OPTIONS).toHaveLength(COARSE_MUSCLES.length);
  });
});
