/**
 * Standing "areas to go easy on", answered once in onboarding and stored as
 * body areas in users.preferences.injuryAreas (InjuryArea vocabulary,
 * types/training.ts).
 *
 * Deliberately NOT users.injury_history: that field removes whole muscle
 * groups from generated programs, so "knee" would wipe all quad work. These
 * areas instead feed the severity-aware, body-area paths at MILD severity:
 *  - the pre-workout check-in's temporaryInjuries (injury-aware swapper),
 *    where the lifter can still remove them for the day;
 *  - workout/new's exercise-safety check (UserInjury with an INJURY_TYPES id).
 *
 * Pure: no I/O, no clock reads.
 */

import type { InjuryArea } from '@/types/training';
import type { TemporaryInjury } from '@/types/schema';
import type { UserInjury } from '@/lib/training/injury-types';

export type StandingInjuryArea = Extract<InjuryArea, 'shoulder' | 'lower_back' | 'knee' | 'elbow' | 'wrist' | 'hip'>;

export const STANDING_INJURY_OPTIONS: { id: StandingInjuryArea; label: string }[] = [
  { id: 'shoulder', label: 'Shoulder' },
  { id: 'lower_back', label: 'Lower back' },
  { id: 'knee', label: 'Knee' },
  { id: 'elbow', label: 'Elbow' },
  { id: 'wrist', label: 'Wrist' },
  { id: 'hip', label: 'Hip' },
];

const STANDING_IDS = new Set<string>(STANDING_INJURY_OPTIONS.map((o) => o.id));

/** Validates whatever is stored in preferences.injuryAreas. */
export function parseStandingInjuryAreas(value: unknown): StandingInjuryArea[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((v): v is StandingInjuryArea => {
    if (typeof v !== 'string' || !STANDING_IDS.has(v) || seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

/**
 * Check-in vocabulary is sided for limbs. Onboarding doesn't ask which side,
 * so both sides are defaulted in and the lifter removes the one that's fine.
 */
const CHECK_IN_AREAS: Record<StandingInjuryArea, TemporaryInjury['area'][]> = {
  shoulder: ['shoulder_left', 'shoulder_right'],
  lower_back: ['lower_back'],
  knee: ['knee_left', 'knee_right'],
  elbow: ['elbow_left', 'elbow_right'],
  wrist: ['wrist_left', 'wrist_right'],
  hip: ['hip_left', 'hip_right'],
};

/** Default temporaryInjuries for the pre-workout check-in: mild (1). */
export function standingAreasToCheckInInjuries(areas: readonly StandingInjuryArea[]): TemporaryInjury[] {
  return areas.flatMap((area) => CHECK_IN_AREAS[area].map((a) => ({ area: a, severity: 1 as const })));
}

/**
 * The general INJURY_TYPES entry (lib/training/injury-types.ts) per area, for
 * the exercise-safety check, which looks injuries up by type id.
 */
export const STANDING_AREA_INJURY_TYPE: Record<StandingInjuryArea, string> = {
  shoulder: 'shoulder_impingement',
  lower_back: 'lower_back_strain',
  knee: 'knee_injury',
  elbow: 'elbow_tendinitis',
  wrist: 'wrist_strain',
  hip: 'hip_impingement',
};

/** Mild, active UserInjury entries for workout/new's safety filter. */
export function standingAreasToUserInjuries(
  areas: readonly StandingInjuryArea[],
  now: Date
): UserInjury[] {
  return areas.map((area) => ({
    id: `standing-${area}`,
    injuryTypeId: STANDING_AREA_INJURY_TYPE[area],
    severity: 'mild',
    isActive: true,
    startDate: now,
  }));
}

/**
 * General INJURY_TYPES entry per check-in body area (sides stripped). Areas
 * with no matching type (chest, other) return null and are skipped.
 */
const CHECK_IN_AREA_INJURY_TYPE: Record<string, string> = {
  ...STANDING_AREA_INJURY_TYPE,
  upper_back: 'upper_back_strain',
  neck: 'neck_strain',
  ankle: 'ankle_sprain',
};

const CHECK_IN_SEVERITY: Record<number, UserInjury['severity']> = { 1: 'mild', 2: 'moderate', 3: 'severe' };

/**
 * A pre-workout check-in injury (`{ area: 'knee_left', severity: 1 }`) as the
 * UserInjury the exercise-safety check understands. The check-in stores sided
 * body areas and a 1–3 severity; the safety check looks injuries up by
 * INJURY_TYPES id with a mild/moderate/severe severity. Passing the raw area
 * and number (the old behaviour) matched nothing, so check-in injuries were
 * silently ignored when generating a workout.
 */
export function checkInInjuryToUserInjury(
  inj: { id?: string; area?: string; injuryTypeId?: string; severity?: unknown; affectedSide?: 'left' | 'right' | 'both'; startDate?: string | number | Date; isActive?: boolean },
  now: Date
): UserInjury | null {
  if (inj.isActive === false) return null;
  const raw = inj.area ?? '';
  const side = /_left$/.test(raw) ? 'left' : /_right$/.test(raw) ? 'right' : undefined;
  const base = raw.replace(/_(left|right)$/, '');
  const injuryTypeId = CHECK_IN_AREA_INJURY_TYPE[base] ?? (inj.injuryTypeId || null);
  if (!injuryTypeId) return null;
  const severity =
    typeof inj.severity === 'number'
      ? CHECK_IN_SEVERITY[inj.severity] ?? 'moderate'
      : inj.severity === 'mild' || inj.severity === 'moderate' || inj.severity === 'severe'
        ? inj.severity
        : 'moderate';
  return {
    id: inj.id || `checkin-${raw || injuryTypeId}`,
    injuryTypeId,
    severity,
    isActive: true,
    startDate: inj.startDate ? new Date(inj.startDate) : now,
    ...(inj.affectedSide ?? side ? { affectedSide: inj.affectedSide ?? side } : {}),
  };
}
