import {
  formatWorkoutShareText,
  muscleEmoji,
  type ShareExercise,
  type ShareSet,
  type WorkoutShareTextInput,
} from '../workoutShareText';

// ============================================================
// Fixtures
// ============================================================

function createSet(overrides: Partial<ShareSet> = {}): ShareSet {
  return {
    quality: 'stimulative',
    reps: 10,
    weightKg: 100,
    ...overrides,
  };
}

function createExercise(overrides: Partial<ShareExercise> = {}): ShareExercise {
  return {
    name: 'Bench Press',
    primaryMuscle: 'chest',
    targetSets: 3,
    sets: [createSet(), createSet(), createSet()],
    ...overrides,
  };
}

function createInput(overrides: Partial<WorkoutShareTextInput> = {}): WorkoutShareTextInput {
  return {
    title: 'Push',
    exercises: [createExercise()],
    durationSeconds: 3600,
    unit: 'kg',
    ...overrides,
  };
}

// ============================================================
// Full-format tests (lock the exact encoding)
// ============================================================

describe('formatWorkoutShareText', () => {
  it('renders the full spec example shape exactly', () => {
    const input = createInput({
      title: 'Shoulders & Arms',
      subtitle: 'Arnold · Wk 1 · Day 2',
      durationSeconds: 58 * 60,
      unit: 'kg',
      exercises: [
        createExercise({
          name: 'Incline Press',
          targetSets: 4,
          hasPR: true,
          sets: [
            createSet(),
            createSet(),
            createSet(),
            createSet({ quality: 'effective' }),
          ],
        }),
        createExercise({
          name: 'Lateral Raise',
          targetSets: 4,
          sets: [
            createSet({ weightKg: 10, reps: 15 }),
            createSet({ weightKg: 10, reps: 15 }),
            createSet({ weightKg: 10, reps: 15 }),
          ],
        }),
        createExercise({ name: 'Nordic Curl', targetSets: 4, skipped: true, sets: [] }),
      ],
    });

    expect(formatWorkoutShareText(input)).toBe(
      [
        'HyperTrack 💪 Shoulders & Arms',
        'Arnold · Wk 1 · Day 2',
        '',
        '🟩🟩🟩🟨  Incline Press 🔥',
        '🟩🟩🟩⬜  Lateral Raise',
        '⬛⬛⬛  Nordic Curl',
        '',
        '7 sets · 4,450 kg · 58 min · 🔥1 PR',
      ].join('\n')
    );
  });

  it('matches snapshot for a full session with multiple PRs', () => {
    const input = createInput({
      title: 'Pull',
      subtitle: 'Jul 8',
      durationSeconds: 72 * 60,
      exercises: [
        createExercise({ name: 'Deadlift', primaryMuscle: 'back', hasPR: true }),
        createExercise({ name: 'Barbell Row', primaryMuscle: 'back' }),
        createExercise({ name: 'Lat Pulldown', primaryMuscle: 'lats', hasPR: true }),
        createExercise({ name: 'Curl (EZ bar)', primaryMuscle: 'biceps' }),
      ],
    });
    expect(formatWorkoutShareText(input)).toMatchSnapshot();
  });

  it('matches snapshot for a session with partial and full skips', () => {
    const input = createInput({
      exercises: [
        createExercise({ name: 'Squat', targetSets: 5, sets: [createSet(), createSet()] }),
        createExercise({ name: 'Leg Press', targetSets: 3, skipped: true, sets: [] }),
        createExercise({ name: 'Leg Curl', targetSets: 2, sets: [] }),
      ],
    });
    expect(formatWorkoutShareText(input)).toMatchSnapshot();
  });

  it('matches snapshot in cryptic mode', () => {
    const input = createInput({
      cryptic: true,
      exercises: [
        createExercise({ name: 'Bench Press', primaryMuscle: 'chest', hasPR: true }),
        createExercise({ name: 'Squat', primaryMuscle: 'quads' }),
        createExercise({ name: 'Curl', primaryMuscle: 'biceps' }),
      ],
    });
    expect(formatWorkoutShareText(input)).toMatchSnapshot();
  });

  // ============================================================
  // Set-classification → emoji mapping
  // ============================================================

  it('maps every set quality to its square', () => {
    const input = createInput({
      exercises: [
        createExercise({
          targetSets: 4,
          sets: [
            createSet({ quality: 'stimulative' }),
            createSet({ quality: 'effective' }),
            createSet({ quality: 'junk' }),
            createSet({ quality: 'excessive' }),
          ],
        }),
      ],
    });
    // stimulative→🟩, effective→🟨, junk→🟥, excessive (RPE 10 grind)→🟨
    expect(formatWorkoutShareText(input)).toContain('🟩🟨🟥🟨  Bench Press');
  });

  it('pads unperformed planned sets with ⬜', () => {
    const input = createInput({
      exercises: [createExercise({ targetSets: 5, sets: [createSet(), createSet()] })],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩🟩⬜⬜⬜  Bench Press');
  });

  it('renders a skipped exercise as at most 3 ⬛ squares', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: [
          createExercise({ name: 'Nordic Curl', targetSets: 5, skipped: true, sets: [] }),
          createExercise({ name: 'Leg Curl', targetSets: 2, skipped: true, sets: [] }),
        ],
      })
    );
    expect(text).toContain('⬛⬛⬛  Nordic Curl');
    expect(text).toContain('⬛⬛  Leg Curl');
  });

  it('renders AMRAP sets as their earned color plus ⚡', () => {
    const input = createInput({
      exercises: [
        createExercise({
          sets: [createSet(), createSet(), createSet({ isAmrap: true, quality: 'effective' })],
        }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩🟩🟨⚡  Bench Press');
  });

  it('gives dropset children no square but counts their volume and set count', () => {
    const input = createInput({
      unit: 'kg',
      durationSeconds: 600,
      exercises: [
        createExercise({
          targetSets: 2,
          sets: [
            createSet({ weightKg: 100, reps: 10 }),
            createSet({ weightKg: 100, reps: 10 }),
            createSet({ weightKg: 60, reps: 10, isDropset: true, quality: 'effective' }),
          ],
        }),
      ],
    });
    const text = formatWorkoutShareText(input);
    // Two squares only — the dropset merges into its parent's planned set.
    expect(text).toContain('🟩🟩  Bench Press');
    expect(text).not.toContain('⬜');
    // Footer still counts all performed work: 3 sets, 2,600 kg.
    expect(text).toContain('3 sets · 2,600 kg · 10 min');
  });

  it('does not pad with ⬜ when more sets were performed than planned', () => {
    const input = createInput({
      exercises: [
        createExercise({ targetSets: 2, sets: [createSet(), createSet(), createSet()] }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩🟩🟩  Bench Press');
  });

  // ============================================================
  // Collapse rule (> 8 exercises)
  // ============================================================

  describe('with more than 8 exercises', () => {
    const manyExercises = Array.from({ length: 10 }, (_, i) =>
      createExercise({
        name: `Exercise ${i + 1}`,
        // Descending volume so the last 3 are the smallest.
        sets: [createSet({ weightKg: (10 - i) * 10 }), createSet({ weightKg: (10 - i) * 10 })],
        targetSets: 2,
      })
    );

    it('collapses the smallest-volume rows into a "+N more" line', () => {
      const text = formatWorkoutShareText(createInput({ exercises: manyExercises }));
      const lines = text.split('\n');
      const exerciseLines = lines.slice(2, -2); // strip header, blanks, footer

      expect(exerciseLines).toHaveLength(8);
      expect(exerciseLines[7]).toBe('+3 more · 🟩🟩🟩🟩🟩🟩');
      // Largest-volume exercises stay in performed order.
      expect(exerciseLines[0]).toContain('Exercise 1');
      expect(exerciseLines[6]).toContain('Exercise 7');
      expect(text).not.toContain('Exercise 8');
    });

    it('matches snapshot', () => {
      expect(formatWorkoutShareText(createInput({ exercises: manyExercises }))).toMatchSnapshot();
    });

    it('truncates a very long collapse squares run', () => {
      const text = formatWorkoutShareText(
        createInput({
          exercises: Array.from({ length: 12 }, (_, i) =>
            createExercise({
              name: `Exercise ${i + 1}`,
              targetSets: 4,
              sets: Array.from({ length: 4 }, () => createSet({ weightKg: (12 - i) * 10 })),
            })
          ),
        })
      );
      const collapseLine = text.split('\n').find((l) => l.startsWith('+'));
      expect(collapseLine).toBe(`+5 more · ${'🟩'.repeat(12)}…`);
    });
  });

  it('renders 8 exercises without collapsing', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: Array.from({ length: 8 }, (_, i) =>
          createExercise({ name: `Exercise ${i + 1}` })
        ),
      })
    );
    expect(text).not.toContain('more ·');
    expect(text).toContain('Exercise 8');
  });

  // ============================================================
  // Footer
  // ============================================================

  it('converts total volume to lb with thousands separators', () => {
    const input = createInput({
      unit: 'lb',
      durationSeconds: 58 * 60,
      exercises: [
        createExercise({ targetSets: 2, sets: [createSet(), createSet()] }), // 2000 kg
      ],
    });
    // 2000 kg × 2.20462 = 4409.24 → 4,409 lb
    expect(formatWorkoutShareText(input)).toContain('2 sets · 4,409 lb · 58 min');
  });

  it('omits the PR segment when there are no PRs', () => {
    const text = formatWorkoutShareText(createInput());
    expect(text).not.toContain('🔥');
    expect(text).not.toContain('PR');
  });

  it('counts multiple PRs in the footer', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: [
          createExercise({ name: 'A', hasPR: true }),
          createExercise({ name: 'B', hasPR: true }),
          createExercise({ name: 'C' }),
        ],
      })
    );
    expect(text).toContain('🔥2 PRs');
    expect(text).toContain('A 🔥');
    expect(text).toContain('B 🔥');
    expect(text).not.toContain('C 🔥');
  });

  it('uses singular forms for one set and one PR', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: [createExercise({ targetSets: 1, sets: [createSet()], hasPR: true })],
      })
    );
    expect(text).toContain('1 set ·');
    expect(text).toContain('🔥1 PR');
    expect(text).not.toContain('PRs');
  });

  it('appends the streak when provided and multi-week', () => {
    expect(formatWorkoutShareText(createInput({ streakWeeks: 12 }))).toContain('📅 12-wk streak');
    expect(formatWorkoutShareText(createInput({ streakWeeks: 1 }))).not.toContain('streak');
    expect(formatWorkoutShareText(createInput())).not.toContain('streak');
  });

  // ============================================================
  // Header + size limits
  // ============================================================

  it('omits the subtitle line when not provided', () => {
    const lines = formatWorkoutShareText(createInput()).split('\n');
    expect(lines[0]).toBe('HyperTrack 💪 Push');
    expect(lines[1]).toBe('');
  });

  it('stays under 1,000 characters for a worst-case session', () => {
    const input = createInput({
      unit: 'lb',
      subtitle: 'Hypertrophy Block · Wk 6 · Day 4',
      streakWeeks: 52,
      durationSeconds: 3 * 3600,
      exercises: Array.from({ length: 20 }, (_, i) =>
        createExercise({
          name: `Single-Arm Cable Lateral Raise Variation ${i + 1}`,
          targetSets: 8,
          hasPR: true,
          sets: Array.from({ length: 8 }, () =>
            createSet({ weightKg: 200, reps: 20, isAmrap: true })
          ),
        })
      ),
    });
    const text = formatWorkoutShareText(input);
    expect(text.length).toBeLessThan(1000);
    // And the cryptic variant too.
    expect(formatWorkoutShareText({ ...input, cryptic: true }).length).toBeLessThan(1000);
  });

  // ============================================================
  // Cryptic mode
  // ============================================================

  it('replaces names with muscle emoji in cryptic mode and keeps PR flames', () => {
    const text = formatWorkoutShareText(
      createInput({
        cryptic: true,
        exercises: [
          createExercise({ name: 'Bench Press', primaryMuscle: 'chest', hasPR: true }),
          createExercise({ name: 'Squat', primaryMuscle: 'quads' }),
          createExercise({ name: 'Hammer Curl', primaryMuscle: 'biceps' }),
        ],
      })
    );
    expect(text).not.toContain('Bench Press');
    expect(text).not.toContain('Squat');
    expect(text).not.toContain('Hammer Curl');
    expect(text).toContain('🟩🟩🟩  🏋️ 🔥');
    expect(text).toContain('🟩🟩🟩  🦵');
    expect(text).toContain('🟩🟩🟩  💪');
  });
});

// ============================================================
// muscleEmoji
// ============================================================

describe('muscleEmoji', () => {
  it('maps leg muscles to 🦵', () => {
    expect(muscleEmoji('quads')).toBe('🦵');
    expect(muscleEmoji('hamstrings')).toBe('🦵');
    expect(muscleEmoji('glutes')).toBe('🦵');
    expect(muscleEmoji('calves')).toBe('🦵');
  });

  it('maps arm muscles to 💪', () => {
    expect(muscleEmoji('biceps')).toBe('💪');
    expect(muscleEmoji('triceps')).toBe('💪');
    expect(muscleEmoji('forearms')).toBe('💪');
  });

  it('maps torso and unknown muscles to 🏋️', () => {
    expect(muscleEmoji('chest')).toBe('🏋️');
    expect(muscleEmoji('chest_upper')).toBe('🏋️');
    expect(muscleEmoji('back')).toBe('🏋️');
    expect(muscleEmoji('shoulders')).toBe('🏋️');
    expect(muscleEmoji(undefined)).toBe('🏋️');
  });
});
