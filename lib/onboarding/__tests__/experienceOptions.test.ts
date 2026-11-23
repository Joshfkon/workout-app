import {
  LIFTING_OPTIONS,
  SKIPPED_EXPERIENCE,
  experienceForLiftingAnswer,
} from '../experienceOptions';

describe('sign-up lifting experience options', () => {
  it('maps every answer onto the existing experience enum', () => {
    expect(experienceForLiftingAnswer('no')).toBe('novice');
    expect(experienceForLiftingAnswer('under_6_months')).toBe('novice');
    expect(experienceForLiftingAnswer('6_to_12_months')).toBe('novice');
    expect(experienceForLiftingAnswer('1_to_2_years')).toBe('intermediate');
    expect(experienceForLiftingAnswer('2_to_3_years')).toBe('intermediate');
    expect(experienceForLiftingAnswer('3_to_5_years')).toBe('advanced');
    expect(experienceForLiftingAnswer('5_plus_years')).toBe('advanced');
  });

  it('keeps the previous default when skipped', () => {
    expect(SKIPPED_EXPERIENCE).toBe('intermediate');
    expect(experienceForLiftingAnswer(null)).toBe('intermediate');
  });

  it('starts with "just started" and has one option per answer, in order', () => {
    expect(LIFTING_OPTIONS[1]).toEqual({ value: 'under_6_months', label: 'Just started (under 6 months)' });
    expect(new Set(LIFTING_OPTIONS.map((o) => o.value)).size).toBe(LIFTING_OPTIONS.length);
    // The experience level never goes down as the years go up.
    const order = { novice: 0, intermediate: 1, advanced: 2 } as const;
    const levels = LIFTING_OPTIONS.slice(1).map((o) => order[experienceForLiftingAnswer(o.value)]);
    expect([...levels].sort()).toEqual(levels);
  });
});
