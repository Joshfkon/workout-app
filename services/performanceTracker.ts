/**
 * Performance Tracker - Auto-Progression Logic
 *
 * Tracks exercise performance over time and generates progression flags
 * when users are ready to increase weight or when stagnation is detected.
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
}

/**
 * A flag indicating a recommended progression action
 */
export interface ProgressionFlag {
  exerciseId: string;
  exerciseName: string;
  action: 'increase_weight' | 'decrease_weight' | 'hold' | 'investigate';
  reason: string;
  /** Positive for increase, negative for decrease */
  suggestedAdjustmentKg: number;
  /** How many weeks without progress (for stagnation) */
  weeksStagnant?: number;
  /** When this flag was created */
  createdAt: Date;
  /** Priority level */
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
// PERFORMANCE TRACKER CLASS
// ============================================

/**
 * Tracks exercise performance and generates progression recommendations
 *
 * Usage:
 * 1. Create instance with historical data
 * 2. Call addSetResult() after each set
 * 3. getProgressionFlag() returns recommendations
 * 4. clearProgressionFlag() after user acknowledges
 */
export class PerformanceTracker {
  private setHistory: PerformanceSetLog[] = [];
  private progressionFlags: Map<string, ProgressionFlag> = new Map();
  private readonly maxHistorySize = 200;

  constructor(initialHistory: PerformanceSetLog[] = []) {
    this.setHistory = initialHistory.slice(-this.maxHistorySize);
  }

  /**
   * Add a set result and evaluate for progression
   */
  addSetResult(result: PerformanceSetLog): void {
    this.setHistory.push(result);

    // Keep history size bounded
    if (this.setHistory.length > this.maxHistorySize) {
      this.setHistory = this.setHistory.slice(-this.maxHistorySize);
    }

    // Evaluate progression opportunities
    this.evaluateProgression(result.exerciseName);
    this.checkForStagnation(result.exerciseName);
  }

  /**
   * Evaluate if user is ready for weight increase or decrease
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
      const lastWeight = sets[sets.length - 1].weight;
      this.progressionFlags.set(key, {
        exerciseId: sets[0].exerciseId,
        exerciseName,
        action: 'increase_weight',
        reason: `Hit top of rep range ${sessionsRequired} sessions in a row with 3+ RIR`,
        suggestedAdjustmentKg: this.getIncrement(exerciseName, lastWeight),
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
      const lastWeight = sets[sets.length - 1].weight;
      this.progressionFlags.set(key, {
        exerciseId: sets[0].exerciseId,
        exerciseName,
        action: 'decrease_weight',
        reason: 'Consistently missing rep targets or hitting failure',
        suggestedAdjustmentKg: -this.getIncrement(exerciseName, lastWeight),
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

      // Don't override existing weight adjustment flags
      const existingFlag = this.progressionFlags.get(key);
      if (existingFlag && existingFlag.action !== 'investigate') return;

      this.progressionFlags.set(key, {
        exerciseId: sets[0].exerciseId,
        exerciseName,
        action: 'investigate',
        reason: `No progression in ${weeksStagnant} weeks despite reporting ${avgRIR.toFixed(1)} avg RIR. Either push harder or there's a recovery issue.`,
        suggestedAdjustmentKg: 0,
        weeksStagnant,
        createdAt: new Date(),
        priority: weeksStagnant >= 6 ? 'high' : 'medium',
      });
    }
  }

  /**
   * Get the current progression flag for an exercise
   */
  getProgressionFlag(exerciseName: string): ProgressionFlag | null {
    return this.progressionFlags.get(exerciseName.toLowerCase()) || null;
  }

  /**
   * Clear a progression flag after user acknowledges it
   */
  clearProgressionFlag(exerciseName: string): void {
    this.progressionFlags.delete(exerciseName.toLowerCase());
  }

  /**
   * Get all active progression flags
   */
  getAllFlags(): ProgressionFlag[] {
    return Array.from(this.progressionFlags.values())
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

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
   * Get appropriate weight increment for an exercise
   */
  private getIncrement(exerciseName: string, currentWeight: number): number {
    const smallMuscleKeywords = ['lateral', 'curl', 'tricep', 'calf', 'raise', 'fly', 'extension', 'isolation'];
    const isSmallMuscle = smallMuscleKeywords.some(k =>
      exerciseName.toLowerCase().includes(k)
    );

    if (isSmallMuscle || currentWeight < 15) return 1;
    if (exerciseName.toLowerCase().includes('dumbbell') || exerciseName.toLowerCase().includes('db ')) return 2;
    return 2.5;
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
    flags: ProgressionFlag[];
  } {
    return {
      history: this.setHistory,
      flags: Array.from(this.progressionFlags.values()),
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get action display text
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
 * Get action color
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
 * Format weight adjustment for display
 */
export function formatAdjustment(adjustmentKg: number): string {
  if (adjustmentKg === 0) return 'No change';
  const sign = adjustmentKg > 0 ? '+' : '';
  return `${sign}${adjustmentKg.toFixed(1)}kg`;
}

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
  prescribedMax: number | null = null
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
