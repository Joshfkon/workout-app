/**
 * Google Fit Integration
 *
 * Provides step data, calories, and activity data from Google Fit
 * for Android devices via Capacitor native bridge.
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

// === TYPES ===

interface GoogleFitPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestPermissions(options: {
    accessType: 'read' | 'write' | 'readwrite';
    dataTypes: string[];
  }): Promise<{ granted: boolean; grantedDataTypes?: string[] }>;
  getHistory(options: {
    dataType: string;
    startTime: number; // Unix timestamp in ms
    endTime: number;
    bucketByTime?: { durationMillis: number };
  }): Promise<HistoryResponse>;
  getWorkouts(options: {
    startTime: number;
    endTime: number;
  }): Promise<WorkoutResponse>;
  subscribeToDataType(options: {
    dataType: string;
  }): Promise<void>;
  addListener(
    eventName: 'googleFitUpdate',
    callback: (event: { dataType: string; data: unknown }) => void
  ): { remove: () => void };
}

interface HistoryResponse {
  buckets: DataBucket[];
}

interface DataBucket {
  startTimeMillis: number;
  endTimeMillis: number;
  dataSets: DataSet[];
}

interface DataSet {
  dataType: string;
  points: DataPoint[];
}

interface DataPoint {
  startTimeNanos: string;
  endTimeNanos: string;
  value: number | { intVal?: number; fpVal?: number }[];
  originDataSourceId?: string;
}

interface WorkoutResponse {
  sessions: FitSession[];
}

interface FitSession {
  id: string;
  name: string;
  startTimeMillis: number;
  endTimeMillis: number;
  activityType: number;
  activeTimeMillis?: number;
  calories?: number;
}

// Google Fit data types
const DATA_TYPES = {
  steps: 'com.google.step_count.delta',
  calories: 'com.google.calories.expended',
  activeCalories: 'com.google.active_minutes',
  distance: 'com.google.distance.delta',
  heartRate: 'com.google.heart_rate.bpm',
  activity: 'com.google.activity.segment',
} as const;

// Google Fit activity type codes
const ACTIVITY_TYPES: Record<number, string> = {
  0: 'unknown',
  7: 'walking',
  8: 'running',
  1: 'biking',
  82: 'strength_training',
  29: 'elliptical',
  25: 'rowing',
  10: 'yoga',
  83: 'pilates',
  4: 'aerobics',
  84: 'hiit',
  16: 'swimming',
};

// === SERVICE ===

/**
 * Google Fit service for Android devices
 */
class GoogleFitService {
  private plugin: GoogleFitPlugin | null = null;
  private updateListeners: Map<string, (data: HealthUpdate) => void> = new Map();

  /**
   * Check if Google Fit is available on this device
   */
  async isAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return false;
    }

    try {
      const plugin = await this.getPlugin();
      if (!plugin) return false;

      const result = await plugin.isAvailable();
      return result.available;
    } catch (error) {
      console.warn('Google Fit availability check failed:', error);
      return false;
    }
  }

  /**
   * Request Google Fit permissions
   */
  async requestPermissions(
    permissions: WearablePermission[] = ['steps', 'active_energy', 'workouts']
  ): Promise<PermissionResult> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return { granted: false, reason: 'not_android' };
    }

    try {
      const plugin = await this.getPlugin();
      if (!plugin) {
        return { granted: false, reason: 'plugin_not_available' };
      }

      const dataTypes = this.mapPermissionsToDataTypes(permissions);

      const result = await plugin.requestPermissions({
        accessType: 'read',
        dataTypes,
      });

      return {
        granted: result.granted,
        permissions: result.grantedDataTypes?.map((dt) =>
          this.mapDataTypeToPermission(dt)
        ) as WearablePermission[],
      };
    } catch (error) {
      console.error('Google Fit permission request failed:', error);
      return { granted: false, reason: String(error) };
    }
  }

  /**
   * Get step data for a date range
   */
  async getSteps(startDate: Date, endDate: Date): Promise<StepData[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const response = await plugin.getHistory({
        dataType: DATA_TYPES.steps,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        bucketByTime: { durationMillis: 86400000 }, // Daily buckets
      });

      return response.buckets.map((bucket) => {
        const steps = this.sumBucketValues(bucket);
        return {
          date: new Date(bucket.startTimeMillis).toISOString().split('T')[0],
          steps,
          source: 'google_fit' as const,
          confidence: 'measured' as const,
        };
      });
    } catch (error) {
      console.error('Failed to fetch Google Fit steps:', error);
      return [];
    }
  }

  /**
   * Get hourly step breakdown for a specific date
   */
  async getHourlySteps(date: Date): Promise<number[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return new Array(24).fill(0);

    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const response = await plugin.getHistory({
        dataType: DATA_TYPES.steps,
        startTime: startOfDay.getTime(),
        endTime: endOfDay.getTime(),
        bucketByTime: { durationMillis: 3600000 }, // Hourly buckets
      });

      const hourlyData: number[] = new Array(24).fill(0);

      for (const bucket of response.buckets) {
        const hour = new Date(bucket.startTimeMillis).getHours();
        hourlyData[hour] = this.sumBucketValues(bucket);
      }

      return hourlyData;
    } catch (error) {
      console.error('Failed to fetch hourly steps:', error);
      return new Array(24).fill(0);
    }
  }

  /**
   * Get calories for a date range
   */
  async getCalories(startDate: Date, endDate: Date): Promise<EnergyData[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const response = await plugin.getHistory({
        dataType: DATA_TYPES.calories,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        bucketByTime: { durationMillis: 86400000 }, // Daily buckets
      });

      return response.buckets.map((bucket) => {
        const calories = this.sumBucketValues(bucket);
        return {
          date: new Date(bucket.startTimeMillis).toISOString().split('T')[0],
          activeCalories: Math.round(calories),
          source: 'google_fit' as const,
        };
      });
    } catch (error) {
      console.error('Failed to fetch Google Fit calories:', error);
      return [];
    }
  }

  /**
   * Get workouts for a date range
   */
  async getWorkouts(startDate: Date, endDate: Date): Promise<WearableWorkoutData[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const response = await plugin.getWorkouts({
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
      });

      return response.sessions.map((session) => ({
        id: session.id,
        startTime: new Date(session.startTimeMillis),
        endTime: new Date(session.endTimeMillis),
        workoutType: ACTIVITY_TYPES[session.activityType] || 'other',
        calories: Math.round(session.calories || 0),
        source: 'google_fit' as const,
      }));
    } catch (error) {
      console.error('Failed to fetch Google Fit workouts:', error);
      return [];
    }
  }

  /**
   * Subscribe to Google Fit updates
   */
  async subscribeToUpdates(callback: (data: HealthUpdate) => void): Promise<() => void> {
    const plugin = await this.getPlugin();
    if (!plugin) return () => {};

    try {
      const listenerId = crypto.randomUUID();
      this.updateListeners.set(listenerId, callback);

      // Subscribe to step updates
      await plugin.subscribeToDataType({ dataType: DATA_TYPES.steps });

      const listener = plugin.addListener('googleFitUpdate', (event) => {
        const update = this.parseGoogleFitUpdate(event);
        if (update) {
          this.updateListeners.forEach((cb) => cb(update));
        }
      });

      return () => {
        this.updateListeners.delete(listenerId);
        listener.remove();
      };
    } catch (error) {
      console.error('Failed to subscribe to Google Fit updates:', error);
      return () => {};
    }
  }

  // === PRIVATE METHODS ===

  private async getPlugin(): Promise<GoogleFitPlugin | null> {
    if (this.plugin) return this.plugin;

    try {
      // Dynamic import of the Capacitor Google Fit plugin
      const googleFitModule = await import('@nickcis/capacitor-google-fit');
      this.plugin = googleFitModule.GoogleFit as unknown as GoogleFitPlugin;
      return this.plugin;
    } catch (error) {
      console.warn('Google Fit plugin not available:', error);
      return null;
    }
  }

  private mapPermissionsToDataTypes(permissions: WearablePermission[]): string[] {
    const typeMap: Record<WearablePermission, string[]> = {
      steps: [DATA_TYPES.steps],
      active_energy: [DATA_TYPES.calories, DATA_TYPES.activeCalories],
      workouts: [DATA_TYPES.activity],
      heart_rate: [DATA_TYPES.heartRate],
      sleep: [], // Not implemented yet
    };

    return permissions.flatMap((p) => typeMap[p] || []);
  }

  private mapDataTypeToPermission(dataType: string): WearablePermission {
    if (dataType.includes('step')) return 'steps';
    if (dataType.includes('calorie') || dataType.includes('active_minutes'))
      return 'active_energy';
    if (dataType.includes('activity') || dataType.includes('segment')) return 'workouts';
    if (dataType.includes('heart_rate')) return 'heart_rate';
    return 'steps';
  }

  private sumBucketValues(bucket: DataBucket): number {
    let total = 0;

    for (const dataSet of bucket.dataSets) {
      for (const point of dataSet.points) {
        if (typeof point.value === 'number') {
          total += point.value;
        } else if (Array.isArray(point.value)) {
          for (const v of point.value) {
            total += v.intVal || v.fpVal || 0;
          }
        }
      }
    }

    return Math.round(total);
  }

  private parseGoogleFitUpdate(event: {
    dataType: string;
    data: unknown;
  }): HealthUpdate | null {
    try {
      const today = new Date().toISOString().split('T')[0];

      if (event.dataType === DATA_TYPES.steps) {
        const steps =
          typeof event.data === 'number'
            ? event.data
            : (event.data as { steps?: number })?.steps || 0;

        return {
          type: 'steps',
          date: today,
          data: {
            date: today,
            steps: Math.round(steps),
            source: 'google_fit' as const,
            confidence: 'measured' as const,
          },
        };
      }

      if (event.dataType === DATA_TYPES.calories) {
        const calories =
          typeof event.data === 'number'
            ? event.data
            : (event.data as { calories?: number })?.calories || 0;

        return {
          type: 'calories',
          date: today,
          data: {
            date: today,
            activeCalories: Math.round(calories),
            source: 'google_fit' as const,
          },
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const googleFitService = new GoogleFitService();

// Export utility functions
export async function isGoogleFitAvailable(): Promise<boolean> {
  return googleFitService.isAvailable();
}

export async function requestGoogleFitPermissions(
  permissions?: WearablePermission[]
): Promise<PermissionResult> {
  return googleFitService.requestPermissions(permissions);
}

export async function fetchGoogleFitSteps(
  startDate: Date,
  endDate: Date
): Promise<StepData[]> {
  return googleFitService.getSteps(startDate, endDate);
}

export async function fetchGoogleFitHourlySteps(date: Date): Promise<number[]> {
  return googleFitService.getHourlySteps(date);
}

export async function fetchGoogleFitCalories(
  startDate: Date,
  endDate: Date
): Promise<EnergyData[]> {
  return googleFitService.getCalories(startDate, endDate);
}

export async function fetchGoogleFitWorkouts(
  startDate: Date,
  endDate: Date
): Promise<WearableWorkoutData[]> {
  return googleFitService.getWorkouts(startDate, endDate);
}

export async function subscribeToGoogleFitUpdates(
  callback: (data: HealthUpdate) => void
): Promise<() => void> {
  return googleFitService.subscribeToUpdates(callback);
}
