'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  ACTIVITY_MUSCLE_OPTIONS,
  ACTIVITY_PRESETS,
  musclesForOptionKeys,
  type ActivityIntensity,
  type ActivityType,
  type NonGymActivity,
} from '@/services/nonGymActivity';
import {
  useNonGymActivityFatigue,
  useInvalidateNonGymActivities,
} from '@/hooks/useNonGymActivities';

/**
 * NonGymActivityLogger — "my Sunday ride trashed my legs" goes here.
 *
 * Logs a non-gym activity (preset + perceived effort + affected regions +
 * optional duration) into `non_gym_activities`. The recovery model picks it
 * up through useNonGymActivityFatigue → useRecoveryHistory, so readiness
 * badges and good-targets react without any wiring here. This surface never
 * touches weekly volume — an activity is recovery debt, not sets.
 */

interface NonGymActivityLoggerProps {
  userId: string;
}

const INTENSITY_OPTIONS: { value: ActivityIntensity; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'easy pace, fresh tomorrow' },
  { value: 'moderate', label: 'Moderate', hint: 'solid effort' },
  { value: 'hard', label: 'Hard', hint: 'left it all out there' },
];

function typeLabel(type: ActivityType): string {
  return ACTIVITY_PRESETS.find((p) => p.type === type)?.label ?? 'Activity';
}

function dayLabel(performedAt: Date, now: Date): string {
  const started = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(
    performedAt.getFullYear(),
    performedAt.getMonth(),
    performedAt.getDate()
  );
  const diffDays = Math.round((started.getTime() - day.getTime()) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return performedAt.toLocaleDateString(undefined, { weekday: 'short' });
}

function musclesSummary(activity: NonGymActivity): string {
  const selected = new Set(activity.muscleGroups);
  const labels = ACTIVITY_MUSCLE_OPTIONS.filter((o) =>
    o.muscles.some((m) => selected.has(m))
  ).map((o) => o.label);
  if (labels.length === 0) return '';
  if (labels.length <= 3) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
}

function currentTimeValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function NonGymActivityLogger({ userId }: NonGymActivityLoggerProps) {
  const [now] = useState(() => new Date());
  const { activities, isLoading } = useNonGymActivityFatigue(now, true);
  const invalidate = useInvalidateNonGymActivities();

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>('bike');
  const [name, setName] = useState('');
  const [intensity, setIntensity] = useState<ActivityIntensity>('moderate');
  const [duration, setDuration] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(ACTIVITY_PRESETS[0].defaultOptionKeys)
  );
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const [time, setTime] = useState(currentTimeValue);

  const supabaseRef = useRef(createUntypedClient());

  const selectPreset = useCallback((type: ActivityType) => {
    setActivityType(type);
    const preset = ACTIVITY_PRESETS.find((p) => p.type === type);
    setSelectedKeys(new Set(preset?.defaultOptionKeys ?? []));
  }, []);

  const toggleMuscleKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const resetForm = useCallback(() => {
    setShowForm(false);
    setActivityType('bike');
    setName('');
    setIntensity('moderate');
    setDuration('');
    setSelectedKeys(new Set(ACTIVITY_PRESETS[0].defaultOptionKeys));
    setDay('today');
    setTime(currentTimeValue());
  }, []);

  const muscleGroups = useMemo(() => musclesForOptionKeys(selectedKeys), [selectedKeys]);

  const performedAt = useMemo(() => {
    const base = new Date();
    if (day === 'yesterday') base.setDate(base.getDate() - 1);
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (match) {
      base.setHours(Number(match[1]), Number(match[2]), 0, 0);
    }
    // A "today" time later than now means the user left the default while the
    // clock ticked past, or typed a future time — clamp to now so an activity
    // can never create recovery debt from the future.
    const nowMs = Date.now();
    return base.getTime() > nowMs ? new Date(nowMs) : base;
  }, [day, time]);

  const canSave = muscleGroups.length > 0 && !isSaving;

  const saveActivity = useCallback(async () => {
    if (muscleGroups.length === 0) return;
    setIsSaving(true);
    try {
      const durationNum = parseInt(duration, 10);
      const { error } = await supabaseRef.current.from('non_gym_activities').insert({
        user_id: userId,
        performed_at: performedAt.toISOString(),
        activity_type: activityType,
        name: name.trim() || null,
        duration_minutes: Number.isFinite(durationNum) && durationNum > 0 ? durationNum : null,
        intensity,
        muscle_groups: muscleGroups,
      });
      if (error) throw error;
      await invalidate();
      resetForm();
    } catch (error) {
      console.error('Failed to log activity:', error);
    } finally {
      setIsSaving(false);
    }
  }, [
    muscleGroups,
    duration,
    userId,
    performedAt,
    activityType,
    name,
    intensity,
    invalidate,
    resetForm,
  ]);

  const deleteActivity = useCallback(
    async (id: string) => {
      const { error } = await supabaseRef.current
        .from('non_gym_activities')
        .delete()
        .eq('id', id);
      if (!error) await invalidate();
      else console.error('Failed to delete activity:', error);
    },
    [invalidate]
  );

  return (
    <div className="space-y-3">
      {/* Recent activities */}
      {activities.length > 0 && (
        <div className="space-y-1">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center justify-between py-1 px-2 bg-fill/30 rounded"
            >
              <div className="flex items-center gap-2 text-caption min-w-0">
                <span className="font-medium text-ink whitespace-nowrap">
                  {activity.name || typeLabel(activity.activityType)}
                </span>
                <span
                  className={`capitalize whitespace-nowrap ${
                    activity.intensity === 'hard'
                      ? 'text-status-bad'
                      : activity.intensity === 'moderate'
                        ? 'text-status-warn'
                        : 'text-ink-2'
                  }`}
                >
                  {activity.intensity}
                </span>
                {activity.durationMinutes && (
                  <span className="text-ink-3 whitespace-nowrap">
                    {activity.durationMinutes} min
                  </span>
                )}
                <span className="text-ink-3 truncate">{musclesSummary(activity)}</span>
                <span className="text-ink-3 whitespace-nowrap">
                  {dayLabel(activity.performedAt, now)}
                </span>
              </div>
              <button
                onClick={() => deleteActivity(activity.id)}
                className="p-0.5 text-ink-3 hover:text-status-bad transition-colors flex-shrink-0"
                aria-label="Delete activity"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="space-y-3 p-3 bg-fill/50 border border-sep rounded-lg">
          {/* Preset chips */}
          <div>
            <label className="block text-caption font-medium text-ink-2 mb-1.5">Activity</label>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVITY_PRESETS.map((preset) => (
                <button
                  key={preset.type}
                  onClick={() => selectPreset(preset.type)}
                  className={`px-3 py-1.5 rounded-full text-caption font-medium transition-colors ${
                    activityType === preset.type
                      ? 'bg-action/20 text-action border border-action/40'
                      : 'bg-fill text-ink-2 border border-sep hover:bg-sep'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {(activityType === 'sport' || activityType === 'other') && (
            <div>
              <label className="block text-caption font-medium text-ink-2 mb-1">
                What was it? (optional)
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={activityType === 'sport' ? 'e.g., basketball' : 'e.g., moving day'}
              />
            </div>
          )}

          {/* Intensity */}
          <div>
            <label className="block text-caption font-medium text-ink-2 mb-1.5">
              How hard was it?
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {INTENSITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setIntensity(option.value)}
                  className={`px-2 py-1.5 rounded-lg text-caption font-medium transition-colors ${
                    intensity === option.value
                      ? 'bg-action/20 text-action border border-action/40'
                      : 'bg-fill text-ink-2 border border-sep hover:bg-sep'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-caption text-ink-3">
              {INTENSITY_OPTIONS.find((o) => o.value === intensity)?.hint}
            </p>
          </div>

          {/* Duration + when */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-ink-2 mb-1">
                Minutes (optional)
              </label>
              <Input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="60"
                min="1"
              />
            </div>
            <div>
              <label className="block text-caption font-medium text-ink-2 mb-1">When</label>
              <div className="flex gap-1.5">
                {(['today', 'yesterday'] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setDay(option)}
                    className={`flex-1 px-2 py-2 rounded-lg text-caption font-medium capitalize transition-colors ${
                      day === option
                        ? 'bg-action/20 text-action border border-action/40'
                        : 'bg-fill text-ink-2 border border-sep hover:bg-sep'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Affected muscles */}
          <div>
            <label className="block text-caption font-medium text-ink-2 mb-1.5">
              What did it hit?
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVITY_MUSCLE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  onClick={() => toggleMuscleKey(option.key)}
                  className={`px-2.5 py-1 rounded-full text-caption transition-colors ${
                    selectedKeys.has(option.key)
                      ? 'bg-action/20 text-action border border-action/40'
                      : 'bg-fill text-ink-2 border border-sep hover:bg-sep'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {muscleGroups.length === 0 && (
              <p className="mt-1 text-caption text-status-warn">
                Pick at least one area so recovery knows what to rest.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={saveActivity}
              disabled={!canSave}
              variant="primary"
              size="sm"
              className="flex-1"
            >
              {isSaving ? 'Logging...' : 'Log activity'}
            </Button>
            <Button onClick={resetForm} variant="ghost" size="sm">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {activities.length === 0 && !isLoading && (
            <p className="text-caption text-ink-3">
              Bike rides, runs, sports — log them so recovery treats those muscles as
              recently worked.
            </p>
          )}
          <Button
            onClick={() => setShowForm(true)}
            variant="outline"
            size="sm"
            className="w-full"
          >
            + Log activity
          </Button>
        </>
      )}
    </div>
  );
}
