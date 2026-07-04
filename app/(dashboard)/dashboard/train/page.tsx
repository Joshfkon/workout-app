'use client';

/**
 * /dashboard/train — the Train tab's dashboard.
 *
 * Hub for exercise-related functions: quick access to starting a workout
 * (via the /dashboard/log launcher), the training tools (mesocycle plan,
 * history, templates, exercise library), this week's volume, and muscle
 * recovery. The launcher itself stays on /dashboard/log so the app can land
 * there on startup.
 */

import Link from 'next/link';
import {
  IconBarbell,
  IconCalendarStats,
  IconChevronRight,
  IconHistory,
  IconListDetails,
  IconTemplate,
} from '@tabler/icons-react';
import { MuscleRecoveryCard } from '@/components/dashboard/MuscleRecoveryCard';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';

const TRAINING_TOOLS = [
  {
    name: 'Mesocycle plan',
    description: 'Your program, week by week',
    href: '/dashboard/mesocycle',
    icon: IconCalendarStats,
  },
  {
    name: 'History',
    description: 'Past workouts and sessions',
    href: '/dashboard/history',
    icon: IconHistory,
  },
  {
    name: 'Templates',
    description: 'Saved and shared workouts',
    href: '/dashboard/templates',
    icon: IconTemplate,
  },
  {
    name: 'Exercises',
    description: 'Browse the exercise library',
    href: '/dashboard/exercises',
    icon: IconListDetails,
  },
];

export default function TrainPage() {
  const { summary, isLoading: volumeLoading } = useWeeklyVolume();

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Slim header */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-[17px] font-medium text-surface-100">Train</h1>
      </div>

      {/* Start a workout: hands off to the launcher on /dashboard/log */}
      <Link
        href="/dashboard/log"
        className="w-full flex items-center gap-3 p-4 rounded-xl bg-primary-500/10 border border-primary-500/30 text-left hover:bg-primary-500/15 transition-colors"
      >
        <IconBarbell size={20} className="text-primary-400 flex-shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-medium text-primary-300">Start a workout</span>
          <span className="block text-[12px] text-surface-500">
            Mesocycle, blank, or AI suggested
          </span>
        </span>
        <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* Training tools */}
      <div className="grid grid-cols-2 gap-2">
        {TRAINING_TOOLS.map((tool) => {
          const ToolIcon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex flex-col gap-2 p-3.5 rounded-xl bg-surface-900 border border-surface-800 hover:bg-surface-800/70 transition-colors"
            >
              <ToolIcon size={18} className="text-surface-400" aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-medium text-surface-200">{tool.name}</span>
                <span className="block text-[11px] text-surface-500 mt-0.5">
                  {tool.description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

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
    </div>
  );
}
