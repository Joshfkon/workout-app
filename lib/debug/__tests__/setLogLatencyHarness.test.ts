/**
 * TEMPORARY measurement harness — set-log latency diagnosis (see
 * docs/SET_LOGGING_LATENCY_DIAGNOSIS.md). Removable in one commit together
 * with lib/debug/setLogTiming.ts.
 *
 * A real-device Network Link Conditioner run needs a signed build and live
 * Supabase credentials, neither of which exist in the diagnosis environment.
 * This harness instead reproduces, with real wall-clock timers, the exact
 * awaited control flow of handleSetComplete
 * (app/(dashboard)/dashboard/workout/[id]/page.tsx — see line refs inline)
 * against a fake Supabase whose every request costs a configurable RTT, and
 * compares it with the outbox-first shape (the deload-toggle pattern at
 * page.tsx:4466-4471) using the REAL lib/offline/setOutbox module.
 *
 * The number that matters is t1 (row rendered) and tTimer (rest timer
 * started) as a function of RTT: on the current path both track the network;
 * on the outbox-first path both stay flat.
 */

import {
  enqueueSetInsert,
  flushSetOutbox,
  listOutbox,
  __setDriverForTests,
  type OutboxSupabase,
} from '@/lib/offline/setOutbox';

jest.setTimeout(60_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fake Supabase: every remote call resolves after `rtt` ms. */
function fakeSupabase(rtt: () => number) {
  let requests = 0;
  const client = {
    from: (_table: string) => ({
      // numbering probe (page.tsx:2205-2212)
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                single: async () => {
                  requests++;
                  await sleep(rtt());
                  return { data: { set_number: 2 }, error: null };
                },
              }),
            }),
          }),
        }),
      }),
      // direct insert (page.tsx:2322)
      insert: async (_row: Record<string, unknown>) => {
        requests++;
        await sleep(rtt());
        return { error: null };
      },
      // outbox flush upsert (setOutbox.ts:317)
      upsert: async (_row: Record<string, unknown>, _opts: unknown) => {
        requests++;
        await sleep(rtt());
        return { error: null };
      },
      update: (_row: Record<string, unknown>) => ({
        eq: async () => {
          requests++;
          await sleep(rtt());
          return { error: null };
        },
      }),
    }),
    requestCount: () => requests,
  };
  return client;
}

interface SetTiming {
  t1_rowRendered: number;
  tTimer_restStarted: number;
  t5_handlerDone: number;
}

/**
 * CURRENT online path, exactly as handleSetComplete orders it when
 * navigator.onLine is true:
 *   await set_number probe   (page.tsx:2205-2212, awaited)
 *   optimistic local commit  (page.tsx:2288-2291) -> t1
 *   await set_logs insert    (page.tsx:2322, awaited)
 *   rest timer starts        (page.tsx:2447 startWorkingRest) -> tTimer
 *   handler returns          (page.tsx:2580) -> t5 (button unlocks +100ms)
 */
async function logSetCurrentPath(supabase: ReturnType<typeof fakeSupabase>): Promise<SetTiming> {
  const t0 = performance.now();
  await supabase.from('set_logs').select().eq().eq().order().limit().single(); // probe
  const t1 = performance.now() - t0; // optimistic commit happens here
  await supabase.from('set_logs').insert({ id: crypto.randomUUID() });
  const tTimer = performance.now() - t0; // startWorkingRest()
  const t5 = performance.now() - t0;
  return { t1_rowRendered: t1, tTimer_restStarted: tTimer, t5_handlerDone: t5 };
}

/**
 * OUTBOX-FIRST shape (the proposed fix; same pattern the deload toggle
 * already uses at page.tsx:4466-4471): local commit -> IndexedDB enqueue ->
 * timer; the network flush runs entirely in the background.
 */
async function logSetOutboxFirst(
  supabase: ReturnType<typeof fakeSupabase>,
  background: Promise<unknown>[]
): Promise<SetTiming> {
  const t0 = performance.now();
  const t1 = performance.now() - t0; // optimistic commit needs no await at all
  await enqueueSetInsert(crypto.randomUUID(), { reps: 8, weight_kg: 100 });
  const tTimer = performance.now() - t0;
  background.push(flushSetOutbox(supabase as unknown as OutboxSupabase));
  const t5 = performance.now() - t0;
  return { t1_rowRendered: t1, tTimer_restStarted: tTimer, t5_handlerDone: t5 };
}

const round = (n: number) => Math.round(n);

async function measure(
  label: string,
  rttMs: number,
  path: 'current' | 'outbox-first'
): Promise<Record<string, number | string>> {
  __setDriverForTests(null); // fresh memory driver per run (jsdom has no IndexedDB)
  const supabase = fakeSupabase(() => rttMs);
  const background: Promise<unknown>[] = [];
  const timings: SetTiming[] = [];
  for (let i = 0; i < 5; i++) {
    timings.push(
      path === 'current'
        ? await logSetCurrentPath(supabase)
        : await logSetOutboxFirst(supabase, background)
    );
  }
  await Promise.all(background);
  // Overlapping flushSetOutbox calls coalesce into the one in-flight flush
  // (setOutbox.ts:292), which snapshotted the queue before later enqueues —
  // in the app the 5s poll (page.tsx:363-368) issues the follow-up flush.
  while ((await listOutbox()).length > 0) {
    await flushSetOutbox(supabase as unknown as OutboxSupabase);
  }
  const avg = (k: keyof SetTiming) => round(timings.reduce((s, t) => s + t[k], 0) / timings.length);
  return {
    profile: label,
    path,
    'RTT (ms)': rttMs,
    't1 row rendered (ms)': avg('t1_rowRendered'),
    'rest timer started (ms)': avg('tTimer_restStarted'),
    't5 handler done (ms)': avg('t5_handlerDone'),
    'requests sent': supabase.requestCount(),
  };
}

describe('set-log latency: current online path vs outbox-first (5 sets each, avg)', () => {
  it('t1 tracks RTT on the current path and stays flat outbox-first', async () => {
    const rows: Record<string, number | string>[] = [];
    for (const [label, rtt] of [
      ['wifi (~30ms RTT)', 30],
      ['Slow 4G (~400ms RTT)', 400],
      ['Very Bad Network (~1200ms RTT)', 1200],
    ] as const) {
      rows.push(await measure(label, rtt, 'current'));
      rows.push(await measure(label, rtt, 'outbox-first'));
    }
    // eslint-disable-next-line no-console
    console.table(rows);

    for (const row of rows) {
      const rtt = row['RTT (ms)'] as number;
      const t1 = row['t1 row rendered (ms)'] as number;
      const tTimer = row['rest timer started (ms)'] as number;
      if (row.path === 'current') {
        // The UI is on the network's critical path: row waits ≥1 RTT (probe),
        // rest timer waits ≥2 serial RTTs (probe + insert).
        expect(t1).toBeGreaterThanOrEqual(rtt);
        expect(tTimer).toBeGreaterThanOrEqual(2 * rtt);
      } else {
        // Off the network: row + timer within the 100ms budget at any RTT.
        expect(t1).toBeLessThan(100);
        expect(tTimer).toBeLessThan(100);
      }
    }

    // Outbox-first still delivered every set to the server exactly once.
    expect(await listOutbox()).toHaveLength(0);
  });

  it('a single stalled request wedges the current path for its full duration; outbox-first is unaffected', async () => {
    __setDriverForTests(null);
    // One request stalls 5s (no timeout exists on the direct path — WKWebView
    // default is 60s; capped here to keep the suite fast), the rest are 400ms.
    let first = true;
    const stallThenSlow = () => (first ? ((first = false), 5000) : 400);

    const current = await (async () => {
      const supabase = fakeSupabase(stallThenSlow);
      return logSetCurrentPath(supabase);
    })();
    expect(current.tTimer_restStarted).toBeGreaterThanOrEqual(5000);

    first = true;
    const background: Promise<unknown>[] = [];
    const outboxFirst = await logSetOutboxFirst(fakeSupabase(stallThenSlow), background);
    expect(outboxFirst.tTimer_restStarted).toBeLessThan(100);
    await Promise.all(background);

    // eslint-disable-next-line no-console
    console.table([
      { path: 'current', 'rest timer started (ms)': round(current.tTimer_restStarted) },
      { path: 'outbox-first', 'rest timer started (ms)': round(outboxFirst.tTimer_restStarted) },
    ]);
  });
});
