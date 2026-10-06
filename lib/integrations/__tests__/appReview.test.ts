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

// Mock the app-review plugin
jest.mock('@capacitor-community/app-review', () => ({
  AppReview: {
    requestReview: jest.fn(),
  },
}));

import { isNativePlatform } from '../capacitor-stub';
import { AppReview } from '@capacitor-community/app-review';

const {
  getFinishedWorkoutCount,
  getLastPromptTimestamp,
  getLastPromptVersion,
  incrementFinishedWorkoutCount,
  setLastPromptTimestamp,
  setLastPromptVersion,
  WORKOUTS_BEFORE_FIRST_PROMPT,
  COOLDOWN_DAYS,
} = testHelpers;

describe('appReview', () => {
  let mockIsNativePlatform: jest.MockedFunction<typeof isNativePlatform>;
  let mockRequestReview: jest.MockedFunction<typeof AppReview.requestReview>;
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    // Reset mocks
    mockIsNativePlatform = isNativePlatform as jest.MockedFunction<typeof isNativePlatform>;
    mockRequestReview = AppReview.requestReview as jest.MockedFunction<typeof AppReview.requestReview>;
    mockIsNativePlatform.mockReturnValue(true); // Default to native platform
    mockRequestReview.mockResolvedValue(undefined);

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
    it('returns false on web platform', () => {
      mockIsNativePlatform.mockReturnValue(false);
      expect(shouldRequestReview()).toBe(false);
    });

    it('returns false when workout count is below threshold', () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Count is 0, threshold is 3
      expect(shouldRequestReview()).toBe(false);

      // Increment to 2, still below threshold
      incrementFinishedWorkoutCount();
      incrementFinishedWorkoutCount();
      expect(getFinishedWorkoutCount()).toBe(2);
      expect(shouldRequestReview()).toBe(false);
    });

    it('returns true on first eligible request (3rd workout, native)', () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Increment to threshold
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        incrementFinishedWorkoutCount();
      }
      expect(getFinishedWorkoutCount()).toBe(WORKOUTS_BEFORE_FIRST_PROMPT);
      expect(shouldRequestReview()).toBe(true);
    });

    it('returns false during cooldown period', () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Set up: 5 workouts completed, prompted 30 days ago
      for (let i = 0; i < 5; i++) {
        incrementFinishedWorkoutCount();
      }
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(thirtyDaysAgo);
      setLastPromptVersion('1.0.0');

      expect(shouldRequestReview()).toBe(false);
    });

    it('returns true after cooldown period has passed', () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Set up: 5 workouts completed, prompted 91 days ago with different version
      for (let i = 0; i < 5; i++) {
        incrementFinishedWorkoutCount();
      }
      const ninetyOneDaysAgo = Date.now() - (91 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(ninetyOneDaysAgo);
      setLastPromptVersion('0.9.0'); // Different version

      expect(shouldRequestReview()).toBe(true);
    });

    it('returns false when already prompted for current version', () => {
      mockIsNativePlatform.mockReturnValue(true);
      // Set up: 5 workouts, prompted 91 days ago for the SAME version
      for (let i = 0; i < 5; i++) {
        incrementFinishedWorkoutCount();
      }
      const ninetyOneDaysAgo = Date.now() - (91 * 24 * 60 * 60 * 1000);
      setLastPromptTimestamp(ninetyOneDaysAgo);
      setLastPromptVersion('1.0.0'); // Same version (see getAppVersion in appReview.ts)

      expect(shouldRequestReview()).toBe(false);
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
      await requestReviewAfterWorkout();
      await requestReviewAfterWorkout();
      expect(mockRequestReview).not.toHaveBeenCalled();

      // Third workout - should prompt
      const promise = requestReviewAfterWorkout();
      
      // Fast-forward through the delay
      jest.advanceTimersByTime(500);
      await promise;

      expect(getFinishedWorkoutCount()).toBe(3);
      expect(mockRequestReview).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('records timestamp and version after prompting', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      // Reach threshold
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        const promise = requestReviewAfterWorkout();
        jest.advanceTimersByTime(500);
        await promise;
      }

      expect(getLastPromptTimestamp()).toBeGreaterThanOrEqual(now);
      expect(getLastPromptVersion()).toBe('1.0.0');

      jest.useRealTimers();
    });

    it('respects cooldown after first prompt', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      jest.useFakeTimers();

      // Reach threshold and prompt
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        const promise = requestReviewAfterWorkout();
        jest.advanceTimersByTime(500);
        await promise;
      }
      expect(mockRequestReview).toHaveBeenCalledTimes(1);

      // More workouts within cooldown
      mockRequestReview.mockClear();
      await requestReviewAfterWorkout();
      await requestReviewAfterWorkout();
      jest.advanceTimersByTime(500);

      expect(mockRequestReview).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('handles plugin failure gracefully', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockRequestReview.mockRejectedValue(new Error('Plugin not available'));
      jest.useFakeTimers();

      // Reach threshold
      for (let i = 0; i < WORKOUTS_BEFORE_FIRST_PROMPT; i++) {
        incrementFinishedWorkoutCount();
      }

      // Should not throw
      const promise = requestReviewAfterWorkout();
      jest.advanceTimersByTime(500);
      await expect(promise).resolves.not.toThrow();

      jest.useRealTimers();
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
    it('handles missing localStorage gracefully', () => {
      // Override to throw
      global.Storage.prototype.getItem = jest.fn(() => {
        throw new Error('Storage unavailable');
      });

      expect(getFinishedWorkoutCount()).toBe(0);
      expect(shouldRequestReview()).toBe(false);
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
    it('Keep Training does not count toward review threshold', () => {
      // The review prompt is only called from handleSubmit and handleSaveAndViewReport
      // Keep Training just closes the modal without calling either
      expect(getFinishedWorkoutCount()).toBe(0);
      
      // Simulate Keep Training - no call to requestReviewAfterWorkout
      // Count stays at 0
      expect(getFinishedWorkoutCount()).toBe(0);
    });

    it('Discard workout does not count toward review threshold', () => {
      // Discard doesn't save the workout, so requestReviewAfterWorkout is never called
      expect(getFinishedWorkoutCount()).toBe(0);
    });

    it('Failed save does not count toward review threshold', async () => {
      // requestReviewAfterWorkout is only called after successful onSubmit/onSaveAndViewReport
      // If those callbacks fail or throw, the counter is never incremented
      expect(getFinishedWorkoutCount()).toBe(0);
    });

    it('Save & Finish counts toward review threshold', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      
      // Simulate successful save
      await requestReviewAfterWorkout();
      expect(getFinishedWorkoutCount()).toBe(1);
    });

    it('View full report counts toward review threshold', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      
      // Simulate successful save via View full report
      await requestReviewAfterWorkout();
      expect(getFinishedWorkoutCount()).toBe(1);
    });
  });
});
