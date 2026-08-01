'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient, useIsRestoring } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, ConfirmModal, LoadingAnimation } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import type { WorkoutTemplate, WorkoutTemplateExercise, WorkoutFolder } from '@/types/templates';

const templateDetailKey = (id: string) => ['templateDetail', id] as const;
import Link from 'next/link';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

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

  // Remove-exercise confirmation. Uses ConfirmModal, NOT native confirm():
  // the native dialog can be silently suppressed in the Capacitor webview,
  // which made the Remove button appear to do nothing.
  const [removeConfirmExercise, setRemoveConfirmExercise] =
    useState<{ id: string; name: string } | null>(null);

  // Keyboard-aware insets for the two input-bearing modals
  const { inset: addExerciseKbInset, scrollContainerRef: addExerciseModalRef } =
    useKeyboardInset<HTMLDivElement>(showAddExercise);
  const { inset: editExerciseKbInset, scrollContainerRef: editExerciseModalRef } =
    useKeyboardInset<HTMLDivElement>(!!editingExercise);
  
  // Collapse/expand state
  const [collapsedExercises, setCollapsedExercises] = useState<Set<string>>(new Set());
  
  // Drag reorder state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const preCollapseStateRef = useRef<Set<string> | null>(null);

  const supabase = createUntypedClient();

  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();

  // Per-template data cached by id, so returning to a template (or switching
  // between templates) renders instantly instead of re-blocking full-screen.
  // Moderate staleTime: templates are editable, so revisits revalidate; edits
  // go through loadTemplate() which refetches this query.
  const templateQuery = useQuery({
    queryKey: templateDetailKey(templateId),
    queryFn: async () => {
      const [templateResult, exercisesResult] = await Promise.all([
        supabase.from('workout_templates').select('*').eq('id', templateId).single(),
        supabase
          .from('workout_template_exercises')
          .select('*')
          .eq('template_id', templateId)
          .order('sort_order', { ascending: true }),
      ]);
      if (templateResult.error) throw templateResult.error;
      return {
        template: templateResult.data as WorkoutTemplate,
        exercises: (exercisesResult.data || []) as WorkoutTemplateExercise[],
      };
    },
    enabled: !!templateId,
    staleTime: 1000 * 60,
    gcTime: IMMUTABLE_GC_TIME,
  });

  // Sync local editing state from the cached query. Runs on load and after any
  // edit (which refetches via loadTemplate) — refetches only fire after an
  // explicit save, so this never clobbers an in-progress field edit.
  useEffect(() => {
    if (templateQuery.data) {
      setTemplate(templateQuery.data.template);
      setExercises(templateQuery.data.exercises);
      setTemplateName(templateQuery.data.template.name);
      setTemplateNotes(templateQuery.data.template.notes || '');
      setTemplateFolderId(templateQuery.data.template.folder_id);
      setIsLoading(false);
    } else if (templateQuery.isError) {
      setError('Failed to load template');
      setIsLoading(false);
    }
  }, [templateQuery.data, templateQuery.isError]);

  // Mutations call this to refresh; it refetches the cached query, which
  // re-runs the sync effect above.
  const loadTemplate = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: templateDetailKey(templateId) });
  }, [queryClient, templateId]);

  useEffect(() => {
    loadFolders();
    loadAvailableExercises();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

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
      .is('deleted_at', null) // hide merge-soft-deleted duplicates
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

  // Remove exercise (confirmation handled by the ConfirmModal below — native
  // confirm() is unreliable in the mobile webview). `.select('id')` surfaces
  // an RLS-refused delete, which reports no error but removes 0 rows.
  async function handleRemoveExercise(exerciseId: string) {
    try {
      const { data: deletedRows, error } = await supabase
        .from('workout_template_exercises')
        .delete()
        .eq('id', exerciseId)
        .select('id');

      if (error) throw error;
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error('delete affected 0 rows');
      }
      await loadTemplate();
    } catch (err) {
      console.error('Error removing exercise:', err);
      setError('Failed to remove exercise');
    }
  }

  // Toggle collapse for an exercise
  const toggleCollapse = (exerciseId: string) => {
    setCollapsedExercises(prev => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  };

  // Long press handlers for drag reorder
  const handleLongPressStart = useCallback((index: number) => {
    longPressTimer.current = setTimeout(() => {
      // Save current collapse state before collapsing all for drag mode
      preCollapseStateRef.current = new Set(collapsedExercises);

      setDraggedIndex(index);
      setIsDragging(true);
      // Collapse all exercises for iPhone-style drag mode
      setCollapsedExercises(new Set(exercises.map(ex => ex.id)));

      // Haptic feedback on mobile if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500);
  }, [collapsedExercises, exercises]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleDragOver = useCallback((index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  }, [draggedIndex]);

  const handleDragEnd = useCallback(async () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newExercises = [...exercises];
      const [removed] = newExercises.splice(draggedIndex, 1);
      newExercises.splice(dragOverIndex, 0, removed);

      // Update sort orders
      setExercises(newExercises);

      try {
        for (let i = 0; i < newExercises.length; i++) {
          await supabase
            .from('workout_template_exercises')
            .update({ sort_order: i })
            .eq('id', newExercises[i].id);
        }
        // Persist the new order into the cache so a revisit keeps it.
        queryClient.setQueryData(templateDetailKey(templateId), (prev: any) =>
          prev ? { ...prev, exercises: newExercises } : prev
        );
      } catch (err) {
        console.error('Error saving reorder:', err);
        // Reload to get correct order
        await loadTemplate();
      }
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
    setIsDragging(false);

    // Restore pre-drag collapse state
    if (preCollapseStateRef.current) {
      setCollapsedExercises(preCollapseStateRef.current);
      preCollapseStateRef.current = null;
    }
  }, [draggedIndex, dragOverIndex, exercises, supabase, loadTemplate]);

  // Reorder exercises (fallback for non-drag)
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
      queryClient.setQueryData(templateDetailKey(templateId), (prev: any) =>
        prev ? { ...prev, exercises: newExercises } : prev
      );
    } catch (err) {
      console.error('Error reordering exercises:', err);
    }
  }

  // Full-screen loader only on first-ever load with an empty cache. Revisiting
  // this template id (warm cache) or reloading (IndexedDB restore) has the
  // data available and renders immediately.
  if (isLoading && !templateQuery.data && !isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="template-full-loading">
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
              <p className="text-xs text-surface-500 mb-3">💡 Long-press and drag to reorder • Tap to expand/collapse</p>
              {exercises.map((exercise, index) => {
                const isCollapsed = collapsedExercises.has(exercise.id);
                const isBeingDragged = draggedIndex === index;
                const isDragTarget = dragOverIndex === index;

                return (
                  <div
                    key={exercise.id}
                    className={`rounded-lg overflow-hidden transition-all ${
                      isBeingDragged 
                        ? 'opacity-50 scale-95 shadow-xl ring-2 ring-primary-500' 
                        : isDragTarget 
                          ? 'ring-2 ring-primary-400 ring-dashed'
                          : ''
                    }`}
                    onTouchStart={() => handleLongPressStart(index)}
                    onTouchEnd={() => { handleLongPressEnd(); handleDragEnd(); }}
                    onTouchMove={(e) => {
                      if (!isDragging) return;
                      const touch = e.touches[0];
                      const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
                      const exerciseEl = elements.find(el => el.getAttribute('data-exercise-index'));
                      if (exerciseEl) {
                        const targetIndex = parseInt(exerciseEl.getAttribute('data-exercise-index') || '-1');
                        if (targetIndex >= 0) handleDragOver(targetIndex);
                      }
                    }}
                    onMouseDown={() => handleLongPressStart(index)}
                    onMouseUp={() => { handleLongPressEnd(); handleDragEnd(); }}
                    onMouseLeave={handleLongPressEnd}
                    data-exercise-index={index}
                  >
                    {/* Header - always visible */}
                    <button
                      onClick={() => !isDragging && toggleCollapse(exercise.id)}
                      className={`w-full flex items-center gap-3 p-4 bg-surface-800/50 hover:bg-surface-800 transition-colors text-left ${
                        isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                      }`}
                    >
                      {/* Drag handle */}
                      <div className="flex flex-col gap-0.5 text-surface-500">
                        <div className="w-4 h-0.5 bg-current rounded" />
                        <div className="w-4 h-0.5 bg-current rounded" />
                        <div className="w-4 h-0.5 bg-current rounded" />
                      </div>

                      {/* Exercise name */}
                      <div className="flex-1">
                        <p className="font-medium text-primary-400">{exercise.exercise_name}</p>
                      </div>

                      {/* Collapse indicator */}
                      <svg 
                        className={`w-5 h-5 text-surface-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>

                      {/* Menu button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingExercise(exercise);
                        }}
                        className="p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-700 rounded-lg"
                      >
                        •••
                      </button>
                    </button>

                    {/* Expanded content */}
                    {!isCollapsed && (
                      <div className="p-4 bg-surface-800/30 border-t border-surface-700 space-y-3">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <p className="text-2xl font-bold text-surface-100">{exercise.default_sets}</p>
                            <p className="text-xs text-surface-500 uppercase">Sets</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-surface-100">{exercise.default_reps}</p>
                            <p className="text-xs text-surface-500 uppercase">Reps</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-surface-100">
                              {exercise.default_weight ? `${exercise.default_weight}` : '—'}
                            </p>
                            <p className="text-xs text-surface-500 uppercase">lbs</p>
                          </div>
                        </div>
                        
                        {exercise.notes && (
                          <p className="text-sm text-surface-400 italic">{exercise.notes}</p>
                        )}

                        <div className="flex gap-2 pt-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setEditingExercise(exercise)}
                            className="flex-1"
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() =>
                              setRemoveConfirmExercise({ id: exercise.id, name: exercise.exercise_name })
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Exercise Modal */}
      {showAddExercise && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          style={{
            // Re-center above the on-screen keyboard; safe-area stays additive.
            paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px) + ${addExerciseKbInset}px)`,
          }}
        >
          <div
            ref={addExerciseModalRef}
            className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-lg flex flex-col"
            style={{ maxHeight: `min(80vh, calc(100vh - 2rem - ${addExerciseKbInset}px))` }}
          >
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
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          style={{
            // Re-center above the on-screen keyboard; safe-area stays additive.
            paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px) + ${editExerciseKbInset}px)`,
          }}
        >
          <div
            ref={editExerciseModalRef}
            className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md overflow-y-auto"
            style={{ maxHeight: `calc(100vh - 2rem - ${editExerciseKbInset}px)` }}
          >
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

      {/* Remove Exercise Confirmation Modal */}
      <ConfirmModal
        isOpen={removeConfirmExercise !== null}
        onClose={() => setRemoveConfirmExercise(null)}
        onConfirm={() => {
          if (removeConfirmExercise) {
            void handleRemoveExercise(removeConfirmExercise.id);
            setRemoveConfirmExercise(null);
          }
        }}
        title="Remove Exercise"
        message={
          removeConfirmExercise
            ? `Remove "${removeConfirmExercise.name}" from this template?`
            : ''
        }
        confirmText="Remove"
        cancelText="Keep"
        variant="danger"
      />
    </div>
  );
}

