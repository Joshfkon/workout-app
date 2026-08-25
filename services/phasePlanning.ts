/**
 * Phase Planning
 *
 * Pure helpers for the training-phase editor:
 * - span invariants (no overlap, one active phase, start <= end)
 * - boundary-shift proposals when an edit would collide with a neighbor
 * - first-run auto-suggest: segment weight history into phase candidates
 *
 * All days are localDay strings (YYYY-MM-DD); comparison is lexicographic and
 * arithmetic goes through lib/date/localDay. No database access here.
 */

import type { TrainingPhase, PhaseType } from '@/types/schema';
import type { WeighIn } from '@/lib/nutrition/interval-tdee';
import { addLocalDays, localDay, localDaysBetweenDays } from '@/lib/date/localDay';

import { now as clockNow } from '@/lib/clock';

// === BASIC SELECTORS ===

/** Phases sorted by startDay ascending. */
export function sortPhases<T extends Pick<TrainingPhase, 'startDay'>>(phases: T[]): T[] {
  return [...phases].sort((a, b) => a.startDay.localeCompare(b.startDay));
}

/** The phase covering `day`, or null (gaps are legal untracked periods). */
export function phaseOnDay(phases: TrainingPhase[], day: string): TrainingPhase | null {
  return (
    phases.find((p) => p.startDay <= day && (p.endDay === null || day <= p.endDay)) ?? null
  );
}

/** The active phase: endDay null, or an end date still in the future. */
export function activePhase(phases: TrainingPhase[], today: string): TrainingPhase | null {
  return phaseOnDay(phases, today);
}

// === QUICK-SWITCHER SYNC (training_phases is the source of truth) ===

/**
 * Default signed weekly target (lb) a quick-switcher flip stamps on the span
 * it opens. Deliberately conservative; the phase editor can refine it.
 */
export const SWITCHER_DEFAULT_TARGET: Record<PhaseType, number | null> = {
  bulk: 0.5,
  cut: -0.75,
  recomp: null,
  maintenance: null,
};

/**
 * users.goal is a Postgres enum WITHOUT 'recomp' (initial_schema.sql), so a
 * recomp span mirrors to 'maintenance' — the closest derived value. The span
 * keeps the real type; users.goal is a back-compat mirror only.
 */
export function phaseTypeToProfileGoal(type: PhaseType): 'bulk' | 'cut' | 'maintenance' {
  return type === 'recomp' ? 'maintenance' : type;
}

export interface PhaseSwitchPlan {
  /** True when the active span already has this type — write nothing. */
  noop: boolean;
  /** Close the currently active span at yesterday (localDay). */
  close?: { id: string; endDay: string };
  /**
   * Same-day flip: the active span was opened TODAY, so closing it at
   * yesterday would invert the span — retype it in place instead of
   * fragmenting.
   */
  retype?: { id: string; phaseType: PhaseType; targetRateLbsPerWeek: number | null };
  /** Open a new active span starting today. */
  open?: {
    phaseType: PhaseType;
    startDay: string;
    endDay: null;
    targetRateLbsPerWeek: number | null;
  };
}

/**
 * Plan the training_phases writes for a quick-switcher flip to `nextType`.
 * Day boundaries come from localDay(now) — never UTC — so a 11 PM flip lands
 * on the user's local calendar day.
 */
export function planPhaseSwitch(
  phases: TrainingPhase[],
  nextType: PhaseType,
  now: Date = clockNow()
): PhaseSwitchPlan {
  const today = localDay(now);
  const active = phaseOnDay(phases, today);

  if (active && active.phaseType === nextType) return { noop: true };

  const open: PhaseSwitchPlan['open'] = {
    phaseType: nextType,
    startDay: today,
    endDay: null,
    targetRateLbsPerWeek: SWITCHER_DEFAULT_TARGET[nextType],
  };

  if (!active) return { noop: false, open };

  if (active.startDay === today) {
    return {
      noop: false,
      retype: {
        id: active.id,
        phaseType: nextType,
        targetRateLbsPerWeek: SWITCHER_DEFAULT_TARGET[nextType],
      },
    };
  }

  return {
    noop: false,
    close: { id: active.id, endDay: addLocalDays(today, -1) },
    open,
  };
}

/**
 * Whether an EDITOR change must mirror into users.goal.
 *
 * Retroactive edits never touch users.goal / phase_history — those record
 * what the user believed at the time; training_phases is the corrected
 * truth. The one exception: when an edit changes which span covers TODAY
 * (different span, or the active span's type changed), users.goal must
 * follow so the two can't disagree about the present. Returns the goal to
 * write, or null for no write. Ending/deleting the active span (today
 * becomes untracked) keeps users.goal as the standing fallback.
 */
export function goalSyncAfterEdit(
  before: TrainingPhase[],
  after: TrainingPhase[],
  today: string = localDay()
): 'bulk' | 'cut' | 'maintenance' | null {
  const prevActive = phaseOnDay(before, today);
  const nextActive = phaseOnDay(after, today);
  if (!nextActive) return null;
  if (prevActive && prevActive.id === nextActive.id && prevActive.phaseType === nextActive.phaseType) {
    return null;
  }
  return phaseTypeToProfileGoal(nextActive.phaseType);
}

// === VALIDATION ===

export interface PhaseSpanCandidate {
  /** Id of the phase being edited, absent when adding a new one. */
  id?: string;
  phaseType: PhaseType;
  startDay: string;
  endDay: string | null;
}

export interface BoundaryShiftProposal {
  /** The neighboring phase whose boundary would move. */
  phaseId: string;
  /** 'endDay' when the earlier neighbor shrinks, 'startDay' when the later one does. */
  field: 'startDay' | 'endDay';
  /** The new value that makes the phases contiguous. */
  value: string;
}

export interface PhaseValidationResult {
  ok: boolean;
  /** Machine-readable error, empty when ok. */
  errors: string[];
  /** Ids of phases the candidate overlaps. */
  overlappingIds: string[];
  /**
   * When every overlap is a plain boundary collision (the candidate does not
   * swallow a neighbor whole), shifting the neighbors' boundaries to touch the
   * candidate resolves it — the common contiguous-phases case. One proposal
   * per overlapped neighbor; empty when a shift can't resolve the conflict.
   */
  proposals: BoundaryShiftProposal[];
}

/** Inclusive-day overlap test; null end = open-ended (extends forever). */
function spansOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null
): boolean {
  const aEndsBeforeB = aEnd !== null && aEnd < bStart;
  const bEndsBeforeA = bEnd !== null && bEnd < aStart;
  return !aEndsBeforeB && !bEndsBeforeA;
}

/**
 * Validate a new/edited phase span against the user's other phases.
 * Enforces: start <= end, at most one open-ended phase, no overlaps.
 */
export function validatePhaseSpan(
  existing: TrainingPhase[],
  candidate: PhaseSpanCandidate
): PhaseValidationResult {
  const errors: string[] = [];
  const others = existing.filter((p) => p.id !== candidate.id);

  if (candidate.endDay !== null && candidate.endDay < candidate.startDay) {
    errors.push('end_before_start');
  }

  if (candidate.endDay === null && others.some((p) => p.endDay === null)) {
    errors.push('multiple_active');
  }

  const overlapping = others.filter((p) =>
    spansOverlap(candidate.startDay, candidate.endDay, p.startDay, p.endDay)
  );
  if (overlapping.length > 0) errors.push('overlap');

  const proposals: BoundaryShiftProposal[] = [];
  for (const neighbor of overlapping) {
    if (neighbor.startDay < candidate.startDay) {
      // Earlier neighbor runs into the candidate: pull its end to the day
      // before the candidate starts (only if that leaves it a valid span).
      const newEnd = addLocalDays(candidate.startDay, -1);
      if (newEnd >= neighbor.startDay) {
        proposals.push({ phaseId: neighbor.id, field: 'endDay', value: newEnd });
        continue;
      }
    } else if (
      candidate.endDay !== null &&
      (neighbor.endDay === null || neighbor.endDay > candidate.endDay)
    ) {
      // Later neighbor starts inside the candidate: push its start to the day
      // after the candidate ends.
      const newStart = addLocalDays(candidate.endDay, 1);
      if (neighbor.endDay === null || newStart <= neighbor.endDay) {
        proposals.push({ phaseId: neighbor.id, field: 'startDay', value: newStart });
        continue;
      }
    }
    // Neighbor is fully swallowed (or open-ended against an open-ended
    // candidate) — no shift can fix it, so offer no proposals at all: a
    // partial fix would still leave the edit invalid.
    return { ok: errors.length === 0, errors, overlappingIds: overlapping.map((p) => p.id), proposals: [] };
  }

  return {
    ok: errors.length === 0,
    errors,
    overlappingIds: overlapping.map((p) => p.id),
    proposals,
  };
}

// === FIRST-RUN AUTO-SUGGEST ===

export interface SuggestedPhase {
  phaseType: PhaseType;
  startDay: string;
  endDay: string;
}

/** Sustained-slope thresholds from the spec. Deliberately simple. */
const SLOPE_LB_PER_WK = 0.25;
const MIN_SEGMENT_DAYS = 21;
const SCAN_SNAP_DAYS = 14;
const SMOOTH_HALF_WINDOW_DAYS = 3; // 7-day centered moving average
const MIN_HISTORY_DAYS = 90;

interface DayWeight {
  day: string;
  weightLb: number;
}

/** 7-day centered moving average over daily weigh-ins. */
function smoothWeighIns(weighIns: WeighIn[]): DayWeight[] {
  const sorted = [...weighIns]
    .filter((w) => w.weightLb > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((w, i) => {
    let sum = 0;
    let n = 0;
    // Window is ±3 calendar days, not ±3 array entries, so sparse logging
    // doesn't stretch the window.
    for (let j = i; j >= 0; j--) {
      if (localDaysBetweenDays(sorted[j].date, w.date) > SMOOTH_HALF_WINDOW_DAYS) break;
      sum += sorted[j].weightLb;
      n++;
    }
    for (let j = i + 1; j < sorted.length; j++) {
      if (localDaysBetweenDays(w.date, sorted[j].date) > SMOOTH_HALF_WINDOW_DAYS) break;
      sum += sorted[j].weightLb;
      n++;
    }
    return { day: w.date.slice(0, 10), weightLb: sum / n };
  });
}

/** Nearest scan day within SCAN_SNAP_DAYS of `day`, else `day` unchanged. */
function snapToScan(day: string, scanDays: string[]): string {
  let best = day;
  let bestDist = SCAN_SNAP_DAYS + 1;
  for (const scan of scanDays) {
    const dist = Math.abs(localDaysBetweenDays(day, scan.slice(0, 10)));
    if (dist < bestDist) {
      bestDist = dist;
      best = scan.slice(0, 10);
    }
  }
  return bestDist <= SCAN_SNAP_DAYS ? best : day;
}

/**
 * Whether auto-suggest should even be offered: zero phases and >= 90 days of
 * weight history.
 */
export function canSuggestPhases(existingPhaseCount: number, weighIns: WeighIn[]): boolean {
  if (existingPhaseCount > 0) return false;
  const sorted = [...weighIns].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return false;
  return (
    localDaysBetweenDays(sorted[0].date.slice(0, 10), sorted[sorted.length - 1].date.slice(0, 10)) >=
    MIN_HISTORY_DAYS
  );
}

/**
 * Segment weight history into phase candidates by sustained smoothed slope:
 * >= +0.25 lb/wk over >= 21 days -> bulk, <= -0.25 -> cut, between ->
 * maintenance. Boundaries snap to a DEXA scan date within 14 days. This is a
 * deterministic starting point for the user to edit, not a classifier.
 */
export function suggestPhasesFromHistory(
  weighIns: WeighIn[],
  scanDays: string[] = []
): SuggestedPhase[] {
  const smoothed = smoothWeighIns(weighIns);
  if (smoothed.length < 2) return [];

  // Slope at each point: smoothed change over the trailing ~14 days.
  const SLOPE_WINDOW_DAYS = 14;
  type Direction = 'bulk' | 'cut' | 'maintenance';
  const classified: { day: string; dir: Direction }[] = [];
  for (let i = 0; i < smoothed.length; i++) {
    const point = smoothed[i];
    // Find the sample closest to (day - window) at or before it.
    let anchor = smoothed[0];
    for (let j = i; j >= 0; j--) {
      anchor = smoothed[j];
      if (localDaysBetweenDays(smoothed[j].day, point.day) >= SLOPE_WINDOW_DAYS) break;
    }
    const span = localDaysBetweenDays(anchor.day, point.day);
    const rate = span > 0 ? ((point.weightLb - anchor.weightLb) / span) * 7 : 0;
    const dir: Direction = rate >= SLOPE_LB_PER_WK ? 'bulk' : rate <= -SLOPE_LB_PER_WK ? 'cut' : 'maintenance';
    classified.push({ day: point.day, dir });
  }

  // Collapse into runs.
  interface Run {
    dir: Direction;
    startDay: string;
    endDay: string;
  }
  const mergeAdjacent = (input: Run[]): Run[] => {
    const out: Run[] = [];
    for (const run of input) {
      const last = out[out.length - 1];
      if (last && last.dir === run.dir) {
        last.endDay = run.endDay;
      } else {
        out.push({ ...run });
      }
    }
    return out;
  };
  const runs: Run[] = [];
  for (const c of classified) {
    const last = runs[runs.length - 1];
    if (last && last.dir === c.dir) {
      last.endDay = c.day;
    } else {
      runs.push({ dir: c.dir, startDay: c.day, endDay: c.day });
    }
  }

  // A bulk/cut needs >= 21 sustained days; shorter runs demote to maintenance,
  // then adjacent same-direction runs merge.
  for (const run of runs) {
    if (
      run.dir !== 'maintenance' &&
      localDaysBetweenDays(run.startDay, run.endDay) < MIN_SEGMENT_DAYS
    ) {
      run.dir = 'maintenance';
    }
  }
  const collapsed = mergeAdjacent(runs);

  // Transitional maintenance slivers (< 21 days) between a cut and a bulk are
  // artifacts of the trailing slope window passing through the +/-0.25 band —
  // absorb them into the following run so inflections stay crisp.
  const absorbed: Run[] = [];
  for (let i = 0; i < collapsed.length; i++) {
    const run = collapsed[i];
    const short = localDaysBetweenDays(run.startDay, run.endDay) < MIN_SEGMENT_DAYS;
    if (run.dir === 'maintenance' && short && collapsed.length > 1) {
      const next = collapsed[i + 1];
      if (next) {
        next.startDay = run.startDay;
        continue;
      }
      const prev = absorbed[absorbed.length - 1];
      if (prev) {
        prev.endDay = run.endDay;
        continue;
      }
    }
    absorbed.push({ ...run });
  }
  const merged = mergeAdjacent(absorbed);

  // Contiguous spans: each internal boundary is the end of a run, snapped to
  // a nearby scan, kept strictly increasing and inside the data span.
  const firstDay = merged[0].startDay;
  const lastDay = merged[merged.length - 1].endDay;
  const boundaries: string[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    let b = snapToScan(merged[i].endDay, scanDays);
    const prev = boundaries[boundaries.length - 1] ?? addLocalDays(firstDay, -1);
    if (b <= prev) b = merged[i].endDay > prev ? merged[i].endDay : addLocalDays(prev, 1);
    if (b >= lastDay) b = addLocalDays(lastDay, -1);
    boundaries.push(b);
  }

  const suggestions: SuggestedPhase[] = merged.map((run, i) => ({
    phaseType: run.dir,
    startDay: i === 0 ? firstDay : addLocalDays(boundaries[i - 1], 1),
    endDay: i === merged.length - 1 ? lastDay : boundaries[i],
  }));

  // Drop degenerate slivers (< 7 days) that snapping may have produced; the
  // survivors stay ordered and non-overlapping, and gaps are legal.
  return suggestions.filter((s) => localDaysBetweenDays(s.startDay, s.endDay) >= 7);
}

// === PHASE STATS (editor cards) ===

export interface PhaseStats {
  durationDays: number;
  startWeightLb: number | null;
  endWeightLb: number | null;
  deltaLb: number | null;
  avgRateLbPerWk: number | null;
  /** Present only when >= 2 DEXA scans fall inside the phase. */
  leanDeltaLb?: number;
  fatDeltaLb?: number;
}

const KG_TO_LB = 2.20462;

/** Computed stats for a phase card: weight endpoints, rate, DEXA deltas. */
export function computePhaseStats(
  phase: Pick<TrainingPhase, 'startDay' | 'endDay'>,
  weighIns: WeighIn[],
  scans: { scanDate: string; leanMassKg: number; fatMassKg: number }[],
  today: string
): PhaseStats {
  const end = phase.endDay ?? today;
  const inPhase = weighIns
    .filter((w) => {
      const day = w.date.slice(0, 10);
      return w.weightLb > 0 && day >= phase.startDay && day <= end;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const durationDays = localDaysBetweenDays(phase.startDay, end) + 1;
  const startWeightLb = inPhase.length > 0 ? inPhase[0].weightLb : null;
  const endWeightLb = inPhase.length > 0 ? inPhase[inPhase.length - 1].weightLb : null;
  const deltaLb = startWeightLb !== null && endWeightLb !== null ? endWeightLb - startWeightLb : null;

  let avgRateLbPerWk: number | null = null;
  if (inPhase.length >= 2 && deltaLb !== null) {
    const span = localDaysBetweenDays(inPhase[0].date.slice(0, 10), inPhase[inPhase.length - 1].date.slice(0, 10));
    if (span >= 7) avgRateLbPerWk = (deltaLb / span) * 7;
  }

  const phaseScans = scans
    .filter((s) => {
      const day = s.scanDate.slice(0, 10);
      return day >= phase.startDay && day <= end;
    })
    .sort((a, b) => a.scanDate.localeCompare(b.scanDate));

  const stats: PhaseStats = { durationDays, startWeightLb, endWeightLb, deltaLb, avgRateLbPerWk };
  if (phaseScans.length >= 2) {
    const first = phaseScans[0];
    const last = phaseScans[phaseScans.length - 1];
    stats.leanDeltaLb = (last.leanMassKg - first.leanMassKg) * KG_TO_LB;
    stats.fatDeltaLb = (last.fatMassKg - first.fatMassKg) * KG_TO_LB;
  }
  return stats;
}
