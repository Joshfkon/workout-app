/**
 * iOS Live Activity (lock screen / Dynamic Island rest timer) and home-screen
 * widget data.
 *
 * Both talk to `HyperTrackNative`, a small Swift plugin compiled into the iOS
 * app target (ios/App/App/HyperTrackNativePlugin.swift) and registered by
 * HyperTrackBridgeViewController. The Live Activity itself and the widgets
 * live in the HyperTrackWidgets extension.
 *
 * Everything here is a no-op on web and Android, and swallows native errors:
 * a Live Activity or widget that fails to update must never break logging a
 * set.
 */

import { getPlatform, isNativePlatform } from './capacitor-stub';

export interface RestActivityContext {
  /** Exercise the lifter is resting from (or about to start). */
  exerciseName?: string;
  /** e.g. "Set 3 of 4". */
  nextSet?: string;
}

interface HyperTrackNativePlugin {
  startRestTimer(options: {
    endTimeMs: number;
    startTimeMs: number;
    exerciseName: string;
    nextSet: string;
  }): Promise<void>;
  updateRestTimer(options: {
    endTimeMs: number;
    startTimeMs: number;
    exerciseName: string;
    nextSet: string;
  }): Promise<void>;
  endRestTimer(): Promise<void>;
  setWidgetData(options: { key: WidgetDataKey; json: string }): Promise<void>;
}

/** Keys the widget extension reads from the App Group container. */
export type WidgetDataKey = 'todayWorkout' | 'nutritionToday';

let plugin: HyperTrackNativePlugin | null = null;

function getPlugin(): HyperTrackNativePlugin | null {
  if (!isNativePlatform() || getPlatform() !== 'ios') return null;
  if (plugin) return plugin;
  try {
    const { registerPlugin } = require('@capacitor/core');
    plugin = registerPlugin('HyperTrackNative') as HyperTrackNativePlugin;
    return plugin;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached plugin proxy. */
export function __resetLiveActivityPluginForTests(): void {
  plugin = null;
}

function payload(endTimeMs: number, totalSeconds: number, ctx?: RestActivityContext) {
  return {
    endTimeMs,
    // The countdown's progress bar runs from startTime to endTime; anchor it
    // to the full allotment so a resumed or re-timed rest keeps its bar.
    startTimeMs: endTimeMs - Math.max(1, totalSeconds) * 1000,
    exerciseName: ctx?.exerciseName?.trim() || 'Rest',
    nextSet: ctx?.nextSet?.trim() || '',
  };
}

/** Start (or replace) the rest-timer Live Activity counting down to endTimeMs. */
export async function startRestLiveActivity(
  endTimeMs: number,
  totalSeconds: number,
  ctx?: RestActivityContext
): Promise<void> {
  const p = getPlugin();
  if (!p || endTimeMs <= Date.now()) return;
  try {
    await p.startRestTimer(payload(endTimeMs, totalSeconds, ctx));
  } catch (error) {
    console.warn('[LiveActivity] start failed:', error);
  }
}

/** Move the running Live Activity's end time (±15s) or refresh its labels. */
export async function updateRestLiveActivity(
  endTimeMs: number,
  totalSeconds: number,
  ctx?: RestActivityContext
): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.updateRestTimer(payload(endTimeMs, totalSeconds, ctx));
  } catch (error) {
    console.warn('[LiveActivity] update failed:', error);
  }
}

/** End every rest-timer Live Activity immediately. */
export async function endRestLiveActivity(): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.endRestTimer();
  } catch (error) {
    console.warn('[LiveActivity] end failed:', error);
  }
}

// ---------------------------------------------------------------------------
// Home-screen widgets
// ---------------------------------------------------------------------------

export interface TodayWorkoutWidgetData {
  /** Next planned session name, or null on a rest day / no plan. */
  sessionName: string | null;
  /** Short detail line, e.g. "6 exercises · Week 3". */
  detail?: string | null;
  /** In-app path the widget opens, e.g. "/dashboard/train". */
  path: string;
}

export interface NutritionWidgetData {
  caloriesLeft: number;
  caloriesTarget: number;
  proteinLeft: number;
  proteinTarget: number;
  path: string;
}

const lastWritten: Partial<Record<WidgetDataKey, string>> = {};

async function writeWidgetData(key: WidgetDataKey, data: object): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  const json = JSON.stringify({ ...data, updatedAt: Date.now() });
  // Skip identical writes (ignoring the timestamp) so re-renders don't reload
  // widget timelines, which iOS budgets.
  const fingerprint = JSON.stringify(data);
  if (lastWritten[key] === fingerprint) return;
  lastWritten[key] = fingerprint;
  try {
    await p.setWidgetData({ key, json });
  } catch (error) {
    delete lastWritten[key];
    console.warn('[Widgets] write failed:', error);
  }
}

export function updateTodayWorkoutWidget(data: TodayWorkoutWidgetData): Promise<void> {
  return writeWidgetData('todayWorkout', data);
}

export function updateNutritionWidget(data: NutritionWidgetData): Promise<void> {
  return writeWidgetData('nutritionToday', {
    caloriesLeft: Math.round(data.caloriesLeft),
    caloriesTarget: Math.round(data.caloriesTarget),
    proteinLeft: Math.round(data.proteinLeft),
    proteinTarget: Math.round(data.proteinTarget),
    path: data.path,
  });
}

/** Test hook: forget the de-duplication cache. */
export function __resetWidgetCacheForTests(): void {
  for (const k of Object.keys(lastWritten) as WidgetDataKey[]) delete lastWritten[k];
}
