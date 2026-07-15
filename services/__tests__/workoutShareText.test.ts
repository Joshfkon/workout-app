import {
  formatWorkoutShareText,
  squareForSet,
  muscleEmoji,
  shareLineWidth,
  type ShareExercise,
  type ShareSet,
  type WorkoutShareTextInput,
} from '../workoutShareText';

// ============================================================
// Fixtures
// ============================================================

// Default set is on target: rpe 8 → 2 RIR → 🟩. Override rpe to shift color
// (rpe 10 → 0 RIR → 🟪; rpe ≤ 7 → 3+ RIR → 🟨).
function createSet(overrides: Partial<ShareSet> = {}): ShareSet {
  return {
    reps: 10,
    weightKg: 100,
    rpe: 8,
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
            // Taken to failure (0 RIR) → 🟪.
            createSet({ rpe: 10 }),
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
        '🟩🟩🟩🟪  Incline Press 🏆',
        '🟩🟩🟩⬜  Lateral Raise',
        '',
        '7 sets · 4,450 kg · 58 min · 🏆 1 PR',
        '🟪 maxed out · 🟩 on target',
        '🟨 easy (reps left)',
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
  // Set → square: an RIR effort heatmap
  // ============================================================

  it('renders an on-target set (2 RIR) as 🟩', () => {
    const input = createInput({
      exercises: [createExercise({ targetSets: 1, sets: [createSet({ rpe: 8 })] })],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩  Bench Press');
  });

  it('renders a to-failure set (0 RIR) as 🟪', () => {
    const input = createInput({
      exercises: [
        createExercise({ targetSets: 1, sets: [createSet({ rpe: 10 })] }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟪  Bench Press');
  });

  it('renders an easy set (3+ RIR) as 🟨', () => {
    const input = createInput({
      exercises: [
        createExercise({ targetSets: 1, sets: [createSet({ rpe: 7 })] }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟨  Bench Press');
  });

  it('colors by RIR alone — reps under any target range do not change the square', () => {
    const input = createInput({
      exercises: [
        // Only 6 reps, but at 2 RIR (rpe 8) it is still on target → 🟩.
        createExercise({ targetSets: 1, sets: [createSet({ reps: 6, rpe: 8 })] }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩  Bench Press');
  });

  it('maps a mixed run of efforts left to right', () => {
    const input = createInput({
      exercises: [
        createExercise({
          targetSets: 4,
          sets: [
            createSet({ rpe: 8 }), // 2 RIR → 🟩
            createSet({ rpe: 9 }), // 1 RIR → 🟩
            createSet({ rpe: 10 }), // 0 RIR → 🟪
            createSet({ rpe: 7 }), // 3 RIR → 🟨
          ],
        }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩🟩🟪🟨  Bench Press');
  });

  it('pads unperformed planned sets with ⬜', () => {
    const input = createInput({
      exercises: [createExercise({ targetSets: 5, sets: [createSet(), createSet()] })],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩🟩⬜⬜⬜  Bench Press');
  });

  it('omits skipped exercises from the share entirely', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: [
          createExercise({ name: 'Squat', targetSets: 2, sets: [createSet(), createSet()] }),
          createExercise({ name: 'Nordic Curl', targetSets: 5, skipped: true, sets: [] }),
          // No performed sets counts as skipped even without the flag.
          createExercise({ name: 'Leg Curl', targetSets: 2, sets: [] }),
        ],
      })
    );
    expect(text).toContain('🟩🟩  Squat');
    expect(text).not.toContain('Nordic Curl');
    expect(text).not.toContain('Leg Curl');
    expect(text).not.toContain('⬛');
  });

  it('keeps the layout tight when every exercise was skipped', () => {
    const text = formatWorkoutShareText(
      createInput({
        durationSeconds: 600,
        exercises: [
          createExercise({ name: 'Nordic Curl', skipped: true, sets: [] }),
          createExercise({ name: 'Leg Curl', sets: [] }),
        ],
      })
    );
    expect(text).toBe(['HyperTrack 💪 Push', '', '0 sets · 0 kg · 10 min'].join('\n'));
  });

  it('renders AMRAP sets in their RIR color plus ⚡', () => {
    const input = createInput({
      exercises: [
        createExercise({
          sets: [
            createSet(),
            createSet(),
            // Taken to failure (0 RIR) → 🟪, plus the AMRAP ⚡.
            createSet({ isAmrap: true, reps: 14, rpe: 10 }),
          ],
        }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩🟩🟪⚡  Bench Press');
  });

  it('colors an AMRAP by its RIR like any set — a stopped-short AMRAP stays 🟩', () => {
    const input = createInput({
      exercises: [
        createExercise({
          targetSets: 1,
          // 2 RIR AMRAP (rpe 8) → on target → 🟩⚡.
          sets: [createSet({ isAmrap: true, reps: 14, rpe: 8 })],
        }),
      ],
    });
    expect(formatWorkoutShareText(input)).toContain('🟩⚡  Bench Press');
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
            createSet({ weightKg: 60, reps: 10, isDropset: true }),
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
  // Legend (item 3)
  // ============================================================

  const LEGEND_LINE_1 = '🟪 maxed out · 🟩 on target';
  const LEGEND_LINE_2 = '🟨 easy (reps left)';

  it('appends the legend only when a non-green square exists', () => {
    const allGreen = formatWorkoutShareText(createInput());
    expect(allGreen).not.toContain('🟨');
    expect(allGreen).not.toContain('🟪');
    expect(allGreen).not.toContain('maxed out');

    // A single easy set (3 RIR) → 🟨 → the legend appears.
    const withYellow = formatWorkoutShareText(
      createInput({
        exercises: [createExercise({ targetSets: 1, sets: [createSet({ rpe: 7 })] })],
      })
    );
    expect(withYellow.trimEnd().endsWith(`${LEGEND_LINE_1}\n${LEGEND_LINE_2}`)).toBe(true);

    // A to-failure set (0 RIR) → 🟪 → the legend appears too.
    const withPurple = formatWorkoutShareText(
      createInput({
        exercises: [createExercise({ targetSets: 1, sets: [createSet({ rpe: 10 })] })],
      })
    );
    expect(withPurple.trimEnd().endsWith(`${LEGEND_LINE_1}\n${LEGEND_LINE_2}`)).toBe(true);
  });

  it('shows the legend exactly once, as the final two lines', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: [
          createExercise({ name: 'A', targetSets: 1, sets: [createSet({ rpe: 7 })] }),
          createExercise({ name: 'B', targetSets: 1, sets: [createSet({ rpe: 10 })] }),
        ],
      })
    );
    const lines = text.split('\n');
    expect(lines[lines.length - 2]).toBe(LEGEND_LINE_1);
    expect(lines[lines.length - 1]).toBe(LEGEND_LINE_2);
    expect(lines.filter((l) => l === LEGEND_LINE_1)).toHaveLength(1);
    expect(lines.filter((l) => l === LEGEND_LINE_2)).toHaveLength(1);
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
    expect(text).not.toContain('🏆');
    expect(text).not.toContain('PR');
  });

  it('never uses the retired 🔥 flame anywhere', () => {
    const text = formatWorkoutShareText(
      createInput({
        streakWeeks: 12,
        exercises: [createExercise({ hasPR: true })],
      })
    );
    expect(text).not.toContain('🔥');
  });

  it('counts multiple PRs in the footer with the trophy marker', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: [
          createExercise({ name: 'A', hasPR: true }),
          createExercise({ name: 'B', hasPR: true }),
          createExercise({ name: 'C' }),
        ],
      })
    );
    expect(text).toContain('🏆 2 PRs');
    expect(text).toContain('A 🏆');
    expect(text).toContain('B 🏆');
    expect(text).not.toContain('C 🏆');
  });

  it('uses singular forms for one set and one PR', () => {
    const text = formatWorkoutShareText(
      createInput({
        exercises: [createExercise({ targetSets: 1, sets: [createSet()], hasPR: true })],
      })
    );
    expect(text).toContain('1 set ·');
    expect(text).toContain('🏆 1 PR');
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
            createSet({ weightKg: 200, reps: 20, rpe: 9, isAmrap: true })
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

  it('replaces names with muscle emoji in cryptic mode and keeps PR trophies', () => {
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
    expect(text).toContain('🟩🟩🟩  🏋️ 🏆');
    expect(text).toContain('🟩🟩🟩  🦵');
    expect(text).toContain('🟩🟩🟩  💪');
  });
});

// ============================================================
// squareForSet — the RIR effort heatmap
// ============================================================

describe('squareForSet', () => {
  it('colors a to-failure set (0 RIR) 🟪', () => {
    expect(squareForSet({ reps: 10, weightKg: 100, rpe: 10 })).toBe('🟪');
  });

  it('colors 1–2 RIR (on target) 🟩', () => {
    expect(squareForSet({ reps: 10, weightKg: 100, rpe: 9 })).toBe('🟩'); // 1 RIR
    expect(squareForSet({ reps: 10, weightKg: 100, rpe: 8 })).toBe('🟩'); // 2 RIR
  });

  it('colors 3+ RIR (reps left in the tank) 🟨', () => {
    expect(squareForSet({ reps: 10, weightKg: 100, rpe: 7 })).toBe('🟨'); // 3 RIR
    expect(squareForSet({ reps: 10, weightKg: 100, rpe: 5 })).toBe('🟨'); // 5 RIR
  });

  it('ignores reps entirely — color follows RIR alone', () => {
    // Way under any sane rep range, but at 2 RIR it is still on target.
    expect(squareForSet({ reps: 3, weightKg: 100, rpe: 8 })).toBe('🟩');
  });

  it('colors an AMRAP by its RIR like any set', () => {
    expect(squareForSet({ reps: 12, weightKg: 100, rpe: 10, isAmrap: true })).toBe('🟪');
    expect(squareForSet({ reps: 12, weightKg: 100, rpe: 8, isAmrap: true })).toBe('🟩');
  });
});

// ============================================================
// shareLineWidth — the share v2 line-width rule (item 4)
// ============================================================

describe('shareLineWidth', () => {
  it('scores emoji squares/pictographs at 2 units and latin at 1', () => {
    expect(shareLineWidth('🟩🟩🟩')).toBe(6);
    expect(shareLineWidth('Incline Press')).toBe(13);
    // 🟩🟩(4) + "  Bench Press"(13) + " "(1) + 🏆(2) = 20
    expect(shareLineWidth('🟩🟩  Bench Press 🏆')).toBe(20);
    expect(shareLineWidth('🟪 maxed out · 🟩 on target')).toBe(27);
  });
});

describe('line-width guardrail (wrap check)', () => {
  // Emoji squares wrap badly in an iMessage bubble once a grid gets wide, so the
  // grid must fit one line. Short-name shares fit the whole bubble budget; the
  // plain-text footer is exempt (it wraps cleanly at a " · " separator).
  const GRID_WIDTH_CAP = 24;
  const LINE_WIDTH_CAP = 40;

  const fixtures: WorkoutShareTextInput[] = [
    createInput({
      title: 'Shoulders & Arms',
      subtitle: 'Arnold · Wk 1 · Day 2',
      exercises: [
        createExercise({
          name: 'Incline Press',
          targetSets: 4,
          hasPR: true,
          sets: [createSet(), createSet(), createSet(), createSet({ rpe: 10 })],
        }),
        createExercise({ name: 'Lateral Raise', targetSets: 4 }),
        createExercise({ name: 'Nordic Curl', targetSets: 4, skipped: true, sets: [] }),
      ],
    }),
    createInput({
      title: 'Pull',
      subtitle: 'Jul 8',
      streakWeeks: 12,
      exercises: [
        createExercise({ name: 'Deadlift', hasPR: true }),
        createExercise({ name: 'Barbell Row' }),
      ],
    }),
  ];

  const SQUARE_GLYPHS = ['🟪', '🟩', '🟨', '⬜'];

  it('keeps every emoji square grid inside one bubble line', () => {
    for (const fixture of fixtures) {
      for (const line of formatWorkoutShareText(fixture).split('\n')) {
        if (!SQUARE_GLYPHS.some((s) => line.startsWith(s))) continue;
        // Real grid rows are "<squares>  <name>" (double-space separator). The
        // legend also opens with a square but uses single spaces and breaks
        // cleanly at " · ", so it's exempt from the grid cap (covered by the
        // LINE_WIDTH_CAP check below instead).
        if (!line.includes('  ')) continue;
        const grid = line.split('  ')[0];
        expect(shareLineWidth(grid)).toBeLessThanOrEqual(GRID_WIDTH_CAP);
      }
    }
  });

  it('keeps every emoji-bearing line within the bubble for short-name shares', () => {
    // The footer (starts with the set count) is plain text that reflows at a
    // " · " separator, so it's exempt; every emoji grid / header / legend line
    // must fit so it never wraps mid-glyph.
    for (const fixture of fixtures) {
      for (const line of formatWorkoutShareText(fixture).split('\n')) {
        if (/^\d/.test(line)) continue; // footer
        expect(shareLineWidth(line)).toBeLessThanOrEqual(LINE_WIDTH_CAP);
      }
    }
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
