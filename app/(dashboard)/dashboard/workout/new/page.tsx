'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input, Select, LoadingAnimation } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS } from '@/types/schema';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { getLocalDateString } from '@/lib/utils';
import { getUserExercisePreferences } from '@/services/exercisePreferencesService';
import { checkExerciseSafety } from '@/lib/training/exercise-safety';
import type { UserInjury } from '@/lib/training/injury-types';
import type { Exercise as ExerciseType } from '@/services/exerciseService';

// Equipment mapping from equipmentFilter service
const EQUIPMENT_MAPPING: Record<string, string[]> = {
  // Machines
  leg_press: ['leg press', 'machine'],
  leg_extension: ['leg extension', 'machine'],
  leg_curl: ['leg curl', 'machine'],
  hack_squat: ['hack squat', 'machine'],
  smith_machine: ['smith machine', 'smith'],
  chest_press: ['chest press machine', 'machine'],
  pec_deck: ['pec deck', 'fly machine', 'machine'],
  shoulder_press_machine: ['shoulder press machine', 'machine'],
  lat_pulldown: ['lat pulldown', 'cable'],
  seated_row: ['seated row', 'cable row', 'machine'],
  cable_machine: ['cable', 'pulley'],
  assisted_dip: ['assisted'],
  preacher_curl: ['preacher'],
  calf_raise: ['calf raise machine', 'machine'],
  hip_abductor: ['hip abductor', 'hip adductor', 'machine'],
  glute_kickback: ['glute kickback', 'cable'],
  reverse_hyper: ['reverse hyper'],
  
  // Free Weights
  barbell: ['barbell', 'bar'],
  dumbbells: ['dumbbell', 'db'],
  dumbbell: ['dumbbell', 'db'],
  kettlebells: ['kettlebell', 'kb'],
  kettlebell: ['kettlebell', 'kb'],
  ez_bar: ['ez bar', 'ez curl', 'curl bar'],
  trap_bar: ['trap bar', 'hex bar'],
  
  // Benches & Racks
  flat_bench: ['flat bench', 'bench'],
  incline_bench: ['incline bench', 'incline'],
  decline_bench: ['decline bench', 'decline'],
  squat_rack: ['squat rack', 'power rack', 'rack'],
  dip_station: ['dip', 'parallel bars'],
  pull_up_bar: ['pull-up', 'pullup', 'chin-up', 'chinup'],
  
  // Other
  resistance_bands: ['band', 'resistance band'],
  trx: ['trx', 'suspension'],
  ab_wheel: ['ab wheel', 'rollout'],
  medicine_ball: ['medicine ball', 'med ball'],
  battle_ropes: ['battle ropes', 'rope'],
  landmine: ['landmine'],
  bodyweight: ['bodyweight'],
};

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  mechanic: 'compound' | 'isolation';
  hypertrophy_tier?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
}

interface CustomExerciseForm {
  name: string;
  muscle: string;
  mechanic: 'compound' | 'isolation';
}

type Goal = 'bulk' | 'cut' | 'maintain';

/**
 * Get rest period based on exercise type and user's goal
 */
function getRestPeriod(isCompound: boolean, goal: Goal): number {
  if (goal === 'cut') {
    return isCompound ? 120 : 60;  // 2min / 1min
  }
  if (goal === 'bulk') {
    return isCompound ? 180 : 90;  // 3min / 1.5min
  }
  // maintain
  return isCompound ? 150 : 75;    // 2.5min / 1.25min
}

/**
 * Estimate time for an exercise including all sets and rest
 * Returns time in minutes
 */
function estimateExerciseTime(
  isCompound: boolean, 
  goal: Goal, 
  setsCount: number,
  includeWarmup: boolean
): number {
  const restSeconds = getRestPeriod(isCompound, goal);
  const setDuration = isCompound ? 50 : 35; // seconds per working set
  
  // Working sets time: (set duration + rest) * sets, minus rest after last set
  const workingTime = (setDuration + restSeconds) * setsCount - restSeconds;
  
  // Warmup time: typically 3 sets taking about 3-4 minutes total
  const warmupTime = includeWarmup && isCompound ? 4 * 60 : 0;
  
  // Transition time between exercises
  const transitionTime = 60; // 1 minute
  
  return (workingTime + warmupTime + transitionTime) / 60;
}

/**
 * Calculate how many exercises fit in a given time
 */
function getMaxExercisesForTime(
  durationMinutes: number, 
  goal: Goal
): { compounds: number; isolations: number; total: number } {
  // Average time per exercise type (with warmup for first compound per muscle)
  const compoundWithWarmup = estimateExerciseTime(true, goal, 3, true);
  const compoundNoWarmup = estimateExerciseTime(true, goal, 3, false);
  const isolation = estimateExerciseTime(false, goal, 3, false);
  
  // Typically 1-2 muscles trained, so 1-2 warmups
  // Estimate: 50% compounds, 50% isolations
  // First compound per muscle gets warmup
  
  // Average exercise time (accounting for mix)
  // Assume 1 warmup per 3 exercises on average
  const avgCompoundTime = (compoundWithWarmup + compoundNoWarmup * 2) / 3;
  const avgIsolationTime = isolation;
  
  // 60/40 compound/isolation split
  const avgExerciseTime = avgCompoundTime * 0.5 + avgIsolationTime * 0.5;
  
  const maxExercises = Math.floor(durationMinutes / avgExerciseTime);
  
  // Split between compounds and isolations
  const compounds = Math.ceil(maxExercises * 0.5);
  const isolations = maxExercises - compounds;
  
  return { 
    compounds: Math.max(1, compounds), 
    isolations: Math.max(0, isolations), 
    total: Math.max(1, maxExercises) 
  };
}

/**
 * Get time estimate range for display
 */
function getExerciseRangeForTime(durationMinutes: number): string {
  // Use 'maintain' as middle ground for estimation
  const estimate = getMaxExercisesForTime(durationMinutes, 'maintain');
  const min = Math.max(1, estimate.total - 1);
  const max = estimate.total + 1;
  return `${min}-${max}`;
}

function NewWorkoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateName = searchParams.get('template');
  const templateMuscles = searchParams.get('muscles');
  const aiMode = searchParams.get('ai') === 'true';
  
  const [step, setStep] = useState(templateMuscles ? 2 : 1); // Skip to step 2 if template
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>(
    templateMuscles ? templateMuscles.split(',') : []
  );
  const [selectedExercises, setSelectedExercises] = useState<string[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [frequentExerciseIds, setFrequentExerciseIds] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<{ 
    muscles: string[]; 
    exercises: string[]; 
    reason: string;
    detailedExplanations?: Array<{ exerciseId: string; exerciseName: string; explanation: string }>;
    skippedMuscles?: Array<{ muscle: string; reason: string }>;
  } | null>(null);
  const [showExplanations, setShowExplanations] = useState(false);
  
  // Search filter for exercises
  const [exerciseSearch, setExerciseSearch] = useState('');
  
  // Workout duration
  const [workoutDuration, setWorkoutDuration] = useState(45); // Default 45 minutes
  
  // Gym location selection
  const [gymLocations, setGymLocations] = useState<Array<{ id: string; name: string; is_default: boolean }>>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [isLoadingLocations, setIsLoadingLocations] = useState(true);
  
  // Custom exercise modal state
  const [showCustomExerciseModal, setShowCustomExerciseModal] = useState(false);
  const [customExerciseForm, setCustomExerciseForm] = useState<CustomExerciseForm>({
    name: '',
    muscle: '',
    mechanic: 'compound',
  });
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customExerciseError, setCustomExerciseError] = useState<string | null>(null);

  // Suggest exercises based on recent history, goals, AND time available
  // COMPREHENSIVE VERSION: Addresses all 8 identified issues
  const suggestExercises = async () => {
    setIsSuggesting(true);
    setError(null); // Clear any previous errors
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be logged in to get workout suggestions.');
        setIsSuggesting(false);
        return;
      }
      
      // ============================================
      // STEP 1: FETCH ALL REQUIRED DATA
      // ============================================
      
      // Get user's goal and equipment
      let userGoal: Goal = 'maintain';
      try {
        const { data: userProfile, error: profileError } = await supabase
          .from('user_profiles')
          .select('goal')
          .eq('user_id', user.id)
          .single();
        
        if (!profileError && userProfile?.goal) {
          userGoal = userProfile.goal as Goal;
        }
      } catch (err) {
        console.warn('user_profiles table not found or error:', err);
        // Continue with default goal
      }
      
      const { data: userData } = await supabase
        .from('users')
        .select('available_equipment, injury_history')
        .eq('id', user.id)
        .single();
      
      // Get equipment availability from selected location
      let availableEquipment: string[] = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
      
      console.log('[EQUIPMENT FILTER DEBUG] Starting equipment load for location:', selectedLocationId);
      
      if (selectedLocationId && selectedLocationId !== 'fallback') {
        try {
          // Load equipment for the selected location
          console.log('[EQUIPMENT FILTER DEBUG] Fetching equipment for location_id:', selectedLocationId, 'user_id:', user.id);
          const { data: locationEquipment, error: equipmentError } = await supabase
            .from('user_equipment')
            .select('equipment_id, is_available')
            .eq('user_id', user.id)
            .eq('location_id', selectedLocationId)
            .eq('is_available', true);
          
          console.log('[EQUIPMENT FILTER DEBUG] Raw location equipment from DB:', locationEquipment);
          console.log('[EQUIPMENT FILTER DEBUG] Equipment error:', equipmentError);
          
          if (equipmentError) {
            console.warn('[EQUIPMENT FILTER DEBUG] Error loading location equipment:', equipmentError);
            // Fall through to use general equipment
            availableEquipment = (userData?.available_equipment as string[]) || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
            console.log('[EQUIPMENT FILTER DEBUG] Using fallback equipment:', availableEquipment);
          } else if (locationEquipment && locationEquipment.length > 0) {
            // Get equipment type names from equipment_types table
            const equipmentIds = locationEquipment.map((eq: any) => eq.equipment_id);
            console.log('[EQUIPMENT FILTER DEBUG] Equipment IDs from user_equipment:', equipmentIds);
            
            const { data: equipmentTypes, error: typesError } = await supabase
              .from('equipment_types')
              .select('id, name')
              .in('id', equipmentIds);
            
            console.log('[EQUIPMENT FILTER DEBUG] Equipment types from DB:', equipmentTypes);
            console.log('[EQUIPMENT FILTER DEBUG] Types error:', typesError);
            
            if (!typesError && equipmentTypes && equipmentTypes.length > 0) {
              // Map equipment IDs to names and expand using EQUIPMENT_MAPPING
              const equipmentNames = new Set<string>();
              equipmentTypes.forEach((et: any) => {
                const name = et.name.toLowerCase();
                equipmentNames.add(name);
                console.log('[EQUIPMENT FILTER DEBUG] Processing equipment:', et.id, '->', name);
                
                // Also add mapped variations (e.g., 'dumbbells' -> ['dumbbell', 'db'])
                const mapping = EQUIPMENT_MAPPING[et.id] || EQUIPMENT_MAPPING[name];
                if (mapping) {
                  console.log('[EQUIPMENT FILTER DEBUG] Found mapping for', name, ':', mapping);
                  mapping.forEach((variant: string) => equipmentNames.add(variant.toLowerCase()));
                } else {
                  console.log('[EQUIPMENT FILTER DEBUG] No mapping found for', et.id, 'or', name);
                }
              });
              
              availableEquipment = Array.from(equipmentNames);
              console.log('[EQUIPMENT FILTER DEBUG] Final available equipment (expanded):', availableEquipment);
            } else {
              // If equipment_types lookup fails, try using equipment_id directly
              // and expand using EQUIPMENT_MAPPING
              const equipmentNames = new Set<string>();
              equipmentIds.forEach((id: string) => {
                const idLower = id.toLowerCase();
                equipmentNames.add(idLower);
                
                // Expand using mapping
                const mapping = EQUIPMENT_MAPPING[id] || EQUIPMENT_MAPPING[idLower];
                if (mapping) {
                  mapping.forEach((variant: string) => equipmentNames.add(variant.toLowerCase()));
                }
              });
              
              availableEquipment = Array.from(equipmentNames);
              console.warn('Could not map equipment types, using IDs with mapping:', availableEquipment);
            }
          } else {
            // No equipment found for location, use general preference
            availableEquipment = (userData?.available_equipment as string[]) || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
          }
        } catch (err) {
          console.warn('Error processing location equipment:', err);
          // Fall through to use general equipment
          availableEquipment = (userData?.available_equipment as string[]) || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
        }
      } else {
        // Fallback to user's general equipment preference
        availableEquipment = (userData?.available_equipment as string[]) || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
      }
      
      console.log('Final availableEquipment for filtering:', availableEquipment);
      console.log('Selected location ID:', selectedLocationId);
      
      // Get active injuries from multiple sources
      const activeInjuries: UserInjury[] = [];
      
      // Try to get injuries from the most recent workout session's pre_workout_check_in
      try {
        const { data: recentSession, error: sessionError } = await supabase
          .from('workout_sessions')
          .select('pre_workout_check_in')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .single();
        
        if (!sessionError && recentSession?.pre_workout_check_in) {
          const checkIn = recentSession.pre_workout_check_in as any;
          if (checkIn.temporaryInjuries && Array.isArray(checkIn.temporaryInjuries)) {
            checkIn.temporaryInjuries.forEach((inj: any) => {
              if (inj.isActive !== false) {
                activeInjuries.push({
                  id: inj.id || '',
                  injuryTypeId: inj.area || inj.injuryTypeId || '',
                  severity: (inj.severity as any) || 'moderate',
                  isActive: true,
                  startDate: new Date(inj.startDate || Date.now()),
                  affectedSide: inj.affectedSide,
                });
              }
            });
          }
        }
      } catch (err) {
        console.warn('Error fetching injuries from workout session:', err);
        // Continue without injury data from sessions
      }
      
      // Also check user's injury_history if available
      if (userData?.injury_history && Array.isArray(userData.injury_history) && userData.injury_history.length > 0) {
        // Convert injury_history (array of muscle groups) to UserInjury format
        // This is a simplified conversion - you may need to adjust based on your schema
        userData.injury_history.forEach((muscleGroup: string) => {
          // Only add if not already in activeInjuries
          if (!activeInjuries.some(inj => inj.injuryTypeId === muscleGroup)) {
            activeInjuries.push({
              id: `history-${muscleGroup}`,
              injuryTypeId: muscleGroup,
              severity: 'moderate' as any, // Default severity
              isActive: true,
              startDate: new Date(), // Unknown start date from history
            });
          }
        });
      }
      
      // Get exercise preferences (exclude archived and do_not_suggest)
      const exercisePreferences = await getUserExercisePreferences(user.id);
      const excludedExerciseIds = new Set<string>();
      exercisePreferences.forEach((pref, exerciseId) => {
        if (pref.status === 'archived' || pref.status === 'do_not_suggest') {
          excludedExerciseIds.add(exerciseId);
        }
      });
      
      // Get recent exercises (last 4 days) for recency penalty
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
      
      const { data: recentExerciseBlocks } = await supabase
        .from('exercise_blocks')
        .select(`
          exercise_id,
          workout_sessions!inner(user_id, completed_at)
        `)
        .eq('workout_sessions.user_id', user.id)
        .gte('workout_sessions.completed_at', fourDaysAgo.toISOString())
        .eq('workout_sessions.state', 'completed');
      
      const recentlyDoneIds = new Set<string>();
      recentExerciseBlocks?.forEach((block: any) => {
        if (block.exercise_id) recentlyDoneIds.add(block.exercise_id);
      });
      
      // Get recent workouts (last 7 days) for muscle volume tracking
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const { data: recentWorkouts } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          completed_at,
          exercise_blocks (
            exercise_id,
            exercises (
              primary_muscle,
              secondary_muscles
            )
          )
        `)
        .eq('user_id', user.id)
        .gte('completed_at', weekAgo.toISOString())
        .eq('state', 'completed');
      
      // Count trained muscles (with secondary muscle credit)
      const trainedMuscles: Record<string, number> = {};
      const muscleLastTrained: Record<string, Date | null> = {};
      
      recentWorkouts?.forEach((workout: any) => {
        const workoutDate = new Date(workout.completed_at);
        (workout.exercise_blocks || []).forEach((block: any) => {
          const primaryMuscle = block.exercises?.primary_muscle;
          const secondaryMuscles = block.exercises?.secondary_muscles || [];
          
          if (primaryMuscle) {
            trainedMuscles[primaryMuscle] = (trainedMuscles[primaryMuscle] || 0) + 1;
            const existing = muscleLastTrained[primaryMuscle];
            if (!existing || workoutDate > existing) {
              muscleLastTrained[primaryMuscle] = workoutDate;
            }
          }
          
          secondaryMuscles.forEach((secondaryMuscle: string) => {
            const secondaryMuscleLower = secondaryMuscle.toLowerCase();
            trainedMuscles[secondaryMuscleLower] = (trainedMuscles[secondaryMuscleLower] || 0) + 0.5;
          });
        });
      });
      
      // ============================================
      // STEP 2: RANK MUSCLES BY NEED
      // ============================================
      
      const allMuscles = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'biceps', 'triceps', 'glutes', 'calves', 'abs'];
      const opposingMuscles: Record<string, string> = {
        'biceps': 'triceps',
        'triceps': 'biceps',
        'chest': 'back',
        'back': 'chest',
        'quads': 'hamstrings',
        'hamstrings': 'quads',
      };
      
      const sortedMuscles = allMuscles.sort((a, b) => {
        const aCount = trainedMuscles[a] || 0;
        const bCount = trainedMuscles[b] || 0;
        
        // Priority 1: Completely untrained (0 sets) beats partially trained
        if (aCount === 0 && bCount > 0) return -1;
        if (bCount === 0 && aCount > 0) return 1;
        
        // Priority 2: Opposing muscle balance (FIXED LOGIC)
        // If comparing biceps (a) vs triceps (b), and biceps are at 0 while triceps are trained, prioritize biceps
        const aOpposing = opposingMuscles[a];
        const bOpposing = opposingMuscles[b];
        
        if (aOpposing === b && aCount === 0 && bCount > 0) {
          return -1; // Prioritize untrained 'a' (biceps) over trained 'b' (triceps)
        }
        if (bOpposing === a && bCount === 0 && aCount > 0) {
          return 1; // Prioritize untrained 'b' over trained 'a'
        }
        
        // Priority 3: Least trained overall
        if (aCount !== bCount) return aCount - bCount;
        
        // Priority 4: Recovery time
        const aLastTrained = muscleLastTrained[a];
        const bLastTrained = muscleLastTrained[b];
        if (aLastTrained && bLastTrained) {
          return aLastTrained.getTime() - bLastTrained.getTime();
        }
        if (aLastTrained && !bLastTrained) return 1;
        if (!aLastTrained && bLastTrained) return -1;
        
        return 0;
      });
      
      const muscleCount = workoutDuration <= 30 ? 2 : workoutDuration <= 45 ? 2 : 3;
      const suggestedMuscles = sortedMuscles.slice(0, muscleCount);
      
      // ============================================
      // STEP 3: FETCH AND FILTER EXERCISES
      // ============================================
      
      const { data: exercisesData } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, mechanic, hypertrophy_tier, movement_pattern, equipment_required')
        .in('primary_muscle', suggestedMuscles)
        .order('name');
      
      if (!exercisesData || exercisesData.length === 0) {
        setError('No exercises found for suggested muscles');
        return;
      }
      
      // Filter by preferences (exclude archived and do_not_suggest)
      let candidateExercises = exercisesData.filter((e: any) => !excludedExerciseIds.has(e.id));
      
      // Filter by equipment availability (basic equipment types)
      // Normalize equipment names for comparison (case-insensitive, handle variations)
      const normalizedAvailable = availableEquipment.map((eq: string) => eq.toLowerCase().trim());
      console.log('[EQUIPMENT FILTER DEBUG] Normalized available equipment for filtering:', normalizedAvailable);
      console.log('[EQUIPMENT FILTER DEBUG] Total exercises before filtering:', candidateExercises.length);
      
      const filteredOut: Array<{ name: string; equipment: string[]; reason: string }> = [];
      const filteredIn: Array<{ name: string; equipment: string[]; matchedWith: string }> = [];
      
      candidateExercises = candidateExercises.filter((e: any) => {
        if (!e.equipment_required || e.equipment_required.length === 0) {
          filteredIn.push({ name: e.name, equipment: [], matchedWith: 'no equipment required' });
          return true;
        }
        
        // Check if ANY required equipment is available (OR logic)
        // Most exercises can be done with alternative equipment (e.g., dumbbell OR barbell)
        const requiredEquipment = e.equipment_required.map((eq: string) => eq.toLowerCase().trim());
        let matchedEquipment: string | null = null;
        
        const anyAvailable = requiredEquipment.some((reqEq: string) => {
          // Direct match
          if (normalizedAvailable.includes(reqEq)) {
            matchedEquipment = reqEq;
            return true;
          }
          
          // Partial match (e.g., "cable" matches "cable machine")
          // But be more strict - only match if the available equipment contains the required term
          const partialMatch = normalizedAvailable.find((avail: string) => {
            // Check if available equipment name contains the required equipment name
            // OR if required equipment name contains available equipment name (for cases like "bench" matching "flat bench")
            return avail.includes(reqEq) || reqEq.includes(avail);
          });
          
          if (partialMatch) {
            matchedEquipment = `${reqEq} (matched with ${partialMatch})`;
            return true;
          }
          
          return false;
        });
        
        if (anyAvailable) {
          filteredIn.push({ name: e.name, equipment: requiredEquipment, matchedWith: matchedEquipment || 'unknown' });
        } else {
          filteredOut.push({ 
            name: e.name, 
            equipment: requiredEquipment, 
            reason: `None of [${requiredEquipment.join(', ')}] matches available [${normalizedAvailable.join(', ')}]` 
          });
        }
        
        return anyAvailable;
      });
      
      console.log(`[EQUIPMENT FILTER DEBUG] Filtered ${candidateExercises.length} exercises (from ${exercisesData.length} total)`);
      
      // Log exercise names explicitly for easier debugging
      console.log('[EQUIPMENT FILTER DEBUG] Exercises that PASSED (name + equipment + matched):');
      filteredIn.forEach(f => {
        console.log(`  ✓ ${f.name} | requires: [${f.equipment.join(', ')}] | matched: ${f.matchedWith}`);
      });
      
      console.log('[EQUIPMENT FILTER DEBUG] Exercises that FAILED (name + equipment + reason):');
      filteredOut.forEach(f => {
        console.log(`  ✗ ${f.name} | requires: [${f.equipment.join(', ')}] | ${f.reason}`);
      });
      
      // Specifically check for cable/barbell/machine exercises that shouldn't pass
      const problematicExercises = filteredIn.filter(f => {
        const requiresCable = f.equipment.some(eq => eq.includes('cable'));
        const requiresBarbell = f.equipment.some(eq => eq.includes('barbell') && !eq.includes('dumbbell'));
        const requiresMachine = f.equipment.some(eq => eq.includes('machine') && !f.matchedWith.includes('machine'));
        
        if (requiresCable && !f.matchedWith.includes('cable')) return true;
        if (requiresBarbell && !f.matchedWith.includes('barbell') && !f.matchedWith.includes('dumbbell')) return true;
        if (requiresMachine && !f.matchedWith.includes('machine')) return true;
        
        return false;
      });
      
      if (problematicExercises.length > 0) {
        console.warn('[EQUIPMENT FILTER DEBUG] ⚠️ WARNING: Exercises requiring unavailable equipment incorrectly passed:');
        problematicExercises.forEach(p => {
          console.warn(`  ⚠️ ${p.name} requires [${p.equipment.join(', ')}] but matched with: ${p.matchedWith}`);
        });
      }
      
      // Additional filtering by equipment_types (if location is selected and not fallback)
      if (selectedLocationId && selectedLocationId !== 'fallback') {
        // Get unavailable equipment IDs for this location
        const { data: unavailableEquipment } = await supabase
          .from('user_equipment')
          .select('equipment_id')
          .eq('user_id', user.id)
          .eq('location_id', selectedLocationId)
          .eq('is_available', false);
        
        if (unavailableEquipment && unavailableEquipment.length > 0) {
          const unavailableIds = new Set(unavailableEquipment.map((eq: any) => eq.equipment_id));
          
          // Get equipment_types to check which exercises require unavailable equipment
          const { data: equipmentTypes } = await supabase
            .from('equipment_types')
            .select('id, name')
            .in('id', Array.from(unavailableIds));
          
          if (equipmentTypes) {
            const unavailableNames = new Set<string>(equipmentTypes.map((et: any) => String(et.name).toLowerCase()));
            
            // Filter out exercises that require unavailable equipment
            candidateExercises = candidateExercises.filter((e: any) => {
              // Check if exercise name or equipment_required mentions unavailable equipment
              const exerciseNameLower = String(e.name).toLowerCase();
              const unavailableNamesArray = Array.from(unavailableNames);
              const hasUnavailable = unavailableNamesArray.some((name: string) => 
                exerciseNameLower.includes(name)
              );
              
              if (hasUnavailable) return false;
              
              // Also check equipment_required array
              if (e.equipment_required) {
                const hasUnavailableInRequired = e.equipment_required.some((req: string) => 
                  unavailableNamesArray.some((name: string) => String(req).toLowerCase().includes(name))
                );
                if (hasUnavailableInRequired) return false;
              }
              
              return true;
            });
          }
        }
      }
      
      // Filter by injury safety (exclude 'avoid' exercises)
      const safeExercises: any[] = [];
      const cautionExercises: any[] = [];
      
      for (const exercise of candidateExercises) {
        // Convert to ExerciseType format for safety check
        const exerciseForSafety: ExerciseType = {
          id: exercise.id,
          name: exercise.name,
          primaryMuscle: exercise.primary_muscle,
          secondaryMuscles: [],
          pattern: exercise.movement_pattern || 'isolation',
          equipment: exercise.equipment_required?.[0] || 'barbell',
          difficulty: 'intermediate',
          fatigueRating: 2,
          defaultRepRange: [8, 12],
          defaultRir: 2,
          minWeightIncrementKg: 2.5,
          mechanic: exercise.mechanic,
          isCustom: false,
          isBodyweight: exercise.is_bodyweight || false,
          hypertrophyScore: { tier: exercise.hypertrophy_tier || 'C', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 },
          spinalLoading: 'none',
          requiresBackArch: false,
          requiresSpinalFlexion: false,
          requiresSpinalExtension: false,
          requiresSpinalRotation: false,
          positionStress: {},
        } as ExerciseType;
        
        const safety = checkExerciseSafety(exerciseForSafety, activeInjuries);
        
        if (safety.level === 'avoid') {
          continue; // Skip unsafe exercises
        } else if (safety.level === 'caution') {
          cautionExercises.push({ ...exercise, safetyReasons: safety.reasons });
        } else {
          safeExercises.push(exercise);
        }
      }
      
      // Prefer safe exercises, but include caution exercises if needed
      const allSafeExercises = [...safeExercises, ...cautionExercises];
      
      // ============================================
      // STEP 4: SCORE AND RANK EXERCISES
      // ============================================
      
      interface ScoredExercise {
        exercise: any;
        score: number;
        reasons: string[];
        isCaution: boolean;
      }
      
      const tierScore: Record<string, number> = { 'S': 50, 'A': 40, 'B': 25, 'C': 10, 'D': 0, 'F': 0 };
      
      const scoredExercises: ScoredExercise[] = allSafeExercises.map((exercise: any) => {
        let score = 0;
        const reasons: string[] = [];
        
        // Hypertrophy tier (0-50 points)
        const tier = exercise.hypertrophy_tier || 'C';
        score += tierScore[tier] || 15;
        if (tier === 'S' || tier === 'A') {
          reasons.push(`${tier}-tier for maximum hypertrophy`);
        } else if (tier === 'B') {
          reasons.push('High-quality B-tier exercise');
        }
        
        // Compound bonus (0-15 points)
        if (exercise.mechanic === 'compound') {
          score += 15;
          reasons.push('Compound movement (efficient)');
        }
        
        // Frequency bonus (0-10 points) - user preference
        const usageCount = frequentExerciseIds.get(exercise.id) || 0;
        if (usageCount >= 3 && !recentlyDoneIds.has(exercise.id)) {
          score += 10;
          reasons.push('One of your frequent choices');
        } else if (usageCount >= 2 && !recentlyDoneIds.has(exercise.id)) {
          score += 5;
        }
        
        // Recency penalty (-20 points)
        if (recentlyDoneIds.has(exercise.id)) {
          score -= 20;
          reasons.push('Done recently (variety penalty)');
        }
        
        // Injury caution penalty (-15 points)
        const isCaution = cautionExercises.some(c => c.id === exercise.id);
        if (isCaution) {
          score -= 15;
          reasons.push('Caution: may stress injured area');
        }
        
        return { exercise, score, reasons, isCaution };
      });
      
      // Sort by score (highest first)
      scoredExercises.sort((a, b) => b.score - a.score);
      
      // ============================================
      // STEP 5: SELECT WITH MOVEMENT PATTERN VARIETY
      // ============================================
      
      const exerciseBudget = getMaxExercisesForTime(workoutDuration, userGoal);
      const selectedPatterns = new Set<string>();
      const picked: any[] = [];
      
      // Separate compounds and isolations
      const compounds = scoredExercises.filter(s => s.exercise.mechanic === 'compound');
      const isolations = scoredExercises.filter(s => s.exercise.mechanic === 'isolation');
      
      // Pick compounds with variety
      for (const scored of compounds) {
        if (picked.length >= exerciseBudget.total) break;
        if (picked.filter(p => p.mechanic === 'compound').length >= exerciseBudget.compounds) break;
        
        const pattern = scored.exercise.movement_pattern || 'unknown';
        
        // Prefer new patterns, but allow repeats if we've exhausted variety
        if (selectedPatterns.has(pattern) && 
            compounds.some(c => !selectedPatterns.has(c.exercise.movement_pattern || 'unknown'))) {
          continue; // Skip this one, we have other patterns available
        }
        
        picked.push(scored.exercise);
        selectedPatterns.add(pattern);
      }
      
      // Pick isolations with variety
      for (const scored of isolations) {
        if (picked.length >= exerciseBudget.total) break;
        if (picked.filter(p => p.mechanic === 'isolation').length >= exerciseBudget.isolations) break;
        
        const pattern = scored.exercise.movement_pattern || 'unknown';
        
        if (selectedPatterns.has(pattern) && 
            isolations.some(c => !selectedPatterns.has(c.exercise.movement_pattern || 'unknown'))) {
          continue;
        }
        
        picked.push(scored.exercise);
        selectedPatterns.add(pattern);
      }
      
      // ============================================
      // STEP 6: GENERATE EXPLANATIONS
      // ============================================
      
      const detailedExplanations = picked.map((exercise: any) => {
        const explanations: string[] = [];
        const muscle = exercise.primary_muscle;
        const muscleTrainingCount = trainedMuscles[muscle] || 0;
        const opposingMuscle = opposingMuscles[muscle];
        
        // Muscle need
        if (muscleTrainingCount === 0) {
          explanations.push(`You haven't trained ${muscle} in the last 7 days`);
          if (opposingMuscle && (trainedMuscles[opposingMuscle] || 0) === 0) {
            explanations.push(`Balancing with ${opposingMuscle} (also untrained)`);
          }
        } else if (muscleTrainingCount < 1) {
          explanations.push(`${muscle} was only partially trained recently (via compound exercises)`);
        } else {
          explanations.push(`${muscle} needs more volume (trained ${Math.round(muscleTrainingCount)} time${Math.round(muscleTrainingCount) > 1 ? 's' : ''} in last 7 days)`);
        }
        
        // Recovery
        const lastTrained = muscleLastTrained[muscle];
        if (lastTrained) {
          const daysSince = Math.floor((Date.now() - lastTrained.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince >= 2) {
            explanations.push(`Adequate recovery time (last trained ${daysSince} days ago)`);
          }
        }
        
        // Exercise-specific reasons (from scoring)
        const scored = scoredExercises.find(s => s.exercise.id === exercise.id);
        if (scored) {
          explanations.push(...scored.reasons);
        }
        
        // Frequency
        const usageCount = frequentExerciseIds.get(exercise.id) || 0;
        if (usageCount >= 3 && !recentlyDoneIds.has(exercise.id)) {
          explanations.push('One of your frequent choices');
        }
        
        // Recency
        if (recentlyDoneIds.has(exercise.id)) {
          explanations.push('Done recently (variety penalty applied)');
        }
        
        return {
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          explanation: explanations.join('. ') + '.'
        };
      });
      
      // Track skipped muscles
      const skippedMuscles: Array<{ muscle: string; reason: string }> = [];
      const checkedMuscles = new Set(suggestedMuscles);
      
      for (let i = 0; i < Math.min(muscleCount + 3, sortedMuscles.length); i++) {
        const muscle = sortedMuscles[i];
        if (checkedMuscles.has(muscle)) continue;
        
        const lastTrained = muscleLastTrained[muscle];
        if (lastTrained) {
          const daysSince = Math.floor((Date.now() - lastTrained.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince < 2) {
            skippedMuscles.push({ 
              muscle, 
              reason: `Trained ${daysSince === 0 ? 'today' : `${daysSince} day${daysSince > 1 ? 's' : ''} ago`} - allowing recovery time` 
            });
          }
        }
      }
      
      // Calculate estimated time
      let estimatedMinutes = 0;
      const warmupMuscles = new Set<string>();
      picked.forEach((e: any) => {
        const isCompound = e.mechanic === 'compound';
        const needsWarmup = isCompound && !warmupMuscles.has(e.primary_muscle);
        if (needsWarmup) warmupMuscles.add(e.primary_muscle);
        estimatedMinutes += estimateExerciseTime(isCompound, userGoal, 3, needsWarmup);
      });
      
      const reason = Object.keys(trainedMuscles).length === 0 
        ? `${picked.length} exercises for your ${workoutDuration}-minute workout (~${Math.round(estimatedMinutes)} min estimated).`
        : `${picked.length} exercises targeting ${suggestedMuscles.join(', ')} for your ${workoutDuration}-minute session (~${Math.round(estimatedMinutes)} min estimated).`;
      
      setSuggestions({
        muscles: suggestedMuscles,
        exercises: picked.map((e: any) => e.id),
        reason,
        detailedExplanations,
        skippedMuscles,
      });
      
      setSelectedMuscles(suggestedMuscles);
      
      // Don't auto-advance - user must click "Review & Choose Exercises" button
      
    } catch (err) {
      console.error('Failed to suggest exercises:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate workout suggestions. Please try again.';
      setError(errorMessage);
    } finally {
      setIsSuggesting(false);
    }
  };
  
  // Apply exercise suggestions when they're loaded
  useEffect(() => {
    if (suggestions && exercises.length > 0 && selectedExercises.length === 0) {
      // Auto-select suggested exercises
      const validSuggestions = suggestions.exercises.filter(id => 
        exercises.some(e => e.id === id)
      );
      if (validSuggestions.length > 0) {
        setSelectedExercises(validSuggestions);
      }
    }
  }, [suggestions, exercises, selectedExercises.length]);

  // Auto-trigger AI suggestions when ai=true in URL
  useEffect(() => {
    if (aiMode && !suggestions && !isSuggesting) {
      suggestExercises();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode]);

  // Load gym locations on mount
  useEffect(() => {
    const loadGymLocations = async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      try {
        const { data: locations, error } = await supabase
          .from('gym_locations')
          .select('*')
          .eq('user_id', user.id);

        if (!error && locations && locations.length > 0) {
          setGymLocations(locations);
          // Select default location or first location
          const defaultLocation = locations.find((l: { id: string; name: string; is_default: boolean }) => l.is_default) || locations[0];
          setSelectedLocationId(defaultLocation.id);
        } else {
          // Fallback: create virtual location
          setGymLocations([{ id: 'fallback', name: 'Home Gym', is_default: true }]);
          setSelectedLocationId('fallback');
        }
      } catch (err) {
        // Fallback on error
        setGymLocations([{ id: 'fallback', name: 'Home Gym', is_default: true }]);
        setSelectedLocationId('fallback');
      } finally {
        setIsLoadingLocations(false);
      }
    };

    loadGymLocations();
  }, []);

  // Fetch frequently used exercises on mount
  useEffect(() => {
    const fetchFrequentExercises = async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get exercise usage counts from the last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const { data } = await supabase
        .from('exercise_blocks')
        .select(`
          exercise_id,
          workout_sessions!inner(user_id, started_at)
        `)
        .eq('workout_sessions.user_id', user.id)
        .gte('workout_sessions.started_at', ninetyDaysAgo.toISOString());

      if (data) {
        // Count occurrences of each exercise
        const counts = new Map<string, number>();
        data.forEach((block: { exercise_id: string }) => {
          const id = block.exercise_id;
          counts.set(id, (counts.get(id) || 0) + 1);
        });
        setFrequentExerciseIds(counts);
      }
    };
    fetchFrequentExercises();
  }, []);

  // Fetch exercises when muscles are selected
  useEffect(() => {
    if (step === 2 && selectedMuscles.length > 0) {
      const fetchExercises = async () => {
        setIsLoading(true);
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsLoading(false);
          return;
        }

        // Get available equipment for selected location
        let availableEquipment: string[] = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
        
        if (selectedLocationId && selectedLocationId !== 'fallback') {
          try {
            // Load equipment for the selected location
            const { data: locationEquipment, error: equipmentError } = await supabase
              .from('user_equipment')
              .select('equipment_id, is_available')
              .eq('user_id', user.id)
              .eq('location_id', selectedLocationId)
              .eq('is_available', true);
            
            if (!equipmentError && locationEquipment && locationEquipment.length > 0) {
              // Get equipment type names from equipment_types table
              const equipmentIds = locationEquipment.map((eq: any) => eq.equipment_id);
              const { data: equipmentTypes, error: typesError } = await supabase
                .from('equipment_types')
                .select('id, name')
                .in('id', equipmentIds);
              
              if (!typesError && equipmentTypes && equipmentTypes.length > 0) {
                // Map equipment IDs to names and expand using EQUIPMENT_MAPPING
                const equipmentNames = new Set<string>();
                equipmentTypes.forEach((et: any) => {
                  const name = et.name.toLowerCase();
                  equipmentNames.add(name);
                  
                  // Also add mapped variations (e.g., 'dumbbells' -> ['dumbbell', 'db'])
                  const mapping = EQUIPMENT_MAPPING[et.id] || EQUIPMENT_MAPPING[name];
                  if (mapping) {
                    mapping.forEach((variant: string) => equipmentNames.add(variant.toLowerCase()));
                  }
                });
                
                availableEquipment = Array.from(equipmentNames);
              } else {
                // If equipment_types lookup fails, try using equipment_id directly
                const equipmentNames = new Set<string>();
                equipmentIds.forEach((id: string) => {
                  const idLower = id.toLowerCase();
                  equipmentNames.add(idLower);
                  
                  // Expand using mapping
                  const mapping = EQUIPMENT_MAPPING[id] || EQUIPMENT_MAPPING[idLower];
                  if (mapping) {
                    mapping.forEach((variant: string) => equipmentNames.add(variant.toLowerCase()));
                  }
                });
                
                availableEquipment = Array.from(equipmentNames);
              }
            } else {
              // Fallback to user's general equipment preference
              const { data: userData } = await supabase
                .from('users')
                .select('available_equipment')
                .eq('id', user.id)
                .single();
              
              if (userData?.available_equipment) {
                availableEquipment = (userData.available_equipment as string[]) || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
              }
            }
          } catch (err) {
            console.warn('Error loading location equipment:', err);
            // Fall through to default equipment
          }
        } else {
          // Fallback to user's general equipment preference
          const { data: userData } = await supabase
            .from('users')
            .select('available_equipment')
            .eq('id', user.id)
            .single();
          
          if (userData?.available_equipment) {
            availableEquipment = (userData.available_equipment as string[]) || ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
          }
        }

        // Fetch exercises
        const { data, error } = await supabase
          .from('exercises')
          .select('id, name, primary_muscle, mechanic, hypertrophy_tier, equipment_required')
          .in('primary_muscle', selectedMuscles)
          .order('name');

        if (data && !error) {
          // Filter by equipment availability
          const normalizedAvailable = availableEquipment.map((eq: string) => eq.toLowerCase().trim());
          console.log('[STEP 2 FILTER DEBUG] Available equipment:', normalizedAvailable);
          console.log('[STEP 2 FILTER DEBUG] Total exercises before filtering:', data.length);
          
          const filteredOut: Array<{ name: string; equipment: string[] }> = [];
          const filteredIn: Array<{ name: string; equipment: string[] }> = [];
          
          let filteredExercises = data.filter((e: any) => {
            if (!e.equipment_required || e.equipment_required.length === 0) {
              filteredIn.push({ name: e.name, equipment: [] });
              return true;
            }
            
            // Check if ANY required equipment is available (OR logic)
            // Most exercises can be done with alternative equipment (e.g., dumbbell OR barbell)
            const requiredEquipment = e.equipment_required.map((eq: string) => eq.toLowerCase().trim());
            const anyAvailable = requiredEquipment.some((reqEq: string) => {
              // Direct match
              if (normalizedAvailable.includes(reqEq)) return true;
              
              // Partial match (e.g., "cable" matches "cable machine")
              if (normalizedAvailable.some((avail: string) => reqEq.includes(avail) || avail.includes(reqEq))) return true;
              
              return false;
            });
            
            if (anyAvailable) {
              filteredIn.push({ name: e.name, equipment: requiredEquipment });
            } else {
              filteredOut.push({ name: e.name, equipment: requiredEquipment });
            }
            
            return anyAvailable;
          });
          
          console.log(`[STEP 2 FILTER DEBUG] Filtered ${filteredExercises.length} exercises (from ${data.length} total)`);
          console.log('[STEP 2 FILTER DEBUG] Sample exercises that PASSED:', filteredIn.slice(0, 5));
          console.log('[STEP 2 FILTER DEBUG] Sample exercises that FAILED:', filteredOut.slice(0, 5));

          // Sort: frequently used first, then by hypertrophy tier, then alphabetically
          const tierRank: Record<string, number> = { 'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5 };
          const sorted = [...filteredExercises].sort((a: any, b: any) => {
            const freqA = frequentExerciseIds.get(a.id) || 0;
            const freqB = frequentExerciseIds.get(b.id) || 0;
            
            // Frequently used exercises first (higher count = earlier)
            if (freqA !== freqB) return freqB - freqA;
            
            // Then by tier
            const tierA = tierRank[a.hypertrophy_tier || 'C'] ?? 3;
            const tierB = tierRank[b.hypertrophy_tier || 'C'] ?? 3;
            if (tierA !== tierB) return tierA - tierB;
            
            // Then alphabetically
            return (a.name || '').localeCompare(b.name || '');
          });
          setExercises(sorted);
        }
        setIsLoading(false);
      };
      fetchExercises();
    }
  }, [step, selectedMuscles, frequentExerciseIds, selectedLocationId]);

  const toggleMuscle = (muscle: string) => {
    setSelectedMuscles((prev) =>
      prev.includes(muscle)
        ? prev.filter((m) => m !== muscle)
        : [...prev, muscle]
    );
  };

  const toggleExercise = (exerciseId: string) => {
    setSelectedExercises((prev) =>
      prev.includes(exerciseId)
        ? prev.filter((id) => id !== exerciseId)
        : [...prev, exerciseId]
    );
  };

  const openCustomExerciseModal = (muscle: string) => {
    setCustomExerciseForm({ name: '', muscle, mechanic: 'compound' });
    setCustomExerciseError(null);
    setShowCustomExerciseModal(true);
  };

  const createCustomExercise = async () => {
    if (!customExerciseForm.name.trim()) {
      setCustomExerciseError('Please enter an exercise name');
      return;
    }

    setIsCreatingCustom(true);
    setCustomExerciseError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setCustomExerciseError('You must be logged in');
        return;
      }

      // Create the custom exercise
      const { data: newExercise, error: createError } = await supabase
        .from('exercises')
        .insert({
          name: customExerciseForm.name.trim(),
          primary_muscle: customExerciseForm.muscle,
          mechanic: customExerciseForm.mechanic,
          movement_pattern: customExerciseForm.mechanic === 'compound' ? 'compound' : 'isolation',
          is_custom: true,
          created_by: user.id,
        })
        .select('id, name, primary_muscle, mechanic')
        .single();

      if (createError) {
        if (createError.code === '23505') {
          setCustomExerciseError('An exercise with this name already exists');
        } else {
          setCustomExerciseError('Failed to create exercise. Please try again.');
        }
        return;
      }

      if (newExercise) {
        // Add to exercises list
        setExercises(prev => [...prev, newExercise as Exercise]);
        // Auto-select the new exercise
        setSelectedExercises(prev => [...prev, newExercise.id]);
        // Close modal
        setShowCustomExerciseModal(false);
        setCustomExerciseForm({ name: '', muscle: '', mechanic: 'compound' });
      }
    } catch (err) {
      setCustomExerciseError('An error occurred. Please try again.');
    } finally {
      setIsCreatingCustom(false);
    }
  };

  const handleStartWorkout = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('You must be logged in');

      // Fetch user's goal from profile
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('goal')
        .eq('user_id', user.id)
        .single();
      
      const userGoal: Goal = (userProfile?.goal as Goal) || 'maintain';

      // Create workout session
      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          state: 'planned',
          planned_date: getLocalDateString(),
          completion_percent: 0,
        })
        .select()
        .single();

      if (sessionError || !session) throw sessionError || new Error('Failed to create session');

      // Track which muscle groups have had warmups
      const warmedUpMuscles = new Set<string>();

      // Create exercise blocks with warmup protocols (only for first exercise per muscle group)
      const exerciseBlocks = selectedExercises.map((exerciseId, index) => {
        const exercise = exercises.find(e => e.id === exerciseId);
        const isCompound = exercise?.mechanic === 'compound';
        const muscleGroup = exercise?.primary_muscle || '';
        
        // Only generate warmup for first compound exercise of each muscle group
        const isFirstForMuscle = !warmedUpMuscles.has(muscleGroup);
        const shouldWarmup = isCompound && isFirstForMuscle;
        
        if (shouldWarmup && muscleGroup) {
          warmedUpMuscles.add(muscleGroup);
        }
        
        // Generate warmup for first compound exercise of each muscle group
        const warmupSets = shouldWarmup ? generateWarmupProtocol({
          workingWeight: 60, // Default starting weight, user can adjust
          exercise: {
            id: exerciseId,
            name: exercise?.name || '',
            primaryMuscle: muscleGroup,
            secondaryMuscles: [],
            mechanic: exercise?.mechanic || 'compound',
            defaultRepRange: [8, 12],
            defaultRir: 2,
            minWeightIncrementKg: 2.5,
            formCues: [],
            commonMistakes: [],
            setupNote: '',
            movementPattern: '',
            equipmentRequired: [],
          },
          isFirstExercise: index === 0, // First exercise overall gets general warmup
        }) : [];

        // Scale sets based on workout duration
        // 60 min = full sets, 30 min = ~50%, 20 min = ~33%
        const timeModifier = Math.min(1.0, workoutDuration / 60);
        const baseSets = isCompound ? 4 : 3;
        const scaledSets = Math.max(2, Math.round(baseSets * timeModifier)); // Minimum 2 sets
        
        return {
          workout_session_id: session.id,
          exercise_id: exerciseId,
          order: index + 1,
          target_sets: scaledSets,
          target_rep_range: isCompound ? [6, 10] : [10, 15], // Lower reps for compounds
          target_rir: 2,
          target_weight_kg: 0, // Will be set during workout
          target_rest_seconds: getRestPeriod(isCompound, userGoal),
          suggestion_reason: 'Selected by user',
          warmup_protocol: { sets: warmupSets },
        };
      });

      const { error: blocksError } = await supabase
        .from('exercise_blocks')
        .insert(exerciseBlocks);

      if (blocksError) throw blocksError;

      // Navigate to the workout - skip loading screen on destination (already saw one)
      router.replace(`/dashboard/workout/${session.id}?fromCreate=true`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workout');
      setIsCreating(false);
    }
  };

  // Group exercises by muscle, filtered by search term
  const exercisesByMuscle = selectedMuscles.reduce((acc, muscle) => {
    const muscleExercises = exercises.filter((e) => e.primary_muscle === muscle);
    // Apply search filter if search term exists
    if (exerciseSearch.trim()) {
      const searchLower = exerciseSearch.toLowerCase().trim();
      acc[muscle] = muscleExercises.filter((e) => 
        e.name.toLowerCase().includes(searchLower)
      );
    } else {
      acc[muscle] = muscleExercises;
    }
    return acc;
  }, {} as Record<string, Exercise[]>);
  
  // Count total filtered exercises
  const totalFilteredExercises = Object.values(exercisesByMuscle).reduce(
    (sum, exs) => sum + exs.length, 0
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">
          {templateName ? `${templateName} Workout` : 'New Workout'}
        </h1>
        <p className="text-surface-400 mt-1">
          {step === 1 
            ? 'Select muscle groups to train' 
            : templateName 
              ? `Choose exercises for your ${templateName.toLowerCase()} workout`
              : 'Choose your exercises'
          }
        </p>
      </div>

      {/* Progress indicator - hide if starting from template */}
      {!templateName && (
        <div className="flex gap-2">
          <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-primary-500' : 'bg-surface-700'}`} />
          <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-primary-500' : 'bg-surface-700'}`} />
        </div>
      )}

      {error && (
        <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {/* Time and Location Selection */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Workout Setup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Time Selection */}
              <div>
                <label className="block text-sm font-medium text-surface-200 mb-3">
                  How much time do you have?
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[20, 30, 45, 60, 75, 90].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => setWorkoutDuration(mins)}
                      className={`p-3 rounded-lg text-center transition-all ${
                        workoutDuration === mins
                          ? 'bg-primary-500/20 border-2 border-primary-500 text-primary-400'
                          : 'bg-surface-800 border-2 border-transparent text-surface-300 hover:bg-surface-700'
                      }`}
                    >
                      <div className="font-semibold">{mins}</div>
                      <div className="text-xs text-surface-500">min</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-surface-500 mt-2 text-center">
                  {workoutDuration <= 25 
                    ? '⚡ Quick mode: Only S & A-tier exercises'
                    : workoutDuration <= 45 
                    ? '⏱️ Time-efficient: Focused on key compounds'
                    : '💪 Full workout: Complete volume for optimal growth'}
                </p>
              </div>

              {/* Location Selection */}
              {!isLoadingLocations && (
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-3">
                    Gym Location
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {gymLocations.map((location) => (
                      <button
                        key={location.id}
                        onClick={() => setSelectedLocationId(location.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          selectedLocationId === location.id
                            ? 'bg-primary-500 text-white'
                            : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                        }`}
                      >
                        {location.name}
                        {location.is_default && selectedLocationId !== location.id && (
                          <span className="ml-1 text-xs opacity-75">(Default)</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-surface-500 mt-2">
                    Exercises will be filtered based on equipment available at this location
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Suggestion Card */}
          <Card className="border-2 border-dashed border-accent-500/30 bg-gradient-to-r from-accent-500/5 to-primary-500/5">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <h3 className="font-semibold text-surface-100">Not sure what to train?</h3>
                  <p className="text-sm text-surface-400 mt-0.5">
                    We&apos;ll suggest muscles and exercises based on your recent history, goals, and {selectedLocationId && gymLocations.find((l: { id: string; name: string; is_default: boolean }) => l.id === selectedLocationId) ? `equipment at ${gymLocations.find((l: { id: string; name: string; is_default: boolean }) => l.id === selectedLocationId)?.name}` : 'available equipment'}
                  </p>
                </div>
                <Button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Suggest Workout button clicked');
                    suggestExercises();
                  }}
                  isLoading={isSuggesting}
                  disabled={isSuggesting}
                  className="whitespace-nowrap"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Suggest Workout
                </Button>
              </div>
              
              {/* Show suggestions if available */}
              {suggestions && (
                <div className="mt-4 pt-4 border-t border-accent-500/20">
                  <p className="text-sm text-accent-300 font-medium mb-2">Suggested:</p>
                  <p className="text-sm text-surface-400">{suggestions.reason}</p>
                  {suggestions.muscles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="text-xs text-surface-500">Muscles:</span>
                      {suggestions.muscles.map((muscle) => (
                        <span key={muscle} className="px-2 py-1 bg-primary-500/20 text-primary-400 rounded text-xs capitalize">
                          {muscle}
                        </span>
                      ))}
                    </div>
                  )}
                  <Button
                    onClick={() => setStep(2)}
                    className="mt-3 w-full"
                    variant="outline"
                  >
                    Review & Choose Exercises →
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>What are you training today?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MUSCLE_GROUPS.map((muscle) => (
                  <button
                    key={muscle}
                    onClick={() => toggleMuscle(muscle)}
                    className={`p-4 rounded-lg text-left transition-all capitalize ${
                      selectedMuscles.includes(muscle)
                        ? 'bg-primary-500/20 border-2 border-primary-500 text-primary-400'
                        : 'bg-surface-800 border-2 border-transparent text-surface-300 hover:bg-surface-700'
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>

              <div className="flex justify-between mt-6 pt-4 border-t border-surface-800">
                <Button variant="ghost" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={selectedMuscles.length === 0}
                >
                  Next: Choose Exercises
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Time-based recommendation */}
          <div className="p-3 bg-surface-800/50 border border-surface-700 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-surface-300">
                <strong>{workoutDuration} min</strong> workout
              </span>
            </div>
            <span className="text-sm text-surface-500">
              Recommended: <strong>{getExerciseRangeForTime(workoutDuration)}</strong> exercises
            </span>
          </div>
          
          {/* Warning if too many exercises selected */}
          {selectedExercises.length > 0 && (() => {
            const budget = getMaxExercisesForTime(workoutDuration, 'maintain');
            if (selectedExercises.length > budget.total + 1) {
              return (
                <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg flex items-center gap-2">
                  <svg className="w-5 h-5 text-warning-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-sm text-warning-300">
                    {selectedExercises.length} exercises may exceed your {workoutDuration} min target. Consider removing {selectedExercises.length - budget.total} exercise{selectedExercises.length - budget.total > 1 ? 's' : ''}.
                  </span>
                </div>
              );
            }
            return null;
          })()}

          {/* Show AI suggestion reason */}
          {suggestions && (
            <div className="p-4 bg-accent-500/10 border border-accent-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-accent-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <div className="flex-1">
                  <p className="font-medium text-accent-300">AI Suggestion</p>
                  <p className="text-sm text-surface-400 mt-0.5">{suggestions.reason}</p>
                  
                  {/* Expandable detailed explanations */}
                  {suggestions.detailedExplanations && suggestions.detailedExplanations.length > 0 && (
                    <button
                      onClick={() => setShowExplanations(!showExplanations)}
                      className="mt-3 flex items-center gap-2 text-sm text-accent-400 hover:text-accent-300 transition-colors"
                    >
                      <svg 
                        className={`w-4 h-4 transition-transform ${showExplanations ? 'rotate-180' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {showExplanations ? 'Hide' : 'Show'} why these exercises were chosen
                    </button>
                  )}
                  
                  {showExplanations && (
                    <div className="mt-4 space-y-3 pt-3 border-t border-accent-500/20">
                      {/* Exercise explanations */}
                      {suggestions.detailedExplanations && suggestions.detailedExplanations.map((item) => {
                        const exercise = exercises.find(e => e.id === item.exerciseId);
                        if (!exercise) return null;
                        
                        return (
                          <div key={item.exerciseId} className="bg-surface-800/50 rounded-lg p-3">
                            <p className="font-medium text-surface-200 mb-1">{exercise.name}</p>
                            <p className="text-sm text-surface-400">{item.explanation}</p>
                          </div>
                        );
                      })}
                      
                      {/* Skipped muscles (recovery considerations) */}
                      {suggestions.skippedMuscles && suggestions.skippedMuscles.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-surface-700">
                          <p className="text-xs font-medium text-surface-500 uppercase mb-2">Muscles Skipped (Recovery)</p>
                          {suggestions.skippedMuscles.map((item, idx) => (
                            <div key={idx} className="text-sm text-surface-400 mb-1">
                              <span className="capitalize font-medium text-surface-300">{item.muscle}</span>: {item.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Search bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search exercises..."
              value={exerciseSearch}
              onChange={(e) => setExerciseSearch(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            {exerciseSearch && (
              <button
                onClick={() => setExerciseSearch('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-surface-500 hover:text-surface-300"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          {/* Search results count */}
          {exerciseSearch && (
            <p className="text-sm text-surface-400">
              {totalFilteredExercises} exercise{totalFilteredExercises !== 1 ? 's' : ''} found
              {totalFilteredExercises === 0 && (
                <span className="ml-1">— try a different search or <button onClick={() => setExerciseSearch('')} className="text-primary-400 hover:underline">clear filter</button></span>
              )}
            </p>
          )}
          
          {isLoading ? (
            <Card>
              <CardContent className="py-8 flex flex-col items-center justify-center">
                <LoadingAnimation type="random" size="md" />
                <p className="text-surface-400 mt-3">Loading exercises...</p>
              </CardContent>
            </Card>
          ) : (
            selectedMuscles.map((muscle) => (
              <Card key={muscle}>
                <CardHeader>
                  <CardTitle className="capitalize">{muscle}</CardTitle>
                </CardHeader>
                <CardContent>
                  {exercisesByMuscle[muscle]?.length > 0 ? (
                    <div className="space-y-2">
                      {exercisesByMuscle[muscle].map((exercise) => {
                        const usageCount = frequentExerciseIds.get(exercise.id) || 0;
                        const isFrequent = usageCount >= 2; // Show badge if used 2+ times
                        
                        return (
                          <button
                            key={exercise.id}
                            onClick={() => toggleExercise(exercise.id)}
                            className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                              selectedExercises.includes(exercise.id)
                                ? 'bg-primary-500/20 border border-primary-500/50'
                                : 'bg-surface-800 border border-transparent hover:bg-surface-700'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                                  selectedExercises.includes(exercise.id)
                                    ? 'bg-primary-500 border-primary-500'
                                    : 'border-surface-600'
                                }`}
                              >
                                {selectedExercises.includes(exercise.id) && (
                                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-surface-200">{exercise.name}</span>
                                {isFrequent && (
                                  <span className="text-xs text-amber-400" title={`Used ${usageCount} times recently`}>
                                    ★
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              {exercise.hypertrophy_tier && ['S', 'A'].includes(exercise.hypertrophy_tier) && (
                                <Badge 
                                  variant="success" 
                                  size="sm"
                                  className="font-semibold"
                                >
                                  {exercise.hypertrophy_tier}-tier
                                </Badge>
                              )}
                              <Badge variant={exercise.mechanic === 'compound' ? 'info' : 'default'} size="sm">
                                {exercise.mechanic}
                              </Badge>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-surface-500 text-center py-4">
                      No exercises found for this muscle group
                    </p>
                  )}
                  
                  {/* Add Custom Exercise Button */}
                  <button
                    onClick={() => openCustomExerciseModal(muscle)}
                    className="w-full mt-3 p-3 rounded-lg border-2 border-dashed border-surface-600 text-surface-400 hover:border-primary-500 hover:text-primary-400 transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Custom Exercise
                  </button>
                </CardContent>
              </Card>
            ))
          )}

          <Card className="sticky bottom-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-surface-400">
                    {selectedExercises.length} exercises selected
                  </p>
                  {selectedExercises.length > 0 && (() => {
                    // Calculate estimated time for selected exercises
                    let estimatedMinutes = 0;
                    const warmupMuscles = new Set<string>();
                    selectedExercises.forEach(exId => {
                      const ex = exercises.find(e => e.id === exId);
                      if (ex) {
                        const isCompound = ex.mechanic === 'compound';
                        const needsWarmup = isCompound && !warmupMuscles.has(ex.primary_muscle);
                        if (needsWarmup) warmupMuscles.add(ex.primary_muscle);
                        estimatedMinutes += estimateExerciseTime(isCompound, 'maintain', 3, needsWarmup);
                      }
                    });
                    const isOverTime = estimatedMinutes > workoutDuration + 5;
                    return (
                      <p className={`text-xs ${isOverTime ? 'text-warning-400' : 'text-surface-500'}`}>
                        ~{Math.round(estimatedMinutes)} min estimated
                        {isOverTime && ` (${Math.round(estimatedMinutes - workoutDuration)} min over)`}
                      </p>
                    );
                  })()}
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button
                    onClick={handleStartWorkout}
                    disabled={selectedExercises.length === 0 || isCreating}
                    isLoading={isCreating}
                  >
                    Start Workout
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Custom Exercise Modal */}
      {showCustomExerciseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-surface-100">Add Custom Exercise</h3>
              <button
                onClick={() => setShowCustomExerciseModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Exercise Name
                </label>
                <Input
                  value={customExerciseForm.name}
                  onChange={(e) => setCustomExerciseForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Cable Lateral Raise"
                  autoFocus
                />
              </div>

              <div>
                <Select
                  label="Muscle Group"
                  value={customExerciseForm.muscle}
                  onChange={(e) => setCustomExerciseForm(prev => ({ ...prev, muscle: e.target.value }))}
                  options={MUSCLE_GROUPS.map((muscle) => ({
                    value: muscle,
                    label: muscle.charAt(0).toUpperCase() + muscle.slice(1),
                  }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Exercise Type
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setCustomExerciseForm(prev => ({ ...prev, mechanic: 'compound' }))}
                    className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                      customExerciseForm.mechanic === 'compound'
                        ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                        : 'border-surface-600 text-surface-400 hover:border-surface-500'
                    }`}
                  >
                    <div className="font-medium">Compound</div>
                    <div className="text-xs opacity-70">Multi-joint movement</div>
                  </button>
                  <button
                    onClick={() => setCustomExerciseForm(prev => ({ ...prev, mechanic: 'isolation' }))}
                    className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                      customExerciseForm.mechanic === 'isolation'
                        ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                        : 'border-surface-600 text-surface-400 hover:border-surface-500'
                    }`}
                  >
                    <div className="font-medium">Isolation</div>
                    <div className="text-xs opacity-70">Single-joint movement</div>
                  </button>
                </div>
              </div>

              {customExerciseError && (
                <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
                  {customExerciseError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setShowCustomExerciseModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={createCustomExercise}
                  isLoading={isCreatingCustom}
                  disabled={!customExerciseForm.name.trim()}
                  className="flex-1"
                >
                  Add Exercise
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewWorkoutPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <LoadingAnimation type="random" size="lg" />
        <p className="mt-4 text-surface-400">Setting up your workout...</p>
      </div>
    }>
      <NewWorkoutContent />
    </Suspense>
  );
}
