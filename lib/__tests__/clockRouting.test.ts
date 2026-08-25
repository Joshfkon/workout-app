/**
 * Guardrail: the training engine and its data layer read "now" from
 * `lib/clock`, not from `new Date()` / `Date.now()`.
 *
 * Two complementary checks:
 *
 *  1. BEHAVIOURAL — install a controllable clock and assert that a
 *     representative slice of the training surface actually moves with it.
 *     These are the paths a simulated user drives; if any of them silently
 *     reverted to the wall clock, a six-month simulated run would compute its
 *     windows against the real calendar and the failure would look like an
 *     engine bug rather than a harness one.
 *
 *  2. STATIC — scan the routed modules' source for bare clock reads, so a
 *     future edit can't reintroduce one without this test failing. Modelled on
 *     `services/shared/motion/__tests__/importGuard.test.ts`.
 *
 * Purely visual clock reads (animations, rest-timer readouts, relative-time
 * labels, performance instrumentation) are deliberately NOT covered — see the
 * scope note in `lib/clock.ts`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetClock, setClock } from '@/lib/clock';
import { createTestClock } from '@/test-utils/clock';

import { buildTrainingSchedule, nextTrainingDate } from '@/lib/training/trainingSchedule';
import { computeCurrentWeek } from '@/lib/training/mesocycleProgress';
import { planPhaseSwitch } from '@/services/phasePlanning';
import { rangeStartLocalDay } from '@/services/volumeTrendsData';
import { createPlateauAlert } from '@/services/plateauDetector';
import { detectDiscomfortPatterns } from '@/services/discomfortTracker';
import {
  __setDriverForTests,
  enqueueSetInsert,
  listOutbox,
  type OutboxEntry,
} from '@/lib/offline/setOutbox';

afterEach(() => {
  resetClock();
  __setDriverForTests(null);
});

function memoryDriver() {
  const map = new Map<string, OutboxEntry>();
  return {
    put: async (e: OutboxEntry) => { map.set(e.id, { ...e }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id: string) => { map.delete(id); },
    get: async (id: string) => map.get(id),
  };
}

describe('training schedule follows the clock', () => {
  const schedule = buildTrainingSchedule({
    days_per_week: 3,
    preferred_workout_days: ['Monday', 'Wednesday', 'Friday'],
    schedule_mode: 'fixed_days',
    start_date: '2026-04-06',
  });

  it('nextTrainingDate defaults "from" to simulated now', () => {
    // 2026-04-21 is a Tuesday; the next Mon/Wed/Fri day is Wednesday the 22nd.
    setClock(createTestClock('2026-04-21T10:00:00'));
    expect(nextTrainingDate(schedule)?.date.getDate()).toBe(22);
  });

  it('moves when the clock moves', () => {
    const clock = createTestClock('2026-04-21T10:00:00');
    setClock(clock);
    expect(nextTrainingDate(schedule)?.date.getDate()).toBe(22);
    clock.advanceDays(2); // now Thursday the 23rd -> next is Friday the 24th
    expect(nextTrainingDate(schedule)?.date.getDate()).toBe(24);
  });

  it('an explicit "from" still wins over the clock', () => {
    setClock(createTestClock('2026-04-21T10:00:00'));
    expect(nextTrainingDate(schedule, new Date('2026-04-23T10:00:00'))?.date.getDate()).toBe(24);
  });
});

describe('mesocycle week derivation follows the clock', () => {
  it('advances a week when the clock advances a week', () => {
    const clock = createTestClock('2026-04-06T09:00:00');
    setClock(clock);
    expect(computeCurrentWeek('2026-04-06', 6).week).toBe(1);
    clock.advanceWeeks(1);
    expect(computeCurrentWeek('2026-04-06', 6).week).toBe(2);
    clock.advanceWeeks(3);
    expect(computeCurrentWeek('2026-04-06', 6).week).toBe(5);
  });

  it('reports completion once the block is fully elapsed', () => {
    const clock = createTestClock('2026-04-06T09:00:00');
    setClock(clock);
    expect(computeCurrentWeek('2026-04-06', 6).isComplete).toBe(false);
    clock.advanceWeeks(6);
    expect(computeCurrentWeek('2026-04-06', 6).isComplete).toBe(true);
  });

  it('a late-evening read stays on the local day, not the UTC one', () => {
    // 23:30 local on the 12th is the 13th in UTC. A UTC-based derivation would
    // report the next week a day early on the boundary.
    setClock(createTestClock('2026-04-12T23:30:00'));
    expect(computeCurrentWeek('2026-04-06', 6).week).toBe(1);
    setClock(createTestClock('2026-04-13T00:30:00'));
    expect(computeCurrentWeek('2026-04-06', 6).week).toBe(2);
  });
});

describe('phase planning follows the clock', () => {
  it('opens the new phase on the simulated local day', () => {
    setClock(createTestClock('2026-05-11T22:00:00'));
    const plan = planPhaseSwitch([], 'cut');
    expect(plan.noop).toBeFalsy();
    expect(plan.open?.startDay).toBe('2026-05-11');
  });
});

describe('analytics ranges follow the clock', () => {
  it('a 7-day range starts six local days back, at local midnight', () => {
    setClock(createTestClock('2026-04-24T23:45:00'));
    const start = rangeStartLocalDay('7d')!;
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(18);
    expect(start.getHours()).toBe(0);
  });

  it('"all" has no start', () => {
    setClock(createTestClock('2026-04-24T23:45:00'));
    expect(rangeStartLocalDay('all')).toBeNull();
  });
});

describe('output timestamps follow the clock', () => {
  it('a plateau alert is stamped with simulated now', () => {
    setClock(createTestClock('2026-07-01T08:00:00Z'));
    const alert = createPlateauAlert('u1', 'e1', {
      isPlateaued: true,
      weeksSinceProgress: 4,
      suggestions: [],
    } as unknown as Parameters<typeof createPlateauAlert>[2]);
    expect(alert?.detectedAt).toBe('2026-07-01T08:00:00.000Z');
  });

  it('an outbox entry is stamped with simulated now', async () => {
    __setDriverForTests(memoryDriver());
    const clock = createTestClock('2026-07-01T08:00:00Z');
    setClock(clock);
    await enqueueSetInsert('set-1', { id: 'set-1' });
    clock.advanceMinutes(3);
    await enqueueSetInsert('set-2', { id: 'set-2' });

    const entries = await listOutbox();
    expect(entries.map((e) => e.id)).toEqual(['set-1', 'set-2']);
    // Ordering is by enqueuedAt, and the gap is simulated, not wall-clock.
    expect(entries[1].enqueuedAt - entries[0].enqueuedAt).toBe(180_000);
  });
});

describe('trailing windows follow the clock', () => {
  it('discomfort pattern detection windows against simulated now', () => {
    const entry = (loggedAt: string) => ({
      id: loggedAt,
      userId: 'u1',
      loggedAt,
      exerciseId: 'e1',
      exerciseName: 'Back Squat',
      discomfort: { bodyPart: 'knee' as const, severity: 'discomfort' as const },
      setNumber: 1,
      weightKg: 100,
    });
    const entries = [
      entry('2026-06-10T10:00:00Z'),
      entry('2026-06-12T10:00:00Z'),
      entry('2026-06-14T10:00:00Z'),
    ] as unknown as Parameters<typeof detectDiscomfortPatterns>[0];

    // Inside the 14-day window: the entries are visible.
    setClock(createTestClock('2026-06-20T10:00:00Z'));
    const inWindow = detectDiscomfortPatterns(entries, 14);

    // Two months later the same entries have aged out entirely.
    setClock(createTestClock('2026-08-20T10:00:00Z'));
    const aged = detectDiscomfortPatterns(entries, 14);

    expect(inWindow.length).toBeGreaterThan(0);
    expect(aged).toHaveLength(0);
  });
});

describe('static guard: no bare clock reads in the routed modules', () => {
  /**
   * Every module routed through the seam. Adding a training module here is the
   * point — it is how the convention stays true as the code grows.
   */
  const ROUTED = [
    'services/weightEstimationEngine.ts',
    'services/performanceTracker.ts',
    'services/plateauDetector.ts',
    'services/exerciseVarietyService.ts',
    'services/discomfortTracker.ts',
    'services/phasePlanning.ts',
    'services/volumeTrendsData.ts',
    'services/exerciseService.ts',
    'services/mesocycleHelpers.ts',
    'services/rpeCalibration.ts',
    'services/sanityChecks.ts',
    'lib/utils.ts',
    'lib/date/localDay.ts',
    'lib/offline/setOutbox.ts',
    'lib/training/coachingService.ts',
    'lib/training/deloadRecommendation.ts',
    'lib/training/enhancedAthleteMode.ts',
    'lib/training/mesocycleProgress.ts',
    'lib/training/programEngine.ts',
    'lib/training/startMesocycleSession.ts',
    'lib/training/startTemplateWorkout.ts',
    'lib/training/trainingSchedule.ts',
    'lib/training/transferCandidates.ts',
    'lib/training/weeklyRollover.ts',
    'app/(dashboard)/dashboard/workout/_lib/adhocSession.ts',
    'app/(dashboard)/dashboard/workout/[id]/_lib/postSessionMeso.ts',
    'app/(dashboard)/dashboard/workout/[id]/_lib/muscleFeedbackWrites.ts',
    'app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts',
  ];

  /**
   * `new Date()` with no arguments, and `Date.now()`. Parsing a supplied value
   * (`new Date(row.completed_at)`) is fine and must not trip this.
   */
  const BARE_CLOCK_READ = /new Date\(\s*\)|Date\.now\(\s*\)/;

  /**
   * Justified exceptions, matched as substrings of the offending line. Keep
   * this list short and each entry explained — an exception without a reason
   * is how a convention rots.
   */
  const ALLOWED: Record<string, { snippet: string; why: string }[]> = {
    // Entropy for a synthetic id, not a reading of the current time. Routing it
    // through the clock would make ids COLLIDE under a frozen simulated clock.
    'lib/utils.ts': [
      { snippet: 'Math.random().toString(36)', why: 'id entropy, not a clock read' },
    ],
  };

  it.each(ROUTED)('%s reads the clock through lib/clock', (relPath) => {
    const source = readFileSync(join(process.cwd(), relPath), 'utf8');
    const allowed = ALLOWED[relPath] ?? [];
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => BARE_CLOCK_READ.test(line))
      // Prose in doc comments explains WHY the seam exists and names the very
      // constructs it replaced; only real code counts.
      .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//'))
      .filter(({ line }) => !allowed.some((a) => line.includes(a.snippet)));

    expect(
      offenders.map((o) => `${relPath}:${o.n}  ${o.line}`)
    ).toEqual([]);
  });

  it('the guard would actually catch a regression', () => {
    // Cheap self-check: the pattern must match what it claims to, and must not
    // flag legitimate date parsing.
    expect(BARE_CLOCK_READ.test('const t = new Date();')).toBe(true);
    expect(BARE_CLOCK_READ.test('const t = Date.now();')).toBe(true);
    expect(BARE_CLOCK_READ.test("const t = new Date(row.completed_at);")).toBe(false);
    expect(BARE_CLOCK_READ.test('const t = clockNow();')).toBe(false);
  });
});
