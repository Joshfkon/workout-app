/**
 * Dispatch for messages arriving from the watch. Framework-free so the
 * workout page's wiring (hooks/useWatchBridge) stays thin and this is tested
 * directly.
 */
import { buildSetLogData } from '@/lib/workout/setLogData';
import type { ActiveLogger } from './activeLogger';
import {
  createMessageDeduper,
  neighborBlockIndex,
  parseWatchCommand,
  resolveWatchLog,
  type WatchCommand,
} from './protocol';

export interface WatchMessageContext {
  sessionId: string;
  blocks: ReadonlyArray<{ id: string }>;
  currentBlockIndex: number;
  skippedBlockIds: ReadonlySet<string>;
}

export interface WatchMessageDeps {
  getContext: () => WatchMessageContext | null;
  getActiveLogger: () => ActiveLogger | null;
  goToBlock: (index: number) => void;
  /** Open the phone's finish flow (the summary sheet lives on the phone). */
  finishWorkout: () => void;
  /** Push the phone's current state again (watch is out of date or asked for it). */
  resendState: () => void;
  /**
   * Resolves once the active logger has moved past the set just logged (or a
   * timeout passes). Logs queued on the watch while the phone app was closed
   * arrive back to back; without this wait the second would be checked
   * against the not-yet-advanced set number and refused as stale.
   */
  waitForLoggerAdvance?: (previous: { blockId: string; setNumber: number }) => Promise<void>;
}

export type WatchMessageOutcome =
  | 'ignored-invalid'
  | 'ignored-duplicate'
  | 'ignored-no-workout'
  | 'logged'
  | 'refused-stale'
  | 'navigated'
  | 'finish'
  | 'state-sent';

export function createWatchMessageHandler(deps: WatchMessageDeps) {
  const deduper = createMessageDeduper();

  const handleCommand = async (command: WatchCommand): Promise<WatchMessageOutcome> => {
    if (command.type === 'requestState') {
      deps.resendState();
      return 'state-sent';
    }

    const ctx = deps.getContext();
    if (!ctx || command.sessionId !== ctx.sessionId) {
      // The watch is showing a workout this page isn't running.
      deps.resendState();
      return 'ignored-no-workout';
    }

    switch (command.type) {
      case 'logSet': {
        const logger = deps.getActiveLogger();
        const resolution = resolveWatchLog(command, {
          sessionId: ctx.sessionId,
          logger: logger?.snapshot ?? null,
        });
        if (!resolution.ok || !logger) {
          deps.resendState();
          return 'refused-stale';
        }
        // The card's own completeLoggedSet: same lock, same onSetComplete →
        // handleSetComplete → logSet (outbox) path as the phone's button.
        await logger.log(buildSetLogData(resolution.input));
        await deps.waitForLoggerAdvance?.({
          blockId: logger.snapshot.blockId,
          setNumber: logger.snapshot.setNumber,
        });
        return 'logged';
      }
      case 'navigate': {
        const current = ctx.blocks[ctx.currentBlockIndex];
        if (!current || current.id !== command.blockId) {
          deps.resendState();
          return 'refused-stale';
        }
        const next = neighborBlockIndex(ctx.blocks, ctx.currentBlockIndex, command.direction, ctx.skippedBlockIds);
        if (next === -1) {
          deps.resendState();
          return 'refused-stale';
        }
        deps.goToBlock(next);
        return 'navigated';
      }
      case 'finish':
        deps.finishWorkout();
        return 'finish';
    }
  };

  // Messages are handled strictly one at a time, in arrival order.
  let queue: Promise<unknown> = Promise.resolve();
  return (raw: unknown): Promise<WatchMessageOutcome> => {
    const run = async (): Promise<WatchMessageOutcome> => {
      const command = parseWatchCommand(raw);
      if (!command) return 'ignored-invalid';
      if (!deduper.accept(command.id)) return 'ignored-duplicate';
      return handleCommand(command);
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}
