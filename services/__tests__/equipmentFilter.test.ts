/**
 * Tests for Equipment Filter Service
 */
import {
  exerciseRequiresUnavailableEquipment,
  filterExercisesByEquipment,
  getUnavailableExercises,
} from '../equipmentFilter';

// Simple exercise type for testing
interface TestExercise {
  name: string;
  equipment?: string;
}

describe('equipmentFilter', () => {
  describe('exerciseRequiresUnavailableEquipment', () => {
    it('returns false when no equipment is unavailable', () => {
      const exercise: TestExercise = { name: 'Leg Press', equipment: 'machine' };
      expect(exerciseRequiresUnavailableEquipment(exercise, [])).toBe(false);
    });

    it('returns true when exercise name contains unavailable equipment keyword', () => {
      const exercise: TestExercise = { name: 'Barbell Bench Press', equipment: 'barbell' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['barbell'])).toBe(true);
    });

    it('returns true when exercise equipment field contains unavailable keyword', () => {
      const exercise: TestExercise = { name: 'Chest Press', equipment: 'dumbbell' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['dumbbells'])).toBe(true);
    });

    it('returns false when exercise uses available equipment', () => {
      const exercise: TestExercise = { name: 'Push Ups', equipment: 'bodyweight' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['barbell', 'leg_press'])).toBe(false);
    });

    it('handles machine equipment correctly', () => {
      const exercise: TestExercise = { name: 'Leg Extension', equipment: 'machine' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['leg_extension'])).toBe(true);
    });

    it('handles cable machine equipment', () => {
      const exercise: TestExercise = { name: 'Cable Fly', equipment: 'cable' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['cable_machine'])).toBe(true);
    });

    it('handles lat pulldown machine', () => {
      const exercise: TestExercise = { name: 'Lat Pulldown', equipment: 'cable' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['lat_pulldown'])).toBe(true);
    });

    it('handles smith machine', () => {
      const exercise: TestExercise = { name: 'Smith Machine Squat', equipment: 'smith machine' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['smith_machine'])).toBe(true);
    });

    it('handles pull-up bar variations', () => {
      const exercise: TestExercise = { name: 'Pull-ups', equipment: 'pull-up bar' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['pull_up_bar'])).toBe(true);
    });

    it('handles chin-up variations', () => {
      const exercise: TestExercise = { name: 'Chin-ups', equipment: 'chinup bar' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['pull_up_bar'])).toBe(true);
    });

    it('handles dip station', () => {
      const exercise: TestExercise = { name: 'Tricep Dips', equipment: 'dip bars' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['dip_station'])).toBe(true);
    });

    it('handles EZ curl bar', () => {
      const exercise: TestExercise = { name: 'EZ Bar Curl', equipment: 'ez bar' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['ez_bar'])).toBe(true);
    });

    it('handles kettlebells', () => {
      const exercise: TestExercise = { name: 'Kettlebell Swing', equipment: 'kettlebell' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['kettlebells'])).toBe(true);
    });

    it('handles resistance bands', () => {
      const exercise: TestExercise = { name: 'Band Pull Apart', equipment: 'resistance band' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['resistance_bands'])).toBe(true);
    });

    it('handles incline bench', () => {
      const exercise: TestExercise = { name: 'Incline Dumbbell Press', equipment: 'incline bench' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['incline_bench'])).toBe(true);
    });

    it('handles squat rack', () => {
      const exercise: TestExercise = { name: 'Barbell Back Squat', equipment: 'squat rack' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['squat_rack'])).toBe(true);
    });

    it('is case insensitive', () => {
      const exercise: TestExercise = { name: 'BARBELL Bench Press', equipment: 'BARBELL' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['barbell'])).toBe(true);
    });

    it('handles exercises without equipment field', () => {
      const exercise: TestExercise = { name: 'Bodyweight Squat' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['barbell'])).toBe(false);
    });

    it('handles trap bar / hex bar', () => {
      const exercise: TestExercise = { name: 'Hex Bar Deadlift', equipment: 'trap bar' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['trap_bar'])).toBe(true);
    });

    it('handles landmine exercises', () => {
      const exercise: TestExercise = { name: 'Landmine Press', equipment: 'landmine' };
      expect(exerciseRequiresUnavailableEquipment(exercise, ['landmine'])).toBe(true);
    });
  });

  describe('filterExercisesByEquipment', () => {
    const exercises: TestExercise[] = [
      { name: 'Barbell Squat', equipment: 'barbell' },
      { name: 'Leg Press', equipment: 'machine' },
      { name: 'Bodyweight Squat', equipment: 'bodyweight' },
      { name: 'Dumbbell Lunge', equipment: 'dumbbell' },
      { name: 'Goblet Squat', equipment: 'kettlebell' },
    ];

    it('returns all exercises when no equipment is unavailable', () => {
      const filtered = filterExercisesByEquipment(exercises, []);
      expect(filtered.length).toBe(exercises.length);
    });

    it('filters out exercises requiring unavailable equipment', () => {
      const filtered = filterExercisesByEquipment(exercises, ['barbell']);
      expect(filtered.length).toBe(4);
      expect(filtered.find(e => e.name === 'Barbell Squat')).toBeUndefined();
    });

    it('filters out multiple types of unavailable equipment', () => {
      const filtered = filterExercisesByEquipment(exercises, ['barbell', 'leg_press']);
      expect(filtered.length).toBe(3);
      expect(filtered.find(e => e.name === 'Barbell Squat')).toBeUndefined();
      expect(filtered.find(e => e.name === 'Leg Press')).toBeUndefined();
    });

    it('preserves exercises with available equipment', () => {
      const filtered = filterExercisesByEquipment(exercises, ['barbell']);
      expect(filtered.find(e => e.name === 'Bodyweight Squat')).toBeDefined();
      expect(filtered.find(e => e.name === 'Dumbbell Lunge')).toBeDefined();
    });

    it('returns empty array when all equipment is unavailable', () => {
      const filtered = filterExercisesByEquipment(exercises, [
        'barbell',
        'leg_press',
        'dumbbells',
        'kettlebells',
      ]);
      // Only bodyweight remains
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Bodyweight Squat');
    });
  });

  describe('getUnavailableExercises', () => {
    const exercises: TestExercise[] = [
      { name: 'Barbell Squat', equipment: 'barbell' },
      { name: 'Leg Press', equipment: 'machine' },
      { name: 'Bodyweight Squat', equipment: 'bodyweight' },
      { name: 'Cable Fly', equipment: 'cable' },
    ];

    it('returns empty array when no equipment is unavailable', () => {
      const unavailable = getUnavailableExercises(exercises, []);
      expect(unavailable.length).toBe(0);
    });

    it('returns exercises that require unavailable equipment', () => {
      const unavailable = getUnavailableExercises(exercises, ['barbell']);
      expect(unavailable.length).toBe(1);
      expect(unavailable[0].name).toBe('Barbell Squat');
    });

    it('returns multiple exercises requiring different unavailable equipment', () => {
      const unavailable = getUnavailableExercises(exercises, ['barbell', 'cable_machine']);
      expect(unavailable.length).toBe(2);
      expect(unavailable.map(e => e.name)).toContain('Barbell Squat');
      expect(unavailable.map(e => e.name)).toContain('Cable Fly');
    });

    it('is the inverse of filterExercisesByEquipment', () => {
      const unavailableIds = ['barbell', 'leg_press'];
      const available = filterExercisesByEquipment(exercises, unavailableIds);
      const unavailable = getUnavailableExercises(exercises, unavailableIds);

      expect(available.length + unavailable.length).toBe(exercises.length);

      // No overlap
      available.forEach(a => {
        expect(unavailable.find(u => u.name === a.name)).toBeUndefined();
      });
    });
  });
});

// ============================================================
// Fail-closed contract (see the module doc in equipmentFilter.ts)
// ============================================================

import {
  checkExerciseEquipment,
  enforceEquipmentInvariant,
  getUntaggedExercises,
  unavailableIdsFromLegacyAllowlist,
  KNOWN_EQUIPMENT_IDS,
} from '../equipmentFilter';

/** "Attic" repro inventory: all three benches + dumbbells, nothing else. */
const ATTIC_AVAILABLE = new Set(['flat_bench', 'incline_bench', 'decline_bench', 'dumbbells']);
const ATTIC_BLOCKLIST = KNOWN_EQUIPMENT_IDS.filter((id) => !ATTIC_AVAILABLE.has(id));

describe('fail-closed contract', () => {
  it('excludes untagged non-bodyweight exercises when a blocklist exists', () => {
    const check = checkExerciseEquipment({ name: 'Mystery Movement' }, ['barbell']);
    expect(check.available).toBe(false);
    expect(check.reason).toBe('missing_equipment_tags');
  });

  it('allows untagged exercises flagged is_bodyweight', () => {
    expect(
      checkExerciseEquipment({ name: 'Nordic-Free Leg Thing', isBodyweight: true }, ['barbell'])
        .available
    ).toBe(true);
  });

  it('excludes exercises whose tags name no known equipment', () => {
    const check = checkExerciseEquipment(
      { name: 'Weird Lift', equipment: ['antigravity treadmill'] },
      ['barbell']
    );
    expect(check.available).toBe(false);
    expect(check.reason).toBe('unknown_requirement');
  });

  it('does not filter at all when no blocklist is configured', () => {
    expect(checkExerciseEquipment({ name: 'Mystery Movement' }, []).available).toBe(true);
  });

  it('requires EVERY tag to be satisfiable (subset semantics)', () => {
    const exercise = { name: 'Incline Press', equipment: ['dumbbells', 'incline bench'] };
    expect(checkExerciseEquipment(exercise, ['incline_bench']).available).toBe(false);
    expect(checkExerciseEquipment(exercise, ['barbell']).available).toBe(true);
  });

  it("generic 'bench' tag is satisfied by any bench", () => {
    const exercise = { name: 'Some Press', equipment: ['dumbbells', 'bench'] };
    expect(checkExerciseEquipment(exercise, ['flat_bench']).available).toBe(true);
    expect(
      checkExerciseEquipment(exercise, ['flat_bench', 'incline_bench', 'decline_bench']).available
    ).toBe(false);
  });

  it("generic 'machine' tag is satisfied by any machine but fails with none", () => {
    const exercise = { name: 'Mystery Press', equipment: ['mts machine'] };
    expect(checkExerciseEquipment(exercise, ['leg_press']).available).toBe(true);
    expect(checkExerciseEquipment(exercise, ATTIC_BLOCKLIST).available).toBe(false);
  });
});

describe('Attic repro (benches + dumbbells only)', () => {
  it('excludes the three offending exercises from the live repro', () => {
    // Nordic Curl: tagged bodyweight in old data — the name implies a foot anchor.
    const nordic = checkExerciseEquipment(
      { name: 'Nordic Curl', equipment: ['bodyweight'], isBodyweight: true },
      ATTIC_BLOCKLIST
    );
    expect(nordic.available).toBe(false);

    // Plate-loaded machine work: needs plates (bundled with bars) + a machine.
    const seatedCalf = checkExerciseEquipment(
      { name: 'Seated Calf Raise (Plate Loaded)', equipment: [] },
      ATTIC_BLOCKLIST
    );
    expect(seatedCalf.available).toBe(false);

    // Barbell-tagged Jefferson Curl (live-DB style) is excluded; the seeded
    // dumbbell+bench version is honestly performable at the Attic.
    expect(
      checkExerciseEquipment({ name: 'Jefferson Curl', equipment: ['barbell'] }, ATTIC_BLOCKLIST)
        .available
    ).toBe(false);
    expect(
      checkExerciseEquipment(
        { name: 'Jefferson Curl', equipment: ['dumbbells', 'bench'] },
        ATTIC_BLOCKLIST
      ).available
    ).toBe(true);
  });

  it('keeps dumbbell/bodyweight alternatives available', () => {
    const alternatives = [
      { name: 'Dumbbell Romanian Deadlift', equipment: ['dumbbells'] },
      { name: 'Single Leg Calf Raise', equipment: [], isBodyweight: true },
      { name: 'Back Extension', equipment: ['bodyweight'] },
      { name: 'Dumbbell Bench Press', equipment: ['dumbbells', 'bench'] },
    ];
    for (const ex of alternatives) {
      expect(checkExerciseEquipment(ex, ATTIC_BLOCKLIST).available).toBe(true);
    }
  });

  it("tags the derived 'nordic anchor' requirement as satisfiable where an anchor exists", () => {
    const nordic = { name: 'Nordic Curl', equipment: ['nordic anchor'] };
    expect(checkExerciseEquipment(nordic, ATTIC_BLOCKLIST).available).toBe(false);
    // A gym missing only dumbbells still has racks/lat pulldowns to anchor under.
    expect(checkExerciseEquipment(nordic, ['dumbbells']).available).toBe(true);
  });

  it("derives 'weight plates' from bar ownership", () => {
    const plateRaise = { name: 'Plate Front Raise', equipment: ['weight plates'] };
    expect(checkExerciseEquipment(plateRaise, ATTIC_BLOCKLIST).available).toBe(false);
    expect(checkExerciseEquipment(plateRaise, ['dumbbells']).available).toBe(true);
  });
});

describe('getUntaggedExercises', () => {
  it('reports untagged and unknown-tagged exercises', () => {
    const report = getUntaggedExercises([
      { name: 'Fine Lift', equipment: ['barbell'] },
      { name: 'Fine Bodyweight', isBodyweight: true },
      { name: 'No Tags' },
      { name: 'Alien Tech', equipment: ['quantum flywheel'] },
    ]);
    expect(report.map((r) => r.exercise.name).sort()).toEqual(['Alien Tech', 'No Tags']);
    expect(report.find((r) => r.exercise.name === 'No Tags')?.reason).toBe(
      'missing_equipment_tags'
    );
    expect(report.find((r) => r.exercise.name === 'Alien Tech')?.reason).toBe(
      'unknown_requirement'
    );
  });
});

describe('enforceEquipmentInvariant', () => {
  const violating = { name: 'Barbell Squat', equipment: ['barbell'] };
  const fine = { name: 'Dumbbell Squat', equipment: ['dumbbells'] };

  it('throws in dev builds on a violation', () => {
    expect(() => enforceEquipmentInvariant([fine, violating], ['barbell'])).toThrow(
      /invariant violated/
    );
  });

  it('drops violations (and keeps the rest) in production builds', () => {
    const nodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const kept = enforceEquipmentInvariant([fine, violating], ['barbell']);
      expect(kept).toEqual([fine]);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      (process.env as Record<string, string>).NODE_ENV = nodeEnv as string;
      consoleError.mockRestore();
    }
  });

  it('keeps user-overridden items without throwing', () => {
    const kept = enforceEquipmentInvariant([fine, violating], ['barbell'], {
      isUserOverride: (item) => item.name === 'Barbell Squat',
    });
    expect(kept).toHaveLength(2);
  });

  it('is a no-op without a blocklist', () => {
    expect(enforceEquipmentInvariant([violating], [])).toHaveLength(1);
  });
});

describe('unavailableIdsFromLegacyAllowlist', () => {
  it('blocks the ids of equipment classes missing from the allowlist', () => {
    const blocked = unavailableIdsFromLegacyAllowlist(['dumbbell', 'bodyweight']);
    expect(blocked).toContain('barbell');
    expect(blocked).toContain('cable_machine');
    expect(blocked).toContain('leg_press');
    expect(blocked).not.toContain('dumbbells');
  });

  it('lets cable availability win over the machine group overlap', () => {
    const blocked = unavailableIdsFromLegacyAllowlist(['cable']);
    expect(blocked).not.toContain('cable_machine');
    expect(blocked).not.toContain('lat_pulldown');
    expect(blocked).toContain('leg_press');
  });
});
