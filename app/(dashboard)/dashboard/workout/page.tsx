'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import type { WorkoutFolder, WorkoutTemplate, WorkoutTemplateExercise } from '@/types/templates';

interface PlannedWorkout {
  id: string;
  planned_date: string;
  state: string;
  exercise_count: number;
}

interface ActiveMesocycle {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  currentWeek: number;
  daysPerWeek: number;
  workoutsThisWeek: number;
  split: string;
}

interface FolderWithTemplates extends WorkoutFolder {
  templates: (WorkoutTemplate & { exercises: WorkoutTemplateExercise[] })[];
  isExpanded: boolean;
}

const FOLDER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

const QUICK_TEMPLATES = [
  { name: 'Push', muscles: 'Chest, Shoulders, Triceps', icon: '💪', muscleIds: 'chest,shoulders,triceps' },
  { name: 'Pull', muscles: 'Back, Biceps, Rear Delts', icon: '🏋️', muscleIds: 'back,biceps,shoulders' },
  { name: 'Legs', muscles: 'Quads, Hamstrings, Glutes', icon: '🦵', muscleIds: 'quads,hamstrings,glutes,calves' },
  { name: 'Upper', muscles: 'Chest, Back, Shoulders, Arms', icon: '👆', muscleIds: 'chest,back,shoulders,biceps,triceps' },
  { name: 'Lower', muscles: 'Quads, Hamstrings, Glutes', icon: '👇', muscleIds: 'quads,hamstrings,glutes,calves' },
  { name: 'Full Body', muscles: 'All muscle groups', icon: '🔥', muscleIds: 'chest,back,shoulders,quads,biceps,triceps' },
];

export default function WorkoutPage() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [inProgressWorkout, setInProgressWorkout] = useState<PlannedWorkout | null>(null);
  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([]);
  const [activeMesocycle, setActiveMesocycle] = useState<ActiveMesocycle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Template states
  const [folders, setFolders] = useState<FolderWithTemplates[]>([]);
  const [unfolderedTemplates, setUnfolderedTemplates] = useState<(WorkoutTemplate & { exercises: WorkoutTemplateExercise[] })[]>([]);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);
  const [templateName, setTemplateName] = useState('');
  const [templateFolderId, setTemplateFolderId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const supabase = createUntypedClient();

  useEffect(() => {
    fetchWorkouts();
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTemplates() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [foldersResult, templatesResult, exercisesResult] = await Promise.all([
      supabase.from('workout_folders').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('workout_templates').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('workout_template_exercises').select('*').order('sort_order'),
    ]);

    const foldersData = foldersResult.data || [];
    const templatesData = templatesResult.data || [];
    const exercisesData = exercisesResult.data || [];

    const templatesWithExercises = templatesData.map((t: WorkoutTemplate) => ({
      ...t,
      exercises: exercisesData.filter((e: WorkoutTemplateExercise) => e.template_id === t.id),
    }));

    const foldersWithTemplates: FolderWithTemplates[] = foldersData.map((f: WorkoutFolder) => ({
      ...f,
      templates: templatesWithExercises.filter((t: WorkoutTemplate) => t.folder_id === f.id),
      isExpanded: true,
    }));

    setFolders(foldersWithTemplates);
    setUnfolderedTemplates(templatesWithExercises.filter((t: WorkoutTemplate) => !t.folder_id));
  }

  async function fetchWorkouts() {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        return;
      }

      // Calculate date ranges
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(now);
      weekStart.setDate(diff);
      weekStart.setHours(0, 0, 0, 0);

      try {
        // OPTIMIZATION: Run all queries in parallel
        const [inProgressResult, plannedResult, mesocycleResult] = await Promise.all([
          // In-progress workout
          supabase
            .from('workout_sessions')
            .select(`
              id,
              planned_date,
              state,
              exercise_blocks (id)
            `)
            .eq('user_id', user.id)
            .eq('state', 'in_progress')
            .maybeSingle(),

          // Planned workouts
          supabase
            .from('workout_sessions')
            .select(`
              id,
              planned_date,
              state,
              exercise_blocks (id)
            `)
            .eq('user_id', user.id)
            .eq('state', 'planned')
            .order('planned_date', { ascending: true })
            .limit(5),

          // Active mesocycle with completed workouts this week
          supabase
            .from('mesocycles')
            .select(`
              id,
              name,
              start_date,
              total_weeks,
              days_per_week,
              split_type,
              workout_sessions!inner (
                id,
                state,
                completed_at
              )
            `)
            .eq('user_id', user.id)
            .eq('is_active', true)
            .gte('workout_sessions.completed_at', weekStart.toISOString())
            .maybeSingle(),
        ]);

        // Set in-progress workout
        if (inProgressResult.data) {
          setInProgressWorkout({
            id: inProgressResult.data.id,
            planned_date: inProgressResult.data.planned_date,
            state: inProgressResult.data.state,
            exercise_count: inProgressResult.data.exercise_blocks?.length || 0,
          });
        }

        // Set planned workouts
        if (plannedResult.data) {
          setPlannedWorkouts(
            plannedResult.data.map((w: any) => ({
              id: w.id,
              planned_date: w.planned_date,
              state: w.state,
              exercise_count: w.exercise_blocks?.length || 0,
            }))
          );
        }

        // Set active mesocycle with weekly count
        if (mesocycleResult.data) {
          const mesocycle = mesocycleResult.data;
          const startDate = new Date(mesocycle.start_date);
          const weeksSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          const currentWeek = Math.min(weeksSinceStart, mesocycle.total_weeks);

          // Count completed workouts from already-fetched data
          const weeklyCount = mesocycle.workout_sessions?.filter(
            (s: any) => s.state === 'completed'
          ).length || 0;

          setActiveMesocycle({
            id: mesocycle.id,
            name: mesocycle.name,
            startDate: mesocycle.start_date,
            weeks: mesocycle.total_weeks,
            currentWeek,
            daysPerWeek: mesocycle.days_per_week || 3,
            workoutsThisWeek: weeklyCount,
            split: mesocycle.split_type || 'custom',
          });
        }
      } catch (error) {
        console.error('Error fetching workouts:', error);
      } finally {
        setIsLoading(false);
      }
  }

  const handleQuickStart = () => {
    setIsStarting(true);
    router.push('/dashboard/workout/new');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
  };

  // Template management functions
  function toggleFolder(folderId: string) {
    setFolders(prev => prev.map(f => 
      f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f
    ));
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderName.trim()) return;
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('workout_folders').insert({
        user_id: user.id,
        name: folderName.trim(),
        color: folderColor,
        sort_order: folders.length,
      });
      setFolderName('');
      setShowCreateFolder(false);
      await fetchTemplates();
    } catch (err) {
      console.error('Error creating folder:', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!templateName.trim()) return;
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('workout_templates').insert({
        user_id: user.id,
        name: templateName.trim(),
        folder_id: templateFolderId,
      }).select('id').single();
      setTemplateName('');
      setShowCreateTemplate(false);
      if (data) {
        router.push(`/dashboard/templates/${data.id}`);
      }
    } catch (err) {
      console.error('Error creating template:', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    if (!confirm('Delete this template?')) return;
    await supabase.from('workout_templates').delete().eq('id', templateId);
    await fetchTemplates();
    setOpenMenu(null);
  }

  async function handleDeleteFolder(folderId: string) {
    if (!confirm('Delete this folder? Templates will be moved out.')) return;
    await supabase.from('workout_templates').update({ folder_id: null }).eq('folder_id', folderId);
    await supabase.from('workout_folders').delete().eq('id', folderId);
    await fetchTemplates();
    setOpenMenu(null);
  }

  function formatExerciseList(exercises: WorkoutTemplateExercise[]) {
    if (!exercises?.length) return 'No exercises';
    const names = exercises.map(e => e.exercise_name);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workouts</h1>
          <p className="text-surface-400 mt-1">Start a workout or view planned sessions</p>
        </div>
        <Button onClick={handleQuickStart} isLoading={isStarting}>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Workout
        </Button>
      </div>

      {/* Active Mesocycle */}
      {activeMesocycle && (
        <Card className="border border-primary-500/20 bg-gradient-to-r from-primary-500/5 to-transparent">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="info" size="sm">Week {activeMesocycle.currentWeek}/{activeMesocycle.weeks}</Badge>
                  <span className="text-sm text-surface-400 capitalize">{activeMesocycle.split.replace('_', '/')} Split</span>
                </div>
                <h3 className="text-lg font-semibold text-surface-100 mt-1">{activeMesocycle.name}</h3>
                <p className="text-sm text-surface-400">
                  {activeMesocycle.workoutsThisWeek} of {activeMesocycle.daysPerWeek} workouts this week
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* Weekly progress dots */}
                <div className="flex gap-1.5">
                  {Array.from({ length: activeMesocycle.daysPerWeek }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full ${
                        i < activeMesocycle.workoutsThisWeek
                          ? 'bg-success-500'
                          : 'bg-surface-700'
                      }`}
                    />
                  ))}
                </div>
                <Link href="/dashboard/mesocycle">
                  <Button variant="ghost" size="sm">
                    View Plan →
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI-Planned Workout - Prominent placement */}
      <Card className="border border-accent-500/30 bg-gradient-to-r from-accent-500/10 via-primary-500/5 to-transparent overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-accent-500/20 to-transparent rounded-bl-full" />
        <CardContent className="p-6 relative">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500 to-primary-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-surface-100">AI-Planned Workout</h3>
                  <Badge variant="info" size="sm">Smart</Badge>
                </div>
                <p className="text-surface-400 text-sm">
                  Get a personalized workout based on your recovery, goals, and training history
                </p>
              </div>
            </div>
            <Link href="/dashboard/workout/new?ai=true">
              <Button className="whitespace-nowrap bg-gradient-to-r from-accent-500 to-primary-500 hover:from-accent-600 hover:to-primary-600">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Workout
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* In-progress workout */}
      {inProgressWorkout && (
        <Card variant="elevated" className="border-2 border-warning-500/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Badge variant="warning">In Progress</Badge>
                  <h3 className="text-lg font-semibold text-surface-100">
                    Continue Your Workout
                  </h3>
                </div>
                <p className="text-surface-400 mt-1">
                  {inProgressWorkout.exercise_count} exercises • Started {formatDate(inProgressWorkout.planned_date)}
                </p>
              </div>
              <Link href={`/dashboard/workout/${inProgressWorkout.id}`}>
                <Button>Continue</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Planned workouts */}
      {plannedWorkouts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Workouts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {plannedWorkouts.map((workout) => (
                <div
                  key={workout.id}
                  className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-surface-200">{formatDate(workout.planned_date)}</p>
                    <p className="text-sm text-surface-500">
                      {workout.exercise_count} exercises planned
                    </p>
                  </div>
                  <Link href={`/dashboard/workout/${workout.id}`}>
                    <Button variant="secondary" size="sm">Start</Button>
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !inProgressWorkout && plannedWorkouts.length === 0 && (
        <Card variant="elevated" className="overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">No planned workouts</h2>
            <p className="text-surface-400 mt-2 max-w-md mx-auto">
              Start a quick workout or create a mesocycle to plan your training.
            </p>
            <div className="flex justify-center gap-3 mt-6">
              <Link href="/dashboard/workout/new">
                <Button>Start Quick Workout</Button>
              </Link>
              <Link href="/dashboard/mesocycle/new">
                <Button variant="secondary">Create Mesocycle</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* Workout templates */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Workout Templates</CardTitle>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => setShowCreateTemplate(true)}>
                + Template
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowCreateFolder(true)}>
                📁
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Custom Templates - Folders */}
          {folders.map((folder) => (
            <div key={folder.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => toggleFolder(folder.id)}
                  className="flex items-center gap-2 text-sm font-medium text-surface-300 hover:text-surface-100"
                >
                  <span style={{ color: folder.color }}>📁</span>
                  {folder.name} ({folder.templates.length})
                  <span className="text-xs">{folder.isExpanded ? '▼' : '▶'}</span>
                </button>
                <div className="relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === folder.id ? null : folder.id)}
                    className="p-1 text-surface-500 hover:text-surface-300"
                  >
                    •••
                  </button>
                  {openMenu === folder.id && (
                    <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10 min-w-[120px]">
                      <button
                        onClick={() => { setTemplateFolderId(folder.id); setShowCreateTemplate(true); setOpenMenu(null); }}
                        className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-700"
                      >
                        Add Template
                      </button>
                      <button
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="w-full px-3 py-2 text-left text-sm text-danger-400 hover:bg-surface-700"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {folder.isExpanded && folder.templates.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 pl-5">
                  {folder.templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      formatExerciseList={formatExerciseList}
                      onDelete={() => handleDeleteTemplate(template.id)}
                      menuOpen={openMenu === template.id}
                      onMenuToggle={() => setOpenMenu(openMenu === template.id ? null : template.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Unfoldered Custom Templates */}
          {unfolderedTemplates.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {unfolderedTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  formatExerciseList={formatExerciseList}
                  onDelete={() => handleDeleteTemplate(template.id)}
                  menuOpen={openMenu === template.id}
                  onMenuToggle={() => setOpenMenu(openMenu === template.id ? null : template.id)}
                />
              ))}
            </div>
          )}

          {/* Quick Start Templates */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wide mb-2">Quick Start</p>
            <div className="grid gap-2 grid-cols-3 sm:grid-cols-6">
              {QUICK_TEMPLATES.map((template) => (
                <Link
                  key={template.name}
                  href={`/dashboard/workout/new?template=${encodeURIComponent(template.name)}&muscles=${template.muscleIds}`}
                  className="p-3 bg-surface-800/50 rounded-lg text-center hover:bg-surface-800 transition-colors group"
                >
                  <span className="text-xl block">{template.icon}</span>
                  <span className="text-xs font-medium text-surface-400 group-hover:text-surface-200">
                    {template.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create Folder Modal */}
      {showCreateFolder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-sm">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">Create Folder</h2>
            </div>
            <form onSubmit={handleCreateFolder}>
              <div className="p-4 space-y-4">
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Folder name..."
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  autoFocus
                />
                <div className="flex gap-2">
                  {FOLDER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFolderColor(color)}
                      className={`w-6 h-6 rounded-full ${folderColor === color ? 'ring-2 ring-white' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="p-4 border-t border-surface-700 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowCreateFolder(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-sm">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">Create Template</h2>
            </div>
            <form onSubmit={handleCreateTemplate}>
              <div className="p-4 space-y-4">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name..."
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  autoFocus
                />
                {folders.length > 0 && (
                  <select
                    value={templateFolderId || ''}
                    onChange={(e) => setTemplateFolderId(e.target.value || null)}
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="p-4 border-t border-surface-700 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => { setShowCreateTemplate(false); setTemplateFolderId(null); }}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  );
}

// Template Card Component
function TemplateCard({
  template,
  formatExerciseList,
  onDelete,
  menuOpen,
  onMenuToggle,
}: {
  template: WorkoutTemplate & { exercises: WorkoutTemplateExercise[] };
  formatExerciseList: (exercises: WorkoutTemplateExercise[]) => string;
  onDelete: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  return (
    <div className="relative p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors group">
      <div className="flex justify-between items-start">
        <Link href={`/dashboard/templates/${template.id}`} className="flex-1">
          <h4 className="font-medium text-surface-200 group-hover:text-surface-100 text-sm">
            {template.name}
          </h4>
          <p className="text-xs text-surface-500 mt-0.5 line-clamp-1">
            {formatExerciseList(template.exercises)}
          </p>
        </Link>
        <div className="relative">
          <button onClick={onMenuToggle} className="p-1 text-surface-500 hover:text-surface-300 text-xs">
            •••
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-20 min-w-[100px]">
              <Link
                href={`/dashboard/workout/new?template=${template.id}`}
                className="block px-3 py-2 text-sm text-surface-200 hover:bg-surface-700"
              >
                Start
              </Link>
              <Link
                href={`/dashboard/templates/${template.id}`}
                className="block px-3 py-2 text-sm text-surface-200 hover:bg-surface-700"
              >
                Edit
              </Link>
              <button
                onClick={onDelete}
                className="w-full px-3 py-2 text-left text-sm text-danger-400 hover:bg-surface-700"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
