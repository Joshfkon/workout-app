'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  computeWeeklyMuscleVolume,
  computeWeeklyMevSummary,
  type WeeklyMevSummary as WeeklyMevSummaryData,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
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
  const [summary, setSummary] = useState<WeeklyMevSummaryData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 6);

        const { data } = await supabase
          .from('exercise_blocks')
          .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup),
            workout_sessions!inner (user_id, completed_at, state)`)
          .eq('workout_sessions.user_id', user.id)
          .eq('workout_sessions.state', 'completed')
          .gte('workout_sessions.completed_at', weekStart.toISOString());

        if (cancelled) return;
        setSummary(computeWeeklyMevSummary(computeWeeklyMuscleVolume((data as any) || [])));
      } catch (err) {
        console.error('Failed to load weekly MEV summary:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
