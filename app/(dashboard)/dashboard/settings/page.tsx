'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Slider, Badge, Toggle, LoadingAnimation, Modal } from '@/components/ui';
import { MUSCLE_GROUPS, DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';
import type { Goal, Experience, WeightUnit, Equipment, MuscleGroup, Rating } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { convertWeight } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useSubscription } from '@/hooks/useSubscription';
import { usePWA } from '@/hooks/usePWA';
import { TIER_FEATURES } from '@/lib/stripe';
import { redeemPromoCode } from '@/lib/actions/promoCodes';
import { GymEquipmentSettings } from '@/components/settings/GymEquipmentSettings';
import { ImportExportSettings } from '@/components/settings/ImportExportSettings';
import { MusclePrioritySettings } from '@/components/settings/MusclePrioritySettings';
import { AddToHomescreenGuide } from '@/components/onboarding/AddToHomescreenGuide';
import { useEducationStore } from '@/hooks/useEducationPreferences';

const ALL_EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell'];

type SettingsTab = 'profile' | 'training' | 'preferences' | 'account';

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'training',
    label: 'Training',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'account',
    label: 'Account',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

// Helper functions for unit conversion
const cmToInches = (cm: number) => cm / 2.54;
const inchesToCm = (inches: number) => inches * 2.54;
const kgToLbs = (kg: number) => kg * 2.20462;
const lbsToKg = (lbs: number) => lbs / 2.20462;

export default function SettingsPage() {
  const router = useRouter();
  const { preferences, updatePreference } = useUserPreferences();
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [goal, setGoal] = useState<Goal>('maintenance');
  const [experience, setExperience] = useState<Experience>('intermediate');
  // Store values in user's display units, convert on load/save
  const [heightDisplay, setHeightDisplay] = useState('');
  const [weightDisplay, setWeightDisplay] = useState('');
  // Keep track of the stored metric values for saving
  const [storedHeightCm, setStoredHeightCm] = useState<number | null>(null);
  const [storedWeightKg, setStoredWeightKg] = useState<number | null>(null);
  const [units, setUnits] = useState<WeightUnit>('kg');
  const [restTimer, setRestTimer] = useState(180);
  const [showFormCues, setShowFormCues] = useState(true);
  const [showWarmupSuggestions, setShowWarmupSuggestions] = useState(true);
  const [prioritizeHypertrophy, setPrioritizeHypertrophy] = useState(true);
  const [skipPreWorkoutCheckIn, setSkipPreWorkoutCheckIn] = useState(false);
  const [showAiCoachNotes, setShowAiCoachNotes] = useState(false);
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
  
  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState<{ success: boolean; message: string } | null>(null);

  // Convert display values when units change
  const handleUnitsChange = (newUnits: WeightUnit) => {
    // Convert existing display values to new units
    if (heightDisplay) {
      const heightVal = parseFloat(heightDisplay);
      if (units === 'kg' && newUnits === 'lb') {
        // cm -> inches
        setHeightDisplay(cmToInches(heightVal).toFixed(1));
      } else if (units === 'lb' && newUnits === 'kg') {
        // inches -> cm
        setHeightDisplay(inchesToCm(heightVal).toFixed(1));
      }
    }
    
    if (weightDisplay) {
      const weightVal = parseFloat(weightDisplay);
      if (units === 'kg' && newUnits === 'lb') {
        // kg -> lbs
        setWeightDisplay(kgToLbs(weightVal).toFixed(1));
      } else if (units === 'lb' && newUnits === 'kg') {
        // lbs -> kg
        setWeightDisplay(lbsToKg(weightVal).toFixed(1));
      }
    }
    
    setUnits(newUnits);
  };

  // Load settings on mount and when page becomes visible
  useEffect(() => {
    async function loadSettings() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        setUserId(user.id);
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();

        if (data) {
          setGoal(data.goal || 'maintenance');
          setExperience(data.experience || 'intermediate');
          
          // Get unit preference first
          const prefs = data.preferences as Record<string, unknown> || {};
          const userUnits = (prefs.units as WeightUnit) || 'kg';
          setUnits(userUnits);
          
          // Store metric values and convert to display units
          if (data.height_cm) {
            setStoredHeightCm(data.height_cm);
            const displayHeight = userUnits === 'lb' 
              ? cmToInches(data.height_cm).toFixed(1)
              : String(data.height_cm);
            setHeightDisplay(displayHeight);
          }
          // Load latest weight from weight_log (most recent), fallback to users.weight_kg
          const { data: latestWeightLog } = await supabase
            .from('weight_log')
            .select('weight, unit, logged_at')
            .eq('user_id', user.id)
            .order('logged_at', { ascending: false })
            .limit(1)
            .single();

          let weightToDisplay: number | null = null;
          if (latestWeightLog) {
            // Convert to kg if needed
            const weightKg = latestWeightLog.unit === 'kg' 
              ? Number(latestWeightLog.weight) 
              : Number(latestWeightLog.weight) / 2.20462; // Convert lbs to kg
            weightToDisplay = weightKg;
            setStoredWeightKg(weightKg);
          } else if (data.weight_kg) {
            weightToDisplay = data.weight_kg;
            setStoredWeightKg(data.weight_kg);
          }

          if (weightToDisplay) {
            const displayWeight = userUnits === 'lb'
              ? kgToLbs(weightToDisplay).toFixed(1)
              : weightToDisplay.toFixed(1);
            setWeightDisplay(displayWeight);
          }
          
          if (data.preferences) {
            setRestTimer((prefs.restTimer as number) || 180);
            setShowFormCues((prefs.showFormCues as boolean) ?? true);
            setShowWarmupSuggestions((prefs.showWarmupSuggestions as boolean) ?? true);
            setPrioritizeHypertrophy((prefs.prioritizeHypertrophy as boolean) ?? true);
            setSkipPreWorkoutCheckIn((prefs.skipPreWorkoutCheckIn as boolean) ?? false);
            setShowAiCoachNotes((prefs.showAiCoachNotes as boolean) ?? false);
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

    // Reload weight when page becomes visible (in case user logged weight in another tab)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadSettings();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error('Not logged in');

      // Convert display values back to metric for storage
      let heightToSave: number | null = null;
      let weightToSave: number | null = null;
      
      if (heightDisplay) {
        const heightVal = parseFloat(heightDisplay);
        heightToSave = units === 'lb' ? inchesToCm(heightVal) : heightVal;
      }
      
      if (weightDisplay) {
        const weightVal = parseFloat(weightDisplay);
        weightToSave = units === 'lb' ? lbsToKg(weightVal) : weightVal;
      }
      
      const { error } = await supabase
        .from('users')
        .upsert({
          id: user.id,
          email: user.email,
          goal,
          experience,
          height_cm: heightToSave,
          weight_kg: weightToSave,
          preferences: {
            units,
            restTimer,
            showFormCues,
            showWarmupSuggestions,
            prioritizeHypertrophy,
            skipPreWorkoutCheckIn,
            showAiCoachNotes,
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
      
      // Update global preferences so header toggle stays in sync
      if (!error) {
        updatePreference('units', units);
      }

      if (error) throw error;

      setSaveMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRedeemPromo = async () => {
    if (!promoCode.trim()) return;
    
    setPromoLoading(true);
    setPromoResult(null);
    
    try {
      const result = await redeemPromoCode(promoCode);
      setPromoResult(result);
      
      if (result.success) {
        setPromoCode('');
        // Refresh the page after a short delay to show updated subscription
        setTimeout(() => {
          router.refresh();
        }, 2000);
      }
    } catch {
      setPromoResult({ success: false, message: 'An error occurred. Please try again.' });
    } finally {
      setPromoLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col items-center justify-center py-20">
        <LoadingAnimation type="random" size="lg" />
        <p className="mt-4 text-surface-400">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Settings</h1>
        <p className="text-surface-400 mt-1">Customize your training preferences</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-surface-800/50 rounded-lg overflow-x-auto">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-primary-500 text-white shadow-lg'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
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

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <>
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

      {/* Save button for Profile tab */}
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving}>
          Save Changes
        </Button>
      </div>
        </>
      )}

      {/* Training Tab */}
      {activeTab === 'training' && (
        <>
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

      {/* Detailed Gym Equipment */}
      <GymEquipmentSettings />

      {/* Muscle Priorities */}
      {userId && (
        <Card>
          <CardHeader>
            <CardTitle>Muscle Group Priorities</CardTitle>
            <p className="text-sm text-surface-400 mt-1">
              Set training priorities for each muscle group. Higher priority muscles will receive more volume in program generation.
            </p>
          </CardHeader>
          <CardContent>
            <MusclePrioritySettings userId={userId} />
          </CardContent>
        </Card>
      )}

      {/* Volume Landmarks (moved to Training tab) */}
      <VolumeLandmarksCard
        experience={experience}
        volumeLandmarks={volumeLandmarks}
        setVolumeLandmarks={setVolumeLandmarks}
      />

      {/* Save button for Training tab */}
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving}>
          Save Changes
        </Button>
      </div>
        </>
      )}

      {/* Preferences Tab */}
      {activeTab === 'preferences' && (
        <>
      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Select
            label="Weight Units"
            value={units}
            onChange={(e) => handleUnitsChange(e.target.value as WeightUnit)}
            options={[
              { value: 'kg', label: 'Metric (kg, cm)' },
              { value: 'lb', label: 'Imperial (lbs, inches)' },
            ]}
            hint="Changes how measurements are displayed throughout the app"
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

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Show Form Cues</p>
                <p className="text-xs text-surface-500">Display exercise form tips during workouts</p>
              </div>
              <Toggle
                checked={showFormCues}
                onChange={setShowFormCues}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Show Warmup Suggestions</p>
                <p className="text-xs text-surface-500">Display warmup protocol before exercises</p>
              </div>
              <Toggle
                checked={showWarmupSuggestions}
                onChange={setShowWarmupSuggestions}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Prioritize Hypertrophy</p>
                <p className="text-xs text-surface-500">Select S-tier exercises first (Nippard methodology)</p>
              </div>
              <Toggle
                checked={prioritizeHypertrophy}
                onChange={setPrioritizeHypertrophy}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Skip Pre-Workout Check-In</p>
                <p className="text-xs text-surface-500">Start workouts immediately without readiness questions</p>
              </div>
              <Toggle
                checked={skipPreWorkoutCheckIn}
                onChange={setSkipPreWorkoutCheckIn}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">AI Coach Notes</p>
                <p className="text-xs text-surface-500">Show AI-generated coaching tips during workouts</p>
              </div>
              <Toggle
                checked={showAiCoachNotes}
                onChange={setShowAiCoachNotes}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Education & Tips */}
      <EducationPreferencesCard />

      {/* Save button for Preferences tab */}
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving}>
          Save Changes
        </Button>
      </div>
        </>
      )}

      {/* Account Tab */}
      {activeTab === 'account' && (
        <>
      {/* Install App */}
      <InstallAppCard />

      {/* Subscription Management */}
      <SubscriptionCard />

      {/* Account & Setup */}
      <Card>
        <CardHeader>
          <CardTitle>Account & Setup</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Re-run the setup wizard or manage your account
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Setup Wizard</p>
              <p className="text-xs text-surface-500">Re-run the onboarding process to update your profile</p>
            </div>
            <Link href="/onboarding">
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-run Setup
              </Button>
            </Link>
          </div>
          
          <div className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Strength Calibration</p>
              <p className="text-xs text-surface-500">Update your benchmark lifts for better weight recommendations</p>
            </div>
            <Link href="/onboarding/calibrate">
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Calibrate
              </Button>
            </Link>
          </div>

          {/* Promo Code Redemption */}
          <div className="p-4 bg-gradient-to-r from-primary-500/10 to-accent-500/10 rounded-lg border border-primary-500/20">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>
              <p className="text-sm font-medium text-surface-200">Redeem Promo Code</p>
            </div>
            <p className="text-xs text-surface-400 mb-3">Have a promo code? Enter it below to unlock premium features.</p>

            <div className="flex gap-2">
              <Input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="Enter code (e.g., FAMILY-ELITE-001)"
                className="flex-1 uppercase"
                disabled={promoLoading}
              />
              <Button
                onClick={handleRedeemPromo}
                disabled={!promoCode.trim() || promoLoading}
                isLoading={promoLoading}
              >
                Redeem
              </Button>
            </div>

            {promoResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${
                promoResult.success
                  ? 'bg-success-500/10 border border-success-500/20 text-success-400'
                  : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
              }`}>
                {promoResult.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import & Export */}
      <ImportExportSettings />
        </>
      )}
    </div>
  );
}

// Subscription Management Component
function SubscriptionCard() {
  const { 
    tier, 
    status, 
    effectiveTier, 
    isTrialing, 
    trialDaysRemaining, 
    trialEndsAt,
    currentPeriodEnd, 
    cancelAtPeriodEnd,
    openPortal,
    isLoading 
  } = useSubscription();
  
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  
  const handleManageSubscription = async () => {
    setIsOpeningPortal(true);
    try {
      const url = await openPortal();
      if (url) {
        window.location.href = url;
      }
    } finally {
      setIsOpeningPortal(false);
    }
  };
  
  const tierInfo = TIER_FEATURES[effectiveTier];
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-surface-700 rounded w-1/3" />
            <div className="h-4 bg-surface-700 rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Subscription</CardTitle>
          <Badge 
            variant={
              status === 'active' ? 'success' : 
              isTrialing ? 'warning' : 
              status === 'past_due' ? 'danger' : 
              'default'
            }
          >
            {isTrialing ? 'Trial' : status === 'active' ? 'Active' : status === 'past_due' ? 'Past Due' : 'Free'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Plan */}
        <div className="p-4 bg-surface-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-surface-400">Current Plan</span>
            <span className={`text-lg font-bold ${
              effectiveTier === 'elite' ? 'text-accent-400' :
              effectiveTier === 'pro' ? 'text-primary-400' :
              'text-surface-300'
            }`}>
              {tierInfo.name}
            </span>
          </div>
          <p className="text-xs text-surface-500">{tierInfo.description}</p>
        </div>
        
        {/* Trial Info */}
        {isTrialing && trialEndsAt && (
          <div className="p-4 bg-warning-500/10 border border-warning-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-warning-400 mb-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">Trial ends in {trialDaysRemaining} days</span>
            </div>
            <p className="text-xs text-surface-400">
              {trialEndsAt.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
        )}
        
        {/* Billing Period */}
        {status === 'active' && currentPeriodEnd && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-surface-400">
              {cancelAtPeriodEnd ? 'Access until' : 'Next billing date'}
            </span>
            <span className="text-surface-200">
              {currentPeriodEnd.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
              })}
            </span>
          </div>
        )}
        
        {cancelAtPeriodEnd && (
          <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            <p className="text-sm text-danger-400">
              Your subscription will be canceled at the end of this billing period.
            </p>
          </div>
        )}
        
        {/* Actions */}
        <div className="flex gap-3">
          {tier === 'free' && !isTrialing ? (
            <Link href="/dashboard/pricing" className="flex-1">
              <Button className="w-full" variant="primary">
                Upgrade Now
              </Button>
            </Link>
          ) : status === 'active' || isTrialing ? (
            <>
              <Button 
                variant="outline" 
                onClick={handleManageSubscription}
                isLoading={isOpeningPortal}
                className="flex-1"
              >
                Manage Subscription
              </Button>
              <Link href="/dashboard/pricing">
                <Button variant="secondary">
                  Change Plan
                </Button>
              </Link>
            </>
          ) : (
            <Link href="/dashboard/pricing" className="flex-1">
              <Button className="w-full" variant="primary">
                Reactivate
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Install App Card Component
function InstallAppCard() {
  const { pwaContext, isInstalled, installPrefs, isLoading } = usePWA();
  const [showInstructions, setShowInstructions] = useState(false);

  // Don't show if already installed as PWA
  if (isLoading || isInstalled || pwaContext?.isStandalone) {
    return null;
  }

  // Don't show if user has already completed installation
  if (installPrefs.homescreenInstallCompleted) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Install App
          </CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Add HyperTrack to your homescreen for the best experience
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary-500/10 to-accent-500/10 rounded-lg border border-primary-500/20">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-200">Quick Access</p>
                  <p className="text-xs text-surface-500">Launch instantly from your homescreen</p>
                </div>
              </div>
              <ul className="space-y-1 ml-13">
                <li className="flex items-center gap-2 text-xs text-surface-400">
                  <svg className="w-3 h-3 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Works offline after first load
                </li>
                <li className="flex items-center gap-2 text-xs text-surface-400">
                  <svg className="w-3 h-3 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Full-screen experience
                </li>
              </ul>
            </div>
            <Button onClick={() => setShowInstructions(true)} size="sm">
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              View Instructions
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Install Instructions Modal */}
      <Modal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
        title=""
        size="lg"
      >
        <AddToHomescreenGuide
          onComplete={() => setShowInstructions(false)}
          onSkip={() => setShowInstructions(false)}
          showSkipOption={false}
        />
      </Modal>
    </>
  );
}

// Experience level descriptions for the education section
const EXPERIENCE_LEVEL_INFO = {
  novice: {
    label: 'Beginner',
    sublabel: 'New to training (< 1 year)',
    description: 'More guidance, detailed explanations, and conservative recommendations',
    features: [
      'Extra tooltips and hints throughout the app',
      'Simpler exercise selections',
      'Lower starting volume (easier to recover)',
      'More detailed form cues',
    ],
  },
  intermediate: {
    label: 'Intermediate',
    sublabel: '1-3 years of training',
    description: 'Balanced guidance with room to customize',
    features: [
      'Standard tooltips for complex terms',
      'Full exercise library access',
      'Moderate volume recommendations',
      'Optional form cues',
    ],
  },
  advanced: {
    label: 'Advanced',
    sublabel: '3+ years of training',
    description: 'Minimal hand-holding, maximum flexibility',
    features: [
      'Concise interface with fewer prompts',
      'Advanced exercise variations',
      'Higher volume capacity',
      'You know what you\'re doing',
    ],
  },
} as const;

// Education Preferences Card Component
function EducationPreferencesCard() {
  const {
    showBeginnerTips,
    explainScienceTerms,
    dismissedHints,
    setShowBeginnerTips,
    setExplainScienceTerms,
    resetAllHints,
  } = useEducationStore();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [localExperience, setLocalExperience] = useState<Experience | null>(null);
  const [isLoadingExperience, setIsLoadingExperience] = useState(true);
  const [showExperienceDetails, setShowExperienceDetails] = useState(false);

  // Load experience level on mount
  useEffect(() => {
    async function loadExperience() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('users')
          .select('experience')
          .eq('id', user.id)
          .single();
        if (data?.experience) {
          setLocalExperience(data.experience as Experience);
        }
      }
      setIsLoadingExperience(false);
    }
    loadExperience();
  }, []);

  // Save experience level when changed
  const handleExperienceChange = async (newExperience: Experience) => {
    setLocalExperience(newExperience);
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('users')
        .update({ experience: newExperience })
        .eq('id', user.id);
    }
  };

  const handleResetHints = () => {
    resetAllHints();
    setShowResetConfirm(false);
  };

  const currentExperienceInfo = localExperience ? EXPERIENCE_LEVEL_INFO[localExperience] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Education & Tips
        </CardTitle>
        <p className="text-sm text-surface-400 mt-1">
          Control how the app explains features and terminology
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Experience Level Selection */}
        <div className="p-4 bg-surface-800/50 rounded-lg border border-surface-700">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-surface-200">Training Experience</p>
              <p className="text-xs text-surface-500">Adjusts guidance level throughout the app</p>
            </div>
            <button
              onClick={() => setShowExperienceDetails(!showExperienceDetails)}
              className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"
            >
              {showExperienceDetails ? 'Hide' : 'What changes?'}
              <svg
                className={`w-3 h-3 transition-transform ${showExperienceDetails ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {isLoadingExperience ? (
            <div className="h-12 bg-surface-700/50 rounded-lg animate-pulse" />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {(['novice', 'intermediate', 'advanced'] as Experience[]).map((level) => {
                const info = EXPERIENCE_LEVEL_INFO[level];
                const isSelected = localExperience === level;
                return (
                  <button
                    key={level}
                    onClick={() => handleExperienceChange(level)}
                    className={`p-3 rounded-lg text-center transition-all ${
                      isSelected
                        ? 'bg-primary-500/20 border-2 border-primary-500'
                        : 'bg-surface-700/50 border border-surface-600 hover:border-surface-500'
                    }`}
                  >
                    <p className={`text-sm font-medium ${isSelected ? 'text-primary-400' : 'text-surface-200'}`}>
                      {info.label}
                    </p>
                    <p className="text-xs text-surface-500 mt-0.5">{info.sublabel}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Expandable details about what changes */}
          {showExperienceDetails && currentExperienceInfo && (
            <div className="mt-4 pt-4 border-t border-surface-700">
              <p className="text-sm text-surface-300 mb-2">{currentExperienceInfo.description}</p>
              <ul className="space-y-1.5">
                {currentExperienceInfo.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-surface-400">
                    <svg className="w-3.5 h-3.5 text-primary-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-surface-200">Show Beginner Tips</p>
            <p className="text-xs text-surface-500">Display helpful hints when you first use features</p>
          </div>
          <Toggle
            checked={showBeginnerTips}
            onChange={setShowBeginnerTips}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-surface-200">Explain Science Terms</p>
            <p className="text-xs text-surface-500">Show tooltips for terms like MEV, RIR, FFMI, etc.</p>
          </div>
          <Toggle
            checked={explainScienceTerms}
            onChange={setExplainScienceTerms}
          />
        </div>

        {dismissedHints.length > 0 && (
          <div className="pt-4 border-t border-surface-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-200">Reset Tips</p>
                <p className="text-xs text-surface-500">
                  You&apos;ve dismissed {dismissedHints.length} tips. Reset to see them again.
                </p>
              </div>
              {showResetConfirm ? (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResetConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleResetHints}
                  >
                    Reset
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowResetConfirm(true)}
                >
                  Reset Tips
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Glossary Link */}
        <div className="pt-4 border-t border-surface-700">
          <Link
            href="/dashboard/glossary"
            className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg hover:bg-surface-700/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-surface-200">Training Glossary</p>
                <p className="text-xs text-surface-500">Look up any training term or concept</p>
              </div>
            </div>
            <svg
              className="w-5 h-5 text-surface-500 group-hover:text-primary-400 transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        <div className="p-3 bg-surface-800/50 rounded-lg">
          <p className="text-xs text-surface-400">
            <span className="text-primary-400">Tip:</span> You can always learn more about training concepts
            in the <Link href="/dashboard/learn" className="text-primary-400 hover:underline">Learn Hub</Link>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Volume Landmarks Card Component
interface VolumeLandmarksCardProps {
  experience: Experience;
  volumeLandmarks: Record<string, { mev: number; mav: number; mrv: number }>;
  setVolumeLandmarks: React.Dispatch<React.SetStateAction<Record<string, { mev: number; mav: number; mrv: number }>>>;
}

function VolumeLandmarksCard({ experience, volumeLandmarks, setVolumeLandmarks }: VolumeLandmarksCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Volume Landmarks</CardTitle>
        <p className="text-sm text-surface-400 mt-1">
          Weekly sets per muscle group (based on Dr. Mike Israetel&apos;s research)
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Explanation box */}
          <div className="p-4 bg-surface-800/50 rounded-lg border border-surface-700 space-y-3">
            <div className="flex gap-6 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-warning-500/20 border border-warning-500/40 rounded text-xs flex items-center justify-center font-medium text-warning-400">MEV</span>
                <span className="text-surface-400"><span className="font-medium text-surface-200">Minimum Effective Volume</span> — Fewest sets to maintain muscle</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-success-500/20 border border-success-500/40 rounded text-xs flex items-center justify-center font-medium text-success-400">MAV</span>
                <span className="text-surface-400"><span className="font-medium text-surface-200">Maximum Adaptive Volume</span> — Sweet spot for growth</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-danger-500/20 border border-danger-500/40 rounded text-xs flex items-center justify-center font-medium text-danger-400">MRV</span>
                <span className="text-surface-400"><span className="font-medium text-surface-200">Maximum Recoverable Volume</span> — Upper limit before overtraining</span>
              </div>
            </div>
            <p className="text-xs text-surface-500 border-t border-surface-700 pt-3">
              These values are pre-filled based on your experience level and published hypertrophy research. Adjust based on your personal recovery capacity and response.
            </p>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-4">
            <span className="w-24 text-xs text-surface-500 font-medium">Muscle</span>
            <div className="flex-1 grid grid-cols-3 gap-2 text-xs text-center">
              <span className="text-warning-400 font-medium">MEV</span>
              <span className="text-success-400 font-medium">MAV</span>
              <span className="text-danger-400 font-medium">MRV</span>
            </div>
          </div>

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
  );
}
