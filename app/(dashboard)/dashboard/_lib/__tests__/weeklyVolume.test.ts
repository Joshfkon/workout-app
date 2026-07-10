import {
  computeWeeklyMevSummary,
  selectMusclesBelowMev,
  mevSummaryToVolumeData,
  ALL_MUSCLE_GROUPS,
  type MuscleVolumeStats,
} from '../weeklyVolume';

function stat(muscle: string, sets: number, target: number, status: 'low' | 'optimal' | 'high'): MuscleVolumeStats {
  return { muscle, sets, target, status, exercises: [] };
}

describe('computeWeeklyMevSummary', () => {
  it('returns null with no logged volume (callers show their own empty state)', () => {
    expect(computeWeeklyMevSummary([])).toBeNull();
  });

  it('produces one summary both the tile and the detail list can render', () => {
    const stats = [
      stat('lats', 12, 6, 'optimal'),
      stat('biceps', 2, 4, 'low'),
    ];

    const summary = computeWeeklyMevSummary(stats)!;

    // Tile numbers
    expect(summary.totalSets).toBe(14);
    const untrainedCount = ALL_MUSCLE_GROUPS.length - 2;
    expect(summary.lowCount).toBe(1 + untrainedCount);

    // Detail entries cover trained + untrained muscles, below-MEV first
    expect(summary.entries).toHaveLength(ALL_MUSCLE_GROUPS.length);
    const belowMevEntries = summary.entries.filter((e) => e.belowMev);
    // The tile's lowCount IS the detail list's flagged-count — same function.
    expect(belowMevEntries).toHaveLength(summary.lowCount);
    // Flagged muscles sort to the top
    const firstNotBelow = summary.entries.findIndex((e) => !e.belowMev);
    expect(summary.entries.slice(0, firstNotBelow).every((e) => e.belowMev)).toBe(true);
    expect(summary.entries.slice(firstNotBelow).every((e) => !e.belowMev)).toBe(true);
    // Untrained muscles appear at 0 sets with their MEV
    const untrainedEntry = summary.entries.find((e) => e.muscle === 'quads');
    expect(untrainedEntry).toMatchObject({ sets: 0, belowMev: true });
  });

  it('expands legacy muscle names so siblings are not double-counted as untrained', () => {
    // Legacy "shoulders" covers front/lateral/rear delts
    const stats = [stat('shoulders', 10, 8, 'optimal')];

    const summary = computeWeeklyMevSummary(stats)!;

    const untrained = summary.entries.filter((e) => e.sets === 0).map((e) => e.muscle);
    expect(untrained).not.toContain('front_delts');
    expect(untrained).not.toContain('lateral_delts');
    expect(untrained).not.toContain('rear_delts');
  });
});

describe('shared below-MEV selectors (single source for both progress cards)', () => {
  const stats = [
    stat('lats', 5, 6, 'low'), // trained but under MEV
    stat('quads', 12, 6, 'optimal'), // above MEV
  ];

  it('selectMusclesBelowMev returns exactly the summary lowCount, both trained-low and untrained', () => {
    const summary = computeWeeklyMevSummary(stats)!;
    const below = selectMusclesBelowMev(summary);

    // Same number the "This Week vs MEV" tile shows — never a different count.
    expect(below).toHaveLength(summary.lowCount);
    // The trained-but-low muscle is included...
    expect(below.some((e) => e.muscle === 'lats' && e.sets === 5 && e.mev === 6)).toBe(true);
    // ...and the above-MEV muscle is not.
    expect(below.some((e) => e.muscle === 'quads')).toBe(false);
    // ...and completely-untrained muscles (0 sets) are included by design.
    expect(below.some((e) => e.muscle === 'hamstrings' && e.sets === 0)).toBe(true);
  });

  it('selectMusclesBelowMev is null-safe (loading state)', () => {
    expect(selectMusclesBelowMev(null)).toEqual([]);
  });

  it('mevSummaryToVolumeData adapts the SAME list to the atrophy-alert shape', () => {
    const summary = computeWeeklyMevSummary(stats)!;
    const volumeData = mevSummaryToVolumeData(summary);

    // The warning card renders exactly the shared below-MEV muscles.
    expect(volumeData).toHaveLength(summary.lowCount);

    const lats = volumeData.find((d) => d.muscleGroup === 'lats')!;
    expect(lats).toBeDefined();
    expect(lats.totalSets).toBe(5);
    expect(lats.landmarks.mev).toBe(6); // MEV carried through, drives sets/mev + deficit sort
    expect(lats.status).toBe('below_mev');

    // Untrained muscle surfaces at 0 sets with its standard-taxonomy MEV.
    const hamstrings = volumeData.find((d) => d.muscleGroup === 'hamstrings')!;
    expect(hamstrings.totalSets).toBe(0);
    expect(hamstrings.landmarks.mev).toBe(4);
  });

  it('mevSummaryToVolumeData is null-safe (loading state)', () => {
    expect(mevSummaryToVolumeData(null)).toEqual([]);
  });
});
