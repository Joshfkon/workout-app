/**
 * Fitbit Integration
 *
 * Provides step data, calories, and activity data from Fitbit
 * via OAuth 2.0 authentication. Works on both web and native platforms.
 */

import type {
  StepData,
  EnergyData,
  WearableWorkoutData,
  PermissionResult,
  WearablePermission,
} from '@/types/wearable';
import { openExternalUrl } from './capacitor-stub';
import { getLocalDateString } from '@/lib/utils';

// === TYPES ===

interface FitbitTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userId: string;
  scope: string[];
}

interface FitbitStepsResponse {
  'activities-steps': Array<{
    dateTime: string;
    value: string;
  }>;
}

interface FitbitCaloriesResponse {
  'activities-calories': Array<{
    dateTime: string;
    value: string;
  }>;
}

interface FitbitIntradayStepsResponse {
  'activities-steps-intraday': {
    dataset: Array<{
      time: string;
      value: number;
    }>;
    datasetInterval: number;
    datasetType: string;
  };
}

interface FitbitActivityLogResponse {
  activities: Array<{
    logId: number;
    activityName: string;
    activityTypeId: number;
    startTime: string;
    startDate: string;
    duration: number; // in ms
    calories: number;
    averageHeartRate?: number;
    steps?: number;
  }>;
}

interface FitbitUserProfile {
  user: {
    encodedId: string;
    displayName: string;
    avatar: string;
    timezone: string;
  };
}

// === CONSTANTS ===

const FITBIT_AUTH_URL = 'https://www.fitbit.com/oauth2/authorize';
const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const FITBIT_API_URL = 'https://api.fitbit.com/1/user';

// OAuth scopes needed
const REQUIRED_SCOPES = ['activity', 'profile'];

// === SERVICE ===

/**
 * Fitbit service using OAuth 2.0
 */
class FitbitService {
  private tokens: FitbitTokens | null = null;

  /**
   * Check if Fitbit is connected (has valid tokens)
   */
  isConnected(): boolean {
    return this.tokens !== null && new Date() < this.tokens.expiresAt;
  }

  /**
   * Initiate OAuth flow - redirects to Fitbit authorization page
   * Uses openExternalUrl for Capacitor compatibility
   */
  async initiateOAuth(): Promise<void> {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    if (!clientId) {
      console.error('Fitbit client ID not configured');
      return;
    }

    const redirectUri = `${window.location.origin}/integrations/fitbit/callback`;
    const scope = REQUIRED_SCOPES.join(' ');
    const state = this.generateState();

    // Store state for CSRF protection
    sessionStorage.setItem('fitbit_oauth_state', state);

    const authUrl = new URL(FITBIT_AUTH_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('state', state);

    await openExternalUrl(authUrl.toString());
  }

  /**
   * Handle OAuth callback - exchange code for tokens
   * This should be called from a server action as it requires client secret
   */
  async handleOAuthCallback(
    code: string,
    state: string
  ): Promise<{ success: boolean; error?: string }> {
    // Verify state to prevent CSRF
    const storedState = sessionStorage.getItem('fitbit_oauth_state');
    if (state !== storedState) {
      return { success: false, error: 'Invalid OAuth state' };
    }
    sessionStorage.removeItem('fitbit_oauth_state');

    try {
      // Token exchange must happen server-side
      const response = await fetch('/api/integrations/fitbit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const tokens = await response.json();
      this.setTokens(tokens);
      return { success: true };
    } catch (error) {
      console.error('Fitbit token exchange failed:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Set tokens (after loading from database or OAuth callback)
   */
  setTokens(tokens: FitbitTokens): void {
    this.tokens = {
      ...tokens,
      expiresAt: new Date(tokens.expiresAt),
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<boolean> {
    if (!this.tokens?.refreshToken) {
      return false;
    }

    try {
      const response = await fetch('/api/integrations/fitbit/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.tokens.refreshToken }),
      });

      if (!response.ok) {
        return false;
      }

      const newTokens = await response.json();
      this.setTokens(newTokens);
      return true;
    } catch (error) {
      console.error('Fitbit token refresh failed:', error);
      return false;
    }
  }

  /**
   * Revoke access and disconnect
   */
  async revokeAccess(): Promise<boolean> {
    if (!this.tokens?.accessToken) {
      return true;
    }

    try {
      const response = await fetch('/api/integrations/fitbit/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: this.tokens.accessToken }),
      });

      this.tokens = null;
      return response.ok;
    } catch (error) {
      console.error('Fitbit revoke failed:', error);
      this.tokens = null;
      return false;
    }
  }

  /**
   * Get user profile
   */
  async getUserProfile(): Promise<FitbitUserProfile | null> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) return null;

    try {
      const response = await fetch(`${FITBIT_API_URL}/-/profile.json`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      console.error('Failed to fetch Fitbit profile:', error);
      return null;
    }
  }

  /**
   * Get step data for a date range
   */
  async getSteps(startDate: Date, endDate: Date): Promise<StepData[]> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) return [];

    try {
      const startStr = formatDate(startDate);
      const endStr = formatDate(endDate);

      const response = await fetch(
        `${FITBIT_API_URL}/-/activities/steps/date/${startStr}/${endStr}.json`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) return [];

      const data: FitbitStepsResponse = await response.json();

      return data['activities-steps'].map((day) => ({
        date: day.dateTime,
        steps: parseInt(day.value, 10),
        source: 'fitbit' as const,
        confidence: 'measured' as const,
      }));
    } catch (error) {
      console.error('Failed to fetch Fitbit steps:', error);
      return [];
    }
  }

  /**
   * Get hourly step breakdown for a specific date
   * Note: Requires Fitbit Premium or Personal scope
   */
  async getHourlySteps(date: Date): Promise<number[]> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) return new Array(24).fill(0);

    try {
      const dateStr = formatDate(date);

      // Fitbit intraday requires special scope - may not be available for all apps
      const response = await fetch(
        `${FITBIT_API_URL}/-/activities/steps/date/${dateStr}/1d/1min.json`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) {
        // Fallback: return zeros if intraday not available
        return new Array(24).fill(0);
      }

      const data: FitbitIntradayStepsResponse = await response.json();
      const hourlyData: number[] = new Array(24).fill(0);

      // Aggregate minute data into hours
      for (const point of data['activities-steps-intraday'].dataset) {
        const hour = parseInt(point.time.split(':')[0], 10);
        hourlyData[hour] += point.value;
      }

      return hourlyData;
    } catch (error) {
      console.error('Failed to fetch Fitbit hourly steps:', error);
      return new Array(24).fill(0);
    }
  }

  /**
   * Get calories for a date range
   */
  async getCalories(startDate: Date, endDate: Date): Promise<EnergyData[]> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) return [];

    try {
      const startStr = formatDate(startDate);
      const endStr = formatDate(endDate);

      const response = await fetch(
        `${FITBIT_API_URL}/-/activities/calories/date/${startStr}/${endStr}.json`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) return [];

      const data: FitbitCaloriesResponse = await response.json();

      return data['activities-calories'].map((day) => ({
        date: day.dateTime,
        activeCalories: parseInt(day.value, 10),
        source: 'fitbit' as const,
      }));
    } catch (error) {
      console.error('Failed to fetch Fitbit calories:', error);
      return [];
    }
  }

  /**
   * Get activity log (workouts) for a date range
   */
  async getWorkouts(startDate: Date, endDate: Date): Promise<WearableWorkoutData[]> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) return [];

    try {
      const afterDate = formatDate(startDate);
      const beforeDate = formatDate(endDate);

      const response = await fetch(
        `${FITBIT_API_URL}/-/activities/list.json?afterDate=${afterDate}&beforeDate=${beforeDate}&sort=desc&limit=100&offset=0`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) return [];

      const data: FitbitActivityLogResponse = await response.json();

      return data.activities.map((activity) => {
        const startTime = new Date(`${activity.startDate}T${activity.startTime}`);
        const endTime = new Date(startTime.getTime() + activity.duration);

        return {
          id: String(activity.logId),
          startTime,
          endTime,
          workoutType: this.mapActivityType(activity.activityTypeId),
          calories: activity.calories,
          heartRateAvg: activity.averageHeartRate,
          source: 'fitbit' as const,
        };
      });
    } catch (error) {
      console.error('Failed to fetch Fitbit workouts:', error);
      return [];
    }
  }

  /**
   * Get permissions (check what scopes we have)
   */
  async getPermissions(): Promise<PermissionResult> {
    if (!this.tokens) {
      return { granted: false, reason: 'not_connected' };
    }

    const scopes = this.tokens.scope;
    const permissions: WearablePermission[] = [];

    if (scopes.includes('activity')) {
      permissions.push('steps', 'active_energy', 'workouts');
    }
    if (scopes.includes('heartrate')) {
      permissions.push('heart_rate');
    }
    if (scopes.includes('sleep')) {
      permissions.push('sleep');
    }

    return {
      granted: permissions.length > 0,
      permissions,
    };
  }

  // === PRIVATE METHODS ===

  private async getValidAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;

    // Check if token is expired or about to expire (5 min buffer)
    const now = new Date();
    const expiresAt = new Date(this.tokens.expiresAt);
    const bufferMs = 5 * 60 * 1000;

    if (now.getTime() + bufferMs > expiresAt.getTime()) {
      const refreshed = await this.refreshToken();
      if (!refreshed) return null;
    }

    return this.tokens.accessToken;
  }

  private generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private mapActivityType(typeId: number): string {
    // Fitbit activity type IDs
    const typeMap: Record<number, string> = {
      90013: 'strength_training',
      90019: 'weight_lifting',
      90009: 'running',
      90024: 'walking',
      90001: 'cycling',
      90015: 'swimming',
      90017: 'yoga',
      90018: 'pilates',
      90011: 'hiit',
      90012: 'elliptical',
      15000: 'sport', // Generic
    };

    return typeMap[typeId] || 'other';
  }
}

// === HELPER FUNCTIONS ===

function formatDate(date: Date): string {
  return getLocalDateString(date);
}

// Export singleton instance
export const fitbitService = new FitbitService();

// Export utility functions
export async function initiateFitbitOAuth(): Promise<void> {
  await fitbitService.initiateOAuth();
}

export async function handleFitbitCallback(
  code: string,
  state: string
): Promise<{ success: boolean; error?: string }> {
  return fitbitService.handleOAuthCallback(code, state);
}

export function setFitbitTokens(tokens: FitbitTokens): void {
  fitbitService.setTokens(tokens);
}

export async function revokeFitbitAccess(): Promise<boolean> {
  return fitbitService.revokeAccess();
}

export async function fetchFitbitSteps(startDate: Date, endDate: Date): Promise<StepData[]> {
  return fitbitService.getSteps(startDate, endDate);
}

export async function fetchFitbitHourlySteps(date: Date): Promise<number[]> {
  return fitbitService.getHourlySteps(date);
}

export async function fetchFitbitCalories(
  startDate: Date,
  endDate: Date
): Promise<EnergyData[]> {
  return fitbitService.getCalories(startDate, endDate);
}

export async function fetchFitbitWorkouts(
  startDate: Date,
  endDate: Date
): Promise<WearableWorkoutData[]> {
  return fitbitService.getWorkouts(startDate, endDate);
}

export async function getFitbitPermissions(): Promise<PermissionResult> {
  return fitbitService.getPermissions();
}

export function isFitbitConnected(): boolean {
  return fitbitService.isConnected();
}
