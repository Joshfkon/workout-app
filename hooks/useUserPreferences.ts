'use client';

import { useState, useEffect } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import type { Goal, Experience, WeightUnit } from '@/types/schema';

interface UserPreferences {
  goal: Goal;
  experience: Experience;
  units: WeightUnit;
  heightCm: number | null;
  restTimerDefault: number;
  showFormCues: boolean;
  showWarmupSuggestions: boolean;
}

const defaultPreferences: UserPreferences = {
  goal: 'maintenance',
  experience: 'intermediate',
  units: 'kg',
  heightCm: null,
  restTimerDefault: 180,
  showFormCues: true,
  showWarmupSuggestions: true,
};

export function useUserPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPreferences() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const { data } = await supabase
            .from('users')
            .select('goal, experience, height_cm, preferences')
            .eq('id', user.id)
            .single();

          if (data) {
            const prefs = data.preferences as any || {};
            setPreferences({
              goal: data.goal || 'maintenance',
              experience: data.experience || 'intermediate',
              units: prefs.units || 'kg',
              heightCm: data.height_cm,
              restTimerDefault: prefs.restTimer || 180,
              showFormCues: prefs.showFormCues ?? true,
              showWarmupSuggestions: prefs.showWarmupSuggestions ?? true,
            });
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

  return { preferences, isLoading };
}

