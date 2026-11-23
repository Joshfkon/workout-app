import type { LivePr } from '@/services/livePrDetector';

/**
 * Title + detail for the in-workout PR popup. Plain words lead and the
 * technical term rides along (UX panel: a beginner met "New e1RM PR" with no
 * idea what an e1RM was). Pure — the caller formats loads in its own units.
 */
export function prCelebrationCopy(
  pr: LivePr,
  fmtKg: (kg: number) => string,
  options: { beginner?: boolean } = {}
): { title: string; detail: string } {
  const pct = pr.improvement > 0 ? ` · +${pr.improvement}%` : '';
  switch (pr.type) {
    case 'e1rm':
      return {
        title: 'New strength record',
        // Beginner mode drops the term entirely: "estimated max" is the
        // whole idea, the abbreviation adds nothing for a first-week lifter.
        detail: options.beginner
          ? `Your estimated max is up: ${fmtKg(pr.value)}${pct}`
          : `Est. 1-rep max (e1RM) ${fmtKg(pr.value)}${pct}`,
      };
    case 'weight':
      return { title: 'New weight record', detail: `Heaviest yet: ${fmtKg(pr.value)}${pct}` };
    case 'reps':
      return {
        title: 'New reps record',
        detail: `${pr.value} reps${pr.improvement > 0 ? ` · +${pr.improvement}` : ''}`,
      };
    case 'duration':
      return {
        title: 'New hold record',
        detail: `${pr.value}s${pr.improvement > 0 ? ` · +${pr.improvement}s` : ''}`,
      };
  }
}
