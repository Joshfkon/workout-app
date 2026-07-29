/**
 * TEMPORARY instrumentation — set-log latency diagnosis (slow set logging on
 * cellular, see docs/SET_LOGGING_LATENCY_DIAGNOSIS.md). This file and its
 * call sites in the workout page / ExerciseCard are removable in one commit;
 * every call site is tagged `setLogTiming` for easy grep.
 *
 * Off by default. Enable in the running app from the console:
 *   localStorage.setItem('ht:set-timing', '1'); location.reload()
 * or build with NEXT_PUBLIC_SET_LOG_TIMING=1.
 *
 * Read results after logging sets:
 *   console.table(window.__setLogTimings)
 *
 * Phases (ms since t0_tap, per logged set):
 *   t0_tap             — tap handler entered (SetLoggerRow commit)
 *   probe_sent/done    — set_number max() read (network, online path only)
 *   t1_local_commit    — optimistic Zustand/local state committed
 *   t1_painted         — first animation frame after the local commit
 *   t2_outbox_enqueued — IndexedDB outbox put resolved (offline/fallback path)
 *   t3_insert_sent     — set_logs insert handed to fetch (online path)
 *   t4_insert_done     — insert response received
 *   auth_getuser_sent/done — auth.getUser() round trip (AMRAP branch only)
 *   t5_handler_done    — handleSetComplete returned (button lock released
 *                        ~100ms later, ExerciseCard.completeLoggedSet)
 *
 * Marks also land on the Performance timeline (performance.mark/measure) so
 * remote Safari/Chrome profiling shows them alongside the network waterfall.
 */

export type SetLogPhase =
  | 'probe_sent'
  | 'probe_done'
  | 't1_local_commit'
  | 't1_painted'
  | 't2_outbox_enqueued'
  | 't3_insert_sent'
  | 't4_insert_done'
  | 'auth_getuser_sent'
  | 'auth_getuser_done'
  | 't5_handler_done';

interface OpenTiming {
  start: number;
  phases: Record<string, number>;
}

declare global {
  interface Window {
    __setLogTimings?: Array<Record<string, number>>;
  }
}

let current: OpenTiming | null = null;

function enabled(): boolean {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_SET_LOG_TIMING === '1') return true;
  try {
    return window.localStorage.getItem('ht:set-timing') === '1';
  } catch {
    return false;
  }
}

/**
 * Open a timing row at the tap. Idempotent while a row is open: the earliest
 * caller on the path (ExerciseCard's one-tap commit) wins t0; secondary entry
 * points (dropset prompt → handleSetComplete) open the row themselves.
 */
export function beginSetTiming(): void {
  if (current || !enabled()) return;
  current = { start: performance.now(), phases: {} };
  try {
    performance.mark('set-log:t0_tap');
  } catch {
    /* perf timeline unavailable — the table still records */
  }
}

function recordPhase(row: OpenTiming, phase: SetLogPhase): void {
  row.phases[phase] = Math.round((performance.now() - row.start) * 10) / 10;
  try {
    performance.mark(`set-log:${phase}`);
    performance.measure(`set-log:t0→${phase}`, 'set-log:t0_tap', `set-log:${phase}`);
  } catch {
    /* ignore */
  }
}

/** Record a phase relative to t0. No-op when timing is off / no row is open. */
export function markSetPhase(phase: SetLogPhase): void {
  if (!current) return;
  recordPhase(current, phase);
}

/**
 * Mark t1_painted on the row open NOW at the next animation frame. The row is
 * captured in the closure, so a handler that finishes before the frame fires
 * (offline path; outbox-first path once fixed) still gets its paint time into
 * the correct — possibly already-closed — row, never into a later set's row.
 * (endSetTiming publishes the live phases object, so a post-close write still
 * shows up in window.__setLogTimings; only the console.table line misses it.)
 */
export function schedulePaintMark(): void {
  if (!current || typeof requestAnimationFrame !== 'function') return;
  const row = current;
  requestAnimationFrame(() => recordPhase(row, 't1_painted'));
}

/**
 * Close the row (t5), publish it to window.__setLogTimings, log a table.
 * The phases object is published by reference: a pending schedulePaintMark
 * callback may still fill t1_painted in after close.
 */
export function endSetTiming(): void {
  if (!current) return;
  markSetPhase('t5_handler_done');
  const row = current.phases;
  current = null;
  window.__setLogTimings = window.__setLogTimings ?? [];
  window.__setLogTimings.push(row);
  // eslint-disable-next-line no-console
  console.table([row]);
}
