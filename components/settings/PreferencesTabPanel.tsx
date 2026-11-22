'use client';

import type { WeightUnit } from '@/types/schema';
import { Card, CardHeader, CardTitle, CardContent, Select, Slider, Toggle } from '@/components/ui';
import { EatingWindowSettings } from '@/components/settings/EatingWindowSettings';
import { BloodPressureSettings } from '@/components/settings/BloodPressureSettings';
import { MealReminderSettings } from '@/components/settings/MealReminderSettings';
import { EducationPreferencesCard } from '@/components/settings/EducationPreferencesCard';

/**
 * Auto-save state for the App preferences card: every choice there saves the
 * moment it changes (no Save button), confirmed with a brief "Saved".
 */
export type PreferenceSaveStatus =
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string }
  | null;

interface PreferencesTabPanelProps {
  // Units
  units: WeightUnit;
  handleUnitsChange: (units: WeightUnit) => void;
  
  // Preferences
  restTimer: number;
  setRestTimer: (value: number) => void;
  showFormCues: boolean;
  setShowFormCues: (value: boolean) => void;
  showWarmupSuggestions: boolean;
  setShowWarmupSuggestions: (value: boolean) => void;
  prioritizeHypertrophy: boolean;
  setPrioritizeHypertrophy: (value: boolean) => void;
  skipPreWorkoutCheckIn: boolean;
  setSkipPreWorkoutCheckIn: (value: boolean) => void;
  trackWaistInCheckin: boolean;
  setTrackWaistInCheckin: (value: boolean) => void;
  showAiCoachNotes: boolean;
  setShowAiCoachNotes: (value: boolean) => void;
  
  /** Auto-save feedback ("Saving…" / "Saved" / error). */
  saveStatus: PreferenceSaveStatus;
}

export function PreferencesTabPanel({
  units,
  handleUnitsChange,
  restTimer,
  setRestTimer,
  showFormCues,
  setShowFormCues,
  showWarmupSuggestions,
  setShowWarmupSuggestions,
  prioritizeHypertrophy,
  setPrioritizeHypertrophy,
  skipPreWorkoutCheckIn,
  setSkipPreWorkoutCheckIn,
  trackWaistInCheckin,
  setTrackWaistInCheckin,
  showAiCoachNotes,
  setShowAiCoachNotes,
  saveStatus,
}: PreferencesTabPanelProps) {
  return (
    <div className="space-y-6">
      {/* Preferences */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>App preferences</CardTitle>
            <span
              role="status"
              aria-live="polite"
              data-testid="preferences-save-status"
              className={`text-caption font-medium ${
                saveStatus?.state === 'saved' ? 'text-status-ok' : 'text-ink-3'
              }`}
            >
              {saveStatus?.state === 'saving' ? 'Saving…' : saveStatus?.state === 'saved' ? 'Saved' : ''}
            </span>
          </div>
          <p className="text-body text-ink-2 mt-1">
            Customize how the app works and what you see during workouts. Changes save
            automatically.
          </p>
          {saveStatus?.state === 'error' && (
            <p role="alert" className="mt-2 text-caption text-status-bad">
              {saveStatus.message}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <Select
            label="Weight units"
            value={units}
            onChange={(e) => handleUnitsChange(e.target.value as WeightUnit)}
            options={[
              { value: 'kg', label: 'Metric (kg, cm)' },
              { value: 'lb', label: 'Imperial (lbs, inches)' },
            ]}
            hint="Changes how measurements are displayed throughout the app"
          />

          <Slider
            label="Default rest timer"
            min={30}
            max={300}
            step={15}
            value={restTimer}
            onChange={(e) => setRestTimer(parseInt(e.target.value))}
            valueFormatter={(v) => `${Math.floor(v / 60)}:${(v % 60).toString().padStart(2, '0')}`}
          />

          <div className="space-y-4 pt-2 border-t border-sep">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium text-ink">Show form cues</p>
                <p className="text-caption text-ink-3">Display exercise form tips during workouts</p>
              </div>
              <Toggle
                checked={showFormCues}
                onChange={setShowFormCues}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium text-ink">Show warmup suggestions</p>
                <p className="text-caption text-ink-3">Display warmup protocol before exercises</p>
              </div>
              <Toggle
                checked={showWarmupSuggestions}
                onChange={setShowWarmupSuggestions}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium text-ink">Prioritize hypertrophy</p>
                <p className="text-caption text-ink-3">Select S-tier exercises first (Nippard methodology)</p>
              </div>
              <Toggle
                checked={prioritizeHypertrophy}
                onChange={setPrioritizeHypertrophy}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium text-ink">Skip pre-workout check-in</p>
                <p className="text-caption text-ink-3">Start workouts immediately without readiness questions</p>
              </div>
              <Toggle
                checked={skipPreWorkoutCheckIn}
                onChange={setSkipPreWorkoutCheckIn}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium text-ink">Morning waist in check-in</p>
                <p className="text-caption text-ink-3">Optional waist entry in the daily check-in; feeds your composition trend</p>
              </div>
              <Toggle
                checked={trackWaistInCheckin}
                onChange={setTrackWaistInCheckin}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium text-ink">AI coach notes</p>
                <p className="text-caption text-ink-3">Show AI-generated coaching tips during workouts</p>
              </div>
              <Toggle
                checked={showAiCoachNotes}
                onChange={setShowAiCoachNotes}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Eating window (drives nutrition pacing verdicts) */}
      <EatingWindowSettings />

      {/* Health reminders (blood pressure daily nudge — opt-in) */}
      <Card>
        <CardHeader>
          <CardTitle>Reminders</CardTitle>
          <p className="text-body text-ink-2 mt-1">
            Optional nudges to log meals and health metrics
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <MealReminderSettings />
          <BloodPressureSettings />
        </CardContent>
      </Card>

      {/* Education & Tips */}
      <EducationPreferencesCard />
</div>
  );
}
