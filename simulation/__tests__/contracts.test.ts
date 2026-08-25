/**
 * Phase 3 §3.2 — the remaining explicit prescription contracts.
 *
 * The Set-3 contract and the empty-period contract are checked live during a
 * run (simulation/runner.ts). The two here are checked with DETERMINISTIC
 * FIXTURES instead, because that is what the spec asks for: "known pre-gap
 * history, known gap, known config → known expected ceiling". A stochastic run
 * can tell you a gap was handled oddly; only a fixture can tell you the
 * threshold is where the code says it is.
 *
 * WHAT IS BEING VERIFIED. Each of these asserts a rule production STATES about
 * itself, in a comment or a named constant, against the function that
 * implements it. None of them reconstructs the trend, anchor or plateau
 * algorithm — that would make a disagreement evidence about the harness.
 */
import { bestQualifyingE1RM, type AnchorCandidate } from '@/services/suggestionEngine/e1rmAnchor';
import { ANCHOR_MAX_AGE_DAYS } from '@/services/suggestionEngine/constants';
import { detectPlateau } from '@/services/plateauDetector';
import { assessProgress, scansInPhase } from '@/services/phaseAssessment';
import type { DexaScan, TrainingPhase } from '@/types/schema';

const DAY = 24 * 60 * 60 * 1000;
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();

// ---------------------------------------------------------------------------
// Training-gap handling
// ---------------------------------------------------------------------------

/**
 * The engine's documented staleness rule lives in
 * `suggestionEngine/constants.ANCHOR_MAX_AGE_DAYS`:
 *
 *   "a session only qualifies if it is within this many days of the NEWEST
 *    session … a 10-month-old pre-layoff peak can't anchor a comeback, while
 *    the newest session always qualifies by definition."
 *
 * That is exactly the contract the detrainer persona exists to probe, and until
 * now nothing asserted on it.
 */
describe('CONTRACT: a training gap is not treated as uninterrupted progression', () => {
  /** A strong pre-layoff peak, then a weaker comeback session `gapDays` later. */
  function comeback(gapDays: number): AnchorCandidate[] {
    const peakDay = day('2026-01-05');
    return [
      { e1rmKg: 150, sessionId: 'pre-layoff-peak', timeMs: peakDay },
      { e1rmKg: 148, sessionId: 'pre-layoff-2', timeMs: peakDay - 2 * DAY },
      { e1rmKg: 100, sessionId: 'comeback', timeMs: peakDay + gapDays * DAY },
    ];
  }

  it('a pre-layoff peak older than the window cannot anchor the comeback', () => {
    // 120 days > ANCHOR_MAX_AGE_DAYS (90): the peak is out of the pool, so the
    // anchor is the comeback session's own demonstrated capacity.
    const anchor = bestQualifyingE1RM(comeback(120));
    expect(anchor).toBe(100);
  });

  it('the same peak DOES anchor when the gap is inside the window', () => {
    // The mirror image. Without it, the test above would pass just as happily
    // if the anchor were broken and always returned the newest session.
    expect(bestQualifyingE1RM(comeback(30))).toBe(150);
  });

  it('the threshold is where the constant says it is', () => {
    // Exactly at the boundary the old session still qualifies (<=), one day
    // past it does not. Pins the comparison's direction, not just its rough
    // location — an off-by-one here silently changes comeback behaviour.
    expect(bestQualifyingE1RM(comeback(ANCHOR_MAX_AGE_DAYS))).toBe(150);
    expect(bestQualifyingE1RM(comeback(ANCHOR_MAX_AGE_DAYS + 1))).toBe(100);
  });

  it('a lifter who returns still gets an anchor — never zero', () => {
    // "the newest session always qualifies by definition". Returning 0 would
    // drop the caller to the cold-start path for an exercise with years of
    // history, which is the worse failure.
    expect(bestQualifyingE1RM(comeback(365))).toBe(100);
  });

  it('ages are measured session-to-session, not against wall-clock today', () => {
    // The constant is explicit: "never of today". Two candidate sets with the
    // same internal spacing must produce the same anchor however old they are.
    const recent = comeback(120);
    const ancient = recent.map((c) => ({ ...c, timeMs: c.timeMs - 5 * 365 * DAY }));
    expect(bestQualifyingE1RM(ancient)).toBe(bestQualifyingE1RM(recent));
  });
});

/**
 * The other documented staleness rule, in plateauDetector:
 *   "No alert when the exercise hasn't been trained within this many weeks of
 *    the reference date — an exercise you stopped doing isn't plateaued."
 */
describe('CONTRACT: a stale exercise is not reported as plateaued', () => {
  /** Flat e1RM across six sessions — a plateau by any reading, if it were current. */
  const flatHistory = Array.from({ length: 6 }, (_, i) => ({
    exerciseId: 'ex-bench',
    sessionDate: `2026-01-${String(5 + i * 5).padStart(2, '0')}`,
    estimatedE1RM: 120,
    topSetWeight: 100,
    topSetReps: 8,
    topSetRpe: 8,
    totalWorkingSets: 3,
  })) as never;

  it('flat history IS a plateau while the exercise is current', () => {
    const result = detectPlateau({
      exerciseId: 'ex-bench',
      snapshots: flatHistory,
      referenceDate: '2026-02-05', // days after the last session
    });
    expect(result.isPlateaued).toBe(true);
  });

  it('the same flat history is NOT a plateau once it goes stale', () => {
    // Same data, reference date pushed past the 6-week staleness window. An
    // engine that alerted here would nag a lifter about an exercise they
    // deliberately stopped doing.
    const result = detectPlateau({
      exerciseId: 'ex-bench',
      snapshots: flatHistory,
      referenceDate: '2026-06-01',
    });
    expect(result.isPlateaued).toBe(false);
  });

  it('going stale does not throw, produce NaN, or lose the last known e1RM', () => {
    const result = detectPlateau({
      exerciseId: 'ex-bench',
      snapshots: flatHistory,
      referenceDate: '2027-06-01',
    });
    expect(Number.isFinite(result.currentE1RM)).toBe(true);
    expect(result.currentE1RM).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Phase isolation
// ---------------------------------------------------------------------------

/**
 * `assessProgress` states the rule in its own body:
 *   "In-phase weigh-ins only — a trend must never cross the phase boundary."
 *
 * The test strategy is deliberately indirect: rather than recomputing the
 * trend, add records OUTSIDE the phase that would wreck it if consumed, and
 * assert the assessment is byte-identical to the run without them. That
 * verifies the filtering contract without owning a second trend algorithm.
 */
describe('CONTRACT: phase-scoped trends do not consume out-of-phase records', () => {
  /**
   * FIXTURE DESIGN — the first version of this was worthless, and mutation
   * testing is what proved it. Recorded so nobody re-derives it.
   *
   * `assessProgress` also narrows weigh-ins to a trailing 21-day window. Put
   * the out-of-phase records months earlier and THAT window hides them, so the
   * test passes whether the phase boundary is enforced or not. The wrecking
   * records below therefore sit INSIDE the trailing window and OUTSIDE the
   * phase, which is the only placement where phase scoping is what excludes
   * them.
   *
   * WHAT MUTATION TESTING THEN REVEALED — a genuinely good property of the
   * production code. Phase scoping here is DEFENCE IN DEPTH: `assessProgress`
   * filters weigh-ins to the phase, and `rateOverTrailing` independently
   * floors its window at `phaseStart`. Removing either one alone changes
   * nothing. Only with BOTH removed does this fixture break through, and it
   * breaks hard — the assessment flips from "-1.0 lb/wk, on track" to
   * "-23.3 lb/wk, losing too fast".
   *
   * So these two tests assert the observable contract (out-of-phase records
   * change nothing) rather than either mechanism, and they are verified to
   * fail when the contract is genuinely breached.
   */
  const PHASE_START = '2026-03-25';
  const TODAY = '2026-04-05';

  const PHASE: TrainingPhase = {
    id: 'phase-1',
    userId: 'u1',
    phaseType: 'cut',
    startDay: PHASE_START,
    endDay: null,
    targetRateLbsPerWeek: -1,
  } as unknown as TrainingPhase;

  /** Daily weigh-ins inside the phase, losing ~1 lb/week from 200. */
  const inPhase = Array.from({ length: 12 }, (_, i) => ({
    date: i < 7 ? `2026-03-${25 + i}` : `2026-04-0${i - 6}`,
    weightLb: 200 - i * (1 / 7),
  }));

  /**
   * Nine days at 260 lb, inside the trailing window but BEFORE the phase
   * starts. If the boundary check goes, these enter the trend and turn a
   * 1 lb/week cut into a ~7 lb/week collapse.
   */
  const beforePhase = Array.from({ length: 9 }, (_, i) => ({
    date: `2026-03-${16 + i}`,
    weightLb: 260,
  }));

  const run = (weighIns: typeof inPhase) =>
    assessProgress({ phase: PHASE, today: TODAY, weighIns, scans: [] });

  it('the fixture produces a real assessment, not a no-data shrug', () => {
    // Guards the test itself: if the in-phase data were insufficient, both
    // sides below would be identically empty and the contract untested.
    const assessment = run(inPhase);
    expect(assessment.status).not.toBe('no_phase');
    expect(assessment.details.length).toBeGreaterThan(0);
  });

  it('the out-of-phase records are positioned to actually matter', () => {
    // If these fell outside the trailing weigh-in window, the boundary check
    // would never be the thing excluding them and the test below would be
    // vacuous. Assert the placement explicitly rather than trusting it.
    const windowStart = '2026-03-16'; // TODAY - 20 days
    for (const w of beforePhase) {
      expect(w.date >= windowStart).toBe(true); // inside the trailing window
      expect(w.date < PHASE_START).toBe(true); // outside the phase
    }
  });

  it('adding 60 lb of pre-phase weigh-ins changes nothing', () => {
    const withoutHistory = run(inPhase);
    const withHistory = run([...beforePhase, ...inPhase]);
    expect(withHistory).toEqual(withoutHistory);
  });

  it('order of the out-of-phase records does not matter either', () => {
    // A filter that happened to work only because the extra rows sorted to one
    // end would pass the test above and fail this one.
    const shuffled = [...inPhase.slice(6), ...beforePhase, ...inPhase.slice(0, 6)];
    expect(run(shuffled)).toEqual(run(inPhase));
  });

  it('scansInPhase keeps the boundary days and drops everything outside', () => {
    const scan = (scanDate: string): DexaScan =>
      ({ id: scanDate, scanDate, bodyFatPercent: 15, leanMassKg: 70 }) as unknown as DexaScan;
    const kept = scansInPhase(
      [
        scan('2026-02-28'), // one day before — out
        scan('2026-03-01'), // start day — in
        scan('2026-03-15'),
        scan('2026-04-05'), // end day — in
        scan('2026-04-06'), // one day after — out
      ],
      '2026-03-01',
      '2026-04-05'
    );
    expect(kept.map((s) => s.scanDate)).toEqual(['2026-03-01', '2026-03-15', '2026-04-05']);
  });

  it('scansInPhase returns them in ascending date order regardless of input order', () => {
    const scan = (scanDate: string): DexaScan =>
      ({ id: scanDate, scanDate }) as unknown as DexaScan;
    const kept = scansInPhase(
      [scan('2026-03-20'), scan('2026-03-02'), scan('2026-03-11')],
      '2026-03-01',
      '2026-04-05'
    );
    expect(kept.map((s) => s.scanDate)).toEqual(['2026-03-02', '2026-03-11', '2026-03-20']);
  });
});
