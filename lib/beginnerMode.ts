/**
 * Beginner mode: pure helpers behind hooks/useBeginnerMode.
 *
 * Beginner mode only changes WORDING and what is shown. Every number still
 * comes from the engine untouched: these helpers rephrase or hide, they never
 * compute a target.
 */

import {
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';

/** users.preferences key. */
export const BEGINNER_MODE_PREFERENCE_KEY = 'beginnerMode';

/** Copy for the Settings / onboarding switch. */
export const BEGINNER_MODE_TITLE = 'Beginner mode';
export const BEGINNER_MODE_DESCRIPTION =
  'A simpler workout screen: effort in plain words, fewer numbers and charts. Your plan stays the same.';

/**
 * The stored choice wins; with none, beginners (novice experience, which is
 * also what "Under 1 year" and "No, food tracking" sign up as) start with it
 * on and everyone else off.
 */
export function resolveBeginnerMode(stored: unknown, experience: string | null | undefined): boolean {
  if (typeof stored === 'boolean') return stored;
  return defaultBeginnerMode(experience);
}

export function defaultBeginnerMode(experience: string | null | undefined): boolean {
  return experience === 'novice' || experience === 'none' || experience === 'beginner';
}

function reps(n: number): string {
  return `${n} rep${n === 1 ? '' : 's'}`;
}

/** A target effort in words: "stop 2 reps short of failure". */
export function effortTargetPhrase(rir: number): string {
  const n = Math.round(rir);
  if (n <= 0) return 'go until you can’t do another rep';
  if (n >= 4) return 'stop 4 or more reps short of failure';
  return `stop ${reps(n)} short of failure`;
}

/** How much is left, in words: "about 1 more rep in you". */
export function effortLeftPhrase(rir: number): string {
  const n = Math.round(rir);
  if (n <= 0) return 'no more reps in you';
  return `about ${n} more rep${n === 1 ? '' : 's'} in you`;
}

/**
 * Replace RIR shorthand in an engine-written explanation line with words.
 * "8 reps @ 2 RIR vs 3 target" → "8 reps with 2 reps left vs 3 target".
 */
export function plainRirText(text: string): string {
  return text
    .replace(/\s*\((?:RIR|RIR \d+(?:\.\d+)?)\)/g, '')
    .replace(/@\s*(\d+(?:\.\d+)?\+?)\s*RIR\b/g, (_m, n: string) => `with ${repsLeft(n)}`)
    .replace(/(≥\s*)?(\d+(?:\.\d+)?\+?)\s*RIR\b/g, (_m, ge: string | undefined, n: string) =>
      `${ge ?? ''}${repsLeft(n)}`
    )
    .replace(/\bRIR\s*(\d+(?:\.\d+)?)/g, (_m, n: string) => repsLeft(n))
    .replace(/\bRIR\b/g, 'reps left')
    .replace(/\s+in the tank\b/g, ' in you')
    .replace(/\bleft in reserve\b/g, 'left')
    .replace(/\bleaving (\d+\+?) in reserve\b/g, (_m, n: string) =>
      `stopping ${n} rep${n === '1' ? '' : 's'} short of failure`
    )
    .replace(/\s+in reserve\b/g, ' left');
}

function repsLeft(n: string): string {
  return `${n} rep${n === '1' ? '' : 's'} left`;
}

/**
 * Everyday names for muscles whose display name is gym jargon. Anything not
 * listed keeps its display name (Chest, Biceps, Abs …).
 */
const PLAIN_MUSCLE_NAMES: Partial<Record<StandardMuscleGroup, string>> = {
  chest_upper: 'Upper chest',
  chest_lower: 'Lower chest',
  front_delts: 'Front shoulders',
  lateral_delts: 'Side shoulders',
  rear_delts: 'Rear shoulders',
  rotator_cuff: 'Rotator cuff',
  lats: 'Back (lats)',
  upper_back: 'Upper back',
  upper_traps: 'Traps',
  mid_lower_traps: 'Mid back',
  triceps_long: 'Triceps',
  triceps_lat_med: 'Triceps',
  quads: 'Front thighs',
  hamstrings: 'Back of thighs',
  glute_med: 'Side glutes',
  adductors: 'Inner thighs',
  gastrocnemius: 'Calves',
  soleus: 'Calves',
  obliques: 'Side abs',
  erectors: 'Lower back',
};

export function beginnerMuscleName(muscle: StandardMuscleGroup | string): string {
  return (
    PLAIN_MUSCLE_NAMES[muscle as StandardMuscleGroup] ??
    STANDARD_MUSCLE_DISPLAY_NAMES[muscle as StandardMuscleGroup] ??
    muscle
  );
}

/** Swap every jargon muscle display name in a sentence for its plain name. */
function plainMuscleNamesIn(text: string): string {
  let out = text;
  // Longest first so "Triceps Long Head" wins over "Triceps".
  const entries = (Object.keys(PLAIN_MUSCLE_NAMES) as StandardMuscleGroup[])
    .map((m) => [STANDARD_MUSCLE_DISPLAY_NAMES[m], PLAIN_MUSCLE_NAMES[m]!] as const)
    .filter(([from, to]) => from && from !== to)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    out = out
      .replace(new RegExp(`\\b${escaped}\\b`, 'g'), to)
      .replace(new RegExp(`\\b${escaped.toLowerCase()}\\b`, 'g'), to.toLowerCase());
  }
  return out;
}

/**
 * The AI-suggested workout's headline (services/suggestedWorkout buildFocus /
 * light-session copy) in beginner words: plain muscle names, "behind this
 * week" instead of weekly-sets accounting, no MRV.
 */
export function beginnerSuggestedFocus(focus: string): string {
  return plainMuscleNamesIn(focus)
    .replace(/furthest behind on this week[’']s sets/g, 'behind this week')
    .replace(
      /^Light technique session — .*$/,
      'Light session: you’ve already trained a lot this week, so today stays easy on purpose.'
    )
    .replace(
      /^All under-target muscles are at their weekly recoverable maximum \(MRV\).*$/,
      'You’ve trained a lot this week. Rest, stretch, or do light cardio today.'
    );
}

/**
 * One pick's reason line in beginner words. "Side Delts: 2 of 10 weekly sets
 * done" → "Side shoulders: behind this week".
 */
export function beginnerPickReason(reason: string, muscle: StandardMuscleGroup | string): string {
  const name = beginnerMuscleName(muscle);
  if (/weekly sets? done/.test(reason)) {
    return /almost recovered/.test(reason)
      ? `${name}: behind this week, almost recovered`
      : `${name}: behind this week`;
  }
  if (/near weekly max/.test(reason)) return `${name}: light technique work only`;
  return plainMuscleNamesIn(reason);
}

/**
 * plainRirText plus the other workout-screen jargon a first-week lifter
 * meets in engine-written lines: e1RM / 1RM, AMRAP, RPE, MEV / MRV.
 * Wording only — every number in the line is kept as written.
 */
export function plainWorkoutText(text: string): string {
  return plainRirText(text)
    .replace(/\s*\(AMRAP\)/g, '')
    .replace(/\bAMRAP\b/g, 'as many reps as you can')
    .replace(/\bEst\.?\s*1-rep max\s*\(e1RM\)/gi, 'Estimated max')
    .replace(/\bestimated 1RM\b/gi, 'estimated max')
    .replace(/\best\.\s*1RM\b/gi, 'estimated max')
    .replace(/\be1RM\b/gi, 'estimated max')
    .replace(/\b1RM\b/g, 'one-rep max')
    .replace(/\bRPE (\d+(?:\.\d+)?)/g, (_m, n: string) => `effort ${n}/10`)
    .replace(/\bRPE\b/g, 'effort')
    .replace(/\s*\((?:MEV|MRV|MAV)\)/g, '')
    .replace(/\bMEV\b/g, 'minimum')
    .replace(/\bMRV\b/g, 'weekly maximum')
    .replace(/\bMAV\b/g, 'best range');
}

/**
 * Beginner mode's effort question: three plain answers instead of the five
 * numbered chips. Each answer logs an EXISTING chip value, so the engine and
 * the rirSource rules see exactly what a five-chip tap would produce:
 *   - "That was hard"      → 1 (the "hard" chip)
 *   - "A couple more"      → 2 (the "good" chip; literally two left)
 *   - "Could do lots more" → 4 (the "4+ / cruise" chip)
 * 0 ("maxed") and 3 ("easy") are not offered: a first-week lifter rarely
 * reaches true failure and can't tell 3 from 4. A preset value (the target,
 * or a sensor estimate) of 0 or 3 is still logged exactly as-is while
 * untouched — only the highlight rounds it to the nearest answer.
 */
export const BEGINNER_EFFORT_CHOICES: ReadonlyArray<{ rir: 1 | 2 | 4; label: string }> = [
  { rir: 1, label: 'That was hard' },
  { rir: 2, label: 'A couple more' },
  { rir: 4, label: 'Could do lots more' },
];

/** Which beginner answer a 0–4 chip value shows as selected. */
export function beginnerEffortChoiceFor(rir: number): 1 | 2 | 4 {
  if (rir <= 1) return 1;
  if (rir >= 4) return 4;
  return 2;
}
