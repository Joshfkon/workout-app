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

  const handleBasicSubmit = async (input: BasicExerciseInput) => {
    setIsLoading(true);
    setError(null);
    setBasicInput(input);

    try {
      const result = await completeExerciseWithAI(input);

      if (!result.success) {
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
          primaryMuscle: data.primaryMuscle,
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

  const handleBack = () => {
    setPhase('input');
    setError(null);
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Error Display */}
      {error && (
        <div className="mb-6 bg-danger-900/30 border border-danger-700 rounded-lg p-4">
          <p className="text-danger-300">{error}</p>
        </div>
      )}

      {/* Phase 1: Basic Input */}
      {phase === 'input' && (
        <CustomExerciseBasicForm
          onSubmit={handleBasicSubmit}
          onCancel={onCancel}
          isLoading={isLoading}
          initialData={basicInput || (initialName ? { name: initialName } : undefined)}
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
