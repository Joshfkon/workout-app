import { createWatchMessageHandler, type WatchMessageContext } from '../handleWatchMessage';
import type { ActiveLogger } from '../activeLogger';
import type { ActiveLoggerSnapshot } from '../protocol';
import { buildSetLogData } from '@/lib/workout/setLogData';

const snapshot: ActiveLoggerSnapshot = {
  blockId: 'b1',
  setNumber: 1,
  targetSets: 3,
  weight: '60',
  reps: '10',
  targetRir: 2,
  unit: 'kg',
  minIncrementKg: 2.5,
  isDurationBased: false,
  isBodyweight: false,
  weightMode: 'bodyweight',
};

function setup(overrides: { context?: WatchMessageContext | null; logger?: ActiveLogger | null } = {}) {
  const log = jest.fn().mockResolvedValue(undefined);
  const logger: ActiveLogger | null =
    overrides.logger === undefined ? { snapshot, log } : overrides.logger;
  const context: WatchMessageContext | null =
    overrides.context === undefined
      ? {
          sessionId: 's1',
          blocks: [{ id: 'b0' }, { id: 'b1' }, { id: 'b2' }],
          currentBlockIndex: 1,
          skippedBlockIds: new Set(),
        }
      : overrides.context;
  const deps = {
    getContext: () => context,
    getActiveLogger: () => logger,
    goToBlock: jest.fn(),
    finishWorkout: jest.fn(),
    resendState: jest.fn(),
  };
  return { handle: createWatchMessageHandler(deps), deps, log };
}

const logSet = (over: Record<string, unknown> = {}) => ({
  type: 'logSet',
  id: 'm1',
  sessionId: 's1',
  blockId: 'b1',
  setNumber: 1,
  weight: 62.5,
  reps: 9,
  rir: 1,
  ...over,
});

describe('watch message handling', () => {
  it("logs through the active card's logger with the phone row's exact payload", async () => {
    const { handle, log } = setup();
    await expect(handle(logSet())).resolves.toBe('logged');
    expect(log).toHaveBeenCalledTimes(1);
    // Identical to what SetLoggerRow builds for 62.5 kg × 9 @ RIR 1.
    expect(log).toHaveBeenCalledWith(
      buildSetLogData({ weight: 62.5, reps: 9, rir: 1, unit: 'kg', form: null, setType: 'normal', isBodyweight: false, weightMode: 'bodyweight' })
    );
    expect(log.mock.calls[0][0]).toMatchObject({
      weightKg: 62.5,
      reps: 9,
      rpe: 9,
      setType: 'normal',
      feedback: { repsInTank: 1, form: 'clean' },
    });
  });

  it('converts lb from the watch to kg', async () => {
    const lbLog = jest.fn().mockResolvedValue(undefined);
    const { handle } = setup({ logger: { snapshot: { ...snapshot, unit: 'lb' }, log: lbLog } });
    await handle(logSet({ weight: 135 }));
    expect(lbLog.mock.calls[0][0].weightKg).toBeCloseTo(61.235, 2);
  });

  it('never logs the same message twice (WatchConnectivity redelivery / retry)', async () => {
    const { handle, log } = setup();
    await handle(logSet());
    await expect(handle(logSet())).resolves.toBe('ignored-duplicate');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('refuses a stale log and resends the phone state', async () => {
    const { handle, log, deps } = setup();
    await expect(handle(logSet({ setNumber: 3 }))).resolves.toBe('refused-stale');
    expect(log).not.toHaveBeenCalled();
    expect(deps.resendState).toHaveBeenCalled();
  });

  it('ignores malformed input without touching the workout', async () => {
    const { handle, log, deps } = setup();
    await expect(handle({ type: 'logSet', id: 'x', rir: 9 })).resolves.toBe('ignored-invalid');
    await expect(handle(null)).resolves.toBe('ignored-invalid');
    expect(log).not.toHaveBeenCalled();
    expect(deps.goToBlock).not.toHaveBeenCalled();
  });

  it('ignores commands when no workout is running', async () => {
    const { handle, log, deps } = setup({ context: null });
    await expect(handle(logSet())).resolves.toBe('ignored-no-workout');
    expect(log).not.toHaveBeenCalled();
    expect(deps.resendState).toHaveBeenCalled();
  });

  it('navigates next / previous from the current block', async () => {
    const { handle, deps } = setup();
    await expect(
      handle({ type: 'navigate', id: 'n1', sessionId: 's1', blockId: 'b1', direction: 'next' })
    ).resolves.toBe('navigated');
    expect(deps.goToBlock).toHaveBeenLastCalledWith(2);
    await handle({ type: 'navigate', id: 'n2', sessionId: 's1', blockId: 'b1', direction: 'prev' });
    expect(deps.goToBlock).toHaveBeenLastCalledWith(0);
  });

  it('refuses navigation from a block the phone is no longer on', async () => {
    const { handle, deps } = setup();
    await expect(
      handle({ type: 'navigate', id: 'n1', sessionId: 's1', blockId: 'b0', direction: 'next' })
    ).resolves.toBe('refused-stale');
    expect(deps.goToBlock).not.toHaveBeenCalled();
  });

  it('hands finish to the phone and answers state requests', async () => {
    const { handle, deps } = setup();
    await expect(handle({ type: 'finish', id: 'f1', sessionId: 's1' })).resolves.toBe('finish');
    expect(deps.finishWorkout).toHaveBeenCalledTimes(1);
    await expect(handle({ type: 'requestState', id: 'r1' })).resolves.toBe('state-sent');
    expect(deps.resendState).toHaveBeenCalled();
  });
});

describe('queued wrist logs (phone app was closed)', () => {
  it('handles back-to-back logs in order, waiting for the set number to advance', async () => {
    let setNumber = 1;
    const order: string[] = [];
    const log = jest.fn(async () => {
      order.push(`log set ${setNumber}`);
    });
    const handle = createWatchMessageHandler({
      getContext: () => ({
        sessionId: 's1',
        blocks: [{ id: 'b1' }],
        currentBlockIndex: 0,
        skippedBlockIds: new Set(),
      }),
      getActiveLogger: () => ({ snapshot: { ...snapshot, setNumber }, log }),
      goToBlock: jest.fn(),
      finishWorkout: jest.fn(),
      resendState: jest.fn(),
      // The card re-renders with the next set a moment after the log.
      waitForLoggerAdvance: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            setNumber += 1;
            resolve();
          }, 5)
        ),
    });

    const first = handle(logSet({ id: 'q1', setNumber: 1 }));
    const second = handle(logSet({ id: 'q2', setNumber: 2 }));
    await expect(first).resolves.toBe('logged');
    await expect(second).resolves.toBe('logged');
    expect(order).toEqual(['log set 1', 'log set 2']);
  });
});
