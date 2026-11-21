/**
 * The active set's logger, as published by the active ExerciseCard.
 *
 * The weight/reps the phone's steppers show (and the function that logs a set
 * from them) live inside ExerciseCard. The workout page's watch bridge needs
 * both: the snapshot to mirror on the watch, and the card's own
 * `completeLoggedSet` to log a set from the wrist through the same path (and
 * the same double-tap lock) as the phone's "Log set" button.
 *
 * One active card at a time; a card only clears the slot it owns.
 */
import type { SetLogData } from '@/lib/workout/setLogData';
import type { ActiveLoggerSnapshot } from './protocol';

export interface ActiveLogger {
  snapshot: ActiveLoggerSnapshot;
  /** Log through the card's completeLoggedSet. */
  log: (data: SetLogData) => Promise<void>;
}

type Listener = () => void;

let current: ActiveLogger | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function setActiveLogger(logger: ActiveLogger): void {
  current = logger;
  emit();
}

/** Clears the slot only if `blockId` still owns it. */
export function clearActiveLogger(blockId: string): void {
  if (current?.snapshot.blockId !== blockId) return;
  current = null;
  emit();
}

export function getActiveLogger(): ActiveLogger | null {
  return current;
}

export function subscribeActiveLogger(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resolves when the active logger no longer shows `previous` (the set number
 * advanced, the block changed, or the slot cleared), or after `timeoutMs`.
 */
export function waitForLoggerAdvance(
  previous: { blockId: string; setNumber: number },
  timeoutMs = 3000
): Promise<void> {
  const moved = () => {
    const s = current?.snapshot;
    return !s || s.blockId !== previous.blockId || s.setNumber !== previous.setNumber;
  };
  if (moved()) return Promise.resolve();
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeoutMs);
    unsubscribe = subscribeActiveLogger(() => {
      if (!moved()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}
