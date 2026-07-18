/**
 * Performance Tracker - Performance Signal Detection
 *
 * Tracks exercise performance over time and generates informational signals
 * when patterns are detected (overperformance, underperformance, stagnation).
 *
 * IMPORTANT: This module is ANALYSIS-ONLY. It does NOT produce authoritative
 * weight recommendations. Weight/rep suggestions come exclusively from
 * services/setRecommender.ts (with weightEstimationEngine for cold starts).
 * Signals from this module are advisory and displayed to users as
 * informational banners.
 *
 * Pure functions - no database calls.
 */

import { getFailureSafetyTier } from './exerciseSafety';

// ============================================
// TYPES
// ============================================

/**
 * A logged set for performance tracking
 */
export interface PerformanceSetLog {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  prescribedReps: { min: number; max: number | null };
  actualReps: number;
  /** User's reported reps in reserve */
  reportedRIR: number;
  wasAMRAP: boolean;
  timestamp: Date;
  /**
   * True when this set came from a deload session. Deload sets are excluded
   * from effort-creep / stagnation baselines (a light week must not read as a
   * plateau or drag the trend), so they are never added to the tracker.
   */
  isDeload?: boolean;
}

/**
 * Signal types emitted by the performance tracker.
 * These are informational observations, NOT weight change directives.
 */
export type SignalType =
  | 'stagnation_detected'
  | 'consistent_overperformance'
  | 'consistent_underperformance'
  | 'recovery_concern';

/**
 * An informational signal indicating a detected performance pattern.
 * Unlike the deprecated ProgressionFlag, signals do NOT include
 * suggestedAdjustmentKg or authoritative weight change actions.
 */
export interface PerformanceSignal {
  exerciseId: string;
  exerciseName: string;
  signal: SignalType;
  reason: string;
  /** How many weeks of data contributed to this signal */
  dataWeeks: number;
  createdAt: Date;
  priority: 'high' | 'medium' | 'low';
  /** Additional numeric data for downstream consumers */
  metadata?: Record<string, number>;
}

/**
 * A flag indicating a recommended progression action.
 *
 * @deprecated Use PerformanceSignal instead. ProgressionFlag included
 * authoritative weight recommendations (suggestedAdjustmentKg) which
 * could conflict with progressionEngine targets. PerformanceSignal is
 * analysis-only and does not prescribe weight changes.
 */
export interface ProgressionFlag {
  exerciseId: string;
  exerciseName: string;
  action: 'increase_weight' | 'decrease_weight' | 'hold' | 'investigate';
  reason: string;
  /** @deprecated Signals no longer include weight adjustments */
  suggestedAdjustmentKg: number;
  weeksStagnant?: number;
  createdAt: Date;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Session grouping for analysis
 */
interface SessionGroup {
  date: Date;
  sets: PerformanceSetLog[];
}

// ============================================
// SIGNAL → FLAG CONVERSION (backward compat)
// ============================================

/**
 * Map signal types to legacy flag actions for backward compatibility
 */
const SIGNAL_TO_ACTION: Record<SignalType, ProgressionFlag['action']> = {
  consistent_overperformance: 'increase_weight',
  consistent_underperformance: 'decrease_weight',
  stagnation_detected: 'investigate',
  recovery_concern: 'investigate',
};

/**
 * Convert a PerformanceSignal to a deprecated ProgressionFlag
 * for backward compatibility with consumers that haven't migrated yet.
 */
function signalToFlag(signal: PerformanceSignal): ProgressionFlag {
  return {
    exerciseId: signal.exerciseId,
    exerciseName: signal.exerciseName,
    action: SIGNAL_TO_ACTION[signal.signal],
    reason: signal.reason,
    suggestedAdjustmentKg: 0,  // Signals don't include weight adjustments
    weeksStagnant: signal.metadata?.weeksStagnant,
    createdAt: signal.createdAt,
    priority: signal.priority,
  };
}

// ============================================
// PERFORMANCE TRACKER CLASS
// ============================================

/**
 * Tracks exercise performance and detects patterns worth surfacing to users.
 *
 * Usage:
 * 1. Create instance with historical data
 * 2. Call addSetResult() after each set
 * 3. getPerformanceSignal() returns detected patterns
 * 4. clearSignal() after user acknowledges
 *
 * NOTE: This class is for pattern detection only. Actual weight/rep
 * suggestions come from services/setRecommender.ts.
 */
export class PerformanceTracker {
  private setHistory: PerformanceSetLog[] = [];
  private performanceSignals: Map<string, PerformanceSignal> = new Map();
  private readonly maxHistorySize = 200;

  constructor(initialHistory: PerformanceSetLog[] = []) {
    this.setHistory = initialHistory.slice(-this.maxHistorySize);
  }

  /**
   * Add a set result and evaluate for performance patterns
   */
  addSetResult(result: PerformanceSetLog): void {
    // Deload sets are held light on purpose — excluding them keeps effort-creep
    // and stagnation baselines honest (a deload week isn't a plateau) and lets a
    // deload break a stagnation streak instead of extending it.
    if (result.isDeload) return;

    this.setHistory.push(result);

    // Keep history size bounded
    if (this.setHistory.length > this.maxHistorySize) {
      this.setHistory = this.setHistory.slice(-this.maxHistorySize);
    }

    // Detect performance patterns
    this.evaluateProgression(result.exerciseName);
    this.checkForStagnation(result.exerciseName);
  }

  /**
   * Detect consistent over/under-performance patterns
   */
  private evaluateProgression(exerciseName: string): void {
    const key = exerciseName.toLowerCase();
    const sets = this.setHistory.filter(s => s.exerciseName.toLowerCase() === key);

    if (sets.length < 6) return;

    const tier = getFailureSafetyTier(exerciseName);
    const sessionsRequired = tier === 'push_freely' ? 2 : 3;

    const sessions = this.groupBySessions(sets);
    if (sessions.length < sessionsRequired) return;

    const recentSessions = sessions.slice(-sessionsRequired);

    // Calculate data span in weeks
    const firstDate = recentSessions[0].date;
    const lastDate = recentSessions[recentSessions.length - 1].date;
    const dataWeeks = Math.max(1, Math.ceil(
      (lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    ));

    // Over-performance: hitting top of range at low RIR consistently
    const isOverperforming = recentSessions.every(session =>
      session.sets.some(set =>
        !set.wasAMRAP &&
        set.prescribedReps.max !== null &&
        set.actualReps >= set.prescribedReps.max &&
        set.reportedRIR >= 3
      )
    );

    if (isOverperforming) {
      this.performanceSignals.set(key, {
        exerciseId: sets[0].exerciseId,
        exerciseName,
        signal: 'consistent_overperformance',
        reason: `Hit top of rep range ${sessionsRequired} sessions in a row with 3+ RIR`,
        dataWeeks,
        createdAt: new Date(),
        priority: 'medium',
      });
      return;
    }

    // Under-performance: missing targets or grinding consistently
    // Note: AMRAP sets are excluded from RIR check since they intentionally go to failure
    const isUnderperforming = recentSessions.every(session =>
      session.sets.every(set => {
        // For AMRAP sets, only check if they missed the rep minimum
        if (set.wasAMRAP) {
          return set.actualReps < set.prescribedReps.min;
        }
        // For non-AMRAP sets, missing reps OR hitting failure indicates underperformance
        return set.actualReps < set.prescribedReps.min || set.reportedRIR === 0;
      })
    );

    if (isUnderperforming) {
      this.performanceSignals.set(key, {
        exerciseId: sets[0].exerciseId,
        exerciseName,
        signal: 'consistent_underperformance',
        reason: 'Consistently missing rep targets or hitting failure',
        dataWeeks,
        createdAt: new Date(),
        priority: 'high',
      });
    }
  }

  /**
   * Detect long-term stagnation with moderate RPE (sandbagging signal)
   */
  private checkForStagnation(exerciseName: string): void {
    const key = exerciseName.toLowerCase();
    const sets = this.setHistory.filter(s => s.exerciseName.toLowerCase() === key);

    if (sets.length < 12) return; // Need ~4 weeks of data

    // Get weight trend over last 8 weeks
    const eightWeeksAgo = new Date();
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

    const recentSets = sets.filter(s => s.timestamp > eightWeeksAgo);
    if (recentSets.length < 8) return;

    const weights = recentSets.map(s => s.weight);
    const maxWeight = Math.max(...weights);
    const minWeight = Math.min(...weights);
    const avgRIR = recentSets.reduce((a, b) => a + b.reportedRIR, 0) / recentSets.length;

    // Stagnation: <5% weight variance over 8 weeks with moderate RIR
    const variance = (maxWeight - minWeight) / Math.max(1, maxWeight);

    if (variance < 0.05 && avgRIR >= 2) {
      const weeksStagnant = Math.floor(
        (Date.now() - recentSets[0].timestamp.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      // Don't override existing overperformance/underperformance signals
      const existingSignal = this.performanceSignals.get(key);
      if (existingSignal && existingSignal.signal !== 'stagnation_detected') return;

      this.performanceSignals.set(key, {
        exerciseId: sets[0].exerciseId,
        exerciseName,
        signal: 'stagnation_detected',
        reason: `No progression in ${weeksStagnant} weeks despite reporting ${avgRIR.toFixed(1)} avg RIR. Either push harder or there's a recovery issue.`,
        dataWeeks: Math.min(weeksStagnant, 8),
        createdAt: new Date(),
        priority: weeksStagnant >= 6 ? 'high' : 'medium',
        metadata: {
          weeksStagnant,
          avgRIR: Math.round(avgRIR * 10) / 10,
          weightVariance: Math.round(variance * 1000) / 1000,
        },
      });
    }
  }

  // ==========================================
  // SIGNAL-BASED API (preferred)
  // ==========================================

  /**
   * Get the current performance signal for an exercise
   */
  getPerformanceSignal(exerciseName: string): PerformanceSignal | null {
    return this.performanceSignals.get(exerciseName.toLowerCase()) || null;
  }

  /**
   * Clear a signal after user acknowledges it
   */
  clearSignal(exerciseName: string): void {
    this.performanceSignals.delete(exerciseName.toLowerCase());
  }

  /**
   * Get all active performance signals, sorted by priority
   */
  getAllSignals(): PerformanceSignal[] {
    return Array.from(this.performanceSignals.values())
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  // ==========================================
  // DEPRECATED FLAG-BASED API (backward compat)
  // ==========================================

  /**
   * Get the current progression flag for an exercise.
   * @deprecated Use getPerformanceSignal() instead.
   */
  getProgressionFlag(exerciseName: string): ProgressionFlag | null {
    const signal = this.getPerformanceSignal(exerciseName);
    return signal ? signalToFlag(signal) : null;
  }

  /**
   * Clear a progression flag after user acknowledges it.
   * @deprecated Use clearSignal() instead.
   */
  clearProgressionFlag(exerciseName: string): void {
    this.clearSignal(exerciseName);
  }

  /**
   * Get all active progression flags.
   * @deprecated Use getAllSignals() instead.
   */
  getAllFlags(): ProgressionFlag[] {
    return this.getAllSignals().map(signalToFlag);
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  /**
   * Group sets by workout session (same day)
   */
  private groupBySessions(sets: PerformanceSetLog[]): SessionGroup[] {
    const sessions: SessionGroup[] = [];
    let currentSession: PerformanceSetLog[] = [];
    let currentDate: string | null = null;

    for (const set of sets) {
      const dateStr = set.timestamp.toDateString();
      if (dateStr !== currentDate) {
        if (currentSession.length > 0) {
          sessions.push({
            date: currentSession[0].timestamp,
            sets: currentSession,
          });
        }
        currentSession = [set];
        currentDate = dateStr;
      } else {
        currentSession.push(set);
      }
    }

    if (currentSession.length > 0) {
      sessions.push({
        date: currentSession[0].timestamp,
        sets: currentSession,
      });
    }

    return sessions;
  }

  /**
   * Get performance summary for an exercise
   */
  getExerciseSummary(exerciseName: string): {
    totalSets: number;
    avgWeight: number;
    avgReps: number;
    avgRIR: number;
    trend: 'improving' | 'stable' | 'declining';
    lastSession: Date | null;
  } | null {
    const key = exerciseName.toLowerCase();
    const sets = this.setHistory.filter(s => s.exerciseName.toLowerCase() === key);

    if (sets.length === 0) return null;

    const totalSets = sets.length;
    const avgWeight = sets.reduce((a, b) => a + b.weight, 0) / sets.length;
    const avgReps = sets.reduce((a, b) => a + b.actualReps, 0) / sets.length;
    const avgRIR = sets.reduce((a, b) => a + b.reportedRIR, 0) / sets.length;
    const lastSession = sets[sets.length - 1].timestamp;

    // Calculate trend based on first half vs second half
    const midpoint = Math.floor(sets.length / 2);
    if (midpoint < 3) {
      return { totalSets, avgWeight, avgReps, avgRIR, trend: 'stable', lastSession };
    }

    const firstHalfAvg = sets.slice(0, midpoint).reduce((a, b) => a + b.weight, 0) / midpoint;
    const secondHalfAvg = sets.slice(midpoint).reduce((a, b) => a + b.weight, 0) / (sets.length - midpoint);

    const change = (secondHalfAvg - firstHalfAvg) / Math.max(1, firstHalfAvg);

    let trend: 'improving' | 'stable' | 'declining';
    if (change > 0.03) {
      trend = 'improving';
    } else if (change < -0.03) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    return { totalSets, avgWeight, avgReps, avgRIR, trend, lastSession };
  }

  /**
   * Export data for persistence
   */
  exportData(): {
    history: PerformanceSetLog[];
    signals: PerformanceSignal[];
    /** @deprecated Use signals instead */
    flags: ProgressionFlag[];
  } {
    const signals = Array.from(this.performanceSignals.values());
    return {
      history: this.setHistory,
      signals,
      flags: signals.map(signalToFlag),
    };
  }
}

// ============================================
// SIGNAL DISPLAY HELPERS (preferred)
// ============================================

/**
 * Get display text for a performance signal type
 */
export function getSignalDisplayText(signal: SignalType): string {
  switch (signal) {
    case 'consistent_overperformance':
      return 'Consistently Exceeding Targets';
    case 'consistent_underperformance':
      return 'Struggling With Current Targets';
    case 'stagnation_detected':
      return 'Stagnation Detected';
    case 'recovery_concern':
      return 'Recovery Concern';
  }
}

/**
 * Get display color for a performance signal type
 */
export function getSignalColor(signal: SignalType): 'green' | 'yellow' | 'red' | 'blue' {
  switch (signal) {
    case 'consistent_overperformance':
      return 'green';
    case 'consistent_underperformance':
      return 'red';
    case 'stagnation_detected':
      return 'yellow';
    case 'recovery_concern':
      return 'yellow';
  }
}

// ============================================
// DEPRECATED DISPLAY HELPERS (backward compat)
// ============================================

/**
 * Get action display text.
 * @deprecated Use getSignalDisplayText() instead.
 */
export function getActionDisplayText(action: ProgressionFlag['action']): string {
  switch (action) {
    case 'increase_weight':
      return 'Ready to Progress';
    case 'decrease_weight':
      return 'Consider Reducing Weight';
    case 'hold':
      return 'Stay at Current Weight';
    case 'investigate':
      return 'Needs Attention';
  }
}

/**
 * Get action color.
 * @deprecated Use getSignalColor() instead.
 */
export function getActionColor(action: ProgressionFlag['action']): 'green' | 'yellow' | 'red' | 'blue' {
  switch (action) {
    case 'increase_weight':
      return 'green';
    case 'decrease_weight':
      return 'red';
    case 'hold':
      return 'blue';
    case 'investigate':
      return 'yellow';
  }
}

/**
 * Format weight adjustment for display.
 * @deprecated Signals no longer include weight adjustment recommendations.
 */
export function formatAdjustment(adjustmentKg: number): string {
  if (adjustmentKg === 0) return 'No change';
  const sign = adjustmentKg > 0 ? '+' : '';
  return `${sign}${adjustmentKg.toFixed(1)}kg`;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create a performance set log from workout data
 */
export function createPerformanceSetLog(
  exerciseId: string,
  exerciseName: string,
  weight: number,
  reps: number,
  reportedRIR: number,
  wasAMRAP: boolean,
  prescribedMin: number,
  prescribedMax: number | null = null,
  isDeload = false
): PerformanceSetLog {
  return {
    exerciseId,
    exerciseName,
    weight,
    prescribedReps: { min: prescribedMin, max: prescribedMax },
    actualReps: reps,
    reportedRIR,
    wasAMRAP,
    timestamp: new Date(),
    isDeload,
  };
}

/**
 * Merge two performance trackers (for syncing)
 */
export function mergePerformanceData(
  local: PerformanceSetLog[],
  remote: PerformanceSetLog[]
): PerformanceSetLog[] {
  const combined = [...local, ...remote];

  // Deduplicate by timestamp + exercise + weight + reps
  const seen = new Set<string>();
  return combined.filter(log => {
    const key = `${log.timestamp.getTime()}-${log.exerciseName}-${log.weight}-${log.actualReps}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
