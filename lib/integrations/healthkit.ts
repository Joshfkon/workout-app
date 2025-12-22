/**
 * Apple HealthKit Integration
 *
 * Provides step data, active energy, and workout data from Apple HealthKit
 * for iOS devices via Capacitor native bridge.
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

interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(options: {
    read: string[];
    write: string[];
  }): Promise<{ granted: boolean; grantedPermissions?: string[] }>;
  queryQuantitySamples(options: {
    sampleType: string;
    startDate: string;
    endDate: string;
    aggregation?: 'day' | 'hour' | 'none';
  }): Promise<QuantitySample[]>;
  queryWorkouts(options: {
    startDate: string;
    endDate: string;
  }): Promise<WorkoutSample[]>;
  subscribeToUpdates(options: {
    sampleTypes: string[];
  }): Promise<void>;
  addListener(
    eventName: 'healthKitUpdate',
    callback: (event: { type: string; data: unknown }) => void
  ): { remove: () => void };
}

interface QuantitySample {
  startDate: string;
  endDate: string;
  value: number;
  unit: string;
  sourceName?: string;
  sourceId?: string;
}

interface WorkoutSample {
  id: string;
  startDate: string;
  endDate: string;
  workoutActivityType: string;
  totalEnergyBurned?: number;
  totalDistance?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  sourceName?: string;
}

// HealthKit sample types
const SAMPLE_TYPES = {
  stepCount: 'HKQuantityTypeIdentifierStepCount',
  activeEnergyBurned: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  basalEnergyBurned: 'HKQuantityTypeIdentifierBasalEnergyBurned',
  workoutType: 'HKWorkoutType',
  heartRate: 'HKQuantityTypeIdentifierHeartRate',
} as const;

// === SERVICE ===

/**
 * HealthKit service for iOS devices
 */
class HealthKitService {
  private plugin: HealthKitPlugin | null = null;
  private updateListeners: Map<string, (data: HealthUpdate) => void> = new Map();

  /**
   * Check if HealthKit is available on this device
   */
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
   * Request HealthKit permissions
   */
  async requestPermissions(
    permissions: WearablePermission[] = ['steps', 'active_energy', 'workouts']
  ): Promise<PermissionResult> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return { granted: false, reason: 'not_ios' };
    }

    try {
      const plugin = await this.getPlugin();
      if (!plugin) {
        return { granted: false, reason: 'plugin_not_available' };
      }

      const readTypes = this.mapPermissionsToSampleTypes(permissions);

      const result = await plugin.requestAuthorization({
        read: readTypes,
        write: [], // We don't write to HealthKit
      });

      return {
        granted: result.granted,
        permissions: result.grantedPermissions?.map((p) =>
          this.mapSampleTypeToPermission(p)
        ) as WearablePermission[],
      };
    } catch (error) {
      console.error('HealthKit permission request failed:', error);
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
      const samples = await plugin.queryQuantitySamples({
        sampleType: SAMPLE_TYPES.stepCount,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        aggregation: 'day',
      });

      return samples.map((sample) => ({
        date: sample.startDate.split('T')[0],
        steps: Math.round(sample.value),
        source: 'apple_healthkit' as const,
        deviceName: sample.sourceName,
        confidence: 'measured' as const,
      }));
    } catch (error) {
      console.error('Failed to fetch HealthKit steps:', error);
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

      const samples = await plugin.queryQuantitySamples({
        sampleType: SAMPLE_TYPES.stepCount,
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
        aggregation: 'hour',
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

  /**
   * Get active energy (calories) for a date range
   */
  async getActiveEnergy(startDate: Date, endDate: Date): Promise<EnergyData[]> {
    const plugin = await this.getPlugin();
    if (!plugin) return [];

    try {
      const samples = await plugin.queryQuantitySamples({
        sampleType: SAMPLE_TYPES.activeEnergyBurned,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        aggregation: 'day',
      });

      return samples.map((sample) => ({
        date: sample.startDate.split('T')[0],
        activeCalories: Math.round(sample.value),
        source: 'apple_healthkit' as const,
      }));
    } catch (error) {
      console.error('Failed to fetch HealthKit active energy:', error);
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
      const workouts = await plugin.queryWorkouts({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      return workouts.map((workout) => ({
        id: workout.id,
        startTime: new Date(workout.startDate),
        endTime: new Date(workout.endDate),
        workoutType: this.mapWorkoutType(workout.workoutActivityType),
        calories: Math.round(workout.totalEnergyBurned || 0),
        heartRateAvg: workout.averageHeartRate
          ? Math.round(workout.averageHeartRate)
          : undefined,
        heartRateMax: workout.maxHeartRate ? Math.round(workout.maxHeartRate) : undefined,
        source: 'apple_healthkit' as const,
      }));
    } catch (error) {
      console.error('Failed to fetch HealthKit workouts:', error);
      return [];
    }
  }

  /**
   * Subscribe to HealthKit updates
   */
  async subscribeToUpdates(callback: (data: HealthUpdate) => void): Promise<() => void> {
    const plugin = await this.getPlugin();
    if (!plugin) return () => {};

    try {
      const listenerId = crypto.randomUUID();
      this.updateListeners.set(listenerId, callback);

      await plugin.subscribeToUpdates({
        sampleTypes: [SAMPLE_TYPES.stepCount, SAMPLE_TYPES.activeEnergyBurned],
      });

      const listener = plugin.addListener('healthKitUpdate', (event) => {
        const update = this.parseHealthKitUpdate(event);
        if (update) {
          this.updateListeners.forEach((cb) => cb(update));
        }
      });

      return () => {
        this.updateListeners.delete(listenerId);
        listener.remove();
      };
    } catch (error) {
      console.error('Failed to subscribe to HealthKit updates:', error);
      return () => {};
    }
  }

  // === PRIVATE METHODS ===

  private async getPlugin(): Promise<HealthKitPlugin | null> {
    if (this.plugin) return this.plugin;

    // Only attempt to load plugin on native iOS
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return null;
    }

    try {
      // Use Function constructor to hide import from webpack's static analysis
      // This prevents build errors when the native module isn't installed
      const modulePath = '@nickcis/capacitor-healthkit';
      const importFn = new Function('modulePath', 'return import(modulePath)');
      const healthKitModule = await importFn(modulePath);
      this.plugin = healthKitModule.HealthKit as unknown as HealthKitPlugin;
      return this.plugin;
    } catch (error) {
      console.warn('HealthKit plugin not available:', error);
      return null;
    }
  }

  private mapPermissionsToSampleTypes(permissions: WearablePermission[]): string[] {
    const typeMap: Record<WearablePermission, string[]> = {
      steps: [SAMPLE_TYPES.stepCount],
      active_energy: [SAMPLE_TYPES.activeEnergyBurned, SAMPLE_TYPES.basalEnergyBurned],
      workouts: [SAMPLE_TYPES.workoutType],
      heart_rate: [SAMPLE_TYPES.heartRate],
      sleep: [], // Not implemented yet
    };

    return permissions.flatMap((p) => typeMap[p] || []);
  }

  private mapSampleTypeToPermission(sampleType: string): WearablePermission {
    if (sampleType.includes('StepCount')) return 'steps';
    if (sampleType.includes('EnergyBurned')) return 'active_energy';
    if (sampleType.includes('Workout')) return 'workouts';
    if (sampleType.includes('HeartRate')) return 'heart_rate';
    return 'steps';
  }

  private mapWorkoutType(activityType: string): string {
    // Map HealthKit workout activity types to readable names
    const typeMap: Record<string, string> = {
      HKWorkoutActivityTypeTraditionalStrengthTraining: 'strength_training',
      HKWorkoutActivityTypeFunctionalStrengthTraining: 'functional_training',
      HKWorkoutActivityTypeRunning: 'running',
      HKWorkoutActivityTypeWalking: 'walking',
      HKWorkoutActivityTypeCycling: 'cycling',
      HKWorkoutActivityTypeSwimming: 'swimming',
      HKWorkoutActivityTypeYoga: 'yoga',
      HKWorkoutActivityTypePilates: 'pilates',
      HKWorkoutActivityTypeHighIntensityIntervalTraining: 'hiit',
      HKWorkoutActivityTypeCrossTraining: 'cross_training',
    };

    return typeMap[activityType] || 'other';
  }

  private parseHealthKitUpdate(event: {
    type: string;
    data: unknown;
  }): HealthUpdate | null {
    try {
      if (event.type === 'stepCount') {
        const sample = event.data as QuantitySample;
        return {
          type: 'steps',
          date: sample.startDate.split('T')[0],
          data: {
            date: sample.startDate.split('T')[0],
            steps: Math.round(sample.value),
            source: 'apple_healthkit' as const,
            confidence: 'measured' as const,
          },
        };
      }

      if (event.type === 'activeEnergyBurned') {
        const sample = event.data as QuantitySample;
        return {
          type: 'calories',
          date: sample.startDate.split('T')[0],
          data: {
            date: sample.startDate.split('T')[0],
            activeCalories: Math.round(sample.value),
            source: 'apple_healthkit' as const,
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
