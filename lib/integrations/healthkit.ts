/**
 * Apple HealthKit Integration (read-only)
 *
 * Wraps `@capgo/capacitor-health` for iOS devices via the Capacitor native
 * bridge. Provides daily steps, active energy, workouts, sleep samples, and
 * daily HRV (SDNN) / resting heart rate.
 *
 * Web-bundle safety: the plugin is loaded through a Function-constructed
 * dynamic import so webpack never sees (or bundles) the dependency — web/PWA
 * builds contain zero HealthKit code and every entry point returns empty data
 * off-iOS. Nothing is ever written to HealthKit (write permissions are never
 * requested).
 */

import { Capacitor } from './capacitor-stub';
import type {
  StepData,
  EnergyData,
  WearableWorkoutData,
  PermissionResult,
  WearablePermission,
  HealthUpdate,
} from '@/types/wearable';
import type { SleepSampleInput } from '@/services/healthkitSleep';
import { getLocalDateString } from '@/lib/utils';

// === PLUGIN TYPES (structural subset of @capgo/capacitor-health) ===

type HealthDataType =
  | 'steps'
  | 'calories'
  | 'sleep'
  | 'heartRateVariability'
  | 'restingHeartRate'
  | 'workouts';

interface HealthSample {
  dataType: string;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sourceId?: string;
  platformId?: string;
  sleepState?: string;
  stages?: { startDate: string; endDate: string; stage: string }[];
  hasStageData?: boolean;
}

interface AggregatedSample {
  startDate: string;
  endDate: string;
  value: number;
  unit: string;
}

interface WorkoutSample {
  workoutType: string;
  duration: number;
  totalEnergyBurned?: number;
  totalDistance?: number;
  startDate: string;
  endDate: string;
  sourceName?: string;
  platformId?: string;
}

interface HealthPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(options: {
    read?: HealthDataType[];
    write?: HealthDataType[];
  }): Promise<{ readAuthorized: string[]; readDenied: string[] }>;
  checkAuthorization(options: {
    read?: HealthDataType[];
    write?: HealthDataType[];
  }): Promise<{ readAuthorized: string[]; readDenied: string[] }>;
  readSamples(options: {
    dataType: HealthDataType;
    startDate?: string;
    endDate?: string;
    limit?: number;
    ascending?: boolean;
  }): Promise<{ samples: HealthSample[] }>;
  queryAggregated(options: {
    dataType: HealthDataType;
    startDate?: string;
    endDate?: string;
    bucket?: 'hour' | 'day' | 'week' | 'month';
    aggregation?: 'sum' | 'average' | 'min' | 'max';
  }): Promise<{ samples: AggregatedSample[] }>;
  queryWorkouts(options: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    ascending?: boolean;
  }): Promise<{ workouts: WorkoutSample[] }>;
}

/** Kept in one place so the bundle-safety test can assert on it. */
export const HEALTHKIT_PLUGIN_PACKAGE = '@capgo/capacitor-health';

/**
 * The read types this app ever requests — sleep, HRV, resting HR, steps,
 * active energy. Read-only by design: the write array is always empty.
 */
export const HEALTHKIT_READ_TYPES: HealthDataType[] = [
  'sleep',
  'heartRateVariability',
  'restingHeartRate',
  'steps',
  'calories',
];

/** One local day of a per-day metric (value semantics depend on the metric). */
export interface DailyMetricSample {
  /** Local day, YYYY-MM-DD. */
  date: string;
  value: number;
}

const SAMPLE_READ_LIMIT = 2000;

// === SERVICE ===

/**
 * HealthKit service for iOS devices. Every entry point is capability-gated;
 * off native iOS everything resolves empty/false so callers need no platform
 * branching.
 */
class HealthKitService {
  private plugin: HealthPlugin | null = null;

  /** Check if HealthKit is available on this device. */
  async isAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return false;
    }

    try {
      const plugin = await this.getPlugin();
      if (!plugin) return false;

      const result = await plugin.isAvailable();
      return result.available;
    } catch (error) {
      console.warn('HealthKit availability check failed:', error);
      return false;
    }
  }

  /**
   * Request read-only HealthKit permissions for our read types.
   *
   * HealthKit deliberately does not reveal per-type READ denial (denied types
   * simply return no data), so `granted` here only means the permission sheet
   * flow completed. Callers must treat empty query results as absence — never
   * as an error, and never re-prompt in a loop.
   */
  async requestPermissions(
    permissions: WearablePermission[] = ['steps', 'active_energy', 'sleep', 'heart_rate']
  ): Promise<PermissionResult> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return { granted: false, reason: 'not_ios' };
    }

    try {
      const plugin = await this.getPlugin();
      if (!plugin) {
        return { granted: false, reason: 'plugin_not_available' };
      }

      const readTypes = this.mapPermissionsToDataTypes(permissions);
      await plugin.requestAuthorization({
        read: readTypes,
        write: [], // We never write to HealthKit
      });

      return { granted: true, permissions };
    } catch (error) {
      console.error('HealthKit permission request failed:', error);
      return { granted: false, reason: String(error) };
    }
  }

  /** Daily step totals per local day (HealthKit day buckets are device-local). */
  async getSteps(startDate: Date, endDate: Date): Promise<StepData[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const { samples } = await plugin.queryAggregated({
        dataType: 'steps',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        bucket: 'day',
        aggregation: 'sum',
      });

      return samples
        .filter((sample) => sample.value > 0)
        .map((sample) => ({
          date: getLocalDateString(new Date(sample.startDate)),
          steps: Math.round(sample.value),
          source: 'apple_healthkit' as const,
          confidence: 'measured' as const,
        }));
    } catch (error) {
      console.error('Failed to fetch HealthKit steps:', error);
      return [];
    }
  }

  /** Get hourly step breakdown for a specific date. */
  async getHourlySteps(date: Date): Promise<number[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return new Array(24).fill(0);

    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const { samples } = await plugin.queryAggregated({
        dataType: 'steps',
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
        bucket: 'hour',
        aggregation: 'sum',
      });

      const hourlyData: number[] = new Array(24).fill(0);
      for (const sample of samples) {
        const hour = new Date(sample.startDate).getHours();
        hourlyData[hour] = Math.round(sample.value);
      }

      return hourlyData;
    } catch (error) {
      console.error('Failed to fetch hourly steps:', error);
      return new Array(24).fill(0);
    }
  }

  /** Daily active energy (kcal) per local day. */
  async getActiveEnergy(startDate: Date, endDate: Date): Promise<EnergyData[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const { samples } = await plugin.queryAggregated({
        dataType: 'calories',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        bucket: 'day',
        aggregation: 'sum',
      });

      return samples
        .filter((sample) => sample.value > 0)
        .map((sample) => ({
          date: getLocalDateString(new Date(sample.startDate)),
          activeCalories: Math.round(sample.value),
          source: 'apple_healthkit' as const,
        }));
    } catch (error) {
      console.error('Failed to fetch HealthKit active energy:', error);
      return [];
    }
  }

  /**
   * Raw sleep samples for a window, flattened to one entry per stage segment
   * when the platform emitted stage data. Feed these to
   * services/healthkitSleep.ts#aggregateSleepSamples for per-night hours with
   * source dedupe.
   */
  async getSleepSamples(startDate: Date, endDate: Date): Promise<SleepSampleInput[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const { samples } = await plugin.readSamples({
        dataType: 'sleep',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: SAMPLE_READ_LIMIT,
        ascending: true,
      });

      const flattened: SleepSampleInput[] = [];
      for (const sample of samples) {
        if (sample.stages && sample.stages.length > 0) {
          for (const stage of sample.stages) {
            flattened.push({
              startDate: stage.startDate,
              endDate: stage.endDate,
              sleepState: stage.stage,
              sourceName: sample.sourceName,
              sourceId: sample.sourceId,
            });
          }
        } else {
          flattened.push({
            startDate: sample.startDate,
            endDate: sample.endDate,
            sleepState: sample.sleepState ?? 'asleep',
            sourceName: sample.sourceName,
            sourceId: sample.sourceId,
          });
        }
      }
      return flattened;
    } catch (error) {
      console.error('Failed to fetch HealthKit sleep:', error);
      return [];
    }
  }

  /** Daily average HRV (SDNN, ms) per local day. Empty when never recorded. */
  async getDailyHrv(startDate: Date, endDate: Date): Promise<DailyMetricSample[]> {
    return this.getDailyAverage('heartRateVariability', startDate, endDate);
  }

  /** Daily average resting heart rate (bpm) per local day. */
  async getDailyRestingHeartRate(
    startDate: Date,
    endDate: Date
  ): Promise<DailyMetricSample[]> {
    return this.getDailyAverage('restingHeartRate', startDate, endDate);
  }

  /** Get workouts for a date range. */
  async getWorkouts(startDate: Date, endDate: Date): Promise<WearableWorkoutData[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const { workouts } = await plugin.queryWorkouts({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: SAMPLE_READ_LIMIT,
        ascending: true,
      });

      return workouts.map((workout) => ({
        id: workout.platformId ?? `${workout.workoutType}-${workout.startDate}`,
        startTime: new Date(workout.startDate),
        endTime: new Date(workout.endDate),
        workoutType: this.mapWorkoutType(workout.workoutType),
        calories: Math.round(workout.totalEnergyBurned || 0),
        source: 'apple_healthkit' as const,
      }));
    } catch (error) {
      console.error('Failed to fetch HealthKit workouts:', error);
      return [];
    }
  }

  /**
   * `@capgo/capacitor-health` exposes no HealthKit observer/background
   * delivery API, so live update subscriptions are a no-op — data flows via
   * the anchored foreground sync instead (lib/integrations/healthkit-sync.ts).
   */
  async subscribeToUpdates(_callback: (data: HealthUpdate) => void): Promise<() => void> {
    return () => {};
  }

  // === PRIVATE METHODS ===

  private async getDailyAverage(
    dataType: HealthDataType,
    startDate: Date,
    endDate: Date
  ): Promise<DailyMetricSample[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const { samples } = await plugin.queryAggregated({
        dataType,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        bucket: 'day',
        aggregation: 'average',
      });

      return samples
        .filter((sample) => Number.isFinite(sample.value) && sample.value > 0)
        .map((sample) => ({
          date: getLocalDateString(new Date(sample.startDate)),
          value: sample.value,
        }));
    } catch (error) {
      // Per-type absence (e.g. no HRV source) is normal — return empty.
      console.warn(`HealthKit ${dataType} query returned nothing usable:`, error);
      return [];
    }
  }

  private async getPlugin(): Promise<HealthPlugin | null> {
    if (this.plugin) return this.plugin;

    // Only attempt to load plugin on native iOS
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return null;
    }

    try {
      // Use Function constructor to hide the import from webpack's static
      // analysis so the native plugin never enters the web bundle.
      const importFn = new Function('modulePath', 'return import(modulePath)');
      const healthModule = await importFn(HEALTHKIT_PLUGIN_PACKAGE);
      this.plugin = healthModule.Health as HealthPlugin;
      return this.plugin;
    } catch (error) {
      console.warn('HealthKit plugin not available:', error);
      return null;
    }
  }

  private mapPermissionsToDataTypes(permissions: WearablePermission[]): HealthDataType[] {
    const typeMap: Record<WearablePermission, HealthDataType[]> = {
      steps: ['steps'],
      active_energy: ['calories'],
      workouts: ['workouts'],
      heart_rate: ['heartRateVariability', 'restingHeartRate'],
      sleep: ['sleep'],
    };

    const types = permissions.flatMap((p) => typeMap[p] || []);
    return Array.from(new Set(types));
  }

  private mapWorkoutType(workoutType: string): string {
    const typeMap: Record<string, string> = {
      traditionalStrengthTraining: 'strength_training',
      strengthTraining: 'strength_training',
      weightlifting: 'strength_training',
      functionalStrengthTraining: 'functional_training',
      running: 'running',
      runningTreadmill: 'running',
      walking: 'walking',
      cycling: 'cycling',
      bikingStationary: 'cycling',
      swimming: 'swimming',
      swimmingPool: 'swimming',
      swimmingOpenWater: 'swimming',
      yoga: 'yoga',
      pilates: 'pilates',
      highIntensityIntervalTraining: 'hiit',
      crossTraining: 'cross_training',
    };

    return typeMap[workoutType] || 'other';
  }
}

// Export singleton instance
export const healthKitService = new HealthKitService();

// Export utility functions
export async function isHealthKitAvailable(): Promise<boolean> {
  return healthKitService.isAvailable();
}

export async function requestHealthKitPermissions(
  permissions?: WearablePermission[]
): Promise<PermissionResult> {
  return healthKitService.requestPermissions(permissions);
}

export async function fetchHealthKitSteps(
  startDate: Date,
  endDate: Date
): Promise<StepData[]> {
  return healthKitService.getSteps(startDate, endDate);
}

export async function fetchHealthKitHourlySteps(date: Date): Promise<number[]> {
  return healthKitService.getHourlySteps(date);
}

export async function fetchHealthKitActiveEnergy(
  startDate: Date,
  endDate: Date
): Promise<EnergyData[]> {
  return healthKitService.getActiveEnergy(startDate, endDate);
}

export async function fetchHealthKitSleepSamples(
  startDate: Date,
  endDate: Date
): Promise<SleepSampleInput[]> {
  return healthKitService.getSleepSamples(startDate, endDate);
}

export async function fetchHealthKitDailyHrv(
  startDate: Date,
  endDate: Date
): Promise<DailyMetricSample[]> {
  return healthKitService.getDailyHrv(startDate, endDate);
}

export async function fetchHealthKitDailyRestingHeartRate(
  startDate: Date,
  endDate: Date
): Promise<DailyMetricSample[]> {
  return healthKitService.getDailyRestingHeartRate(startDate, endDate);
}

export async function fetchHealthKitWorkouts(
  startDate: Date,
  endDate: Date
): Promise<WearableWorkoutData[]> {
  return healthKitService.getWorkouts(startDate, endDate);
}

export async function subscribeToHealthKitUpdates(
  callback: (data: HealthUpdate) => void
): Promise<() => void> {
  return healthKitService.subscribeToUpdates(callback);
}
