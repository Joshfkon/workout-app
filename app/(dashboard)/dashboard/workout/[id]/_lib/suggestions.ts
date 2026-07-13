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
  type TransferCandidate,
  type WorkingWeightRecommendation,
} from '@/services/weightEstimationEngine';
import {
  resolveLegacyLocationAttribution,
  scopeHistorySets,
  softenOtherLocationEstimate,
  type LegacyAttribution,
  type LocatedSet,
  type ProgressionScope,
} from '@/services/progressionScope';
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
  /** Location the set was logged at (null = legacy/unknown). */
  location_id?: string | null;
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
    /** Deload sessions are excluded from suggestions (see computeHistoryFromBlocks). */
    is_deload?: boolean | null;
  } | null;
  set_logs: HistorySetLogRow[] | null;
}

/**
 * Per-exercise location-scoping config for the history read. When present, a
 * `local`-scope exercise reads only sets logged at `currentLocationId`; a
 * `global`-scope exercise (or a null location) reads full history. See
 * services/progressionScope.
 */
export interface HistoryScopeConfig {
  scope: ProgressionScope;
  currentLocationId: string | null;
  legacy?: LegacyAttribution;
}

/**
 * Narrow a set of history blocks (for one exercise) to the set logs that the
 * current location's calibration should read, per the progression scope. Drops
 * blocks left with no readable sets. Returns the (possibly softened) flags so
 * the suggestion can be labelled. Pure.
 */
function applyLocationScope(
  historyBlocks: HistoryBlockRow[],
  config: HistoryScopeConfig
): {
  blocks: HistoryBlockRow[];
  estimatedFromOtherLocation: boolean;
  calibrationNote?: string;
} {
  // Flatten every non-warmup set to a located set keyed by object identity, so
  // the scoping decision maps cleanly back onto the block structure.
  const located: LocatedSet<HistorySetLogRow>[] = [];
  for (const block of historyBlocks) {
    for (const s of block.set_logs ?? []) {
      if (s.is_warmup) continue;
      located.push({ locationId: s.location_id ?? null, set: s });
    }
  }

  const scoped = scopeHistorySets(located, config);
  if (scoped.scope === 'global') {
    return { blocks: historyBlocks, estimatedFromOtherLocation: false };
  }

  const keep = new Set<HistorySetLogRow>(scoped.sets);
  const blocks = historyBlocks
    .map((block) => ({
      ...block,
      set_logs: (block.set_logs ?? []).filter((s) => s.is_warmup || keep.has(s)),
    }))
    .filter((block) => (block.set_logs ?? []).some((s) => !s.is_warmup));

  return {
    blocks,
    estimatedFromOtherLocation: scoped.estimatedFromOtherLocation,
    calibrationNote: scoped.calibrationNote,
  };
}

/**
 * Compute ExerciseHistoryData from a list of history blocks for ONE exercise,
 * ordered most-recent-first. Pure. When `scopeConfig` is provided, the history
 * is first narrowed to the current location's calibration track (rules 4–6).
 */
function computeHistoryFromBlocks(
  historyBlocks: HistoryBlockRow[],
  scopeConfig?: HistoryScopeConfig
): ExerciseHistoryData {
  let estimatedFromOtherLocation = false;
  let calibrationNote: string | undefined;
  let scope: ProgressionScope | undefined;

  // Deload sessions are held light on purpose, so they must not anchor the
  // next session's suggestion or the estimated E1RM / PR: "last session"
  // resolves to the most recent NON-deload session (else next week anchors to
  // deload weights). Drop them before any last-session / best-set logic.
  historyBlocks = historyBlocks.filter((block) => !block.workout_sessions?.is_deload);

  if (scopeConfig) {
    scope = scopeConfig.scope;
    const scoped = applyLocationScope(historyBlocks, scopeConfig);
    historyBlocks = scoped.blocks;
    estimatedFromOtherLocation = scoped.estimatedFromOtherLocation;
    calibrationNote = scoped.calibrationNote;
  }

  // A local-scope exercise with no history at all (all blocks scoped away)
  // degrades to the empty-history shape rather than reading another location.
  if (historyBlocks.length === 0) {
    return {
      lastWorkoutDate: '',
      lastWorkoutSets: [],
      estimatedE1RM: 0,
      personalRecord: null,
      totalSessions: 0,
      progressionScope: scope,
      estimatedFromOtherLocation: false,
    };
  }

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
    // First session at a new implement: soften the seeded e1RM ~10% so the
    // suggestion is a conservative starting point, not another gym's target
    // (rule 4). Same-location history is untouched.
    estimatedE1RM: softenOtherLocationEstimate(bestE1RM, estimatedFromOtherLocation),
    personalRecord,
    totalSessions,
    progressionScope: scope,
    estimatedFromOtherLocation,
    calibrationNote,
  };
}

/**
 * Location-scoping options for the history read. Omit for the legacy (global,
 * cross-location) behavior. When present:
 *   - `currentLocationId` is the session's location,
 *   - `scopeForExercise` returns each exercise's progression scope
 *     (services/progressionScope.deriveProgressionScope),
 *   - `legacy` (optional) attributes null-location sets; derived from the
 *     blocks' own location usage when omitted.
 */
export interface HistoryScopeOptions {
  currentLocationId: string | null;
  scopeForExercise: (exerciseId: string) => ProgressionScope;
  legacy?: LegacyAttribution;
}

/**
 * Count non-warmup sets per location across the history blocks. Used both to
 * pick the most-used location for legacy attribution and to report how many
 * null-location sets the attribution touches (rule 6).
 */
function summarizeLocationUsage(blocks: HistoryBlockRow[]): {
  usageCounts: Record<string, number>;
  nullLocationSetCount: number;
} {
  const usageCounts: Record<string, number> = {};
  let nullLocationSetCount = 0;
  for (const block of blocks) {
    for (const s of block.set_logs ?? []) {
      if (s.is_warmup) continue;
      if (s.location_id) usageCounts[s.location_id] = (usageCounts[s.location_id] ?? 0) + 1;
      else nullLocationSetCount++;
    }
  }
  return { usageCounts, nullLocationSetCount };
}

/**
 * Group the batched exercise-history query result by exercise and compute
 * per-exercise history (limited to 10 most recent blocks each). Pure.
 *
 * With `scopeOptions`, each `local`-scope exercise's history is narrowed to the
 * current location's calibration track (rules 4–6); without it, behavior is the
 * legacy full-history read.
 */
export function buildExerciseHistories(
  allHistoryBlocks: HistoryBlockRow[],
  scopeOptions?: HistoryScopeOptions
): Record<string, ExerciseHistoryData> {
  // Derive legacy null-location attribution once from the whole result set
  // (most-used location wins; ties stay ambiguous → global-visible).
  let legacy: LegacyAttribution | undefined = scopeOptions?.legacy;
  if (scopeOptions && !legacy) {
    const { usageCounts, nullLocationSetCount } = summarizeLocationUsage(allHistoryBlocks || []);
    legacy = resolveLegacyLocationAttribution(usageCounts);
    if (nullLocationSetCount > 0) {
      // Report how many sets the legacy assumption touches (rule 6).
      console.info(
        `[progressionScope] ${nullLocationSetCount} null-location set(s) attributed to ` +
          (legacy.ambiguous
            ? 'no single location (ambiguous) — kept visible across all locations'
            : `most-used location ${legacy.legacyLocationId}`)
      );
    }
  }

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
      const scopeConfig: HistoryScopeConfig | undefined = scopeOptions
        ? {
            scope: scopeOptions.scopeForExercise(exerciseId),
            currentLocationId: scopeOptions.currentLocationId,
            legacy,
          }
        : undefined;
      histories[exerciseId] = computeHistoryFromBlocks(historyBlocks, scopeConfig);
    }
  }

  return histories;
}

/**
 * Fetch exercise history for a specific exercise ID.
 * Used when adding a new exercise mid-workout that wasn't in the original query.
 *
 * `scope` (optional) narrows a local-scope exercise to the current location's
 * calibration track; omit for the legacy full-history read. Legacy null-location
 * attribution is derived from this exercise's own recent rows.
 */
export async function fetchExerciseHistory(
  exerciseId: string,
  userId: string,
  scope?: { progressionScope: ProgressionScope; currentLocationId: string | null }
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
        user_id,
        is_deload
      ),
      set_logs (
        weight_kg,
        reps,
        rpe,
        is_warmup,
        set_number,
        set_type,
        logged_at,
        location_id
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

  const blocks = historyBlocks as HistoryBlockRow[];
  const scopeConfig: HistoryScopeConfig | undefined = scope
    ? {
        scope: scope.progressionScope,
        currentLocationId: scope.currentLocationId,
        legacy: resolveLegacyLocationAttribution(summarizeLocationUsage(blocks).usageCounts),
      }
    : undefined;

  return computeHistoryFromBlocks(blocks, scopeConfig);
}

// Generate coach message based on workout structure and user context
export function generateCoachMessage(
  blocks: ExerciseBlockWithExercise[],
  userProfile?: UserProfileForWeights,
  userContext?: UserContext,
  unit: 'kg' | 'lb' = 'kg',
  exerciseHistories?: Record<string, ExerciseHistoryData>,
  transferCandidates?: TransferCandidate[]
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

        // Cold-start transfer inputs: with no direct history, the engine can
        // seed this exercise from the user's logged e1RM on a related one
        // (same muscle/pattern/equipment class) instead of profile heuristics.
        const estimateOpts = {
          transferCandidates,
          targetMeta: {
            primaryMuscle: ex.primaryMuscle,
            movementPattern: ex.movementPattern,
            equipmentRequired: ex.equipmentRequired,
          },
        };

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
            knownE1RM,
            estimateOpts
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
            knownE1RM,
            estimateOpts
          );
        }
      } catch (e) {
        // Silently fail if weight estimation fails
      }
    }

    // Location-scoped calibration: a local-scope exercise with no history at
    // this gym is seeded (softened) from another location — surface that so the
    // user knows the suggestion is a starting point to calibrate today (rule 4).
    const historyForNote = exerciseHistories?.[block.exerciseId];
    if (historyForNote?.estimatedFromOtherLocation && historyForNote.calibrationNote) {
      reason += ` 📍 ${historyForNote.calibrationNote}`;
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
