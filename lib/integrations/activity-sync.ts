/**
 * Unified Activity Sync Service
 *
 * Combines data from all wearable sources (HealthKit, Google Fit, Fitbit)
 * with app workout data, handles step normalization, and calculates
 * activity expenditure.
 */

import type {
  WearableSource,
  WearableConnection,
  StepData,
  EnergyData,
  DailyActivityData,
  AppWorkoutActivity,
  NetActivityExpenditure,
  ActivityLevel,
} from '@/types/wearable';
import {
  BASELINE_STEP_MULTIPLIERS,
  BASE_CALORIES_PER_STEP,
  getActivityLevelFromSteps,
} from '@/types/wearable';

import { healthKitService, fetchHealthKitHourlySteps } from './healthkit';
import { googleFitService, fetchGoogleFitHourlySteps } from './google-fit';
import { fitbitService, fetchFitbitHourlySteps } from './fitbit';
import { estimateWorkoutExpenditure } from './workout-calories';
import { normalizeSteps } from './step-normalization';

// === TYPES ===

interface SyncOptions {
  /** User's active wearable connections */
  connections: WearableConnection[];
  /** Preferred source (null = use priority order) */
  preferredSource?: WearableSource | null;
  /** User's weight in kg for calorie calculations */
  userWeightKg: number;
}

interface SyncResult {
  success: boolean;
  data?: DailyActivityData;
  error?: string;
  source?: WearableSource;
}

// Priority order for wearable sources (first available wins)
const SOURCE_PRIORITY: WearableSource[] = [
  'apple_healthkit',
  'google_fit',
  'fitbit',
  'samsung_health',
  'garmin',
  'manual',
];

// === SERVICE CLASS ===

/**
 * Unified service for syncing activity data from all sources
 */
class ActivitySyncService {
  /**
   * Sync activity data for a specific date from all available sources
   */
  async syncDailyActivity(
    userId: string,
    date: Date,
    options: SyncOptions
  ): Promise<SyncResult> {
    const { connections, preferredSource, userWeightKg } = options;

    // Find the best available source
    const activeConnections = connections.filter((c) => c.isConnected);
    if (activeConnections.length === 0) {
      return { success: false, error: 'No wearable connections available' };
    }

    // Determine which source to use
    let targetSource: WearableSource | null = null;
    let targetConnection: WearableConnection | null = null;

    if (preferredSource) {
      const preferred = activeConnections.find((c) => c.source === preferredSource);
      if (preferred) {
        targetSource = preferredSource;
        targetConnection = preferred;
      }
    }

    if (!targetSource) {
      // Use priority order
      for (const source of SOURCE_PRIORITY) {
        const connection = activeConnections.find((c) => c.source === source);
        if (connection) {
          targetSource = source;
          targetConnection = connection;
          break;
        }
      }
    }

    if (!targetSource || !targetConnection) {
      return { success: false, error: 'No suitable wearable source found' };
    }

    try {
      // Fetch data from the selected source
      const rawData = await this.fetchFromSource(targetSource, date);

      if (!rawData || rawData.steps === 0) {
        // Fall back to next available source
        return this.tryFallbackSources(userId, date, activeConnections, targetSource, options);
      }

      // Get hourly breakdown for workout overlap calculation
      const hourlySteps = await this.fetchHourlySteps(targetSource, date);

      // Get app workouts for the day (this would come from the database)
      const appWorkouts = await this.getAppWorkoutsForDate(userId, date);

      // Calculate workout overlap (steps during workout shouldn't double count)
      const workoutsWithOverlap = this.calculateStepOverlap(appWorkouts, hourlySteps);

      // Normalize steps based on device calibration
      const normalizedSteps = normalizeSteps(
        rawData.steps,
        targetSource,
        targetConnection.stepCalibrationFactor
      );

      // Calculate expenditures
      const calculated = this.calculateExpenditure(
        normalizedSteps,
        workoutsWithOverlap,
        userWeightKg
      );

      const activityData: DailyActivityData = {
        userId,
        date: formatDate(date),
        steps: {
          total: normalizedSteps,
          source: targetSource,
          hourlyBreakdown: hourlySteps,
          confidence: 'measured',
        },
        wearableActiveCalories: rawData.activeCalories
          ? {
              total: rawData.activeCalories,
              source: targetSource,
            }
          : undefined,
        appWorkouts: workoutsWithOverlap,
        calculated: {
          stepExpenditure: calculated.stepExpenditure,
          workoutExpenditure: calculated.workoutExpenditure,
          totalActivityExpenditure: calculated.totalExpenditure,
          activityLevel: getActivityLevelFromSteps(normalizedSteps),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return {
        success: true,
        data: activityData,
        source: targetSource,
      };
    } catch (error) {
      console.error(`Failed to sync from ${targetSource}:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Sync activity data for a date range
   */
  async syncDateRange(
    userId: string,
    startDate: Date,
    endDate: Date,
    options: SyncOptions
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const result = await this.syncDailyActivity(userId, new Date(currentDate), options);
      results.push(result);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return results;
  }

  /**
   * Get all active connections for a user (placeholder - would query database)
   */
  async getActiveConnections(userId: string): Promise<WearableConnection[]> {
    // This would be implemented to fetch from the database
    // For now, detect available services
    const connections: WearableConnection[] = [];

    if (await healthKitService.isAvailable()) {
      connections.push({
        id: 'healthkit-auto',
        userId,
        source: 'apple_healthkit',
        isConnected: true,
        lastSyncAt: null,
        permissions: ['steps', 'active_energy', 'workouts'],
        stepCalibrationFactor: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    if (await googleFitService.isAvailable()) {
      connections.push({
        id: 'googlefit-auto',
        userId,
        source: 'google_fit',
        isConnected: true,
        lastSyncAt: null,
        permissions: ['steps', 'active_energy', 'workouts'],
        stepCalibrationFactor: 0.95,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    if (fitbitService.isConnected()) {
      connections.push({
        id: 'fitbit-oauth',
        userId,
        source: 'fitbit',
        isConnected: true,
        lastSyncAt: null,
        permissions: ['steps', 'active_energy', 'workouts'],
        stepCalibrationFactor: 1.02,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return connections;
  }

  // === PRIVATE METHODS ===

  /**
   * Fetch data from a specific source
   */
  private async fetchFromSource(
    source: WearableSource,
    date: Date
  ): Promise<{ steps: number; activeCalories?: number } | null> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    switch (source) {
      case 'apple_healthkit': {
        const steps = await healthKitService.getSteps(startOfDay, endOfDay);
        const energy = await healthKitService.getActiveEnergy(startOfDay, endOfDay);
        return {
          steps: steps[0]?.steps || 0,
          activeCalories: energy[0]?.activeCalories,
        };
      }

      case 'google_fit': {
        const steps = await googleFitService.getSteps(startOfDay, endOfDay);
        const calories = await googleFitService.getCalories(startOfDay, endOfDay);
        return {
          steps: steps[0]?.steps || 0,
          activeCalories: calories[0]?.activeCalories,
        };
      }

      case 'fitbit': {
        const steps = await fitbitService.getSteps(startOfDay, endOfDay);
        const calories = await fitbitService.getCalories(startOfDay, endOfDay);
        return {
          steps: steps[0]?.steps || 0,
          activeCalories: calories[0]?.activeCalories,
        };
      }

      default:
        return null;
    }
  }

  /**
   * Fetch hourly step breakdown from a source
   */
  private async fetchHourlySteps(source: WearableSource, date: Date): Promise<number[]> {
    switch (source) {
      case 'apple_healthkit':
        return fetchHealthKitHourlySteps(date);
      case 'google_fit':
        return fetchGoogleFitHourlySteps(date);
      case 'fitbit':
        return fetchFitbitHourlySteps(date);
      default:
        return new Array(24).fill(0);
    }
  }

  /**
   * Try fallback sources if primary fails
   */
  private async tryFallbackSources(
    userId: string,
    date: Date,
    connections: WearableConnection[],
    excludeSource: WearableSource,
    options: SyncOptions
  ): Promise<SyncResult> {
    const fallbackConnections = connections.filter((c) => c.source !== excludeSource);

    if (fallbackConnections.length === 0) {
      return { success: false, error: 'No fallback sources available' };
    }

    // Try next source in priority
    return this.syncDailyActivity(userId, date, {
      ...options,
      connections: fallbackConnections,
      preferredSource: null,
    });
  }

  /**
   * Get app workouts for a date (placeholder - would query database)
   */
  private async getAppWorkoutsForDate(
    userId: string,
    date: Date
  ): Promise<AppWorkoutActivity[]> {
    // This would be implemented to fetch from the workout_sessions table
    // For now, return empty array
    return [];
  }

  /**
   * Calculate step overlap for workouts
   */
  private calculateStepOverlap(
    workouts: AppWorkoutActivity[],
    hourlySteps: number[]
  ): AppWorkoutActivity[] {
    return workouts.map((workout) => {
      // Find hours that overlap with workout
      const startHour = workout.startTime.getHours();
      const endHour = workout.endTime.getHours();

      let overlapSteps = 0;
      for (let h = startHour; h <= endHour && h < 24; h++) {
        overlapSteps += hourlySteps[h] || 0;
      }

      return {
        ...workout,
        stepsOverlap: overlapSteps,
      };
    });
  }

  /**
   * Calculate net activity expenditure
   */
  private calculateExpenditure(
    totalSteps: number,
    workouts: AppWorkoutActivity[],
    userWeightKg: number
  ): NetActivityExpenditure {
    const adjustments: string[] = [];

    // Calculate total step expenditure (before deductions)
    const caloriesPerStep = this.estimateCaloriesPerStep(userWeightKg);
    const grossStepCalories = totalSteps * caloriesPerStep;

    // Calculate workout expenditures
    let totalWorkoutCalories = 0;
    let stepsToDeduct = 0;

    for (const workout of workouts) {
      totalWorkoutCalories += workout.estimatedCalories;

      // Steps during this workout should be deducted from step calories
      stepsToDeduct += workout.stepsOverlap;

      if (workout.stepsOverlap > 0) {
        adjustments.push(
          `Deducted ${workout.stepsOverlap} steps during ${workout.durationMinutes}min workout`
        );
      }
    }

    // Net step calories (excluding workout overlap)
    const netSteps = totalSteps - stepsToDeduct;
    const netStepCalories = Math.max(0, netSteps * caloriesPerStep);

    return {
      stepExpenditure: Math.round(netStepCalories),
      workoutExpenditure: Math.round(totalWorkoutCalories),
      totalExpenditure: Math.round(netStepCalories + totalWorkoutCalories),
      adjustments,
    };
  }

  /**
   * Estimate calories per step based on weight
   */
  private estimateCaloriesPerStep(weightKg: number): number {
    // Research suggests 0.03-0.06 cal/step depending on weight and pace
    // We use a conservative middle estimate scaled by weight
    const baseCaloriesPerStep = 0.04;
    const weightMultiplier = weightKg / 70; // Normalized to 70kg
    return baseCaloriesPerStep * weightMultiplier;
  }
}

// === HELPER FUNCTIONS ===

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Export singleton instance
export const activitySyncService = new ActivitySyncService();

// Export utility functions
export async function syncDailyActivity(
  userId: string,
  date: Date,
  options: SyncOptions
): Promise<SyncResult> {
  return activitySyncService.syncDailyActivity(userId, date, options);
}

export async function syncActivityDateRange(
  userId: string,
  startDate: Date,
  endDate: Date,
  options: SyncOptions
): Promise<SyncResult[]> {
  return activitySyncService.syncDateRange(userId, startDate, endDate, options);
}

export async function getActiveWearableConnections(
  userId: string
): Promise<WearableConnection[]> {
  return activitySyncService.getActiveConnections(userId);
}

/**
 * Calculate net activity expenditure from daily activity data
 */
export function calculateNetExpenditure(
  activityData: DailyActivityData,
  userWeightKg: number
): NetActivityExpenditure {
  const adjustments: string[] = [];
  const caloriesPerStep = 0.04 * (userWeightKg / 70);

  // Get total overlap from workouts
  const totalOverlap = activityData.appWorkouts.reduce(
    (sum, w) => sum + w.stepsOverlap,
    0
  );
  const netSteps = activityData.steps.total - totalOverlap;
  const stepExpenditure = Math.round(Math.max(0, netSteps * caloriesPerStep));

  const workoutExpenditure = activityData.appWorkouts.reduce(
    (sum, w) => sum + w.estimatedCalories,
    0
  );

  if (totalOverlap > 0) {
    adjustments.push(`Deducted ${totalOverlap} steps during workouts`);
  }

  return {
    stepExpenditure,
    workoutExpenditure,
    totalExpenditure: stepExpenditure + workoutExpenditure,
    adjustments,
  };
}

/**
 * Merge activity data from multiple sources (for manual override handling)
 */
export function mergeActivityData(
  primary: DailyActivityData,
  manual?: Partial<DailyActivityData>
): DailyActivityData {
  if (!manual) return primary;

  return {
    ...primary,
    steps: manual.steps || primary.steps,
    calculated: {
      ...primary.calculated,
      ...manual.calculated,
    },
    updatedAt: new Date(),
  };
}
