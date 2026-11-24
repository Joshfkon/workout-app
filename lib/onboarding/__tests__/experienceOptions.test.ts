import {
  LIFTING_OPTIONS,
  SKIPPED_EXPERIENCE,
  experienceForLiftingAnswer,
  experienceSummary,
  liftingAnswerFromMetadata,
  onboardingExperience,
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
    // Back after a long break: an existing level, not a new one (UX round 23).
    expect(experienceForLiftingAnswer('returning')).toBe('intermediate');
  });

  it('describes every option, and says how a returning lifter is treated', () => {
    for (const o of LIFTING_OPTIONS) expect(o.description.length).toBeGreaterThan(8);
    const returning = LIFTING_OPTIONS.find((o) => o.value === 'returning')!;
    expect(returning.label).toBe('Returning after a break');
    expect(returning.description).toMatch(/Set up like 1–2 years/);
    expect(experienceSummary('returning', 'intermediate')).toEqual({ label: 'Returning after a break (set up like 1–2 years)', fromSignUp: true });
  });

  it('keeps the previous default when skipped', () => {
    expect(SKIPPED_EXPERIENCE).toBe('intermediate');
    expect(experienceForLiftingAnswer(null)).toBe('intermediate');
  });

  it('starts with "just started" and has one option per answer, in order', () => {
    expect(LIFTING_OPTIONS[1]).toMatchObject({ value: 'under_6_months', label: 'Just started (under 6 months)' });
    expect(new Set(LIFTING_OPTIONS.map((o) => o.value)).size).toBe(LIFTING_OPTIONS.length);
    // The experience level never goes down as the years go up.
    const order = { novice: 0, intermediate: 1, advanced: 2 } as const;
    const levels = LIFTING_OPTIONS.slice(1)
      .filter((o) => o.value !== 'returning')
      .map((o) => order[experienceForLiftingAnswer(o.value)]);
    expect([...levels].sort()).toEqual(levels);
  });
});

describe('showing the sign-up answer back in onboarding', () => {
  it('reads only a known answer from user_metadata', () => {
    expect(liftingAnswerFromMetadata({ lifting_answer: '2_to_3_years' })).toBe('2_to_3_years');
    expect(liftingAnswerFromMetadata({ lifting_answer: 'forever' })).toBeNull();
    expect(liftingAnswerFromMetadata({})).toBeNull();
    expect(liftingAnswerFromMetadata(null)).toBeNull();
  });

  it('shows the exact answer, else the stored level as a range (not claimed as asked)', () => {
    expect(experienceSummary('2_to_3_years', 'intermediate')).toEqual({ label: '2–3 years', fromSignUp: true });
    expect(experienceSummary(null, 'advanced')).toEqual({ label: '3+ years', fromSignUp: false });
    expect(experienceSummary('no', 'novice')).toEqual({ label: 'Under a year', fromSignUp: false });
    expect(experienceSummary(null, null)).toBeNull();
  });
});

describe('onboardingExperience', () => {
  it('uses the sign-up answer while setup is unfinished, flagging a stale row', () => {
    expect(onboardingExperience('under_6_months', 'intermediate', false)).toEqual({ experience: 'novice', changed: true });
    expect(onboardingExperience('2_to_3_years', 'intermediate', false)).toEqual({ experience: 'intermediate', changed: false });
    expect(onboardingExperience('no', 'intermediate', null)).toEqual({ experience: 'novice', changed: true });
  });

  it('keeps the stored level with no answer, or once setup is finished', () => {
    expect(onboardingExperience(null, 'advanced', false)).toEqual({ experience: 'advanced', changed: false });
    expect(onboardingExperience('under_6_months', 'advanced', true)).toEqual({ experience: 'advanced', changed: false });
    expect(onboardingExperience(null, undefined, false)).toEqual({ experience: null, changed: false });
  });
});
