'use client';

/**
 * Mirrors the active workout to the Apple Watch and takes "log set",
 * next/previous and finish back from it. The phone stays the source of truth:
 * the watch only ever sees snapshots and sends commands, and a logged set goes
 * through the active ExerciseCard's own logging path (see lib/watch/*).
 *
 * No-op on the web and in app builds without the WatchBridge plugin.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getActiveLogger, subscribeActiveLogger, waitForLoggerAdvance } from '@/lib/watch/activeLogger';
import { createWatchMessageHandler, type WatchMessageContext } from '@/lib/watch/handleWatchMessage';
import {
  WATCH_INACTIVE_STATE,
  buildWatchState,
  neighborBlockIndex,
  watchStateKey,
  type WatchRestState,
  type WatchWorkoutState,
} from '@/lib/watch/protocol';
import {
  ackWatchMessage,
  addWatchMessageListener,
  getPendingWatchMessages,
  isWatchBridgeAvailable,
  sendWatchState,
} from '@/lib/watch/watchBridge';

export interface UseWatchBridgeOptions {
  /** False when there is no in-progress workout to mirror (loading, finished, summary). */
  enabled: boolean;
  sessionId: string;
  blocks: ReadonlyArray<{ id: string; targetSets: number; exercise?: { name?: string } | null }>;
  /** Working sets logged on the current block. */
  currentBlockCompletedSets: number;
  unit: 'kg' | 'lb';
  currentBlockIndex: number;
  skippedBlockIds: ReadonlySet<string>;
  rest: WatchRestState | null;
  /** The current block's prescribed rest; the watch starts it locally on Done until the phone's timer arrives. */
  defaultRestSeconds: number;
  goToBlock: (index: number) => void;
  finishWorkout: () => void;
}

export function useWatchBridge(options: UseWatchBridgeOptions): void {
  const available = useMemo(() => isWatchBridgeAvailable(), []);
  const logger = useSyncExternalStore(subscribeActiveLogger, getActiveLogger, () => null);

  const {
    enabled,
    sessionId,
    blocks,
    currentBlockIndex,
    skippedBlockIds,
    rest,
    defaultRestSeconds,
    currentBlockCompletedSets,
    unit,
  } = options;
  const currentBlock = blocks[currentBlockIndex];

  const state: WatchWorkoutState = useMemo(() => {
    if (!enabled || !currentBlock) return WATCH_INACTIVE_STATE;
    const visible = blocks.filter((b) => !skippedBlockIds.has(b.id));
    const position = visible.findIndex((b) => b.id === currentBlock.id);
    return buildWatchState({
      sessionId,
      exerciseName: currentBlock.exercise?.name ?? 'Exercise',
      exerciseNumber: position >= 0 ? position + 1 : currentBlockIndex + 1,
      exerciseCount: visible.length || blocks.length,
      canPrev: neighborBlockIndex(blocks, currentBlockIndex, 'prev', skippedBlockIds) !== -1,
      canNext: neighborBlockIndex(blocks, currentBlockIndex, 'next', skippedBlockIds) !== -1,
      block: { id: currentBlock.id, targetSets: currentBlock.targetSets, completedSets: currentBlockCompletedSets },
      unit,
      logger: logger?.snapshot ?? null,
      rest,
      defaultRestSeconds,
    });
  }, [
    enabled,
    currentBlock,
    logger,
    blocks,
    skippedBlockIds,
    sessionId,
    currentBlockIndex,
    rest,
    defaultRestSeconds,
    currentBlockCompletedSets,
    unit,
  ]);

  // Push on change (key ignores sub-second rest jitter).
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSentKeyRef = useRef<string | null>(null);
  const resendState = useCallback(() => {
    lastSentKeyRef.current = watchStateKey(stateRef.current);
    void sendWatchState(stateRef.current);
  }, []);

  const key = watchStateKey(state);
  useEffect(() => {
    if (!available || lastSentKeyRef.current === key) return;
    resendState();
  }, [available, key, resendState]);

  // Leaving the workout page clears the watch.
  useEffect(() => {
    if (!available) return;
    return () => {
      lastSentKeyRef.current = null;
      void sendWatchState(WATCH_INACTIVE_STATE);
    };
  }, [available]);

  // Inbound commands. Latest values via refs so the listener is attached once.
  const contextRef = useRef<WatchMessageContext | null>(null);
  contextRef.current = enabled ? { sessionId, blocks, currentBlockIndex, skippedBlockIds } : null;
  const goToBlockRef = useRef(options.goToBlock);
  goToBlockRef.current = options.goToBlock;
  const finishRef = useRef(options.finishWorkout);
  finishRef.current = options.finishWorkout;

  // Attached only while a workout is on screen: the native side retains
  // messages until a listener exists, so wrist logs queued while the phone app
  // was closed are delivered once the session (and its active card) is ready
  // instead of being consumed and dropped by a page still loading.
  useEffect(() => {
    if (!available || !enabled) return;
    const handle = createWatchMessageHandler({
      getContext: () => contextRef.current,
      getActiveLogger,
      goToBlock: (i) => goToBlockRef.current(i),
      finishWorkout: () => finishRef.current(),
      resendState,
      waitForLoggerAdvance: (previous) => waitForLoggerAdvance(previous),
    });
    // Ack only once handled, so the native side keeps a message until then.
    // A replayed backlog message that also arrives live is dropped by the
    // handler's de-duplication.
    const process = (message: unknown) => {
      void handle(message)
        .then(() => {
          const id = (message as { id?: unknown } | null)?.id;
          if (typeof id === 'string') void ackWatchMessage(id);
        })
        .catch((err) => console.error('Watch message failed:', err));
    };
    const unsubscribe = addWatchMessageListener(process);
    void getPendingWatchMessages().then((backlog) => backlog.forEach(process));
    return unsubscribe;
  }, [available, enabled, resendState]);
}
