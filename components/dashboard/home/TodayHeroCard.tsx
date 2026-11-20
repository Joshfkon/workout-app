'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconSparkles } from '@tabler/icons-react';
import { FirstTimeHint } from '@/components/ui';
import { StartWorkoutButton } from './StartWorkoutButton';

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
  /**
   * Freestyle training style (lib/training/trainingStyle): no plan prompts —
   * the empty state invites a workout instead of a mesocycle, and the meal
   * suggestion shows after training like it does with a plan.
   */
  freestyle?: boolean;
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
  /** Starts today's mesocycle workout (creates session and navigates). */
  onStartWorkout?: () => void;
  /** True while starting a workout. */
  isStarting?: boolean;
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
    <div className="mt-2 flex items-center justify-center gap-3 text-subhead text-ink-2">
      {showPlanLink && (
        <>
          <Link
            href="/dashboard/mesocycle/plan"
            className="hover:text-ink transition-colors"
          >
            See the plan
          </Link>
          <span aria-hidden="true">·</span>
        </>
      )}
      <Link href="/dashboard/train" className="hover:text-ink transition-colors">
        More options
      </Link>
    </div>
  );
}

/** Divider + sparkles coach line rendered below the hero CTA. */
function CoachLine({ text }: { text: string }) {
  return (
    <div className="border-t border-sep mt-4 pt-3 flex items-start gap-1.5 text-subhead text-ink-2">
      <IconSparkles size={15} className="flex-shrink-0 mt-0.5 text-action" aria-hidden="true" />
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
      <div className={`text-caption font-semibold mb-0.5 ${eyebrowClass}`}>{eyebrow}</div>
      <div className="text-title text-ink">{title}</div>
      {meta && <p className="text-subhead text-ink-2 mt-1">{meta}</p>}
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
 * workout still shows its done state first) — except in freestyle, where
 * there is no plan CTA to protect. Renders nothing on a rest day with nothing
 * left to log.
 */
export function TodayHeroCard({
  workout,
  scheduled,
  hasPlan,
  freestyle = false,
  mesocycleName,
  eyebrowContext,
  workoutMeta,
  meal,
  onLogFood,
  coachLine,
  onStartWorkout,
  isStarting = false,
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
className="rounded-card bg-card shadow-card p-5 transition-colors active:bg-fill"
          >
            <HeroShell
              eyebrow={`Next up${eyebrowContext ? ` · ${eyebrowContext}` : ''}`}
              eyebrowClass={inProgress ? 'text-status-warn' : 'text-action'}
              title={title}
              meta={meta}
              cta={
                <div className="flex w-full min-h-[50px] items-center justify-center rounded-button bg-action text-on-action text-headline transition-[filter] hover:brightness-110 active:brightness-95">
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
        <div className="rounded-card bg-card shadow-card p-5">
          <HeroShell
            eyebrow={`Next up${eyebrowContext ? ` · ${eyebrowContext}` : ''}`}
            eyebrowClass="text-action"
            title={scheduled.dayName}
            meta={workoutMeta ?? null}
            cta={
              <button
                type="button"
                onClick={onStartWorkout}
                disabled={isStarting || !onStartWorkout}
                className="flex w-full min-h-[50px] items-center justify-center rounded-button bg-action text-on-action text-headline transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isStarting ? 'Starting...' : 'Start workout'}
              </button>
            }
          >
            {coachLine && <CoachLine text={coachLine} />}
          </HeroShell>
        </div>
        <MoreOptionsLink showPlanLink={hasPlan} />
      </div>
    );
  }

  // No pending workout (done for the day or rest day) — recommend the next
  // meal. Only within an active plan: without one the "plan a mesocycle" CTA
  // below must stay reachable as the primary hero for new users.
  if (meal && (hasPlan || freestyle)) {
    return (
      <div className="rounded-card bg-card shadow-card p-5">
        <HeroShell
          eyebrow={`Next up · ${meal.timeLabel}`}
          eyebrowClass="text-action"
          title={meal.title}
          meta={meal.meta}
          cta={
            <button
              type="button"
              onClick={onLogFood}
              className="flex w-full min-h-[50px] items-center justify-center rounded-button bg-action text-on-action text-headline transition-[filter] hover:brightness-110 active:brightness-95"
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
        <div className="rounded-card bg-card shadow-card p-5 transition-colors active:bg-fill">
          <HeroShell
            eyebrow="Done today"
            eyebrowClass="text-status-ok"
            title={scheduled?.dayName ?? mesocycleName ?? 'Workout complete'}
            meta={
              workout.exercises > 0
                ? `${workout.exercises} exercises · ${workout.completedSets} sets logged`
                : null
            }
            cta={
              <div className="flex w-full min-h-[50px] items-center justify-center rounded-button bg-action-tint text-action text-headline">
                View workout
              </div>
            }
          />
        </div>
      </Link>
    );
  }

  if (freestyle) {
    return (
      <div>
        <div className="relative rounded-card bg-card shadow-card p-5">
          <div className="text-caption font-semibold mb-0.5 text-action">Next up</div>
          <div className="text-title text-ink">Ready to train?</div>
          <p className="text-subhead text-ink-2 mt-1 mb-4">
            Start empty and add exercises as you go, or repeat a past workout or take a suggestion.
          </p>
          {/* One tap straight into an empty workout; the Train tab keeps
              every other way to start (repeat a previous one, AI suggestion). */}
          <StartWorkoutButton />
          <Link
            href="/dashboard/train"
            className="mt-2.5 flex w-full min-h-[44px] items-center justify-center rounded-button bg-action-tint text-action text-body font-semibold transition-[filter] hover:brightness-110"
          >
            Repeat or get a suggestion
          </Link>
        </div>
      </div>
    );
  }

  if (!hasPlan) {
    return (
      <div>
        <div className="relative rounded-card bg-card shadow-card p-5">
          <FirstTimeHint
            id="dashboard-mesocycle-intro"
            title="Want a program?"
            description="HyperTrack can build a 4–8 week program (a mesocycle) that adds a little each week, then gives you a recovery week. Or just start a workout — it learns from what you log."
            position="top"
          />
          <div className="text-caption font-semibold mb-0.5 text-action">Next up</div>
          <div className="text-title text-ink">Ready to train?</div>
          <p className="text-subhead text-ink-2 mt-1 mb-4">
            Start a workout and add exercises as you go, or have HyperTrack build you a program.
          </p>
          <div className="flex gap-2">
            <StartWorkoutButton className="flex-1" />
            <Link
              href="/dashboard/mesocycle/new"
              className="flex flex-1 min-h-[50px] items-center justify-center rounded-button bg-action-tint text-action text-headline transition-[filter] hover:brightness-110"
            >
              Build a program
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
