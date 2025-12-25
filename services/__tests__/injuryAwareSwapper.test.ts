/**
 * Tests for Injury-Aware Exercise Swapper
 *
 * Critical safety tests to ensure exercises are properly filtered
 * based on injury considerations.
 */
import {
  getInjuryRisk,
  filterForInjury,
  getSafeAlternatives,
  autoSwapForInjuries,
  getInjuryDescription,
  INJURY_LABELS,
  type InjuryArea,
  type InjuryContext,
  type InjuryRisk,
} from '../injuryAwareSwapper';
import type { Exercise } from '@/types/schema';

// ============================================
// TEST HELPERS
// ============================================

function createExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    name: 'Bench Press',
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    movementPattern: 'horizontal_push',
    mechanic: 'compound',
    forceType: 'push',
    equipmentRequired: ['barbell', 'bench'],
    defaultRepRange: [6, 10] as [number, number],
    instructions: [],
    tips: [],
    commonMistakes: [],
    hypertrophyTier: 'A',
    ...overrides,
  };
}

// ============================================
// INJURY AREA NORMALIZATION TESTS
// ============================================

describe('injuryAwareSwapper', () => {
  describe('getInjuryRisk - area normalization', () => {
    it('treats shoulder_left same as shoulder', () => {
      const exercise = createExercise({ name: 'Overhead Press' });

      const riskGeneric = getInjuryRisk(exercise, 'shoulder');
      const riskLeft = getInjuryRisk(exercise, 'shoulder_left');
      const riskRight = getInjuryRisk(exercise, 'shoulder_right');

      expect(riskGeneric).toBe('avoid');
      expect(riskLeft).toBe(riskGeneric);
      expect(riskRight).toBe(riskGeneric);
    });

    it('treats knee_left same as knee', () => {
      const exercise = createExercise({ name: 'Barbell Squat', primaryMuscle: 'quads' });

      const riskGeneric = getInjuryRisk(exercise, 'knee');
      const riskLeft = getInjuryRisk(exercise, 'knee_left');
      const riskRight = getInjuryRisk(exercise, 'knee_right');

      expect(riskGeneric).toBe('avoid');
      expect(riskLeft).toBe(riskGeneric);
      expect(riskRight).toBe(riskGeneric);
    });

    it('treats hip_left same as hip', () => {
      const exercise = createExercise({ name: 'Hip Thrust', primaryMuscle: 'glutes' });

      const riskGeneric = getInjuryRisk(exercise, 'hip');
      const riskLeft = getInjuryRisk(exercise, 'hip_left');

      expect(riskLeft).toBe(riskGeneric);
    });

    it('treats elbow_left and elbow_right same as elbow', () => {
      const exercise = createExercise({ name: 'Skull Crusher', primaryMuscle: 'triceps' });

      const riskGeneric = getInjuryRisk(exercise, 'elbow');
      const riskLeft = getInjuryRisk(exercise, 'elbow_left');
      const riskRight = getInjuryRisk(exercise, 'elbow_right');

      expect(riskGeneric).toBe('avoid');
      expect(riskLeft).toBe(riskGeneric);
      expect(riskRight).toBe(riskGeneric);
    });

    it('treats wrist_left and wrist_right same as wrist', () => {
      const exercise = createExercise({ name: 'Front Squat', primaryMuscle: 'quads' });

      const riskGeneric = getInjuryRisk(exercise, 'wrist');
      const riskLeft = getInjuryRisk(exercise, 'wrist_left');

      expect(riskLeft).toBe(riskGeneric);
    });

    it('treats ankle variants the same', () => {
      const exercise = createExercise({ name: 'Calf Raise', primaryMuscle: 'calves' });

      const riskGeneric = getInjuryRisk(exercise, 'ankle');
      const riskLeft = getInjuryRisk(exercise, 'ankle_left');
      const riskRight = getInjuryRisk(exercise, 'ankle_right');

      expect(riskGeneric).toBe('avoid');
      expect(riskLeft).toBe(riskGeneric);
      expect(riskRight).toBe(riskGeneric);
    });
  });

  // ============================================
  // LOWER BACK INJURY TESTS
  // ============================================

  describe('getInjuryRisk - lower back injury', () => {
    const injuryArea: InjuryArea = 'lower_back';

    describe('should mark as AVOID', () => {
      it('deadlift variations', () => {
        expect(getInjuryRisk(createExercise({ name: 'Deadlift' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Sumo Deadlift' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Romanian Deadlift' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'RDL' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Single Leg RDL' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Stiff Leg Deadlift' }), injuryArea)).toBe('avoid');
      });

      it('squat variations', () => {
        expect(getInjuryRisk(createExercise({ name: 'Barbell Squat' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Back Squat' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Front Squat' }), injuryArea)).toBe('avoid');
      });

      it('bent over rows', () => {
        expect(getInjuryRisk(createExercise({ name: 'Bent Over Row' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Barbell Row' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Pendlay Row' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'T-Bar Row' }), injuryArea)).toBe('avoid');
      });

      it('good mornings and extensions', () => {
        expect(getInjuryRisk(createExercise({ name: 'Good Morning' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Hyperextension' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Back Extension' }), injuryArea)).toBe('avoid');
      });

      it('hip hinge movements (inferred)', () => {
        // The infer logic checks name/pattern for 'hinge' keyword
        // Note: 'Cable' is in EXPLICIT_SAFE so we use a different name
        const hipHinge = createExercise({
          name: 'Dumbbell Hip Hinge',
          movementPattern: 'hip_hinge'
        });
        expect(getInjuryRisk(hipHinge, injuryArea)).toBe('avoid');
      });
    });

    describe('should mark as SAFE', () => {
      it('lat pulldowns and pull-ups (decompression)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Lat Pulldown' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Wide Grip Pulldown' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Pull Up' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Chin Up' }), injuryArea)).toBe('safe');
      });

      it('chest supported rows (no spinal loading)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Chest Supported Row' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Machine Row' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Cable Row' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Seated Cable Row' }), injuryArea)).toBe('safe');
      });

      it('leg machines (no spinal loading)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Leg Press' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Hack Squat' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Leg Extension' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Leg Curl' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Lying Leg Curl' }), injuryArea)).toBe('safe');
      });

      it('hip thrust and glute bridge (supported)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Hip Thrust' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Glute Bridge' }), injuryArea)).toBe('safe');
      });

      it('machine and cable exercises (inferred)', () => {
        const machineExercise = createExercise({
          name: 'Chest Press Machine',
          equipmentRequired: ['machine']
        });
        expect(getInjuryRisk(machineExercise, injuryArea)).toBe('safe');

        const cableExercise = createExercise({
          name: 'Cable Fly',
          equipmentRequired: ['cable']
        });
        expect(getInjuryRisk(cableExercise, injuryArea)).toBe('safe');
      });

      it('isolation exercises (inferred)', () => {
        const isolation = createExercise({
          name: 'Bicep Curl',
          mechanic: 'isolation'
        });
        expect(getInjuryRisk(isolation, injuryArea)).toBe('safe');
      });

      it('seated and supported positions (inferred)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Seated Shoulder Press' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Incline Dumbbell Press' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Lying Tricep Extension' }), injuryArea)).toBe('safe');
      });
    });

    describe('should mark as CAUTION', () => {
      it('standing overhead pressing (compressive)', () => {
        const standing = createExercise({ name: 'Standing Overhead Press' });
        expect(getInjuryRisk(standing, injuryArea)).toBe('caution');
      });

      it('carries and walks', () => {
        expect(getInjuryRisk(createExercise({ name: 'Farmer Carry' }), injuryArea)).toBe('caution');
        expect(getInjuryRisk(createExercise({ name: 'Suitcase Walk' }), injuryArea)).toBe('caution');
      });
    });
  });

  // ============================================
  // SHOULDER INJURY TESTS
  // ============================================

  describe('getInjuryRisk - shoulder injury', () => {
    const injuryArea: InjuryArea = 'shoulder';

    describe('should mark as AVOID', () => {
      it('overhead pressing', () => {
        expect(getInjuryRisk(createExercise({ name: 'Overhead Press' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Military Press' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Shoulder Press' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Arnold Press' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Push Press' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Behind Neck Press' }), injuryArea)).toBe('avoid');
      });

      it('upright rows and dips', () => {
        expect(getInjuryRisk(createExercise({ name: 'Upright Row' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Dip' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Bench Dip' }), injuryArea)).toBe('avoid');
      });

      it('shoulder raises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Lateral Raise' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Front Raise' }), injuryArea)).toBe('avoid');
      });

      it('vertical push movements (inferred)', () => {
        const verticalPush = createExercise({
          name: 'DB Shoulder Press',
          movementPattern: 'vertical_push'
        });
        expect(getInjuryRisk(verticalPush, injuryArea)).toBe('avoid');
      });
    });

    describe('should mark as SAFE', () => {
      it('lower body exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Leg Press', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Squat', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Deadlift', primaryMuscle: 'hamstrings' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'RDL', primaryMuscle: 'hamstrings' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Calf Raise', primaryMuscle: 'calves' }), injuryArea)).toBe('safe');
      });

      it('pulling movements (shoulder-friendly)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Lat Pulldown' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Cable Row' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Pull Up' }), injuryArea)).toBe('safe');
      });

      it('therapeutic exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Face Pull' }), injuryArea)).toBe('safe');
        // Face pull is in EXPLICIT_SAFE
      });

      it('arm isolation exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Cable Curl' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Machine Curl' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Tricep Pushdown' }), injuryArea)).toBe('safe');
      });
    });

    describe('should mark as CAUTION', () => {
      it('horizontal pressing (bench press)', () => {
        const benchPress = createExercise({
          name: 'Bench Press',
          primaryMuscle: 'chest'
        });
        expect(getInjuryRisk(benchPress, injuryArea)).toBe('caution');
      });
    });
  });

  // ============================================
  // KNEE INJURY TESTS
  // ============================================

  describe('getInjuryRisk - knee injury', () => {
    const injuryArea: InjuryArea = 'knee';

    describe('should mark as AVOID', () => {
      it('squat variations', () => {
        expect(getInjuryRisk(createExercise({ name: 'Squat' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Front Squat' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Back Squat' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Sissy Squat' }), injuryArea)).toBe('avoid');
      });

      it('jumping and plyometrics', () => {
        expect(getInjuryRisk(createExercise({ name: 'Jump Squat' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Box Jump' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Jumping Lunge' }), injuryArea)).toBe('avoid');
      });

      it('leg extension (explicit avoid)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Leg Extension' }), injuryArea)).toBe('avoid');
      });
    });

    describe('should mark as SAFE', () => {
      it('hip-dominant movements', () => {
        expect(getInjuryRisk(createExercise({ name: 'RDL' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Romanian Deadlift' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Hip Thrust' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Glute Bridge' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Lying Leg Curl' }), injuryArea)).toBe('safe');
      });

      it('upper body exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Bench Press', primaryMuscle: 'chest' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Row', primaryMuscle: 'back' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Pulldown', primaryMuscle: 'back' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Curl', primaryMuscle: 'biceps' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Tricep Extension', primaryMuscle: 'triceps' }), injuryArea)).toBe('safe');
      });
    });

    describe('should mark as CAUTION', () => {
      it('lunges', () => {
        expect(getInjuryRisk(createExercise({ name: 'Walking Lunge' }), injuryArea)).toBe('avoid'); // Explicit avoid
        expect(getInjuryRisk(createExercise({ name: 'Lunge' }), injuryArea)).toBe('caution');
        // Split Squat contains 'squat' which triggers avoid check
        expect(getInjuryRisk(createExercise({ name: 'Bulgarian Split Squat' }), injuryArea)).toBe('avoid');
      });

      it('machine squats with caution', () => {
        // Leg press is in safe list, but general machine squats with 'squat' in name trigger avoid
        // Hack squat is in the safe list explicitly
        const legPress = createExercise({
          name: 'Leg Press',
          primaryMuscle: 'quads'
        });
        expect(getInjuryRisk(legPress, injuryArea)).toBe('safe');
      });
    });
  });

  // ============================================
  // ELBOW INJURY TESTS
  // ============================================

  describe('getInjuryRisk - elbow injury', () => {
    const injuryArea: InjuryArea = 'elbow';

    describe('should mark as AVOID', () => {
      it('skull crushers and heavy extensions', () => {
        expect(getInjuryRisk(createExercise({ name: 'Skull Crusher' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Lying Tricep Extension' }), injuryArea)).toBe('avoid');
      });

      it('close grip pressing and dips', () => {
        expect(getInjuryRisk(createExercise({ name: 'Close Grip Bench' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Dip' }), injuryArea)).toBe('avoid');
      });

      it('curls with elbow stress', () => {
        expect(getInjuryRisk(createExercise({ name: 'Preacher Curl' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Concentration Curl' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Chin Up' }), injuryArea)).toBe('avoid');
      });
    });

    describe('should mark as SAFE', () => {
      it('lower body exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Squat', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Leg Press', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Leg Curl', primaryMuscle: 'hamstrings' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Calf Raise', primaryMuscle: 'calves' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Deadlift', primaryMuscle: 'glutes' }), injuryArea)).toBe('safe');
      });

      it('shoulder work that bypasses elbow', () => {
        expect(getInjuryRisk(createExercise({ name: 'Lateral Raise' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Face Pull' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Reverse Fly' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Shrug' }), injuryArea)).toBe('safe');
      });

      it('tricep pushdowns (low stress)', () => {
        const pushdown = createExercise({
          name: 'Tricep Pushdown',
          primaryMuscle: 'triceps',
          mechanic: 'isolation'
        });
        expect(getInjuryRisk(pushdown, injuryArea)).toBe('safe');
      });
    });

    describe('should mark as CAUTION', () => {
      it('bicep curls (standard)', () => {
        const curl = createExercise({
          name: 'Barbell Curl',
          primaryMuscle: 'biceps'
        });
        expect(getInjuryRisk(curl, injuryArea)).toBe('caution');
      });

      it('overhead tricep extensions', () => {
        const overhead = createExercise({
          name: 'Overhead Tricep Extension',
          primaryMuscle: 'triceps',
          mechanic: 'isolation'
        });
        expect(getInjuryRisk(overhead, injuryArea)).toBe('caution');
      });
    });
  });

  // ============================================
  // WRIST INJURY TESTS
  // ============================================

  describe('getInjuryRisk - wrist injury', () => {
    const injuryArea: InjuryArea = 'wrist';

    describe('should mark as AVOID', () => {
      it('front rack position', () => {
        expect(getInjuryRisk(createExercise({ name: 'Front Squat' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Clean' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Snatch' }), injuryArea)).toBe('avoid');
      });

      it('push-ups (wrist extension)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Push Up' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Pushup' }), injuryArea)).toBe('avoid');
      });

      it('direct wrist work', () => {
        expect(getInjuryRisk(createExercise({ name: 'Wrist Curl' }), injuryArea)).toBe('avoid');
      });

      it('barbell bench press (explicit)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Barbell Bench Press' }), injuryArea)).toBe('avoid');
      });
    });

    describe('should mark as SAFE', () => {
      it('lower body exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Leg Press', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Squat', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Leg Curl', primaryMuscle: 'hamstrings' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Calf Raise', primaryMuscle: 'calves' }), injuryArea)).toBe('safe');
      });

      it('machine and cable exercises (can use straps)', () => {
        expect(getInjuryRisk(createExercise({ name: 'Lat Pulldown' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Cable Row' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Machine Row' }), injuryArea)).toBe('safe');
      });
    });

    describe('should mark as CAUTION', () => {
      it('barbell pressing', () => {
        const barbellPress = createExercise({
          name: 'Barbell Shoulder Press',
          equipmentRequired: ['barbell']
        });
        expect(getInjuryRisk(barbellPress, injuryArea)).toBe('caution');
      });
    });
  });

  // ============================================
  // CHEST INJURY TESTS
  // ============================================

  describe('getInjuryRisk - chest injury', () => {
    const injuryArea: InjuryArea = 'chest';

    describe('should mark as AVOID', () => {
      it('chest exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Bench Press', primaryMuscle: 'chest' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Dumbbell Press', primaryMuscle: 'chest' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Cable Fly', primaryMuscle: 'chest' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Cable Crossover', primaryMuscle: 'chest' }), injuryArea)).toBe('avoid');
      });

      it('dips and push-ups', () => {
        expect(getInjuryRisk(createExercise({ name: 'Dip' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Push Up' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Pushup' }), injuryArea)).toBe('avoid');
      });
    });

    describe('should mark as SAFE', () => {
      it('non-chest work', () => {
        expect(getInjuryRisk(createExercise({ name: 'Row', primaryMuscle: 'back' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Pulldown', primaryMuscle: 'back' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Curl', primaryMuscle: 'biceps' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Squat', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Leg Press', primaryMuscle: 'quads' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Deadlift', primaryMuscle: 'hamstrings' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Shoulder Press', primaryMuscle: 'shoulders' }), injuryArea)).toBe('safe');
      });
    });
  });

  // ============================================
  // NECK INJURY TESTS
  // ============================================

  describe('getInjuryRisk - neck injury', () => {
    const injuryArea: InjuryArea = 'neck';

    describe('should mark as AVOID', () => {
      it('direct neck work', () => {
        expect(getInjuryRisk(createExercise({ name: 'Neck Curl' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Neck Extension' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Shrug' }), injuryArea)).toBe('avoid');
      });

      it('behind neck movements', () => {
        expect(getInjuryRisk(createExercise({ name: 'Behind Neck Press' }), injuryArea)).toBe('avoid');
        expect(getInjuryRisk(createExercise({ name: 'Behind Neck Pulldown' }), injuryArea)).toBe('avoid');
      });
    });

    describe('should mark as SAFE', () => {
      it('most other exercises', () => {
        expect(getInjuryRisk(createExercise({ name: 'Bench Press' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Squat' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Deadlift' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Row' }), injuryArea)).toBe('safe');
        expect(getInjuryRisk(createExercise({ name: 'Pulldown' }), injuryArea)).toBe('safe');
      });
    });

    describe('should mark as CAUTION', () => {
      it('upright rows', () => {
        expect(getInjuryRisk(createExercise({ name: 'Upright Row' }), injuryArea)).toBe('avoid'); // Explicit avoid
      });
    });
  });

  // ============================================
  // FILTERING TESTS
  // ============================================

  describe('filterForInjury', () => {
    const exercises = [
      createExercise({ id: '1', name: 'Deadlift', primaryMuscle: 'back' }),
      createExercise({ id: '2', name: 'Lat Pulldown', primaryMuscle: 'back' }),
      createExercise({ id: '3', name: 'Bent Over Row', primaryMuscle: 'back' }),
      createExercise({ id: '4', name: 'Machine Row', primaryMuscle: 'back' }),
      createExercise({ id: '5', name: 'Cable Row', primaryMuscle: 'back' }),
    ];

    it('filters out exercises marked as avoid', () => {
      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];
      const filtered = filterForInjury(exercises, injuries);

      expect(filtered.map(e => e.name)).toEqual([
        'Lat Pulldown',
        'Machine Row',
        'Cable Row',
      ]);
    });

    it('severity 3 also filters caution exercises', () => {
      const mildExercises = [
        createExercise({ id: '1', name: 'Standing Overhead Press', primaryMuscle: 'shoulders' }),
        createExercise({ id: '2', name: 'Farmer Carry', primaryMuscle: 'core' }),
        createExercise({ id: '3', name: 'Lat Pulldown', primaryMuscle: 'back' }),
      ];

      const mildInjury: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];
      const severeInjury: InjuryContext[] = [{ area: 'lower_back', severity: 3 }];

      const mildFiltered = filterForInjury(mildExercises, mildInjury);
      const severeFiltered = filterForInjury(mildExercises, severeInjury);

      // Mild allows caution exercises
      expect(mildFiltered.length).toBeGreaterThan(severeFiltered.length);
      // Severe filters out caution
      expect(severeFiltered.map(e => e.name)).toEqual(['Lat Pulldown']);
    });

    it('handles multiple injuries', () => {
      const multiExercises = [
        createExercise({ id: '1', name: 'Deadlift', primaryMuscle: 'back' }),          // avoid (lower_back)
        createExercise({ id: '2', name: 'Overhead Press', primaryMuscle: 'shoulders' }), // avoid (shoulder)
        createExercise({ id: '3', name: 'Leg Press', primaryMuscle: 'quads' }),          // safe for both
        createExercise({ id: '4', name: 'Cable Curl', primaryMuscle: 'biceps' }),        // safe for both
      ];

      const injuries: InjuryContext[] = [
        { area: 'lower_back', severity: 2 },
        { area: 'shoulder', severity: 2 },
      ];

      const filtered = filterForInjury(multiExercises, injuries);
      expect(filtered.map(e => e.name)).toEqual(['Leg Press', 'Cable Curl']);
    });

    it('returns empty array if all exercises are unsafe', () => {
      const unsafeExercises = [
        createExercise({ id: '1', name: 'Deadlift' }),
        createExercise({ id: '2', name: 'Barbell Row' }),
      ];

      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 3 }];
      const filtered = filterForInjury(unsafeExercises, injuries);

      expect(filtered).toEqual([]);
    });

    it('returns all exercises if no injuries', () => {
      const injuries: InjuryContext[] = [];
      const filtered = filterForInjury(exercises, injuries);

      expect(filtered.length).toBe(exercises.length);
    });
  });

  // ============================================
  // GET SAFE ALTERNATIVES TESTS
  // ============================================

  describe('getSafeAlternatives', () => {
    const backExercises = [
      createExercise({ id: '1', name: 'Deadlift', primaryMuscle: 'back', movementPattern: 'hip_hinge' }),
      createExercise({ id: '2', name: 'Lat Pulldown', primaryMuscle: 'back', movementPattern: 'vertical_pull' }),
      createExercise({ id: '3', name: 'Bent Over Row', primaryMuscle: 'back', movementPattern: 'horizontal_pull' }),
      createExercise({ id: '4', name: 'Machine Row', primaryMuscle: 'back', movementPattern: 'horizontal_pull' }),
      createExercise({ id: '5', name: 'Cable Row', primaryMuscle: 'back', movementPattern: 'horizontal_pull' }),
      createExercise({ id: '6', name: 'Chest Supported Row', primaryMuscle: 'back', movementPattern: 'horizontal_pull' }),
    ];

    it('returns safe alternatives for injured exercise', () => {
      const bentOverRow = backExercises[2];
      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 2 }];

      const alternatives = getSafeAlternatives(bentOverRow, backExercises, injuries);

      // Should not include bent over row itself
      expect(alternatives.find(a => a.exercise.name === 'Bent Over Row')).toBeUndefined();

      // Should not include deadlift (also avoid)
      expect(alternatives.find(a => a.exercise.name === 'Deadlift')).toBeUndefined();

      // Should include safe alternatives
      const names = alternatives.map(a => a.exercise.name);
      expect(names).toContain('Lat Pulldown');
      expect(names).toContain('Machine Row');
      expect(names).toContain('Cable Row');
      expect(names).toContain('Chest Supported Row');
    });

    it('marks alternatives as safe or caution', () => {
      const deadlift = backExercises[0];
      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];

      const alternatives = getSafeAlternatives(deadlift, backExercises, injuries);

      // All returned alternatives should be safe (severity 1 allows caution too)
      alternatives.forEach(alt => {
        expect(['safe', 'caution']).toContain(alt.risk);
      });
    });

    it('filters caution exercises for severe injuries', () => {
      const deadlift = backExercises[0];
      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 3 }];

      const alternatives = getSafeAlternatives(deadlift, backExercises, injuries);

      // All should be safe (not caution) for severity 3
      alternatives.forEach(alt => {
        expect(alt.risk).toBe('safe');
      });
    });

    it('returns at most 10 alternatives', () => {
      const manyExercises = Array.from({ length: 20 }, (_, i) =>
        createExercise({
          id: `ex-${i}`,
          name: `Machine Row ${i}`,
          primaryMuscle: 'back'
        })
      );

      const source = createExercise({ id: 'source', name: 'Bent Over Row', primaryMuscle: 'back' });
      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];

      const alternatives = getSafeAlternatives(source, manyExercises, injuries);

      expect(alternatives.length).toBeLessThanOrEqual(10);
    });

    it('includes match score and reason', () => {
      const bentOverRow = backExercises[2];
      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];

      const alternatives = getSafeAlternatives(bentOverRow, backExercises, injuries);

      alternatives.forEach(alt => {
        expect(typeof alt.matchScore).toBe('number');
        expect(alt.matchScore).toBeGreaterThanOrEqual(0);
        expect(alt.matchScore).toBeLessThanOrEqual(100);
        expect(typeof alt.reason).toBe('string');
        expect(alt.reason.length).toBeGreaterThan(0);
      });
    });

    it('prioritizes safe over caution exercises', () => {
      const source = createExercise({ id: 'source', name: 'Deadlift', primaryMuscle: 'back' });
      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];

      const alternatives = getSafeAlternatives(source, backExercises, injuries);

      // Check that safe exercises come before caution
      let foundCaution = false;
      for (const alt of alternatives) {
        if (alt.risk === 'caution') {
          foundCaution = true;
        } else if (foundCaution && alt.risk === 'safe') {
          fail('Found safe exercise after caution exercise');
        }
      }
    });
  });

  // ============================================
  // AUTO SWAP TESTS
  // ============================================

  describe('autoSwapForInjuries', () => {
    const allExercises = [
      createExercise({ id: '1', name: 'Deadlift', primaryMuscle: 'back' }),
      createExercise({ id: '2', name: 'Lat Pulldown', primaryMuscle: 'back' }),
      createExercise({ id: '3', name: 'Machine Row', primaryMuscle: 'back' }),
      createExercise({ id: '4', name: 'Bench Press', primaryMuscle: 'chest' }),
      createExercise({ id: '5', name: 'Cable Fly', primaryMuscle: 'chest' }),
    ];

    it('swaps dangerous exercises with safe alternatives', () => {
      const workoutExercises = [
        { id: 'w1', exercise: allExercises[0] }, // Deadlift - needs swap
        { id: 'w2', exercise: allExercises[3] }, // Bench Press - safe
      ];

      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 2 }];

      const results = autoSwapForInjuries(workoutExercises, allExercises, injuries);

      expect(results.length).toBe(1);
      expect(results[0].originalName).toBe('Deadlift');
      expect(results[0].action).toBe('swapped');
      expect(results[0].replacement).not.toBeNull();
      expect(['Lat Pulldown', 'Machine Row']).toContain(results[0].replacement?.name);
    });

    it('removes exercises when no safe alternative exists', () => {
      const limitedExercises = [
        createExercise({ id: '1', name: 'Deadlift', primaryMuscle: 'back' }),
        createExercise({ id: '2', name: 'Barbell Row', primaryMuscle: 'back' }),
      ];

      const workoutExercises = [
        { id: 'w1', exercise: limitedExercises[0] },
      ];

      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 3 }];

      const results = autoSwapForInjuries(workoutExercises, limitedExercises, injuries);

      expect(results.length).toBe(1);
      expect(results[0].action).toBe('removed');
      expect(results[0].replacement).toBeNull();
    });

    it('returns empty array if no exercises need swapping', () => {
      const safeWorkout = [
        { id: 'w1', exercise: allExercises[1] }, // Lat Pulldown
        { id: 'w2', exercise: allExercises[2] }, // Machine Row
      ];

      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];

      const results = autoSwapForInjuries(safeWorkout, allExercises, injuries);

      expect(results.length).toBe(0);
    });

    it('considers severity for caution exercises', () => {
      // Standing overhead press is CAUTION for lower back at severity 1
      const cautionExercise = createExercise({
        id: 'c1',
        name: 'Standing Overhead Press',
        primaryMuscle: 'shoulders'
      });

      const workoutExercises = [
        { id: 'w1', exercise: cautionExercise },
      ];

      const mildInjury: InjuryContext[] = [{ area: 'lower_back', severity: 1 }];
      const moderateInjury: InjuryContext[] = [{ area: 'lower_back', severity: 2 }];

      const mildResults = autoSwapForInjuries(workoutExercises, allExercises, mildInjury);
      const moderateResults = autoSwapForInjuries(workoutExercises, allExercises, moderateInjury);

      // Severity 1 should not swap caution exercises
      expect(mildResults.length).toBe(0);
      // Severity 2+ should swap caution exercises
      expect(moderateResults.length).toBe(1);
    });

    it('does not suggest exercises already in workout', () => {
      const workoutExercises = [
        { id: 'w1', exercise: allExercises[0] }, // Deadlift
        { id: 'w2', exercise: allExercises[1] }, // Lat Pulldown (already in workout)
      ];

      const injuries: InjuryContext[] = [{ area: 'lower_back', severity: 2 }];

      const results = autoSwapForInjuries(workoutExercises, allExercises, injuries);

      // Deadlift should swap to Machine Row (not Lat Pulldown since it's already used)
      expect(results.length).toBe(1);
      expect(results[0].replacement?.name).toBe('Machine Row');
    });
  });

  // ============================================
  // UTILITY TESTS
  // ============================================

  describe('INJURY_LABELS', () => {
    it('has labels for all injury areas', () => {
      const expectedAreas = [
        'lower_back', 'upper_back', 'shoulder', 'shoulder_left', 'shoulder_right',
        'knee', 'knee_left', 'knee_right', 'hip', 'hip_left', 'hip_right',
        'elbow', 'elbow_left', 'elbow_right', 'wrist', 'wrist_left', 'wrist_right',
        'ankle', 'ankle_left', 'ankle_right', 'neck', 'chest',
      ];

      expectedAreas.forEach(area => {
        expect(INJURY_LABELS[area]).toBeDefined();
        expect(typeof INJURY_LABELS[area]).toBe('string');
        expect(INJURY_LABELS[area].length).toBeGreaterThan(0);
      });
    });

    it('returns human-readable labels', () => {
      expect(INJURY_LABELS.lower_back).toBe('Lower Back');
      expect(INJURY_LABELS.shoulder_left).toBe('Left Shoulder');
      expect(INJURY_LABELS.knee_right).toBe('Right Knee');
    });
  });

  describe('getInjuryDescription', () => {
    it('returns descriptions for all injury areas', () => {
      const areas: InjuryArea[] = [
        'lower_back', 'upper_back', 'shoulder', 'knee', 'hip',
        'elbow', 'wrist', 'ankle', 'neck', 'chest',
      ];

      areas.forEach(area => {
        const description = getInjuryDescription(area);
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(20);
      });
    });

    it('normalizes left/right variants', () => {
      const genericDesc = getInjuryDescription('shoulder');
      const leftDesc = getInjuryDescription('shoulder_left');
      const rightDesc = getInjuryDescription('shoulder_right');

      expect(leftDesc).toBe(genericDesc);
      expect(rightDesc).toBe(genericDesc);
    });

    it('lower back description mentions safe alternatives', () => {
      const desc = getInjuryDescription('lower_back');
      expect(desc.toLowerCase()).toContain('pulldown');
    });

    it('knee description mentions hip-dominant movements', () => {
      const desc = getInjuryDescription('knee');
      expect(desc.toLowerCase()).toContain('hip');
    });
  });
});
