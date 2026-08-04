'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconSparkles } from '@tabler/icons-react';
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

/** "Log dinner" hero content when the next best action is a meal, not a workout. */
export interface MealHeroSuggestion {
  /** e.g. "Log dinner" */
  title: string;
  /** Current time for the eyebrow, e.g. "6:58 PM" */
  timeLabel: string;
  /** e.g. "1,888 kcal and 135g protein still to go — you're behind pace" */
  meta: string;
}

interface TodayHeroCardProps {
  /** Today's session, if one exists (ready / in-progress / completed states). */
  workout: TodaysWorkout | null;
  /** Today's split day (title + target muscles); also drives the plan-but-no-session state. */
  scheduled?: ScheduledWorkoutSummary | null;
  /** Whether the user has an active mesocycle at all (false = "no plan" state). */
  hasPlan: boolean;
  /** Name of the active mesocycle, the title fallback when no split day is known. */
  mesocycleName: string | null;
  /** Eyebrow context after "Next up ·", e.g. "Arnold wk 1". */
  eyebrowContext?: string | null;
  /** Meta line for a ready workout, e.g. "7 exercises · est. 65 min · all target muscles recovered". */
  workoutMeta?: string | null;
  /** Meal suggestion — shown when there's no pending workout (done or rest day). */
  meal?: MealHeroSuggestion | null;
  /** Opens the quick food logger (meal hero CTA). */
  onLogFood?: () => void;
  /**
   * One-line coach note derived from session data (block suggestion reasons or
   * the muscle focus list). Pure derivation upstream — never an AI API call.
   */
  coachLine?: string | null;
}

/**
 * Quiet links under the hero CTA. "More options" → the Train tab, the
 * permanent home for every workout start (empty / AI-suggested / repeat);
 * "See the plan" → the read-only mesocycle preview, so the hero's Start CTA
 * is never the only way to find out what today's session contains. Rendered
 * OUTSIDE the card because the workout hero states wrap the whole card in a
 * Link (nested anchors are invalid HTML). Deliberately not buttons — the hero
 * keeps its single Start CTA.
 */
function MoreOptionsLink({ showPlanLink = false }: { showPlanLink?: boolean }) {
  return (
    <div className="mt-1.5 flex items-center justify-center gap-3 text-xs text-surface-500">
      {showPlanLink && (
        <>
          <Link
            href="/dashboard/mesocycle/plan"
            className="hover:text-surface-300 transition-colors"
          >
            See the plan
          </Link>
          <span aria-hidden="true">·</span>
        </>
      )}
      <Link href="/dashboard/train" className="hover:text-surface-300 transition-colors">
        More options
      </Link>
    </div>
  );
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

/** Shared hero layout: eyebrow · big title · meta line · full-width CTA. */
function HeroShell({
  eyebrow,
  eyebrowClass,
  title,
  meta,
  cta,
  children,
}: {
  eyebrow: string;
  eyebrowClass: string;
  title: string;
  meta: string | null;
  cta: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className={`text-[11px] font-semibold tracking-widest uppercase mb-1.5 ${eyebrowClass}`}>
        {eyebrow}
      </div>
      <div className="text-2xl font-bold text-surface-100">{title}</div>
      {meta && <p className="text-[13px] text-surface-400 mt-1">{meta}</p>}
      <div className="mt-4">{cta}</div>
      {children}
    </>
  );
}

/**
 * "Next up" hero — the primary daily action at the top of the home page.
 * A pending workout wins; otherwise the next meal is suggested (workout done
 * or rest day); then completed-workout / no-plan states. Without a plan the
 * meal hero is skipped so the plan CTA stays reachable (a completed quick
 * workout still shows its done state first). Renders nothing on a rest day
 * with nothing left to log.
 */
export function TodayHeroCard({
  workout,
  scheduled,
  hasPlan,
  mesocycleName,
  eyebrowContext,
  workoutMeta,
  meal,
  onLogFood,
  coachLine,
}: TodayHeroCardProps) {
  // Pending workout — the primary recommendation when the user hasn't trained yet.
  if (workout && workout.state !== 'completed') {
    const inProgress = workout.state === 'in_progress';
    const title = scheduled?.dayName ?? mesocycleName ?? "Today's workout";
    const meta =
      workoutMeta ??
      (workout.exercises > 0
        ? `${workout.exercises} exercises · ${workout.completedSets}/${workout.totalSets} sets`
        : // Planned session whose blocks are generated on start — "0
          // exercises · 0/0 sets" would read as an empty workout.
          'Exercises are planned when you start');
    return (
      <div>
        <Link href={`/dashboard/workout/${workout.id}`} className="block">
          <div
            className={`rounded-2xl p-5 border transition-colors ${
              inProgress
                ? 'bg-warning-500/10 border-warning-500/20 hover:bg-warning-500/15'
                : 'bg-primary-500/10 border-primary-500/20 hover:bg-primary-500/15'
            }`}
          >
            <HeroShell
              eyebrow={`Next up${eyebrowContext ? ` · ${eyebrowContext}` : ''}`}
              eyebrowClass={inProgress ? 'text-warning-400' : 'text-primary-400'}
              title={title}
              meta={meta}
              cta={
                <div className="w-full py-3 rounded-xl text-center text-[15px] font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-600">
                  {inProgress ? 'Continue workout' : 'Start workout'}
                </div>
              }
            >
              {coachLine && <CoachLine text={coachLine} />}
            </HeroShell>
          </div>
        </Link>
        <MoreOptionsLink showPlanLink={hasPlan} />
      </div>
    );
  }

  // Plan exists but today's session hasn't been generated yet.
  if (!workout && scheduled) {
    return (
      <div>
        <Link href="/dashboard/mesocycle" className="block">
          <div className="rounded-2xl p-5 border bg-primary-500/10 border-primary-500/20 hover:bg-primary-500/15 transition-colors">
            <HeroShell
              eyebrow={`Next up${eyebrowContext ? ` · ${eyebrowContext}` : ''}`}
              eyebrowClass="text-primary-400"
              title={scheduled.dayName}
              meta={workoutMeta ?? null}
              cta={
                <div className="w-full py-3 rounded-xl text-center text-[15px] font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-600">
                  Start workout
                </div>
              }
            >
              {coachLine && <CoachLine text={coachLine} />}
            </HeroShell>
          </div>
        </Link>
        <MoreOptionsLink showPlanLink={hasPlan} />
      </div>
    );
  }

  // No pending workout (done for the day or rest day) — recommend the next
  // meal. Only within an active plan: without one the "plan a mesocycle" CTA
  // below must stay reachable as the primary hero for new users.
  if (meal && hasPlan) {
    return (
      <div className="rounded-2xl p-5 border bg-success-500/10 border-success-500/20">
        <HeroShell
          eyebrow={`Next up · ${meal.timeLabel}`}
          eyebrowClass="text-success-400"
          title={meal.title}
          meta={meal.meta}
          cta={
            <button
              type="button"
              onClick={onLogFood}
              className="w-full py-3 rounded-xl text-center text-[15px] font-semibold text-white bg-gradient-to-r from-success-500 to-success-600 hover:from-success-400 hover:to-success-500 transition-colors"
            >
              Log food
            </button>
          }
        />
      </div>
    );
  }

  // Workout done and nothing left to log — a quiet "done" state.
  if (workout && workout.state === 'completed') {
    return (
      <Link href={`/dashboard/workout/${workout.id}`} className="block">
        <div className="rounded-2xl p-5 border bg-success-500/10 border-success-500/20 hover:bg-success-500/15 transition-colors">
          <HeroShell
            eyebrow="Done today"
            eyebrowClass="text-success-400"
            title={scheduled?.dayName ?? mesocycleName ?? 'Workout complete'}
            meta={
              workout.exercises > 0
                ? `${workout.exercises} exercises · ${workout.completedSets} sets logged`
                : null
            }
            cta={
              <div className="w-full py-3 rounded-xl text-center text-[15px] font-semibold text-white bg-success-500">
                View workout
              </div>
            }
          />
        </div>
      </Link>
    );
  }

  if (!hasPlan) {
    return (
      <div>
        <div className="relative rounded-2xl p-5 border bg-primary-500/10 border-primary-500/20">
          <FirstTimeHint
            id="dashboard-mesocycle-intro"
            title="What's a Mesocycle?"
            description="A mesocycle is a training block (usually 4-8 weeks) where you progressively challenge your muscles, then take a recovery week. This structured approach is proven to build more muscle than random workouts!"
            position="top"
          />
          <div className="text-[11px] font-semibold tracking-widest uppercase mb-1.5 text-primary-400">
            Next up
          </div>
          <div className="text-2xl font-bold text-surface-100">No training plan yet</div>
          <p className="text-[13px] text-surface-400 mt-1 mb-4">
            Plan a mesocycle for smart progression and volume tracking, or jump straight into a workout.
          </p>
          <div className="flex gap-2">
            <Link href="/dashboard/mesocycle/new" className="flex-1">
              <span className="block w-full py-3 rounded-xl text-center text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500 transition-colors">
                Plan a mesocycle
              </span>
            </Link>
            <Link href="/dashboard/workout/quick" className="flex-1">
              <span className="block w-full py-3 rounded-xl text-center text-sm font-semibold text-surface-200 bg-surface-800 hover:bg-surface-700 transition-colors">
                Quick workout
              </span>
            </Link>
          </div>
        </div>
        <MoreOptionsLink />
      </div>
    );
  }

  // Rest day within an active plan and nothing left to log — no hero.
  return null;
}
