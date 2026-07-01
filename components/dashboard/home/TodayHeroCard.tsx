'use client';

import Link from 'next/link';
import { IconBarbell, IconSparkles } from '@tabler/icons-react';
import { FirstTimeHint } from '@/components/ui';

/** Summary of today's workout session shown on the dashboard. */
export interface TodaysWorkout {
  id: string;
  name: string;
  state: 'planned' | 'in_progress' | 'completed';
  exercises: number;
  completedSets: number;
  totalSets: number;
}

/** A split-day scheduled for today when no session has been generated yet. */
export interface ScheduledWorkoutSummary {
  dayName: string;
  muscles: string[];
}

interface TodayHeroCardProps {
  /** Today's session, if one exists (ready / in-progress / completed states). */
  workout: TodaysWorkout | null;
  /** Scheduled split day for today when there's a plan but no session yet. */
  scheduled?: ScheduledWorkoutSummary | null;
  /** Whether the user has an active mesocycle at all (false = "no plan" state). */
  hasPlan: boolean;
  /** Name of the active mesocycle, appended to the "Today" label when present. */
  mesocycleName: string | null;
  /**
   * One-line coach note derived from session data (block suggestion reasons or
   * the muscle focus list). Pure derivation upstream — never an AI API call.
   */
  coachLine?: string | null;
}

/** Divider + sparkles coach line rendered below the hero CTA. */
function CoachLine({ text }: { text: string }) {
  return (
    <div className="border-t border-surface-800 mt-3 pt-2 flex items-start gap-1.5 text-xs text-surface-400">
      <IconSparkles size={14} className="flex-shrink-0 mt-0.5 text-primary-400" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/**
 * Today's workout hero — the primary daily action at the top of the home page.
 * States: ready / in-progress / completed (session), scheduled (plan but no
 * session yet), no plan (first-time CTA). Renders nothing on a rest day.
 */
export function TodayHeroCard({ workout, scheduled, hasPlan, mesocycleName, coachLine }: TodayHeroCardProps) {
  if (workout) {
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
          {coachLine && <CoachLine text={coachLine} />}
        </div>
      </Link>
    );
  }

  if (scheduled) {
    return (
      <Link href="/dashboard/mesocycle" className="block">
        <div className="rounded-2xl p-4 border bg-primary-500/10 border-primary-500/20 hover:bg-primary-500/15 transition-colors">
          <div className="flex items-center gap-2 text-sm mb-1 text-primary-400">
            <IconBarbell size={16} aria-hidden="true" />
            <span>Today{mesocycleName ? ` · ${mesocycleName}` : ''}</span>
          </div>
          <div className="text-base font-medium text-surface-100 mb-3">
            {scheduled.dayName}
          </div>
          <div className="w-full py-2.5 rounded-lg text-center text-sm font-semibold text-white bg-primary-500">
            Start workout
          </div>
          {coachLine && <CoachLine text={coachLine} />}
        </div>
      </Link>
    );
  }

  if (!hasPlan) {
    return (
      <div className="relative rounded-2xl p-4 border bg-primary-500/10 border-primary-500/20">
        <FirstTimeHint
          id="dashboard-mesocycle-intro"
          title="What's a Mesocycle?"
          description="A mesocycle is a training block (usually 4-8 weeks) where you progressively challenge your muscles, then take a recovery week. This structured approach is proven to build more muscle than random workouts!"
          position="top"
        />
        <div className="flex items-center gap-2 text-sm mb-1 text-primary-400">
          <IconBarbell size={16} aria-hidden="true" />
          <span>Today</span>
        </div>
        <div className="text-base font-medium text-surface-100">No training plan yet</div>
        <p className="text-xs text-surface-400 mt-1 mb-3">
          Plan a mesocycle for smart progression and volume tracking, or jump straight into a workout.
        </p>
        <div className="flex gap-2">
          <Link href="/dashboard/mesocycle/new" className="flex-1">
            <span className="block w-full py-2.5 rounded-lg text-center text-sm font-semibold text-white bg-primary-500 hover:bg-primary-400 transition-colors">
              Plan a mesocycle
            </span>
          </Link>
          <Link href="/dashboard/workout/quick" className="flex-1">
            <span className="block w-full py-2.5 rounded-lg text-center text-sm font-semibold text-surface-200 bg-surface-800 hover:bg-surface-700 transition-colors">
              Quick workout
            </span>
          </Link>
        </div>
      </div>
    );
  }

  // Rest day within an active plan — no hero (Train tab covers ad-hoc sessions).
  return null;
}
