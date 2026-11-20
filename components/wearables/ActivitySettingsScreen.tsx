'use client';

/**
 * Activity Settings Screen
 *
 * User preferences for activity-based calorie adjustments,
 * workout calorie sources, and wearable preferences.
 */

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STEP_ADJUSTMENT_KEY } from '@/hooks/useStepCalorieAdjustment';
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

export const ADJUSTMENT_MODES: {
  value: CalorieAdjustmentMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'fixed',
    label: 'Fixed target',
    description: 'Your calorie target is the same every day (default).',
  },
  {
    value: 'activity_adjusted',
    label: 'Step-adjusted',
    description:
      'Eat a little more when you walk more than usual and a little less when you walk less. ' +
      'Only the difference from your own recent step average counts — your average activity is ' +
      'already in your target — so your weekly intake stays on plan. Needs 7+ days of step data.',
  },
];

/**
 * 'deficit_locked' was offered before but never implemented (the target stayed
 * fixed). It is no longer offered; a stored value keeps behaving as fixed and
 * is only listed so the radio group still reflects what's saved.
 */
const LEGACY_DEFICIT_LOCKED = {
  value: 'deficit_locked' as CalorieAdjustmentMode,
  label: 'Deficit-locked (retired)',
  description: 'No longer available — your target stays fixed. Pick one of the options above.',
};

export function ActivitySettingsScreen() {
  const [settings, setSettings] = useState<ActivitySettings | null>(null);
  const [connections, setConnections] = useState<WearableConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();

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
        // Eat page / Home tile pick the new mode up immediately.
        void queryClient.invalidateQueries({ queryKey: STEP_ADJUSTMENT_KEY });
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
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-action" />
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
          {[
            ...ADJUSTMENT_MODES,
            ...(settings.adjustmentMode === 'deficit_locked' ? [LEGACY_DEFICIT_LOCKED] : []),
          ].map((mode) => (
            <label
              key={mode.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                settings.adjustmentMode === mode.value
                  ? 'border-action bg-action/10'
                  : 'border-sep hover:bg-ink dark:hover:bg-fill'
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
                <div className="text-sm text-ink-3">{mode.description}</div>
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
            <span className="text-ink-2">calories</span>
          </div>
          <p className="text-sm text-ink-3">
            Even on very active/inactive days, your target will not change by more than
            this amount.
          </p>
        </CardContent>
      </Card>

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
              <div className="text-sm text-ink-3">
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
              <div className="text-sm text-ink-3">
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
              className="w-full p-2 rounded-lg bg-card shadow-card"
            >
              <option value="">Auto (use priority order)</option>
              {connections.map((conn) => (
                <option key={conn.id} value={conn.source}>
                  {conn.deviceName || formatSourceName(conn.source)}
                </option>
              ))}
            </select>
            <p className="text-sm text-ink-3">
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
                  className="flex items-center justify-between p-2 bg-fill rounded"
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
