/**
 * Sign-up's "Do you lift weights? If so, for how long?" answers, and how each
 * maps onto the stored experience enum. Pure.
 *
 * The ranges are finer than the enum so people can pick what is actually
 * true for them ("2–3 years", not "the closest of 1–3 / 3+"), and they never
 * overlap. The enum boundaries are unchanged: under 1 year = novice,
 * 1–3 years = intermediate, 3+ years = advanced.
 */
import type { Experience } from '@/types/schema';

export type LiftingAnswer =
  | 'no'
  | 'under_6_months'
  | '6_to_12_months'
  | '1_to_2_years'
  | '2_to_3_years'
  | '3_to_5_years'
  | '5_plus_years';

export const LIFTING_OPTIONS: { value: LiftingAnswer; label: string }[] = [
  { value: 'no', label: 'No, food tracking' },
  { value: 'under_6_months', label: 'Just started (under 6 months)' },
  { value: '6_to_12_months', label: '6–12 months' },
  { value: '1_to_2_years', label: '1–2 years' },
  { value: '2_to_3_years', label: '2–3 years' },
  { value: '3_to_5_years', label: '3–5 years' },
  { value: '5_plus_years', label: '5+ years' },
];

const EXPERIENCE_FOR_ANSWER: Record<LiftingAnswer, Experience> = {
  // Someone who doesn't lift yet starts as a novice if they ever do.
  no: 'novice',
  under_6_months: 'novice',
  '6_to_12_months': 'novice',
  '1_to_2_years': 'intermediate',
  '2_to_3_years': 'intermediate',
  '3_to_5_years': 'advanced',
  '5_plus_years': 'advanced',
};

/**
 * What a skipped question signs up as: the same default sign-up always used
 * (intermediate), so making the question optional doesn't quietly change
 * anyone's starting training volume. Editable in Settings.
 */
export const SKIPPED_EXPERIENCE: Experience = 'intermediate';

/** The stored experience level for an answer (null = skipped). */
export function experienceForLiftingAnswer(answer: LiftingAnswer | null): Experience {
  return answer === null ? SKIPPED_EXPERIENCE : EXPERIENCE_FOR_ANSWER[answer];
}

/**
 * auth user_metadata key for the exact sign-up answer, so onboarding can show
 * it back ("2–3 years") instead of asking again. The coarse enum still goes
 * to `experience`.
 */
export const LIFTING_ANSWER_METADATA_KEY = 'lifting_answer';

/** The sign-up answer from user_metadata, or null (skipped, or an older account). */
export function liftingAnswerFromMetadata(metadata: Record<string, unknown> | null | undefined): LiftingAnswer | null {
  const raw = metadata?.[LIFTING_ANSWER_METADATA_KEY];
  return LIFTING_OPTIONS.some((o) => o.value === raw) ? (raw as LiftingAnswer) : null;
}

const EXPERIENCE_RANGE_LABEL: Record<Experience, string> = {
  novice: 'Under a year',
  intermediate: '1–3 years',
  advanced: '3+ years',
};

/**
 * What onboarding shows back as "your lifting experience": the exact sign-up
 * answer when there is one, else the stored level's range. `fromSignUp` is
 * false when there is no sign-up answer to show (skipped, or an account made
 * before the answer was kept), so the screen doesn't claim it was asked.
 */
export function experienceSummary(
  answer: LiftingAnswer | null,
  experience: string | null | undefined
): { label: string; fromSignUp: boolean } | null {
  if (answer && answer !== 'no') {
    const option = LIFTING_OPTIONS.find((o) => o.value === answer);
    return { label: option?.label ?? EXPERIENCE_RANGE_LABEL[EXPERIENCE_FOR_ANSWER[answer]], fromSignUp: true };
  }
  if (experience === 'novice' || experience === 'intermediate' || experience === 'advanced') {
    return { label: EXPERIENCE_RANGE_LABEL[experience], fromSignUp: false };
  }
  return null;
}
