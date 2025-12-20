'use client';

import { useState, useEffect } from 'react';
import { Modal, Button, Badge } from '@/components/ui';
import type { Exercise, WarmupSet } from '@/types/schema';
import {
  WarmupPromptResult,
  WarmupPreferences,
  generalWarmupChecklist,
  generateIsolationWarmupSets,
  convertToStandardWarmupSets,
} from '@/lib/training/warmup-suggestions';

interface SuggestedCompoundExercise {
  id: string;
  name: string;
  primaryMuscle: string;
  mechanic: 'compound' | 'isolation';
}

export interface WarmupPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptResult: WarmupPromptResult;
  suggestedExercises: SuggestedCompoundExercise[];
  workingWeight: number;
  preferredMethod: WarmupPreferences['preferredWarmupMethod'];
  onAddCompound: (exercise: SuggestedCompoundExercise) => void;
  onAddLightSets: (warmupSets: WarmupSet[]) => void;
  onGeneralWarmup: () => void;
  onAlreadyWarm: () => void;
}

type WarmupOption = 'compound' | 'light_sets' | 'general' | 'already_warm';

export function WarmupPromptModal({
  isOpen,
  onClose,
  promptResult,
  suggestedExercises,
  workingWeight,
  preferredMethod,
  onAddCompound,
  onAddLightSets,
  onGeneralWarmup,
  onAlreadyWarm,
}: WarmupPromptModalProps) {
  const [selectedOption, setSelectedOption] = useState<WarmupOption | null>(null);
  const [selectedCompound, setSelectedCompound] = useState<SuggestedCompoundExercise | null>(null);
  const [generalWarmupChecks, setGeneralWarmupChecks] = useState<Record<string, boolean>>({});

  // Auto-select preferred method if user has one
  useEffect(() => {
    if (preferredMethod && preferredMethod !== 'none') {
      if (preferredMethod === 'compound') setSelectedOption('compound');
      else if (preferredMethod === 'light_sets') setSelectedOption('light_sets');
      else if (preferredMethod === 'general') setSelectedOption('general');
    }
  }, [preferredMethod]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedOption(null);
      setSelectedCompound(null);
      setGeneralWarmupChecks({});
    }
  }, [isOpen]);

  const exerciseName = promptResult.exercise?.name || 'this exercise';
  const isolationWarmupSets = generateIsolationWarmupSets(workingWeight);

  const handleConfirm = () => {
    switch (selectedOption) {
      case 'compound':
        if (selectedCompound) {
          onAddCompound(selectedCompound);
        }
        break;
      case 'light_sets':
        onAddLightSets(convertToStandardWarmupSets(isolationWarmupSets));
        break;
      case 'general':
        onGeneralWarmup();
        break;
      case 'already_warm':
        onAlreadyWarm();
        break;
    }
    onClose();
  };

  const canConfirm = () => {
    if (!selectedOption) return false;
    if (selectedOption === 'compound' && !selectedCompound) return false;
    return true;
  };

  const formatWeight = (weight: number, multiplier: number) => {
    const calculated = weight * multiplier;
    return calculated.toFixed(1);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Starting with ${exerciseName}?`}
      size="lg"
    >
      <div className="space-y-5">
        {/* Subtext */}
        <p className="text-sm text-surface-400">
          Isolation exercises work best after you're warmed up. Choose how you'd like to prepare:
        </p>

        {/* Option 1: Add warmup compound */}
        <div
          className={`p-4 rounded-lg border cursor-pointer transition-all ${
            selectedOption === 'compound'
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-surface-700 hover:border-surface-600'
          }`}
          onClick={() => setSelectedOption('compound')}
        >
          <div className="flex items-center gap-3 mb-2">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selectedOption === 'compound'
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-surface-500'
              }`}
            >
              {selectedOption === 'compound' && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <div>
              <span className="text-surface-100 font-medium">Add warmup compound</span>
              <p className="text-xs text-surface-500 mt-0.5">
                Add a compound exercise first to warm up the target muscles
              </p>
            </div>
          </div>

          {selectedOption === 'compound' && suggestedExercises.length > 0 && (
            <div className="mt-3 ml-8 space-y-2">
              <p className="text-xs text-surface-400 mb-2">Select a compound exercise:</p>
              <div className="space-y-2">
                {suggestedExercises.map((exercise) => (
                  <button
                    key={exercise.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCompound(exercise);
                    }}
                    className={`w-full p-3 rounded-lg text-left transition-all ${
                      selectedCompound?.id === exercise.id
                        ? 'bg-primary-500/20 border border-primary-500'
                        : 'bg-surface-800 border border-surface-700 hover:border-surface-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-surface-200">{exercise.name}</span>
                      <Badge variant="default" size="sm">
                        {exercise.primaryMuscle}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
              {suggestedExercises.length === 0 && (
                <p className="text-xs text-surface-500 italic">
                  No compound suggestions available for this muscle group
                </p>
              )}
            </div>
          )}
        </div>

        {/* Option 2: Add light warmup sets */}
        <div
          className={`p-4 rounded-lg border cursor-pointer transition-all ${
            selectedOption === 'light_sets'
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-surface-700 hover:border-surface-600'
          }`}
          onClick={() => setSelectedOption('light_sets')}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selectedOption === 'light_sets'
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-surface-500'
              }`}
            >
              {selectedOption === 'light_sets' && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <span className="text-surface-100 font-medium">Add light warmup sets</span>
              <p className="text-xs text-surface-500 mt-0.5">
                Add 2 warmup sets to {exerciseName}
              </p>
            </div>
          </div>

          {selectedOption === 'light_sets' && (
            <div className="mt-3 ml-8 space-y-2">
              {isolationWarmupSets.map((set) => (
                <div
                  key={set.setNumber}
                  className="flex items-center justify-between p-2 bg-surface-800 rounded-lg"
                >
                  <span className="text-sm text-surface-300">Set {set.setNumber}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-surface-400">
                      {formatWeight(workingWeight, set.weightMultiplier)} kg
                    </span>
                    <span className="text-sm text-surface-400">× {set.targetReps} reps</span>
                    <Badge variant="default" size="sm">
                      {Math.round(set.weightMultiplier * 100)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Option 3: General warmup only */}
        <div
          className={`p-4 rounded-lg border cursor-pointer transition-all ${
            selectedOption === 'general'
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-surface-700 hover:border-surface-600'
          }`}
          onClick={() => setSelectedOption('general')}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selectedOption === 'general'
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-surface-500'
              }`}
            >
              {selectedOption === 'general' && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <div>
              <span className="text-surface-100 font-medium">General warmup only</span>
              <p className="text-xs text-surface-500 mt-0.5">
                Do a quick general warmup before starting
              </p>
            </div>
          </div>

          {selectedOption === 'general' && (
            <div className="mt-3 ml-8 space-y-2">
              <p className="text-xs text-surface-400 mb-2">Recommended warmup checklist:</p>
              {generalWarmupChecklist.map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-3 p-2 bg-surface-800 rounded-lg cursor-pointer hover:bg-surface-750"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={generalWarmupChecks[item.id] || false}
                    onChange={(e) =>
                      setGeneralWarmupChecks((prev) => ({
                        ...prev,
                        [item.id]: e.target.checked,
                      }))
                    }
                    className="mt-0.5 w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm text-surface-200">{item.label}</span>
                    {item.description && (
                      <p className="text-xs text-surface-500">{item.description}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Option 4: Already warm */}
        <div
          className={`p-4 rounded-lg border cursor-pointer transition-all ${
            selectedOption === 'already_warm'
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-surface-700 hover:border-surface-600'
          }`}
          onClick={() => setSelectedOption('already_warm')}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selectedOption === 'already_warm'
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-surface-500'
              }`}
            >
              {selectedOption === 'already_warm' && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <div>
              <span className="text-surface-100 font-medium">I'm already warm</span>
              <p className="text-xs text-surface-500 mt-0.5">
                Skip warmup suggestions for this workout
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-800">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!canConfirm()}
          >
            Continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
