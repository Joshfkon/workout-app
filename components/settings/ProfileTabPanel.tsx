'use client';

import type { Goal, Experience, Rating } from '@/types/schema';
import { Card, CardHeader, CardTitle, CardContent, Select, Input, Button } from '@/components/ui';
import { ThemeToggle } from '@/components/settings/ThemeToggle';
import { EnhancedAthleteModeCard } from '@/components/settings/EnhancedAthleteModeCard';
import { MotionCaptureLabCard } from '@/components/settings/MotionCaptureLabCard';

interface ProfileTabPanelProps {
  // Profile fields
  goal: Goal;
  setGoal: (value: Goal) => void;
  experience: Experience;
  setExperience: (value: Experience) => void;
  heightDisplay: string;
  setHeightDisplay: (value: string) => void;
  weightDisplay: string;
  setWeightDisplay: (value: string) => void;
  age: string;
  setAge: (value: string) => void;
  trainingAge: string;
  setTrainingAge: (value: string) => void;
  units: 'kg' | 'lb';
  
  // Recovery profile
  sleepQuality: Rating;
  setSleepQuality: (value: Rating) => void;
  stressLevel: Rating;
  setStressLevel: (value: Rating) => void;
  
  // Save handling
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  
  // Volume landmarks change handler
  onExperienceChange: (exp: Experience) => void;
}

export function ProfileTabPanel({
  goal,
  setGoal,
  experience,
  setExperience,
  heightDisplay,
  setHeightDisplay,
  weightDisplay,
  setWeightDisplay,
  age,
  setAge,
  trainingAge,
  setTrainingAge,
  units,
  sleepQuality,
  setSleepQuality,
  stressLevel,
  setStressLevel,
  onSave,
  isSaving,
  hasUnsavedChanges,
  onExperienceChange,
}: ProfileTabPanelProps) {
  return (
    <div className="space-y-6">
      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Control how HyperTrack looks across all your devices
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-100">Theme</p>
              <p className="text-xs text-surface-400">
                Light, dark, or match your device. Synced to your account.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>

      {/* Profile settings */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Your physical stats and training background
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Primary Goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
            options={[
              { value: 'bulk', label: 'Build Muscle (Bulk)' },
              { value: 'maintenance', label: 'Maintain / Recomp' },
              { value: 'cut', label: 'Lose Fat (Cut)' },
            ]}
            hint="Adjusts your nutrition targets and training recommendations"
          />

          <Select
            label="Experience Level"
            value={experience}
            onChange={(e) => {
              const exp = e.target.value as Experience;
              setExperience(exp);
              onExperienceChange(exp);
            }}
            options={[
              { value: 'novice', label: 'Novice (< 1 year)' },
              { value: 'intermediate', label: 'Intermediate (1-3 years)' },
              { value: 'advanced', label: 'Advanced (3+ years)' },
            ]}
            hint="Changing this will reset your volume landmarks to defaults"
          />

          <Input
            label={`Height (${units === 'lb' ? 'inches' : 'cm'})`}
            type="number"
            step="0.1"
            min={units === 'lb' ? '40' : '100'}
            max={units === 'lb' ? '96' : '250'}
            value={heightDisplay}
            onChange={(e) => setHeightDisplay(e.target.value)}
            placeholder={units === 'lb' ? 'e.g., 69' : 'e.g., 175'}
            hint="Required for FFMI and weight recommendations"
          />

          <Input
            label={`Body Weight (${units === 'lb' ? 'lbs' : 'kg'})`}
            type="number"
            step="0.1"
            min={units === 'lb' ? '66' : '30'}
            max={units === 'lb' ? '660' : '300'}
            value={weightDisplay}
            onChange={(e) => setWeightDisplay(e.target.value)}
            placeholder={units === 'lb' ? 'e.g., 175' : 'e.g., 80'}
            hint="Required for AI weight recommendations in workouts"
          />

          <Input
            label="Age"
            type="number"
            min="13"
            max="100"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="e.g., 30"
            hint="Used to adjust recovery recommendations"
          />

          <Input
            label="Training Age (years)"
            type="number"
            step="0.5"
            min="0"
            max="50"
            value={trainingAge}
            onChange={(e) => setTrainingAge(e.target.value)}
            placeholder="e.g., 2.5"
            hint="Years of consistent resistance training"
          />
        </CardContent>
      </Card>

      {/* Recovery Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Recovery Profile</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            These factors affect your volume and frequency recommendations
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-2">
              Sleep Quality
            </label>
            <div className="flex items-center gap-2">
              {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
                <button
                  key={rating}
                  onClick={() => setSleepQuality(rating)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    sleepQuality === rating
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-surface-500 mt-1">
              <span>Poor</span>
              <span>Excellent</span>
            </div>
            {sleepQuality <= 2 && (
              <p className="text-xs text-warning-400 mt-2">
                ⚠️ Poor sleep significantly impacts recovery. Volume will be reduced.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-200 mb-2">
              Life Stress Level
            </label>
            <div className="flex items-center gap-2">
              {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
                <button
                  key={rating}
                  onClick={() => setStressLevel(rating)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    stressLevel === rating
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-surface-500 mt-1">
              <span>Low stress</span>
              <span>High stress</span>
            </div>
            {stressLevel >= 4 && (
              <p className="text-xs text-warning-400 mt-2">
                ⚠️ High life stress impairs recovery. Training should be a release, not another stressor.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Athlete Mode — physiological profile fact; persists on
          toggle (not on Save) and prompts if a mesocycle is in progress */}
      <EnhancedAthleteModeCard />

      {/* Motion Capture (experimental) — off by default, persists on toggle */}
      <MotionCaptureLabCard />

      {/* Sticky Save Button with unsaved indicator */}
      <div className="sticky bottom-4 z-10">
        <div className="relative">
          {hasUnsavedChanges && !isSaving && (
            <div className="absolute -top-8 left-0 right-0 text-center">
              <span className="text-xs text-warning-400 bg-surface-900/95 px-3 py-1 rounded-full border border-warning-500/30">
                Unsaved changes
              </span>
            </div>
          )}
          <Button onClick={onSave} isLoading={isSaving} className="w-full shadow-lg">
            Save Profile Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
