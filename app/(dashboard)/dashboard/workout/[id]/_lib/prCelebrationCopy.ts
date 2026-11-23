import type { LivePr } from '@/services/livePrDetector';

/**
 * Title + detail for the in-workout PR popup. Plain words lead and the
 * technical term rides along (UX panel: a beginner met "New e1RM PR" with no
 * idea what an e1RM was). The detail always says what was beaten — a lifter
 * shown "+1%" alone asked "a PR compared to what?" and doubted it.
 * Pure — the caller formats loads in its own units.
 */
export function prCelebrationCopy(
  pr: LivePr,
  fmtKg: (kg: number) => string,
  options: { beginner?: boolean; set?: { weightKg: number; repCount: number } } = {}
): { title: string; detail: string } {
  const has = (n: number | undefined): n is number => typeof n === 'number' && n > 0;
  switch (pr.type) {
    case 'e1rm': {
      // The set that earned it, so the estimate has a source.
      const from = options.set ? `${fmtKg(options.set.weightKg)} × ${options.set.repCount} → ` : '';
      const was = has(pr.previous) ? ` (was ${fmtKg(pr.previous)})` : '';
      return {
        title: 'New strength record',
        // Beginner mode drops the term entirely: "estimated max" is the
        // whole idea, the abbreviation adds nothing for a first-week lifter.
        detail: options.beginner
          ? `${from}estimated max ${fmtKg(pr.value)}${was}`
          : `${from}est. 1-rep max (e1RM) ${fmtKg(pr.value)}${was}`,
      };
    }
    case 'weight':
      return {
        title: 'New weight record',
        detail: `Heaviest yet: ${fmtKg(pr.value)}${has(pr.previous) ? ` (was ${fmtKg(pr.previous)})` : ''}`,
      };
    case 'reps':
      return {
        title: 'New reps record',
        detail: `${pr.value} reps${has(pr.previous) ? ` (was ${pr.previous})` : ''}`,
      };
    case 'duration':
      return {
        title: 'New hold record',
        detail: `${pr.value}s${has(pr.previous) ? ` (was ${pr.previous}s)` : ''}`,
      };
  }
}
