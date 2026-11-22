/**
 * The onboarding "Any injuries or areas to go easy on?" question.
 *
 * People think in joints ("my shoulder"), but the only user-level injury
 * field, users.injury_history, stores MuscleGroup values (the same list the
 * Settings > Training checkboxes write), and the workout generators exclude
 * those groups (services/shared/injuryExclusion). So each chip maps to the
 * muscle group(s) that field uses for that area. Pure: no I/O.
 */

import { MUSCLE_GROUPS, type MuscleGroup } from '@/types/schema';

export type OnboardingInjuryArea = 'shoulder' | 'lower_back' | 'knee' | 'elbow' | 'wrist' | 'hip';

export const ONBOARDING_INJURY_OPTIONS: { id: OnboardingInjuryArea; label: string }[] = [
  { id: 'shoulder', label: 'Shoulder' },
  { id: 'lower_back', label: 'Lower back' },
  { id: 'knee', label: 'Knee' },
  { id: 'elbow', label: 'Elbow' },
  { id: 'wrist', label: 'Wrist' },
  { id: 'hip', label: 'Hip' },
];

/**
 * Joint -> injury_history muscle groups. Kept to the single most directly
 * loaded group per area: an entry removes that whole group from generated
 * programs, so over-mapping would strip far more than "go easy" implies.
 * Elbow and wrist both map to forearms (the flexor/extensor tendons that
 * cross both joints are where most elbow and wrist lifting pain lives).
 */
export const INJURY_AREA_MUSCLES: Record<OnboardingInjuryArea, MuscleGroup[]> = {
  shoulder: ['shoulders'],
  lower_back: ['erectors'],
  knee: ['quads'],
  elbow: ['forearms'],
  wrist: ['forearms'],
  hip: ['glutes'],
};

const AREA_MUSCLES = new Set<string>(Object.values(INJURY_AREA_MUSCLES).flat());

/** Chips to show as already selected, given the stored injury_history. */
export function injuryAreasFromHistory(history: readonly string[] | null | undefined): OnboardingInjuryArea[] {
  if (!history || history.length === 0) return [];
  return ONBOARDING_INJURY_OPTIONS.map((o) => o.id).filter((area) =>
    INJURY_AREA_MUSCLES[area].every((m) => history.includes(m))
  );
}

/**
 * The injury_history to save. Groups the chips don't cover (set earlier in
 * Settings, e.g. 'chest') are kept; groups the chips do cover follow the
 * chips, so "None" clears them. Known groups come out in MUSCLE_GROUPS order;
 * any value outside that list is kept as-is, after them.
 */
export function mergeInjuryHistory(
  existing: readonly string[] | null | undefined,
  areas: readonly OnboardingInjuryArea[]
): string[] {
  const next = new Set<string>((existing ?? []).filter((m) => !AREA_MUSCLES.has(m)));
  for (const area of areas) {
    for (const muscle of INJURY_AREA_MUSCLES[area]) next.add(muscle);
  }
  const known = new Set<string>(MUSCLE_GROUPS);
  return [
    ...MUSCLE_GROUPS.filter((m) => next.has(m)),
    ...Array.from(next).filter((m) => !known.has(m)),
  ];
}
