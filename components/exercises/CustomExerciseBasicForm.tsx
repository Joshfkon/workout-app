'use client';

/**
 * Custom Exercise Basic Form (Phase 1)
 *
 * Collects minimal required input from the user:
 * - Exercise name
 * - Primary muscle
 * - Equipment
 * - Optional description
 * - Optional variation of existing exercise
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import type { BasicExerciseInput } from '@/lib/exercises/types';
import { MUSCLE_GROUP_OPTIONS, EQUIPMENT_OPTIONS } from '@/lib/exercises/types';
import type { MuscleGroup, Equipment } from '@/types/schema';
import { getExercises, type Exercise } from '@/services/exerciseService';

interface CustomExerciseBasicFormProps {
  onSubmit: (input: BasicExerciseInput) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  initialData?: Partial<BasicExerciseInput>;
}

export function CustomExerciseBasicForm({
  onSubmit,
  onCancel,
  isLoading = false,
  initialData,
}: CustomExerciseBasicFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup | ''>(
    initialData?.primaryMuscle || ''
  );
  const [equipment, setEquipment] = useState<Equipment | ''>(
    initialData?.equipment || ''
  );
  const [description, setDescription] = useState(initialData?.description || '');
  const [isVariation, setIsVariation] = useState(!!initialData?.variationOf);
  const [variationOf, setVariationOf] = useState(initialData?.variationOf || '');

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load exercises for variation selection
  useEffect(() => {
    async function loadExercises() {
      const allExercises = await getExercises(false); // Exclude custom
      setExercises(allExercises);
    }
    loadExercises();
  }, []);

  // Filter exercises for variation dropdown based on selected muscle
  const variationOptions = exercises
    .filter((e) => !primaryMuscle || e.primaryMuscle === primaryMuscle)
    .map((e) => ({ value: e.id, label: e.name }));

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Exercise name is required';
    }
    if (!primaryMuscle) {
      newErrors.primaryMuscle = 'Primary muscle is required';
    }
    if (!equipment) {
      newErrors.equipment = 'Equipment is required';
    }
    if (isVariation && !variationOf) {
      newErrors.variationOf = 'Please select the base exercise';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    const selectedExercise = exercises.find((ex) => ex.id === variationOf);

    onSubmit({
      name: name.trim(),
      primaryMuscle: primaryMuscle as MuscleGroup,
      equipment: equipment as Equipment,
      description: description.trim() || undefined,
      variationOf: isVariation ? variationOf : undefined,
      variationOfName: selectedExercise?.name,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-surface-100">
          Create Custom Exercise
        </h2>
        <p className="text-sm text-surface-400 mt-1">
          Enter the basics - AI will complete the technical details
        </p>
      </div>

      <Input
        label="Exercise Name"
        placeholder="e.g., Seated Calf Raise Machine"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        required
      />

      <Select
        label="Primary Muscle"
        options={MUSCLE_GROUP_OPTIONS}
        value={primaryMuscle}
        onChange={(e) => setPrimaryMuscle(e.target.value as MuscleGroup)}
        placeholder="Select primary muscle"
        error={errors.primaryMuscle}
        required
      />

      <Select
        label="Equipment"
        options={EQUIPMENT_OPTIONS}
        value={equipment}
        onChange={(e) => setEquipment(e.target.value as Equipment)}
        placeholder="Select equipment type"
        error={errors.equipment}
        required
      />

      <div>
        <label className="block text-sm font-medium text-surface-200 mb-1.5">
          Description (helps AI understand the movement)
        </label>
        <textarea
          className="w-full rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5
            text-surface-100 placeholder:text-surface-500
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
            transition-all duration-200 resize-none"
          rows={3}
          placeholder="e.g., Seated position, knees bent, push through balls of feet"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="mt-1.5 text-sm text-surface-500">
          Optional but helps AI generate more accurate metadata
        </p>
      </div>

      <div className="border-t border-surface-800 pt-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isVariation}
            onChange={(e) => {
              setIsVariation(e.target.checked);
              if (!e.target.checked) setVariationOf('');
            }}
            className="w-5 h-5 rounded bg-surface-800 border-surface-600
              text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
          />
          <span className="text-surface-200">
            This is a variation of an existing exercise
          </span>
        </label>

        {isVariation && (
          <div className="mt-4">
            <Select
              label="Base Exercise"
              options={variationOptions}
              value={variationOf}
              onChange={(e) => setVariationOf(e.target.value)}
              placeholder="Select base exercise"
              error={errors.variationOf}
            />
            <p className="mt-1.5 text-sm text-surface-500">
              AI will inherit properties from the base exercise and adjust for your
              variation
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-4">
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            className="flex-1"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          isLoading={isLoading}
          className="flex-1"
        >
          {isLoading ? 'Analyzing...' : 'Continue'}
        </Button>
      </div>
    </form>
  );
}
