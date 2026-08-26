/**
 * SessionDriver — a headless user.
 *
 * Drives the loop a real lifter drives, without a browser:
 *
 *   createProgram → startSession → getPrescription → logSet
 *     → getNextPrescription → editSet / deleteSet → completeSession
 *     → advanceTime → startSession → …
 *
 * EVERY operation calls the SAME production function the UI calls. The driver
 * contributes composition and nothing else — no prescription rules, no volume
 * accounting, no progression logic. If you ever find yourself computing what
 * the app "should" do inside this file, stop: the harness is a state-integrity
 * and contract-verification system, not a second engine.
 *
 * What each operation delegates to:
 *
 *   createProgram      lib/training/createMesocycle
 *   startSession       lib/training/startMesocycleSession
 *   loadSession        workout/[id]/_lib/loadSession
 *   getPrescription    services/prescription/sessionPrescription
 *   logSet/edit/delete lib/training/logSet
 *   completeSession    workout/[id]/_lib/finishWorkout (+ postSessionMeso)
 *   advanceTime        lib/clock (a controllable clock)
 *
 * TIME. The driver owns the clock, and advancing it is not optional bookkeeping
 * — three engine paths use `ORDER BY … LIMIT` on a timestamp (transfer
 * candidates on `logged_at`, exercise history on `completed_at`, the e1RM
 * anchor's session window). A tie at the limit boundary is resolved by
 * unspecified row order, so a driver that stamped every set in a session with
 * the same instant would make the anchor nondeterministic and the failure would
 * look like an engine bug. Hence: the clock advances between every logged set.
 */
import { setClock } from '@/lib/clock';
import { ControllableClock, type ClockStart } from '@/test-utils/clock';
import {
  createMesocycle,
  type CreateMesocycleInput,
  type CreateMesocycleResult,
} from '@/lib/training/createMesocycle';
import {
  startMesocycleWorkoutSession,
  countCompletedSessionsOnDate,
  type StartableMesocycle,
} from '@/lib/training/startMesocycleSession';
import { getLocalDateString } from '@/lib/utils';
import {
  buildTrainingSchedule,
  getWorkoutForDate,
  getNextWorkoutForDate,
} from '@/lib/training/trainingSchedule';
import {
  loadWorkoutSession,
  resolveResumePosition,
  workingSetsForBlock,
  type LoadedWorkoutSession,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/loadSession';
import {
  logSet,
  persistSetEdit,
  persistSetDelete,
  buildSetEditPatch,
  type LogSetResult,
} from '@/lib/training/logSet';
import {
  nextSetPrescription,
  type PrescriptionSet,
} from '@/services/prescription/sessionPrescription';
import { submitFinishOptimistic } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/finishWorkout';
import type { SetRecommendation } from '@/services/setRecommender';
import type { SetFeedback, SetLog } from '@/types/schema';

type Client = Parameters<typeof loadWorkoutSession>[0];

export interface SessionDriverOptions {
  supabase: Client;
  userId: string;
  /** Where simulated time starts. */
  startAt: ClockStart;
  /**
   * Deterministic id source. Every id the driver supplies comes from here, so a
   * replay produces the same ids and the trace is comparable byte for byte.
   * Defaults to a counter.
   */
  nextId?: (prefix: string) => string;
}

export interface LogSetOutcome {
  result: LogSetResult;
  /** The prescription this set was logged against, for the trace. */
  prescribedFor: SetRecommendation | null;
}

/**
 * Drives one simulated user against one database. Instance state only — two
 * drivers with two clients never share anything, so runs isolate per process.
 */
export class SessionDriver {
  readonly clock: ControllableClock;
  private readonly supabase: Client;
  private readonly userId: string;
  private idCounter = 0;
  private readonly customNextId?: (prefix: string) => string;

  /** The session currently open, if any. */
  private sessionId: string | null = null;
  private loaded: LoadedWorkoutSession | null = null;
  private mesocycleId: string | null = null;

  constructor(options: SessionDriverOptions) {
    this.supabase = options.supabase;
    this.userId = options.userId;
    this.customNextId = options.nextId;
    this.clock = new ControllableClock(options.startAt);
    // The driver owns "now" for everything downstream — engine windows,
    // persisted timestamps, day/week bucketing.
    setClock(this.clock);
  }

  private nextId(prefix: string): string {
    if (this.customNextId) return this.customNextId(prefix);
    this.idCounter += 1;
    return `${prefix}-${String(this.idCounter).padStart(6, '0')}`;
  }

  // -- program ------------------------------------------------------------

  /** Create a mesocycle. Delegates to the same write the /mesocycle/new form uses. */
  async createProgram(
    input: Omit<CreateMesocycleInput, 'userId'>
  ): Promise<CreateMesocycleResult> {
    const result = await createMesocycle(this.supabase, { ...input, userId: this.userId });
    this.mesocycleId = result.mesocycleId;
    return result;
  }

  // -- session ------------------------------------------------------------

  /**
   * Start (or resume) today's session for the active mesocycle.
   *
   * Returns null when today is a REST day — which is a first-class outcome, not
   * an error: personas skip and drift, and the schedule deciding "not today" is
   * exactly the behaviour under test.
   */
  async startSession(): Promise<{ sessionId: string; resumed: boolean } | null> {
    const meso = await this.activeMesocycle();
    if (!meso) throw new Error('SessionDriver.startSession: no active mesocycle');

    const schedule = buildTrainingSchedule({
      days_per_week: meso.days_per_week as number,
      preferred_workout_days: meso.preferred_workout_days as never,
      schedule_mode: meso.schedule_mode as string | null,
      training_interval_days: meso.training_interval_days as number | null,
      sessions_per_day: meso.sessions_per_day as number | null,
      start_date: meso.start_date as string | null,
    });
    // Next UNDONE session today — a two-a-day date rotates to its second
    // slot when the persona starts again after completing the first.
    const completedToday = await countCompletedSessionsOnDate(
      this.supabase as never,
      meso.id as string,
      getLocalDateString(this.clock.now())
    );
    const todayWorkout = getNextWorkoutForDate(
      meso.split_type as never,
      this.clock.now(),
      schedule,
      completedToday
    );
    if (!todayWorkout) return null;

    const { sessionId, resumedExisting } = await startMesocycleWorkoutSession({
      supabase: this.supabase as never,
      mesocycle: meso as unknown as StartableMesocycle,
      todayWorkout,
    });

    this.sessionId = sessionId;
    await this.refresh();
    return { sessionId, resumed: resumedExisting };
  }

  /**
   * Point the driver at an existing session without going through
   * `startSession` — resuming one started elsewhere (another device, a previous
   * run, a fixture). Call `refresh()` afterwards to load its state.
   */
  adoptSession(sessionId: string): this {
    this.sessionId = sessionId;
    this.loaded = null;
    return this;
  }

  /** Re-read the open session — the driver's view of state is always the DB's. */
  async refresh(): Promise<LoadedWorkoutSession> {
    if (!this.sessionId) throw new Error('SessionDriver: no open session');
    const loaded = await loadWorkoutSession(this.supabase, this.sessionId);
    if (!loaded) throw new Error(`SessionDriver: session ${this.sessionId} not found`);
    this.loaded = loaded;
    return loaded;
  }

  private state(): LoadedWorkoutSession {
    if (!this.loaded) throw new Error('SessionDriver: no session loaded');
    return this.loaded;
  }

  /** Blocks of the open session, in `order`. */
  get blocks() {
    return this.state().blocks;
  }

  /** Sets logged in the open session, by `set_number`. */
  get sets() {
    return this.state().sets;
  }

  /** Where the session would resume — the first block still owing sets. */
  position() {
    const s = this.state();
    return resolveResumePosition(s.blocks, s.sets, s.skippedBlockIds);
  }

  // -- prescription -------------------------------------------------------

  /**
   * What the app would prescribe for the next set of `blockIndex`.
   *
   * `previousSets` is supplied by the caller because the history read is a
   * separate production call (`fetchExerciseHistory`) with its own scoping
   * rules; the driver does not invent one. With none supplied this is the
   * first-session view, which is exactly what a cold-start persona wants.
   */
  getPrescription(
    blockIndex: number,
    opts: {
      previousSets?: PrescriptionSet[];
      coldStart?: boolean;
      positionOffset?: number;
    } = {}
  ): SetRecommendation | null {
    const s = this.state();
    const block = s.blocks[blockIndex];
    if (!block) return null;

    const completed = workingSetsForBlock(s.sets, block.id);
    const last = completed[completed.length - 1];
    const previousSets = opts.previousSets ?? [];

    // With nothing logged today and no history, the block's stored target IS
    // the prescription — that is what session start wrote there.
    const reference: PrescriptionSet = last
      ? { weightKg: last.weightKg, reps: last.reps, rpe: last.rpe, feedback: last.feedback }
      : previousSets[0] ?? {
          weightKg: block.targetWeightKg,
          reps: block.targetRepRange[0],
        };

    return nextSetPrescription({
      last: reference,
      positionOffset: opts.positionOffset ?? 0,
      targetRepRange: block.targetRepRange,
      targetRir: block.targetRir,
      completedSets: completed,
      previousSets,
      plannedSetCount: block.targetSets,
      exercise: {
        exerciseType: block.exercise?.exerciseType,
        isBodyweight: block.exercise?.isBodyweight,
        minWeightIncrementKg: block.exercise?.minWeightIncrementKg,
        availableIncrementsKg: block.exercise?.availableIncrementsKg,
      },
      coldStart: opts.coldStart ?? previousSets.length === 0,
    });
  }

  // -- sets ---------------------------------------------------------------

  /**
   * Log a working set.
   *
   * Advances the clock by `restSeconds` FIRST, so consecutive sets always carry
   * strictly increasing `logged_at` — see the module header for why that is a
   * correctness requirement and not cosmetic.
   */
  async logSet(
    blockIndex: number,
    performed: { weightKg: number; reps: number; rpe: number; feedback?: SetFeedback },
    opts: { restSeconds?: number; prescribedFor?: SetRecommendation | null } = {}
  ): Promise<LogSetOutcome> {
    const s = this.state();
    const block = s.blocks[blockIndex];
    if (!block) throw new Error(`SessionDriver.logSet: no block at index ${blockIndex}`);

    this.clock.advanceSeconds(opts.restSeconds ?? 180);

    const completed = workingSetsForBlock(s.sets, block.id);
    const result = await logSet(
      { supabase: this.supabase as never, online: true },
      {
        setId: this.nextId('set'),
        exerciseBlockId: block.id,
        localNextSetNumber: completed.length + 1,
        weightKg: performed.weightKg,
        reps: performed.reps,
        rpe: performed.rpe,
        setType: 'normal',
        blockWorkingSets: completed.map((c) => ({ weightKg: c.weightKg })),
        locationId: s.locationId,
        feedback: performed.feedback,
      }
    );

    await this.refresh();
    return { result, prescribedFor: opts.prescribedFor ?? null };
  }

  /** Edit a logged set through the production edit path. */
  async editSet(
    setId: string,
    data: { weightKg: number; reps: number; rpe: number }
  ): Promise<void> {
    const existing = this.state().sets.find((x) => x.id === setId);
    const { patch } = buildSetEditPatch(existing, data);
    const { error } = await persistSetEdit({ supabase: this.supabase as never }, { setId, patch });
    if (error) throw new Error(`SessionDriver.editSet: ${error.message}`);
    await this.refresh();
  }

  /**
   * Delete a logged set. HARD delete — `set_logs` has no soft-delete column
   * (audit finding H3), so a persona must not expect one.
   */
  async deleteSet(setId: string): Promise<void> {
    const { error } = await persistSetDelete({ supabase: this.supabase as never }, setId);
    if (error) throw new Error(`SessionDriver.deleteSet: ${error.message}`);
    await this.refresh();
  }

  // -- completion ---------------------------------------------------------

  /**
   * Finish the session through the real finish flow, including the durable
   * outbox write and the post-session mesocycle updates.
   *
   * `submitFinishOptimistic` responds to the UI before the network settles and
   * does its sync in a detached task, so the driver awaits quiescence before
   * returning — otherwise the next operation would race the completion and the
   * trace would be nondeterministic.
   *
   * KNOWN NOISE: the finish flow fires a workout-calorie estimate through a
   * dynamic import of a SERVER action, which cannot resolve headlessly. It is
   * explicitly fire-and-forget dashboard garnish and production catches it, but
   * it logs. Callers running many simulated sessions should mock
   * `@/lib/actions/workout-calories`. It is NOT an engine exception, and the
   * Phase 3 exception policy must keep that distinction — "any engine exception
   * fails the run" has to mean the engine, not every caught background task.
   */
  async completeSession(data: {
    sessionRpe: number;
    notes?: string;
    isDeload?: boolean;
  }): Promise<void> {
    const s = this.state();
    let settled = false;

    await submitFinishOptimistic(
      {
        supabase: this.supabase as never,
        sessionId: s.session.id,
        session: s.session,
        navigate: () => {
          settled = true;
        },
        showClaimPrompt: null,
      },
      {
        sessionRpe: data.sessionRpe,
        notes: data.notes ?? '',
        isDeload: data.isDeload ?? false,
        muscleFeedback: [],
        durationSeconds: null,
        completedAt: this.clock.now().toISOString(),
      } as never
    );

    // Let the detached background sync run to completion.
    await flushMicrotasks();
    if (!settled) await flushMicrotasks();

    this.sessionId = null;
    this.loaded = null;
  }

  // -- time ---------------------------------------------------------------

  /**
   * Move simulated time forward by CALENDAR days, preserving the time of day.
   * Not +24h — see lib/clock: across a DST boundary those differ, and an
   * evening session would drift onto the wrong local day.
   */
  advanceDays(days: number): this {
    this.clock.advanceDays(days);
    return this;
  }

  advanceHours(hours: number): this {
    this.clock.advanceHours(hours);
    return this;
  }

  /** Advance to the next day the schedule actually trains on, up to a bound. */
  async advanceToNextTrainingDay(maxDays = 14): Promise<boolean> {
    const meso = await this.activeMesocycle();
    if (!meso) return false;
    const schedule = buildTrainingSchedule({
      days_per_week: meso.days_per_week as number,
      preferred_workout_days: meso.preferred_workout_days as never,
      schedule_mode: meso.schedule_mode as string | null,
      training_interval_days: meso.training_interval_days as number | null,
      sessions_per_day: meso.sessions_per_day as number | null,
      start_date: meso.start_date as string | null,
    });
    for (let i = 0; i < maxDays; i++) {
      this.clock.advanceDays(1);
      if (getWorkoutForDate(meso.split_type as never, this.clock.now(), schedule)) return true;
    }
    return false;
  }

  // -- helpers ------------------------------------------------------------

  private async activeMesocycle(): Promise<Record<string, unknown> | null> {
    const { data } = await this.supabase
      .from('mesocycles')
      .select('*')
      .eq('user_id', this.userId)
      .eq('state', 'active')
      .maybeSingle();
    return (data as Record<string, unknown> | null) ?? null;
  }

  /** Working sets of a block in the open session. */
  setsForBlock(blockIndex: number): SetLog[] {
    const s = this.state();
    const block = s.blocks[blockIndex];
    return block ? workingSetsForBlock(s.sets, block.id) : [];
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get currentMesocycleId(): string | null {
    return this.mesocycleId;
  }
}

/** Drain pending microtasks and immediate timers. */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
