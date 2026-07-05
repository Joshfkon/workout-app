'use client';

import { useState, useEffect } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { estimateE1RM, getLocalDateString } from '@/lib/utils';
import {
  getMuscleGroupProgression,
  type MuscleGroupProgression,
} from '@/services/progressionInsights';
import type { PlateauGoal } from '@/services/plateauDetector';
import type { Experience, ExercisePerformanceSnapshot } from '@/types/schema';

/** How far back to look for trend analysis (~12 weeks of sessions). */
const HISTORY_DAYS = 84;

interface SessionSetRow {
  weight_kg: number;
  reps: number;
  is_warmup: boolean | null;
}

interface SessionBlockRow {
  exercises: { id: string; name: string; primary_muscle: string | null } | null;
  set_logs: SessionSetRow[] | null;
}

interface SessionRow {
  id: string;
  completed_at: string;
  exercise_blocks: SessionBlockRow[] | null;
}

/**
 * Muscle-group progression pace (services/progressionInsights) built from
 * the last ~12 weeks of completed sessions. Bulk/cut aware: the user's
 * diet goal shifts both the plateau thresholds and the expected gain rate.
 */
export function useMuscleProgression() {
  const [groups, setGroups] = useState<MuscleGroupProgression[]>([]);
  const [exerciseNames, setExerciseNames] = useState<Map<string, string>>(new Map());
  const [goal, setGoal] = useState<PlateauGoal | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchProgression() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const since = new Date();
        since.setDate(since.getDate() - HISTORY_DAYS);

        const [profileRes, sessionsRes] = await Promise.all([
          supabase
            .from('users')
            .select('goal, experience')
            .eq('id', user.id)
            .single(),
          supabase
            .from('workout_sessions')
            .select(`
              id,
              completed_at,
              exercise_blocks!inner (
                exercises!inner (id, name, primary_muscle),
                set_logs!inner (weight_kg, reps, is_warmup)
              )
            `)
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .gte('completed_at', since.toISOString())
            .order('completed_at', { ascending: true }),
        ]);

        if (cancelled) return;

        const userGoal = (profileRes.data?.goal as PlateauGoal | null) ?? undefined;
        const experience = (profileRes.data?.experience as Experience | null) ?? 'intermediate';

        const snapshotsByExercise = new Map<string, ExercisePerformanceSnapshot[]>();
        const muscleByExercise = new Map<string, string>();
        const names = new Map<string, string>();

        ((sessionsRes.data ?? []) as SessionRow[]).forEach((session) => {
          // Aggregate working sets per exercise first — an exercise can span
          // multiple blocks in one session but should yield one snapshot.
          const setsByExercise = new Map<string, SessionSetRow[]>();
          (session.exercise_blocks ?? []).forEach((block) => {
            if (!block.exercises) return;
            const workingSets = (block.set_logs ?? []).filter(
              (s) => !s.is_warmup && s.weight_kg > 0 && s.reps > 0
            );
            if (workingSets.length === 0) return;
            const exerciseId = block.exercises.id;
            names.set(exerciseId, block.exercises.name);
            if (block.exercises.primary_muscle) {
              muscleByExercise.set(exerciseId, block.exercises.primary_muscle);
            }
            const list = setsByExercise.get(exerciseId) ?? [];
            list.push(...workingSets);
            setsByExercise.set(exerciseId, list);
          });

          const sessionDate = getLocalDateString(new Date(session.completed_at));
          setsByExercise.forEach((workingSets, exerciseId) => {
            let topE1RM = 0;
            let topWeight = 0;
            let topReps = 0;
            workingSets.forEach((set) => {
              const e1rm = estimateE1RM(set.weight_kg, set.reps);
              if (e1rm > topE1RM) {
                topE1RM = e1rm;
                topWeight = set.weight_kg;
                topReps = set.reps;
              }
            });

            const list = snapshotsByExercise.get(exerciseId) ?? [];
            list.push({
              id: `${session.id}-${exerciseId}`,
              userId: user.id,
              exerciseId,
              sessionDate,
              topSetWeightKg: topWeight,
              topSetReps: topReps,
              // RPE isn't selected here; E1RM already reflects logged
              // performance and the trend analysis only uses E1RM.
              topSetRpe: 10,
              totalWorkingSets: workingSets.length,
              estimatedE1RM: topE1RM,
            });
            snapshotsByExercise.set(exerciseId, list);
          });
        });

        const result = getMuscleGroupProgression({
          snapshotsByExercise,
          muscleByExercise,
          experience,
          referenceDate: new Date(),
          goal: userGoal,
        });

        setGroups(result);
        setExerciseNames(names);
        setGoal(userGoal);
      } catch (err) {
        console.error('Failed to load muscle progression:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchProgression();
    return () => {
      cancelled = true;
    };
  }, []);

  return { groups, exerciseNames, goal, isLoading };
}
