'use client';

/**
 * Self-contained "AI suggested workout" launcher, shared by the Train tab and
 * the /dashboard/log startup page so the suggestion flow exists in more than
 * one place (the app must never be unable to start a workout).
 *
 * Flow: "How much time do you have?" → deterministic plan preview (services/
 * suggestedWorkout — recovery + weekly volume in, MRV-capped / injury-aware /
 * joint-stress-floored picks out) → Start materializes the session via the
 * same ad-hoc create/reuse path as the blank workout (origin 'ai_suggested').
 * NOTHING is written until Start.
 *
 * Mount it only while open ({open && <SuggestedWorkoutSheet .../>}) — data
 * fetches happen on mount.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconLoader2, IconX } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { quickWeightEstimate } from '@/services/weightEstimationEngine';
import {
  buildSuggestedWorkout,
  maxExercisesForDuration,
  type SuggestedWorkoutPlan,
} from '@/services/suggestedWorkout';
import { fetchUnavailableEquipment } from '@/lib/actions/equipment';
import { getOrCreateTodaySession } from '@/app/(dashboard)/dashboard/workout/_lib/adhocSession';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import type { Experience, MuscleGroup, WarmupSet } from '@/types/schema';

interface SheetExercise {
  id: string;
  name: string;
  primary_muscle: string | null;
  mechanic: 'compound' | 'isolation' | null;
  default_rep_range: [number, number] | null;
  default_rir: number | null;
  hypertrophy_tier: string | null;
  equipment_required: string[] | null;
}

/** The users-table fields the launcher needs (estimation + injury flags). */
interface SheetProfile {
  weight_kg: number | null;
  height_cm: number | null;
  body_fat_percent: number | null;
  experience: string | null;
  injury_history: string[] | null;
}

interface SuggestedWorkoutSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Duration choices for the AI suggested workout ("How much time do you have?"). */
const AI_DURATION_CHOICES = [20, 30, 45, 60, 75, 90];

export function SuggestedWorkoutSheet({ isOpen, onClose }: SuggestedWorkoutSheetProps) {
  const router = useRouter();
  const supabase = createUntypedClient();

  const { recoveryStatus, isLoading: recoveryLoading } = useMuscleRecovery();
  const { volumeData, isLoading: volumeLoading } = useWeeklyVolume();

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [exercises, setExercises] = useState<SheetExercise[]>([]);
  const [recentExerciseIds, setRecentExerciseIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<SheetProfile | null>(null);
  const [unavailableEquipmentIds, setUnavailableEquipmentIds] = useState<string[]>([]);

  const [aiRequested, setAiRequested] = useState(false);
  const [aiDuration, setAiDuration] = useState(45);
  const [aiPlan, setAiPlan] = useState<SuggestedWorkoutPlan | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const [exercisesRes, usageRes, profileRes, unavailable] = await Promise.all([
          supabase
            .from('exercises')
            .select(
              'id, name, primary_muscle, mechanic, default_rep_range, default_rir, hypertrophy_tier, equipment_required'
            )
            .order('name'),
          supabase
            .from('exercise_blocks')
            .select('exercise_id, workout_sessions!inner(user_id, started_at)')
            .eq('workout_sessions.user_id', user.id)
            .gte('workout_sessions.started_at', ninetyDaysAgo.toISOString()),
          supabase
            .from('users')
            .select('weight_kg, height_cm, body_fat_percent, experience, injury_history')
            .eq('id', user.id)
            .single(),
          fetchUnavailableEquipment(user.id).catch(() => [] as string[]),
        ]);

        setExercises((exercisesRes.data ?? []) as SheetExercise[]);
        setProfile((profileRes.data as SheetProfile | null) ?? null);
        setUnavailableEquipmentIds(unavailable);

        // Most recent first, ties broken by usage count (same ordering the
        // log page used before this flow was extracted).
        const counts = new Map<string, number>();
        const lastDone = new Map<string, number>();
        (
          (usageRes.data ?? []) as {
            exercise_id: string;
            workout_sessions: { started_at: string };
          }[]
        ).forEach((block) => {
          counts.set(block.exercise_id, (counts.get(block.exercise_id) || 0) + 1);
          const at = new Date(block.workout_sessions.started_at).getTime();
          if (at > (lastDone.get(block.exercise_id) ?? 0)) lastDone.set(block.exercise_id, at);
        });
        setRecentExerciseIds(
          Array.from(lastDone.entries())
            .sort(
              (a, b) => b[1] - a[1] || (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0)
            )
            .map(([id]) => id)
        );
      } catch (err) {
        console.error('Failed to load suggestion data:', err);
      } finally {
        setIsLoadingData(false);
      }
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Picking a duration sets aiRequested; the plan is computed here once
  // recovery/volume/exercise data is in, sized to fit the time.
  useEffect(() => {
    if (!aiRequested || recoveryLoading || volumeLoading || isLoadingData) return;

    const volumeByMuscle = new Map(volumeData.map((v) => [v.muscleGroup, v]));
    const plan = buildSuggestedWorkout({
      muscles: recoveryStatus.map((r) => ({
        muscle: r.muscle,
        recoveryStatus: r.isReady ? 'ready' : r.recoveryPercent < 50 ? 'sore' : 'recovering',
        weeklySets: volumeByMuscle.get(r.muscle)?.totalSets ?? 0,
        targetSets: volumeByMuscle.get(r.muscle)?.landmarks.mav ?? 10,
        mrvSets: volumeByMuscle.get(r.muscle)?.landmarks.mrv,
      })),
      exercises: exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        primaryMuscle: ex.primary_muscle,
        tier: ex.hypertrophy_tier,
        mechanic: ex.mechanic,
        defaultRepRange: ex.default_rep_range,
        defaultRir: ex.default_rir,
        equipment: (ex.equipment_required ?? []).join(' ') || null,
      })),
      recentExerciseIds,
      maxExercises: maxExercisesForDuration(aiDuration),
      sessionMinutes: aiDuration,
      injuredMuscles: profile?.injury_history ?? [],
      unavailableEquipmentIds,
    });

    setAiRequested(false);
    setAiPlan(plan);
  }, [
    aiRequested,
    recoveryLoading,
    volumeLoading,
    isLoadingData,
    recoveryStatus,
    volumeData,
    exercises,
    recentExerciseIds,
    profile,
    unavailableEquipmentIds,
    aiDuration,
  ]);

  const exerciseById = useMemo(() => new Map(exercises.map((ex) => [ex.id, ex])), [exercises]);

  const handleRemovePick = (exerciseId: string) => {
    setAiPlan((plan) =>
      plan
        ? { ...plan, exercises: plan.exercises.filter((p) => p.exerciseId !== exerciseId) }
        : plan
    );
  };

  // Materialize the previewed plan: same session + block creation path as the
  // blank workout (lazy create, quickWeightEstimate, warmups on the session's
  // first exercise), with the plan's own set/rep/RIR targets.
  const handleStart = async () => {
    if (!aiPlan || aiPlan.exercises.length === 0 || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { sessionId, isNewSession } = await getOrCreateTodaySession(
        supabase,
        user.id,
        'ai_suggested'
      );

      let order = 1;
      if (!isNewSession) {
        const { data: maxOrderResult } = await supabase
          .from('exercise_blocks')
          .select('order')
          .eq('workout_session_id', sessionId)
          .order('order', { ascending: false })
          .limit(1)
          .maybeSingle();
        order = (maxOrderResult?.order || 0) + 1;
      }

      const blocks = [];
      for (const pick of aiPlan.exercises) {
        const exercise = exerciseById.get(pick.exerciseId);
        if (!exercise) continue;

        const isCompound = exercise.mechanic === 'compound';
        const repRange = pick.repRange;
        let suggestedWeight = 0;
        if (profile?.weight_kg && profile?.height_cm) {
          const weightRec = quickWeightEstimate(
            exercise.name,
            { min: repRange[0], max: repRange[1] },
            pick.targetRir,
            profile.weight_kg,
            profile.height_cm,
            profile.body_fat_percent || 20,
            (profile.experience || 'intermediate') as Experience
          );
          suggestedWeight =
            weightRec.confidence === 'find_working_weight'
              ? 0
              : weightRec.recommendedWeight || 0;
        }

        let warmupSets: WarmupSet[] = [];
        if (isNewSession && blocks.length === 0) {
          warmupSets = generateWarmupProtocol({
            workingWeight: suggestedWeight > 0 ? suggestedWeight : 60,
            exercise: {
              id: exercise.id,
              name: exercise.name,
              primaryMuscle: (exercise.primary_muscle || 'chest') as MuscleGroup,
              secondaryMuscles: [],
              mechanic: isCompound ? 'compound' : 'isolation',
              defaultRepRange: repRange,
              defaultRir: pick.targetRir,
              minWeightIncrementKg: 2.5,
              formCues: [],
              commonMistakes: [],
              equipmentRequired: [],
              setupNote: '',
              movementPattern: isCompound ? 'compound' : 'isolation',
            },
            isFirstExercise: true,
          });
        }

        blocks.push({
          workout_session_id: sessionId,
          exercise_id: exercise.id,
          order: order++,
          target_sets: pick.sets,
          target_rep_range: repRange,
          target_rir: pick.targetRir,
          target_weight_kg: suggestedWeight,
          target_rest_seconds: isCompound ? 180 : 90,
          suggestion_reason: pick.reason,
          warmup_protocol: { sets: warmupSets },
        });
      }

      if (blocks.length === 0) throw new Error('No exercises to start');

      const { error: blocksError } = await supabase.from('exercise_blocks').insert(blocks);
      if (blocksError) throw blocksError;

      router.push(`/dashboard/workout/${sessionId}?fromCreate=true`);
    } catch (err) {
      console.error('Failed to start suggested workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStarting(false);
    }
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={aiPlan ? 'Suggested workout' : 'How much time do you have?'}
    >
      {error && (
        <div className="mb-3 p-2.5 rounded-lg bg-danger-500/10 border border-danger-500/20 text-danger-400 text-xs">
          {error}
        </div>
      )}

      {!aiPlan && (
        <div className="space-y-3">
          <p className="text-[13px] text-surface-400">
            We&apos;ll size the workout to fit your time.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {AI_DURATION_CHOICES.map((mins) => (
              <button
                key={mins}
                onClick={() => {
                  setAiDuration(mins);
                  setAiRequested(true);
                }}
                disabled={aiRequested}
                className={`p-3 rounded-xl text-center border-2 transition-colors disabled:opacity-60 ${
                  aiRequested && aiDuration === mins
                    ? 'bg-primary-500/20 border-primary-500 text-primary-400'
                    : 'bg-surface-800 border-transparent text-surface-200 hover:bg-surface-700'
                }`}
              >
                <span className="block text-[15px] font-semibold">{mins}</span>
                <span className="block text-[11px] text-surface-500">min</span>
              </button>
            ))}
          </div>
          {aiRequested && (
            <p className="flex items-center gap-2 text-[13px] text-surface-400">
              <IconLoader2 size={14} className="animate-spin" aria-hidden="true" />
              Building suggestion...
            </p>
          )}
        </div>
      )}

      {aiPlan && (
        <div className="space-y-3">
          <p className="text-[13px] text-surface-300">{aiPlan.focus}</p>
          {aiPlan.isLightSession && aiPlan.exercises.length > 0 && (
            <p className="text-[11px] text-warning-400">
              Volume guardrail: staying under your weekly recoverable maximum.
            </p>
          )}
          {aiPlan.exercises.length > 0 && (
            <p className="text-[11px] text-surface-500">Sized for ~{aiDuration} minutes.</p>
          )}

          <div className="rounded-xl border border-surface-800 bg-surface-950/40 overflow-hidden">
            {aiPlan.exercises.map((pick) => {
              const exercise = exerciseById.get(pick.exerciseId);
              if (!exercise) return null;
              return (
                <div
                  key={pick.exerciseId}
                  className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-800/50 last:border-b-0"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-surface-200 truncate">
                      {exercise.name}
                    </span>
                    <span className="block text-[11px] text-surface-500">
                      {STANDARD_MUSCLE_DISPLAY_NAMES[pick.muscle] ?? pick.muscle} · {pick.sets}{' '}
                      {pick.sets === 1 ? 'set' : 'sets'} · {pick.repRange[0]}–{pick.repRange[1]}{' '}
                      reps · {pick.targetRir} RIR
                    </span>
                    <span className="block text-[11px] text-surface-500">{pick.reason}</span>
                  </span>
                  <button
                    onClick={() => handleRemovePick(pick.exerciseId)}
                    className="p-1.5 rounded-lg text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors flex-shrink-0"
                    aria-label={`Remove ${exercise.name}`}
                  >
                    <IconX size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            {aiPlan.exercises.length === 0 && (
              <p className="p-4 text-center text-xs text-surface-500">
                Nothing to suggest right now — a blank workout is always available.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <button
              onClick={handleStart}
              disabled={isStarting || aiPlan.exercises.length === 0}
              className="w-full py-2.5 rounded-lg bg-primary-500 text-white text-[13px] font-medium hover:bg-primary-600 transition-colors disabled:opacity-60"
            >
              {isStarting
                ? 'Starting...'
                : `Start workout (${aiPlan.exercises.length} ${
                    aiPlan.exercises.length === 1 ? 'exercise' : 'exercises'
                  })`}
            </button>
            <button
              onClick={() => setAiPlan(null)}
              disabled={isStarting}
              className="w-full py-2 rounded-lg text-[13px] text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-60"
            >
              Change duration
            </button>
            <button
              onClick={onClose}
              disabled={isStarting}
              className="w-full py-2 rounded-lg text-[13px] text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
