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
