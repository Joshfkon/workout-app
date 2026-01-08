'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Toggle, Slider } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import type {
  ExerciseVarietyLevel,
  ExerciseVarietyPreferences,
  ExerciseVarietyPreferencesRow,
} from '@/types/user-exercise-preferences';
import { VARIETY_LEVEL_DEFAULTS } from '@/types/user-exercise-preferences';

interface ExerciseVarietySettingsProps {
  userId: string;
  onSave?: (prefs: ExerciseVarietyPreferences) => void;
  className?: string;
}

const VARIETY_LEVELS: {
  value: ExerciseVarietyLevel;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: 'low',
    label: 'Consistent',
    description: 'Stick to 2-3 favorite exercises per muscle',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    value: 'medium',
    label: 'Balanced',
    description: 'Rotate through 5-6 exercises per muscle',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    value: 'high',
    label: 'High Variety',
    description: 'Rotate through 8-10+ exercises per muscle',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
];

export function ExerciseVarietySettings({
  userId,
  onSave,
  className = '',
}: ExerciseVarietySettingsProps) {
  const [varietyLevel, setVarietyLevel] = useState<ExerciseVarietyLevel>('medium');
  const [rotationFrequency, setRotationFrequency] = useState(2);
  const [minPoolSize, setMinPoolSize] = useState(5);
  const [prioritizeTopTier, setPrioritizeTopTier] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load existing preferences
  useEffect(() => {
    const loadPreferences = async () => {
      setIsLoading(true);
      const supabase = createUntypedClient();

      const { data, error } = await supabase
        .from('exercise_variety_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!error && data) {
        const row = data as ExerciseVarietyPreferencesRow;
        setVarietyLevel(row.variety_level);
        setRotationFrequency(row.rotation_frequency);
        setMinPoolSize(row.min_pool_size);
        setPrioritizeTopTier(row.prioritize_top_tier);
      }
      // If no data, defaults are already set

      setIsLoading(false);
    };

    loadPreferences();
  }, [userId]);

  const handleVarietyLevelChange = useCallback((level: ExerciseVarietyLevel) => {
    setVarietyLevel(level);
    // Apply defaults for the selected level
    const defaults = VARIETY_LEVEL_DEFAULTS[level];
    setRotationFrequency(defaults.rotationFrequency);
    setMinPoolSize(defaults.minPoolSize);
    setHasChanges(true);
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    const supabase = createUntypedClient();

    const { error } = await supabase
      .from('exercise_variety_preferences')
      .upsert(
        {
          user_id: userId,
          variety_level: varietyLevel,
          rotation_frequency: rotationFrequency,
          min_pool_size: minPoolSize,
          prioritize_top_tier: prioritizeTopTier,
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('Error saving variety preferences:', error);
    } else {
      setHasChanges(false);
      onSave?.({
        id: '',
        userId,
        varietyLevel,
        rotationFrequency,
        minPoolSize,
        prioritizeTopTier,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <div className={`animate-pulse space-y-4 ${className}`}>
        <div className="h-20 bg-surface-700/50 rounded-lg" />
        <div className="h-20 bg-surface-700/50 rounded-lg" />
        <div className="h-20 bg-surface-700/50 rounded-lg" />
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Variety Level Selection */}
      <div>
        <label className="block text-sm font-medium text-surface-200 mb-3">
          Exercise Variety Level
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {VARIETY_LEVELS.map((level) => (
            <button
              key={level.value}
              onClick={() => handleVarietyLevelChange(level.value)}
              className={`p-4 rounded-lg border-2 transition-all text-left ${
                varietyLevel === level.value
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'border-surface-700 bg-surface-800/50 hover:border-surface-600'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`${
                    varietyLevel === level.value ? 'text-primary-400' : 'text-surface-400'
                  }`}
                >
                  {level.icon}
                </div>
                <span
                  className={`font-medium ${
                    varietyLevel === level.value ? 'text-primary-400' : 'text-surface-200'
                  }`}
                >
                  {level.label}
                </span>
              </div>
              <p className="text-xs text-surface-500">{level.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Description of current selection */}
      <div className="p-4 bg-surface-800/50 rounded-lg border border-surface-700">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary-500/10 rounded-lg text-primary-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm text-surface-300">{VARIETY_LEVEL_DEFAULTS[varietyLevel].description}</p>
            <p className="text-xs text-surface-500 mt-1">
              {varietyLevel === 'high' && (
                <>
                  Great for targeting muscles from different angles and preventing adaptation plateaus.
                  Each session will feel fresh with different exercises.
                </>
              )}
              {varietyLevel === 'medium' && (
                <>
                  Provides variety while maintaining familiarity. You&apos;ll see your favorite exercises
                  regularly while still getting exposure to alternatives.
                </>
              )}
              {varietyLevel === 'low' && (
                <>
                  Best for tracking progress on specific exercises. Ideal if you want to maximize
                  strength gains on particular movements.
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Advanced Settings Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        <svg
          className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Advanced Settings
      </button>

      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="space-y-6 p-4 bg-surface-800/30 rounded-lg border border-surface-700">
          {/* Rotation Frequency */}
          <div>
            <Slider
              label="Rotation Frequency"
              min={0}
              max={5}
              step={1}
              value={rotationFrequency}
              onChange={(e) => {
                setRotationFrequency(parseInt(e.target.value));
                setHasChanges(true);
              }}
              valueFormatter={(v) => (v === 0 ? 'No limit' : `${v} sessions`)}
            />
            <p className="text-xs text-surface-500 mt-1">
              How many sessions before the same exercise can be suggested again for a muscle group.
              Set to 0 for no restriction.
            </p>
          </div>

          {/* Min Pool Size */}
          <div>
            <Slider
              label="Minimum Exercise Pool"
              min={2}
              max={12}
              step={1}
              value={minPoolSize}
              onChange={(e) => {
                setMinPoolSize(parseInt(e.target.value));
                setHasChanges(true);
              }}
              valueFormatter={(v) => `${v} exercises`}
            />
            <p className="text-xs text-surface-500 mt-1">
              Minimum number of different exercises to rotate between for each muscle group.
            </p>
          </div>

          {/* Prioritize Top Tier */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-200">Prioritize Top-Tier Exercises</p>
              <p className="text-xs text-surface-500">
                Still prefer S/A-tier exercises when selecting from the variety pool
              </p>
            </div>
            <Toggle
              checked={prioritizeTopTier}
              onChange={(checked) => {
                setPrioritizeTopTier(checked);
                setHasChanges(true);
              }}
            />
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving} disabled={!hasChanges && !isSaving}>
          {hasChanges ? 'Save Changes' : 'Saved'}
        </Button>
      </div>
    </div>
  );
}
