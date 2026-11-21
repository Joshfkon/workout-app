/**
 * The bridge must never await the Capacitor plugin proxy (it answers `then`
 * and never settles — see lib/integrations/__tests__/healthkitPlugin.test.ts).
 * The mock reproduces that proxy shape.
 */
const calls: Array<{ method: string; args: unknown[] }> = [];
let listener: ((event: { message: unknown }) => void) | null = null;
const remove = jest.fn();

jest.mock('@capacitor/core', () => ({
  registerPlugin: () =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return () => {};
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            if (prop === 'addListener') {
              listener = args[1] as typeof listener;
              return Promise.resolve({ remove });
            }
            if (prop === 'sendState') return Promise.reject(new Error('not implemented'));
            return Promise.resolve();
          };
        },
      }
    ),
}));

let native = true;
jest.mock('@/lib/integrations/capacitor-stub', () => ({
  Capacitor: { isNativePlatform: () => native, getPlatform: () => (native ? 'ios' : 'web') },
}));

import { addWatchMessageListener, sendWatchState } from '../watchBridge';
import { WATCH_INACTIVE_STATE } from '../protocol';

function settleWithin<T>(p: Promise<T>, ms = 500): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, reject) => setTimeout(() => reject(new Error('did not settle')), ms)),
  ]);
}

describe('watchBridge', () => {
  it('sendState settles even when the native side rejects (old app build)', async () => {
    await expect(settleWithin(sendWatchState(WATCH_INACTIVE_STATE))).resolves.toBeUndefined();
    expect(calls.find((c) => c.method === 'sendState')?.args[0]).toEqual({ state: WATCH_INACTIVE_STATE });
  });

  it('delivers raw messages and removes the native listener on unsubscribe', async () => {
    const received: unknown[] = [];
    const unsubscribe = addWatchMessageListener((m) => received.push(m));
    listener?.({ message: { type: 'requestState', id: 'r1' } });
    expect(received).toEqual([{ type: 'requestState', id: 'r1' }]);
    await Promise.resolve();
    await Promise.resolve();
    unsubscribe();
    expect(remove).toHaveBeenCalled();
  });
});
