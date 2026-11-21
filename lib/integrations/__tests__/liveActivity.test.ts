/**
 * The HyperTrackNative bridge: which plugin calls reach native, with what
 * payload, and that web / Android never touch the plugin.
 */
const mockPlugin = {
  startRestTimer: jest.fn().mockResolvedValue(undefined),
  updateRestTimer: jest.fn().mockResolvedValue(undefined),
  endRestTimer: jest.fn().mockResolvedValue(undefined),
  setWidgetData: jest.fn().mockResolvedValue(undefined),
};
const mockRegisterPlugin = jest.fn(() => mockPlugin);
jest.mock('@capacitor/core', () => ({
  registerPlugin: (...a: unknown[]) => (mockRegisterPlugin as (...x: unknown[]) => unknown)(...a),
}));

let mockNative = true;
let mockPlatform = 'ios';
jest.mock('../capacitor-stub', () => ({
  isNativePlatform: () => mockNative,
  getPlatform: () => mockPlatform,
}));

import {
  startRestLiveActivity,
  updateRestLiveActivity,
  endRestLiveActivity,
  updateTodayWorkoutWidget,
  updateNutritionWidget,
  __resetLiveActivityPluginForTests,
  __resetWidgetCacheForTests,
} from '../liveActivity';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockNative = true;
  mockPlatform = 'ios';
  __resetLiveActivityPluginForTests();
  __resetWidgetCacheForTests();
});
afterEach(() => jest.restoreAllMocks());

describe('rest-timer Live Activity', () => {
  it('starts with the end time, full-allotment start time and labels', async () => {
    await startRestLiveActivity(NOW + 90_000, 120, { exerciseName: 'Bench Press', nextSet: 'Set 2 of 3' });
    expect(mockRegisterPlugin).toHaveBeenCalledWith('HyperTrackNative');
    expect(mockPlugin.startRestTimer).toHaveBeenCalledWith({
      endTimeMs: NOW + 90_000,
      startTimeMs: NOW + 90_000 - 120_000,
      exerciseName: 'Bench Press',
      nextSet: 'Set 2 of 3',
    });
  });

  it('falls back to "Rest" with no labels', async () => {
    await startRestLiveActivity(NOW + 60_000, 60);
    expect(mockPlugin.startRestTimer).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseName: 'Rest', nextSet: '' })
    );
  });

  it('does not start a countdown that already ended', async () => {
    await startRestLiveActivity(NOW - 1, 60);
    expect(mockPlugin.startRestTimer).not.toHaveBeenCalled();
  });

  it('updates and ends through the plugin', async () => {
    await updateRestLiveActivity(NOW + 105_000, 135, { exerciseName: 'Squat' });
    expect(mockPlugin.updateRestTimer).toHaveBeenCalledWith(
      expect.objectContaining({ endTimeMs: NOW + 105_000, startTimeMs: NOW - 30_000, exerciseName: 'Squat' })
    );
    await endRestLiveActivity();
    expect(mockPlugin.endRestTimer).toHaveBeenCalledTimes(1);
  });

  it('swallows native errors', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPlugin.startRestTimer.mockRejectedValueOnce(new Error('disabled'));
    await expect(startRestLiveActivity(NOW + 60_000, 60)).resolves.toBeUndefined();
  });

  it.each([
    ['web', false, 'web'],
    ['android', true, 'android'],
  ])('is a no-op on %s', async (_label, native, platform) => {
    mockNative = native;
    mockPlatform = platform;
    await startRestLiveActivity(NOW + 60_000, 60);
    await updateRestLiveActivity(NOW + 60_000, 60);
    await endRestLiveActivity();
    await updateNutritionWidget({ caloriesLeft: 1, caloriesTarget: 2, proteinLeft: 1, proteinTarget: 2, path: '/x' });
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });
});

describe('widget data', () => {
  it('writes today\'s workout as JSON under its key', async () => {
    await updateTodayWorkoutWidget({ sessionName: 'Upper A', detail: '6 exercises', path: '/dashboard' });
    expect(mockPlugin.setWidgetData).toHaveBeenCalledTimes(1);
    const { key, json } = mockPlugin.setWidgetData.mock.calls[0][0];
    expect(key).toBe('todayWorkout');
    expect(JSON.parse(json)).toEqual({
      sessionName: 'Upper A',
      detail: '6 exercises',
      path: '/dashboard',
      updatedAt: NOW,
    });
  });

  it('rounds nutrition values and skips identical rewrites', async () => {
    const data = { caloriesLeft: 812.6, caloriesTarget: 2600.2, proteinLeft: 63.5, proteinTarget: 190, path: '/dashboard/nutrition' };
    await updateNutritionWidget(data);
    await updateNutritionWidget({ ...data });
    expect(mockPlugin.setWidgetData).toHaveBeenCalledTimes(1);
    const { key, json } = mockPlugin.setWidgetData.mock.calls[0][0];
    expect(key).toBe('nutritionToday');
    expect(JSON.parse(json)).toMatchObject({ caloriesLeft: 813, caloriesTarget: 2600, proteinLeft: 64, proteinTarget: 190 });

    await updateNutritionWidget({ ...data, caloriesLeft: 500 });
    expect(mockPlugin.setWidgetData).toHaveBeenCalledTimes(2);
  });

  it('rewrites an unchanged payload on a new local day', async () => {
    const data = { sessionName: null, path: '/dashboard' };
    await updateTodayWorkoutWidget(data);
    await updateTodayWorkoutWidget(data);
    expect(mockPlugin.setWidgetData).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(NOW + 86_400_000);
    jest.useFakeTimers({ now: NOW + 86_400_000 });
    try {
      await updateTodayWorkoutWidget(data);
    } finally {
      jest.useRealTimers();
    }
    expect(mockPlugin.setWidgetData).toHaveBeenCalledTimes(2);
  });

  it('retries a write that failed', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPlugin.setWidgetData.mockRejectedValueOnce(new Error('no group'));
    const data = { sessionName: null, path: '/dashboard' };
    await updateTodayWorkoutWidget(data);
    await updateTodayWorkoutWidget(data);
    expect(mockPlugin.setWidgetData).toHaveBeenCalledTimes(2);
  });
});
