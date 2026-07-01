'use client';

import Link from 'next/link';
import { IconBarbell } from '@tabler/icons-react';

/** Summary of today's workout session shown on the dashboard. */
export interface TodaysWorkout {
  id: string;
  name: string;
  state: 'planned' | 'in_progress' | 'completed';
  exercises: number;
  completedSets: number;
  totalSets: number;
}

interface TodayHeroCardProps {
  workout: TodaysWorkout;
  /** Name of the active mesocycle, appended to the "Today" label when present. */
  mesocycleName: string | null;
}

/**
 * Today's workout hero — the primary daily action at the top of the glance
 * summary. Covers all three states: ready / in-progress / completed.
 */
export function TodayHeroCard({ workout, mesocycleName }: TodayHeroCardProps) {
  return (
    <Link href={`/dashboard/workout/${workout.id}`} className="block">
      <div className={`rounded-2xl p-4 border transition-colors ${
        workout.state === 'completed'
          ? 'bg-success-500/10 border-success-500/20'
          : workout.state === 'in_progress'
          ? 'bg-warning-500/10 border-warning-500/20'
          : 'bg-primary-500/10 border-primary-500/20 hover:bg-primary-500/15'
      }`}>
        <div className="flex items-center gap-2 text-sm mb-1 text-primary-400">
          <IconBarbell size={16} aria-hidden="true" />
          <span>Today{mesocycleName ? ` · ${mesocycleName}` : ''}</span>
        </div>
        <div className="text-base font-medium text-surface-100 mb-3">
          {workout.exercises} exercises · {workout.completedSets}/{workout.totalSets} sets
        </div>
        <div className={`w-full py-2.5 rounded-lg text-center text-sm font-semibold text-white ${
          workout.state === 'completed' ? 'bg-success-500' : 'bg-primary-500'
        }`}>
          {workout.state === 'completed' ? 'View workout' : workout.state === 'in_progress' ? 'Continue workout' : 'Start workout'}
        </div>
      </div>
    </Link>
  );
}
