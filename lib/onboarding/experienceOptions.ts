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
