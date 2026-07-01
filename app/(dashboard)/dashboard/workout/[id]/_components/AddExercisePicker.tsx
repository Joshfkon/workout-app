'use client';

/**
 * AddExercisePicker.tsx
 *
 * The add-exercise modal: search (with normalization), muscle / location /
 * sort filters, multi-select list and the "Add (n)" flow.
 *
 * Extracted verbatim from `page.tsx` (Phase 0.2 decomposition). The page
 * historically rendered TWO slightly-divergent copies of this modal:
 *   - variant="empty"   — the empty-workout branch: richer location-equipment
 *     filtering (user-marked unavailable exercises, machine brand/term
 *     detection, bodyweight-only fallback) and the staples "Show all" collapse.
 *   - variant="workout" — the main branch: simpler location filtering, plus
 *     the "Create Custom Exercise" button and inline error display.
 * Both behaviors are preserved exactly; unifying them is a product decision
 * for a later phase, not this refactor.
 *
 * All state stays in the page (several pieces outlive the modal or drive
 * page-level effects); this component is fully controlled.
 */

import { Input } from '@/components/ui';
import { isDefaultVisibleExercise } from '@/services/exerciseStaples';
import type { AvailableExercise, GymLocation } from '../_lib/types';

// Normalize exercise search terms for better matching
// Handles variations like "situps" vs "sit up" vs "sit-up"
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-\s]/g, '')  // Remove hyphens and spaces
    .replace(/s$/, '');     // Remove trailing 's' for basic plural handling
}

export type ExerciseSortOption = 'frequency' | 'name' | 'recent';

export interface AddExercisePickerProps {
  variant: 'empty' | 'workout';
  availableExercises: AvailableExercise[];
  // Search + filter state (owned by the page — it outlives the modal)
  exerciseSearch: string;
  onExerciseSearchChange: (value: string) => void;
  selectedMuscleFilter: string | null;
  onSelectedMuscleFilterChange: (value: string | null) => void;
  showMuscleDropdown: boolean;
  onShowMuscleDropdownChange: (value: boolean) => void;
  showSortDropdown: boolean;
  onShowSortDropdownChange: (value: boolean) => void;
  showLocationDropdown: boolean;
  onShowLocationDropdownChange: (value: boolean) => void;
  exerciseSortOption: ExerciseSortOption;
  onExerciseSortOptionChange: (value: ExerciseSortOption) => void;
  /** Long-tail collapse (variant="empty" list only) */
  showAllExercises: boolean;
  onToggleShowAllExercises: () => void;
  // Location filter data
  gymLocations: GymLocation[];
  selectedLocationFilter: string | null;
  onSelectedLocationFilterChange: (value: string | null) => void;
  locationEquipment: string[];
  unavailableExerciseIds: Set<string>;
  // Usage data for sorting / default visibility
  stapleExerciseIds: Set<string>;
  frequentExerciseIds: Map<string, number>;
  lastDoneExercises: Map<string, Date>;
  // Multi-select
  selectedExercisesToAdd: AvailableExercise[];
  onToggleExerciseSelection: (exercise: AvailableExercise) => void;
  isAddingExercise: boolean;
  // Actions
  onClose: () => void;
  onAddSelected: () => void;
  /** variant="workout" only: opens the custom-exercise creation modal */
  onCreateCustom?: () => void;
  /** variant="workout" only: inline error display */
  error?: string | null;
}

export function AddExercisePicker({
  variant,
  availableExercises,
  exerciseSearch,
  onExerciseSearchChange,
  selectedMuscleFilter,
  onSelectedMuscleFilterChange,
  showMuscleDropdown,
  onShowMuscleDropdownChange,
  showSortDropdown,
  onShowSortDropdownChange,
  showLocationDropdown,
  onShowLocationDropdownChange,
  exerciseSortOption,
  onExerciseSortOptionChange,
  showAllExercises,
  onToggleShowAllExercises,
  gymLocations,
  selectedLocationFilter,
  onSelectedLocationFilterChange,
  locationEquipment,
  unavailableExerciseIds,
  stapleExerciseIds,
  frequentExerciseIds,
  lastDoneExercises,
  selectedExercisesToAdd,
  onToggleExerciseSelection,
  isAddingExercise,
  onClose,
  onAddSelected,
  onCreateCustom,
  error,
}: AddExercisePickerProps) {
  // --- Filtering (kept per-variant: the two inline copies had drifted) ---
  const applyLocationFilterEmptyVariant = (exercises: AvailableExercise[]): AvailableExercise[] => {
    let filteredExercises = exercises;

    // First, filter out exercises the user explicitly marked as unavailable
    if (unavailableExerciseIds.size > 0) {
      filteredExercises = filteredExercises.filter(ex => !unavailableExerciseIds.has(ex.id));
    }

    const normalizedAvailable = locationEquipment.map(eq => eq.toLowerCase().trim());

    // Machine brand prefixes and machine-specific terms that indicate machine exercises
    const machineBrands = ['mts', 'iso-lateral', 'iso lateral', 'hammer strength', 'nautilus', 'cybex', 'life fitness', 'technogym', 'matrix', 'precor', 'hoist', 'star trac', 'freemotion', 'prime', 'arsenal', 'atlantis', 'body-solid', 'icarian', 'strive', 'magnum', 'panatta'];
    const machineTerms = ['leg press', 'leg extension', 'leg curl', 'hack squat', 'pendulum', 'seated row', 'chest press', 'shoulder press machine', 'lat pulldown', 'pec deck', 'fly machine', 'hip abductor', 'hip adductor', 'glute drive', 'calf raise machine', 'reverse hyper', 'back extension machine', 'ab crunch machine', 'torso rotation', 'inner thigh', 'outer thigh', 'belt squat'];

    return filteredExercises.filter(ex => {
      const exerciseNameLower = ex.name.toLowerCase();

      // If location has no equipment, only allow bodyweight exercises
      if (normalizedAvailable.length === 0) {
        return ex.is_bodyweight === true;
      }

      // Check if exercise requires a machine (by brand or term)
      const isMachineExercise =
        machineBrands.some(brand => exerciseNameLower.includes(brand)) ||
        machineTerms.some(term => exerciseNameLower.includes(term));

      // If it's a machine exercise, check if user has machine equipment available
      if (isMachineExercise) {
        const hasMachineEquipment = normalizedAvailable.some(a =>
          a.includes('machine') || a.includes('press') || a.includes('pulldown') ||
          a.includes('leg extension') || a.includes('leg curl') || a.includes('hack') ||
          a.includes('cable') || a.includes('lat pulldown') || a.includes('seated row')
        );
        if (!hasMachineEquipment) return false;
      }

      // If exercise has no equipment requirement, check name for equipment hints
      if (!ex.equipment_required || ex.equipment_required.length === 0) {
        // Check if exercise name indicates specific equipment
        const requiresCable = exerciseNameLower.includes('cable');
        const requiresBarbell = exerciseNameLower.includes('barbell') && !exerciseNameLower.includes('dumbbell');
        const requiresDumbbell = exerciseNameLower.includes('dumbbell') || exerciseNameLower.includes('db ');
        const requiresMachine = exerciseNameLower.includes('machine');
        const requiresSmith = exerciseNameLower.includes('smith');
        const requiresKettlebell = exerciseNameLower.includes('kettlebell') || exerciseNameLower.includes('kb ');
        const requiresBand = exerciseNameLower.includes('band') || exerciseNameLower.includes('resistance band');

        if (requiresCable && !normalizedAvailable.some(a => a.includes('cable'))) return false;
        if (requiresBarbell && !normalizedAvailable.some(a => a.includes('barbell') || a.includes('bar'))) return false;
        if (requiresDumbbell && !normalizedAvailable.some(a => a.includes('dumbbell') || a.includes('db'))) return false;
        if (requiresMachine && !normalizedAvailable.some(a => a.includes('machine'))) return false;
        if (requiresSmith && !normalizedAvailable.some(a => a.includes('smith'))) return false;
        if (requiresKettlebell && !normalizedAvailable.some(a => a.includes('kettlebell') || a.includes('kb'))) return false;
        if (requiresBand && !normalizedAvailable.some(a => a.includes('band'))) return false;

        return true;
      }

      // For exercises with equipment_required, check if ALL required equipment is available
      const requiredEquipment = ex.equipment_required.map(eq => eq.toLowerCase().trim());
      return requiredEquipment.every(reqEq => {
        if (normalizedAvailable.includes(reqEq)) return true;
        return normalizedAvailable.some(avail => reqEq.includes(avail) || avail.includes(reqEq));
      });
    });
  };

  const applyLocationFilterWorkoutVariant = (exercises: AvailableExercise[]): AvailableExercise[] => {
    const normalizedAvailable = locationEquipment.map(eq => eq.toLowerCase().trim());
    return exercises.filter(ex => {
      // If exercise has no equipment requirement, check name for equipment hints
      if (!ex.equipment_required || ex.equipment_required.length === 0) {
        const exerciseNameLower = ex.name.toLowerCase();

        // Check if exercise name indicates specific equipment
        const requiresCable = exerciseNameLower.includes('cable');
        const requiresBarbell = exerciseNameLower.includes('barbell') && !exerciseNameLower.includes('dumbbell');
        const requiresDumbbell = exerciseNameLower.includes('dumbbell') || exerciseNameLower.includes('db ');
        const requiresMachine = exerciseNameLower.includes('machine');
        const requiresSmith = exerciseNameLower.includes('smith');

        if (requiresCable && !normalizedAvailable.some(a => a.includes('cable'))) return false;
        if (requiresBarbell && !normalizedAvailable.some(a => a.includes('barbell') || a.includes('bar'))) return false;
        if (requiresDumbbell && !normalizedAvailable.some(a => a.includes('dumbbell') || a.includes('db'))) return false;
        if (requiresMachine && !normalizedAvailable.some(a => a.includes('machine'))) return false;
        if (requiresSmith && !normalizedAvailable.some(a => a.includes('smith'))) return false;

        return true;
      }

      // For exercises with equipment_required, check if ALL required equipment is available
      const requiredEquipment = ex.equipment_required.map(eq => eq.toLowerCase().trim());
      return requiredEquipment.every(reqEq => {
        if (normalizedAvailable.includes(reqEq)) return true;
        return normalizedAvailable.some(avail => reqEq.includes(avail) || avail.includes(reqEq));
      });
    });
  };

  const getFilteredAndSortedExercises = (): AvailableExercise[] => {
    let filteredExercises = availableExercises;

    // Filter by muscle
    if (selectedMuscleFilter) {
      filteredExercises = filteredExercises.filter(ex => ex.primary_muscle === selectedMuscleFilter);
    }

    // Filter by search
    if (exerciseSearch) {
      const normalizedSearch = normalizeForSearch(exerciseSearch);
      filteredExercises = filteredExercises.filter(ex =>
        normalizeForSearch(ex.name).includes(normalizedSearch)
      );
    }

    // Filter by location equipment (the two variants historically differ here)
    if (variant === 'empty') {
      if (selectedLocationFilter) {
        filteredExercises = applyLocationFilterEmptyVariant(filteredExercises);
      }
    } else {
      if (selectedLocationFilter && locationEquipment.length > 0) {
        filteredExercises = applyLocationFilterWorkoutVariant(filteredExercises);
      }
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

    return filteredExercises;
  };

  const renderExerciseRow = (exercise: AvailableExercise) => {
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
  };

  const renderExerciseList = () => {
    const filteredExercises = getFilteredAndSortedExercises();

    if (availableExercises.length === 0) {
      return (
        <p className={`text-center py-8 ${variant === 'empty' ? 'text-surface-400' : 'text-surface-500'}`}>
          Loading exercises...
        </p>
      );
    }

    if (filteredExercises.length === 0) {
      return (
        <p className={`text-center py-8 ${variant === 'empty' ? 'text-surface-400' : 'text-surface-500'}`}>
          No exercises found
        </p>
      );
    }

    if (variant === 'workout') {
      return filteredExercises.map(renderExerciseRow);
    }

    // Collapse the long tail of rarely-used exercises unless the
    // user is searching or has tapped "Show all". Default-visible
    // set = staples + exercises the user has actually performed.
    const isSearchingExercises = exerciseSearch.trim().length > 0;
    const defaultVisibleExercises = filteredExercises.filter((ex) =>
      isDefaultVisibleExercise(ex.id, stapleExerciseIds, frequentExerciseIds, lastDoneExercises)
    );
    const hasHiddenExercises = !isSearchingExercises && defaultVisibleExercises.length < filteredExercises.length;
    const exercisesCollapsed = hasHiddenExercises && !showAllExercises;
    const visibleExercises = exercisesCollapsed ? defaultVisibleExercises : filteredExercises;

    return (
      <>
        {visibleExercises.map(renderExerciseRow)}
        {hasHiddenExercises && (
          <button
            type="button"
            onClick={onToggleShowAllExercises}
            className="w-full p-4 text-center text-sm font-medium text-primary-400 hover:bg-surface-800/50 transition-colors border-b border-surface-800/50"
          >
            {exercisesCollapsed
              ? `Show all ${filteredExercises.length} exercises`
              : 'Show fewer'}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center pt-[env(safe-area-inset-top)] sm:pt-0">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal - positioned at top on mobile to avoid keyboard overlap */}
      <div className="relative w-full max-w-lg max-h-[85vh] sm:max-h-[80vh] bg-surface-900 rounded-b-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-surface-800 flex items-center justify-between flex-shrink-0">
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
            onClick={onAddSelected}
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
        <div className={variant === 'empty'
          ? 'p-4 border-b border-surface-800 space-y-3 flex-shrink-0'
          : 'p-4 space-y-3 border-b border-surface-800 flex-shrink-0'
        }>
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

          {/* Body Part and Location Dropdowns */}
          <div className="flex gap-2">
            {/* Body Part Dropdown */}
            <div className="relative flex-1">
              <button
                onClick={() => { onShowMuscleDropdownChange(!showMuscleDropdown); onShowSortDropdownChange(false); onShowLocationDropdownChange(false); }}
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

            {/* Location Dropdown */}
            {gymLocations.length > 0 && (
              <div className="relative flex-1">
                <button
                  onClick={() => { onShowLocationDropdownChange(!showLocationDropdown); onShowMuscleDropdownChange(false); onShowSortDropdownChange(false); }}
                  className="w-full flex items-center justify-between px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 hover:bg-surface-700 transition-colors"
                >
                  <span className={selectedLocationFilter ? '' : 'text-surface-400'}>
                    {selectedLocationFilter
                      ? gymLocations.find(l => l.id === selectedLocationFilter)?.name || 'Any Location'
                      : 'Any Location'}
                  </span>
                  <svg className={`w-4 h-4 text-surface-400 transition-transform ${showLocationDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Location Dropdown Menu */}
                {showLocationDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => { onSelectedLocationFilterChange(null); onShowLocationDropdownChange(false); }}
                      className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                        !selectedLocationFilter ? 'text-primary-400' : 'text-surface-200'
                      }`}
                    >
                      <span>Any Location</span>
                      {!selectedLocationFilter && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    {gymLocations.map(location => (
                      <button
                        key={location.id}
                        onClick={() => { onSelectedLocationFilterChange(location.id); onShowLocationDropdownChange(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                          selectedLocationFilter === location.id ? 'text-primary-400' : 'text-surface-200'
                        }`}
                      >
                        <span>{location.name}</span>
                        {selectedLocationFilter === location.id && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sort Button */}
            <div className="relative">
              <button
                onClick={() => { onShowSortDropdownChange(!showSortDropdown); onShowMuscleDropdownChange(false); onShowLocationDropdownChange(false); }}
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

          {variant === 'workout' && (
            <>
              {/* Create custom exercise button */}
              <button
                onClick={onCreateCustom}
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
          {renderExerciseList()}
        </div>
      </div>
    </div>
  );
}
