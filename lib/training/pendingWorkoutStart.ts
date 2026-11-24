/**
 * Navigate-first workout starts.
 *
 * A start used to wait for the whole build — session row, weight estimates,
 * exercise blocks — before it pushed the workout route, and the route's own
 * load only began after that. The UX panel (round 20, 4 of 6) read the gap as
 * "a brief 'opening workout screen' wait; Hevy opens instantly".
 *
 * Now a start navigates as soon as the session id is known, and the rest of
 * the build continues in the background while the workout screen shows its
 * skeleton. The workout page awaits the build here (same JS module, since the
 * navigation is client-side) before it reads the session, so it never loads a
 * half-built workout. A build that fails after the navigation surfaces its
 * error on the workout page instead of on the screen the user already left.
 *
 * Module-level state on purpose: it only has to survive one client-side
 * navigation. A full reload loses it, which is the same as the build being
 * interrupted (the page just loads whatever was written).
 */

export type PendingBuildStage = 'building' | 'saving';

interface PendingEntry {
  stage: PendingBuildStage;
  /** Resolves to null on success, or a user-facing error message. */
  outcome: Promise<string | null>;
  settled: boolean;
}

const entries = new Map<string, PendingEntry>();
const listeners = new Set<() => void>();

/** Failed builds nobody came to read are dropped after this long. */
const FAILED_ENTRY_TTL_MS = 60_000;

function emit(): void {
  listeners.forEach((l) => l());
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string' &&
    (err as { message: string }).message
  ) {
    return (err as { message: string }).message;
  }
  return 'Something went wrong while building the workout.';
}

/**
 * Register a background build for `sessionId`: `build` is its promise
 * (rejects on failure). Returns a stage setter for the workout screen's
 * skeleton copy.
 */
export function trackPendingWorkoutBuild(
  sessionId: string,
  build: Promise<unknown>
): { setStage: (stage: PendingBuildStage) => void } {
  const entry: PendingEntry = {
    stage: 'building',
    outcome: build.then(
      () => null,
      (err) => errorMessage(err)
    ),
    settled: false,
  };
  void entry.outcome.then((error) => {
    entry.settled = true;
    if (error === null) {
      // Success leaves nothing to report: the page reads the finished rows.
      if (entries.get(sessionId) === entry) entries.delete(sessionId);
    } else {
      const timer = setTimeout(() => {
        if (entries.get(sessionId) === entry) entries.delete(sessionId);
      }, FAILED_ENTRY_TTL_MS);
      (timer as { unref?: () => void }).unref?.();
    }
    emit();
  });
  entries.set(sessionId, entry);
  emit();
  return {
    setStage: (stage) => {
      if (entry.stage === stage || entry.settled) return;
      entry.stage = stage;
      emit();
    },
  };
}

/** True while a build for this session is still running. */
export function hasPendingWorkoutBuild(sessionId: string): boolean {
  const entry = entries.get(sessionId);
  return !!entry && !entry.settled;
}

/** The running build's stage, or null when nothing is pending. */
export function getPendingWorkoutBuildStage(sessionId: string): PendingBuildStage | null {
  const entry = entries.get(sessionId);
  return entry && !entry.settled ? entry.stage : null;
}

/**
 * Wait for this session's build, if one is running or failed recently.
 * Resolves to null when there is nothing to wait for or it succeeded, else
 * the error message (consumed: a later visit loads normally).
 */
export async function awaitPendingWorkoutBuild(sessionId: string): Promise<string | null> {
  const entry = entries.get(sessionId);
  if (!entry) return null;
  const error = await entry.outcome;
  if (entries.get(sessionId) === entry) entries.delete(sessionId);
  emit();
  return error;
}

export function subscribePendingWorkoutBuilds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface NavigateFirstHooks {
  /** Call once the session id is known: the caller navigates right away. */
  sessionReady: (sessionId: string) => void;
  /** Report the build's progress (shown on whichever screen is up). */
  stage: (stage: PendingBuildStage) => void;
}

/**
 * Run a workout start that navigates as soon as `hooks.sessionReady` fires,
 * finishing the build in the background (tracked above). A start that never
 * calls `sessionReady` (e.g. it resumed an existing workout) navigates when it
 * resolves, as before.
 *
 * Errors before the navigation are rethrown so the start screen shows them.
 * Errors after it belong to the workout screen (awaitPendingWorkoutBuild) and
 * are not rethrown — the start screen is gone.
 */
export async function runNavigateFirstStart<R extends { sessionId: string }>(opts: {
  start: (hooks: NavigateFirstHooks) => Promise<R>;
  navigate: (sessionId: string) => void;
  onStage?: (stage: PendingBuildStage) => void;
}): Promise<{ sessionId: string; navigatedEarly: boolean }> {
  let earlyId: string | null = null;
  let tracked: { setStage: (stage: PendingBuildStage) => void } | null = null;
  let resolveBuild: () => void = () => {};
  let rejectBuild: (err: unknown) => void = () => {};

  const hooks: NavigateFirstHooks = {
    sessionReady: (sessionId) => {
      if (earlyId) return;
      earlyId = sessionId;
      const build = new Promise<void>((resolve, reject) => {
        resolveBuild = resolve;
        rejectBuild = reject;
      });
      tracked = trackPendingWorkoutBuild(sessionId, build);
      opts.navigate(sessionId);
    },
    stage: (stage) => {
      // Once navigated, the progress belongs to the workout screen's
      // skeleton; the start screen keeps saying "Opening…" while it leaves.
      if (tracked) tracked.setStage(stage);
      else opts.onStage?.(stage);
    },
  };

  let result: R;
  try {
    result = await opts.start(hooks);
  } catch (err) {
    if (earlyId) {
      rejectBuild(err);
      return { sessionId: earlyId, navigatedEarly: true };
    }
    throw err;
  }
  if (earlyId) {
    resolveBuild();
    return { sessionId: earlyId, navigatedEarly: true };
  }
  opts.navigate(result.sessionId);
  return { sessionId: result.sessionId, navigatedEarly: false };
}

/** Test-only: forget every pending build. */
export function __resetPendingWorkoutBuildsForTests(): void {
  entries.clear();
  emit();
}
