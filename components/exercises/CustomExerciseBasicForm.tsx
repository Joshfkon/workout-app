'use client';

/**
 * Custom Exercise Basic Form (Phase 1)
 *
 * Collects minimal required input from the user, plus optional detailed fields:
 * - Exercise name (required)
 * - Primary muscle (required)
 * - Equipment (required)
 * - Optional description
 * - Optional variation of existing exercise
 * - Optional detailed fields in collapsible sections
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import type { BasicExerciseInput } from '@/lib/exercises/types';
import { MUSCLE_GROUP_OPTIONS, EQUIPMENT_OPTIONS } from '@/lib/exercises/types';
import type { MuscleGroup, Equipment, MovementPattern, ExerciseDifficulty, FatigueRating, HypertrophyTier, HypertrophyRating } from '@/types/schema';
import type { SpinalLoading, PositionStress } from '@/services/exerciseService';
import { getExercises, type Exercise } from '@/services/exerciseService';
import { MOVEMENT_PATTERNS } from '@/types/schema';

interface CustomExerciseBasicFormProps {
  onSubmit: (input: BasicExerciseInput) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  initialData?: Partial<BasicExerciseInput>;
}

const MOVEMENT_PATTERN_OPTIONS: { value: MovementPattern | 'isolation' | 'carry'; label: string }[] = [
  { value: 'horizontal_push', label: 'Horizontal Push' },
  { value: 'horizontal_pull', label: 'Horizontal Pull' },
  { value: 'vertical_push', label: 'Vertical Push' },
  { value: 'vertical_pull', label: 'Vertical Pull' },
  { value: 'hip_hinge', label: 'Hip Hinge' },
  { value: 'squat', label: 'Squat' },
  { value: 'lunge', label: 'Lunge' },
  { value: 'knee_flexion', label: 'Knee Flexion' },
  { value: 'elbow_flexion', label: 'Elbow Flexion' },
  { value: 'elbow_extension', label: 'Elbow Extension' },
  { value: 'shoulder_isolation', label: 'Shoulder Isolation' },
  { value: 'calf_raise', label: 'Calf Raise' },
  { value: 'core', label: 'Core' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'carry', label: 'Carry' },
];

const DIFFICULTY_OPTIONS: { value: ExerciseDifficulty; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const FATIGUE_RATING_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: 'Low (1)' },
  { value: '2', label: 'Moderate (2)' },
  { value: '3', label: 'High (3)' },
];

const SPINAL_LOADING_OPTIONS: { value: SpinalLoading; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
];

const HYPERTROPHY_TIER_OPTIONS: { value: HypertrophyTier; label: string }[] = [
  { value: 'S', label: 'S (Best)' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
  { value: 'F', label: 'F (Worst)' },
];

const HYPERTROPHY_RATING_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 (Low)' },
  { value: '2', label: '2' },
  { value: '3', label: '3 (Moderate)' },
  { value: '4', label: '4' },
  { value: '5', label: '5 (High)' },
];

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

  // Optional detailed fields
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>(initialData?.secondaryMuscles || []);
  const [pattern, setPattern] = useState<MovementPattern | 'isolation' | 'carry' | ''>(initialData?.pattern || '');
  const [mechanic, setMechanic] = useState<'compound' | 'isolation' | ''>(initialData?.mechanic || '');
  const [difficulty, setDifficulty] = useState<ExerciseDifficulty | ''>(initialData?.difficulty || '');
  const [fatigueRating, setFatigueRating] = useState<string>(initialData?.fatigueRating?.toString() || '');
  const [defaultRepRangeMin, setDefaultRepRangeMin] = useState<string>(initialData?.defaultRepRange?.[0]?.toString() || '');
  const [defaultRepRangeMax, setDefaultRepRangeMax] = useState<string>(initialData?.defaultRepRange?.[1]?.toString() || '');
  const [defaultRir, setDefaultRir] = useState<string>(initialData?.defaultRir?.toString() || '');
  const [minWeightIncrement, setMinWeightIncrement] = useState<string>(initialData?.minWeightIncrementKg?.toString() || '');
  const [formCues, setFormCues] = useState<string[]>(initialData?.formCues || []);
  const [formCueInput, setFormCueInput] = useState('');
  const [commonMistakes, setCommonMistakes] = useState<string[]>(initialData?.commonMistakes || []);
  const [mistakeInput, setMistakeInput] = useState('');
  const [setupNote, setSetupNote] = useState(initialData?.setupNote || '');
  const [spinalLoading, setSpinalLoading] = useState<SpinalLoading | ''>(initialData?.spinalLoading || '');
  const [stabilizers, setStabilizers] = useState<string[]>(initialData?.stabilizers || []);
  const [requiresBackArch, setRequiresBackArch] = useState(initialData?.requiresBackArch || false);
  const [requiresSpinalFlexion, setRequiresSpinalFlexion] = useState(initialData?.requiresSpinalFlexion || false);
  const [requiresSpinalExtension, setRequiresSpinalExtension] = useState(initialData?.requiresSpinalExtension || false);
  const [requiresSpinalRotation, setRequiresSpinalRotation] = useState(initialData?.requiresSpinalRotation || false);
  const [positionStress, setPositionStress] = useState<PositionStress>(initialData?.positionStress || {});
  const [contraindications, setContraindications] = useState<string[]>(initialData?.contraindications || []);
  const [contraindicationInput, setContraindicationInput] = useState('');
  const [hypertrophyTier, setHypertrophyTier] = useState<HypertrophyTier | ''>(initialData?.hypertrophyTier || '');
  const [stretchUnderLoad, setStretchUnderLoad] = useState<string>(initialData?.stretchUnderLoad?.toString() || '');
  const [resistanceProfile, setResistanceProfile] = useState<string>(initialData?.resistanceProfile?.toString() || '');
  const [progressionEase, setProgressionEase] = useState<string>(initialData?.progressionEase?.toString() || '');

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

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

  const addFormCue = () => {
    if (formCueInput.trim()) {
      setFormCues([...formCues, formCueInput.trim()]);
      setFormCueInput('');
    }
  };

  const removeFormCue = (index: number) => {
    setFormCues(formCues.filter((_, i) => i !== index));
  };

  const addMistake = () => {
    if (mistakeInput.trim()) {
      setCommonMistakes([...commonMistakes, mistakeInput.trim()]);
      setMistakeInput('');
    }
  };

  const removeMistake = (index: number) => {
    setCommonMistakes(commonMistakes.filter((_, i) => i !== index));
  };

  const addContraindication = () => {
    if (contraindicationInput.trim()) {
      setContraindications([...contraindications, contraindicationInput.trim()]);
      setContraindicationInput('');
    }
  };

  const removeContraindication = (index: number) => {
    setContraindications(contraindications.filter((_, i) => i !== index));
  };

  const toggleMuscleSelection = (muscle: string, list: string[], setter: (list: string[]) => void) => {
    if (list.includes(muscle)) {
      setter(list.filter(m => m !== muscle));
    } else {
      setter([...list, muscle]);
    }
  };

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

    const input: BasicExerciseInput = {
      name: name.trim(),
      primaryMuscle: primaryMuscle as MuscleGroup,
      equipment: equipment as Equipment,
      description: description.trim() || undefined,
      variationOf: isVariation ? variationOf : undefined,
      variationOfName: selectedExercise?.name,
    };

    // Add optional fields if provided
    if (secondaryMuscles.length > 0) input.secondaryMuscles = secondaryMuscles;
    if (pattern) input.pattern = pattern as MovementPattern | 'isolation' | 'carry';
    if (mechanic) input.mechanic = mechanic as 'compound' | 'isolation';
    if (difficulty) input.difficulty = difficulty as ExerciseDifficulty;
    if (fatigueRating) input.fatigueRating = parseInt(fatigueRating) as FatigueRating;
    if (defaultRepRangeMin && defaultRepRangeMax) {
      input.defaultRepRange = [parseInt(defaultRepRangeMin), parseInt(defaultRepRangeMax)];
    }
    if (defaultRir) input.defaultRir = parseInt(defaultRir);
    if (minWeightIncrement) input.minWeightIncrementKg = parseFloat(minWeightIncrement);
    if (formCues.length > 0) input.formCues = formCues;
    if (commonMistakes.length > 0) input.commonMistakes = commonMistakes;
    if (setupNote.trim()) input.setupNote = setupNote.trim();
    if (spinalLoading) input.spinalLoading = spinalLoading as SpinalLoading;
    if (stabilizers.length > 0) input.stabilizers = stabilizers;
    if (requiresBackArch) input.requiresBackArch = requiresBackArch;
    if (requiresSpinalFlexion) input.requiresSpinalFlexion = requiresSpinalFlexion;
    if (requiresSpinalExtension) input.requiresSpinalExtension = requiresSpinalExtension;
    if (requiresSpinalRotation) input.requiresSpinalRotation = requiresSpinalRotation;
    if (Object.keys(positionStress).length > 0) input.positionStress = positionStress;
    if (contraindications.length > 0) input.contraindications = contraindications;
    if (hypertrophyTier) input.hypertrophyTier = hypertrophyTier as HypertrophyTier;
    if (stretchUnderLoad) input.stretchUnderLoad = parseInt(stretchUnderLoad) as HypertrophyRating;
    if (resistanceProfile) input.resistanceProfile = parseInt(resistanceProfile) as HypertrophyRating;
    if (progressionEase) input.progressionEase = parseInt(progressionEase) as HypertrophyRating;

    onSubmit(input);
  };

  const CollapsibleSection = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => {
    const isExpanded = expandedSections.has(id);
    return (
      <div className="border border-surface-800 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(id)}
          className="w-full px-4 py-3 bg-surface-800/50 hover:bg-surface-800 flex items-center justify-between transition-colors"
        >
          <span className="text-sm font-medium text-surface-200">{title}</span>
          <svg
            className={`w-5 h-5 text-surface-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isExpanded && <div className="p-4 space-y-4">{children}</div>}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-surface-100">
          Create Custom Exercise
        </h2>
        <p className="text-sm text-surface-400 mt-1">
          Enter the basics - AI will complete any missing technical details
        </p>
      </div>

      {/* Required Fields */}
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
                AI will inherit properties from the base exercise and adjust for your variation
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Optional Detailed Fields */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-surface-300">Optional Details (AI will fill these if left empty)</p>

        <CollapsibleSection id="movement" title="Movement Details">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Secondary Muscles</label>
              <div className="flex flex-wrap gap-2">
                {MUSCLE_GROUP_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleMuscleSelection(value, secondaryMuscles, setSecondaryMuscles)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      secondaryMuscles.includes(value)
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <Select
              label="Movement Pattern"
              options={MOVEMENT_PATTERN_OPTIONS}
              value={pattern}
              onChange={(e) => setPattern(e.target.value as MovementPattern | 'isolation' | 'carry')}
              placeholder="Select movement pattern"
            />

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Mechanic Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMechanic(mechanic === 'compound' ? '' : 'compound')}
                  className={`p-3 rounded-lg text-center transition-colors ${
                    mechanic === 'compound'
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  <p className="font-medium">Compound</p>
                  <p className="text-xs opacity-75 mt-0.5">Multi-joint</p>
                </button>
                <button
                  type="button"
                  onClick={() => setMechanic(mechanic === 'isolation' ? '' : 'isolation')}
                  className={`p-3 rounded-lg text-center transition-colors ${
                    mechanic === 'isolation'
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  <p className="font-medium">Isolation</p>
                  <p className="text-xs opacity-75 mt-0.5">Single-joint</p>
                </button>
              </div>
            </div>

            <Select
              label="Difficulty"
              options={DIFFICULTY_OPTIONS}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as ExerciseDifficulty)}
              placeholder="Select difficulty"
            />

            <Select
              label="Fatigue Rating"
              options={FATIGUE_RATING_OPTIONS}
              value={fatigueRating}
              onChange={(e) => setFatigueRating(e.target.value)}
              placeholder="Select fatigue rating"
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="progression" title="Progression Settings">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Default Rep Range</label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  value={defaultRepRangeMin}
                  onChange={(e) => setDefaultRepRangeMin(e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={defaultRepRangeMax}
                  onChange={(e) => setDefaultRepRangeMax(e.target.value)}
                />
              </div>
            </div>

            <Input
              type="number"
              label="Default RIR (Reps In Reserve)"
              placeholder="e.g., 2"
              value={defaultRir}
              onChange={(e) => setDefaultRir(e.target.value)}
            />

            <Input
              type="number"
              step="0.5"
              label="Min Weight Increment (kg)"
              placeholder="e.g., 2.5"
              value={minWeightIncrement}
              onChange={(e) => setMinWeightIncrement(e.target.value)}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="form" title="Form Guidance">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Form Cues</label>
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="Add form cue..."
                  value={formCueInput}
                  onChange={(e) => setFormCueInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addFormCue();
                    }
                  }}
                />
                <Button type="button" variant="secondary" onClick={addFormCue}>Add</Button>
              </div>
              {formCues.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formCues.map((cue, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-surface-800 rounded text-sm text-surface-200"
                    >
                      {cue}
                      <button
                        type="button"
                        onClick={() => removeFormCue(index)}
                        className="text-surface-400 hover:text-surface-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Common Mistakes</label>
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="Add common mistake..."
                  value={mistakeInput}
                  onChange={(e) => setMistakeInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addMistake();
                    }
                  }}
                />
                <Button type="button" variant="secondary" onClick={addMistake}>Add</Button>
              </div>
              {commonMistakes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {commonMistakes.map((mistake, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-surface-800 rounded text-sm text-surface-200"
                    >
                      {mistake}
                      <button
                        type="button"
                        onClick={() => removeMistake(index)}
                        className="text-surface-400 hover:text-surface-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Setup Note</label>
              <textarea
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5
                  text-surface-100 placeholder:text-surface-500
                  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                  transition-all duration-200 resize-none"
                rows={3}
                placeholder="Setup instructions or notes..."
                value={setupNote}
                onChange={(e) => setSetupNote(e.target.value)}
              />
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="safety" title="Safety & Injury Metadata">
          <div className="space-y-4">
            <Select
              label="Spinal Loading"
              options={SPINAL_LOADING_OPTIONS}
              value={spinalLoading}
              onChange={(e) => setSpinalLoading(e.target.value as SpinalLoading)}
              placeholder="Select spinal loading level"
            />

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Stabilizers</label>
              <div className="flex flex-wrap gap-2">
                {MUSCLE_GROUP_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleMuscleSelection(value, stabilizers, setStabilizers)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      stabilizers.includes(value)
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-surface-200">Spinal Requirements</label>
              {[
                { key: 'requiresBackArch', label: 'Requires Back Arch', state: requiresBackArch, setter: setRequiresBackArch },
                { key: 'requiresSpinalFlexion', label: 'Requires Spinal Flexion', state: requiresSpinalFlexion, setter: setRequiresSpinalFlexion },
                { key: 'requiresSpinalExtension', label: 'Requires Spinal Extension', state: requiresSpinalExtension, setter: setRequiresSpinalExtension },
                { key: 'requiresSpinalRotation', label: 'Requires Spinal Rotation', state: requiresSpinalRotation, setter: setRequiresSpinalRotation },
              ].map(({ key, label, state, setter }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={state}
                    onChange={(e) => setter(e.target.checked)}
                    className="w-4 h-4 rounded bg-surface-800 border-surface-600
                      text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                  />
                  <span className="text-sm text-surface-300">{label}</span>
                </label>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Position Stress Areas</label>
              <div className="grid grid-cols-2 gap-2">
                {['lowerBack', 'upperBack', 'shoulders', 'knees', 'wrists', 'elbows', 'hips', 'neck'].map((area) => (
                  <label key={area} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={positionStress[area as keyof PositionStress] || false}
                      onChange={(e) => setPositionStress({ ...positionStress, [area]: e.target.checked })}
                      className="w-4 h-4 rounded bg-surface-800 border-surface-600
                        text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                    />
                    <span className="text-sm text-surface-300 capitalize">{area.replace(/([A-Z])/g, ' $1').trim()}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-2">Contraindications</label>
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="e.g., herniated_disc, shoulder_impingement"
                  value={contraindicationInput}
                  onChange={(e) => setContraindicationInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addContraindication();
                    }
                  }}
                />
                <Button type="button" variant="secondary" onClick={addContraindication}>Add</Button>
              </div>
              {contraindications.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {contraindications.map((contra, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-surface-800 rounded text-sm text-surface-200"
                    >
                      {contra}
                      <button
                        type="button"
                        onClick={() => removeContraindication(index)}
                        className="text-surface-400 hover:text-surface-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="hypertrophy" title="Hypertrophy Scoring">
          <div className="space-y-4">
            <Select
              label="Hypertrophy Tier"
              options={HYPERTROPHY_TIER_OPTIONS}
              value={hypertrophyTier}
              onChange={(e) => setHypertrophyTier(e.target.value as HypertrophyTier)}
              placeholder="Select hypertrophy tier"
            />

            <Select
              label="Stretch Under Load (1-5)"
              options={HYPERTROPHY_RATING_OPTIONS}
              value={stretchUnderLoad}
              onChange={(e) => setStretchUnderLoad(e.target.value)}
              placeholder="Select rating"
            />

            <Select
              label="Resistance Profile (1-5)"
              options={HYPERTROPHY_RATING_OPTIONS}
              value={resistanceProfile}
              onChange={(e) => setResistanceProfile(e.target.value)}
              placeholder="Select rating"
            />

            <Select
              label="Progression Ease (1-5)"
              options={HYPERTROPHY_RATING_OPTIONS}
              value={progressionEase}
              onChange={(e) => setProgressionEase(e.target.value)}
              placeholder="Select rating"
            />
          </div>
        </CollapsibleSection>
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
          isLoading={isLoading}
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </form>
  );
}
