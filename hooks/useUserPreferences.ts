'use client';

import { useState, useEffect, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import type { Goal, Experience, WeightUnit } from '@/types/schema';

interface UserPreferences {
  goal: Goal;
  experience: Experience;
  units: WeightUnit;
  heightCm: number | null;
  weightKg: number | null;
  restTimerDefault: number;
  showFormCues: boolean;
  showWarmupSuggestions: boolean;
}

const defaultPreferences: UserPreferences = {
  goal: 'maintenance',
  experience: 'intermediate',
  units: 'kg',
  heightCm: null,
  weightKg: null,
  restTimerDefault: 180,
  showFormCues: true,
  showWarmupSuggestions: true,
};

// Global state to share preferences across components
let globalPreferences: UserPreferences = defaultPreferences;
let globalListeners: Set<(prefs: UserPreferences) => void> = new Set();

function notifyListeners(prefs: UserPreferences) {
  globalPreferences = prefs;
  globalListeners.forEach(listener => listener(prefs));
}

export function useUserPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(globalPreferences);
  const [isLoading, setIsLoading] = useState(true);

  // Subscribe to global updates
  useEffect(() => {
    const listener = (prefs: UserPreferences) => setPreferences(prefs);
    globalListeners.add(listener);
    return () => {
      globalListeners.delete(listener);
    };
  }, []);

  // Load preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const { data } = await supabase
            .from('users')
            .select('goal, experience, height_cm, weight_kg, preferences')
            .eq('id', user.id)
            .single();

          if (data) {
            const prefs = data.preferences as Record<string, unknown> || {};
            const newPrefs: UserPreferences = {
              goal: (data.goal as Goal) || 'maintenance',
              experience: (data.experience as Experience) || 'intermediate',
              units: (prefs.units as WeightUnit) || 'kg',
              heightCm: data.height_cm as number | null,
              weightKg: data.weight_kg as number | null,
              restTimerDefault: (prefs.restTimer as number) || 180,
              showFormCues: (prefs.showFormCues as boolean) ?? true,
              showWarmupSuggestions: (prefs.showWarmupSuggestions as boolean) ?? true,
            };
            notifyListeners(newPrefs);
          }
        }
      } catch (err) {
        console.error('Failed to load preferences:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadPreferences();
  }, []);

  // Update a single preference
  const updatePreference = useCallback(async <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return;

    // Update local state immediately for responsiveness
    const newPrefs = { ...globalPreferences, [key]: value };
    notifyListeners(newPrefs);

    // Persist to database
    try {
      if (key === 'units' || key === 'restTimerDefault' || key === 'showFormCues' || key === 'showWarmupSuggestions') {
        // These go in the preferences JSONB column
        const { data: currentUser } = await supabase
          .from('users')
          .select('preferences')
          .eq('id', user.id)
          .single();

        const currentPrefs = (currentUser?.preferences as Record<string, unknown>) || {};
        const dbKey = key === 'restTimerDefault' ? 'restTimer' : key;
        
        await supabase
          .from('users')
          .update({
            preferences: {
              ...currentPrefs,
              [dbKey]: value
            }
          })
          .eq('id', user.id);
      } else {
        // Direct columns
        const columnMap: Record<string, string> = {
          heightCm: 'height_cm',
          weightKg: 'weight_kg',
        };
        const column = columnMap[key] || key;
        
        await supabase
          .from('users')
          .update({ [column]: value })
          .eq('id', user.id);
      }
    } catch (err) {
      console.error('Failed to save preference:', err);
      // Revert on error
      notifyListeners(globalPreferences);
    }
  }, []);

  // Convenience method to toggle units
  const toggleUnits = useCallback(() => {
    const newUnit: WeightUnit = preferences.units === 'kg' ? 'lb' : 'kg';
    updatePreference('units', newUnit);
  }, [preferences.units, updatePreference]);

  return { 
    preferences, 
    isLoading, 
    updatePreference,
    toggleUnits
  };
}
