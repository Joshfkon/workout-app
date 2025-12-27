/**
 * Sanity Checks
 *
 * Detects potential issues with logged sets:
 * - Warmup sets reported as hard
 * - Rest time vs effort mismatch
 * - Failure on protected exercises
 *
 * Pure functions - no database calls.
 */

import { getFailureSafetyTier } from './exerciseSafety';

// ============================================
// TYPES
// ============================================

/**
 * Type of sanity check issue detected
 */
export type SanityCheckType =
  | 'warmup_rpe_mismatch'
  | 'rest_time_mismatch'
  | 'protect_tier_failure'
  | 'protect_tier_warning'
  | 'performance_decline'
  | 'excessive_rest';

/**
 * Severity of the sanity check
 */
export type SanityCheckSeverity = 'info' | 'warning' | 'alert';

/**
 * Result of a sanity check
 */
export interface SanityCheckResult {
  type: SanityCheckType;
  message: string;
  severity: SanityCheckSeverity;
  /** Optional suggestion for the user */
  suggestion?: string;
  /** Whether to persist this check (show on summary) */
  persistent?: boolean;
}

/**
 * A logged set for sanity checking
 */
export interface SanityCheckSetLog {
  exerciseName: string;
  weight: number;
  reps: number;
  reportedRIR: number;
  restTimeSeconds?: number;
  isWarmup: boolean;
  setNumber: number;
}

/**
 * Context for sanity checking
 */
export interface SanityCheckContext {
  /** Working weight for this exercise */
  workingWeight: number;
  /** Timestamp of previous set (for rest time calculation) */
  previousSetTimestamp?: Date;
  /** Current set timestamp */
  currentTimestamp: Date;
  /** Previous sets in this session for this exercise */
  previousSets?: SanityCheckSetLog[];
}

// ============================================
// MAIN SANITY CHECK FUNCTION
// ============================================

/**
 * Check a set for potential issues
 * Returns the most important issue found, or null if none
 */
export function checkSetSanity(
  set: SanityCheckSetLog,
  context: SanityCheckContext
): SanityCheckResult | null {
  const tier = getFailureSafetyTier(set.exerciseName);

  // Check in order of priority (most important first)

  // 1. Failure on protected exercise - highest priority
  if (tier === 'protect' && set.reportedRIR === 0) {
    return {
      type: 'protect_tier_failure',
      message: `Going to failure on ${set.exerciseName} significantly increases injury risk. A torn pec, blown disc, or dropped bar isn't worth that last rep. Stay at 2+ RIR on heavy barbell compounds.`,
      severity: 'alert',
      suggestion: 'Consider reducing weight next session to maintain safer margins.',
      persistent: true,
    };
  }

  // 2. Near-failure warning on protected exercise
  if (tier === 'protect' && set.reportedRIR === 1) {
    return {
      type: 'protect_tier_warning',
      message: `That was close to failure on ${set.exerciseName}. We recommend staying at 2+ RIR on heavy compounds to reduce injury risk.`,
      severity: 'warning',
      suggestion: 'Keep 1-2 more reps in reserve on barbell compounds.',
    };
  }

  // 3. Warmup set with high RPE
  if (set.isWarmup || set.weight < context.workingWeight * 0.70) {
    if (set.reportedRIR <= 2 && set.reps >= 3) {
      return {
        type: 'warmup_rpe_mismatch',
        message: `You reported ${set.reportedRIR} RIR on a warm-up set. Either the weight is too heavy for a warm-up, or your RIR perception may need calibration.`,
        severity: 'info',
        suggestion: 'Warm-up sets should feel easy (4+ RIR). If they don\'t, reduce working weight.',
      };
    }
  }

  // 4. Rest time vs reported effort mismatch
  if (context.previousSetTimestamp && set.restTimeSeconds) {
    const reportedEasy = set.reportedRIR >= 4;
    const longRest = set.restTimeSeconds > 180; // 3+ minutes

    if (reportedEasy && longRest) {
      return {
        type: 'rest_time_mismatch',
        message: `You rested ${Math.floor(set.restTimeSeconds / 60)}+ minutes after reporting ${set.reportedRIR} RIR. Long rests usually mean the set was harder than it felt.`,
        severity: 'info',
        suggestion: 'Your body might be working harder than your mind thinks. Trust your rest time needs.',
      };
    }
  }

  // 5. Excessive rest on isolation exercises (>5 minutes)
  if (set.restTimeSeconds && set.restTimeSeconds > 300) {
    const isIsolation = tier === 'push_freely' &&
      !set.exerciseName.toLowerCase().includes('compound') &&
      !set.exerciseName.toLowerCase().includes('squat') &&
      !set.exerciseName.toLowerCase().includes('deadlift');

    if (isIsolation) {
      return {
        type: 'excessive_rest',
        message: `${Math.floor(set.restTimeSeconds / 60)} minute rest on an isolation exercise is quite long.`,
        severity: 'info',
        suggestion: '2-3 minutes is usually sufficient for isolation work. Longer rests may indicate the weight is too heavy.',
      };
    }
  }

  // 6. Performance decline within session (later sets much worse)
  if (context.previousSets && context.previousSets.length >= 2 && set.setNumber >= 3) {
    const firstSetReps = context.previousSets[0]?.reps || 0;
    const repDropoff = firstSetReps - set.reps;

    if (repDropoff >= 4 && set.weight === context.previousSets[0]?.weight) {
      return {
        type: 'performance_decline',
        message: `Rep count dropped by ${repDropoff} from your first set. This might indicate fatigue or the need for longer rest.`,
        severity: 'info',
        suggestion: 'Consider slightly longer rest periods or reducing weight on later sets.',
      };
    }
  }

  return null;
}

/**
 * Check all sets in a session for issues
 */
export function checkSessionSanity(
  sets: SanityCheckSetLog[],
  workingWeight: number
): SanityCheckResult[] {
  const results: SanityCheckResult[] = [];

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    const previousSets = sets.slice(0, i);

    const context: SanityCheckContext = {
      workingWeight,
      previousSets,
      currentTimestamp: new Date(),
    };

    const result = checkSetSanity(set, context);
    if (result) {
      results.push(result);
    }
  }

  // Deduplicate by type (keep first occurrence)
  const seen = new Set<SanityCheckType>();
  return results.filter(r => {
    if (seen.has(r.type)) return false;
    seen.add(r.type);
    return true;
  });
}

// ============================================
// SPECIFIC CHECK FUNCTIONS
// ============================================

/**
 * Check if a warmup set has inappropriate RIR
 */
export function checkWarmupRIR(
  weight: number,
  workingWeight: number,
  reportedRIR: number,
  reps: number
): SanityCheckResult | null {
  const isWarmup = weight < workingWeight * 0.70;

  if (isWarmup && reportedRIR <= 2 && reps >= 3) {
    return {
      type: 'warmup_rpe_mismatch',
      message: `You reported ${reportedRIR} RIR on a warm-up set (${Math.round(weight / workingWeight * 100)}% of working weight).`,
      severity: 'info',
      suggestion: 'Warm-up sets should feel easy. Consider reducing your working weight.',
    };
  }

  return null;
}

/**
 * Check rest time vs effort consistency
 */
export function checkRestTimeConsistency(
  reportedRIR: number,
  restTimeSeconds: number
): SanityCheckResult | null {
  // Easy set but long rest
  if (reportedRIR >= 4 && restTimeSeconds > 180) {
    return {
      type: 'rest_time_mismatch',
      message: `${Math.floor(restTimeSeconds / 60)}+ minute rest after an "easy" set (${reportedRIR} RIR).`,
      severity: 'info',
      suggestion: 'Long rest suggests the set was harder than perceived.',
    };
  }

  // Hard set but short rest
  if (reportedRIR <= 1 && restTimeSeconds < 60 && restTimeSeconds > 0) {
    return {
      type: 'rest_time_mismatch',
      message: `Only ${restTimeSeconds}s rest after a near-failure set.`,
      severity: 'warning',
      suggestion: 'Consider longer rest after hard sets to maintain performance.',
    };
  }

  return null;
}

/**
 * Check for protected tier violations
 */
export function checkProtectedTierSafety(
  exerciseName: string,
  reportedRIR: number
): SanityCheckResult | null {
  const tier = getFailureSafetyTier(exerciseName);

  if (tier !== 'protect') return null;

  if (reportedRIR === 0) {
    return {
      type: 'protect_tier_failure',
      message: `Failure on ${exerciseName} - high injury risk.`,
      severity: 'alert',
      suggestion: 'Stay at 2+ RIR on heavy barbell compounds.',
      persistent: true,
    };
  }

  if (reportedRIR === 1) {
    return {
      type: 'protect_tier_warning',
      message: `Close to failure on ${exerciseName}.`,
      severity: 'warning',
      suggestion: 'Keep 2+ reps in reserve on heavy compounds.',
    };
  }

  return null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get severity color for display
 */
export function getSeverityColor(severity: SanityCheckSeverity): 'blue' | 'yellow' | 'red' {
  switch (severity) {
    case 'info':
      return 'blue';
    case 'warning':
      return 'yellow';
    case 'alert':
      return 'red';
  }
}

/**
 * Get severity icon name
 */
export function getSeverityIcon(severity: SanityCheckSeverity): string {
  switch (severity) {
    case 'info':
      return 'info-circle';
    case 'warning':
      return 'alert-triangle';
    case 'alert':
      return 'alert-octagon';
  }
}

/**
 * Should this check auto-dismiss?
 */
export function shouldAutoDismiss(type: SanityCheckType): boolean {
  switch (type) {
    case 'protect_tier_failure':
    case 'protect_tier_warning':
      return false; // Important safety checks should persist
    default:
      return true; // Others can auto-dismiss
  }
}

/**
 * Get display title for check type
 */
export function getCheckTypeTitle(type: SanityCheckType): string {
  switch (type) {
    case 'warmup_rpe_mismatch':
      return 'Warm-up Intensity Check';
    case 'rest_time_mismatch':
      return 'Rest Time vs Effort';
    case 'protect_tier_failure':
      return 'Safety Alert';
    case 'protect_tier_warning':
      return 'Safety Warning';
    case 'performance_decline':
      return 'Performance Drop';
    case 'excessive_rest':
      return 'Long Rest Period';
  }
}

/**
 * Group checks by severity
 */
export function groupChecksBySeverity(
  checks: SanityCheckResult[]
): Record<SanityCheckSeverity, SanityCheckResult[]> {
  return {
    alert: checks.filter(c => c.severity === 'alert'),
    warning: checks.filter(c => c.severity === 'warning'),
    info: checks.filter(c => c.severity === 'info'),
  };
}

/**
 * Count checks by severity
 */
export function countChecksBySeverity(
  checks: SanityCheckResult[]
): { alerts: number; warnings: number; infos: number } {
  const grouped = groupChecksBySeverity(checks);
  return {
    alerts: grouped.alert.length,
    warnings: grouped.warning.length,
    infos: grouped.info.length,
  };
}
