'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, Button, LoadingAnimation } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import type { WorkoutFolder, WorkoutTemplate, WorkoutTemplateExercise } from '@/types/templates';
import Link from 'next/link';

interface FolderWithTemplates extends WorkoutFolder {
  templates: (WorkoutTemplate & { exercises: WorkoutTemplateExercise[] })[];
  isExpanded: boolean;
}

const FOLDER_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

export default function TemplatesPage() {
  const [folders, setFolders] = useState<FolderWithTemplates[]>([]);
  const [unfolderedTemplates, setUnfolderedTemplates] = useState<(WorkoutTemplate & { exercises: WorkoutTemplateExercise[] })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modal states
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [editingFolder, setEditingFolder] = useState<WorkoutFolder | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<WorkoutTemplate | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  
  // Form states
  const [folderName, setFolderName] = useState('');
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);
  const [templateName, setTemplateName] = useState('');
  const [templateFolderId, setTemplateFolderId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Menu states
  const [openFolderMenu, setOpenFolderMenu] = useState<string | null>(null);
  const [openTemplateMenu, setOpenTemplateMenu] = useState<string | null>(null);

  const supabase = createUntypedClient();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch folders and templates in parallel
      const [foldersResult, templatesResult, exercisesResult] = await Promise.all([
        supabase
          .from('workout_folders')
          .select('*')
          .eq('user_id', user.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('workout_templates')
          .select('*')
          .eq('user_id', user.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('workout_template_exercises')
          .select('*')
          .order('sort_order', { ascending: true }),
      ]);

      const foldersData = foldersResult.data || [];
      const templatesData = templatesResult.data || [];
      const exercisesData = exercisesResult.data || [];

      // Map exercises to templates
      const templatesWithExercises = templatesData.map((template: WorkoutTemplate) => ({
        ...template,
        exercises: exercisesData.filter((e: WorkoutTemplateExercise) => e.template_id === template.id),
      }));

      // Group templates into folders
      const foldersWithTemplates: FolderWithTemplates[] = foldersData.map((folder: WorkoutFolder) => ({
        ...folder,
        templates: templatesWithExercises.filter((t: WorkoutTemplate & { exercises: WorkoutTemplateExercise[] }) => t.folder_id === folder.id),
        isExpanded: true,
      }));

      // Get unfoldered templates
      const unfoldered = templatesWithExercises.filter((t: WorkoutTemplate & { exercises: WorkoutTemplateExercise[] }) => !t.folder_id);

      setFolders(foldersWithTemplates);
      setUnfolderedTemplates(unfoldered);
    } catch (err) {
      console.error('Error loading templates:', err);
      setError('Failed to load templates');
    } finally {
      setIsLoading(false);
    }
  }

  // Toggle folder expansion
  function toggleFolder(folderId: string) {
    setFolders(prev => prev.map(f => 
      f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f
    ));
  }

  // Create folder
  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderName.trim()) return;

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('workout_folders').insert({
        user_id: user.id,
        name: folderName.trim(),
        color: folderColor,
        sort_order: folders.length,
      });

      if (error) throw error;

      setFolderName('');
      setFolderColor(FOLDER_COLORS[0]);
      setShowCreateFolder(false);
      await loadData();
    } catch (err) {
      console.error('Error creating folder:', err);
      setError('Failed to create folder');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Update folder
  async function handleUpdateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!editingFolder || !folderName.trim()) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('workout_folders')
        .update({ name: folderName.trim(), color: folderColor })
        .eq('id', editingFolder.id);

      if (error) throw error;

      setEditingFolder(null);
      setFolderName('');
      await loadData();
    } catch (err) {
      console.error('Error updating folder:', err);
      setError('Failed to update folder');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Delete folder
  async function handleDeleteFolder(folderId: string) {
    if (!confirm('Delete this folder? Templates inside will be moved out of the folder.')) return;

    try {
      // First, move templates out of the folder
      await supabase
        .from('workout_templates')
        .update({ folder_id: null })
        .eq('folder_id', folderId);

      // Then delete the folder
      const { error } = await supabase
        .from('workout_folders')
        .delete()
        .eq('id', folderId);

      if (error) throw error;
      await loadData();
    } catch (err) {
      console.error('Error deleting folder:', err);
      setError('Failed to delete folder');
    }
    setOpenFolderMenu(null);
  }

  // Create template
  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!templateName.trim()) return;

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('workout_templates').insert({
        user_id: user.id,
        name: templateName.trim(),
        folder_id: templateFolderId,
        sort_order: 0,
      });

      if (error) throw error;

      setTemplateName('');
      setTemplateFolderId(null);
      setShowCreateTemplate(false);
      await loadData();
    } catch (err) {
      console.error('Error creating template:', err);
      setError('Failed to create template');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Delete template
  async function handleDeleteTemplate(templateId: string) {
    if (!confirm('Delete this template? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('workout_templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;
      await loadData();
    } catch (err) {
      console.error('Error deleting template:', err);
      setError('Failed to delete template');
    }
    setOpenTemplateMenu(null);
  }

  // Format exercise list
  function formatExerciseList(exercises: WorkoutTemplateExercise[]) {
    if (exercises.length === 0) return 'No exercises';
    const names = exercises.map(e => e.exercise_name);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} & ${names.length - 3} more...`;
  }

  // Format date
  function formatDate(dateStr: string | null) {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingAnimation />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-surface-100">Templates</h1>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              setTemplateFolderId(null);
              setShowCreateTemplate(true);
            }}
          >
            + Template
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowCreateFolder(true)}
          >
            📁
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
          {error}
        </div>
      )}

      {/* Folders */}
      <div className="space-y-4">
        {folders.map((folder) => (
          <div key={folder.id} className="space-y-2">
            {/* Folder Header */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => toggleFolder(folder.id)}
                className="flex items-center gap-2 text-left group"
              >
                <span style={{ color: folder.color }}>📁</span>
                <span className="font-semibold text-surface-100 group-hover:text-primary-400 transition-colors">
                  {folder.name}
                </span>
                <span className="text-sm text-surface-500">({folder.templates.length})</span>
                <span className="text-surface-500 text-sm">
                  {folder.isExpanded ? '▼' : '▶'}
                </span>
              </button>
              <div className="relative">
                <button
                  onClick={() => setOpenFolderMenu(openFolderMenu === folder.id ? null : folder.id)}
                  className="p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
                >
                  •••
                </button>
                {openFolderMenu === folder.id && (
                  <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10 min-w-[140px]">
                    <button
                      onClick={() => {
                        setEditingFolder(folder);
                        setFolderName(folder.name);
                        setFolderColor(folder.color);
                        setOpenFolderMenu(null);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-surface-200 hover:bg-surface-700 first:rounded-t-lg"
                    >
                      Edit Folder
                    </button>
                    <button
                      onClick={() => {
                        setTemplateFolderId(folder.id);
                        setShowCreateTemplate(true);
                        setOpenFolderMenu(null);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-surface-200 hover:bg-surface-700"
                    >
                      Add Template
                    </button>
                    <button
                      onClick={() => handleDeleteFolder(folder.id)}
                      className="w-full px-4 py-2 text-left text-sm text-danger-400 hover:bg-surface-700 last:rounded-b-lg"
                    >
                      Delete Folder
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Folder Templates */}
            {folder.isExpanded && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
                {folder.templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    formatExerciseList={formatExerciseList}
                    formatDate={formatDate}
                    onDelete={() => handleDeleteTemplate(template.id)}
                    menuOpen={openTemplateMenu === template.id}
                    onMenuToggle={() => setOpenTemplateMenu(openTemplateMenu === template.id ? null : template.id)}
                  />
                ))}
                {folder.templates.length === 0 && (
                  <p className="text-sm text-surface-500 py-4">No templates in this folder</p>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Unfoldered Templates */}
        {unfolderedTemplates.length > 0 && (
          <div className="space-y-2">
            {folders.length > 0 && (
              <p className="text-sm text-surface-500 font-medium">Other Templates</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {unfolderedTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  formatExerciseList={formatExerciseList}
                  formatDate={formatDate}
                  onDelete={() => handleDeleteTemplate(template.id)}
                  menuOpen={openTemplateMenu === template.id}
                  onMenuToggle={() => setOpenTemplateMenu(openTemplateMenu === template.id ? null : template.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {folders.length === 0 && unfolderedTemplates.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <span className="text-5xl mb-4 block">📋</span>
              <h3 className="text-lg font-semibold text-surface-100 mb-2">No Templates Yet</h3>
              <p className="text-surface-400 mb-4">
                Create workout templates to quickly start your favorite routines
              </p>
              <Button variant="primary" onClick={() => setShowCreateTemplate(true)}>
                Create Your First Template
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Folder Modal */}
      {(showCreateFolder || editingFolder) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">
                {editingFolder ? 'Edit Folder' : 'Create Folder'}
              </h2>
            </div>
            <form onSubmit={editingFolder ? handleUpdateFolder : handleCreateFolder}>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-1">
                    Folder Name
                  </label>
                  <input
                    type="text"
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    placeholder="e.g., Push Pull Legs"
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Color
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {FOLDER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFolderColor(color)}
                        className={`w-8 h-8 rounded-full transition-transform ${
                          folderColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-900 scale-110' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-surface-700 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowCreateFolder(false);
                    setEditingFolder(null);
                    setFolderName('');
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting || !folderName.trim()}>
                  {isSubmitting ? 'Saving...' : editingFolder ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md">
            <div className="p-4 border-b border-surface-700">
              <h2 className="text-lg font-semibold text-surface-100">Create Template</h2>
            </div>
            <form onSubmit={handleCreateTemplate}>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-1">
                    Template Name
                  </label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g., Push Day, Upper Body"
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
                    autoFocus
                  />
                </div>
                {folders.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-1">
                      Folder (optional)
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
                )}
              </div>
              <div className="p-4 border-t border-surface-700 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowCreateTemplate(false);
                    setTemplateName('');
                    setTemplateFolderId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting || !templateName.trim()}>
                  {isSubmitting ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Click outside to close menus */}
      {(openFolderMenu || openTemplateMenu) && (
        <div 
          className="fixed inset-0 z-0" 
          onClick={() => {
            setOpenFolderMenu(null);
            setOpenTemplateMenu(null);
          }}
        />
      )}
    </div>
  );
}

// Template Card Component
function TemplateCard({
  template,
  formatExerciseList,
  formatDate,
  onDelete,
  menuOpen,
  onMenuToggle,
}: {
  template: WorkoutTemplate & { exercises: WorkoutTemplateExercise[] };
  formatExerciseList: (exercises: WorkoutTemplateExercise[]) => string;
  formatDate: (date: string | null) => string;
  onDelete: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  return (
    <Card className="relative">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <Link 
            href={`/dashboard/templates/${template.id}`}
            className="font-semibold text-surface-100 hover:text-primary-400 transition-colors"
          >
            {template.name}
          </Link>
          <div className="relative">
            <button
              onClick={(e) => {
                e.preventDefault();
                onMenuToggle();
              }}
              className="p-1 text-surface-400 hover:text-surface-200 hover:bg-surface-700 rounded transition-colors"
            >
              •••
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-20 min-w-[140px]">
                <Link
                  href={`/dashboard/templates/${template.id}`}
                  className="block px-4 py-2 text-sm text-surface-200 hover:bg-surface-700 first:rounded-t-lg"
                >
                  Edit Template
                </Link>
                <Link
                  href={`/dashboard/workout/new?template=${template.id}`}
                  className="block px-4 py-2 text-sm text-surface-200 hover:bg-surface-700"
                >
                  Start Workout
                </Link>
                <button
                  onClick={onDelete}
                  className="w-full px-4 py-2 text-left text-sm text-danger-400 hover:bg-surface-700 last:rounded-b-lg"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="text-sm text-surface-400 mb-3 line-clamp-2">
          {formatExerciseList(template.exercises)}
        </p>
        <div className="flex items-center gap-1 text-xs text-surface-500">
          <span>🕐</span>
          <span>{formatDate(template.last_performed_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

