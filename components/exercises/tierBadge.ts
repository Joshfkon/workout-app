/**
 * Hypertrophy tier badge colours (S best … F worst) on the design tokens.
 * The tier is a ranking, so it reads as accent → green → accent tint →
 * neutral → amber → red rather than one hue per letter.
 */
export function tierBadgeClasses(tier: string | null | undefined): string {
  switch (tier) {
    case 'S':
      return 'bg-action text-on-action';
    case 'A':
      return 'bg-status-ok-tint text-status-ok';
    case 'B':
      return 'bg-action-tint text-action';
    case 'D':
      return 'bg-status-warn-tint text-status-warn';
    case 'F':
      return 'bg-status-bad-tint text-status-bad';
    default:
      return 'bg-fill text-ink-2';
  }
}

/** A 1–5 rating's fill colour: strong (≥4), fine (3), weak (≤2). */
export function ratingFillClass(value: number): string {
  if (value >= 4) return 'bg-status-ok';
  if (value >= 3) return 'bg-action';
  return 'bg-status-warn';
}
