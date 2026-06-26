'use client';

import { Input } from '@/components/ui';
import type { AvailableExercise } from '../_lib/types';

type AddExerciseSortOption = 'frequency' | 'name' | 'recent';

interface AddExerciseModalProps {
  /**
   * 'main' renders the full modal (Input component, create-custom button, error display).
   * 'empty' renders the empty-state variant (raw input, no create-custom button, no error display).
   * The two variants preserve the exact DOM that previously lived inline in the page.
   */
  variant: 'main' | 'empty';
  availableExercises: AvailableExercise[];
  frequentExerciseIds: Map<string, number>;
  lastDoneExercises: Map<string, Date>;
  selectedExercisesToAdd: AvailableExercise[];
  isAddingExercise: boolean;
  exerciseSearch: string;
  selectedMuscleFilter: string | null;
  showMuscleDropdown: boolean;
  showSortDropdown: boolean;
  exerciseSortOption: AddExerciseSortOption;
  error?: string | null;
  onClose: () => void;
  onExerciseSearchChange: (value: string) => void;
  onSelectedMuscleFilterChange: (muscle: string | null) => void;
  onShowMuscleDropdownChange: (show: boolean) => void;
  onShowSortDropdownChange: (show: boolean) => void;
  onExerciseSortOptionChange: (option: AddExerciseSortOption) => void;
  onToggleExerciseSelection: (exercise: AvailableExercise) => void;
  onAddSelectedExercises: () => void;
  onCreateCustomExercise?: () => void;
}

export function AddExerciseModal({
  variant,
  availableExercises,
  frequentExerciseIds,
  lastDoneExercises,
  selectedExercisesToAdd,
  isAddingExercise,
  exerciseSearch,
  selectedMuscleFilter,
  showMuscleDropdown,
  showSortDropdown,
  exerciseSortOption,
  error,
  onClose,
  onExerciseSearchChange,
  onSelectedMuscleFilterChange,
  onShowMuscleDropdownChange,
  onShowSortDropdownChange,
  onExerciseSortOptionChange,
  onToggleExerciseSelection,
  onAddSelectedExercises,
  onCreateCustomExercise,
}: AddExerciseModalProps) {
  const emptyStateMessageClass = variant === 'empty' ? 'text-surface-400' : 'text-surface-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[80vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-surface-800 flex items-center justify-between">
          <button
            onClick={onClose}
            className="p-2 text-surface-400 hover:text-surface-200 -ml-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-surface-100">Add Exercise</h2>
          <button
            onClick={onAddSelectedExercises}
            disabled={selectedExercisesToAdd.length === 0 || isAddingExercise}
            className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-colors ${
              selectedExercisesToAdd.length > 0
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'bg-surface-700 text-surface-500 cursor-not-allowed'
            }`}
          >
            {isAddingExercise ? 'Adding...' : `Add${selectedExercisesToAdd.length > 0 ? ` (${selectedExercisesToAdd.length})` : ''}`}
          </button>
        </div>

        {/* Search and Filters */}
        <div className={variant === 'empty' ? 'p-4 border-b border-surface-800 space-y-3' : 'p-4 space-y-3 border-b border-surface-800'}>
          {variant === 'empty' ? (
            <input
              type="text"
              value={exerciseSearch}
              onChange={(e) => onExerciseSearchChange(e.target.value)}
              placeholder="Search exercises..."
              className="w-full px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500"
            />
          ) : (
            <Input
              placeholder="Search exercises..."
              value={exerciseSearch}
              onChange={(e) => onExerciseSearchChange(e.target.value)}
            />
          )}

          {/* Body Part Dropdown and Sort Button */}
          <div className="flex gap-2">
            {/* Body Part Dropdown */}
            <div className="relative flex-1">
              <button
                onClick={() => { onShowMuscleDropdownChange(!showMuscleDropdown); onShowSortDropdownChange(false); }}
                className="w-full flex items-center justify-between px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 hover:bg-surface-700 transition-colors"
              >
                <span className={selectedMuscleFilter ? 'capitalize' : 'text-surface-400'}>
                  {selectedMuscleFilter || 'Any Body Part'}
                </span>
                <svg className={`w-4 h-4 text-surface-400 transition-transform ${showMuscleDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {showMuscleDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => { onSelectedMuscleFilterChange(null); onShowMuscleDropdownChange(false); }}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                      !selectedMuscleFilter ? 'text-primary-400' : 'text-surface-200'
                    }`}
                  >
                    <span>Any Body Part</span>
                    {!selectedMuscleFilter && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  {(() => {
                    const muscles = Array.from(new Set(availableExercises.map(ex => ex.primary_muscle).filter(Boolean))).sort();
                    return muscles.map(muscle => (
                      <button
                        key={muscle}
                        onClick={() => { onSelectedMuscleFilterChange(muscle!); onShowMuscleDropdownChange(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors capitalize flex items-center justify-between ${
                          selectedMuscleFilter === muscle ? 'text-primary-400' : 'text-surface-200'
                        }`}
                      >
                        <span>{muscle}</span>
                        {selectedMuscleFilter === muscle && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>

            {/* Sort Button */}
            <div className="relative">
              <button
                onClick={() => { onShowSortDropdownChange(!showSortDropdown); onShowMuscleDropdownChange(false); }}
                className="flex items-center justify-center px-3 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors"
                title="Sort exercises"
              >
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>

              {/* Sort Dropdown */}
              {showSortDropdown && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10">
                  <button
                    onClick={() => { onExerciseSortOptionChange('frequency'); onShowSortDropdownChange(false); }}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                      exerciseSortOption === 'frequency' ? 'text-primary-400' : 'text-surface-200'
                    }`}
                  >
                    <span>Most Frequent</span>
                    {exerciseSortOption === 'frequency' && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => { onExerciseSortOptionChange('recent'); onShowSortDropdownChange(false); }}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                      exerciseSortOption === 'recent' ? 'text-primary-400' : 'text-surface-200'
                    }`}
                  >
                    <span>Recently Done</span>
                    {exerciseSortOption === 'recent' && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => { onExerciseSortOptionChange('name'); onShowSortDropdownChange(false); }}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                      exerciseSortOption === 'name' ? 'text-primary-400' : 'text-surface-200'
                    }`}
                  >
                    <span>Name (A-Z)</span>
                    {exerciseSortOption === 'name' && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {variant === 'main' && (
            <>
              {/* Create custom exercise button */}
              <button
                onClick={onCreateCustomExercise}
                className="w-full p-3 bg-surface-800/50 hover:bg-surface-800 rounded-lg border border-dashed border-surface-600 hover:border-primary-500/50 transition-all flex items-center justify-center gap-2 text-surface-400 hover:text-primary-400"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm font-medium">Create Custom Exercise</span>
              </button>

              {/* Error display */}
              {error && (
                <div className="mt-2 p-2 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-xs">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Exercise List */}
        <div className="flex-1 overflow-y-auto">
          {(() => {
            let filteredExercises = availableExercises;

            // Filter by muscle
            if (selectedMuscleFilter) {
              filteredExercises = filteredExercises.filter(ex => ex.primary_muscle === selectedMuscleFilter);
            }

            // Filter by search
            if (exerciseSearch) {
              filteredExercises = filteredExercises.filter(ex =>
                ex.name.toLowerCase().includes(exerciseSearch.toLowerCase())
              );
            }

            // Sort based on selected option
            filteredExercises = [...filteredExercises].sort((a, b) => {
              switch (exerciseSortOption) {
                case 'frequency': {
                  // Sort by frequency (highest first), then by name for ties
                  const freqA = frequentExerciseIds.get(a.id) || 0;
                  const freqB = frequentExerciseIds.get(b.id) || 0;
                  if (freqB !== freqA) return freqB - freqA;
                  return a.name.localeCompare(b.name);
                }
                case 'recent': {
                  // Sort by most recently done first, then by name for ties
                  const dateA = lastDoneExercises.get(a.id);
                  const dateB = lastDoneExercises.get(b.id);
                  // Exercises without a date go to the bottom
                  if (!dateA && !dateB) return a.name.localeCompare(b.name);
                  if (!dateA) return 1;
                  if (!dateB) return -1;
                  return dateB.getTime() - dateA.getTime();
                }
                case 'name':
                default:
                  return a.name.localeCompare(b.name);
              }
            });

            if (availableExercises.length === 0) {
              return <p className={`text-center ${emptyStateMessageClass} py-8`}>Loading exercises...</p>;
            }

            if (filteredExercises.length === 0) {
              return <p className={`text-center ${emptyStateMessageClass} py-8`}>No exercises found</p>;
            }

            return filteredExercises.map((exercise) => {
              const isSelected = selectedExercisesToAdd.some(e => e.id === exercise.id);
              return (
                <button
                  key={exercise.id}
                  onClick={() => onToggleExerciseSelection(exercise)}
                  disabled={isAddingExercise}
                  className={`w-full flex items-center justify-between p-4 transition-colors text-left disabled:opacity-50 border-b border-surface-800/50 ${
                    isSelected ? 'bg-primary-500/10' : 'hover:bg-surface-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-surface-200">{exercise.name}</span>
                    {frequentExerciseIds.has(exercise.id) && (
                      <span className="text-amber-400 text-sm">★</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      exercise.mechanic === 'compound'
                        ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                        : 'bg-surface-700 text-surface-400'
                    }`}>
                      {exercise.mechanic}
                    </span>
                    {isSelected && (
                      <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
