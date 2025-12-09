'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Slider } from '@/components/ui';
import { MUSCLE_GROUPS, DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';
import type { Goal, Experience, WeightUnit, Equipment, MuscleGroup, Rating } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';

const ALL_EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell'];

export default function SettingsPage() {
  const [goal, setGoal] = useState<Goal>('maintenance');
  const [experience, setExperience] = useState<Experience>('intermediate');
  const [heightCm, setHeightCm] = useState('');
  const [units, setUnits] = useState<WeightUnit>('kg');
  const [restTimer, setRestTimer] = useState(180);
  const [showFormCues, setShowFormCues] = useState(true);
  const [showWarmupSuggestions, setShowWarmupSuggestions] = useState(true);
  const [volumeLandmarks, setVolumeLandmarks] = useState(DEFAULT_VOLUME_LANDMARKS.intermediate);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Extended profile fields
  const [age, setAge] = useState('');
  const [sleepQuality, setSleepQuality] = useState<Rating>(3);
  const [stressLevel, setStressLevel] = useState<Rating>(3);
  const [trainingAge, setTrainingAge] = useState('');
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight']);
  const [injuryHistory, setInjuryHistory] = useState<MuscleGroup[]>([]);

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();

        if (data) {
          setGoal(data.goal || 'maintenance');
          setExperience(data.experience || 'intermediate');
          if (data.height_cm) {
            setHeightCm(String(data.height_cm));
          }
          if (data.preferences) {
            const prefs = data.preferences as any;
            setUnits(prefs.units || 'kg');
            setRestTimer(prefs.restTimer || 180);
            setShowFormCues(prefs.showFormCues ?? true);
            setShowWarmupSuggestions(prefs.showWarmupSuggestions ?? true);
          }
          if (data.volume_landmarks && Object.keys(data.volume_landmarks).length > 0) {
            // Merge with defaults to ensure all muscle groups have values
            const exp = (data.experience || 'intermediate') as Experience;
            setVolumeLandmarks({
              ...DEFAULT_VOLUME_LANDMARKS[exp],
              ...(data.volume_landmarks as any),
            });
          }
          // Extended profile fields
          if (data.age) setAge(String(data.age));
          if (data.sleep_quality) setSleepQuality(data.sleep_quality as Rating);
          if (data.stress_level) setStressLevel(data.stress_level as Rating);
          if (data.training_age !== null && data.training_age !== undefined) setTrainingAge(String(data.training_age));
          if (data.available_equipment && Array.isArray(data.available_equipment)) {
            setAvailableEquipment(data.available_equipment as Equipment[]);
          }
          if (data.injury_history && Array.isArray(data.injury_history)) {
            setInjuryHistory(data.injury_history as MuscleGroup[]);
          }
        }
      }
      setIsLoading(false);
    }
    loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error('Not logged in');

      const { error } = await supabase
        .from('users')
        .upsert({
          id: user.id,
          email: user.email,
          goal,
          experience,
          height_cm: heightCm ? parseFloat(heightCm) : null,
          preferences: {
            units,
            restTimer,
            showFormCues,
            showWarmupSuggestions,
          },
          volume_landmarks: volumeLandmarks,
          // Extended profile fields
          age: age ? parseInt(age) : null,
          sleep_quality: sleepQuality,
          stress_level: stressLevel,
          training_age: trainingAge ? parseFloat(trainingAge) : 0,
          available_equipment: availableEquipment,
          injury_history: injuryHistory,
        });

      if (error) throw error;

      setSaveMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-surface-400">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Settings</h1>
        <p className="text-surface-400 mt-1">Customize your training preferences</p>
      </div>

      {saveMessage && (
        <div className={`p-4 rounded-lg ${
          saveMessage.type === 'success' 
            ? 'bg-success-500/10 border border-success-500/20 text-success-400'
            : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
        }`}>
          {saveMessage.text}
        </div>
      )}

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

          <Input
            label="Height (cm)"
            type="number"
            step="0.1"
            min="100"
            max="250"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="e.g., 175"
            hint="Required for FFMI calculations in Body Composition"
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

      {/* Equipment & Gym */}
      <Card>
        <CardHeader>
          <CardTitle>Equipment & Gym</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Select available equipment to customize exercise selection
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-3">
              Available Equipment
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_EQUIPMENT.map((equip) => (
                <label
                  key={equip}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    availableEquipment.includes(equip)
                      ? 'bg-primary-500/10 border border-primary-500/30'
                      : 'bg-surface-800 border border-surface-700 hover:border-surface-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={availableEquipment.includes(equip)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAvailableEquipment([...availableEquipment, equip]);
                      } else {
                        setAvailableEquipment(availableEquipment.filter((e) => e !== equip));
                      }
                    }}
                    className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-surface-200 capitalize">{equip}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-200 mb-3">
              Injury History / Cautious Areas
            </label>
            <p className="text-xs text-surface-500 mb-3">
              Select muscle groups to be cautious with. The AI will avoid or modify exercises for these areas.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {MUSCLE_GROUPS.map((muscle) => (
                <label
                  key={muscle}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    injuryHistory.includes(muscle)
                      ? 'bg-warning-500/10 border border-warning-500/30'
                      : 'bg-surface-800 border border-surface-700 hover:border-surface-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={injuryHistory.includes(muscle)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setInjuryHistory([...injuryHistory, muscle]);
                      } else {
                        setInjuryHistory(injuryHistory.filter((m) => m !== muscle));
                      }
                    }}
                    className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-warning-500 focus:ring-warning-500"
                  />
                  <span className="text-sm text-surface-200 capitalize">{muscle}</span>
                </label>
              ))}
            </div>
          </div>
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
              const defaultLandmark = DEFAULT_VOLUME_LANDMARKS[experience][muscle] || { mev: 6, mav: 12, mrv: 20 };
              const landmarks = volumeLandmarks[muscle] || defaultLandmark;
              return (
                <div key={muscle} className="flex items-center gap-4">
                  <span className="w-24 text-sm text-surface-300 capitalize">{muscle}</span>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <Input
                      type="number"
                      value={landmarks.mev ?? 6}
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
                      value={landmarks.mav ?? 12}
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
                      value={landmarks.mrv ?? 20}
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
        <Button onClick={handleSave} isLoading={isSaving}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
