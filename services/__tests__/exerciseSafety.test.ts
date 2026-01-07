/**
 * Tests for services/exerciseSafety.ts
 * Exercise failure safety tier classification
 */

import {
  getFailureSafetyTier,
  getRIRFloor,
  getTierDisplayInfo,
  isAMRAPEligible,
  getProtectWarning,
  getEquipmentSafetyNote,
  matchesAnyPattern,
  filterByTier,
  type FailureSafetyTier,
} from '../exerciseSafety';

// ============================================
// SAFETY TIER CLASSIFICATION TESTS
// ============================================

describe('getFailureSafetyTier', () => {
  describe('push_freely tier (machines, cables, isolation)', () => {
    it.each([
      'Machine Chest Press',
      'Cable Flyes',
      'Smith Machine Squat',
      'Hack Squat',
      'Leg Press',
      'Leg Extension',
      'Leg Curl',
      'Chest Fly Machine',
      'Pec Deck',
      'Lat Pulldown',
      'Seated Row Machine',
      'Chest Press Machine',
      'Shoulder Press Machine',
      'Assisted Pull-ups',
    ])('classifies "%s" as push_freely', (exerciseName) => {
      expect(getFailureSafetyTier(exerciseName)).toBe('push_freely');
    });

    it('prioritizes machine pattern over protect patterns', () => {
      // "Smith Machine Bench Press" contains "bench press" (protect)
      // but also "smith machine" (safe) - safe should win
      expect(getFailureSafetyTier('Smith Machine Bench Press')).toBe('push_freely');
    });

    it('classifies unknown exercises as push_freely by default', () => {
      expect(getFailureSafetyTier('Tricep Pushdown')).toBe('push_freely');
      expect(getFailureSafetyTier('Bicep Curl')).toBe('push_freely');
      expect(getFailureSafetyTier('Face Pull')).toBe('push_freely');
    });
  });

  describe('protect tier (heavy barbell compounds)', () => {
    it.each([
      'Barbell Bench Press',
      'BB Bench Press',
      'Flat Bench Press',
      'Bench Press',
      'Barbell Squat',
      'BB Squat',
      'Back Squat',
      'Front Squat',
      'Deadlift',
      'Conventional Deadlift',
      'Sumo Deadlift',
      'Barbell Row',
      'BB Row',
      'Bent Over Row',
      'Pendlay Row',
      'Overhead Press',
      'OHP',
      'Military Press',
      'Barbell Press',
      'Standing Press',
      'Strict Press',
      'Good Morning',
    ])('classifies "%s" as protect', (exerciseName) => {
      expect(getFailureSafetyTier(exerciseName)).toBe('protect');
    });
  });

  describe('push_cautiously tier (free weights)', () => {
    // Note: Pattern matching order matters - protect patterns are checked before cautious
    // Some exercises with "deadlift", "bench press" in the name match protect patterns
    it.each([
      'DB Shoulder Press',
      'Dumbbell Rows',
      'Walking Lunges',
      'Bulgarian Split Squat',
      'Step Up',
      'Step-Up',
      'RDL', // Matches 'rdl' pattern for cautious
      'Hip Thrust',
      'Goblet Squat',
      'Kettlebell Swing',
      'KB Clean',
    ])('classifies "%s" as push_cautiously', (exerciseName) => {
      expect(getFailureSafetyTier(exerciseName)).toBe('push_cautiously');
    });

    // These contain protect patterns ("bench press", "deadlift") so they're classified as protect
    it.each([
      'Dumbbell Bench Press', // Contains "bench press"
      'Romanian Deadlift', // Contains "deadlift"
      'Stiff Leg Deadlift', // Contains "deadlift"
      'Single-Leg Deadlift', // Contains "deadlift"
    ])('classifies "%s" as protect due to matching protect patterns', (exerciseName) => {
      expect(getFailureSafetyTier(exerciseName)).toBe('protect');
    });

    // Single Leg Press contains "leg press" which is a safe pattern
    it('classifies Single Leg Press as push_freely (matches leg press pattern)', () => {
      expect(getFailureSafetyTier('Single Leg Press')).toBe('push_freely');
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase', () => {
      expect(getFailureSafetyTier('BARBELL BENCH PRESS')).toBe('protect');
    });

    it('handles lowercase', () => {
      expect(getFailureSafetyTier('barbell bench press')).toBe('protect');
    });

    it('handles mixed case', () => {
      expect(getFailureSafetyTier('BaRbElL bEnCh PrEsS')).toBe('protect');
    });
  });
});

// ============================================
// RIR FLOOR TESTS
// ============================================

describe('getRIRFloor', () => {
  it('returns 0 for push_freely exercises', () => {
    expect(getRIRFloor('Machine Chest Press')).toBe(0);
    expect(getRIRFloor('Cable Flyes')).toBe(0);
  });

  it('returns 1 for push_cautiously exercises', () => {
    expect(getRIRFloor('Bulgarian Split Squat')).toBe(1);
    expect(getRIRFloor('Hip Thrust')).toBe(1);
  });

  it('returns 2 for protect exercises', () => {
    expect(getRIRFloor('Barbell Bench Press')).toBe(2);
    expect(getRIRFloor('Deadlift')).toBe(2);
    expect(getRIRFloor('Back Squat')).toBe(2);
  });
});

// ============================================
// TIER DISPLAY INFO TESTS
// ============================================

describe('getTierDisplayInfo', () => {
  describe('push_freely tier', () => {
    const info = getTierDisplayInfo('push_freely');

    it('has correct label', () => {
      expect(info.label).toBe('Safe to Fail');
    });

    it('has green color', () => {
      expect(info.color).toBe('green');
    });

    it('has appropriate description', () => {
      expect(info.description).toContain('Machine');
      expect(info.description).toContain('Safe to push');
    });
  });

  describe('push_cautiously tier', () => {
    const info = getTierDisplayInfo('push_cautiously');

    it('has correct label', () => {
      expect(info.label).toBe('Moderate Risk');
    });

    it('has yellow color', () => {
      expect(info.color).toBe('yellow');
    });

    it('has appropriate description', () => {
      expect(info.description).toContain('Free weight');
      expect(info.description).toContain('1 rep in reserve');
    });
  });

  describe('protect tier', () => {
    const info = getTierDisplayInfo('protect');

    it('has correct label', () => {
      expect(info.label).toBe('Protect');
    });

    it('has red color', () => {
      expect(info.color).toBe('red');
    });

    it('has appropriate description', () => {
      expect(info.description).toContain('Heavy barbell');
      expect(info.description).toContain('2+ RIR');
    });
  });
});

// ============================================
// AMRAP ELIGIBILITY TESTS
// ============================================

describe('isAMRAPEligible', () => {
  describe('push_freely exercises', () => {
    it('is eligible when no recent AMRAP', () => {
      expect(isAMRAPEligible('Machine Chest Press', { hasRecentAMRAP: false })).toBe(true);
    });

    it('is not eligible when has recent AMRAP', () => {
      expect(isAMRAPEligible('Machine Chest Press', { hasRecentAMRAP: true })).toBe(false);
    });

    it('defaults hasRecentAMRAP to false', () => {
      expect(isAMRAPEligible('Machine Chest Press')).toBe(true);
    });
  });

  describe('push_cautiously exercises', () => {
    it('is not eligible by default', () => {
      expect(isAMRAPEligible('Bulgarian Split Squat')).toBe(false);
    });

    it('is eligible at mesocycle end', () => {
      expect(isAMRAPEligible('Bulgarian Split Squat', { isMesocycleEnd: true })).toBe(true);
    });

    it('is eligible on return from deload', () => {
      expect(isAMRAPEligible('Bulgarian Split Squat', { isReturnFromDeload: true })).toBe(true);
    });
  });

  describe('protect exercises', () => {
    it('is never eligible', () => {
      expect(isAMRAPEligible('Barbell Bench Press')).toBe(false);
    });

    it('is not eligible even at mesocycle end', () => {
      expect(isAMRAPEligible('Barbell Bench Press', { isMesocycleEnd: true })).toBe(false);
    });

    it('is not eligible even on return from deload', () => {
      expect(isAMRAPEligible('Barbell Bench Press', { isReturnFromDeload: true })).toBe(false);
    });
  });
});

// ============================================
// PROTECT WARNING TESTS
// ============================================

describe('getProtectWarning', () => {
  it('returns null for non-protect exercises', () => {
    expect(getProtectWarning('Machine Chest Press', 0)).toBeNull();
    expect(getProtectWarning('Dumbbell Rows', 0)).toBeNull();
  });

  it('returns null for protect exercises at safe RIR', () => {
    expect(getProtectWarning('Barbell Bench Press', 2)).toBeNull();
    expect(getProtectWarning('Barbell Bench Press', 3)).toBeNull();
  });

  it('returns warning for protect exercises at RIR 0', () => {
    const warning = getProtectWarning('Barbell Bench Press', 0);
    expect(warning).not.toBeNull();
    expect(warning).toContain('failure');
    expect(warning).toContain('injury risk');
  });

  it('returns warning for protect exercises at RIR 1', () => {
    const warning = getProtectWarning('Deadlift', 1);
    expect(warning).not.toBeNull();
    expect(warning).toContain('close to failure');
    expect(warning).toContain('2+ RIR');
  });

  it('includes exercise name in warning', () => {
    const warning = getProtectWarning('Back Squat', 0);
    expect(warning).toContain('Back Squat');
  });
});

// ============================================
// EQUIPMENT SAFETY NOTE TESTS
// ============================================

describe('getEquipmentSafetyNote', () => {
  it('returns safety note for barbell', () => {
    const note = getEquipmentSafetyNote('barbell');
    expect(note).not.toBeNull();
    expect(note).toContain('safety pins');
    expect(note).toContain('spotters');
  });

  it('returns safety note for dumbbell', () => {
    const note = getEquipmentSafetyNote('dumbbell');
    expect(note).not.toBeNull();
    expect(note).toContain('dropped safely');
  });

  it('returns safety note for machine', () => {
    const note = getEquipmentSafetyNote('machine');
    expect(note).not.toBeNull();
    expect(note).toContain('Safe to push to failure');
  });

  it('returns safety note for cable', () => {
    const note = getEquipmentSafetyNote('cable');
    expect(note).not.toBeNull();
    expect(note).toContain('Safe to push to failure');
  });

  it('returns null for unknown equipment', () => {
    expect(getEquipmentSafetyNote('resistance band')).toBeNull();
    expect(getEquipmentSafetyNote('bodyweight')).toBeNull();
  });

  it('is case insensitive', () => {
    expect(getEquipmentSafetyNote('BARBELL')).not.toBeNull();
    expect(getEquipmentSafetyNote('Dumbbell')).not.toBeNull();
    expect(getEquipmentSafetyNote('MACHINE')).not.toBeNull();
  });
});

// ============================================
// HELPER FUNCTION TESTS
// ============================================

describe('matchesAnyPattern', () => {
  it('returns true when name includes a pattern', () => {
    expect(matchesAnyPattern('Barbell Bench Press', ['bench', 'squat'])).toBe(true);
  });

  it('returns false when name matches no patterns', () => {
    expect(matchesAnyPattern('Tricep Pushdown', ['bench', 'squat'])).toBe(false);
  });

  it('is case insensitive', () => {
    expect(matchesAnyPattern('BARBELL BENCH', ['bench'])).toBe(true);
  });

  it('matches partial strings', () => {
    expect(matchesAnyPattern('Dumbbell Romanian Deadlift', ['roman'])).toBe(true);
  });
});

describe('filterByTier', () => {
  const exercises = [
    { name: 'Machine Chest Press' },
    { name: 'Barbell Bench Press' },
    { name: 'Dumbbell Rows' },
    { name: 'Cable Flyes' },
    { name: 'Back Squat' },
    { name: 'Bulgarian Split Squat' },
  ];

  it('filters push_freely exercises', () => {
    const result = filterByTier(exercises, 'push_freely');
    expect(result).toHaveLength(2);
    expect(result.map(e => e.name)).toContain('Machine Chest Press');
    expect(result.map(e => e.name)).toContain('Cable Flyes');
  });

  it('filters protect exercises', () => {
    const result = filterByTier(exercises, 'protect');
    expect(result).toHaveLength(2);
    expect(result.map(e => e.name)).toContain('Barbell Bench Press');
    expect(result.map(e => e.name)).toContain('Back Squat');
  });

  it('filters push_cautiously exercises', () => {
    const result = filterByTier(exercises, 'push_cautiously');
    expect(result).toHaveLength(2);
    expect(result.map(e => e.name)).toContain('Dumbbell Rows');
    expect(result.map(e => e.name)).toContain('Bulgarian Split Squat');
  });

  it('returns empty array when no matches', () => {
    const result = filterByTier([], 'push_freely');
    expect(result).toHaveLength(0);
  });
});
