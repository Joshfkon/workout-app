/**
 * The adaptive-volume windows must be INSTANTS that tile, so a session is
 * counted in exactly one week whatever the device timezone.
 *
 * Runs under the repo's fixed test timezone AND asserts in local-time terms
 * (never against hard-coded UTC strings), so it holds in any zone.
 */
import {
  adaptiveVolumeWindows,
  adaptiveVolumeWindowIndex,
  setRirOrFallback,
  ADAPTIVE_VOLUME_HISTORY_WEEKS,
} from '../adaptiveVolumeWindows';
import {
  assessCurrentFatigueStatus,
  createInitialVolumeProfile,
  type MuscleVolumeData,
} from '../adaptive-volume';
import { resetClock, setClock } from '@/lib/clock';
import { createTestClock } from '@/test-utils/clock';

afterEach(resetClock);

/** Local wall-clock time on a given local day. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('adaptiveVolumeWindows', () => {
  const now = local(2026, 11, 12, 15, 30);
  const windows = adaptiveVolumeWindows(now);

  it('returns three windows, newest first, each starting at LOCAL midnight', () => {
    expect(windows).toHaveLength(ADAPTIVE_VOLUME_HISTORY_WEEKS);
    expect(windows.map((w) => w.startDay)).toEqual(['2026-11-06', '2026-10-30', '2026-10-23']);
    for (const w of windows) {
      const start = new Date(w.startISO);
      expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    }
    // The newest window ends at local midnight starting tomorrow.
    expect(new Date(windows[0].endISO).getTime()).toBe(local(2026, 11, 13).getTime());
  });

  it('tiles: each window ends exactly where the next-newer one starts', () => {
    expect(windows[1].endISO).toBe(windows[0].startISO);
    expect(windows[2].endISO).toBe(windows[1].startISO);
  });

  it("the review's case: 18:00 on the day BEFORE the window opens is last week only", () => {
    // Window opens 2026-11-06 00:00 local. A bare '2026-11-06' bound is read
    // by Postgres as midnight UTC — 16:00 on Nov 5 in UTC−8 — which put this
    // session in the current week AND the previous one.
    const eveningBefore = local(2026, 11, 5, 18, 0).toISOString();
    expect(adaptiveVolumeWindowIndex(eveningBefore, windows)).toBe(1);
  });

  it('boundaries are half-open — no instant belongs to two windows or to none', () => {
    const boundary = local(2026, 11, 6, 0, 0).toISOString();
    expect(adaptiveVolumeWindowIndex(boundary, windows)).toBe(0);
    const justBefore = new Date(local(2026, 11, 6).getTime() - 1).toISOString();
    expect(adaptiveVolumeWindowIndex(justBefore, windows)).toBe(1);
    // Late tonight is still this week; tomorrow is not in any window yet.
    expect(adaptiveVolumeWindowIndex(local(2026, 11, 12, 23, 59).toISOString(), windows)).toBe(0);
    expect(adaptiveVolumeWindowIndex(local(2026, 11, 13, 0, 0).toISOString(), windows)).toBe(-1);
  });

  it('is outside every window before the oldest one, and for junk input', () => {
    expect(adaptiveVolumeWindowIndex(local(2026, 10, 22, 23, 0).toISOString(), windows)).toBe(-1);
    expect(adaptiveVolumeWindowIndex(null, windows)).toBe(-1);
    expect(adaptiveVolumeWindowIndex('not a date', windows)).toBe(-1);
  });

  it('steps by calendar days across a DST change (windows still start at local midnight)', () => {
    // US DST ended 2026-11-01; a +24h step would land an hour off.
    const acrossDst = adaptiveVolumeWindows(local(2026, 11, 4, 9, 0));
    expect(acrossDst.map((w) => w.startDay)).toEqual(['2026-10-29', '2026-10-22', '2026-10-15']);
    for (const w of acrossDst) expect(new Date(w.startISO).getHours()).toBe(0);
  });

  it('follows the application clock by default', () => {
    setClock(createTestClock(local(2026, 3, 10, 8, 0)));
    expect(adaptiveVolumeWindows()[0].startDay).toBe('2026-03-04');
  });
});

describe('setRirOrFallback', () => {
  it('reads the RIR-2 chip (stored RPE 7.5) as 2, not 2.5', () => {
    expect(setRirOrFallback({ rpe: 7.5 }, 3)).toBe(2);
  });

  it('prefers the logged chip over the RPE', () => {
    expect(setRirOrFallback({ rpe: 10, feedback: { repsInTank: 3 } }, 2)).toBe(3);
    expect(setRirOrFallback({ rpe: 6, feedback: { repsInTank: 0 } }, 2)).toBe(0);
  });

  it('falls back only when the set carries no effort signal', () => {
    expect(setRirOrFallback({}, 3)).toBe(3);
    expect(setRirOrFallback({ rpe: null, feedback: null }, 2)).toBe(2);
  });
});

describe('fatigue alerts need history — the input the hook now supplies', () => {
  const week = (id: string, sets: number): MuscleVolumeData =>
    ({
      id,
      muscle: 'chest',
      weekNumber: 1,
      mesocycleId: '',
      totalSets: sets,
      workingSets: sets,
      effectiveSets: sets,
      effectiveVolumeSets: sets,
      totalVolume: 0,
      averageRIR: 2,
      averageFormScore: 0.8,
      exercisePerformance: [],
    }) as MuscleVolumeData;

  const profile = createInitialVolumeProfile('u1', 'intermediate');
  const mrv = profile.muscleTolerance.chest.estimatedMRV;

  it('one week alone can never alert (the old input)', () => {
    expect(assessCurrentFatigueStatus([week('now', mrv)], profile)).toEqual([]);
  });

  it('previous + current weeks let the approaching-MRV alert fire, on the CURRENT week', () => {
    const alerts = assessCurrentFatigueStatus([week('prev', 8), week('now', mrv)], profile);
    expect(alerts.map((a) => a.type)).toContain('approaching_mrv');
    // Oldest-first order matters: with the weeks reversed the "current" week
    // would be the light one and nothing should fire.
    expect(assessCurrentFatigueStatus([week('now', mrv), week('prev', 8)], profile)).toEqual([]);
  });
});
