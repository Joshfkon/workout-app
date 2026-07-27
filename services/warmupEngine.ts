/**
 * Warmup Readiness Engine
 *
 * Pure functions — no side effects or database calls; all data passed as
 * input (session sets, block metadata, clock).
 *
 * Replaces the binary "muscle already warm?" trigger with four independent
 * readiness dimensions that prior work in the SAME session pays into
 * unequally:
 *
 *   1. MUSCLE TEMPERATURE — credited by any prior set overlapping the target
 *      exercise's prime movers (via the existing muscle taxonomy), weighted
 *      by overlap fraction and decayed by time since the set was logged.
 *   2. MOVEMENT PATTERN — credited ONLY by prior work sharing the same
 *      canonical pattern. Horizontal pressing does not pay for vertical
 *      pressing.
 *   3. JOINT POSITION / ROM — credited by prior work sharing the same loaded
 *      end-range / rotational demand tags (exercises.rom_demands).
 *   4. LOAD RAMP — needed when the top set is a high fraction of capacity,
 *      independent of tissue warmth.
 *
 * The output is always a DECISION with a stated reason — including the null
 * decision ("no warmup needed — …"). Rendering empty space for a
 * silently-skipped warmup is the defect this engine exists to fix.
 *
 * Warmth is session-scoped by contract: callers pass only the current
 * session's completed sets. Nothing from a previous session is credited.
 *
 * NOTE on set writes: warmup/ramp sets prescribed here are tracked as
 * protocol checkboxes in the card and are never written to set_logs as
 * 'normal' sets. If a caller ever persists one, it must use
 * setType 'warmup' so it stays out of the anchor pool, e1RM estimation,
 * volume counts, and effort metrics (see the set_type filters in the
 * workout page and suggestionEngine).
 */

import type { WarmupSet, CanonicalMovementPattern, RomDemand } from '@/types/schema';
import { CANONICAL_MOVEMENT_PATTERNS, LEGACY_TO_STANDARD_MAP, resolveMuscleToStandard } from '@/types/schema';
import { generateWarmupProtocol } from './progressionEngine';

// ============================================
// TUNING CONSTANTS
// ============================================

/**
 * Half-life (minutes) for warmth decay.
 *
 * Intramuscular temperature rises ~2–3 °C during resistance work and decays
 * toward baseline with half-times of roughly 10–15 minutes in the classic
 * intramuscular-temperature literature (Saltin's curves and later re-warmup
 * studies) — measured under PASSIVE rest. Mid-session the lifter is
 * semi-active (walking between stations, racking plates), which slows the
 * decline, so we take the top of that range: 15 minutes. A set from 15 min
 * ago retains half its warmth credit; from ~40 min ago, ~16% — partial
 * credit, decay applied, exactly the "40+ min elapsed" regression case.
 */
export const WARMTH_HALF_LIFE_MINUTES = 15;

/**
 * Full-warmth budget for the muscle-temperature dimension: ~1.25 fresh
 * fully-overlapping working sets saturate the score, and the PAID threshold
 * (0.5) is crossed at ~0.6 credits — e.g. two recent working sets hitting
 * the target as a secondary mover. Seven prior chest sets before an
 * anterior-delt press land well past threshold, matching the defect report.
 */
const MUSCLE_TEMP_SATURATION_CREDITS = 1.25;

/** Prior same-pattern working sets that fully groove the pattern. */
const PATTERN_SATURATION_CREDITS = 2;

/** Dimension score at or above which the dimension counts as PAID. */
const PAID_THRESHOLD = 0.5;

/**
 * Muscle-temperature score below which partial credit no longer shortens the
 * protocol — treat as fully cold. At the 15-minute half-life, a muscle
 * worked ~40 minutes ago still scores above this floor — partial credit
 * (shortened protocol), not a cold start.
 */
const PARTIAL_CREDIT_FLOOR = 0.1;

/** Decay credit a ROM demand needs to still count as loaded "recently". */
const ROM_RECENCY_THRESHOLD = 0.35;

/** Targeted ramp set: fraction of working weight (user spec: 25–30 lb for a 45 lb top set ≈ 55–67%). */
const TARGETED_RAMP_FRACTION = 0.6;

/**
 * Working weight as a fraction of known capacity (e1RM) at or above which a
 * load ramp is required regardless of warmth.
 */
const LOAD_RAMP_E1RM_FRACTION = 0.8;

/**
 * Without a known e1RM: planned reps-to-failure (target reps + RIR) at or
 * below this imply a high-capacity-fraction top set (≈ ≥80% 1RM territory on
 * standard rep–intensity tables), so a ramp is needed.
 */
const LOAD_RAMP_EFFECTIVE_REPS = 6;

// ============================================
// TYPES
// ============================================

/** Exercise metadata the engine needs — a subset of the schema Exercise. */
export interface WarmupExerciseMeta {
  id: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscles?: string[];
  /** Raw DB movement_pattern value (legacy tokens fine — canonicalized on read). */
  movementPattern?: string | null;
  /** Raw DB rom_demands value; derived from name/pattern when absent/empty. */
  romDemands?: string[] | null;
  equipmentRequired?: string[] | null;
  minWeightIncrementKg?: number;
  mechanic?: 'compound' | 'isolation';
}

/** A set completed earlier in THIS session. */
export interface SessionPriorSet {
  exerciseBlockId: string;
  /** ISO timestamp the set was logged (SetLog.loggedAt) — drives decay. */
  loggedAt: string;
  isWarmup?: boolean;
  setType?: string | null;
}

export interface WarmupReadinessInput {
  /** The exercise about to be performed. */
  exercise: WarmupExerciseMeta;
  /** Top working weight for the coming sets, kg. */
  workingWeightKg: number;
  /** Planned reps for the top set (top of rep range if unknown). */
  targetReps: number;
  /** Planned RIR for the top set. */
  targetRir: number;
  /** Sets completed so far in THIS session only — never a previous session. */
  completedSets: SessionPriorSet[];
  /** All blocks in the session (maps sets → exercise metadata). */
  blocks: Array<{ id: string; exercise: WarmupExerciseMeta }>;
  /** Clock reference for decay. */
  now: Date;
  /** Known e1RM for this exercise (kg), if any — sharpens the load-ramp check. */
  e1rmKg?: number | null;
  /** True when this is the first exercise of the session (general warmup). */
  isFirstExercise: boolean;
  barbellType?: 'olympic' | 'womens' | 'ez_curl' | 'trap';
}

export interface WarmupDimensionStatus {
  /** Whether prior session work has paid this dimension. */
  paid: boolean;
  /** 0–1 credit score (already decayed). */
  score: number;
  /** Human-readable explanation — shown to the user, never empty. */
  reason: string;
}

export type WarmupDecisionKind =
  /** Cold — full ramp protocol. */
  | 'full_protocol'
  /** Stale partial warmth — shortened protocol, decay applied. */
  | 'partial_protocol'
  /** Warm tissue but an unpaid pattern/ROM/load dimension — ramp set(s) naming why. */
  | 'targeted_ramp'
  /** All dimensions paid — zero warmup sets, WITH the stated reason. */
  | 'none';

export interface WarmupDecision {
  kind: WarmupDecisionKind;
  /** Always present — the card must render this even when sets is empty. */
  reason: string;
  sets: WarmupSet[];
  dimensions: {
    muscleTemperature: WarmupDimensionStatus;
    movementPattern: WarmupDimensionStatus;
    jointRom: WarmupDimensionStatus & { unmetDemands: RomDemand[] };
    loadRamp: WarmupDimensionStatus;
  };
  engineVersion: number;
}

export const WARMUP_ENGINE_VERSION = 1;

// ============================================
// MOVEMENT PATTERN CANONICALIZATION
// ============================================

/**
 * Legacy movement_pattern tokens → canonical patterns. Values not listed
 * here ('compound', 'isolation', 'core', free text, '') fall through to the
 * name-based classifier.
 */
const LEGACY_PATTERN_MAP: Record<string, CanonicalMovementPattern> = {
  horizontal_push: 'horizontal_press',
  horizontal_press: 'horizontal_press',
  vertical_push: 'vertical_press',
  vertical_press: 'vertical_press',
  horizontal_pull: 'horizontal_pull',
  vertical_pull: 'vertical_pull',
  squat: 'squat',
  hip_hinge: 'hinge',
  hinge: 'hinge',
  lunge: 'lunge',
  carry: 'carry',
  elbow_flexion: 'isolation_elbow_flexion',
  elbow_extension: 'isolation_elbow_extension',
  wrist_flexion: 'isolation_wrist_flexion',
  wrist_extension: 'isolation_wrist_extension',
  calf_raise: 'isolation_ankle_plantar',
  spinal_extension: 'isolation_spinal_extension',
};

interface NameRule {
  pattern: RegExp;
  canonical: CanonicalMovementPattern;
  /** Optional predicate on the exercise for disambiguation. */
  when?: (ex: WarmupExerciseMeta) => boolean;
}

const muscleIs = (ex: WarmupExerciseMeta, groups: string[]): boolean => {
  const std = resolveMuscleToStandard(ex.primaryMuscle ?? '');
  return std.some((s) => groups.includes(s));
};

/**
 * Name-based classification rules, checked in order. These cover custom /
 * AI-completed exercises whose movement_pattern is 'compound', 'isolation',
 * 'core', or free text. First match wins — order specific → generic.
 */
const NAME_RULES: NameRule[] = [
  // Specific isolation shapes first (before generic press/curl/raise rules)
  { pattern: /reverse wrist curl/i, canonical: 'isolation_wrist_extension' },
  { pattern: /wrist.*curl|wrist roller/i, canonical: 'isolation_wrist_flexion' },
  { pattern: /leg curl|nordic/i, canonical: 'isolation_knee_flexion' },
  { pattern: /leg extension|sissy squat/i, canonical: 'isolation_knee_extension' },
  { pattern: /calf|toe press/i, canonical: 'isolation_ankle_plantar' },
  { pattern: /shrug/i, canonical: 'isolation_scapular_elevation' },
  { pattern: /lateral raise|side raise|y[- ]?raise/i, canonical: 'isolation_shoulder_abduction' },
  { pattern: /front raise/i, canonical: 'isolation_shoulder_flexion' },
  { pattern: /rear delt|reverse fly|face pull|reverse.*crossover/i, canonical: 'isolation_shoulder_horizontal_abduction' },
  { pattern: /fly|pec deck|crossover/i, canonical: 'isolation_shoulder_horizontal_adduction', when: (ex) => muscleIs(ex, ['chest_upper', 'chest_lower']) },
  { pattern: /pullover|straight[- ]arm/i, canonical: 'isolation_shoulder_extension' },
  { pattern: /kickback|pushdown|skull|tricep.*extension|overhead.*extension/i, canonical: 'isolation_elbow_extension' },
  { pattern: /jefferson curl/i, canonical: 'hinge' },
  { pattern: /curl/i, canonical: 'isolation_elbow_flexion', when: (ex) => muscleIs(ex, ['biceps', 'forearms']) },
  { pattern: /hip abduction|abduction machine/i, canonical: 'isolation_hip_abduction' },
  { pattern: /hip adduction|adduction machine/i, canonical: 'isolation_hip_adduction' },
  { pattern: /leg raise|knee raise/i, canonical: 'isolation_hip_flexion' },
  { pattern: /crunch|sit[- ]?up/i, canonical: 'isolation_spinal_flexion' },
  { pattern: /woodchop|twist/i, canonical: 'isolation_spinal_rotation' },
  { pattern: /pallof/i, canonical: 'isolation_anti_rotation' },
  { pattern: /plank|rollout|dead bug|body saw/i, canonical: 'isolation_anti_extension' },
  { pattern: /back extension|superman|hyperextension/i, canonical: 'isolation_spinal_extension', when: (ex) => muscleIs(ex, ['erectors']) },
  // Compounds
  { pattern: /arnold/i, canonical: 'vertical_press' },
  { pattern: /(shoulder|overhead|military|viking|push)\s*press|press.*overhead/i, canonical: 'vertical_press' },
  { pattern: /jerk/i, canonical: 'vertical_press' },
  { pattern: /pulldown|pull[- ]?up|chin[- ]?up/i, canonical: 'vertical_pull' },
  { pattern: /upright row|high pull/i, canonical: 'vertical_pull' },
  { pattern: /row(?!er)/i, canonical: 'horizontal_pull' },
  { pattern: /bench|chest press|incline.*press|decline.*press|push[- ]?up|floor press|iso[- ]?lateral.*press/i, canonical: 'horizontal_press' },
  { pattern: /dip/i, canonical: 'horizontal_press' },
  { pattern: /deadlift|rdl|good morning|pull[- ]?through|hip thrust|glute bridge|glute drive|swing/i, canonical: 'hinge' },
  { pattern: /split squat|lunge|step[- ]?up/i, canonical: 'lunge' },
  { pattern: /squat|leg press|hack/i, canonical: 'squat' },
  { pattern: /carry|farmer|suitcase/i, canonical: 'carry' },
  // Generic press with shoulder primary → vertical, chest primary → horizontal
  { pattern: /press/i, canonical: 'vertical_press', when: (ex) => muscleIs(ex, ['front_delts', 'lateral_delts', 'rear_delts']) },
  { pattern: /press/i, canonical: 'horizontal_press', when: (ex) => muscleIs(ex, ['chest_upper', 'chest_lower']) },
];

/**
 * Resolve an exercise's canonical movement pattern from its stored
 * movement_pattern (legacy tokens included) or, failing that, its name and
 * primary muscle. Returns null when unclassifiable — the pattern dimension
 * then reports "unknown" and stays conservatively unpaid.
 */
export function canonicalizeMovementPattern(ex: WarmupExerciseMeta): CanonicalMovementPattern | null {
  const raw = (ex.movementPattern ?? '').trim().toLowerCase();
  if (LEGACY_PATTERN_MAP[raw] !== undefined) {
    return LEGACY_PATTERN_MAP[raw];
  }
  if ((CANONICAL_MOVEMENT_PATTERNS as readonly string[]).includes(raw)) {
    // Already-canonical token
    return raw as CanonicalMovementPattern;
  }
  for (const rule of NAME_RULES) {
    if (rule.pattern.test(ex.name) && (!rule.when || rule.when(ex))) {
      return rule.canonical;
    }
  }
  // shoulder_isolation legacy token needs the name rules above; if none hit,
  // fall back by muscle for delts
  if (raw === 'shoulder_isolation') {
    return 'isolation_shoulder_abduction';
  }
  return null;
}

// ============================================
// ROM DEMAND DERIVATION
// ============================================

interface RomRule {
  pattern: RegExp;
  demands: RomDemand[];
  when?: (ex: WarmupExerciseMeta) => boolean;
}

const ROM_NAME_RULES: RomRule[] = [
  { pattern: /arnold|zottman|supinat|rotational press/i, demands: ['overhead', 'supination_pronation'] },
  { pattern: /jerk|push press/i, demands: ['overhead', 'overhead_lockout'] },
  { pattern: /overhead.*(extension|press)|(shoulder|military|viking)\s*press/i, demands: ['overhead'] },
  { pattern: /pull[- ]?up|chin[- ]?up|pulldown/i, demands: ['overhead'] },
  { pattern: /overhead.*extension|french press/i, demands: ['overhead', 'deep_stretch'] },
  { pattern: /fly|pec deck|crossover|pullover/i, demands: ['deep_stretch'] },
  { pattern: /preacher|incline.*curl|bayesian/i, demands: ['deep_stretch'] },
  { pattern: /rdl|romanian|stiff[- ]?leg|good morning/i, demands: ['hip_hinge_deep', 'deep_stretch'] },
  { pattern: /jefferson curl/i, demands: ['spinal_flexion_loaded', 'deep_stretch'] },
  { pattern: /cable crunch/i, demands: ['spinal_flexion_loaded'] },
  { pattern: /face pull|cuban/i, demands: ['shoulder_external_rotation'] },
  { pattern: /behind[- ](the[- ])?back/i, demands: ['behind_back'] },
  { pattern: /deep squat|atg|hack squat|pendulum/i, demands: ['deep_knee_flexion'] },
];

const PATTERN_ROM_DEFAULTS: Partial<Record<CanonicalMovementPattern, RomDemand[]>> = {
  vertical_press: ['overhead'],
  vertical_pull: ['overhead'],
  squat: ['deep_knee_flexion'],
  hinge: ['hip_hinge_deep'],
};

/**
 * Derive ROM demand tags for an exercise. Prefers the stored rom_demands
 * column (single source of truth once populated); when absent/empty, derives
 * from name rules plus the canonical pattern's defaults.
 */
export function deriveRomDemands(ex: WarmupExerciseMeta): RomDemand[] {
  const stored = (ex.romDemands ?? []).filter(Boolean) as RomDemand[];
  if (stored.length > 0) return Array.from(new Set(stored));

  const derived = new Set<RomDemand>();
  for (const rule of ROM_NAME_RULES) {
    if (rule.pattern.test(ex.name) && (!rule.when || rule.when(ex))) {
      rule.demands.forEach((d) => derived.add(d));
    }
  }
  const canonical = canonicalizeMovementPattern(ex);
  if (canonical && PATTERN_ROM_DEFAULTS[canonical]) {
    PATTERN_ROM_DEFAULTS[canonical]!.forEach((d) => derived.add(d));
  }
  return Array.from(derived);
}

// ============================================
// READINESS EVALUATION
// ============================================

/** Exponential warmth decay: 1.0 at Δt=0, 0.5 at the half-life. */
export function warmthDecay(minutesElapsed: number): number {
  if (!Number.isFinite(minutesElapsed) || minutesElapsed <= 0) return 1;
  return Math.pow(2, -minutesElapsed / WARMTH_HALF_LIFE_MINUTES);
}

function minutesBetween(now: Date, iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / 60000);
}

/**
 * Two standard sub-muscles are siblings when some legacy muscle group
 * contains both (chest_upper ↔ chest_lower, front_delts ↔ lateral_delts…).
 * Derived from the existing taxonomy — no parallel mapping.
 */
function areSiblingSubMuscles(a: string, b: string): boolean {
  if (a === b) return true;
  return Object.values(LEGACY_TO_STANDARD_MAP).some(
    (group) => (group as string[]).includes(a) && (group as string[]).includes(b)
  );
}

/** Standard-group overlap fraction between a prior block's muscles and the target's prime movers. */
function muscleOverlap(prior: WarmupExerciseMeta, target: WarmupExerciseMeta, priorIsWorkingSet: boolean): number {
  const targetStd = resolveMuscleToStandard(target.primaryMuscle ?? '');
  if (targetStd.length === 0) return 0;
  const targetSet = new Set<string>(targetStd);

  const priorPrimaryStd = resolveMuscleToStandard(prior.primaryMuscle ?? '');
  if (priorPrimaryStd.some((m) => targetSet.has(m))) return 1;

  // Sibling sub-muscle overlap (e.g. lower-chest fly warming upper chest):
  // shared blood flow and regional temperature, half credit.
  if (priorPrimaryStd.some((p) => targetStd.some((t) => areSiblingSubMuscles(p, t)))) return 0.5;

  // Secondary-muscle credit needs a working set behind it — light warmup
  // sets don't load secondaries meaningfully (mirrors getWarmedUpMuscles).
  if (priorIsWorkingSet) {
    for (const sec of prior.secondaryMuscles ?? []) {
      if (resolveMuscleToStandard(sec ?? '').some((m) => targetSet.has(m))) return 0.5;
    }
  }
  return 0;
}

function isWarmupTypeSet(s: SessionPriorSet): boolean {
  return Boolean(s.isWarmup) || s.setType === 'warmup';
}

const DEMAND_LABELS: Record<RomDemand, string> = {
  overhead: 'overhead position',
  overhead_lockout: 'overhead lockout',
  supination_pronation: 'rotation',
  deep_stretch: 'loaded stretch position',
  deep_knee_flexion: 'deep knee bend',
  hip_hinge_deep: 'deep hip hinge',
  spinal_flexion_loaded: 'loaded spinal flexion',
  shoulder_external_rotation: 'external rotation',
  behind_back: 'behind-the-back position',
};

const PATTERN_LABELS: Record<CanonicalMovementPattern, string> = {
  horizontal_press: 'horizontal pressing',
  vertical_press: 'vertical pressing',
  horizontal_pull: 'horizontal pulling',
  vertical_pull: 'vertical pulling',
  squat: 'squatting',
  hinge: 'hip hinging',
  lunge: 'lunging',
  carry: 'loaded carries',
  isolation_elbow_flexion: 'elbow flexion (curls)',
  isolation_elbow_extension: 'elbow extension',
  isolation_wrist_flexion: 'wrist flexion',
  isolation_wrist_extension: 'wrist extension',
  isolation_shoulder_abduction: 'lateral raising',
  isolation_shoulder_flexion: 'front raising',
  isolation_shoulder_horizontal_abduction: 'rear-delt work',
  isolation_shoulder_horizontal_adduction: 'fly work',
  isolation_shoulder_extension: 'shoulder extension',
  isolation_scapular_elevation: 'shrugging',
  isolation_knee_extension: 'knee extension',
  isolation_knee_flexion: 'knee flexion (curls)',
  isolation_ankle_plantar: 'calf work',
  isolation_hip_abduction: 'hip abduction',
  isolation_hip_adduction: 'hip adduction',
  isolation_hip_flexion: 'hip flexion',
  isolation_spinal_flexion: 'trunk flexion',
  isolation_spinal_extension: 'trunk extension',
  isolation_spinal_rotation: 'trunk rotation',
  isolation_anti_extension: 'core bracing',
  isolation_anti_rotation: 'anti-rotation core work',
};

/**
 * Evaluate warmup readiness for an exercise against the session so far and
 * return an explicit decision. Never returns silence: even "no warmup
 * needed" carries a reason for the card to display.
 */
export function evaluateWarmupReadiness(input: WarmupReadinessInput): WarmupDecision {
  const {
    exercise,
    workingWeightKg,
    targetReps,
    targetRir,
    completedSets,
    blocks,
    now,
    e1rmKg,
    isFirstExercise,
    barbellType,
  } = input;

  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const targetPattern = canonicalizeMovementPattern(exercise);
  const targetDemands = deriveRomDemands(exercise);

  // Prior sets on OTHER blocks (sets already logged on this exercise mean
  // the lifter is past warmup on it), with resolved metadata + decay.
  const priorSets = completedSets
    .map((s) => {
      const block = blocksById.get(s.exerciseBlockId);
      if (!block || block.exercise.id === exercise.id) return null;
      return {
        block,
        isWorking: !isWarmupTypeSet(s),
        decay: warmthDecay(minutesBetween(now, s.loggedAt)),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // ---- Dimension 1: muscle temperature ----
  let tempCredits = 0;
  let overlappingSetCount = 0;
  let freshestOverlapDecay = 0;
  for (const p of priorSets) {
    const overlap = muscleOverlap(p.block.exercise, exercise, p.isWorking);
    if (overlap <= 0) continue;
    // Warmup-type sets only half-credit their own primary overlap
    const setWeight = p.isWorking ? 1 : 0.5;
    tempCredits += overlap * setWeight * p.decay;
    overlappingSetCount++;
    freshestOverlapDecay = Math.max(freshestOverlapDecay, p.decay);
  }
  const tempScore = Math.min(1, tempCredits / MUSCLE_TEMP_SATURATION_CREDITS);
  const tempPaid = tempScore >= PAID_THRESHOLD;
  const staleness =
    overlappingSetCount > 0 && freshestOverlapDecay < PAID_THRESHOLD
      ? ' (decayed — last overlapping set was a while ago)'
      : '';
  const muscleTemperature: WarmupDimensionStatus = {
    paid: tempPaid,
    score: tempScore,
    reason:
      overlappingSetCount === 0
        ? 'No prior sets this session overlap the target muscle'
        : `${overlappingSetCount} prior set${overlappingSetCount === 1 ? '' : 's'} overlap${overlappingSetCount === 1 ? 's' : ''} the target muscle${staleness}`,
  };

  // ---- Dimension 2: movement pattern ----
  let patternCredits = 0;
  let patternSetCount = 0;
  for (const p of priorSets) {
    if (!p.isWorking) continue;
    const priorPattern = canonicalizeMovementPattern(p.block.exercise);
    if (priorPattern !== null && targetPattern !== null && priorPattern === targetPattern) {
      patternCredits += p.decay;
      patternSetCount++;
    }
  }
  const patternScore = targetPattern === null ? 0 : Math.min(1, patternCredits / PATTERN_SATURATION_CREDITS);
  const patternPaid = patternScore >= PAID_THRESHOLD;
  const patternLabel = targetPattern ? PATTERN_LABELS[targetPattern] : 'this movement';
  const movementPattern: WarmupDimensionStatus = {
    paid: patternPaid,
    score: patternScore,
    reason:
      targetPattern === null
        ? 'Movement pattern unknown — treated as not yet grooved'
        : patternSetCount === 0
          ? `No ${patternLabel} yet this session`
          : `${patternSetCount} prior set${patternSetCount === 1 ? '' : 's'} of ${patternLabel} this session`,
  };

  // ---- Dimension 3: joint position / ROM ----
  const unmetDemands: RomDemand[] = [];
  for (const demand of targetDemands) {
    let best = 0;
    for (const p of priorSets) {
      if (!p.isWorking) continue;
      if (deriveRomDemands(p.block.exercise).includes(demand)) {
        best = Math.max(best, p.decay);
      }
    }
    if (best < ROM_RECENCY_THRESHOLD) unmetDemands.push(demand);
  }
  const romScore = targetDemands.length === 0 ? 1 : (targetDemands.length - unmetDemands.length) / targetDemands.length;
  const jointRom: WarmupDimensionStatus & { unmetDemands: RomDemand[] } = {
    paid: unmetDemands.length === 0,
    score: romScore,
    unmetDemands,
    reason:
      targetDemands.length === 0
        ? 'No special ROM demands'
        : unmetDemands.length === 0
          ? 'All ROM demands already loaded this session'
          : `Not yet loaded today: ${unmetDemands.map((d) => DEMAND_LABELS[d]).join(', ')}`,
  };

  // ---- Dimension 4: load ramp ----
  let rampNeeded: boolean;
  let loadReason: string;
  if (workingWeightKg <= 0) {
    rampNeeded = false;
    loadReason = 'No working load set yet';
  } else if (e1rmKg && e1rmKg > 0) {
    const fraction = workingWeightKg / e1rmKg;
    rampNeeded = fraction >= LOAD_RAMP_E1RM_FRACTION;
    loadReason = rampNeeded
      ? `Top set is ${Math.round(fraction * 100)}% of estimated 1RM — load ramp required`
      : `Top set is a modest ${Math.round(fraction * 100)}% of estimated 1RM`;
  } else {
    const effectiveReps = targetReps + targetRir;
    rampNeeded = effectiveReps <= LOAD_RAMP_EFFECTIVE_REPS;
    loadReason = rampNeeded
      ? `Heavy top set (~${effectiveReps} reps to failure) — load ramp required`
      : `Moderate top set (~${effectiveReps} reps to failure) — no load ramp needed`;
  }
  const loadRamp: WarmupDimensionStatus = {
    paid: !rampNeeded,
    score: rampNeeded ? 0 : 1,
    reason: loadReason,
  };

  const dimensions = { muscleTemperature, movementPattern, jointRom, loadRamp };

  // ---- Decision synthesis ----
  const fullProtocol = (): WarmupSet[] =>
    generateWarmupProtocol({
      workingWeight: workingWeightKg > 0 ? workingWeightKg : 60,
      exercise: toEngineExercise(exercise),
      isFirstExercise,
      barbellType,
    });

  // Load ramp overrides warmth: heavy top sets get a ramp no matter how warm
  // the tissue is. When tissue is warm, keep only the heavier potentiation
  // steps; when cold, the full protocol already includes them.
  if (rampNeeded) {
    if (!tempPaid) {
      return decision('full_protocol', `Cold start into a heavy top set — full ramp protocol. ${loadReason}.`, fullProtocol(), dimensions);
    }
    const heavySteps = fullProtocol()
      .filter((s) => s.percentOfWorking >= 50)
      .map((s, i) => ({ ...s, setNumber: i + 1, reason: 'load ramp — heavy top set' }));
    return decision(
      'targeted_ramp',
      `Muscle is warm, but the top set is heavy — load ramp only. ${loadReason}.`,
      heavySteps,
      dimensions
    );
  }

  // Cold or stale tissue
  if (!tempPaid && !patternPaid) {
    if (tempScore > PARTIAL_CREDIT_FLOOR) {
      // Partial warmth credit (e.g. same muscle worked 40+ min ago): decay
      // applied, shortened protocol — skip the general warmup and lightest step.
      const sets = fullProtocol();
      const shortened = sets
        .filter((s, i) => !(i === 0 && sets.length > 2) && s.percentOfWorking >= 40)
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      const kept = shortened.length > 0 ? shortened : sets;
      return decision(
        'partial_protocol',
        `Partial warmth credit (${Math.round(tempScore * 100)}%) — earlier work has mostly decayed, so a shortened ramp: ${muscleTemperature.reason.toLowerCase()}.`,
        kept,
        dimensions
      );
    }
    return decision(
      'full_protocol',
      `Cold start — ${muscleTemperature.reason.toLowerCase()}, and no ${patternLabel} yet. Full ramp protocol.`,
      fullProtocol(),
      dimensions
    );
  }

  // Warm tissue, everything else paid → explicit null decision
  if (patternPaid && unmetDemands.length === 0) {
    return decision(
      'none',
      `No warmup needed — ${muscleTemperature.reason.toLowerCase()}, ${patternLabel} already grooved, and ${loadReason.toLowerCase()}.`,
      [],
      dimensions
    );
  }

  // Warm tissue but pattern and/or a ROM demand unpaid → ONE targeted ramp set
  const whyParts: string[] = [];
  if (unmetDemands.length > 0) {
    whyParts.push(`${unmetDemands.map((d) => DEMAND_LABELS[d]).join(' and ')} not yet loaded today`);
  }
  if (!patternPaid) {
    whyParts.push(`first ${patternLabel} of the session`);
  }
  const why = whyParts.join('; ');

  const rampSet: WarmupSet = {
    setNumber: 1,
    percentOfWorking: Math.round(TARGETED_RAMP_FRACTION * 100),
    targetReps: 10,
    purpose: unmetDemands.length > 0 ? `Groove ${unmetDemands.map((d) => DEMAND_LABELS[d]).join(' + ')}` : `Groove ${patternLabel}`,
    restSeconds: 45,
    reason: why,
  };
  return decision(
    'targeted_ramp',
    `Muscle is warm (${muscleTemperature.reason.toLowerCase()}), but ${why} — one targeted ramp set, full ROM.`,
    [rampSet],
    dimensions
  );
}

function decision(
  kind: WarmupDecisionKind,
  reason: string,
  sets: WarmupSet[],
  dimensions: WarmupDecision['dimensions']
): WarmupDecision {
  return { kind, reason, sets, dimensions, engineVersion: WARMUP_ENGINE_VERSION };
}

/** Adapt WarmupExerciseMeta to the Exercise shape generateWarmupProtocol expects. */
function toEngineExercise(ex: WarmupExerciseMeta) {
  return {
    id: ex.id,
    name: ex.name,
    primaryMuscle: ex.primaryMuscle,
    secondaryMuscles: ex.secondaryMuscles ?? [],
    mechanic: ex.mechanic ?? 'compound',
    defaultRepRange: [8, 12] as [number, number],
    defaultRir: 2,
    minWeightIncrementKg: ex.minWeightIncrementKg || 2.5,
    formCues: [],
    commonMistakes: [],
    setupNote: '',
    movementPattern: ex.movementPattern ?? '',
    equipmentRequired: ex.equipmentRequired ?? [],
  };
}
