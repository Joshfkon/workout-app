'use client';

/**
 * Custom Exercise Basic Form (Phase 1)
 *
 * Collects only what we genuinely need from the user:
 * - Exercise name (required)
 * - Primary muscle (required)
 * - Equipment (required)
 * - Optional short description to help the AI
 * - Optional "variation of an existing exercise" shortcut
 *
 * Everything else (movement pattern, progression, safety, hypertrophy
 * scoring, form cues, ...) is filled in by AI and can be fine-tuned on the
 * review screen. Keeping this form minimal is intentional — the advanced
 * machinery stays out of the user's way.
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import type { BasicExerciseInput } from '@/lib/exercises/types';
import { MUSCLE_GROUP_OPTIONS, EQUIPMENT_OPTIONS } from '@/lib/exercises/types';
import type { MuscleGroup, Equipment } from '@/types/schema';
import { getExercises, type Exercise } from '@/services/exerciseService';
import { createUntypedClient } from '@/lib/supabase/client';

interface GymLocation {
  id: string;
  name: string;
  is_default: boolean;
}

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
  const [primaryMuscle, setPrimaryMuscle] = useState<string>(
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

  const [gymLocations, setGymLocations] = useState<GymLocation[]>([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [unavailableLocationIds, setUnavailableLocationIds] = useState<Set<string>>(
    () =>
      new Set(
        (initialData?.locationAvailability ?? [])
          .filter((l) => !l.isAvailable)
          .map((l) => l.locationId)
      )
  );

  // Load exercises for variation selection (include custom exercises)
  useEffect(() => {
    async function loadExercises() {
      const allExercises = await getExercises(true);
      setExercises(allExercises);
    }
    loadExercises();
  }, []);

  // Load gym locations so the user can say where this exercise is available
  useEffect(() => {
    async function loadGymLocations() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('gym_locations')
          .select('id, name, is_default')
          .eq('user_id', user.id)
          .order('name');

        if (data) {
          setGymLocations(data);
        }
      } finally {
        // Unblocks submit even if the query fails — the exercise then simply
        // defaults to available everywhere, same as before this feature.
        setLocationsLoaded(true);
      }
    }
    loadGymLocations();
  }, []);

  // With a single location the choice is meaningless, so only ask when there
  // are multiple gyms to pick between.
  const showLocationPicker = gymLocations.length > 1;

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
    if (showLocationPicker && unavailableLocationIds.size >= gymLocations.length) {
      newErrors.locations = 'Select at least one location';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Don't submit before gym locations resolve — otherwise a multi-location
    // user would silently skip the availability picker.
    if (!locationsLoaded) return;

    if (!validate()) return;

    const selectedExercise = exercises.find((ex) => ex.id === variationOf);

    const input: BasicExerciseInput = {
      name: name.trim(),
      primaryMuscle: primaryMuscle as MuscleGroup,
      equipment: equipment as Equipment,
      description: description.trim() || undefined,
      variationOf: isVariation ? variationOf : undefined,
      variationOfName: selectedExercise?.name,
      locationAvailability: showLocationPicker
        ? gymLocations.map((location) => ({
            locationId: location.id,
            isAvailable: !unavailableLocationIds.has(location.id),
          }))
        : undefined,
    };

    onSubmit(input);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-surface-100">
          Create Custom Exercise
        </h2>
        <p className="text-sm text-surface-400 mt-1">
          Just the basics — AI fills in the rest, and you can fine-tune anything next.
        </p>
      </div>

      <div className="space-y-4">
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
            Description <span className="text-surface-500 font-normal">(optional)</span>
          </label>
          <textarea
            className="w-full rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5
              text-surface-100 placeholder:text-surface-500
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
              transition-all duration-200 resize-none"
            rows={3}
            placeholder="e.g., Seated, knees bent, push through the balls of your feet"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="mt-1.5 text-sm text-surface-500">
            A quick note helps the AI get the details right.
          </p>
        </div>

        {showLocationPicker && (
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1.5">
              Available At
            </label>
            <div className="space-y-2">
              {gymLocations.map((location) => {
                const isAvailable = !unavailableLocationIds.has(location.id);
                return (
                  <label key={location.id} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAvailable}
                      onChange={(e) => {
                        setUnavailableLocationIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) {
                            next.delete(location.id);
                          } else {
                            next.add(location.id);
                          }
                          return next;
                        });
                      }}
                      className="w-5 h-5 rounded bg-surface-800 border-surface-600
                        text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                    />
                    <span className="text-surface-200">
                      {location.name}
                      {location.is_default && (
                        <span className="text-xs text-surface-500 ml-1">(Default)</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.locations ? (
              <p className="mt-1.5 text-sm text-danger-400">{errors.locations}</p>
            ) : (
              <p className="mt-1.5 text-sm text-surface-500">
                Uncheck gyms that don&apos;t have the equipment for this exercise.
              </p>
            )}
          </div>
        )}

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
                AI will inherit properties from the base exercise and adjust for your variation.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3 pt-4 border-t border-surface-800">
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
          isLoading={isLoading || !locationsLoaded}
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </form>
  );
}
