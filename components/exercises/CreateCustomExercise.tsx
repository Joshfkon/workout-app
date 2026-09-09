'use client';

/**
 * Create Custom Exercise - Main Component
 *
 * Two-phase flow for creating custom exercises with AI assistance:
 * 1. Basic Input: User provides minimal required information
 * 2. AI Review: User reviews and adjusts AI-completed metadata
 */

import { useState } from 'react';
import { CustomExerciseBasicForm } from './CustomExerciseBasicForm';
import { CustomExerciseReviewForm } from './CustomExerciseReviewForm';
import type { BasicExerciseInput, CompletedExerciseData } from '@/lib/exercises/types';
import { completeExerciseWithAI } from '@/lib/actions/exercise-completion';
import { createCustomExercise, clearExerciseCache } from '@/services/exerciseService';
import { isGroupSplitPrimary } from '@/services/muscleAttributionAudit';
import { createUntypedClient } from '@/lib/supabase/client';

interface CreateCustomExerciseProps {
  onSuccess?: (exerciseId: string) => void;
  onCancel?: () => void;
  userId: string;
  initialName?: string;
}

type Phase = 'input' | 'review';

export function CreateCustomExercise({
  onSuccess,
  onCancel,
  userId,
  initialName,
}: CreateCustomExerciseProps) {
  const [phase, setPhase] = useState<Phase>('input');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basicInput, setBasicInput] = useState<BasicExerciseInput | null>(null);
  const [completedData, setCompletedData] = useState<CompletedExerciseData | null>(
    null
  );
  const [showSecondariesNudge, setShowSecondariesNudge] = useState(false);
  const [savedExerciseId, setSavedExerciseId] = useState<string | null>(null);

  const handleBasicSubmit = async (input: BasicExerciseInput) => {
    setIsLoading(true);
    setError(null);
    setBasicInput(input);

    try {
      const result = await completeExerciseWithAI(input);

      if (!result.success) {
        // Store the input for potential fallback save
        setBasicInput(input);
        if (result.limitReached) {
          setError(result.error || 'AI limit reached');
        } else {
          setError(result.error || 'Failed to complete exercise');
        }
        setIsLoading(false);
        return;
      }

      if (result.data) {
        setCompletedData(result.data);
        setPhase('review');
      }
    } catch (err: any) {
      setBasicInput(input);
      setError(err?.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (data: CompletedExerciseData) => {
    setIsSaving(true);
    setError(null);

    try {
      // Create the exercise in the database
      const exercise = await createCustomExercise(
        {
          name: data.name,
          // A group-splitting coarse primary ('shoulders'/'chest'/'back') is
          // rejected at save (validateExercisePrimary) — store the AI's
          // detailed head classification instead, which is what the
          // completion flow computed it for. Precise picks pass through.
          primaryMuscle: isGroupSplitPrimary(data.primaryMuscle)
            ? data.primaryMuscleDetailed
            : data.primaryMuscle,
          secondaryMuscles: data.secondaryMuscles,
          mechanic: data.mechanic,
          pattern: data.pattern,
          equipment: data.equipment,
          difficulty: data.difficulty,
          fatigueRating: data.fatigueRating,
          defaultRepRange: data.defaultRepRange,
          defaultRir: data.defaultRir,
          minWeightIncrementKg: data.minWeightIncrementKg,
          notes: data.description,
          hypertrophyScore: data.hypertrophyScore,
          stabilizers: data.stabilizers,
          spinalLoading: data.spinalLoading,
          requiresBackArch: data.requiresBackArch,
          requiresSpinalFlexion: data.requiresSpinalFlexion,
          requiresSpinalExtension: data.requiresSpinalExtension,
          requiresSpinalRotation: data.requiresSpinalRotation,
          positionStress: data.positionStress,
          contraindications: data.contraindications,
          formCues: data.formCues,
          commonMistakes: [],
          setupNote: '',
          movementPattern: data.pattern,
          equipmentRequired: [data.equipment],
          // Bodyweight exercise flags - derived from equipment type
          isBodyweight: data.equipment === 'bodyweight',
          bodyweightType: data.equipment === 'bodyweight' ? 'weighted_possible' : undefined,
        },
        userId
      );

      if (!exercise) {
        throw new Error('Failed to save exercise');
      }

      // Record which gym locations have this exercise (chosen on the basic
      // form). A failure here shouldn't undo the save — the exercise just
      // defaults to available everywhere, editable later in exercise details.
      if (basicInput?.locationAvailability?.length) {
        const supabase = createUntypedClient();
        const { error: availabilityError } = await supabase
          .from('exercise_location_availability')
          .upsert(
            basicInput.locationAvailability.map(({ locationId, isAvailable }) => ({
              user_id: userId,
              exercise_id: exercise.id,
              location_id: locationId,
              is_available: isAvailable,
            })),
            { onConflict: 'user_id,exercise_id,location_id' }
          );
        if (availabilityError) {
          console.error('Failed to save location availability:', availabilityError);
        }
      }

      clearExerciseCache();
      onSuccess?.(exercise.id);
    } catch (err: any) {
      // Check for duplicate name error (PostgreSQL error code 23505)
      if (err?.message?.includes('duplicate key') || err?.message?.includes('already exists') || err?.code === '23505') {
        setError(`An exercise named "${data.name}" already exists. Please choose a different name.`);
      } else {
        setError(err?.message || 'Failed to save exercise');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWithBasics = async () => {
    if (!basicInput) return;
    
    setIsSaving(true);
    setError(null);
    setShowSecondariesNudge(false);

    try {
      // Create minimal exercise with sensible defaults
      const exercise = await createCustomExercise(
        {
          name: basicInput.name,
          primaryMuscle: basicInput.primaryMuscle,
          secondaryMuscles: [],
          mechanic: 'compound', // sensible default
          pattern: 'isolation', // sensible default
          equipment: basicInput.equipment,
          difficulty: 'intermediate', // sensible default
          fatigueRating: 2, // moderate default
          defaultRepRange: [8, 12], // hypertrophy range
          defaultRir: 2, // sensible default
          minWeightIncrementKg: basicInput.equipment === 'dumbbell' ? 2.5 : 5,
          notes: basicInput.description,
          hypertrophyScore: {
            tier: 'B',
            stretchUnderLoad: 3,
            resistanceProfile: 3,
            progressionEase: 3,
          },
          stabilizers: [],
          spinalLoading: 'low',
          requiresBackArch: false,
          requiresSpinalFlexion: false,
          requiresSpinalExtension: false,
          requiresSpinalRotation: false,
          positionStress: {},
          contraindications: [],
          formCues: [],
          commonMistakes: [],
          setupNote: '',
          movementPattern: 'isolation',
          equipmentRequired: [basicInput.equipment],
          isBodyweight: basicInput.equipment === 'bodyweight',
          bodyweightType: basicInput.equipment === 'bodyweight' ? 'weighted_possible' : undefined,
        },
        userId
      );

      if (!exercise) {
        throw new Error('Failed to save exercise');
      }

      // Save location availability if provided
      if (basicInput.locationAvailability?.length) {
        const supabase = createUntypedClient();
        await supabase
          .from('exercise_location_availability')
          .upsert(
            basicInput.locationAvailability.map(({ locationId, isAvailable }) => ({
              user_id: userId,
              exercise_id: exercise.id,
              location_id: locationId,
              is_available: isAvailable,
            })),
            { onConflict: 'user_id,exercise_id,location_id' }
          );
      }

      clearExerciseCache();
      
      // Show nudge about secondaries after saving with basics only
      setSavedExerciseId(exercise.id);
      setShowSecondariesNudge(true);
    } catch (err: any) {
      if (err?.message?.includes('duplicate key') || err?.message?.includes('already exists') || err?.code === '23505') {
        setError(`An exercise named "${basicInput.name}" already exists. Please choose a different name.`);
      } else {
        setError(err?.message || 'Failed to save exercise');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    setPhase('input');
    setError(null);
  };

  const handleDismissNudge = () => {
    setShowSecondariesNudge(false);
    if (savedExerciseId) {
      onSuccess?.(savedExerciseId);
    }
  };

  const handleEditExercise = () => {
    // The exercise library page will show the exercise details modal
    // where users can edit all fields including secondaries
    setShowSecondariesNudge(false);
    if (savedExerciseId) {
      onSuccess?.(savedExerciseId);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Secondaries Nudge - Light reminder after basics-only save */}
      {showSecondariesNudge && savedExerciseId && (
        <div className="mb-6 bg-primary-900/20 border border-primary-700/60 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-medium text-primary-200 mb-1">
                Exercise Saved
              </h4>
              <p className="text-sm text-surface-300 mb-3">
                No secondary muscles were added yet. You can refine this later from the exercise library.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleEditExercise}
                  className="text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Edit Exercise
                </button>
                <button
                  onClick={handleDismissNudge}
                  className="text-sm font-medium text-surface-400 hover:text-surface-300 transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Display with fallback option */}
      {error && (
        <div className="mb-6 bg-danger-900/30 border border-danger-700 rounded-lg p-4">
          <p className="text-danger-300 mb-3">{error}</p>
          {basicInput && phase === 'input' && (
            <div className="flex gap-3">
              <button
                onClick={() => handleBasicSubmit(basicInput)}
                disabled={isLoading || isSaving}
                className="flex-1 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-200 rounded-lg transition-colors disabled:opacity-50"
              >
                Retry AI completion
              </button>
              <button
                onClick={handleSaveWithBasics}
                disabled={isLoading || isSaving}
                className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save with basics only'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase 1: Basic Input */}
      {phase === 'input' && (
        <CustomExerciseBasicForm
          onSubmit={handleBasicSubmit}
          onCancel={onCancel}
          isLoading={isLoading}
          initialData={basicInput || (initialName ? { name: initialName } : undefined)}
          // Picking an existing match routes through the same success handler
          // the caller uses for a freshly created exercise (fetch-by-id then
          // swap/add/select), so "Use this instead" just selects it.
          onUseExisting={onSuccess}
        />
      )}

      {/* Phase 2: AI Review */}
      {phase === 'review' && completedData && (
        <CustomExerciseReviewForm
          data={completedData}
          onSave={handleSave}
          onBack={handleBack}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
