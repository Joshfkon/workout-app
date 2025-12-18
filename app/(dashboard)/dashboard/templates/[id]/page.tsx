'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, LoadingAnimation } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import type { WorkoutTemplate, WorkoutTemplateExercise, WorkoutFolder } from '@/types/templates';
import Link from 'next/link';

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  equipment: string;
}

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<WorkoutTemplate | null>(null);
  const [exercises, setExercises] = useState<WorkoutTemplateExercise[]>([]);
  const [folders, setFolders] = useState<WorkoutFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateNotes, setTemplateNotes] = useState('');
  const [templateFolderId, setTemplateFolderId] = useState<string | null>(null);

  // Add exercise states
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [availableExercises, setAvailableExercises] = useState<Exercise[]>([]);
  const [searchResults, setSearchResults] = useState<Exercise[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Edit exercise states
  const [editingExercise, setEditingExercise] = useState<WorkoutTemplateExercise | null>(null);

  const supabase = createUntypedClient();

  useEffect(() => {
    loadTemplate();
    loadFolders();
    loadAvailableExercises();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function loadTemplate() {
    setIsLoading(true);
    try {
      const [templateResult, exercisesResult] = await Promise.all([
        supabase
          .from('workout_templates')
          .select('*')
          .eq('id', templateId)
          .single(),
        supabase
          .from('workout_template_exercises')
          .select('*')
          .eq('template_id', templateId)
          .order('sort_order', { ascending: true }),
      ]);

      if (templateResult.error) throw templateResult.error;
      
      setTemplate(templateResult.data);
      setExercises(exercisesResult.data || []);
      setTemplateName(templateResult.data.name);
      setTemplateNotes(templateResult.data.notes || '');
      setTemplateFolderId(templateResult.data.folder_id);
    } catch (err) {
      console.error('Error loading template:', err);
      setError('Failed to load template');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadFolders() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('workout_folders')
      .select('*')
      .eq('user_id', user.id)
      .order('name');

    if (data) setFolders(data);
  }

  async function loadAvailableExercises() {
    const { data } = await supabase
      .from('exercises')
      .select('id, name, primary_muscle, equipment')
      .order('name')
      .limit(500);

    if (data) setAvailableExercises(data);
  }

  // Search exercises
  useEffect(() => {
    if (!exerciseSearch.trim()) {
      setSearchResults(availableExercises.slice(0, 20));
      return;
    }

    const query = exerciseSearch.toLowerCase();
    const results = availableExercises
      .filter(e => 
        e.name.toLowerCase().includes(query) ||
        e.primary_muscle?.toLowerCase().includes(query) ||
        e.equipment?.toLowerCase().includes(query)
      )
      .slice(0, 20);
    
    setSearchResults(results);
  }, [exerciseSearch, availableExercises]);

  // Update template info
  async function handleUpdateTemplate() {
    if (!template) return;

    try {
      const { error } = await supabase
        .from('workout_templates')
        .update({
          name: templateName.trim(),
          notes: templateNotes.trim() || null,
          folder_id: templateFolderId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', template.id);

      if (error) throw error;
      
      setIsEditing(false);
      await loadTemplate();
    } catch (err) {
      console.error('Error updating template:', err);
      setError('Failed to update template');
    }
  }

  // Add exercise to template
  async function handleAddExercise(exercise: Exercise) {
    try {
      const { error } = await supabase.from('workout_template_exercises').insert({
        template_id: templateId,
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        sort_order: exercises.length,
        default_sets: 3,
        default_reps: '8-12',
        default_rest_seconds: 90,
      });

      if (error) throw error;

      setShowAddExercise(false);
      setExerciseSearch('');
      await loadTemplate();
    } catch (err) {
      console.error('Error adding exercise:', err);
      setError('Failed to add exercise');
    }
  }

  // Update exercise
  async function handleUpdateExercise() {
    if (!editingExercise) return;

    try {
      const { error } = await supabase
        .from('workout_template_exercises')
        .update({
          default_sets: editingExercise.default_sets,
          default_reps: editingExercise.default_reps,
          default_weight: editingExercise.default_weight,
          default_rest_seconds: editingExercise.default_rest_seconds,
          notes: editingExercise.notes,
        })
        .eq('id', editingExercise.id);

      if (error) throw error;

      setEditingExercise(null);
      await loadTemplate();
    } catch (err) {
      console.error('Error updating exercise:', err);
      setError('Failed to update exercise');
    }
  }

  // Remove exercise
  async function handleRemoveExercise(exerciseId: string) {
    if (!confirm('Remove this exercise from the template?')) return;

    try {
      const { error } = await supabase
        .from('workout_template_exercises')
        .delete()
        .eq('id', exerciseId);

      if (error) throw error;
      await loadTemplate();
    } catch (err) {
      console.error('Error removing exercise:', err);
      setError('Failed to remove exercise');
    }
  }

  // Reorder exercises
  async function moveExercise(index: number, direction: 'up' | 'down') {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === exercises.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const newExercises = [...exercises];
    [newExercises[index], newExercises[newIndex]] = [newExercises[newIndex], newExercises[index]];

    // Update sort orders
    const updates = newExercises.map((ex, i) => ({
      id: ex.id,
      sort_order: i,
    }));

    try {
      for (const update of updates) {
        await supabase
          .from('workout_template_exercises')
          .update({ sort_order: update.sort_order })
          .eq('id', update.id);
      }
      setExercises(newExercises);
    } catch (err) {
      console.error('Error reordering exercises:', err);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingAnimation />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="p-4 text-center">
        <p className="text-surface-400">Template not found</p>
        <Link href="/dashboard/templates" className="text-primary-400 mt-2 inline-block">
          ← Back to Templates
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link 
            href="/dashboard/templates" 
            className="text-sm text-surface-400 hover:text-surface-200 mb-1 inline-block"
          >
            ← Back to Templates
          </Link>
          {isEditing ? (
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="text-2xl font-bold bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-surface-100 w-full"
              autoFocus
            />
          ) : (
            <h1 className="text-2xl font-bold text-surface-100">{template.name}</h1>
          )}
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleUpdateTemplate}>
                Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
              <Link href={`/dashboard/workout/new?template=${template.id}`}>
                <Button variant="primary">
                  Start Workout
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
          {error}
        </div>
      )}

      {/* Template Info (when editing) */}
      {isEditing && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Folder
              </label>
              <select
                value={templateFolderId || ''}
                onChange={(e) => setTemplateFolderId(e.target.value || null)}
                className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
              >
                <option value="">No folder</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Notes
              </label>
              <textarea
                value={templateNotes}
                onChange={(e) => setTemplateNotes(e.target.value)}
                placeholder="Add notes about this template..."
                className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 min-h-[80px]"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exercises */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Exercises ({exercises.length})</CardTitle>
            <Button variant="primary" size="sm" onClick={() => setShowAddExercise(true)}>
              + Add Exercise
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {exercises.length === 0 ? (
            <div className="py-8 text-center">
              <span className="text-4xl mb-4 block">🏋️</span>
              <p className="text-surface-400 mb-4">No exercises in this template yet</p>
              <Button variant="primary" onClick={() => setShowAddExercise(true)}>
                Add Your First Exercise
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {exercises.map((exercise, index) => (
                <div
                  key={exercise.id}
                  className="flex items-center gap-3 p-3 bg-surface-800/50 rounded-lg group"
                >
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => moveExercise(index, 'up')}
                      disabled={index === 0}
                      className="text-surface-500 hover:text-surface-200 disabled:opacity-30 text-xs"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveExercise(index, 'down')}
                      disabled={index === exercises.length - 1}
                      className="text-surface-500 hover:text-surface-200 disabled:opacity-30 text-xs"
                    >
                      ▼
                    </button>
                  </div>

                  {/* Exercise info */}
                  <div className="flex-1">
                    <p className="font-medium text-surface-100">{exercise.exercise_name}</p>
                    <p className="text-sm text-surface-400">
                      {exercise.default_sets} sets × {exercise.default_reps} reps
                      {exercise.default_weight && ` @ ${exercise.default_weight}lbs`}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingExercise(exercise)}
                      className="p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-700 rounded-lg"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleRemoveExercise(exercise.id)}
                      className="p-2 text-danger-400 hover:text-danger-300 hover:bg-surface-700 rounded-lg"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Exercise Modal */}
      {showAddExercise && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">Add Exercise</h2>
              <input
                type="text"
                value={exerciseSearch}
                onChange={(e) => setExerciseSearch(e.target.value)}
                placeholder="Search exercises..."
                className="w-full mt-3 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {searchResults.map((exercise) => (
                <button
                  key={exercise.id}
                  onClick={() => handleAddExercise(exercise)}
                  className="w-full p-3 text-left hover:bg-surface-800 rounded-lg transition-colors"
                >
                  <p className="font-medium text-surface-100">{exercise.name}</p>
                  <p className="text-sm text-surface-500">
                    {exercise.primary_muscle} • {exercise.equipment}
                  </p>
                </button>
              ))}
              {searchResults.length === 0 && (
                <p className="text-center text-surface-400 py-8">No exercises found</p>
              )}
            </div>
            <div className="p-4 border-t border-surface-700">
              <Button variant="ghost" className="w-full" onClick={() => {
                setShowAddExercise(false);
                setExerciseSearch('');
              }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Exercise Modal */}
      {editingExercise && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">
                Edit {editingExercise.exercise_name}
              </h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-1">
                    Sets
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editingExercise.default_sets}
                    onChange={(e) => setEditingExercise({
                      ...editingExercise,
                      default_sets: parseInt(e.target.value) || 3,
                    })}
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-1">
                    Reps
                  </label>
                  <input
                    type="text"
                    value={editingExercise.default_reps}
                    onChange={(e) => setEditingExercise({
                      ...editingExercise,
                      default_reps: e.target.value,
                    })}
                    placeholder="8-12"
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-1">
                    Default Weight (lbs)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={editingExercise.default_weight || ''}
                    onChange={(e) => setEditingExercise({
                      ...editingExercise,
                      default_weight: e.target.value ? parseFloat(e.target.value) : null,
                    })}
                    placeholder="Optional"
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-1">
                    Rest (seconds)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="15"
                    value={editingExercise.default_rest_seconds}
                    onChange={(e) => setEditingExercise({
                      ...editingExercise,
                      default_rest_seconds: parseInt(e.target.value) || 90,
                    })}
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Notes
                </label>
                <textarea
                  value={editingExercise.notes || ''}
                  onChange={(e) => setEditingExercise({
                    ...editingExercise,
                    notes: e.target.value || null,
                  })}
                  placeholder="Form cues, variations, etc."
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 min-h-[60px]"
                />
              </div>
            </div>
            <div className="p-4 border-t border-surface-700 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingExercise(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleUpdateExercise}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

