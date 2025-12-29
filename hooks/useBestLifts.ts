'use client';

import { useState, useEffect, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import type { UserLifts } from '@/services/measurementImbalanceEngine';

interface BestLiftRecord {
  exerciseName: string;
  weightKg: number;
  reps: number;
  estimated1rmKg: number;
  achievedAt: string;
  source: 'manual' | 'auto';
}

interface UseBestLiftsReturn {
  lifts: UserLifts;
  bestLiftRecords: BestLiftRecord[];
  isLoading: boolean;
  error: Error | null;
  refreshLifts: () => Promise<void>;
  updateLift: (exerciseName: string, weightKg: number, reps: number) => Promise<void>;
}

// Epley formula for E1RM calculation
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

// Map common exercise names to the standard lift names used by the imbalance engine
const EXERCISE_NAME_MAPPING: Record<string, keyof UserLifts> = {
  // Bench press variations
  'bench press': 'benchPressKg',
  'barbell bench press': 'benchPressKg',
  'flat bench press': 'benchPressKg',
  'bb bench press': 'benchPressKg',

  // Squat variations
  'squat': 'squatKg',
  'barbell squat': 'squatKg',
  'back squat': 'squatKg',
  'barbell back squat': 'squatKg',
  'bb squat': 'squatKg',

  // Deadlift variations
  'deadlift': 'deadliftKg',
  'conventional deadlift': 'deadliftKg',
  'barbell deadlift': 'deadliftKg',

  // Overhead press variations
  'overhead press': 'overheadPressKg',
  'ohp': 'overheadPressKg',
  'military press': 'overheadPressKg',
  'standing overhead press': 'overheadPressKg',
  'barbell overhead press': 'overheadPressKg',

  // Row variations
  'barbell row': 'rowKg',
  'bent over row': 'rowKg',
  'pendlay row': 'rowKg',
  'bb row': 'rowKg',

  // Curl variations
  'barbell curl': 'curlKg',
  'bb curl': 'curlKg',
  'standing barbell curl': 'curlKg',
  'ez bar curl': 'curlKg',
};

export function useBestLifts(userId: string): UseBestLiftsReturn {
  const [bestLiftRecords, setBestLiftRecords] = useState<BestLiftRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadLifts = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      setBestLiftRecords([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();

      // First, try to get manually entered best lifts
      const { data: manualLifts, error: manualError } = await supabase
        .from('user_best_lifts')
        .select('*')
        .eq('user_id', userId);

      if (manualError) throw manualError;

      const records: BestLiftRecord[] = [];

      // Add manual lifts
      if (manualLifts) {
        manualLifts.forEach((lift: {
          exercise_name: string;
          weight_kg: number;
          reps: number;
          estimated_1rm_kg: number;
          achieved_at: string;
          source: 'manual' | 'auto';
        }) => {
          records.push({
            exerciseName: lift.exercise_name,
            weightKg: lift.weight_kg,
            reps: lift.reps,
            estimated1rmKg: lift.estimated_1rm_kg || calculateE1RM(lift.weight_kg, lift.reps),
            achievedAt: lift.achieved_at,
            source: lift.source,
          });
        });
      }

      // Also calculate from workout history if we don't have manual entries
      // Get set logs for key exercises
      const keyExercises = Object.keys(EXERCISE_NAME_MAPPING);

      // Get set logs for key exercises - filter out nulls and warmups
      // Note: set_logs -> exercise_blocks -> workout_sessions (for user_id) -> exercises (for name)
      // Must use !inner joins to properly scope to user's completed sessions
      const { data: setLogs, error: setLogsError } = await supabase
        .from('set_logs')
        .select(`
          id,
          weight_kg,
          reps,
          logged_at,
          exercise_block:exercise_blocks!inner(
            exercise:exercises(name),
            workout_sessions!inner(
              user_id,
              state
            )
          )
        `)
        .eq('exercise_block.workout_sessions.user_id', userId)
        .eq('exercise_block.workout_sessions.state', 'completed')
        .is('is_warmup', false)
        .not('weight_kg', 'is', null)
        .not('reps', 'is', null)
        .order('logged_at', { ascending: false })
        .limit(500);
      
      if (setLogsError) {
        console.error('Error fetching set logs for best lifts:', setLogsError);
      }

      if (!setLogsError && setLogs) {
        // Calculate best E1RM for each key exercise from history
        const exerciseBests = new Map<string, BestLiftRecord>();

        setLogs.forEach((log: {
          id: string;
          weight_kg: number;
          reps: number;
          logged_at: string;
          exercise_block: {
            exercise: { name: string } | null;
            workout_sessions: {
              user_id: string;
              state: string;
            } | null;
          } | null;
        }) => {
          if (!log.exercise_block?.exercise?.name || !log.weight_kg || !log.reps) return;

          const exerciseName = log.exercise_block.exercise.name.toLowerCase();
          if (!keyExercises.includes(exerciseName)) return;

          const e1rm = calculateE1RM(log.weight_kg, log.reps);
          const existing = exerciseBests.get(exerciseName);

          if (!existing || e1rm > existing.estimated1rmKg) {
            exerciseBests.set(exerciseName, {
              exerciseName: log.exercise_block.exercise.name,
              weightKg: log.weight_kg,
              reps: log.reps,
              estimated1rmKg: e1rm,
              achievedAt: log.logged_at,
              source: 'auto',
            });
          }
        });

        // Add auto-detected lifts that don't have manual entries
        exerciseBests.forEach((lift, exerciseName) => {
          const hasManual = records.some(
            r => r.exerciseName.toLowerCase() === exerciseName && r.source === 'manual'
          );
          if (!hasManual) {
            records.push(lift);
          }
        });
      }

      setBestLiftRecords(records);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load lifts'));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadLifts();
  }, [loadLifts]);

  const updateLift = useCallback(async (
    exerciseName: string,
    weightKg: number,
    reps: number
  ) => {
    const supabase = createUntypedClient();
    const e1rm = calculateE1RM(weightKg, reps);

    const { error } = await supabase
      .from('user_best_lifts')
      .upsert({
        user_id: userId,
        exercise_name: exerciseName,
        weight_kg: weightKg,
        reps,
        estimated_1rm_kg: e1rm,
        achieved_at: new Date().toISOString().split('T')[0],
        source: 'manual',
      }, {
        onConflict: 'user_id,exercise_name',
      });

    if (!error) {
      await loadLifts();
    }
  }, [userId, loadLifts]);

  // Convert records to the UserLifts format expected by the imbalance engine
  const lifts: UserLifts = {};

  bestLiftRecords.forEach(record => {
    const normalizedName = record.exerciseName.toLowerCase();
    const liftKey = EXERCISE_NAME_MAPPING[normalizedName];

    if (liftKey) {
      const existingValue = lifts[liftKey];
      // Use the higher E1RM if multiple records exist
      if (!existingValue || record.estimated1rmKg > existingValue) {
        lifts[liftKey] = Math.round(record.estimated1rmKg * 10) / 10;
      }
    }
  });

  return {
    lifts,
    bestLiftRecords,
    isLoading,
    error,
    refreshLifts: loadLifts,
    updateLift,
  };
}

// Component for manually entering best lifts
export interface BestLiftInputProps {
  userId: string;
  exerciseName: string;
  currentValue?: number;
  onUpdate: (weightKg: number, reps: number) => Promise<void>;
}
