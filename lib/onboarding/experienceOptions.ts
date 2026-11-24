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
  | 'returning'
  | '6_to_12_months'
  | '1_to_2_years'
  | '2_to_3_years'
  | '3_to_5_years'
  | '5_plus_years';

/**
 * Each answer with one short line on who it's for and what it sets (UX
 * panel round 22: "The experience level options weren't clear for someone
 * coming back after a long break"). The lines say only what the mapped
 * level really changes: starting weekly sets (DEFAULT_VOLUME_LANDMARKS by
 * level) and Beginner mode (on for novice, lib/beginnerMode).
 */
export const LIFTING_OPTIONS: { value: LiftingAnswer; label: string; description: string }[] = [
  { value: 'no', label: 'No, food tracking', description: 'Track food; log a workout any time.' },
  {
    value: 'under_6_months',
    label: 'Just started (under 6 months)',
    description: 'Beginner mode on: a simpler workout screen.',
  },
  {
    value: 'returning',
    label: 'Returning after a break',
    description: 'A year or more off. Set up like 1–2 years; weights adjust to what you log.',
  },
  { value: '6_to_12_months', label: '6–12 months', description: 'Fewer sets, Beginner mode' },
  { value: '1_to_2_years', label: '1–2 years', description: 'Medium weekly sets' },
  { value: '2_to_3_years', label: '2–3 years', description: 'Medium weekly sets' },
  { value: '3_to_5_years', label: '3–5 years', description: 'Most weekly sets' },
  { value: '5_plus_years', label: '5+ years', description: 'Most weekly sets' },
];

const EXPERIENCE_FOR_ANSWER: Record<LiftingAnswer, Experience> = {
  // Someone who doesn't lift yet starts as a novice if they ever do.
  no: 'novice',
  under_6_months: 'novice',
  // Back after a long break: knows the lifts, has lost some conditioning.
  // Intermediate (not advanced) starts the volume in the middle, with
  // Beginner mode off; weight suggestions follow what they log. No new enum
  // value (UX round 23).
  returning: 'intermediate',
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
    // Onboarding shows it back, so it also says how a returning lifter is set up.
    if (answer === 'returning') return { label: 'Returning after a break (set up like 1–2 years)', fromSignUp: true };
    return { label: option?.label ?? EXPERIENCE_RANGE_LABEL[EXPERIENCE_FOR_ANSWER[answer]], fromSignUp: true };
  }
  if (experience === 'novice' || experience === 'intermediate' || experience === 'advanced') {
    return { label: EXPERIENCE_RANGE_LABEL[experience], fromSignUp: false };
  }
  return null;
}

/**
 * The experience level onboarding should use for this account.
 *
 * Sign-up keeps its answer in auth user_metadata, but the users row is
 * created by a trigger that (before 20261124000021) ignored it, so every
 * account started at the column default, 'intermediate'. A lifter who said
 * "Just started" then saw "Beginner mode: off" (UX panel round 19). Until
 * setup is finished the sign-up answer wins; after that the stored level is
 * the user's (Settings may have changed it), so it is left alone.
 *
 * `changed` is true when the stored level should be updated to match.
 */
export function onboardingExperience(
  answer: LiftingAnswer | null,
  stored: string | null | undefined,
  onboardingCompleted: boolean | null | undefined
): { experience: string | null; changed: boolean } {
  const storedLevel = stored ?? null;
  if (onboardingCompleted || answer === null) return { experience: storedLevel, changed: false };
  const fromAnswer = EXPERIENCE_FOR_ANSWER[answer];
  return { experience: fromAnswer, changed: fromAnswer !== storedLevel };
}
