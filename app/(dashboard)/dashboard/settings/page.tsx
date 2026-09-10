'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient, useIsRestoring } from '@tanstack/react-query';
import { LoadingState, PageHeader } from '@/components/ui';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';

const SETTINGS_KEY = ['settings', 'user'] as const;
import { DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';
import {
  migrateStoredLandmarks,
  readLandmarkVersion,
  LANDMARK_VERSION,
  LANDMARK_VERSION_PREFERENCE_KEY,
} from '@/lib/migrations/volume-landmarks';
import type { Goal, Experience, WeightUnit, Equipment, MuscleGroup, Rating } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { getDisplayWeight, validateWeightEntry } from '@/lib/weightUtils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { updateTrainingPhase, type TrainingPhase } from '@/lib/actions/phase';
import { ProfileTabPanel } from '@/components/settings/ProfileTabPanel';
import { TrainingTabPanel } from '@/components/settings/TrainingTabPanel';
import { PreferencesTabPanel } from '@/components/settings/PreferencesTabPanel';
import { AccountTabPanel } from '@/components/settings/AccountTabPanel';

// Helper functions for unit conversion
const cmToInches = (cm: number) => cm / 2.54;
const inchesToCm = (inches: number) => inches * 2.54;
const kgToLbs = (kg: number) => kg * 2.20462;
const lbsToKg = (lbs: number) => lbs / 2.20462;

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

export default function SettingsPage() {
  const { preferences, updatePreference } = useUserPreferences();
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [goal, setGoal] = useState<Goal>('maintenance');
  // Last persisted goal — phase sync (macro settings + targets) runs only when it changes
  const [savedGoal, setSavedGoal] = useState<Goal>('maintenance');
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
  const [trackWaistInCheckin, setTrackWaistInCheckin] = useState(true);
  const [showAiCoachNotes, setShowAiCoachNotes] = useState(false);
  const [volumeLandmarks, setVolumeLandmarks] = useState(DEFAULT_VOLUME_LANDMARKS.intermediate);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Extended profile fields
  const [age, setAge] = useState('');
  const [sleepQuality, setSleepQuality] = useState<Rating>(3);
  const [stressLevel, setStressLevel] = useState<Rating>(3);
  const [trainingAge, setTrainingAge] = useState('');
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight']);
  const [injuryHistory, setInjuryHistory] = useState<MuscleGroup[]>([]);

  // Track whether initial data load is complete to prevent false dirty state
  // Use state instead of ref so it resets on component remount
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

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
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();

  // User settings row cached so returning to Settings renders instantly instead
  // of re-blocking. Moderate staleTime + refetch on tab focus keeps it fresh.
  const settingsQuery = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
      const { data: latestWeightLog } = await supabase
        .from('weight_log')
        .select('weight, unit, logged_at')
        .eq('user_id', user.id)
        .order('logged_at', { ascending: false })
        .limit(1)
        .single();
      return { userId: user.id, userRow: data, latestWeightLog };
    },
    staleTime: 1000 * 60,
    gcTime: IMMUTABLE_GC_TIME,
  });

  // Refresh helper for the visibility handler (kept as loadSettings for minimal
  // churn) — refetches the cached query.
  const loadSettings = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: SETTINGS_KEY });
  }, [queryClient]);

  // Fan the cached settings bundle into local editing state.
  useEffect(() => {
    if (settingsQuery.data === null) {
      setIsLoading(false);
      return;
    }
    if (!settingsQuery.data) return;
    {
      const { userId: uid, userRow: data, latestWeightLog } = settingsQuery.data;
      {
        setUserId(uid);

        if (data) {
          setGoal(data.goal || 'maintenance');
          setSavedGoal(data.goal || 'maintenance');
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
          // latestWeightLog comes from the cached query bundle above.
          let weightToDisplay: number | null = null;
          if (latestWeightLog) {
            // Use unified weight utility to validate and convert
            const validated = validateWeightEntry(
              Number(latestWeightLog.weight),
              latestWeightLog.unit as 'lb' | 'kg' | null
            );
            // Convert validated weight to kg for storage
            const weightKg = validated.unit === 'kg' 
              ? validated.weight 
              : validated.weight / 2.20462;
            weightToDisplay = weightKg;
            setStoredWeightKg(weightKg);
            
            // Get display weight in user's preferred unit
            const displayWeight = getDisplayWeight(
              validated.weight,
              validated.unit,
              userUnits === 'lb' ? 'lb' : 'kg'
            );
            setWeightDisplay(displayWeight.toFixed(1));
          } else if (data.weight_kg) {
            weightToDisplay = data.weight_kg;
            setStoredWeightKg(data.weight_kg);
            const displayWeight = userUnits === 'lb'
              ? kgToLbs(data.weight_kg).toFixed(1)
              : data.weight_kg.toFixed(1);
            setWeightDisplay(displayWeight);
          }
          
          if (data.preferences) {
            setRestTimer((prefs.restTimer as number) || 180);
            setShowFormCues((prefs.showFormCues as boolean) ?? true);
            setShowWarmupSuggestions((prefs.showWarmupSuggestions as boolean) ?? true);
            setPrioritizeHypertrophy((prefs.prioritizeHypertrophy as boolean) ?? true);
            setSkipPreWorkoutCheckIn((prefs.skipPreWorkoutCheckIn as boolean) ?? false);
            setTrackWaistInCheckin((prefs.trackWaistInCheckin as boolean) ?? true);
            setShowAiCoachNotes((prefs.showAiCoachNotes as boolean) ?? false);
          }
          if (data.volume_landmarks && Object.keys(data.volume_landmarks).length > 0) {
            // Merge with defaults to ensure all muscle groups have values.
            // Stored rows first go through the scalar-field landmark migration:
            // a value still equal to its old default advances, a customized
            // value is preserved, and customizing one field never pins its
            // siblings. The new version is persisted on the next save.
            const exp = (data.experience || 'intermediate') as Experience;
            const { landmarks: migrated } = migrateStoredLandmarks(
              data.volume_landmarks as Record<string, unknown>,
              exp,
              readLandmarkVersion(prefs)
            );
            setVolumeLandmarks({
              ...DEFAULT_VOLUME_LANDMARKS[exp],
              ...(migrated as any),
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
    }
    setIsLoading(false);
    // Reset unsaved changes flag when fresh data loads
    setHasUnsavedChanges(false);
  }, [settingsQuery.data]);

  // Mark initial load complete in a separate effect after state has settled
  // This prevents the dirty tracking effect from firing during initial load
  useEffect(() => {
    if (!isLoading && settingsQuery.data && !initialLoadComplete) {
      // Use setTimeout to ensure this runs after the dirty tracking effect
      const timer = setTimeout(() => {
        setInitialLoadComplete(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isLoading, settingsQuery.data, initialLoadComplete]);

  // Track changes to mark form as dirty (only after initial load completes)
  useEffect(() => {
    // Only set unsaved if initial data load is complete
    // This prevents false "unsaved changes" warning on mount
    if (initialLoadComplete && !isLoading && settingsQuery.data) {
      setHasUnsavedChanges(true);
    }
  }, [initialLoadComplete, isLoading, settingsQuery.data, goal, experience, heightDisplay, weightDisplay, age, sleepQuality, stressLevel, trainingAge, 
      availableEquipment, injuryHistory, units, restTimer, showFormCues, showWarmupSuggestions, 
      prioritizeHypertrophy, skipPreWorkoutCheckIn, trackWaistInCheckin, showAiCoachNotes, volumeLandmarks]);

  // Refresh settings when the tab regains focus (weight may have changed in
  // another tab) — refetches the cached query.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) void loadSettings();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSettings]);

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
            // Spread the loaded prefs first so keys managed elsewhere
            // (theme via useTheme, body-hub reminder settings, …) survive
            // this whole-object JSONB write.
            ...((settingsQuery.data?.userRow?.preferences as Record<string, unknown>) ?? {}),
            units,
            restTimer,
            showFormCues,
            showWarmupSuggestions,
            prioritizeHypertrophy,
            skipPreWorkoutCheckIn,
            trackWaistInCheckin,
            showAiCoachNotes,
            // Landmark migration completes HERE, on a save the user was
            // already making. `volumeLandmarks` in state has already been
            // through the read-time scalar migration, so stamping the version
            // persists exactly what the app is already using — no customized
            // field is overwritten just to record a version, and we never
            // write solely to stamp it.
            [LANDMARK_VERSION_PREFERENCE_KEY]: LANDMARK_VERSION,
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

      // Goal changed: sync the nutrition side (macro_settings.goal + targets)
      // through the unified phase action. The upsert above already wrote
      // users.goal, so the action's own profile write is a same-value no-op.
      let successText = 'Settings saved successfully!';
      if (goal !== savedGoal) {
        const phase: TrainingPhase = goal === 'recomp' ? 'maintenance' : goal;
        const phaseResult = await updateTrainingPhase(phase);
        if (phaseResult.success) {
          setSavedGoal(goal);
          // The action rewrote the training_phases spans — refetch so the
          // Body tab verdict/banner reflect the new active span.
          void queryClient.invalidateQueries({ queryKey: ['phases'] });
          if (phaseResult.newTargets) {
            successText = `Settings saved! Macro targets updated to match your new goal (${phaseResult.newTargets.calories} cal).`;
          }
        } else {
          successText = 'Settings saved, but nutrition targets could not be synced to the new goal.';
        }
      }

      setSaveMessage({ type: 'success', text: successText });
      setHasUnsavedChanges(false); // Clear unsaved flag on successful save
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExperienceChange = (exp: Experience) => {
    setVolumeLandmarks(DEFAULT_VOLUME_LANDMARKS[exp]);
  };

  // Full-screen loader only on first-ever load with an empty cache. A revisit
  // (warm cache) or reload (IndexedDB restore) renders settings immediately.
  if (isLoading && !settingsQuery.data && !isRestoring) {
    return (
      <div className="max-w-2xl mx-auto py-20" data-testid="settings-full-loading">
        <LoadingState label="Loading settings..." size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Customize your training preferences and account"
      />

      {/* Tab Navigation - Improved mobile UX */}
      <div className="flex gap-1 p-1 bg-surface-800/50 rounded-lg overflow-x-auto scrollbar-thin scrollbar-thumb-surface-600 scrollbar-track-transparent">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-primary-500 text-white shadow-lg'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
            }`}
          >
            <span className="hidden sm:inline">{tab.icon}</span>
            <span>{tab.label}</span>
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

      {/* Tab Panels */}
      {activeTab === 'profile' && (
        <ProfileTabPanel
          goal={goal}
          setGoal={setGoal}
          experience={experience}
          setExperience={setExperience}
          heightDisplay={heightDisplay}
          setHeightDisplay={setHeightDisplay}
          weightDisplay={weightDisplay}
          setWeightDisplay={setWeightDisplay}
          age={age}
          setAge={setAge}
          trainingAge={trainingAge}
          setTrainingAge={setTrainingAge}
          units={units}
          sleepQuality={sleepQuality}
          setSleepQuality={setSleepQuality}
          stressLevel={stressLevel}
          setStressLevel={setStressLevel}
          onSave={handleSave}
          isSaving={isSaving}
          hasUnsavedChanges={hasUnsavedChanges}
          onExperienceChange={handleExperienceChange}
        />
      )}

      {activeTab === 'training' && (
        <TrainingTabPanel
          userId={userId}
          availableEquipment={availableEquipment}
          setAvailableEquipment={setAvailableEquipment}
          injuryHistory={injuryHistory}
          setInjuryHistory={setInjuryHistory}
          experience={experience}
          volumeLandmarks={volumeLandmarks}
          setVolumeLandmarks={setVolumeLandmarks}
          onSave={handleSave}
          isSaving={isSaving}
          hasUnsavedChanges={hasUnsavedChanges}
        />
      )}

      {activeTab === 'preferences' && (
        <PreferencesTabPanel
          units={units}
          handleUnitsChange={handleUnitsChange}
          restTimer={restTimer}
          setRestTimer={setRestTimer}
          showFormCues={showFormCues}
          setShowFormCues={setShowFormCues}
          showWarmupSuggestions={showWarmupSuggestions}
          setShowWarmupSuggestions={setShowWarmupSuggestions}
          prioritizeHypertrophy={prioritizeHypertrophy}
          setPrioritizeHypertrophy={setPrioritizeHypertrophy}
          skipPreWorkoutCheckIn={skipPreWorkoutCheckIn}
          setSkipPreWorkoutCheckIn={setSkipPreWorkoutCheckIn}
          trackWaistInCheckin={trackWaistInCheckin}
          setTrackWaistInCheckin={setTrackWaistInCheckin}
          showAiCoachNotes={showAiCoachNotes}
          setShowAiCoachNotes={setShowAiCoachNotes}
          onSave={handleSave}
          isSaving={isSaving}
          hasUnsavedChanges={hasUnsavedChanges}
        />
      )}

      {activeTab === 'account' && <AccountTabPanel />}
    </div>
  );
}
