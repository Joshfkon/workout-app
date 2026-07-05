'use client';

/**
 * /dashboard/train — the Train tab's dashboard.
 *
 * A training-focused overview: continue/start a workout, where you are in
 * the active mesocycle, this week's volume, muscle recovery, and recent
 * workouts. The workout launcher itself stays on /dashboard/log (the app's
 * startup surface); this page hands off to it for starting sessions.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  IconBarbell,
  IconCalendarStats,
  IconChevronRight,
  IconHistory,
  IconListDetails,
  IconTemplate,
} from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { getWorkoutForDay, type TodayWorkout } from '@/lib/training/startMesocycleSession';
import { MuscleRecoveryCard } from '@/components/dashboard/MuscleRecoveryCard';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';
import type { WorkoutDay } from '@/types/schema';

interface InProgressSummary {
  id: string;
  name: string;
}

interface ActiveMesoSummary {
  id: string;
  name: string;
  current_week: number;
  total_weeks: number;
  deload_week: number;
  split_type: string;
  days_per_week: number;
  preferred_workout_days: WorkoutDay[] | null;
}

interface RecentWorkout {
  id: string;
  completedAt: Date;
  name: string;
  setCount: number;
}

interface RecentSessionRow {
  id: string;
  completed_at: string;
  mesocycles: { name: string } | { name: string }[] | null;
  exercise_blocks: { set_logs: { is_warmup: boolean | null }[] | null }[] | null;
}

export default function TrainPage() {
  const supabase = createUntypedClient();
  const { summary, isLoading: volumeLoading } = useWeeklyVolume();

  const [inProgress, setInProgress] = useState<InProgressSummary | null>(null);
  const [activeMeso, setActiveMeso] = useState<ActiveMesoSummary | null>(null);
  const [recentWorkouts, setRecentWorkouts] = useState<RecentWorkout[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = getLocalDateString();
        const [inProgressRes, mesoRes, recentRes] = await Promise.all([
          supabase
            .from('workout_sessions')
            .select('id, mesocycles(name)')
            .eq('user_id', user.id)
            .eq('planned_date', today)
            .eq('state', 'in_progress')
            .limit(1),
          supabase
            .from('mesocycles')
            .select('id, name, current_week, total_weeks, deload_week, split_type, days_per_week, preferred_workout_days')
            .eq('user_id', user.id)
            .eq('state', 'active')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('workout_sessions')
            .select('id, completed_at, mesocycles(name), exercise_blocks(set_logs(is_warmup))')
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .order('completed_at', { ascending: false })
            .limit(3),
        ]);

        const ipRow = inProgressRes.data?.[0];
        if (ipRow) {
          const mesoRel = ipRow.mesocycles as { name: string } | { name: string }[] | null;
          const mesoName = Array.isArray(mesoRel) ? mesoRel[0]?.name : mesoRel?.name;
          setInProgress({ id: ipRow.id, name: mesoName || 'workout' });
        }

        setActiveMeso((mesoRes.data?.[0] ?? null) as ActiveMesoSummary | null);

        setRecentWorkouts(
          ((recentRes.data ?? []) as RecentSessionRow[]).map((row) => {
            const mesoRel = row.mesocycles;
            const mesoName = Array.isArray(mesoRel) ? mesoRel[0]?.name : mesoRel?.name;
            const setCount = (row.exercise_blocks ?? []).reduce(
              (sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length,
              0
            );
            return {
              id: row.id,
              completedAt: new Date(row.completed_at),
              name: mesoName || 'Workout',
              setCount,
            };
          })
        );
      } catch (err) {
        console.error('Failed to load train dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Today's scheduled workout (and the next one, for rest days).
  const { todayWorkout, nextWorkout } = useMemo((): {
    todayWorkout: TodayWorkout | null;
    nextWorkout: TodayWorkout | null;
  } => {
    if (!activeMeso) return { todayWorkout: null, nextWorkout: null };
    const todayDow = new Date().getDay() || 7;
    const workoutFor = (dow: number) =>
      getWorkoutForDay(
        activeMeso.split_type,
        dow,
        activeMeso.days_per_week,
        activeMeso.preferred_workout_days
      );
    const todays = workoutFor(todayDow);
    if (todays) return { todayWorkout: todays, nextWorkout: null };
    for (let offset = 1; offset <= 7; offset++) {
      const next = workoutFor(((todayDow - 1 + offset) % 7) + 1);
      if (next) return { todayWorkout: null, nextWorkout: next };
    }
    return { todayWorkout: null, nextWorkout: null };
  }, [activeMeso]);

  const startSubtitle = isLoading
    ? 'Loading...'
    : !activeMeso
      ? 'Mesocycle, blank, or AI suggested'
      : todayWorkout
        ? `Today: ${todayWorkout.dayName}`
        : `Rest day · next: ${nextWorkout?.dayName ?? 'view plan'}`;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Slim header */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-[17px] font-medium text-surface-100">Train</h1>
      </div>

      {/* Continue card (only when a session is in progress today) */}
      {inProgress && (
        <Link
          href={`/dashboard/workout/${inProgress.id}`}
          className="w-full flex items-center gap-3 p-3 rounded-xl bg-warning-500/10 border border-warning-500/30 text-left hover:bg-warning-500/15 transition-colors"
        >
          <IconBarbell size={18} className="text-warning-400 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-medium text-warning-300 truncate">
              Continue {inProgress.name}
            </span>
          </span>
          <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
        </Link>
      )}

      {/* Start a workout: hands off to the launcher on /dashboard/log */}
      <Link
        href="/dashboard/log"
        className="w-full flex items-center gap-3 p-4 rounded-xl bg-primary-500/10 border border-primary-500/30 text-left hover:bg-primary-500/15 transition-colors"
      >
        <IconBarbell size={20} className="text-primary-400 flex-shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-medium text-primary-300">Start a workout</span>
          <span className="block text-[12px] text-surface-500 truncate">{startSubtitle}</span>
        </span>
        <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* Mesocycle status */}
      <Link
        href="/dashboard/mesocycle"
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors"
      >
        <IconCalendarStats size={18} className="text-surface-400 flex-shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium text-surface-200 truncate">
            {activeMeso ? activeMeso.name : 'Mesocycle plan'}
          </span>
          <span className="block text-[11px] text-surface-500 mt-0.5">
            {isLoading
              ? 'Loading...'
              : activeMeso
                ? `Week ${activeMeso.current_week} of ${activeMeso.total_weeks}${
                    activeMeso.current_week === activeMeso.deload_week ? ' · deload' : ''
                  }`
                : 'No active mesocycle — plan one'}
          </span>
        </span>
        <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* This week's volume at a glance */}
      <Link
        href="/dashboard/volume"
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium text-surface-200">This week&apos;s volume</span>
          <span className="block text-[11px] text-surface-500 mt-0.5">
            {volumeLoading
              ? 'Loading...'
              : summary.totalSets === 0
                ? 'No sets logged yet this week'
                : `${summary.totalSets} sets · ${
                    summary.musclesBelowMev.length === 0
                      ? 'all muscle groups at target'
                      : `${summary.musclesBelowMev.length} muscle ${
                          summary.musclesBelowMev.length === 1 ? 'group' : 'groups'
                        } below minimum`
                  }`}
          </span>
        </span>
        <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* Muscle recovery */}
      <MuscleRecoveryCard compact limit={6} />

      {/* Recent workouts */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-[13px] font-medium text-surface-300">Recent workouts</h2>
          <Link
            href="/dashboard/history"
            className="text-[11px] text-primary-400 hover:text-primary-300 transition-colors"
          >
            View all
          </Link>
        </div>
        {isLoading ? (
          <div className="p-3.5 rounded-xl bg-surface-900 border border-surface-800 text-[12px] text-surface-500">
            Loading...
          </div>
        ) : recentWorkouts.length === 0 ? (
          <div className="p-3.5 rounded-xl bg-surface-900 border border-surface-800 text-[12px] text-surface-500">
            No completed workouts yet — start one above.
          </div>
        ) : (
          <div className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden">
            {recentWorkouts.map((workout) => (
              <Link
                key={workout.id}
                href="/dashboard/history"
                className="flex items-center gap-3 px-3.5 py-3 border-b border-surface-800/50 last:border-b-0 hover:bg-surface-800/70 transition-colors"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-surface-200 truncate">{workout.name}</span>
                  <span className="block text-[11px] text-surface-500 mt-0.5">
                    {workout.completedAt.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' · '}
                    {workout.setCount} {workout.setCount === 1 ? 'set' : 'sets'}
                  </span>
                </span>
                <IconChevronRight size={14} className="text-surface-600 flex-shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Tools */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { name: 'History', href: '/dashboard/history', icon: IconHistory },
          { name: 'Templates', href: '/dashboard/templates', icon: IconTemplate },
          { name: 'Exercises', href: '/dashboard/exercises', icon: IconListDetails },
        ].map((tool) => {
          const ToolIcon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-surface-900 border border-surface-800 hover:bg-surface-800/70 transition-colors"
            >
              <ToolIcon size={16} className="text-surface-400" aria-hidden="true" />
              <span className="text-[11px] font-medium text-surface-300">{tool.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
