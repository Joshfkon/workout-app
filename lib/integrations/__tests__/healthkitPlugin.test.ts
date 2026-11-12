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
const nativeArgs: Record<string, unknown[]> = {};
let checkAuthorizationResult: Promise<unknown> = Promise.resolve({
  readAuthorized: [],
  readDenied: [],
});

jest.mock('@capacitor/core', () => ({
  registerPlugin: () =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return () => {}; // a thenable that never settles
          return (..._args: unknown[]) => {
            nativeCalls.push(String(prop));
            (nativeArgs[String(prop)] ??= []).push(_args[0]);
            if (prop === 'checkAuthorization') return checkAuthorizationResult;
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

import {
  isHealthKitAvailable,
  requestHealthKitPermissions,
  healthKitNeedsAuthorizationRequest,
  fetchHealthKitSteps,
  fetchHealthKitActiveEnergy,
  fetchHealthKitDailyRestingHeartRate,
  startOfLocalDay,
} from '../healthkit';

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
    for (const key of Object.keys(nativeArgs)) delete nativeArgs[key];
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

describe('per-install authorization probe', () => {
  beforeEach(() => {
    nativeCalls.length = 0;
  });

  it('reports no request needed once every read type has been decided', async () => {
    checkAuthorizationResult = Promise.resolve({
      readAuthorized: ['steps', 'calories', 'sleep', 'heartRateVariability', 'restingHeartRate'],
      readDenied: [],
    });
    await expect(settleWithin(healthKitNeedsAuthorizationRequest())).resolves.toBe(false);
    expect(nativeCalls).toEqual(['checkAuthorization']);
  });

  it('reports a request is needed when this install was never asked', async () => {
    checkAuthorizationResult = Promise.resolve({
      readAuthorized: [],
      readDenied: ['steps', 'calories', 'sleep', 'heartRateVariability', 'restingHeartRate'],
    });
    await expect(settleWithin(healthKitNeedsAuthorizationRequest())).resolves.toBe(true);
  });

  it('never claims a request is needed when the check itself fails', async () => {
    checkAuthorizationResult = Promise.reject(new Error('bridge error'));
    await expect(settleWithin(healthKitNeedsAuthorizationRequest())).resolves.toBe(false);
    expect(nativeCalls).not.toContain('requestAuthorization');
  });
});

describe('daily aggregates always query whole local days', () => {
  beforeEach(() => {
    for (const key of Object.keys(nativeArgs)) delete nativeArgs[key];
  });

  // A sync window opens 36h behind the last pull — mid-afternoon, say. The
  // plugin only counts samples starting inside the window, so an unaligned
  // start makes the first day's bucket a partial total that then overwrites
  // the day's real one.
  const midAfternoon = new Date(2026, 6, 11, 15, 42, 10);
  const end = new Date(2026, 6, 13, 9, 0, 0);

  it.each([
    ['steps', () => fetchHealthKitSteps(midAfternoon, end)],
    ['active energy', () => fetchHealthKitActiveEnergy(midAfternoon, end)],
    ['resting heart rate', () => fetchHealthKitDailyRestingHeartRate(midAfternoon, end)],
  ])('%s', async (_label, run) => {
    await settleWithin<unknown>(run());

    const options = nativeArgs.queryAggregated[0] as { startDate: string; endDate: string };
    const start = new Date(options.startDate);
    expect(start.getTime()).toBe(new Date(2026, 6, 11, 0, 0, 0, 0).getTime());
    expect(new Date(options.endDate).getTime()).toBe(end.getTime());
  });

  it('startOfLocalDay leaves the input untouched', () => {
    const input = new Date(midAfternoon);
    expect(startOfLocalDay(input).getHours()).toBe(0);
    expect(input.getTime()).toBe(midAfternoon.getTime());
  });
});
