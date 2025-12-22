'use client';

/**
 * Activity Settings Screen
 *
 * User preferences for activity-based calorie adjustments,
 * workout calorie sources, and wearable preferences.
 */

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type {
  ActivitySettings,
  CalorieAdjustmentMode,
  WearableSource,
  WearableConnection,
} from '@/types/wearable';
import {
  getActivitySettings,
  saveActivitySettings,
  getActiveWearableConnections,
} from '@/lib/actions/wearable';

const ADJUSTMENT_MODES: {
  value: CalorieAdjustmentMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'fixed',
    label: 'Fixed target',
    description: 'Always eat the same amount',
  },
  {
    value: 'activity_adjusted',
    label: 'Activity-adjusted',
    description: 'Eat more on active days, less on rest days',
  },
  {
    value: 'deficit_locked',
    label: 'Deficit-locked',
    description: 'Adjust to maintain consistent deficit',
  },
];

export function ActivitySettingsScreen() {
  const [settings, setSettings] = useState<ActivitySettings | null>(null);
  const [connections, setConnections] = useState<WearableConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [settingsData, connectionsData] = await Promise.all([
        getActivitySettings(),
        getActiveWearableConnections(),
      ]);
      setSettings(settingsData);
      setConnections(connectionsData);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!settings) return;

    setSaving(true);
    try {
      const result = await saveActivitySettings(settings);
      if (result.success) {
        setHasChanges(false);
      } else {
        alert('Failed to save settings: ' + result.error);
      }
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function updateSetting<K extends keyof ActivitySettings>(
    key: K,
    value: ActivitySettings[K]
  ) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setHasChanges(true);
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Calorie Target Adjustment */}
      <Card>
        <CardHeader>
          <CardTitle>Calorie Target Adjustment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ADJUSTMENT_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                settings.adjustmentMode === mode.value
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800'
              }`}
            >
              <input
                type="radio"
                name="adjustmentMode"
                value={mode.value}
                checked={settings.adjustmentMode === mode.value}
                onChange={() => updateSetting('adjustmentMode', mode.value)}
                className="mt-1"
              />
              <div>
                <div className="font-medium">{mode.label}</div>
                <div className="text-sm text-surface-500">{mode.description}</div>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* Maximum Daily Adjustment */}
      <Card>
        <CardHeader>
          <CardTitle>Maximum Daily Adjustment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              type="number"
              value={settings.maxDailyAdjustment}
              onChange={(e) =>
                updateSetting('maxDailyAdjustment', parseInt(e.target.value) || 0)
              }
              min={0}
              max={1000}
              className="w-24"
            />
            <span className="text-surface-600 dark:text-surface-400">calories</span>
          </div>
          <p className="text-sm text-surface-500">
            Even on very active/inactive days, your target won't change by more than
            this amount.
          </p>
        </CardContent>
      </Card>

      {/* Target Deficit (for deficit-locked mode) */}
      {settings.adjustmentMode === 'deficit_locked' && (
        <Card>
          <CardHeader>
            <CardTitle>Target Deficit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Input
                type="number"
                value={settings.targetDeficitCals}
                onChange={(e) =>
                  updateSetting('targetDeficitCals', parseInt(e.target.value) || 0)
                }
                min={0}
                max={1500}
                className="w-24"
              />
              <span className="text-surface-600 dark:text-surface-400">
                calories below TDEE
              </span>
            </div>
            <p className="text-sm text-surface-500">
              Your daily calorie target will adjust to maintain this deficit regardless
              of activity level.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Workout Calorie Source */}
      <Card>
        <CardHeader>
          <CardTitle>Workout Calories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.useAppWorkoutEstimates}
              onChange={(e) => updateSetting('useAppWorkoutEstimates', e.target.checked)}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Use app workout estimates</div>
              <div className="text-sm text-surface-500">
                Conservative calorie estimates based on your logged sets, rest times,
                and workout duration.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.useWearableWorkoutCalories}
              onChange={(e) =>
                updateSetting('useWearableWorkoutCalories', e.target.checked)
              }
              className="mt-1"
            />
            <div>
              <div className="font-medium">Use wearable workout calories</div>
              <div className="text-sm text-surface-500">
                Use calories reported by your Apple Watch or other wearable.
                <span className="text-yellow-500 block mt-1">
                  Warning: Often overestimates resistance training by 50-100%.
                </span>
              </div>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* Step Data Source */}
      {connections.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Preferred Step Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={settings.preferredWearableSource || ''}
              onChange={(e) =>
                updateSetting(
                  'preferredWearableSource',
                  (e.target.value as WearableSource) || null
                )
              }
              className="w-full p-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
            >
              <option value="">Auto (use priority order)</option>
              {connections.map((conn) => (
                <option key={conn.id} value={conn.source}>
                  {conn.deviceName || formatSourceName(conn.source)}
                </option>
              ))}
            </select>
            <p className="text-sm text-surface-500">
              If you have multiple devices, choose which one to use for step data.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Current Connection Status */}
      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Connected Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between p-2 bg-surface-50 dark:bg-surface-800 rounded"
                >
                  <span>{conn.deviceName || formatSourceName(conn.source)}</span>
                  <span className="text-green-500 text-sm">Connected</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save Button */}
      {hasChanges && (
        <div className="sticky bottom-4">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
}

function formatSourceName(source: WearableSource): string {
  const names: Record<WearableSource, string> = {
    apple_healthkit: 'Apple Health',
    google_fit: 'Google Fit',
    fitbit: 'Fitbit',
    samsung_health: 'Samsung Health',
    garmin: 'Garmin',
    manual: 'Manual Entry',
  };
  return names[source] || source;
}
