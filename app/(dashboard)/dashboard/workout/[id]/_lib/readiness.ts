/**
 * readiness.ts — pure assembly + ranking for the in-workout Muscle Readiness
 * sheet. Renders the SAME coarse-row model as the volume page, widget and
 * warning (buildVolumeRows over the shared 0.5-secondary counter), then pairs
 * each row with the recovery heuristic:
 *   1. weekly volume — coarse sets vs the MEV–MRV band (shared zone rule),
 *   2. recovery status — from the pure `muscleRecovery` heuristic.
 *
 * No React, no store, no Supabase — the data hook feeds it plain values and an
 * injected `now`, so the whole ranking is unit-testable in isolation.
 */

import {
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';
import {
  computeMuscleRecovery,
  RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoverySession,
  type MuscleRecoveryResult,
} from '@/services/muscleRecovery';
import {
  buildVolumeRows,
  COARSE_CHILDREN,
  type CoarseMuscle,
  type ExerciseVolume,
  type VolumeBand,
  type VolumeZone,
  type VolumeRow,
  type MuscleVolumeStats,
} from '../../../_lib/weeklyVolume';

export type VolumeStatus = 'low' | 'optimal' | 'high';

/** How "trainable today" each recovery bucket is, for the actionability score. */
const RECOVERED_FACTOR: Record<MuscleRecoveryResult['status'], number> = {
  fresh: 1,
  recovering: 0.6,
  fatigued: 0,
};

/** A fine child of a coarse readiness row. Visibility is the shared list
 *  component's concern — reachable lagging children pin open, the rest
 *  (including unreachable context rows) sit behind the chevron. */
export interface ReadinessChild {
  muscle: StandardMuscleGroup;
  displayName: string;
  sets: number;
  band: VolumeBand;
  zone: VolumeZone;
  belowMev: boolean;
  volumeGap: number;
  /**
   * Whether the user's own exercise tagging can feed this muscle. Unreachable
   * children appear only under an explicit expansion (context rows) and are
   * never offered as training targets.
   */
  reachable: boolean;
  recovery: MuscleRecoveryResult;
  /**
   * Which exercises fed this muscle's weekly count and how many credited
   * (fractional-credit) sets each contributed, biggest first — the
   * tap-to-see-sources drill-down behind the set number.
   */
  exercises: ExerciseVolume[];
}

export interface ReadinessRow {
  /** Coarse muscle id (chest, back, …). */
  muscle: CoarseMuscle;
  displayName: string;
  /** Weekly credited working sets (DB history + live session), rounded. */
  sets: number;
  /** Shared MEV–MRV band — the denominator shown as a zone, never n/MEV. */
  band: VolumeBand;
  zone: VolumeZone;
  belowMev: boolean;
  /** How far below MEV (0 at/above MEV). */
  volumeGap: number;
  /** Legacy tri-state kept for the bar colour fallback. */
  volumeStatus: VolumeStatus;
  recovery: MuscleRecoveryResult;
  /** Actionability score — higher = better target today. */
  score: number;
  /** Whether the row has ≥1 reachable fine child (gates the chevron). */
  expandable: boolean;
  /** ALL fine children of an expandable row, each with its own recovery. */
  children: ReadinessChild[];
  /** Contributing exercises with credited sets, biggest first (drill-down). */
  exercises: ExerciseVolume[];
  /**
   * Divergence flag: a trained child's status differs from the parent's
   * (worst-of-children) status by at least one full level — e.g. Shoulders
   * reads Fatigued off the side delts while front/rear are Fresh. Surfaces
   * default such a parent to expanded so the aggregate can never silently
   * hide WHICH member drove it; an explicit user collapse still overrides.
   */
  autoExpand: boolean;
}

/**
 * A "good target today" — a coarse row or a fine child that is behind on volume
 * and either Fresh now ('ready') or within `READY_SOON_HOURS` of Fresh ('soon').
 * A muscle whose own row reads "Recovering" is NEVER emitted as tier 'ready'.
 */
export interface ReadinessTarget {
  muscle: string;
  displayName: string;
  isChild: boolean;
  score: number;
  /**
   * 'ready' — Fresh now AND behind on volume (a full-confidence pick).
   * 'soon'  — behind on volume AND within READY_SOON_HOURS of Fresh; a
   *           legitimate pick for a session planned a little ahead, shown muted.
   */
  tier: 'ready' | 'soon';
  /** Hours until Fresh — 0 for 'ready', >0 for 'soon' (drives the "(ready ~2h)" label). */
  readyInHours: number;
}

/** The soonest-ready lagging muscle, named in the honest empty state. */
export interface NextReadyTarget {
  muscle: string;
  displayName: string;
  hoursUntilReady: number;
}

/** Result of the shared good-targets selector: the picks + an empty-state fallback. */
export interface GoodTargets {
  targets: ReadinessTarget[];
  /**
   * Set only when `targets` is empty: the soonest lagging muscle still
   * recovering, so the strip can say "Next up: Triceps in ~2h" instead of a
   * bare "nothing" (or, worse, presenting a recovering muscle as ready).
   */
  nextUp: NextReadyTarget | null;
}

/**
 * A lagging muscle within this many hours of Fresh is offered as a muted
 * "ready soon" pick rather than excluded entirely — users often plan a session
 * a few hours before training, and a muscle ready by session time is a
 * legitimate target.
 */
export const READY_SOON_HOURS = 3;

/** Compact "ready by" ETA for the strip: "<1h", "~2h", "~2d". */
export function formatReadyEta(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 24) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}

// ---------------------------------------------------------------------------
// Scalar readiness score (0–1) — a projection of the SAME recovery heuristic,
// for surfaces that need a continuous value (status dots, "Ready / ~Nh"
// microcopy) rather than the Fresh/Recovering/Fatigued tri-state.
// ---------------------------------------------------------------------------

/** At/above this score a muscle reads "Ready" (green). */
export const READINESS_READY_THRESHOLD = 0.8;
/** At/above this (but under ready) a muscle reads amber; below it, red. */
export const READINESS_AMBER_THRESHOLD = 0.5;

/**
 * Scalar readiness in [0, 1]: how far through its recovery window a muscle is
 * (`hoursSinceLast / windowHours`, clamped). Derived from the recovery
 * heuristic's own outputs — NOT a parallel model: the window already carries
 * dose, athlete-profile, sleep, wearable and learned-multiplier adjustments.
 * A never-trained muscle is fully ready (1).
 */
export function readinessScore(rec: MuscleRecoveryResult): number {
  if (rec.lastTrainedAt === null || rec.windowHours === null || rec.windowHours <= 0) return 1;
  const ratio = (rec.hoursSinceLast ?? 0) / rec.windowHours;
  return Math.min(1, Math.max(0, ratio));
}

/**
 * Estimated hours until the readiness score crosses `threshold` (0 when
 * already at/above it) — drives the "~{N}h" microcopy.
 */
export function hoursUntilReadinessThreshold(
  rec: MuscleRecoveryResult,
  threshold: number = READINESS_READY_THRESHOLD
): number {
  if (readinessScore(rec) >= threshold) return 0;
  // score < threshold ≤ 1 implies the muscle was trained, so windowHours is set.
  return Math.max(0, threshold * (rec.windowHours ?? 0) - (rec.hoursSinceLast ?? 0));
}

/**
 * Apply a frozen (per-local-day) ordering to a desired one: keys present in
 * `frozen` keep their frozen relative order, keys `frozen` doesn't know about
 * (e.g. a muscle added to the session later in the day) append in `desired`
 * order. Pure — the caller owns persistence of the frozen list.
 */
export function applyFrozenOrder(desired: string[], frozen: string[]): string[] {
  const present = new Set(desired);
  const head = frozen.filter((k) => present.has(k));
  const inFrozen = new Set(head);
  return [...head, ...desired.filter((k) => !inFrozen.has(k))];
}

function volumeStatusForZone(zone: VolumeZone): VolumeStatus {
  if (zone === 'below_mev') return 'low';
  if (zone === 'over_mrv') return 'high';
  return 'optimal';
}

/** Recovery for a coarse group = its least-recovered child (fatigued wins). */
const RECOVERY_RANK: Record<MuscleRecoveryResult['status'], number> = {
  fatigued: 2,
  recovering: 1,
  fresh: 0,
};
/**
 * Same-day subjective override: a muscle the user reported "still sore" today
 * renders Fatigued for the rest of the session regardless of the time model —
 * the user's report outranks the heuristic on the day it was given.
 */
function applySorenessOverride(
  rec: MuscleRecoveryResult,
  overridden: boolean
): MuscleRecoveryResult {
  if (!overridden || rec.status === 'fatigued') return rec;
  return { ...rec, status: 'fatigued' };
}

/**
 * Recovery for a coarse group (exported so the weekly-volume strip can pair
 * the SAME worst-of-children recovery with its rows as the readiness sheet).
 */
export function coarseRecovery(
  coarse: CoarseMuscle,
  history: RecoverySession[],
  now: Date,
  config: RecoveryConfig,
  sorenessOverrides?: ReadonlySet<StandardMuscleGroup>
): MuscleRecoveryResult {
  let worst: MuscleRecoveryResult | null = null;
  for (const child of COARSE_CHILDREN[coarse]) {
    const rec = applySorenessOverride(
      computeMuscleRecovery(history, child, now, config),
      sorenessOverrides?.has(child) ?? false
    );
    if (
      !worst ||
      RECOVERY_RANK[rec.status] > RECOVERY_RANK[worst.status] ||
      (RECOVERY_RANK[rec.status] === RECOVERY_RANK[worst.status] && rec.hoursUntilReady > worst.hoursUntilReady)
    ) {
      worst = rec;
    }
  }
  return worst ?? computeMuscleRecovery(history, COARSE_CHILDREN[coarse][0], now, config);
}

/**
 * Actionability sort: the best candidates (behind on volume AND recovered)
 * float to the top; Fatigued muscles sink to the bottom regardless of how far
 * behind they are; within ties, the bigger volume gap wins.
 */
export function compareByActionability(a: ReadinessRow, b: ReadinessRow): number {
  const aFatigued = a.recovery.status === 'fatigued' ? 1 : 0;
  const bFatigued = b.recovery.status === 'fatigued' ? 1 : 0;
  if (aFatigued !== bFatigued) return aFatigued - bFatigued;
  if (b.score !== a.score) return b.score - a.score;
  if (b.volumeGap !== a.volumeGap) return b.volumeGap - a.volumeGap;
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Build one coarse row per muscle group, sorted by actionability, each carrying
 * ALL its reachable fine children (with per-child recovery) plus the divergence
 * autoExpand flag. Untrained groups (0 sets) are included on purpose — they're
 * the strongest targets.
 *
 * @param stats     shared per-muscle credited stats (DB + live session)
 * @param history   sessions for the recovery heuristic (incl. live)
 * @param now       injected clock
 * @param reachable muscles the user's exercises can feed (gates fine children)
 * @param config    recovery heuristic config
 * @param sorenessOverrides muscles reported "still sore" today — forced Fatigued
 */
export function buildReadinessRows(
  stats: MuscleVolumeStats[],
  history: RecoverySession[],
  now: Date,
  reachable?: Set<StandardMuscleGroup>,
  config: RecoveryConfig = RECOVERY_CONFIG,
  sorenessOverrides?: ReadonlySet<StandardMuscleGroup>
): ReadinessRow[] {
  const volumeRows = buildVolumeRows(stats, reachable);

  const rows = volumeRows.map((vr: VolumeRow): ReadinessRow => {
    const coarse = vr.muscle as CoarseMuscle;
    const recovery = coarseRecovery(coarse, history, now, config, sorenessOverrides);
    const volumeGap = Math.max(0, vr.band.mev - vr.sets);
    const score = volumeGap * RECOVERED_FACTOR[recovery.status];

    const children: ReadinessChild[] = vr.children.map((child) => {
      const childRecovery = applySorenessOverride(
        computeMuscleRecovery(history, child.muscle as StandardMuscleGroup, now, config),
        sorenessOverrides?.has(child.muscle as StandardMuscleGroup) ?? false
      );
      return {
        muscle: child.muscle as StandardMuscleGroup,
        displayName: child.displayName,
        sets: child.sets,
        band: child.band,
        zone: child.zone,
        belowMev: child.belowMev,
        volumeGap: Math.max(0, child.band.mev - child.sets),
        reachable: child.reachable,
        recovery: childRecovery,
        exercises: child.exercises,
      };
    });

    // Auto-expand on divergence: the parent shows the LEAST-recovered member
    // (coarseRecovery), so a trained child a full status level fresher than
    // the parent means the aggregate is hiding useful detail. No-data children
    // are ignored — "never trained" isn't a divergence worth self-revealing.
    const autoExpand = children.some(
      (c) =>
        c.recovery.lastTrainedAt !== null &&
        RECOVERY_RANK[recovery.status] - RECOVERY_RANK[c.recovery.status] >= 1
    );

    return {
      muscle: coarse,
      displayName: vr.displayName,
      sets: vr.sets,
      band: vr.band,
      zone: vr.zone,
      belowMev: vr.belowMev,
      volumeGap,
      volumeStatus: volumeStatusForZone(vr.zone),
      recovery,
      score,
      expandable: vr.expandable,
      children,
      exercises: vr.exercises,
      autoExpand,
    };
  });

  return rows.sort(compareByActionability);
}

/** One flattened candidate (a coarse row or one of its fine children). */
interface TargetCandidate {
  muscle: string;
  displayName: string;
  isChild: boolean;
  volumeGap: number;
  recovery: MuscleRecoveryResult;
}

/**
 * Flatten rows + their reachable fine children into a single candidate list
 * (the gap>0 filter downstream keeps only lagging ones). A lagging fine child
 * surfaces even when its coarse parent is on target. Unreachable children
 * (expand-only context rows) are never target candidates — no exercise in the
 * user's library could act on the recommendation.
 */
function flattenCandidates(rows: ReadinessRow[]): TargetCandidate[] {
  const out: TargetCandidate[] = [];
  for (const row of rows) {
    out.push({
      muscle: row.muscle,
      displayName: row.displayName,
      isChild: false,
      volumeGap: row.volumeGap,
      recovery: row.recovery,
    });
    for (const child of row.children) {
      if (!child.reachable) continue;
      out.push({
        muscle: child.muscle,
        displayName: child.displayName,
        isChild: true,
        volumeGap: child.volumeGap,
        recovery: child.recovery,
      });
    }
  }
  return out;
}

/**
 * The shared "good targets today" selector — the SINGLE source of truth the
 * strip renders, derived from the exact same `rows` (and thus the same recovery
 * status) the per-muscle badges show, so the two can never disagree.
 *
 * Eligibility:
 *  - 'ready' tier: status Fresh AND behind on volume (below MEV). This is the
 *    fix for the reported bug — a muscle whose row reads "Recovering" is no
 *    longer presented as a ready-now target.
 *  - 'soon' tier (opt-in via `readySoonHours`): behind on volume AND within
 *    `readySoonHours` of Fresh. Shown muted/parenthetical, not as ready-now.
 *
 * Both tiers rank by volume gap (bigger gap first) among eligible muscles only.
 * When nothing qualifies, `nextUp` names the soonest-ready lagging muscle for an
 * honest empty state.
 */
export function selectGoodTargets(
  rows: ReadinessRow[],
  n = 3,
  readySoonHours: number = READY_SOON_HOURS
): GoodTargets {
  const lagging = flattenCandidates(rows).filter((c) => c.volumeGap > 0);

  // Ready now: Fresh AND behind on volume. Ranked by volume gap (bigger first).
  const ready: ReadinessTarget[] = lagging
    .filter((c) => c.recovery.status === 'fresh')
    .sort((a, b) => b.volumeGap - a.volumeGap || a.displayName.localeCompare(b.displayName))
    .map((c) => ({
      muscle: c.muscle,
      displayName: c.displayName,
      isChild: c.isChild,
      score: c.volumeGap,
      tier: 'ready' as const,
      readyInHours: 0,
    }));

  // Ready soon: behind on volume and within the soon window of Fresh. Soonest
  // first, bigger gap breaks ties. Never a muscle that's already Fresh.
  const soon: ReadinessTarget[] = lagging
    .filter(
      (c) =>
        c.recovery.status !== 'fresh' &&
        c.recovery.hoursUntilReady > 0 &&
        c.recovery.hoursUntilReady <= readySoonHours
    )
    .sort(
      (a, b) =>
        a.recovery.hoursUntilReady - b.recovery.hoursUntilReady ||
        b.volumeGap - a.volumeGap ||
        a.displayName.localeCompare(b.displayName)
    )
    .map((c) => ({
      muscle: c.muscle,
      displayName: c.displayName,
      isChild: c.isChild,
      score: c.volumeGap,
      tier: 'soon' as const,
      readyInHours: c.recovery.hoursUntilReady,
    }));

  const targets = [...ready, ...soon].slice(0, n);

  // Empty state: name the soonest-ready lagging muscle still recovering.
  let nextUp: NextReadyTarget | null = null;
  if (targets.length === 0) {
    const soonest = lagging
      .filter((c) => c.recovery.status !== 'fresh' && c.recovery.hoursUntilReady > 0)
      .sort(
        (a, b) =>
          a.recovery.hoursUntilReady - b.recovery.hoursUntilReady ||
          b.volumeGap - a.volumeGap ||
          a.displayName.localeCompare(b.displayName)
      )[0];
    if (soonest) {
      nextUp = {
        muscle: soonest.muscle,
        displayName: soonest.displayName,
        hoursUntilReady: soonest.recovery.hoursUntilReady,
      };
    }
  }

  return { targets, nextUp };
}
