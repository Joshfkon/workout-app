'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * /dashboard/mesocycle/plan — the whole training block, read-only.
 *
 * The plan used to be visible only one session at a time, and only by
 * pressing Start: program_data was written at generation time but never
 * rendered. This page shows what the generator actually produced — every week,
 * every session, every exercise with its planned sets / rep range / RIR —
 * without creating or mutating anything.
 *
 * Data: `useMesocyclePlan` (active block by default, `?id=` for a past one).
 * Shaping: `buildPlanPreview`, which reuses the start path's own primitives so
 * the preview and the workout Start builds cannot drift. Weights are absent by
 * design — they're estimated against history at start time.
 */

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  IconChevronDown,
  IconChevronLeft,
  IconCircleCheck,
} from '@tabler/icons-react';
import { SessionExerciseList } from '@/components/mesocycle';
import { useMesocyclePlan } from '@/hooks/useMesocyclePlan';
import {
  buildTrainingSchedule,
  describeTrainingSchedule,
} from '@/lib/training/trainingSchedule';
import { muscleDisplayName } from '@/lib/utils';
import {
  buildPlanPreview,
  currentPlanWeek,
  type PlanSessionPreview,
  type PlanWeekPreview,
} from '../_lib/planPreview';
import type { FullProgramRecommendation } from '@/types/schema';

const CARD_CLASS = 'rounded-card bg-card shadow-card';

function PlanSkeleton() {
  return (
    <div className="max-w-lg mx-auto space-y-4" data-testid="mesocycle-plan-loading">
      <div className={`${CARD_CLASS} p-4 animate-pulse space-y-3`} aria-busy="true">
        <div className="h-3 w-24 bg-fill rounded" />
        <div className="h-6 w-44 bg-fill rounded" />
        <div className="h-3 w-56 bg-fill rounded" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 w-16 bg-fill rounded-xl animate-pulse" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${CARD_CLASS} p-4 animate-pulse space-y-2`} aria-busy="true">
          <div className="h-4 w-32 bg-fill rounded" />
          <div className="h-3 w-48 bg-fill rounded" />
        </div>
      ))}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/mesocycle"
      className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink transition-colors"
    >
      <IconChevronLeft size={16} aria-hidden="true" />
      Mesocycle
    </Link>
  );
}

/** "Deload" / "This week" / "Done" chips on a week or session. */
function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'primary' | 'warning' | 'success';
}) {
  const tones = {
    neutral: 'bg-fill text-ink-2',
    primary: 'bg-action/15 text-action',
    warning: 'bg-status-warn/15 text-status-warn',
    success: 'bg-status-ok/15 text-status-ok',
  } as const;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function SessionCard({
  entry,
  isOpen,
  onToggle,
}: {
  entry: PlanSessionPreview;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { session, status } = entry;
  const meta = [
    `${entry.totalSets} sets`,
    `${session.exercises.length} ${session.exercises.length === 1 ? 'exercise' : 'exercises'}`,
    entry.estimatedMinutes > 0 ? `~${entry.estimatedMinutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        status === 'next'
          ? 'border-action/40 bg-action/[0.06]'
          : 'border-sep bg-card'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-fill/40 transition-colors"
      >
        <span className="w-10 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          {entry.weekdayLabel ?? `S${entry.index + 1}`}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`text-[15px] font-semibold truncate ${
                status === 'done' ? 'text-ink-2' : 'text-ink'
              }`}
            >
              {session.dayName}
            </span>
            {status === 'next' && <Chip tone="primary">Next up</Chip>}
            {status === 'done' && (
              <IconCircleCheck size={15} className="text-status-ok flex-shrink-0" aria-label="Completed" />
            )}
          </span>
          <span className="block text-[12px] text-ink-3 mt-0.5">{meta}</span>
        </span>
        <IconChevronDown
          size={18}
          className={`flex-shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div className="px-3 pb-3 space-y-2">
          {session.exercises.length > 0 ? (
            <SessionExerciseList exercises={session.exercises} showNotes />
          ) : (
            <p className="text-[13px] text-ink-2">
              Exercises for this session are chosen when you start it.
            </p>
          )}
          {session.warmup.length > 0 && (
            <p className="text-[11px] text-ink-3">
              <span className="text-ink-2">Warm-up:</span> {session.warmup.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WeekDetail({
  week,
  isOpen,
  onToggleSession,
}: {
  week: PlanWeekPreview;
  isOpen: (entry: PlanSessionPreview) => boolean;
  onToggleSession: (entry: PlanSessionPreview) => void;
}) {
  const avgMinutes = week.sessions.length
    ? Math.round(
        week.sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0) / week.sessions.length
      )
    : 0;
  const hasModifiers = week.intensityModifier !== 1 || week.volumeModifier !== 1;

  return (
    <div className="space-y-3">
      <div className={`${CARD_CLASS} p-4`}>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[17px] font-bold text-ink">Week {week.weekNumber}</h2>
          {week.status === 'current' && <Chip tone="primary">This week</Chip>}
          {week.isDeload && <Chip tone="warning">Deload</Chip>}
          {week.status === 'done' && <Chip tone="success">Done</Chip>}
        </div>
        <p className="text-[13px] text-ink-2 mt-1">
          {[
            week.focus || null,
            `${week.sessions.length} ${week.sessions.length === 1 ? 'session' : 'sessions'}`,
            `${week.totalSets} sets`,
            avgMinutes > 0 ? `~${avgMinutes} min each` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {hasModifiers && (
          <p className="text-[12px] text-ink-3 mt-1">
            Volume {Math.round(week.volumeModifier * 100)}% · intensity{' '}
            {Math.round(week.intensityModifier * 100)}% of baseline
          </p>
        )}

        {week.setsByMuscle.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {week.setsByMuscle.map(({ muscle, sets }) => (
              <span
                key={muscle}
                className="px-2 py-1 rounded-lg bg-fill text-[11px] text-ink-2"
              >
                {muscleDisplayName(muscle)}{' '}
                <span className="text-ink-3 tabular-nums">{sets}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {week.sessions.map((entry) => (
          <SessionCard
            key={entry.key}
            entry={entry}
            isOpen={isOpen(entry)}
            onToggle={() => onToggleSession(entry)}
          />
        ))}
      </div>
    </div>
  );
}

function PlanContent() {
  const searchParams = useSearchParams();
  const mesocycleId = searchParams.get('id');
  const { data, isLoading, isError, refetch } = useMesocyclePlan(mesocycleId);

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [openSessions, setOpenSessions] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);

  const mesocycle = data?.mesocycle ?? null;

  // Fixed weekdays vs every-N-days — the preview labels slots accordingly.
  const schedule = useMemo(
    () => (mesocycle ? buildTrainingSchedule(mesocycle) : null),
    [mesocycle]
  );

  const weeks = useMemo(() => {
    if (!mesocycle) return [];
    return buildPlanPreview({
      programData: mesocycle.program_data as FullProgramRecommendation | null,
      totalWeeks: mesocycle.total_weeks,
      daysPerWeek: mesocycle.days_per_week,
      deloadWeek: mesocycle.deload_week,
      preferredWorkoutDays: mesocycle.preferred_workout_days,
      exerciseOverrides: mesocycle.exercise_overrides ?? [],
      completedSessions: data?.completedSessions ?? 0,
      // Start reads the week from this column, so the preview must too.
      currentWeek: mesocycle.current_week,
      schedule,
    });
  }, [mesocycle, schedule, data?.completedSessions]);

  const activeWeekNumber =
    selectedWeek ?? currentPlanWeek(weeks)?.weekNumber ?? weeks[0]?.weekNumber ?? 1;
  const activeWeek = weeks.find((w) => w.weekNumber === activeWeekNumber) ?? weeks[0] ?? null;

  // A session is open when the user has toggled it, else by default: the next
  // session up (the one Start will launch), or everything under "Expand all".
  const isOpen = (entry: PlanSessionPreview) =>
    openSessions[entry.key] ?? (expandAll || entry.status === 'next');
  const toggleSession = (entry: PlanSessionPreview) =>
    setOpenSessions((prev) => ({ ...prev, [entry.key]: !isOpen(entry) }));
  const toggleExpandAll = () => {
    setExpandAll((prev) => !prev);
    setOpenSessions({});
  };

  if (isLoading && !data) return <PlanSkeleton />;

  if (isError) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <BackLink />
        <div className={`${CARD_CLASS} p-6 text-center`}>
          <p className="text-[15px] text-ink">Couldn&apos;t load your plan</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 rounded-xl bg-fill text-[13px] font-medium text-ink hover:bg-sep transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!mesocycle) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <BackLink />
        <div className={`${CARD_CLASS} p-6 text-center`}>
          <h1 className="text-[17px] font-bold text-ink">No plan to preview</h1>
          <p className="text-[13px] text-ink-2 mt-1">
            Plan a mesocycle and you&apos;ll be able to read every week of it here before you
            train.
          </p>
          <Link
            href="/dashboard/mesocycle/new"
            className="inline-block mt-4 px-4 py-2.5 rounded-xl bg-action text-on-action text-[14px] font-semibold hover:opacity-90 transition-opacity"
          >
            Plan a mesocycle
          </Link>
        </div>
      </div>
    );
  }

  const completed = data?.completedSessions ?? 0;
  const plannedTotal = mesocycle.total_weeks * mesocycle.days_per_week;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <BackLink />

      {/* Block header */}
      <div className={`${CARD_CLASS} p-4`}>
        <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-3">
          {mesocycle.state === 'active' ? 'Your plan' : `${mesocycle.state} plan`}
        </p>
        <h1 className="text-[24px] leading-tight font-bold text-ink mt-1">
          {mesocycle.name}
        </h1>
        <p className="text-[13px] text-ink-2 mt-1">
          {[
            mesocycle.split_type,
            // An interval block isn't N×/week — say the cadence it really runs.
            schedule?.mode === 'interval'
              ? describeTrainingSchedule(schedule, { short: true })
              : `${mesocycle.days_per_week}×/week`,
            `${mesocycle.total_weeks} weeks`,
            mesocycle.session_duration_minutes
              ? `${mesocycle.session_duration_minutes} min target`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {plannedTotal > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-[12px] text-ink-3 mb-1">
              <span>
                {Math.min(completed, plannedTotal)} of {plannedTotal} sessions done
              </span>
              <span>Week {mesocycle.current_week}</span>
            </div>
            <div className="h-1.5 bg-fill rounded-full overflow-hidden">
              <div
                className="h-full bg-action rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((completed / plannedTotal) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {weeks.length === 0 ? (
        <div className={`${CARD_CLASS} p-4`}>
          <p className="text-[15px] font-semibold text-ink">
            This block has no stored program
          </p>
          <p className="text-[13px] text-ink-2 mt-1">
            It was created before plans were saved week by week, so its exercises are chosen when
            each workout starts. Regenerating the schedule from the Mesocycle page will build a
            full plan you can read here.
          </p>
          <Link
            href="/dashboard/mesocycle"
            className="inline-block mt-3 text-[13px] font-medium text-action transition-colors"
          >
            Go to Mesocycle
          </Link>
        </div>
      ) : (
        <>
          {/* Week strip */}
          <div className="flex items-center gap-2">
            <div className="flex gap-2 overflow-x-auto pb-1 -mb-1">
              {weeks.map((week) => {
                const isActive = week.weekNumber === activeWeekNumber;
                return (
                  <button
                    key={week.weekNumber}
                    type="button"
                    onClick={() => setSelectedWeek(week.weekNumber)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`flex-shrink-0 px-3 py-2 rounded-xl border text-center transition-colors ${
                      isActive
                        ? 'border-action/50 bg-action/15'
                        : 'border-sep bg-card hover:bg-fill/70'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center gap-1 text-[13px] font-semibold ${
                        isActive
                          ? 'text-action'
                          : week.status === 'done'
                            ? 'text-ink-2'
                            : 'text-ink'
                      }`}
                    >
                      W{week.weekNumber}
                      {week.status === 'done' && (
                        <IconCircleCheck
                          size={13}
                          className="text-status-ok"
                          aria-label="Week complete"
                        />
                      )}
                    </span>
                    <span className="block text-[10px] text-ink-3 mt-0.5">
                      {week.isDeload ? 'deload' : `${week.totalSets} sets`}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={toggleExpandAll}
              className="ml-auto flex-shrink-0 text-[12px] font-medium text-action transition-colors"
            >
              {expandAll ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          {activeWeek && (
            <WeekDetail week={activeWeek} isOpen={isOpen} onToggleSession={toggleSession} />
          )}

          <p className="text-[11px] text-ink-3 px-1">
            Sets and rep ranges are the plan. Weights are suggested from your history when you
            start each session, and volume adapts to your feedback week to week.
          </p>

          {mesocycle.state === 'active' && (
            <Link
              href="/dashboard/train"
              className="block w-full py-3 rounded-xl text-center bg-action text-on-action text-[15px] font-semibold hover:opacity-90 transition-opacity"
            >
              Go to Train
            </Link>
          )}
        </>
      )}
    </div>
  );
}

export default function MesocyclePlanPage() {
  useDocumentTitle('Mesocycle Plan');
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <PlanContent />
    </Suspense>
  );
}
