/**
 * suggestions.ts
 *
 * Coach-message + weight-suggestion glue for the live workout page.
 * Wraps `weightEstimationEngine` (quickWeightEstimate / withCalibration) and
 * turns raw exercise-history rows into `ExerciseHistoryData` used for
 * E1RM-anchored suggestions.
 *
 * Lifted verbatim from `page.tsx` (Phase 0.2 decomposition) — logic and copy
 * (including emoji) must not change here without a product decision.
 *
 * Follows the `sessionWrites.ts` convention: plain functions, DB reads take
 * the untyped supabase client boundary internally, everything else is pure.
 */

import { createUntypedClient } from '@/lib/supabase/client';
import {
  quickWeightEstimate,
  quickWeightEstimateWithCalibration,
  type WorkingWeightRecommendation,
} from '@/services/weightEstimationEngine';
import type {
  ExerciseBlockWithExercise,
  ExerciseHistoryData,
  UserContext,
  UserProfileForWeights,
} from './types';

// Calculate E1RM using Brzycki formula
// RPE adjusts for reps in reserve: effectiveReps = reps + (10 - rpe)
export function calculateE1RM(weight: number, reps: number, rpe: number = 10): number {
  if (reps === 1 && rpe === 10) return weight;
  // Account for reps in reserve when RPE < 10
  const effectiveReps = rpe ? reps + (10 - rpe) : reps;
  if (effectiveReps > 12) return weight * (1 + effectiveReps / 30);
  return weight * (36 / (37 - effectiveReps));
}

/** Shape of the coach message rendered in the workout page. */
export interface CoachMessage {
  greeting: string;
  overview: string;
  personalizedInsight?: string;
  exerciseNotes: { name: string; reason: string; weightRec?: WorkingWeightRecommendation }[];
  tips: string[];
}

/** Raw set-log row as returned by the exercise-history queries. */
interface HistorySetLogRow {
  weight_kg: number;
  reps: number;
  rpe: number;
  is_warmup: boolean;
  set_number: number | null;
  set_type: string | null;
  logged_at: string;
}

/** Raw exercise_blocks row (joined with workout_sessions + set_logs). */
export interface HistoryBlockRow {
  id: string;
  exercise_id: string;
  workout_sessions: {
    id: string;
    completed_at: string | null;
    state: string;
    user_id: string;
  } | null;
  set_logs: HistorySetLogRow[] | null;
}

/**
 * Compute ExerciseHistoryData from a list of history blocks for ONE exercise,
 * ordered most-recent-first. Pure.
 */
function computeHistoryFromBlocks(historyBlocks: HistoryBlockRow[]): ExerciseHistoryData {
  let bestE1RM = 0;
  let personalRecord: ExerciseHistoryData['personalRecord'] = null;
  let totalSessions = 0;
  const seenSessions = new Set<string>();

  // Get last workout data
  const lastBlock = historyBlocks[0];
  const lastSession = lastBlock.workout_sessions;
  const lastSets = (lastBlock.set_logs || [])
    // Only normal working sets, ordered by set_number — so previousSets[i] maps to
    // the prior workout's i-th working set (not a dropset/rest-pause or DB-ordering quirk).
    .filter((s) => !s.is_warmup && (s.set_type ?? 'normal') === 'normal')
    .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
    .map((s) => ({
      weightKg: s.weight_kg,
      reps: s.reps,
      rpe: s.rpe,
    }));

  // Calculate best E1RM and PR
  historyBlocks.forEach((block) => {
    const session = block.workout_sessions;
    if (session && !seenSessions.has(session.id)) {
      seenSessions.add(session.id);
      totalSessions++;
    }

    const sets = (block.set_logs || []).filter((s) => !s.is_warmup);
    sets.forEach((set) => {
      // Pass RPE to get accurate E1RM - without RPE it assumes failure (RPE 10)
      // which underestimates true strength for sets done with reps in reserve
      const e1rm = calculateE1RM(set.weight_kg, set.reps, set.rpe);
      if (e1rm > bestE1RM) {
        bestE1RM = e1rm;
        personalRecord = {
          weightKg: set.weight_kg,
          reps: set.reps,
          e1rm,
          date: session?.completed_at || set.logged_at,
        };
      }
    });
  });

  return {
    lastWorkoutDate: lastSession?.completed_at || '',
    lastWorkoutSets: lastSets,
    estimatedE1RM: bestE1RM,
    personalRecord,
    totalSessions,
  };
}

/**
 * Group the batched exercise-history query result by exercise and compute
 * per-exercise history (limited to 10 most recent blocks each). Pure.
 */
export function buildExerciseHistories(
  allHistoryBlocks: HistoryBlockRow[]
): Record<string, ExerciseHistoryData> {
  // Group results by exercise_id and limit to 10 per exercise
  const groupedByExercise: Record<string, HistoryBlockRow[]> = {};
  for (const block of allHistoryBlocks || []) {
    const exId = block.exercise_id;
    if (!groupedByExercise[exId]) groupedByExercise[exId] = [];
    if (groupedByExercise[exId].length < 10) {
      groupedByExercise[exId].push(block);
    }
  }

  const histories: Record<string, ExerciseHistoryData> = {};

  for (const [exerciseId, historyBlocks] of Object.entries(groupedByExercise)) {
    if (historyBlocks && historyBlocks.length > 0) {
      histories[exerciseId] = computeHistoryFromBlocks(historyBlocks);
    }
  }

  return histories;
}

/**
 * Fetch exercise history for a specific exercise ID.
 * Used when adding a new exercise mid-workout that wasn't in the original query.
 */
export async function fetchExerciseHistory(
  exerciseId: string,
  userId: string
): Promise<ExerciseHistoryData | null> {
  const supabase = createUntypedClient();

  const { data: historyBlocks, error } = await supabase
    .from('exercise_blocks')
    .select(`
      id,
      exercise_id,
      workout_sessions!inner (
        id,
        completed_at,
        state,
        user_id
      ),
      set_logs (
        weight_kg,
        reps,
        rpe,
        is_warmup,
        set_number,
        set_type,
        logged_at
      )
    `)
    .eq('exercise_id', exerciseId)
    .eq('workout_sessions.user_id', userId)
    .eq('workout_sessions.state', 'completed')
    .order('workout_sessions(completed_at)', { ascending: false })
    .limit(10);

  if (error || !historyBlocks || historyBlocks.length === 0) {
    return null;
  }

  return computeHistoryFromBlocks(historyBlocks as HistoryBlockRow[]);
}

// Generate coach message based on workout structure and user context
export function generateCoachMessage(
  blocks: ExerciseBlockWithExercise[],
  userProfile?: UserProfileForWeights,
  userContext?: UserContext,
  unit: 'kg' | 'lb' = 'kg',
  exerciseHistories?: Record<string, ExerciseHistoryData>
): CoachMessage {
  if (blocks.length === 0) {
    return {
      greeting: "Let's get started!",
      overview: "Your workout is ready.",
      exerciseNotes: [],
      tips: [],
    };
  }

  // Analyze workout structure
  const muscles = Array.from(new Set(blocks.map(b => b.exercise.primaryMuscle)));
  const compoundCount = blocks.filter(b => b.exercise.mechanic === 'compound').length;
  const isolationCount = blocks.filter(b => b.exercise.mechanic === 'isolation').length;
  const totalSets = blocks.reduce((sum, b) => sum + b.targetSets, 0);

  // Determine workout type
  let workoutType = '';
  if (muscles.length >= 5) workoutType = 'Full Body';
  else if (muscles.includes('chest') && muscles.includes('back')) workoutType = 'Upper Body';
  else if (muscles.includes('quads') && muscles.includes('hamstrings')) workoutType = 'Lower Body';
  else if (muscles.includes('chest') && muscles.includes('shoulders') && muscles.includes('triceps')) workoutType = 'Push';
  else if (muscles.includes('back') && muscles.includes('biceps')) workoutType = 'Pull';
  else workoutType = muscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' & ');

  // Generate greeting based on time of day and goal
  const hour = new Date().getHours();
  let timeGreeting = 'Hey';
  if (hour < 12) timeGreeting = 'Good morning';
  else if (hour < 17) timeGreeting = 'Good afternoon';
  else timeGreeting = 'Good evening';

  // Personalize greeting based on goal
  let goalPhrase = '';
  if (userContext?.goal === 'bulk') {
    goalPhrase = 'Time to build! 💪';
  } else if (userContext?.goal === 'cut') {
    goalPhrase = 'Stay strong in your cut! 🔥';
  } else if (userContext?.goal === 'recomp') {
    goalPhrase = 'Building while leaning out! 💎';
  }

  const greetings = goalPhrase
    ? [`${timeGreeting}! ${goalPhrase} Today's ${workoutType} workout is ready.`]
    : [
        `${timeGreeting}! Ready to crush this ${workoutType} session? 💪`,
        `${timeGreeting}! Today's ${workoutType} workout is designed for maximum gains.`,
        `${timeGreeting}! Let's make this ${workoutType} session count!`,
      ];

  // Generate personalized insight based on context
  let personalizedInsight: string | undefined;
  const insights: string[] = [];

  // Goal-specific insights
  if (userContext?.goal === 'bulk') {
    insights.push(`Since you're bulking, prioritize progressive overload—try to add a rep or small weight increase today.`);
    if (totalSets > 20) {
      insights.push(`High volume today (${totalSets} sets) is perfect for your bulk. Make sure you're eating enough to recover!`);
    }
  } else if (userContext?.goal === 'cut') {
    insights.push(`During your cut, maintaining intensity is key to preserving muscle. Don't drop the weight—keep it heavy, just manage volume.`);
    if (compoundCount > 2) {
      insights.push(`The compound focus helps maintain strength while in a deficit. If energy is low, prioritize these over isolation work.`);
    }
  }

  // Lagging area insights
  if (userContext?.laggingAreas && userContext.laggingAreas.length > 0) {
    const laggingMusclesInWorkout = userContext.laggingAreas.filter(area => {
      const areaLower = area.toLowerCase();
      return muscles.some(m => {
        if (areaLower.includes('arm')) return m === 'biceps' || m === 'triceps';
        if (areaLower.includes('leg')) return m === 'quads' || m === 'hamstrings' || m === 'glutes' || m === 'calves';
        if (areaLower.includes('trunk')) return m === 'chest' || m === 'back' || m === 'shoulders';
        return areaLower.includes(m);
      });
    });

    if (laggingMusclesInWorkout.length > 0) {
      insights.push(`📊 Your DEXA showed ${laggingMusclesInWorkout.join(', ')} as areas to bring up. Focus on mind-muscle connection and full ROM on those exercises today.`);
    }
  }

  // Plateau insights
  if (userContext?.recentPlateaus && userContext.recentPlateaus.length > 0) {
    const plateauExercisesInWorkout = userContext.recentPlateaus.filter(ex =>
      blocks.some(b => b.exercise.name.toLowerCase().includes(ex.toLowerCase()))
    );

    if (plateauExercisesInWorkout.length > 0) {
      insights.push(`⚠️ You've hit a plateau on ${plateauExercisesInWorkout.join(', ')}. Today, try a slightly different rep range or tempo to break through.`);
    }
  }

  // Week in mesocycle insights
  if (userContext?.weekInMesocycle) {
    if (userContext.weekInMesocycle === 1) {
      insights.push(`Week 1 of your ${userContext.mesocycleName || 'mesocycle'}—find your working weights and focus on form. Leave 2-3 reps in reserve.`);
    } else if (userContext.weekInMesocycle >= 4) {
      insights.push(`Week ${userContext.weekInMesocycle}—you should be approaching peak intensity. Push close to failure on your last sets!`);
    }
  }

  // Combine insights
  if (insights.length > 0) {
    personalizedInsight = insights.slice(0, 2).join(' ');  // Max 2 insights to avoid overwhelm
  }

  // Generate overview
  let overviewBase = `${totalSets} total sets across ${blocks.length} exercises. `;
  if (compoundCount > 0) {
    overviewBase += `Starting with ${compoundCount} compound movement${compoundCount > 1 ? 's' : ''} for strength, `;
  }
  if (isolationCount > 0) {
    overviewBase += `then ${isolationCount} isolation exercise${isolationCount > 1 ? 's' : ''} for targeted work.`;
  }

  const overviews = [overviewBase];

  // Generate exercise-specific notes
  const exerciseNotes: { name: string; reason: string; weightRec?: WorkingWeightRecommendation }[] = [];

  blocks.forEach((block, idx) => {
    const ex = block.exercise;
    const repRange = block.targetRepRange;
    const isFirst = idx === 0;
    const isCompound = ex.mechanic === 'compound';

    let reason = '';

    if (isFirst && isCompound) {
      reason = `Leading with this compound to maximize neural drive while fresh. ${repRange[0]}-${repRange[1]} reps keeps intensity high for strength gains.`;
    } else if (isCompound) {
      reason = `Heavy compound for overall ${ex.primaryMuscle} development. Rep range of ${repRange[0]}-${repRange[1]} balances strength and hypertrophy.`;
    } else if (idx >= blocks.length - 2) {
      reason = `Finishing with isolation to fully fatigue the ${ex.primaryMuscle}. Higher reps (${repRange[0]}-${repRange[1]}) for metabolic stress and pump.`;
    } else {
      reason = `Targeted ${ex.primaryMuscle} work. ${repRange[0]}-${repRange[1]} reps optimized for muscle fiber type.`;
    }

    // Add specific notes based on muscle
    if (ex.primaryMuscle === 'calves') {
      reason += ' Calves are slow-twitch dominant—higher reps with controlled tempo work best.';
    } else if (ex.primaryMuscle === 'hamstrings') {
      reason += ' Hamstrings are fast-twitch dominant—heavier loads with full stretch.';
    }

    // Get weight recommendation if user profile available
    let weightRec: WorkingWeightRecommendation | undefined;
    if (userProfile && userProfile.weightKg > 0 && userProfile.heightCm > 0) {
      try {
        // Get known E1RM from exercise history if available
        // This provides much more accurate suggestions than bodyweight-based estimation
        const exerciseHistory = exerciseHistories?.[block.exerciseId];
        const knownE1RM = exerciseHistory?.estimatedE1RM;

        // Use calibration data if available for more accurate estimates
        if (userProfile.calibratedLifts && userProfile.calibratedLifts.length > 0) {
          weightRec = quickWeightEstimateWithCalibration(
            ex.name,
            { min: repRange[0], max: repRange[1] },
            block.targetRir || 2,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent || 20,
            userProfile.experience,
            userProfile.calibratedLifts,
            userProfile.regionalData,
            unit,
            knownE1RM
          );
        } else {
          weightRec = quickWeightEstimate(
            ex.name,
            { min: repRange[0], max: repRange[1] },
            block.targetRir || 2,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent || 20,
            userProfile.experience,
            userProfile.regionalData,
            unit,
            knownE1RM
          );
        }
      } catch (e) {
        // Silently fail if weight estimation fails
      }
    }

    exerciseNotes.push({ name: ex.name, reason, weightRec });
  });

  // Generate tips based on goal and workout
  const tips: string[] = [];

  // Goal-specific tips
  if (userContext?.goal === 'cut') {
    tips.push('💡 In a cut: Keep intensity high but listen to your body. Lower energy is normal—prioritize compounds if needed.');
  } else if (userContext?.goal === 'bulk') {
    tips.push('💡 In a bulk: Push for progressive overload—even one extra rep counts toward gains!');
  }

  if (compoundCount > 0) {
    tips.push('Take full rest (2-3 min) between compound sets to maintain strength.');
  }
  if (isolationCount > 0) {
    tips.push('Shorter rest (60-90 sec) for isolation work to keep metabolic stress high.');
  }
  if (blocks.some(b => b.exercise.primaryMuscle === 'back')) {
    tips.push('Focus on initiating pulls with your elbows, not your hands—better lat activation.');
  }
  if (blocks.some(b => b.exercise.primaryMuscle === 'chest')) {
    tips.push('Squeeze at the top of each rep and control the eccentric for chest exercises.');
  }
  if (blocks.some(b => b.exercise.primaryMuscle === 'biceps' || b.exercise.primaryMuscle === 'triceps')) {
    if (userContext?.laggingAreas?.some(a => a.toLowerCase().includes('arm'))) {
      tips.push('🎯 Arms are a focus area—slow eccentrics (3 sec) boost time under tension for growth.');
    }
  }
  if (blocks.some(b => b.exercise.primaryMuscle === 'quads' || b.exercise.primaryMuscle === 'hamstrings')) {
    if (userContext?.laggingAreas?.some(a => a.toLowerCase().includes('leg'))) {
      tips.push('🎯 Legs are a focus area—full depth and controlled negatives maximize stimulus.');
    }
  }
  tips.push('Log your RPE honestly—it helps the app optimize your future workouts.');

  return {
    greeting: greetings[Math.floor(Math.random() * greetings.length)],
    overview: overviews[0],  // Use the personalized overview
    personalizedInsight,
    exerciseNotes,
    tips: tips.slice(0, 4), // Limit to 4 tips
  };
}
