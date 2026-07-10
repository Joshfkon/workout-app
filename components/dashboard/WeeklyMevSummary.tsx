'use client';

import { Card } from '@/components/ui/Card';
import { useWeeklyMevSummary } from '@/hooks/useWeeklyMevSummary';
import { STANDARD_MUSCLE_DISPLAY_NAMES, type StandardMuscleGroup } from '@/types/schema';

function muscleDisplayName(muscle: string): string {
  return (
    STANDARD_MUSCLE_DISPLAY_NAMES[muscle as StandardMuscleGroup] ??
    muscle.charAt(0).toUpperCase() + muscle.slice(1).replace(/_/g, ' ')
  );
}

/**
 * "This week vs MEV" header for the volume page — the detail view behind the
 * home "Weekly volume" glance tile and the wk-1 ramp banner. Runs the SAME
 * query window + shared pipeline (computeWeeklyMuscleVolume →
 * computeWeeklyMevSummary) as the tile, so "117/88 sets · 6 below MEV" on the
 * dashboard is exactly what this card shows, with the below-MEV muscles
 * flagged at the top.
 */
export function WeeklyMevSummary() {
  // Shared rolling-7-day source — the same hook the volume page feeds into the
  // "Insufficient Volume" atrophy-risk warning, so the two cards can't diverge.
  const { summary, loaded } = useWeeklyMevSummary();

  if (!loaded) {
    return <Card className="p-4 mb-6 h-24 animate-pulse" aria-hidden="true"><div /></Card>;
  }
  if (!summary) return null;

  const below = summary.entries.filter((e) => e.belowMev);

  return (
    <Card id="weekly-mev" className="p-4 mb-6 scroll-mt-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-surface-100">This Week vs MEV</h3>
        <span className="text-sm text-surface-300">
          <span className="font-semibold text-surface-100">{summary.totalSets}</span>
          <span className="text-surface-500"> / {summary.totalTarget} sets</span>
        </span>
      </div>
      <p className={`text-xs mb-3 ${summary.lowCount > 0 ? 'text-warning-400' : 'text-success-400'}`}>
        {summary.lowCount > 0
          ? `${summary.lowCount} muscle${summary.lowCount === 1 ? '' : 's'} below minimum effective volume (rolling 7 days)`
          : 'All muscles at or above minimum effective volume (rolling 7 days)'}
      </p>
      {below.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {below.map((entry) => (
            <span
              key={entry.muscle}
              className="inline-flex items-center gap-1 rounded-full bg-warning-500/10 border border-warning-500/20 px-2 py-0.5 text-[11px] text-warning-300"
            >
              {muscleDisplayName(entry.muscle)}
              <span className="text-warning-400/70">
                {entry.sets}/{entry.mev}
              </span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
