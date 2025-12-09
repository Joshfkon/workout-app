'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Slider } from '@/components/ui';
import { MUSCLE_GROUPS, DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';
import type { Goal, Experience, WeightUnit } from '@/types/schema';

export default function SettingsPage() {
  const [goal, setGoal] = useState<Goal>('maintenance');
  const [experience, setExperience] = useState<Experience>('intermediate');
  const [units, setUnits] = useState<WeightUnit>('kg');
  const [restTimer, setRestTimer] = useState(180);
  const [showFormCues, setShowFormCues] = useState(true);
  const [showWarmupSuggestions, setShowWarmupSuggestions] = useState(true);
  const [volumeLandmarks, setVolumeLandmarks] = useState(DEFAULT_VOLUME_LANDMARKS.intermediate);

  const handleSave = () => {
    // In real app, save to database
    console.log('Saving settings...');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Settings</h1>
        <p className="text-surface-400 mt-1">Customize your training preferences</p>
      </div>

      {/* Profile settings */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
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
          />

          <Select
            label="Experience Level"
            value={experience}
            onChange={(e) => {
              const exp = e.target.value as Experience;
              setExperience(exp);
              setVolumeLandmarks(DEFAULT_VOLUME_LANDMARKS[exp]);
            }}
            options={[
              { value: 'novice', label: 'Novice (< 1 year)' },
              { value: 'intermediate', label: 'Intermediate (1-3 years)' },
              { value: 'advanced', label: 'Advanced (3+ years)' },
            ]}
            hint="Changing this will reset your volume landmarks to defaults"
          />
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Select
            label="Weight Units"
            value={units}
            onChange={(e) => setUnits(e.target.value as WeightUnit)}
            options={[
              { value: 'kg', label: 'Kilograms (kg)' },
              { value: 'lb', label: 'Pounds (lb)' },
            ]}
          />

          <Slider
            label="Default Rest Timer"
            min={30}
            max={300}
            step={15}
            value={restTimer}
            onChange={(e) => setRestTimer(parseInt(e.target.value))}
            valueFormatter={(v) => `${Math.floor(v / 60)}:${(v % 60).toString().padStart(2, '0')}`}
          />

          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Show Form Cues</p>
                <p className="text-xs text-surface-500">Display exercise form tips during workouts</p>
              </div>
              <button
                onClick={() => setShowFormCues(!showFormCues)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  showFormCues ? 'bg-primary-500' : 'bg-surface-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    showFormCues ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>

            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Show Warmup Suggestions</p>
                <p className="text-xs text-surface-500">Display warmup protocol before exercises</p>
              </div>
              <button
                onClick={() => setShowWarmupSuggestions(!showWarmupSuggestions)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  showWarmupSuggestions ? 'bg-primary-500' : 'bg-surface-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    showWarmupSuggestions ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Volume Landmarks */}
      <Card>
        <CardHeader>
          <CardTitle>Volume Landmarks</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Sets per week per muscle group (MEV / MAV / MRV)
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {MUSCLE_GROUPS.map((muscle) => {
              const landmarks = volumeLandmarks[muscle];
              return (
                <div key={muscle} className="flex items-center gap-4">
                  <span className="w-24 text-sm text-surface-300 capitalize">{muscle}</span>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <Input
                      type="number"
                      value={landmarks.mev}
                      onChange={(e) =>
                        setVolumeLandmarks({
                          ...volumeLandmarks,
                          [muscle]: { ...landmarks, mev: parseInt(e.target.value) || 0 },
                        })
                      }
                      className="text-center"
                    />
                    <Input
                      type="number"
                      value={landmarks.mav}
                      onChange={(e) =>
                        setVolumeLandmarks({
                          ...volumeLandmarks,
                          [muscle]: { ...landmarks, mav: parseInt(e.target.value) || 0 },
                        })
                      }
                      className="text-center"
                    />
                    <Input
                      type="number"
                      value={landmarks.mrv}
                      onChange={(e) =>
                        setVolumeLandmarks({
                          ...volumeLandmarks,
                          [muscle]: { ...landmarks, mrv: parseInt(e.target.value) || 0 },
                        })
                      }
                      className="text-center"
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 pt-2 border-t border-surface-800">
              <span className="w-24 text-xs text-surface-500">Legend</span>
              <div className="flex-1 grid grid-cols-3 gap-2 text-center text-xs text-surface-500">
                <span>MEV</span>
                <span>MAV</span>
                <span>MRV</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={handleSave}>Save Changes</Button>
      </div>
    </div>
  );
}

