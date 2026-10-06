/**
 * Unit tests for App Store review prompt integration
 */

import {
  shouldRequestReview,
  requestReviewAfterWorkout,
  resetReviewPromptState,
  testHelpers,
} from '../appReview';

// Mock the capacitor-stub module
jest.mock('../capacitor-stub', () => ({
  isNativePlatform: jest.fn(),
}));

// Mock the in-app-review plugin
jest.mock('@capacitor-community/in-app-review', () => ({
  InAppReview: {
    requestReview: jest.fn(),
  },
}));

// Mock the @capacitor/app plugin
jest.mock('@capacitor/app', () => ({
  App: {
    getInfo: jest.fn(),
  },
}));

import { isNativePlatform } from '../capacitor-stub';
import { InAppReview } from '@capacitor-community/in-app-review';
import { App as CapacitorApp } from '@capacitor/app';

const {
  getFinishedWorkoutCount,
  getLastPromptTimestamp,
  getLastPromptVersion,
  incrementFinishedWorkoutCount,
  setLastPromptTimestamp,
  setLastPromptVersion,
  resetAppVersionCache,
  WORKOUTS_BEFORE_FIRST_PROMPT,
  COOLDOWN_DAYS,
} = testHelpers;

describe('appReview', () => {
  let mockIsNativePlatform: jest.MockedFunction<typeof isNativePlatform>;
  let mockRequestReview: jest.MockedFunction<typeof InAppReview.requestReview>;
  let mockGetInfo: jest.MockedFunction<typeof CapacitorApp.getInfo>;
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    // Reset mocks
    mockIsNativePlatform = isNativePlatform as jest.MockedFunction<typeof isNativePlatform>;
    mockRequestReview = InAppReview.requestReview as jest.MockedFunction<typeof InAppReview.requestReview>;
    mockGetInfo = CapacitorApp.getInfo as jest.MockedFunction<typeof CapacitorApp.getInfo>;
    mockIsNativePlatform.mockReturnValue(true); // Default to native platform
    mockRequestReview.mockResolvedValue(undefined);
    mockGetInfo.mockResolvedValue({ name: 'HyperTrack', id: 'app.hypertrack.workout', build: '1', version: '1.0.0' });
    
    // Reset app version cache
    resetAppVersionCache();

    // Mock localStorage
    localStorageMock = {};
    global.Storage.prototype.getItem = jest.fn((key: string) => localStorageMock[key] || null);
    global.Storage.prototype.setItem = jest.fn((key: string, value: string) => {
      localStorageMock[key] = value;
    });
    global.Storage.prototype.removeItem = jest.fn((key: string) => {
      delete localStorageMock[key];
    });

    // Reset state
    resetReviewPromptState();
    jest.clearAllMocks();
  });

  describe('shouldRequestReview', () => {
    it('returns false on web platform', async () => {
      mockIsNativePlatform.mockReturnValue(false);
      expect(await shouldRequestReview()).toBe(false);
    });

    it('returns false when workout count is below threshold', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Count is 0, threshold is 3
      expect(await shouldRequestReview()).toBe(false);

      // Increment to 2, still below threshold
      incrementFinishedWorkoutCount();
      incrementFinishedWorkoutCount();
      expect(getFinishedWorkoutCount()).toBe(2);
      expect(await shouldRequestReview()).toBe(false);
    });

    it('returns true on first eligible request (3rd workout, native)', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Increment to threshold
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        incrementFinishedWorkoutCount();
      }
      expect(getFinishedWorkoutCount()).toBe(WORKOUTS_BEFORE_FIRST_PROMPT);
      expect(await shouldRequestReview()).toBe(true);
    });

    it('returns false during cooldown period', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Set up: 5 workouts completed, prompted 30 days ago
      for (let i = 0; i < 5; i++) {
        incrementFinishedWorkoutCount();
      }
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(thirtyDaysAgo);
      setLastPromptVersion('1.0.0');

      expect(await shouldRequestReview()).toBe(false);
    });

    it('returns true after cooldown period has passed', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Set up: 5 workouts completed, prompted 91 days ago with different version
      for (let i = 0; i < 5; i++) {
        incrementFinishedWorkoutCount();
      }
      const ninetyOneDaysAgo = Date.now() - (91 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(ninetyOneDaysAgo);
      setLastPromptVersion('0.9.0'); // Different version

      expect(await shouldRequestReview()).toBe(true);
    });

    it('returns false when already prompted for current version', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockGetInfo.mockResolvedValue({ name: 'HyperTrack', id: 'app.hypertrack.workout', build: '1', version: '1.0.0' });
      // Set up: 5 workouts, prompted 91 days ago for the SAME version
      for (let i = 0; i < 5; i++) {
        incrementFinishedWorkoutCount();
      }
      const ninetyOneDaysAgo = Date.now() - (91 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(ninetyOneDaysAgo);
      setLastPromptVersion('1.0.0'); // Same version

      expect(await shouldRequestReview()).toBe(false);
    });

    it('returns true when version has changed since last prompt', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockGetInfo.mockResolvedValue({ name: 'HyperTrack', id: 'app.hypertrack.workout', build: '2', version: '1.1.0' });
      // Set up: 5 workouts, prompted 91 days ago for a different version
      for (let i = 0; i < 5; i++) {
        incrementFinishedWorkoutCount();
      }
      const ninetyOneDaysAgo = Date.now() - (91 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(ninetyOneDaysAgo);
      setLastPromptVersion('1.0.0');

      expect(await shouldRequestReview()).toBe(true);
    });
  });

  describe('requestReviewAfterWorkout', () => {
    it('increments counter but does not prompt on web', async () => {
      mockIsNativePlatform.mockReturnValue(false);
      expect(getFinishedWorkoutCount()).toBe(0);

      await requestReviewAfterWorkout();

      expect(getFinishedWorkoutCount()).toBe(1);
      expect(mockRequestReview).not.toHaveBeenCalled();
    });

    it('increments counter on each call', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      expect(getFinishedWorkoutCount()).toBe(0);

      await requestReviewAfterWorkout();
      expect(getFinishedWorkoutCount()).toBe(1);

      await requestReviewAfterWorkout();
      expect(getFinishedWorkoutCount()).toBe(2);
    });

    it('does not prompt before threshold is reached', async () => {
      mockIsNativePlatform.mockReturnValue(true);

      await requestReviewAfterWorkout();
      await requestReviewAfterWorkout();
      
      expect(getFinishedWorkoutCount()).toBe(2);
      expect(mockRequestReview).not.toHaveBeenCalled();
    });

    it('prompts on the threshold workout (3rd)', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      jest.useFakeTimers();

      // First two workouts
      let promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      
      promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      
      expect(mockRequestReview).not.toHaveBeenCalled();

      // Third workout - should prompt
      promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;

      expect(getFinishedWorkoutCount()).toBe(3);
      expect(mockRequestReview).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('records timestamp and version after prompting', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockGetInfo.mockResolvedValue({ name: 'HyperTrack', id: 'app.hypertrack.workout', build: '1', version: '1.2.3' });
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      // Reach threshold
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        const promise = requestReviewAfterWorkout();
        await jest.runAllTimersAsync();
        await promise;
      }

      expect(getLastPromptTimestamp()).toBeGreaterThanOrEqual(now);
      expect(getLastPromptVersion()).toBe('1.2.3');

      jest.useRealTimers();
    });

    it('respects cooldown after first prompt', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      jest.useFakeTimers();

      // Reach threshold and prompt
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        const promise = requestReviewAfterWorkout();
        await jest.runAllTimersAsync();
        await promise;
      }
      expect(mockRequestReview).toHaveBeenCalledTimes(1);

      // More workouts within cooldown
      mockRequestReview.mockClear();
      let promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      
      promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockRequestReview).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('handles plugin failure gracefully', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockRequestReview.mockRejectedValue(new Error('Plugin not available'));

      // Reach threshold
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        incrementFinishedWorkoutCount();
      }

      // Should not throw (error is caught and logged)
      await expect(requestReviewAfterWorkout()).resolves.toBeUndefined();
    });
  });

  describe('resetReviewPromptState', () => {
    it('clears all review-related localStorage', () => {
      // Set some state
      incrementFinishedWorkoutCount();
      incrementFinishedWorkoutCount();
      setLastPromptTimestamp(Date.now());
      setLastPromptVersion('1.0.0');

      expect(getFinishedWorkoutCount()).toBe(2);
      expect(getLastPromptTimestamp()).toBeGreaterThan(0);
      expect(getLastPromptVersion()).toBe('1.0.0');

      // Reset
      resetReviewPromptState();

      expect(getFinishedWorkoutCount()).toBe(0);
      expect(getLastPromptTimestamp()).toBe(0);
      expect(getLastPromptVersion()).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles missing localStorage gracefully', async () => {
      // Override to throw
      global.Storage.prototype.getItem = jest.fn(() => {
        throw new Error('Storage unavailable');
      });

      expect(getFinishedWorkoutCount()).toBe(0);
      expect(await shouldRequestReview()).toBe(false);
    });

    it('handles corrupted counter value', () => {
      localStorageMock['hypertrack:review:finishedCount'] = 'invalid';
      expect(getFinishedWorkoutCount()).toBe(0);
    });

    it('handles corrupted timestamp value', () => {
      localStorageMock['hypertrack:review:lastPrompt'] = 'invalid';
      expect(getLastPromptTimestamp()).toBe(0);
    });
  });

  describe('workout completion scenarios', () => {
    it('counts each successful save', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      jest.useFakeTimers();
      expect(getFinishedWorkoutCount()).toBe(0);

      // First save
      let promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      expect(getFinishedWorkoutCount()).toBe(1);

      // Second save
      promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      expect(getFinishedWorkoutCount()).toBe(2);

      // Third save - should prompt
      promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      
      expect(getFinishedWorkoutCount()).toBe(3);
      expect(mockRequestReview).toHaveBeenCalledTimes(1);
      
      jest.useRealTimers();
    });

    it('only increments counter when called (successful save path)', async () => {
      // The counter only increments when requestReviewAfterWorkout() is explicitly called
      // This happens in finishToDashboard and finishToReport, which are only called
      // after submitFinishOptimistic successfully queues the save locally
      jest.useFakeTimers();
      
      expect(getFinishedWorkoutCount()).toBe(0);
      
      // Simulate Keep Training: modal closes, no save, no call to requestReviewAfterWorkout
      // Counter stays at 0
      expect(getFinishedWorkoutCount()).toBe(0);
      
      // Simulate successful save: finishToDashboard calls requestReviewAfterWorkout
      const promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      expect(getFinishedWorkoutCount()).toBe(1);
      
      jest.useRealTimers();
    });

    it('handles native version check correctly', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockGetInfo.mockResolvedValue({ name: 'HyperTrack', id: 'app.hypertrack.workout', build: '5', version: '2.0.0' });
      jest.useFakeTimers();

      // First prompt at version 2.0.0
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        const promise = requestReviewAfterWorkout();
        await jest.runAllTimersAsync();
        await promise;
      }
      expect(mockRequestReview).toHaveBeenCalledTimes(1);
      expect(getLastPromptVersion()).toBe('2.0.0');
      mockRequestReview.mockClear();

      // More workouts, still v2.0.0, within cooldown - no prompt
      let promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      expect(mockRequestReview).not.toHaveBeenCalled();

      // Fast-forward 91 days, still v2.0.0 - no prompt (same version)
      const ninetyOneDaysAgo = Date.now() - (91 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(ninetyOneDaysAgo);
      promise = requestReviewAfterWorkout();
      await jest.runAllTimersAsync();
      await promise;
      expect(mockRequestReview).not.toHaveBeenCalled();
      
      jest.useRealTimers();
    });

    it('handles missing version info gracefully', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockGetInfo.mockResolvedValue(null);
      jest.useFakeTimers();

      // Should still work, just with empty version
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        const promise = requestReviewAfterWorkout();
        await jest.runAllTimersAsync();
        await promise;
      }
      
      expect(mockRequestReview).toHaveBeenCalledTimes(1);
      expect(getLastPromptVersion()).toBe('');
      
      jest.useRealTimers();
    });
  });
});
