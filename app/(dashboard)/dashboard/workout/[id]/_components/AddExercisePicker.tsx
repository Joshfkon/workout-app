'use client';

/**
 * AddExercisePicker.tsx
 *
 * Search-first add-exercise modal. Default view (before the user types):
 * an auto-focused search input, a "Recent" section (up to 6 exercises the
 * user has done most recently), a "Suggested" section (staple exercises for
 * the muscles relevant today), a compact muscle-chip row, and an
 * adjustments toggle hiding the sort + location controls. Typing collapses
 * everything into one ranked result list across the full library.
 *
 * Location-equipment handling: availability is decided by the SHARED
 * fail-closed equipment filter (services/equipmentFilter.ts) against the
 * selected location's blocklist — the same filter every generation path
 * uses. Unavailable exercises are NOT hidden: the user may know better
 * (odd home setups, borrowed gear), so they are flagged with a badge and
 * sorted below available exercises instead.
 *
 * The two variants differ only in chrome now (variant="workout" adds the
 * "Create custom exercise" button, inline error display, and plan-muscle
 * context for the Suggested section).
 *
 * All filter/search state stays in the page (several pieces outlive the
 * modal); only ephemeral UI state (adjustments panel) is local.
 */

import { useMemo, useState } from 'react';
import { IconAdjustments, IconCheck, IconPlus, IconX } from '@tabler/icons-react';
import type { AvailableExercise, GymLocation } from '../_lib/types';
import { formatMuscleName } from '@/lib/utils';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { checkExerciseEquipment } from '@/services/equipmentFilter';
import {
  dedupeExercisesById,
  exerciseMatchesMuscleGroup,
  exerciseMatchesQuery,
} from '@/services/exerciseFilter';
import {
  deriveEquipmentClass,
  equipmentClassToGroup,
  equipmentGroupLabel,
  exerciseMatchesEquipmentGroups,
  EQUIPMENT_GROUP_ORDER,
  type EquipmentGroup,
} from '@/services/equipmentClass';

/** Read an AvailableExercise's equipment group (stored class, else derived). */
function exerciseEquipmentGroup(ex: AvailableExercise): EquipmentGroup {
  return equipmentClassToGroup(
    deriveEquipmentClass({
      name: ex.name,
      equipment_required: ex.equipment_required,
      is_bodyweight: ex.is_bodyweight,
      equipment_class: ex.equipment_class ?? null,
    })
  );
}

// Normalize exercise search terms for better matching
// Handles variations like "situps" vs "sit up" vs "sit-up"
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-\s]/g, '')  // Remove hyphens and spaces
    .replace(/s$/, '');     // Remove trailing 's' for basic plural handling
}

export type ExerciseSortOption = 'frequency' | 'name' | 'recent';

/** Max rows in the "Recent" section of the default view. */
const MAX_RECENT = 6;
/** Max total rows (Recent + Suggested) in the default view. */
const MAX_DEFAULT_ROWS = 12;

/** Big movement-pattern muscles suggested when there is no plan context. */
const FALLBACK_SUGGESTED_MUSCLES = ['chest', 'back', 'quads', 'hamstrings', 'shoulders'];

/** Obvious training pairings: muscles commonly trained alongside a plan muscle. */
const MUSCLE_PAIRINGS: Record<string, string[]> = {
  chest: ['shoulders', 'triceps'],
  back: ['biceps'],
  shoulders: ['triceps'],
  quads: ['glutes'],
  hamstrings: ['glutes'],
  glutes: ['hamstrings', 'quads'],
};

const SORT_OPTIONS: { value: ExerciseSortOption; label: string }[] = [
  { value: 'frequency', label: 'Frequent' },
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'A-Z' },
];

export interface AddExercisePickerProps {
  variant: 'empty' | 'workout';
  availableExercises: AvailableExercise[];
  // Search + filter state (owned by the page — it outlives the modal)
  exerciseSearch: string;
  onExerciseSearchChange: (value: string) => void;
  selectedMuscleFilter: string | null;
  onSelectedMuscleFilterChange: (value: string | null) => void;
  /**
   * Equipment-class filter groups (second, orthogonal axis). Multi-select
   * UNION within the axis; ANDed with the muscle filter. Empty = no constraint.
   */
  selectedEquipmentGroups: string[];
  onToggleEquipmentGroup: (group: string) => void;
  /** @deprecated Muscle filtering is now a chip row; dropdown state is unused. */
  showMuscleDropdown?: boolean;
  /** @deprecated Muscle filtering is now a chip row; dropdown state is unused. */
  onShowMuscleDropdownChange?: (value: boolean) => void;
  /** @deprecated Sort now lives in the local adjustments panel; unused. */
  showSortDropdown?: boolean;
  /** @deprecated Sort now lives in the local adjustments panel; unused. */
  onShowSortDropdownChange?: (value: boolean) => void;
  /** @deprecated Location now lives in the local adjustments panel; unused. */
  showLocationDropdown?: boolean;
  /** @deprecated Location now lives in the local adjustments panel; unused. */
  onShowLocationDropdownChange?: (value: boolean) => void;
  exerciseSortOption: ExerciseSortOption;
  onExerciseSortOptionChange: (value: ExerciseSortOption) => void;
  /** "Browse all" expansion of the default view */
  showAllExercises: boolean;
  onToggleShowAllExercises: () => void;
  // Location filter data
  gymLocations: GymLocation[];
  selectedLocationFilter: string | null;
  onSelectedLocationFilterChange: (value: string | null) => void;
  /** equipment_types ids the selected location lacks (fail-closed blocklist). */
  unavailableEquipmentIds: string[];
  /** Exercises the user explicitly marked unavailable at this location. */
  unavailableExerciseIds: Set<string>;
  // Usage data for sorting / default visibility
  stapleExerciseIds: Set<string>;
  frequentExerciseIds: Map<string, number>;
  lastDoneExercises: Map<string, Date>;
  /**
   * Primary muscles already in today's session plan (variant="workout").
   * Drives the "Suggested" section; falls back to the big movement-pattern
   * muscles when absent/empty.
   */
  planMuscles?: string[];
  // Multi-select
  selectedExercisesToAdd: AvailableExercise[];
  onToggleExerciseSelection: (exercise: AvailableExercise) => void;
  isAddingExercise: boolean;
  /**
   * Live "how long will this take?" readout under the title: the session's
   * estimate as it would stand once the current selection is added, plus what
   * the selection itself costs. Omit to hide the line entirely.
   */
  sessionDuration?: { totalLabel: string; deltaLabel: string | null } | null;
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
  selectedEquipmentGroups,
  onToggleEquipmentGroup,
  exerciseSortOption,
  onExerciseSortOptionChange,
  showAllExercises,
  onToggleShowAllExercises,
  gymLocations,
  selectedLocationFilter,
  onSelectedLocationFilterChange,
  unavailableEquipmentIds,
  unavailableExerciseIds,
  stapleExerciseIds,
  frequentExerciseIds,
  lastDoneExercises,
  planMuscles,
  selectedExercisesToAdd,
  onToggleExerciseSelection,
  isAddingExercise,
  sessionDuration,
  onClose,
  onAddSelected,
  onCreateCustom,
  error,
}: AddExercisePickerProps) {
  // Local UI state: the sort + location controls are collapsed by default.
  const [showAdjustments, setShowAdjustments] = useState(false);
  // Only mounted while open, so the keyboard listeners can always be on.
  const { inset: keyboardInset, scrollContainerRef } = useKeyboardInset<HTMLDivElement>(true);

  const isSearching = exerciseSearch.trim().length > 0;

  // --- Location availability (shared fail-closed filter; flag + sort, never hide) ---
  const locationFilterActive = selectedLocationFilter !== null;

  /** Exercise ids the selected location can't support (equipment or explicit mark). */
  const unavailableAtLocation = useMemo(() => {
    const map = new Map<string, string>();
    if (!locationFilterActive) return map;
    for (const ex of availableExercises) {
      if (unavailableExerciseIds.has(ex.id)) {
        map.set(ex.id, 'Marked unavailable here');
        continue;
      }
      const check = checkExerciseEquipment(
        { name: ex.name, equipment: ex.equipment_required, isBodyweight: ex.is_bodyweight },
        unavailableEquipmentIds
      );
      if (!check.available) {
        map.set(
          ex.id,
          check.reason === 'unavailable_equipment' ? 'Missing equipment here' : 'Equipment unknown'
        );
      }
    }
    return map;
  }, [locationFilterActive, availableExercises, unavailableExerciseIds, unavailableEquipmentIds]);

  const isUnavailableHere = (ex: AvailableExercise) => unavailableAtLocation.has(ex.id);
  /** Available exercises first; the user may still pick a flagged one. */
  const availabilityRank = (ex: AvailableExercise) => (isUnavailableHere(ex) ? 1 : 0);

  const equipmentGroups = selectedEquipmentGroups as EquipmentGroup[];

  /**
   * Muscle chip AND equipment chip(s) applied (two orthogonal axes); location
   * availability only flags and sorts, never hides.
   */
  const getBasePool = (): AvailableExercise[] => {
    // De-dupe (shared with the library + replace pickers) then apply the
    // group-aware muscle chip so a coarse chip also matches sub-muscle tags,
    // ANDed with the equipment-class axis (empty selection = no constraint).
    return dedupeExercisesById(availableExercises).filter(
      ex =>
        exerciseMatchesMuscleGroup(ex, selectedMuscleFilter) &&
        exerciseMatchesEquipmentGroups(
          {
            name: ex.name,
            equipment_required: ex.equipment_required,
            is_bodyweight: ex.is_bodyweight,
            equipment_class: ex.equipment_class ?? null,
          },
          equipmentGroups
        )
    );
  };

  const sortByOption = (exercises: AvailableExercise[]): AvailableExercise[] => {
    return [...exercises].sort((a, b) => {
      const availabilityDiff = availabilityRank(a) - availabilityRank(b);
      if (availabilityDiff !== 0) return availabilityDiff;
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
  };

  /** Ranked full-library results: prefix matches first, then by usage, then name. */
  const getSearchResults = (): AvailableExercise[] => {
    const normalizedSearch = normalizeForSearch(exerciseSearch);
    return getBasePool()
      // Name match keeps the plural/hyphen normalization ("situps" -> "Sit-Up");
      // the shared query matcher adds muscle + equipment matching so a search
      // like "cable" or "quads" also surfaces results.
      .filter(
        ex =>
          normalizeForSearch(ex.name).includes(normalizedSearch) ||
          exerciseMatchesQuery(ex, exerciseSearch)
      )
      .sort((a, b) => {
        const availabilityDiff = availabilityRank(a) - availabilityRank(b);
        if (availabilityDiff !== 0) return availabilityDiff;
        const aPrefix = normalizeForSearch(a.name).startsWith(normalizedSearch) ? 0 : 1;
        const bPrefix = normalizeForSearch(b.name).startsWith(normalizedSearch) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        const freqDiff = (frequentExerciseIds.get(b.id) || 0) - (frequentExerciseIds.get(a.id) || 0);
        if (freqDiff !== 0) return freqDiff;
        return a.name.localeCompare(b.name);
      });
  };

  /** Muscles whose staples belong in "Suggested" today, in display order. */
  const getRelevantMuscles = (): string[] => {
    if (planMuscles && planMuscles.length > 0) {
      const ordered: string[] = [];
      const seen = new Set<string>();
      const push = (muscle: string) => {
        const key = muscle.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(key);
        }
      };
      // Muscles already in the plan first, then their obvious pairings.
      planMuscles.forEach(push);
      planMuscles.forEach(m => (MUSCLE_PAIRINGS[m.toLowerCase()] ?? []).forEach(push));
      return ordered;
    }
    return FALLBACK_SUGGESTED_MUSCLES;
  };

  /** The default (pre-search) view: Recent + Suggested, capped to one screen. */
  const getDefaultSections = (pool: AvailableExercise[]) => {
    const performed = pool.filter(
      ex => (frequentExerciseIds.get(ex.id) ?? 0) > 0 || lastDoneExercises.has(ex.id)
    );
    const recent = [...performed]
      .sort((a, b) => {
        const availabilityDiff = availabilityRank(a) - availabilityRank(b);
        if (availabilityDiff !== 0) return availabilityDiff;
        const dateDiff =
          (lastDoneExercises.get(b.id)?.getTime() ?? 0) - (lastDoneExercises.get(a.id)?.getTime() ?? 0);
        if (dateDiff !== 0) return dateDiff;
        const freqDiff = (frequentExerciseIds.get(b.id) ?? 0) - (frequentExerciseIds.get(a.id) ?? 0);
        if (freqDiff !== 0) return freqDiff;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_RECENT);
    const recentIds = new Set(recent.map(ex => ex.id));

    // Staples for the relevant muscles, interleaved one-per-muscle so every
    // muscle gets representation within the row cap. With a muscle chip
    // active the pool is already scoped, so all its staples are relevant.
    const relevantMuscles = selectedMuscleFilter
      ? [selectedMuscleFilter.toLowerCase()]
      : getRelevantMuscles();
    const candidatesByMuscle = new Map<string, AvailableExercise[]>();
    for (const ex of pool) {
      if (!stapleExerciseIds.has(ex.id) || recentIds.has(ex.id)) continue;
      // Suggested = "do this today" — exercises the location can't support
      // stay reachable via search/browse (flagged), not suggested.
      if (isUnavailableHere(ex)) continue;
      const muscle = (ex.primary_muscle ?? '').toLowerCase();
      if (!relevantMuscles.includes(muscle)) continue;
      const list = candidatesByMuscle.get(muscle);
      if (list) list.push(ex);
      else candidatesByMuscle.set(muscle, [ex]);
    }
    candidatesByMuscle.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));

    const suggested: AvailableExercise[] = [];
    const maxSuggested = Math.max(0, MAX_DEFAULT_ROWS - recent.length);
    for (let round = 0; suggested.length < maxSuggested; round++) {
      let added = false;
      for (const muscle of relevantMuscles) {
        if (suggested.length >= maxSuggested) break;
        const candidate = candidatesByMuscle.get(muscle)?.[round];
        if (candidate) {
          suggested.push(candidate);
          added = true;
        }
      }
      if (!added) break;
    }

    return { recent, suggested };
  };

  const renderExerciseRow = (exercise: AvailableExercise) => {
    const isSelected = selectedExercisesToAdd.some(e => e.id === exercise.id);
    const unavailableReason = unavailableAtLocation.get(exercise.id);
    return (
      <button
        key={exercise.id}
        data-testid="add-exercise-row"
        data-exercise-id={exercise.id}
        onClick={() => onToggleExerciseSelection(exercise)}
        disabled={isAddingExercise}
        className={`w-full flex items-center justify-between gap-3 px-4 py-1.5 min-h-[44px] transition-colors text-left disabled:opacity-50 border-b border-surface-800/50 ${
          isSelected ? 'bg-primary-500/10' : 'hover:bg-surface-800/50'
        } ${unavailableReason ? 'opacity-60' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] leading-5 text-surface-200 truncate">{exercise.name}</span>
            {frequentExerciseIds.has(exercise.id) && (
              <span className="text-amber-400 text-[11px] flex-shrink-0">&#9733;</span>
            )}
            {unavailableReason && (
              <span className="flex-shrink-0 px-1 rounded bg-warning-500/15 border border-warning-500/30 text-[10px] font-medium text-warning-400">
                {unavailableReason}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] leading-4 text-surface-500">
            <span className="truncate">{formatMuscleName(exercise.primary_muscle)}</span>
            <span aria-hidden="true">&middot;</span>
            <span className="capitalize">{exercise.mechanic}</span>
            <span aria-hidden="true">&middot;</span>
            {/* Normalized equipment class (rolled up to its group), so the
                implement is scannable instead of hidden in the name suffix. */}
            <span className="capitalize">{equipmentGroupLabel(exerciseEquipmentGroup(exercise))}</span>
            {exercise.hypertrophy_tier && (
              <span className="px-1 rounded bg-surface-800 border border-surface-700 text-[10px] font-medium text-surface-300">
                {exercise.hypertrophy_tier}
              </span>
            )}
          </div>
        </div>
        {isSelected && <IconCheck size={18} className="text-primary-400 flex-shrink-0" />}
      </button>
    );
  };

  const renderSectionHeader = (label: string) => (
    <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
      {label}
    </div>
  );

  const renderEmptyMessage = (message: string) => (
    <p className={`text-center py-8 ${variant === 'empty' ? 'text-surface-400' : 'text-surface-500'}`}>
      {message}
    </p>
  );

  const renderExerciseList = () => {
    if (availableExercises.length === 0) {
      return renderEmptyMessage('Loading exercises...');
    }

    // Searching: one ranked result list across the full (filtered) library.
    if (isSearching) {
      const results = getSearchResults();
      if (results.length === 0) return renderEmptyMessage('No exercises found');
      return results.map(renderExerciseRow);
    }

    const pool = getBasePool();
    if (pool.length === 0) {
      return renderEmptyMessage('No exercises found');
    }

    // "Browse all" expanded: the full list, sorted by the chosen option.
    if (showAllExercises) {
      return (
        <>
          {sortByOption(pool).map(renderExerciseRow)}
          <button
            type="button"
            onClick={onToggleShowAllExercises}
            className="w-full p-4 text-center text-sm font-medium text-primary-400 hover:bg-surface-800/50 transition-colors border-b border-surface-800/50"
          >
            Show fewer
          </button>
        </>
      );
    }

    // Default view: Recent + Suggested, capped so it fits one screen.
    const { recent, suggested } = getDefaultSections(pool);
    const shownCount = recent.length + suggested.length;
    // Graceful fallback (e.g. no history and no staples in the pool): show
    // the top of the sorted list instead of an empty modal.
    const fallback = shownCount === 0 ? sortByOption(pool).slice(0, MAX_DEFAULT_ROWS) : [];

    return (
      <>
        {recent.length > 0 && (
          <>
            {renderSectionHeader('Recent')}
            {recent.map(renderExerciseRow)}
          </>
        )}
        {suggested.length > 0 && (
          <>
            {renderSectionHeader('Suggested')}
            {suggested.map(renderExerciseRow)}
          </>
        )}
        {fallback.length > 0 && (
          <>
            {renderSectionHeader('Exercises')}
            {fallback.map(renderExerciseRow)}
          </>
        )}
        {pool.length > Math.max(shownCount, fallback.length) && (
          <button
            type="button"
            onClick={onToggleShowAllExercises}
            className="w-full p-4 text-center text-sm font-medium text-primary-400 hover:bg-surface-800/50 transition-colors border-b border-surface-800/50"
          >
            Browse all {pool.length} exercises
          </button>
        )}
      </>
    );
  };

  const muscleOptions = Array.from(
    new Set(availableExercises.map(ex => ex.primary_muscle).filter(Boolean))
  ).sort();

  // Equipment groups present in the library, in canonical chip order. Only
  // groups that actually match something are shown, so the row never offers a
  // chip that would empty the list; the common six lead by EQUIPMENT_GROUP_ORDER.
  const equipmentOptions = useMemo(() => {
    const present = new Set<EquipmentGroup>();
    for (const ex of availableExercises) present.add(exerciseEquipmentGroup(ex));
    return EQUIPMENT_GROUP_ORDER.filter(g => present.has(g));
  }, [availableExercises]);

  const adjustmentsActive = selectedLocationFilter !== null || exerciseSortOption !== 'frequency';

  const chipClass = (active: boolean) =>
    `flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] leading-4 capitalize border transition-colors ${
      active
        ? 'bg-primary-500/20 border-primary-500/40 text-primary-300'
        : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center pt-[env(safe-area-inset-top)] sm:pt-0">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal - positioned at top on mobile to avoid keyboard overlap; the
          keyboard inset caps its height so the list never extends behind the
          keyboard */}
      <div
        ref={scrollContainerRef}
        className="relative w-full max-w-lg bg-surface-900 rounded-b-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh]"
        style={
          keyboardInset > 0
            ? { maxHeight: `min(85vh, calc(100vh - env(safe-area-inset-top, 0px) - ${keyboardInset}px))` }
            : undefined
        }
      >
        {/* Header */}
        <div className="p-4 border-b border-surface-800 flex items-center justify-between flex-shrink-0">
          <button
            onClick={onClose}
            className="p-2 text-surface-400 hover:text-surface-200 -ml-2"
            aria-label="Close"
          >
            <IconX size={20} />
          </button>
          <div className="min-w-0 text-center">
            <h2 className="text-lg font-semibold text-surface-100">Add Exercise</h2>
            {/* Live cost of the workout being assembled — the number the user
                is really deciding against when picking a sixth exercise. */}
            {sessionDuration && (
              <p
                className="text-[11px] leading-4 text-surface-500 truncate"
                data-testid="picker-duration-estimate"
              >
                ~{sessionDuration.totalLabel} workout
                {sessionDuration.deltaLabel && (
                  <span className="text-primary-400"> ({sessionDuration.deltaLabel})</span>
                )}
              </p>
            )}
          </div>
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

        {/* Search + compact utility row */}
        <div className="px-4 pt-3 pb-2 border-b border-surface-800 flex-shrink-0">
          <input
            type="text"
            autoFocus
            value={exerciseSearch}
            onChange={(e) => onExerciseSearchChange(e.target.value)}
            placeholder="Search exercises..."
            className="w-full px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-surface-100 placeholder-surface-500"
          />

          {/* Muscle chips + adjustments toggle */}
          <div className="mt-2 flex items-center gap-2">
            <div
              className="flex-1 flex items-center gap-1.5 overflow-x-auto"
              style={{ scrollbarWidth: 'none' }}
            >
              <button
                type="button"
                onClick={() => onSelectedMuscleFilterChange(null)}
                className={chipClass(!selectedMuscleFilter)}
              >
                All
              </button>
              {muscleOptions.map(muscle => (
                <button
                  key={muscle}
                  type="button"
                  onClick={() =>
                    onSelectedMuscleFilterChange(selectedMuscleFilter === muscle ? null : muscle)
                  }
                  className={chipClass(selectedMuscleFilter === muscle)}
                >
                  {formatMuscleName(muscle)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowAdjustments(v => !v)}
              className={`flex-shrink-0 p-1.5 rounded-lg border transition-colors ${
                showAdjustments || adjustmentsActive
                  ? 'bg-primary-500/20 border-primary-500/40 text-primary-300'
                  : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'
              }`}
              aria-label="Sort and location options"
              aria-expanded={showAdjustments}
            >
              <IconAdjustments size={16} />
            </button>
          </div>

          {/* Equipment chips — a SECOND, orthogonal axis that ANDs with muscle.
              Multi-select (union within the axis): tapping toggles a group, and
              "All" clears the whole axis. Rendered only when the library spans
              more than one equipment group. */}
          {equipmentOptions.length > 1 && (
            <div
              className="mt-1.5 flex items-center gap-1.5 overflow-x-auto"
              style={{ scrollbarWidth: 'none' }}
              data-testid="equipment-filter-row"
            >
              <button
                type="button"
                onClick={() => selectedEquipmentGroups.forEach(onToggleEquipmentGroup)}
                className={chipClass(selectedEquipmentGroups.length === 0)}
              >
                All Gear
              </button>
              {equipmentOptions.map(group => (
                <button
                  key={group}
                  type="button"
                  onClick={() => onToggleEquipmentGroup(group)}
                  className={chipClass(selectedEquipmentGroups.includes(group))}
                  aria-pressed={selectedEquipmentGroups.includes(group)}
                >
                  {equipmentGroupLabel(group)}
                </button>
              ))}
            </div>
          )}

          {/* Collapsed-by-default sort + location controls */}
          {showAdjustments && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-surface-500 w-14 flex-shrink-0">Sort</span>
                <div className="flex items-center gap-1.5">
                  {SORT_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onExerciseSortOptionChange(option.value)}
                      className={chipClass(exerciseSortOption === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {gymLocations.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-surface-500 w-14 flex-shrink-0">Location</span>
                  <div
                    className="flex-1 flex items-center gap-1.5 overflow-x-auto"
                    style={{ scrollbarWidth: 'none' }}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectedLocationFilterChange(null)}
                      className={chipClass(!selectedLocationFilter)}
                    >
                      Any
                    </button>
                    {gymLocations.map(location => (
                      <button
                        key={location.id}
                        type="button"
                        onClick={() =>
                          onSelectedLocationFilterChange(
                            selectedLocationFilter === location.id ? null : location.id
                          )
                        }
                        className={chipClass(selectedLocationFilter === location.id)}
                      >
                        {location.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error display (variant="workout") */}
          {error && (
            <div className="mt-2 p-2 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Exercise List */}
        <div className="flex-1 overflow-y-auto">
          {renderExerciseList()}
        </div>

        {/* Create custom exercise (variant="workout") */}
        {onCreateCustom && (
          <div className="p-3 border-t border-surface-800 flex-shrink-0">
            <button
              onClick={onCreateCustom}
              className="w-full py-2.5 bg-surface-800/50 hover:bg-surface-800 rounded-lg border border-dashed border-surface-600 hover:border-primary-500/50 transition-all flex items-center justify-center gap-2 text-surface-400 hover:text-primary-400"
            >
              <IconPlus size={16} />
              <span className="text-[13px] font-medium">Create custom exercise</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
