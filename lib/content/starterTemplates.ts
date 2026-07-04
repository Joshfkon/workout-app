import type { MuscleGroup } from '@/types/schema';

/**
 * Curated starter workout templates for users who haven't built their own
 * yet (P2-15). These are NOT database rows — each is a preset that deep-links
 * into the existing new-workout flow (`/dashboard/workout/new?template=…&
 * muscles=…`), which pre-selects the muscles and jumps to exercise selection.
 * No schema, no seeding, no writes until the user actually starts a session.
 *
 * Muscle lists use canonical `MUSCLE_GROUPS` values so they map straight onto
 * the new-workout muscle pre-selection.
 */
export interface StarterTemplate {
  /** Stable id (used for React keys / analytics), not a DB id. */
  id: string;
  /** Display name; also passed through as the `template` query param. */
  name: string;
  /** One-line description of who the split suits. */
  description: string;
  /** Emoji glyph for the card. */
  emoji: string;
  /** Canonical muscle groups this day targets. */
  muscles: MuscleGroup[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'full-body',
    name: 'Full Body',
    description: 'Hit everything in one session — ideal 2–3×/week.',
    emoji: '🏋️',
    muscles: ['chest', 'back', 'quads', 'shoulders', 'hamstrings'],
  },
  {
    id: 'push',
    name: 'Push',
    description: 'Chest, shoulders, triceps — the pressing muscles.',
    emoji: '💪',
    muscles: ['chest', 'shoulders', 'triceps'],
  },
  {
    id: 'pull',
    name: 'Pull',
    description: 'Back and biceps — everything you row and curl.',
    emoji: '🎯',
    muscles: ['back', 'biceps', 'forearms'],
  },
  {
    id: 'legs',
    name: 'Legs',
    description: 'Quads, hamstrings, glutes, calves — full lower body.',
    emoji: '🦵',
    muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
  },
  {
    id: 'upper',
    name: 'Upper Body',
    description: 'Chest, back, shoulders, arms in one upper session.',
    emoji: '🔼',
    muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
  },
  {
    id: 'lower',
    name: 'Lower Body',
    description: 'Legs and glutes — the lower half of an upper/lower split.',
    emoji: '🔽',
    muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
  },
];

/** Build the new-workout deep link for a starter template. */
export function starterTemplateHref(t: StarterTemplate): string {
  const params = new URLSearchParams({
    template: t.name,
    muscles: t.muscles.join(','),
  });
  return `/dashboard/workout/new?${params.toString()}`;
}
