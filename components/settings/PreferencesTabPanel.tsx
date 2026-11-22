'use client';

import { IconCheck } from '@tabler/icons-react';
import type { WeightUnit } from '@/types/schema';
import { Card, CardHeader, CardTitle, CardContent, SegmentedControl, Slider, Toggle } from '@/components/ui';
import { EatingWindowSettings } from '@/components/settings/EatingWindowSettings';
import { BloodPressureSettings } from '@/components/settings/BloodPressureSettings';
import { MealReminderSettings } from '@/components/settings/MealReminderSettings';
import { EducationPreferencesCard } from '@/components/settings/EducationPreferencesCard';

/**
 * Auto-save state for the Preferences tab: every choice there saves the
 * moment it changes (no Save button). `field` names the control that changed
 * so the confirmation shows right next to it.
 */
export type PreferenceSaveStatus =
  | { state: 'saving'; field?: string }
  | { state: 'saved'; field?: string }
  | { state: 'error'; message: string; field?: string }
  | null;

/** Spoken names for the screen-reader announcement ("Units saved"). */
const FIELD_LABELS: Record<string, string> = {
  units: 'Units',
  restTimer: 'Default rest timer',
  showFormCues: 'Show form cues',
  showWarmupSuggestions: 'Show warmup suggestions',
  prioritizeHypertrophy: 'Prioritize hypertrophy',
  skipPreWorkoutCheckIn: 'Skip pre-workout check-in',
  trackWaistInCheckin: 'Morning waist in check-in',
  showAiCoachNotes: 'AI coach notes',
};

/** A status with no field (older callers) belongs to the Units control. */
const statusField = (status: PreferenceSaveStatus) => status?.field ?? 'units';

function announcement(status: PreferenceSaveStatus): string {
  if (!status || status.state === 'error') return '';
  if (status.state === 'saving') return 'Saving…';
  const name = FIELD_LABELS[statusField(status)];
  return name ? `${name} saved` : 'Saved';
}

/**
 * Inline "Saving… / Saved" pill next to one control. It is aria-hidden: the
 * panel's single live region announces the same thing ("Units saved").
 */
function FieldSavePill({ field, status }: { field: string; status: PreferenceSaveStatus }) {
  if (!status || status.state === 'error' || statusField(status) !== field) return null;
  const saved = status.state === 'saved';
  return (
    <span
      aria-hidden="true"
      data-testid={`save-status-${field}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold animate-fade-in ${
        saved ? 'bg-status-ok/15 text-status-ok' : 'bg-fill text-ink-2'
      }`}
    >
      {saved && <IconCheck size={12} stroke={3} />}
      {saved ? 'Saved' : 'Saving…'}
    </span>
  );
}

/** A failed save, shown under the control that failed (read out as an alert). */
function FieldSaveError({ field, status }: { field: string; status: PreferenceSaveStatus }) {
  if (status?.state !== 'error' || statusField(status) !== field) return null;
  return (
    <p role="alert" className="mt-2 text-caption text-status-bad">
      {status.message}
    </p>
  );
}

/** A switch row with its save status beside the title. */
function ToggleRow({
  field,
  title,
  description,
  checked,
  onChange,
  status,
}: {
  field: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  status: PreferenceSaveStatus;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-medium text-ink flex items-center gap-2 flex-wrap">
            {title}
            <FieldSavePill field={field} status={status} />
          </p>
          <p className="text-caption text-ink-3">{description}</p>
        </div>
        <Toggle checked={checked} onChange={onChange} />
      </div>
      <FieldSaveError field={field} status={status} />
    </div>
  );
}

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

  /** Auto-save feedback ("Saving…" / "Saved" / error), tagged with its control. */
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
      {/* One live region for every auto-save on this tab ("Units saved"). */}
      <span role="status" aria-live="polite" className="sr-only" data-testid="preferences-save-status">
        {announcement(saveStatus)}
      </span>

      {/* Units first: the setting people come to Preferences for most. One
          choice covers weight and length (they are stored together). */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Units</CardTitle>
            <FieldSavePill field="units" status={saveStatus} />
          </div>
          <p className="text-body text-ink-2 mt-1">
            For weights and body measurements across the app.
          </p>
        </CardHeader>
        <CardContent>
          <SegmentedControl<WeightUnit>
            label="Units"
            value={units}
            onChange={handleUnitsChange}
            options={[
              { value: 'kg', label: 'kg & cm' },
              { value: 'lb', label: 'lb & inches' },
            ]}
            className="w-full"
          />
          <FieldSaveError field="units" status={saveStatus} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App preferences</CardTitle>
          <p className="text-body text-ink-2 mt-1">
            Customize how the app works and what you see during workouts. Changes save
            automatically.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Slider
              label="Default rest timer"
              min={30}
              max={300}
              step={15}
              value={restTimer}
              onChange={(e) => setRestTimer(parseInt(e.target.value))}
              valueFormatter={(v) => `${Math.floor(v / 60)}:${(v % 60).toString().padStart(2, '0')}`}
            />
            {/* Reserved height so the pill doesn't shift the rows below. */}
            <div className="mt-1 min-h-[22px]">
              <FieldSavePill field="restTimer" status={saveStatus} />
            </div>
            <FieldSaveError field="restTimer" status={saveStatus} />
          </div>

          <div className="space-y-4 pt-2 border-t border-sep">
            <ToggleRow
              field="showFormCues"
              title="Show form cues"
              description="Display exercise form tips during workouts"
              checked={showFormCues}
              onChange={setShowFormCues}
              status={saveStatus}
            />
            <ToggleRow
              field="showWarmupSuggestions"
              title="Show warmup suggestions"
              description="Display warmup protocol before exercises"
              checked={showWarmupSuggestions}
              onChange={setShowWarmupSuggestions}
              status={saveStatus}
            />
            <ToggleRow
              field="prioritizeHypertrophy"
              title="Prioritize hypertrophy"
              description="Select S-tier exercises first (Nippard methodology)"
              checked={prioritizeHypertrophy}
              onChange={setPrioritizeHypertrophy}
              status={saveStatus}
            />
            <ToggleRow
              field="skipPreWorkoutCheckIn"
              title="Skip pre-workout check-in"
              description="Start workouts immediately without readiness questions"
              checked={skipPreWorkoutCheckIn}
              onChange={setSkipPreWorkoutCheckIn}
              status={saveStatus}
            />
            <ToggleRow
              field="trackWaistInCheckin"
              title="Morning waist in check-in"
              description="Optional waist entry in the daily check-in; feeds your composition trend"
              checked={trackWaistInCheckin}
              onChange={setTrackWaistInCheckin}
              status={saveStatus}
            />
            <ToggleRow
              field="showAiCoachNotes"
              title="AI coach notes"
              description="Show AI-generated coaching tips during workouts"
              checked={showAiCoachNotes}
              onChange={setShowAiCoachNotes}
              status={saveStatus}
            />
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
