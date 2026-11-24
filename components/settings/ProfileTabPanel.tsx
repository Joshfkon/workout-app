'use client';

import type { Goal, Experience, LengthUnit, Rating } from '@/types/schema';
import { Card, CardHeader, CardTitle, CardContent, Select, Input, Button } from '@/components/ui';
import { ThemeToggle } from '@/components/settings/ThemeToggle';
import { EnhancedAthleteModeCard } from '@/components/settings/EnhancedAthleteModeCard';
import { MotionCaptureLabCard } from '@/components/settings/MotionCaptureLabCard';
import { AiDataSharingCard } from '@/components/settings/AiDataSharingCard';

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
  /** Height is shown in the length unit (Settings → Preferences → Units). */
  lengthUnits: LengthUnit;
  
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
  lengthUnits,
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
          <p className="text-body text-ink-2 mt-1">
            Control how HyperTrack looks across all your devices
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-body font-medium text-ink">Theme</p>
              <p className="text-caption text-ink-2">
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
          <p className="text-body text-ink-2 mt-1">
            Your physical stats and training background
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Primary goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
            options={[
              { value: 'bulk', label: 'Build muscle (bulk)' },
              { value: 'maintenance', label: 'Maintain / recomp' },
              { value: 'cut', label: 'Lose fat (cut)' },
            ]}
            hint="Adjusts your nutrition targets and training recommendations"
          />

          <Select
            label="Experience level"
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
            label={`Height (${lengthUnits === 'in' ? 'inches' : 'cm'})`}
            type="number"
            step="0.1"
            min={lengthUnits === 'in' ? '40' : '100'}
            max={lengthUnits === 'in' ? '96' : '250'}
            value={heightDisplay}
            onChange={(e) => setHeightDisplay(e.target.value)}
            placeholder={lengthUnits === 'in' ? 'e.g., 69' : 'e.g., 175'}
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
            hint="Years of consistent resistance training. Not sure? Leave it empty and your experience level is used."
          />
        </CardContent>
      </Card>

      {/* Recovery Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Recovery profile</CardTitle>
          <p className="text-body text-ink-2 mt-1">
            These factors affect your volume and frequency recommendations
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-body font-medium text-ink mb-2">
              Sleep quality
            </label>
            <div className="flex items-center gap-2">
              {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
                <button
                  key={rating}
                  onClick={() => setSleepQuality(rating)}
                  className={`flex-1 py-2 px-3 rounded-lg text-subhead font-medium transition-colors ${
                    sleepQuality === rating
                      ? 'bg-action text-on-action'
                      : 'bg-fill text-ink-2 hover:bg-sep'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-caption text-ink-3 mt-1">
              <span>Poor</span>
              <span>Excellent</span>
            </div>
            {sleepQuality <= 2 && (
              <p className="text-caption text-status-warn mt-2">
                ⚠️ Poor sleep significantly impacts recovery. Volume will be reduced.
              </p>
            )}
          </div>

          <div>
            <label className="block text-body font-medium text-ink mb-2">
              Life stress level
            </label>
            <div className="flex items-center gap-2">
              {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
                <button
                  key={rating}
                  onClick={() => setStressLevel(rating)}
                  className={`flex-1 py-2 px-3 rounded-lg text-subhead font-medium transition-colors ${
                    stressLevel === rating
                      ? 'bg-action text-on-action'
                      : 'bg-fill text-ink-2 hover:bg-sep'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-caption text-ink-3 mt-1">
              <span>Low stress</span>
              <span>High stress</span>
            </div>
            {stressLevel >= 4 && (
              <p className="text-caption text-status-warn mt-2">
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

      {/* AI Features — third-party AI data sharing consent, persists on toggle */}
      <AiDataSharingCard />

      {/* Sticky Save Button with unsaved indicator */}
      <div className="sticky bottom-4 z-10">
        <div className="relative">
          {hasUnsavedChanges && !isSaving && (
            <div className="absolute -top-8 left-0 right-0 text-center">
              <span className="text-caption text-status-warn bg-card/95 px-3 py-1 rounded-full border border-status-warn/30">
                Unsaved changes
              </span>
            </div>
          )}
          <Button onClick={onSave} isLoading={isSaving} className="w-full shadow-lg">
            Save profile changes
          </Button>
        </div>
      </div>
    </div>
  );
}
