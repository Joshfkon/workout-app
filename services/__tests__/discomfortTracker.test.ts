/**
 * Tests for Discomfort Tracking Service
 *
 * Tests pattern detection, injury suggestions, and severity handling.
 */
import {
  detectDiscomfortPatterns,
  processDiscomfortLog,
  getBodyPartDisplayName,
  getSeverityInfo,
  type DiscomfortEntry,
  type DiscomfortPattern,
} from '../discomfortTracker';
import type { SetDiscomfort, DiscomfortBodyPart, DiscomfortSeverity } from '@/types/schema';

// ============================================
// TEST HELPERS
// ============================================

function createDiscomfortEntry(
  bodyPart: DiscomfortBodyPart,
  severity: DiscomfortSeverity,
  daysAgo: number = 0,
  exerciseName: string = 'Test Exercise'
): DiscomfortEntry {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  return {
    id: `entry-${Date.now()}-${Math.random()}`,
    userId: 'user-1',
    loggedAt: date.toISOString(),
    exerciseId: 'ex-1',
    exerciseName,
    discomfort: {
      bodyPart,
      severity,
    },
    setNumber: 1,
    weightKg: 50,
  };
}

function createSetDiscomfort(
  bodyPart: DiscomfortBodyPart,
  severity: DiscomfortSeverity
): SetDiscomfort {
  return {
    bodyPart,
    severity,
  };
}

// ============================================
// PATTERN DETECTION TESTS
// ============================================

describe('detectDiscomfortPatterns', () => {
  describe('basic pattern detection', () => {
    it('returns empty array for no entries', () => {
      const patterns = detectDiscomfortPatterns([]);
      expect(patterns).toEqual([]);
    });

    it('returns empty array for single entry', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns).toEqual([]);
    });

    it('detects pattern for 2+ occurrences of same body part', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1),
        createDiscomfortEntry('lower_back', 'twinge', 5),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns.length).toBe(1);
      expect(patterns[0].bodyPart).toBe('lower_back');
      expect(patterns[0].occurrences).toBe(2);
    });

    it('groups by body part correctly', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1),
        createDiscomfortEntry('lower_back', 'twinge', 3),
        createDiscomfortEntry('left_knee', 'discomfort', 2),
        createDiscomfortEntry('left_knee', 'twinge', 4),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns.length).toBe(2);

      const backPattern = patterns.find(p => p.bodyPart === 'lower_back');
      const kneePattern = patterns.find(p => p.bodyPart === 'left_knee');

      expect(backPattern?.occurrences).toBe(2);
      expect(kneePattern?.occurrences).toBe(2);
    });
  });

  describe('time window filtering', () => {
    it('uses 14 day window by default', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1),
        createDiscomfortEntry('lower_back', 'twinge', 10),
        createDiscomfortEntry('lower_back', 'twinge', 20), // Outside window
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].occurrences).toBe(2);
    });

    it('respects custom time window', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1),
        createDiscomfortEntry('lower_back', 'twinge', 5),
        createDiscomfortEntry('lower_back', 'twinge', 8), // Outside 7-day window
      ];

      const patterns = detectDiscomfortPatterns(entries, 7);
      expect(patterns[0].occurrences).toBe(2);
    });

    it('excludes entries outside the window', () => {
      const entries = [
        createDiscomfortEntry('left_shoulder', 'discomfort', 30), // Old
        createDiscomfortEntry('left_shoulder', 'twinge', 40), // Old
      ];

      const patterns = detectDiscomfortPatterns(entries, 14);
      expect(patterns).toEqual([]);
    });
  });

  describe('severity calculation', () => {
    it('calculates average severity as twinge', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'twinge', 1),
        createDiscomfortEntry('lower_back', 'twinge', 2),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].averageSeverity).toBe('twinge');
    });

    it('calculates average severity as discomfort', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'twinge', 1),
        createDiscomfortEntry('lower_back', 'discomfort', 2),
        createDiscomfortEntry('lower_back', 'pain', 3),
      ];

      // Average: (1 + 2 + 3) / 3 = 2 = discomfort
      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].averageSeverity).toBe('discomfort');
    });

    it('calculates average severity as pain', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'pain', 1),
        createDiscomfortEntry('lower_back', 'pain', 2),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].averageSeverity).toBe('pain');
    });
  });

  describe('injury suggestion logic', () => {
    it('suggests injury for 3+ occurrences', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'twinge', 1),
        createDiscomfortEntry('lower_back', 'twinge', 3),
        createDiscomfortEntry('lower_back', 'twinge', 5),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].suggestsInjury).toBe(true);
    });

    it('suggests injury for any pain severity', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'pain', 1),
        createDiscomfortEntry('lower_back', 'twinge', 3),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].suggestsInjury).toBe(true);
    });

    it('does not suggest injury for 2 twinges', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'twinge', 1),
        createDiscomfortEntry('lower_back', 'twinge', 3),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].suggestsInjury).toBe(false);
    });

    it('suggests injury for 2 discomforts with one pain', () => {
      const entries = [
        createDiscomfortEntry('left_knee', 'discomfort', 1),
        createDiscomfortEntry('left_knee', 'pain', 3),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].suggestsInjury).toBe(true);
    });
  });

  describe('exercise tracking', () => {
    it('tracks unique exercises involved', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1, 'Deadlift'),
        createDiscomfortEntry('lower_back', 'twinge', 3, 'Squat'),
        createDiscomfortEntry('lower_back', 'twinge', 5, 'Deadlift'),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].exercises).toContain('Deadlift');
      expect(patterns[0].exercises).toContain('Squat');
      expect(patterns[0].exercises.length).toBe(2); // Unique exercises
    });
  });

  describe('days span calculation', () => {
    it('calculates days span correctly', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1),
        createDiscomfortEntry('lower_back', 'twinge', 7),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].daysSpan).toBeGreaterThanOrEqual(6);
      expect(patterns[0].daysSpan).toBeLessThanOrEqual(7);
    });

    it('returns 1 day span for same-day entries', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 0),
        createDiscomfortEntry('lower_back', 'twinge', 0),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].daysSpan).toBe(1);
    });
  });

  describe('pattern sorting', () => {
    it('sorts by severity first (pain > discomfort > twinge)', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'twinge', 1),
        createDiscomfortEntry('lower_back', 'twinge', 2),
        createDiscomfortEntry('left_knee', 'pain', 1),
        createDiscomfortEntry('left_knee', 'pain', 2),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].bodyPart).toBe('left_knee'); // Pain comes first
      expect(patterns[1].bodyPart).toBe('lower_back');
    });

    it('sorts by occurrences when severity is equal', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'discomfort', 1),
        createDiscomfortEntry('lower_back', 'discomfort', 2),
        createDiscomfortEntry('left_knee', 'discomfort', 1),
        createDiscomfortEntry('left_knee', 'discomfort', 2),
        createDiscomfortEntry('left_knee', 'discomfort', 3),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].bodyPart).toBe('left_knee'); // More occurrences
      expect(patterns[0].occurrences).toBe(3);
    });
  });

  describe('suggested injury type mapping', () => {
    it('suggests lower back injury types for lower back', () => {
      const entries = [
        createDiscomfortEntry('lower_back', 'pain', 1),
        createDiscomfortEntry('lower_back', 'discomfort', 2),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].suggestedInjuryType).toBeDefined();
      expect(patterns[0].suggestedInjuryType?.id).toContain('back');
    });

    it('suggests shoulder injury types for shoulder', () => {
      const entries = [
        createDiscomfortEntry('left_shoulder', 'pain', 1),
        createDiscomfortEntry('left_shoulder', 'discomfort', 2),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].suggestedInjuryType).toBeDefined();
      expect(patterns[0].suggestedInjuryType?.id).toContain('shoulder');
    });

    it('suggests knee injury types for knee', () => {
      const entries = [
        createDiscomfortEntry('left_knee', 'pain', 1),
        createDiscomfortEntry('left_knee', 'discomfort', 2),
      ];

      const patterns = detectDiscomfortPatterns(entries);
      expect(patterns[0].suggestedInjuryType).toBeDefined();
      expect(patterns[0].suggestedInjuryType?.id).toContain('knee');
    });
  });
});

// ============================================
// PROCESS DISCOMFORT LOG TESTS
// ============================================

describe('processDiscomfortLog', () => {
  describe('pain warning', () => {
    it('returns pain warning for pain severity', () => {
      const discomfort = createSetDiscomfort('lower_back', 'pain');

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', []);

      expect(result.painWarning).toBeDefined();
      expect(result.painWarning?.title).toBe('Pain Logged');
      expect(result.painWarning?.actions).toContain('skip_remaining');
      expect(result.painWarning?.actions).toContain('end_workout');
    });

    it('does not return pain warning for discomfort severity', () => {
      const discomfort = createSetDiscomfort('lower_back', 'discomfort');

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', []);

      expect(result.painWarning).toBeUndefined();
    });

    it('does not return pain warning for twinge severity', () => {
      const discomfort = createSetDiscomfort('lower_back', 'twinge');

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', []);

      expect(result.painWarning).toBeUndefined();
    });
  });

  describe('injury prompt', () => {
    it('suggests injury after 3+ occurrences', () => {
      const discomfort = createSetDiscomfort('lower_back', 'discomfort');
      // Need 3+ entries in history, OR one with pain severity for suggestsInjury
      const history = [
        createDiscomfortEntry('lower_back', 'discomfort', 3),
        createDiscomfortEntry('lower_back', 'twinge', 5),
        createDiscomfortEntry('lower_back', 'twinge', 7),
      ];

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', history);

      expect(result.injuryPrompt).toBeDefined();
      expect(result.injuryPrompt?.bodyPart).toBe('lower_back');
      expect(result.injuryPrompt?.occurrenceCount).toBe(4); // 3 in history + current
    });

    it('includes suggested injury type in prompt', () => {
      const discomfort = createSetDiscomfort('left_shoulder', 'discomfort');
      const history = [
        createDiscomfortEntry('left_shoulder', 'discomfort', 3),
        createDiscomfortEntry('left_shoulder', 'pain', 7),
      ];

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Overhead Press', history);

      expect(result.injuryPrompt?.suggestedType).toBeDefined();
      expect(result.injuryPrompt?.suggestedType.id).toContain('shoulder');
    });

    it('does not suggest injury for first occurrence', () => {
      const discomfort = createSetDiscomfort('lower_back', 'discomfort');

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', []);

      expect(result.injuryPrompt).toBeUndefined();
    });

    it('does not suggest injury for second occurrence without pain', () => {
      const discomfort = createSetDiscomfort('lower_back', 'twinge');
      const history = [
        createDiscomfortEntry('lower_back', 'twinge', 5),
      ];

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', history);

      // Only 2 occurrences without pain - should not suggest injury yet
      expect(result.injuryPrompt).toBeUndefined();
    });

    it('suggests injury on third occurrence if one is pain', () => {
      const discomfort = createSetDiscomfort('lower_back', 'pain');
      // Need 2 entries in history for 3rd occurrence to trigger
      const history = [
        createDiscomfortEntry('lower_back', 'discomfort', 3),
        createDiscomfortEntry('lower_back', 'pain', 5),
      ];

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', history);

      expect(result.injuryPrompt).toBeDefined();
    });

    it('includes human-readable message in prompt', () => {
      const discomfort = createSetDiscomfort('lower_back', 'discomfort');
      // Need 3 entries in history with one being pain for suggestsInjury=true
      const history = [
        createDiscomfortEntry('lower_back', 'pain', 3), // Pain triggers suggestsInjury
        createDiscomfortEntry('lower_back', 'discomfort', 5),
        createDiscomfortEntry('lower_back', 'twinge', 7),
      ];

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', history);

      expect(result.injuryPrompt).toBeDefined();
      expect(result.injuryPrompt?.message).toContain('lower back');
      expect(result.injuryPrompt?.message).toContain('injury');
    });
  });

  describe('combined warnings', () => {
    it('can return both pain warning and injury prompt', () => {
      const discomfort = createSetDiscomfort('lower_back', 'pain');
      const history = [
        createDiscomfortEntry('lower_back', 'discomfort', 3),
        createDiscomfortEntry('lower_back', 'pain', 7),
      ];

      const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', history);

      expect(result.painWarning).toBeDefined();
      expect(result.injuryPrompt).toBeDefined();
    });
  });

  describe('different body parts', () => {
    it('only considers history for the same body part', () => {
      const discomfort = createSetDiscomfort('left_shoulder', 'discomfort');
      const history = [
        createDiscomfortEntry('lower_back', 'pain', 1),
        createDiscomfortEntry('lower_back', 'pain', 3),
        createDiscomfortEntry('lower_back', 'pain', 5),
      ];

      // Lower back history should not trigger shoulder injury prompt
      const result = processDiscomfortLog(discomfort, 'ex-1', 'Overhead Press', history);

      expect(result.injuryPrompt).toBeUndefined();
    });
  });
});

// ============================================
// DISPLAY NAME TESTS
// ============================================

describe('getBodyPartDisplayName', () => {
  it('returns proper display name for all body parts', () => {
    const bodyParts: DiscomfortBodyPart[] = [
      'lower_back', 'upper_back', 'neck',
      'left_shoulder', 'right_shoulder', 'shoulders',
      'left_elbow', 'right_elbow', 'elbows',
      'left_wrist', 'right_wrist', 'wrists',
      'left_knee', 'right_knee', 'knees',
      'left_hip', 'right_hip', 'hips',
      'other',
    ];

    bodyParts.forEach(bodyPart => {
      const displayName = getBodyPartDisplayName(bodyPart);
      expect(displayName).toBeDefined();
      expect(displayName.length).toBeGreaterThan(0);
      // Should not contain underscores
      expect(displayName).not.toContain('_');
    });
  });

  it('returns expected names for common body parts', () => {
    expect(getBodyPartDisplayName('lower_back')).toBe('Lower Back');
    expect(getBodyPartDisplayName('left_shoulder')).toBe('Left Shoulder');
    expect(getBodyPartDisplayName('right_knee')).toBe('Right Knee');
    expect(getBodyPartDisplayName('neck')).toBe('Neck');
  });

  it('handles plural body parts', () => {
    expect(getBodyPartDisplayName('shoulders')).toBe('Shoulders');
    expect(getBodyPartDisplayName('elbows')).toBe('Elbows');
    expect(getBodyPartDisplayName('wrists')).toBe('Wrists');
    expect(getBodyPartDisplayName('knees')).toBe('Knees');
    expect(getBodyPartDisplayName('hips')).toBe('Hips');
  });
});

// ============================================
// SEVERITY INFO TESTS
// ============================================

describe('getSeverityInfo', () => {
  it('returns info for twinge severity', () => {
    const info = getSeverityInfo('twinge');

    expect(info.label).toContain('Twinge');
    expect(info.label).toContain('Mild');
    expect(info.color).toBeDefined();
    expect(info.icon).toBeDefined();
  });

  it('returns info for discomfort severity', () => {
    const info = getSeverityInfo('discomfort');

    expect(info.label).toContain('Discomfort');
    expect(info.label).toContain('Moderate');
    expect(info.color).toBeDefined();
    expect(info.icon).toBeDefined();
  });

  it('returns info for pain severity', () => {
    const info = getSeverityInfo('pain');

    expect(info.label).toContain('Pain');
    expect(info.label).toContain('Stop');
    expect(info.color).toBeDefined();
    expect(info.icon).toBeDefined();
  });

  it('uses appropriate colors for severity levels', () => {
    const twingeInfo = getSeverityInfo('twinge');
    const discomfortInfo = getSeverityInfo('discomfort');
    const painInfo = getSeverityInfo('pain');

    // Yellow for mild, orange for moderate, red/danger for severe
    expect(twingeInfo.color).toContain('yellow');
    expect(discomfortInfo.color).toContain('orange');
    expect(painInfo.color).toContain('danger');
  });

  it('uses distinct icons for each severity', () => {
    const twingeInfo = getSeverityInfo('twinge');
    const discomfortInfo = getSeverityInfo('discomfort');
    const painInfo = getSeverityInfo('pain');

    expect(twingeInfo.icon).toBeDefined();
    expect(discomfortInfo.icon).toBeDefined();
    expect(painInfo.icon).toBeDefined();
    // Pain should have more urgent icon
    expect(painInfo.icon.length).toBeGreaterThanOrEqual(discomfortInfo.icon.length);
  });
});

// ============================================
// EDGE CASES
// ============================================

describe('edge cases', () => {
  it('handles empty history gracefully', () => {
    const discomfort = createSetDiscomfort('lower_back', 'discomfort');
    const result = processDiscomfortLog(discomfort, 'ex-1', 'Deadlift', []);

    expect(result).toBeDefined();
    expect(result.painWarning).toBeUndefined();
    expect(result.injuryPrompt).toBeUndefined();
  });

  it('handles "other" body part', () => {
    const entries = [
      createDiscomfortEntry('other', 'pain', 1),
      createDiscomfortEntry('other', 'pain', 3),
    ];

    const patterns = detectDiscomfortPatterns(entries);
    expect(patterns.length).toBe(1);
    expect(patterns[0].bodyPart).toBe('other');
    // "other" may not have a suggested injury type
    expect(patterns[0].suggestedInjuryType).toBeUndefined();
  });

  it('handles mixed side body parts separately', () => {
    const entries = [
      createDiscomfortEntry('left_shoulder', 'discomfort', 1),
      createDiscomfortEntry('left_shoulder', 'twinge', 3),
      createDiscomfortEntry('right_shoulder', 'discomfort', 2),
      createDiscomfortEntry('right_shoulder', 'twinge', 4),
    ];

    const patterns = detectDiscomfortPatterns(entries);
    expect(patterns.length).toBe(2);

    const leftPattern = patterns.find(p => p.bodyPart === 'left_shoulder');
    const rightPattern = patterns.find(p => p.bodyPart === 'right_shoulder');

    expect(leftPattern).toBeDefined();
    expect(rightPattern).toBeDefined();
  });

  it('handles very large number of entries', () => {
    const entries: DiscomfortEntry[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push(createDiscomfortEntry('lower_back', 'twinge', i % 14));
    }

    const patterns = detectDiscomfortPatterns(entries, 14);
    expect(patterns.length).toBe(1);
    expect(patterns[0].occurrences).toBe(100);
  });

  it('handles entries with side information', () => {
    const entry = createDiscomfortEntry('left_knee', 'discomfort', 1);
    entry.discomfort.side = 'left';

    const patterns = detectDiscomfortPatterns([
      entry,
      createDiscomfortEntry('left_knee', 'discomfort', 3),
    ]);

    expect(patterns[0].bodyPart).toBe('left_knee');
  });
});
