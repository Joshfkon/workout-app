'use client';

/**
 * Custom Exercise Review Form (Phase 2)
 *
 * Displays AI-completed exercise data for user review and editing.
 * Uses accordion sections to organize the data without overwhelming.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/Accordion';
import type { CompletedExerciseData, ValidationResult } from '@/lib/exercises/types';
import {
  CONFIDENCE_DISPLAY,
  MUSCLE_GROUP_OPTIONS,
} from '@/lib/exercises/types';
import { validateCompletedExercise } from '@/lib/exercises/exercise-ai-completion';
import type { MuscleGroup } from '@/types/schema';
import { ConfidenceIndicator } from './ConfidenceIndicator';
import { MuscleSelector } from './MuscleSelector';
import { FormCuesEditor } from './FormCuesEditor';

interface CustomExerciseReviewFormProps {
  data: CompletedExerciseData;
  onSave: (data: CompletedExerciseData) => void;
  onBack: () => void;
  isSaving?: boolean;
}

export function CustomExerciseReviewForm({
  data,
  onSave,
  onBack,
  isSaving = false,
}: CustomExerciseReviewFormProps) {
  const [formData, setFormData] = useState<CompletedExerciseData>(data);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);

  // Determine which sections to open by default
  const defaultOpenSections =
    data.aiConfidence === 'low'
      ? ['muscles', 'movement', 'loading', 'safety', 'hypertrophy', 'form']
      : [];

  useEffect(() => {
    const result = validateCompletedExercise(formData);
    setValidation(result);
  }, [formData]);

  const handleSave = () => {
    if (!validation?.valid) return;
    onSave(formData);
  };

  const updateField = <K extends keyof CompletedExerciseData>(
    field: K,
    value: CompletedExerciseData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const confidenceInfo = CONFIDENCE_DISPLAY[formData.aiConfidence];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-xl font-semibold text-surface-100">
          Review Exercise Details
        </h2>
        <p className="text-sm text-surface-400 mt-1">
          AI has analyzed your exercise. Review and adjust if needed.
        </p>
      </div>

      {/* Exercise Name Display */}
      <div className="bg-surface-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-surface-400">Exercise Name</p>
            <p className="text-lg font-medium text-surface-100">{formData.name}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-surface-400">Equipment</p>
            <p className="text-surface-200 capitalize">{formData.equipment}</p>
          </div>
        </div>
      </div>

      {/* Confidence Indicator */}
      <ConfidenceIndicator
        confidence={formData.aiConfidence}
        notes={formData.aiNotes}
      />

      {/* Validation Errors */}
      {validation && validation.errors.length > 0 && (
        <div className="bg-danger-900/30 border border-danger-700 rounded-lg p-4">
          <p className="text-danger-400 font-medium mb-2">
            Please fix the following errors:
          </p>
          <ul className="list-disc list-inside text-sm text-danger-300 space-y-1">
            {validation.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Validation Warnings */}
      {validation && validation.warnings.length > 0 && (
        <div className="bg-warning-900/30 border border-warning-700 rounded-lg p-4">
          <p className="text-warning-400 font-medium mb-2">Suggestions:</p>
          <ul className="list-disc list-inside text-sm text-warning-300 space-y-1">
            {validation.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Accordion Sections */}
      <Accordion type="multiple" defaultOpen={defaultOpenSections}>
        {/* Muscles Section */}
        <AccordionItem id="muscles">
          <AccordionTrigger id="muscles">
            <span className="flex items-center gap-2">
              Muscles
              <span className="text-sm text-surface-500">
                ({formData.secondaryMuscles.length} secondary,{' '}
                {formData.stabilizers.length} stabilizers)
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent id="muscles">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-surface-400 mb-1">Primary</p>
                <p className="text-surface-200 capitalize">
                  {formData.primaryMuscle}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-surface-400">Secondary Muscles</p>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSection(
                        editingSection === 'secondary' ? null : 'secondary'
                      )
                    }
                    className="text-xs text-primary-400 hover:text-primary-300"
                  >
                    {editingSection === 'secondary' ? 'Done' : 'Edit'}
                  </button>
                </div>
                {editingSection === 'secondary' ? (
                  <MuscleSelector
                    selected={formData.secondaryMuscles}
                    onChange={(muscles) => updateField('secondaryMuscles', muscles)}
                    exclude={[formData.primaryMuscle]}
                  />
                ) : (
                  <p className="text-surface-200">
                    {formData.secondaryMuscles.length > 0
                      ? formData.secondaryMuscles
                          .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
                          .join(', ')
                      : 'None'}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-surface-400">Stabilizer Muscles</p>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSection(
                        editingSection === 'stabilizers' ? null : 'stabilizers'
                      )
                    }
                    className="text-xs text-primary-400 hover:text-primary-300"
                  >
                    {editingSection === 'stabilizers' ? 'Done' : 'Edit'}
                  </button>
                </div>
                {editingSection === 'stabilizers' ? (
                  <MuscleSelector
                    selected={formData.stabilizers}
                    onChange={(muscles) => updateField('stabilizers', muscles)}
                    exclude={[formData.primaryMuscle]}
                  />
                ) : (
                  <p className="text-surface-200">
                    {formData.stabilizers.length > 0
                      ? formData.stabilizers
                          .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
                          .join(', ')
                      : 'None'}
                  </p>
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Movement Properties Section */}
        <AccordionItem id="movement">
          <AccordionTrigger id="movement">Movement Properties</AccordionTrigger>
          <AccordionContent id="movement">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-surface-400 mb-1">Pattern</p>
                <Select
                  options={[
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
                  ]}
                  value={formData.pattern}
                  onChange={(e) => updateField('pattern', e.target.value as any)}
                />
              </div>

              <div>
                <p className="text-sm text-surface-400 mb-1">Mechanic</p>
                <Select
                  options={[
                    { value: 'compound', label: 'Compound' },
                    { value: 'isolation', label: 'Isolation' },
                  ]}
                  value={formData.mechanic}
                  onChange={(e) =>
                    updateField('mechanic', e.target.value as 'compound' | 'isolation')
                  }
                />
              </div>

              <div>
                <p className="text-sm text-surface-400 mb-1">Difficulty</p>
                <Select
                  options={[
                    { value: 'beginner', label: 'Beginner' },
                    { value: 'intermediate', label: 'Intermediate' },
                    { value: 'advanced', label: 'Advanced' },
                  ]}
                  value={formData.difficulty}
                  onChange={(e) => updateField('difficulty', e.target.value as any)}
                />
              </div>

              <div>
                <p className="text-sm text-surface-400 mb-1">Fatigue Rating</p>
                <Select
                  options={[
                    { value: '1', label: 'Low (1/3)' },
                    { value: '2', label: 'Medium (2/3)' },
                    { value: '3', label: 'High (3/3)' },
                  ]}
                  value={String(formData.fatigueRating)}
                  onChange={(e) =>
                    updateField('fatigueRating', Number(e.target.value) as 1 | 2 | 3)
                  }
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Loading & Progression Section */}
        <AccordionItem id="loading">
          <AccordionTrigger id="loading">Loading & Progression</AccordionTrigger>
          <AccordionContent id="loading">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-surface-400 mb-1">Rep Range</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={formData.defaultRepRange[0]}
                    onChange={(e) =>
                      updateField('defaultRepRange', [
                        Number(e.target.value),
                        formData.defaultRepRange[1],
                      ])
                    }
                    className="w-20"
                    min={1}
                    max={50}
                  />
                  <span className="text-surface-400">to</span>
                  <Input
                    type="number"
                    value={formData.defaultRepRange[1]}
                    onChange={(e) =>
                      updateField('defaultRepRange', [
                        formData.defaultRepRange[0],
                        Number(e.target.value),
                      ])
                    }
                    className="w-20"
                    min={1}
                    max={50}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-surface-400 mb-1">Default RIR</p>
                <Input
                  type="number"
                  value={formData.defaultRir}
                  onChange={(e) => updateField('defaultRir', Number(e.target.value))}
                  min={0}
                  max={5}
                />
              </div>

              <div className="col-span-2">
                <p className="text-sm text-surface-400 mb-1">
                  Min Weight Increment (kg)
                </p>
                <Input
                  type="number"
                  value={formData.minWeightIncrementKg}
                  onChange={(e) =>
                    updateField('minWeightIncrementKg', Number(e.target.value))
                  }
                  step={0.5}
                  min={0}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Safety & Injury Section */}
        <AccordionItem id="safety">
          <AccordionTrigger id="safety">Safety & Injury Considerations</AccordionTrigger>
          <AccordionContent id="safety">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-surface-400 mb-1">Spinal Loading</p>
                <Select
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'low', label: 'Low' },
                    { value: 'moderate', label: 'Moderate' },
                    { value: 'high', label: 'High' },
                  ]}
                  value={formData.spinalLoading}
                  onChange={(e) => updateField('spinalLoading', e.target.value as any)}
                />
              </div>

              <div>
                <p className="text-sm text-surface-400 mb-2">Spinal Requirements</p>
                <div className="space-y-2">
                  {[
                    { key: 'requiresBackArch', label: 'Requires back arch' },
                    { key: 'requiresSpinalFlexion', label: 'Requires spinal flexion' },
                    { key: 'requiresSpinalExtension', label: 'Requires spinal extension' },
                    { key: 'requiresSpinalRotation', label: 'Requires spinal rotation' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData[key as keyof CompletedExerciseData] as boolean}
                        onChange={(e) =>
                          updateField(key as keyof CompletedExerciseData, e.target.checked as any)
                        }
                        className="w-4 h-4 rounded bg-surface-800 border-surface-600
                          text-primary-500 focus:ring-primary-500"
                      />
                      <span className="text-sm text-surface-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-surface-400 mb-2">Position Stress</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'lowerBack', label: 'Lower Back' },
                    { key: 'upperBack', label: 'Upper Back' },
                    { key: 'shoulders', label: 'Shoulders' },
                    { key: 'knees', label: 'Knees' },
                    { key: 'wrists', label: 'Wrists' },
                    { key: 'elbows', label: 'Elbows' },
                    { key: 'hips', label: 'Hips' },
                    { key: 'neck', label: 'Neck' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.positionStress[key as keyof typeof formData.positionStress] || false}
                        onChange={(e) =>
                          updateField('positionStress', {
                            ...formData.positionStress,
                            [key]: e.target.checked,
                          })
                        }
                        className="w-4 h-4 rounded bg-surface-800 border-surface-600
                          text-primary-500 focus:ring-primary-500"
                      />
                      <span className="text-sm text-surface-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-surface-400 mb-2">Contraindications</p>
                <div className="flex flex-wrap gap-2">
                  {formData.contraindications.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-danger-900/30
                        text-danger-300 text-sm rounded"
                    >
                      {c.replace(/_/g, ' ')}
                      <button
                        type="button"
                        onClick={() =>
                          updateField(
                            'contraindications',
                            formData.contraindications.filter((_, idx) => idx !== i)
                          )
                        }
                        className="hover:text-danger-100"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                <Select
                  options={[
                    { value: '', label: 'Add contraindication...' },
                    { value: 'herniated_disc', label: 'Herniated Disc' },
                    { value: 'lower_back_strain', label: 'Lower Back Strain' },
                    { value: 'shoulder_impingement', label: 'Shoulder Impingement' },
                    { value: 'rotator_cuff_injury', label: 'Rotator Cuff Injury' },
                    { value: 'knee_injury', label: 'Knee Injury' },
                    { value: 'wrist_injury', label: 'Wrist Injury' },
                    { value: 'elbow_injury', label: 'Elbow Injury' },
                    { value: 'hip_injury', label: 'Hip Injury' },
                    { value: 'neck_injury', label: 'Neck Injury' },
                  ]}
                  value=""
                  onChange={(e) => {
                    if (
                      e.target.value &&
                      !formData.contraindications.includes(e.target.value)
                    ) {
                      updateField('contraindications', [
                        ...formData.contraindications,
                        e.target.value,
                      ]);
                    }
                  }}
                  className="mt-2"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Hypertrophy Rating Section */}
        <AccordionItem id="hypertrophy">
          <AccordionTrigger id="hypertrophy">
            <span className="flex items-center gap-2">
              Hypertrophy Rating
              <span
                className={`px-2 py-0.5 text-sm font-medium rounded ${
                  formData.hypertrophyScore.tier === 'S'
                    ? 'bg-success-900/50 text-success-300'
                    : formData.hypertrophyScore.tier === 'A'
                    ? 'bg-primary-900/50 text-primary-300'
                    : 'bg-surface-700 text-surface-300'
                }`}
              >
                {formData.hypertrophyScore.tier}-Tier
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent id="hypertrophy">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-surface-400 mb-1">Overall Tier</p>
                <Select
                  options={[
                    { value: 'S', label: 'S - Best in Class' },
                    { value: 'A', label: 'A - Excellent' },
                    { value: 'B', label: 'B - Good' },
                    { value: 'C', label: 'C - Acceptable' },
                    { value: 'D', label: 'D - Below Average' },
                    { value: 'F', label: 'F - Poor' },
                  ]}
                  value={formData.hypertrophyScore.tier}
                  onChange={(e) =>
                    updateField('hypertrophyScore', {
                      ...formData.hypertrophyScore,
                      tier: e.target.value as any,
                    })
                  }
                />
              </div>

              {[
                { key: 'stretchUnderLoad', label: 'Stretch Under Load' },
                { key: 'resistanceProfile', label: 'Resistance Profile' },
                { key: 'progressionEase', label: 'Progression Ease' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-surface-400">{label}</p>
                    <span className="text-sm text-surface-300">
                      {formData.hypertrophyScore[key as keyof typeof formData.hypertrophyScore]}/5
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={formData.hypertrophyScore[key as keyof typeof formData.hypertrophyScore]}
                    onChange={(e) =>
                      updateField('hypertrophyScore', {
                        ...formData.hypertrophyScore,
                        [key]: Number(e.target.value),
                      })
                    }
                    className="w-full h-2 bg-surface-700 rounded-lg appearance-none cursor-pointer
                      accent-primary-500"
                  />
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Form Cues Section */}
        <AccordionItem id="form">
          <AccordionTrigger id="form">
            <span className="flex items-center gap-2">
              Form Cues
              <span className="text-sm text-surface-500">
                ({formData.formCues.length} cues)
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent id="form">
            <FormCuesEditor
              cues={formData.formCues}
              onChange={(cues) => updateField('formCues', cues)}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4 border-t border-surface-800">
        <Button type="button" variant="secondary" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          isLoading={isSaving}
          disabled={!validation?.valid}
          className="flex-1"
        >
          {isSaving ? 'Saving...' : 'Save Exercise'}
        </Button>
      </div>
    </div>
  );
}
