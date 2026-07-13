'use client';

import { useState, useEffect } from 'react';
import type { Exercise } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { parseYouTubeVideoId } from '@/lib/youtube';
import { muscleDisplayName } from '@/lib/utils';
import { getExerciseProp } from './helpers';

import { MOVEMENT_PATTERN_OPTIONS, MUSCLE_OPTIONS, EQUIPMENT_OPTIONS } from './editFormOptions';

interface ExerciseEditFormProps {
  exercise: Exercise;
  onCancel: () => void;
}

interface EditData {
  isBodyweight: boolean;
  bodyweightType: 'pure' | 'weighted_possible' | 'assisted_possible' | 'both' | null;
  assistanceType: 'machine' | 'band' | 'partner' | null;
  equipment: string;
  equipmentRequired: string[];
  movementPattern: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  hypertrophyTier?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  defaultRepRangeMin?: number;
  defaultRepRangeMax?: number;
  defaultRir?: number;
  setupNote?: string;
  /** Raw text from the "curated YouTube video" input (URL or ID). */
  youtubeVideoInput?: string;
}

/**
 * The exercise metadata edit form (formerly inline in ExerciseDetailsModal).
 * Replaces the tab content while editing; saving reloads the page so every
 * surface picks up the updated exercise row.
 */
export function ExerciseEditForm({ exercise, onCancel }: ExerciseEditFormProps) {
  const [editData, setEditData] = useState<EditData | null>(null);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [equipmentTypes, setEquipmentTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [gymLocations, setGymLocations] = useState<Array<{ id: string; name: string; is_default: boolean }>>([]);
  const [locationAvailability, setLocationAvailability] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load equipment types + gym locations when the form opens
  useEffect(() => {
    const loadEquipmentTypes = async () => {
      const supabase = createUntypedClient();
      const { data } = await supabase
        .from('equipment_types')
        .select('id, name')
        .order('name');
      if (data) setEquipmentTypes(data);
    };

    const loadGymLocations = async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('gym_locations')
        .select('id, name, is_default')
        .eq('user_id', user.id)
        .order('name');
      if (data) setGymLocations(data);
    };

    loadEquipmentTypes();
    loadGymLocations();
  }, []);

  // Initialize edit data from the exercise row
  useEffect(() => {
    const equipment = getExerciseProp(exercise, 'equipment', 'equipment') || 'barbell';
    const equipmentRequired = getExerciseProp(exercise, 'equipmentRequired', 'equipment_required') || [];
    const movementPattern = getExerciseProp(exercise, 'movementPattern', 'movement_pattern') || 'compound';
    const primaryMuscle = getExerciseProp(exercise, 'primaryMuscle', 'primary_muscle') || 'chest';
    const secondaryMuscles = getExerciseProp(exercise, 'secondaryMuscles', 'secondary_muscles') || [];
    const isBodyweight = getExerciseProp(exercise, 'isBodyweight', 'is_bodyweight') || false;
    const bodyweightType = getExerciseProp(exercise, 'bodyweightType', 'bodyweight_type') || null;
    const assistanceType = getExerciseProp(exercise, 'assistanceType', 'assistance_type') || null;

    const hypertrophyTier = getExerciseProp(exercise, 'hypertrophyTier', 'hypertrophy_tier');
    const defaultRepRange = getExerciseProp(exercise, 'defaultRepRange', 'default_rep_range') || [];
    const defaultRir = getExerciseProp(exercise, 'defaultRir', 'default_rir');
    const setupNote = getExerciseProp(exercise, 'setupNote', 'setup_note');
    const youtubeVideoId = getExerciseProp(exercise, 'youtubeVideoId', 'youtube_video_id');

    setEditData({
      isBodyweight,
      bodyweightType,
      assistanceType,
      equipment,
      equipmentRequired: Array.isArray(equipmentRequired) ? equipmentRequired : [],
      movementPattern,
      primaryMuscle,
      secondaryMuscles: Array.isArray(secondaryMuscles) ? secondaryMuscles : [],
      hypertrophyTier,
      defaultRepRangeMin: Array.isArray(defaultRepRange) && defaultRepRange.length > 0 ? defaultRepRange[0] : undefined,
      defaultRepRangeMax: Array.isArray(defaultRepRange) && defaultRepRange.length > 1 ? defaultRepRange[1] : undefined,
      defaultRir,
      setupNote,
      youtubeVideoInput: typeof youtubeVideoId === 'string' ? youtubeVideoId : '',
    });
    setShowAdvancedFields(false);

    // Load location availability for this exercise
    const loadLocationAvailability = async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !exercise.id) return;

      const { data } = await supabase
        .from('exercise_location_availability')
        .select('location_id, is_available')
        .eq('user_id', user.id)
        .eq('exercise_id', exercise.id);

      if (data) {
        const availability: Record<string, boolean> = {};
        data.forEach((row: { location_id: string; is_available: boolean }) => {
          availability[row.location_id] = row.is_available;
        });
        setLocationAvailability(availability);
      } else {
        // Default: all locations are available
        setLocationAvailability({});
      }
    };
    loadLocationAvailability();
  }, [exercise]);

  const handleSaveEdit = async () => {
    if (!exercise.id || !editData) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSaveError('You must be logged in to edit exercises');
        return;
      }

      const updatePayload: any = {
        is_bodyweight: editData.isBodyweight,
        bodyweight_type: editData.bodyweightType,
        assistance_type: editData.assistanceType,
        equipment: editData.equipment,
        equipment_required: editData.equipmentRequired.length > 0 ? editData.equipmentRequired : [],
        movement_pattern: editData.movementPattern,
        primary_muscle: editData.primaryMuscle,
        secondary_muscles: editData.secondaryMuscles || [],
        hypertrophy_tier: editData.hypertrophyTier,
        default_rep_range: editData.defaultRepRangeMin && editData.defaultRepRangeMax
          ? [editData.defaultRepRangeMin, editData.defaultRepRangeMax]
          : undefined,
        default_rir: editData.defaultRir,
        setup_note: editData.setupNote,
      };

      // Remove null/undefined values
      Object.keys(updatePayload).forEach(key => {
        if (updatePayload[key] === null || updatePayload[key] === undefined) {
          delete updatePayload[key];
        }
      });

      // Curated YouTube video: parse the pasted URL/ID down to a bare video ID.
      // Set explicitly (including null to clear) AFTER the null-strip above so
      // an emptied field actually removes the video.
      updatePayload.youtube_video_id = parseYouTubeVideoId(editData.youtubeVideoInput);

      const { error } = await supabase
        .from('exercises')
        .update(updatePayload)
        .eq('id', exercise.id);

      if (error) {
        console.error('Failed to update exercise:', error);
        setSaveError(error.message || 'Failed to update exercise');
        return;
      }

      // Save location availability if user has gym locations
      if (gymLocations.length > 0 && Object.keys(locationAvailability).length > 0) {
        for (const [locationId, isAvailable] of Object.entries(locationAvailability)) {
          await supabase
            .from('exercise_location_availability')
            .upsert({
              user_id: user.id,
              exercise_id: exercise.id,
              location_id: locationId,
              is_available: isAvailable,
            }, {
              onConflict: 'user_id,exercise_id,location_id',
            });
        }
      }

      setSaveSuccess(true);
      setTimeout(() => {
        window.location.reload(); // Refresh to show updated data
      }, 1500);
    } catch (err) {
      console.error('Error updating exercise:', err);
      setSaveError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  if (!editData) return null;

  return (
    <div className="space-y-4 p-4 bg-surface-800/50 rounded-lg border border-surface-700">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-surface-100">Edit Exercise</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveEdit}
            disabled={isSaving}
            className="px-3 py-1.5 text-sm bg-success-500 hover:bg-success-600 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save
              </>
            )}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm bg-surface-700 hover:bg-surface-600 text-surface-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Bodyweight Settings */}
      <div className="space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={editData.isBodyweight}
            onChange={(e) => setEditData({ ...editData, isBodyweight: e.target.checked })}
            className="w-4 h-4 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
          />
          <span className="text-sm text-surface-200">Bodyweight Exercise</span>
        </label>

        {editData.isBodyweight && (
          <div className="ml-6 space-y-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Bodyweight Type</label>
              <select
                value={editData.bodyweightType || ''}
                onChange={(e) => setEditData({ ...editData, bodyweightType: (e.target.value || null) as EditData['bodyweightType'] })}
                className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
              >
                <option value="">Not specified</option>
                <option value="pure">Pure (always bodyweight)</option>
                <option value="weighted_possible">Can add weight</option>
                <option value="assisted_possible">Can use assistance</option>
                <option value="both">Can be weighted OR assisted</option>
              </select>
            </div>

            {(editData.bodyweightType === 'assisted_possible' || editData.bodyweightType === 'both') && (
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Assistance Type</label>
                <select
                  value={editData.assistanceType || ''}
                  onChange={(e) => setEditData({ ...editData, assistanceType: (e.target.value || null) as EditData['assistanceType'] })}
                  className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
                >
                  <option value="">Not specified</option>
                  <option value="machine">Machine</option>
                  <option value="band">Band</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Equipment */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-1">Equipment</label>
        <select
          value={editData.equipment}
          onChange={(e) => setEditData({ ...editData, equipment: e.target.value })}
          className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
        >
          {EQUIPMENT_OPTIONS.map((value) => (
            <option key={value} value={value} className="capitalize">
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Location Availability */}
      {gymLocations.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-surface-400 mb-2">Available At</label>
          <p className="text-xs text-surface-500 mb-2">Select which gym locations have the equipment for this exercise</p>
          <div className="space-y-2">
            {gymLocations.map((location) => {
              const isAvailable = locationAvailability[location.id] !== false;
              return (
                <label key={location.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isAvailable}
                    onChange={(e) => {
                      setLocationAvailability(prev => ({
                        ...prev,
                        [location.id]: e.target.checked
                      }));
                    }}
                    className="w-4 h-4 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-surface-200">
                    {location.name}
                    {location.is_default && (
                      <span className="text-xs text-surface-500 ml-1">(Default)</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Movement Pattern */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-1">Movement Pattern</label>
        <select
          value={editData.movementPattern}
          onChange={(e) => setEditData({ ...editData, movementPattern: e.target.value })}
          className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
        >
          {MOVEMENT_PATTERN_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Primary Muscle */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-1">Primary Muscle</label>
        <select
          value={editData.primaryMuscle}
          onChange={(e) => setEditData({ ...editData, primaryMuscle: e.target.value })}
          className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
        >
          {MUSCLE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Advanced Fields Toggle */}
      <div className="pt-2 border-t border-surface-700">
        <button
          type="button"
          onClick={() => setShowAdvancedFields(!showAdvancedFields)}
          className="flex items-center justify-between w-full text-sm text-surface-400 hover:text-surface-200 transition-colors"
        >
          <span>Advanced Fields</span>
          <svg
            className={`w-4 h-4 transition-transform ${showAdvancedFields ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Advanced Fields */}
      {showAdvancedFields && (
        <div className="space-y-4 pt-2 border-t border-surface-700">
          {/* Equipment Required (Multi-select) */}
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              Equipment Required (select all that apply)
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-surface-800/50 rounded-lg">
              {equipmentTypes.map((eq) => (
                <label
                  key={eq.id}
                  className="flex items-center gap-2 p-2 rounded hover:bg-surface-700/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={editData.equipmentRequired.includes(eq.name.toLowerCase())}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditData({ ...editData, equipmentRequired: [...editData.equipmentRequired, eq.name.toLowerCase()] });
                      } else {
                        setEditData({ ...editData, equipmentRequired: editData.equipmentRequired.filter(name => name !== eq.name.toLowerCase()) });
                      }
                    }}
                    className="w-4 h-4 text-primary-500 bg-surface-700 border-surface-600 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-surface-300">{eq.name}</span>
                </label>
              ))}
            </div>
            {editData.equipmentRequired.length > 0 && (
              <p className="text-xs text-surface-500 mt-1">
                Selected: {editData.equipmentRequired.join(', ')}
              </p>
            )}
          </div>

          {/* Secondary Muscles */}
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              Secondary Muscles
            </label>
            <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 bg-surface-800/50 rounded-lg">
              {['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'traps', 'forearms'].filter(m => m !== editData.primaryMuscle).map((muscle) => (
                <label
                  key={muscle}
                  className="flex items-center gap-2 p-1.5 rounded hover:bg-surface-700/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={editData.secondaryMuscles.includes(muscle)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditData({ ...editData, secondaryMuscles: [...editData.secondaryMuscles, muscle] });
                      } else {
                        setEditData({ ...editData, secondaryMuscles: editData.secondaryMuscles.filter(m => m !== muscle) });
                      }
                    }}
                    className="w-4 h-4 text-primary-500 bg-surface-700 border-surface-600 rounded focus:ring-primary-500"
                  />
                  <span className="text-xs text-surface-300">{muscleDisplayName(muscle)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Hypertrophy Tier */}
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Hypertrophy Tier</label>
            <select
              value={editData.hypertrophyTier || ''}
              onChange={(e) => setEditData({ ...editData, hypertrophyTier: (e.target.value || undefined) as EditData['hypertrophyTier'] })}
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
            >
              <option value="">Not set</option>
              <option value="S">S (Best)</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="F">F (Worst)</option>
            </select>
          </div>

          {/* Rep Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Default Rep Range (Min)</label>
              <input
                type="number"
                value={editData.defaultRepRangeMin?.toString() || ''}
                onChange={(e) => setEditData({
                  ...editData,
                  defaultRepRangeMin: e.target.value ? parseInt(e.target.value) : undefined
                })}
                placeholder="8"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Default Rep Range (Max)</label>
              <input
                type="number"
                value={editData.defaultRepRangeMax?.toString() || ''}
                onChange={(e) => setEditData({
                  ...editData,
                  defaultRepRangeMax: e.target.value ? parseInt(e.target.value) : undefined
                })}
                placeholder="12"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
              />
            </div>
          </div>

          {/* Default RIR */}
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Default RIR (Reps In Reserve)</label>
            <input
              type="number"
              value={editData.defaultRir?.toString() || ''}
              onChange={(e) => setEditData({
                ...editData,
                defaultRir: e.target.value ? parseInt(e.target.value) : undefined
              })}
              placeholder="2"
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 text-sm"
            />
          </div>

          {/* Setup Note */}
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Setup Note</label>
            <textarea
              value={editData.setupNote || ''}
              onChange={(e) => setEditData({ ...editData, setupNote: e.target.value })}
              placeholder="Instructions for setting up the exercise..."
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              rows={2}
            />
          </div>
        </div>
      )}

      {/* Curated YouTube Video */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-1">
          Curated video (YouTube URL or ID)
        </label>
        <input
          type="text"
          value={editData.youtubeVideoInput || ''}
          onChange={(e) => setEditData({ ...editData, youtubeVideoInput: e.target.value })}
          placeholder="https://youtu.be/… or video ID"
          className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        {(() => {
          const trimmed = (editData.youtubeVideoInput || '').trim();
          if (!trimmed) {
            return (
              <p className="mt-1 text-xs text-surface-500">
                Shown instead of the MuscleWiki demo. Leave blank to use MuscleWiki.
              </p>
            );
          }
          const parsed = parseYouTubeVideoId(trimmed);
          return parsed ? (
            <p className="mt-1 text-xs text-success-400">Video ID: {parsed}</p>
          ) : (
            <p className="mt-1 text-xs text-danger-400">
              Couldn&apos;t find a YouTube video ID in that text.
            </p>
          );
        })()}
      </div>

      {/* Error/Success Messages */}
      {saveError && (
        <div className="p-3 bg-danger-900/30 border border-danger-700 rounded-lg">
          <p className="text-sm text-danger-400">{saveError}</p>
        </div>
      )}
      {saveSuccess && (
        <div className="p-3 bg-success-900/30 border border-success-700 rounded-lg">
          <p className="text-sm text-success-400">Exercise updated successfully! Refreshing...</p>
        </div>
      )}
    </div>
  );
}
