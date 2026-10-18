/**
 * The HealthKit service must never await (or async-return) the Capacitor
 * plugin proxy. Capacitor's proxy answers every property — including `then` —
 * so awaiting it makes the promise wait on a `then` that never calls back.
 * That hung every HealthKit call in the iOS app: the Activity card never
 * offered Apple Health and the foreground sync never ran.
 *
 * The mock below reproduces that proxy shape: any unknown property is a
 * method, and `then` never settles.
 */

const nativeCalls: string[] = [];

jest.mock('@capacitor/core', () => ({
  registerPlugin: () =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return () => {}; // a thenable that never settles
          return (..._args: unknown[]) => {
            nativeCalls.push(String(prop));
            if (prop === 'isAvailable') return Promise.resolve({ available: true });
            if (prop === 'requestAuthorization') return Promise.resolve({});
            return Promise.resolve({ samples: [] });
          };
        },
      }
    ),
}));

jest.mock('../capacitor-stub', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}));

import { isHealthKitAvailable, requestHealthKitPermissions } from '../healthkit';

/** Fails instead of hanging when a promise never settles. */
function settleWithin<T>(promise: Promise<T>, ms = 500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms)
    ),
  ]);
}

describe('HealthKit plugin proxy handling', () => {
  beforeEach(() => {
    nativeCalls.length = 0;
  });

  it('isHealthKitAvailable resolves with a Capacitor-style (thenable) plugin proxy', async () => {
    await expect(settleWithin(isHealthKitAvailable())).resolves.toBe(true);
    expect(nativeCalls).toContain('isAvailable');
  });

  it('requestHealthKitPermissions resolves and asks for read-only access', async () => {
    await expect(settleWithin(requestHealthKitPermissions())).resolves.toMatchObject({
      granted: true,
    });
    expect(nativeCalls).toContain('requestAuthorization');
  });
});
