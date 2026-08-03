'use client';

/**
 * SaveAsTemplateModal.tsx
 *
 * "Save as template" from the active workout's ⋮ menu: name the template,
 * optionally file it in a folder, and see exactly what will be captured
 * before saving.
 *
 * The rows are built by the caller (services/templateFromSession) — this
 * component only names them, picks a folder, and writes. Weights arrive in
 * kg (storage invariant) and render in the user's unit.
 */

import { useCallback, useEffect, useState } from 'react';
import { IconFolder, IconTemplate } from '@tabler/icons-react';
import { Button, Input, Modal, ModalFooter, Select } from '@/components/ui';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { createUntypedClient } from '@/lib/supabase/client';
import { formatWeight } from '@/lib/utils';
import type { TemplateExerciseDraft } from '@/services/templateFromSession';
import type { WorkoutFolder } from '@/types/templates';
import { saveSessionAsTemplate } from '../_lib/saveAsTemplate';

export interface SaveAsTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-filled template name (the derived workout label, e.g. "Push"). */
  defaultName: string;
  /** Rows to write, in template order. */
  exercises: TemplateExerciseDraft[];
  /** Called after a successful save so the page can toast / link out. */
  onSaved: (result: { templateId: string; name: string }) => void;
}

const NO_FOLDER = '';

export function SaveAsTemplateModal({
  isOpen,
  onClose,
  defaultName,
  exercises,
  onSaved,
}: SaveAsTemplateModalProps) {
  const { preferences } = useUserPreferences();
  const units = preferences.units;

  const [name, setName] = useState(defaultName);
  const [folderId, setFolderId] = useState<string>(NO_FOLDER);
  const [folders, setFolders] = useState<WorkoutFolder[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean sheet each time the modal opens — a stale half-typed
  // name from a previous open is never what the user wants.
  useEffect(() => {
    if (!isOpen) return;
    setName(defaultName);
    setFolderId(NO_FOLDER);
    setError(null);
  }, [isOpen, defaultName]);

  // Folders are only needed while the sheet is open; load them on open.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('workout_folders')
          .select('*')
          .eq('user_id', user.id)
          .order('sort_order', { ascending: true });
        if (!cancelled && data) setFolders(data as WorkoutFolder[]);
      } catch (err) {
        // A folder list is optional context — saving still works without it.
        console.error('Error loading folders:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You need to be signed in to save a template');

      const { templateId } = await saveSessionAsTemplate(supabase, {
        userId: user.id,
        name,
        folderId: folderId || null,
        exercises,
      });

      onSaved({ templateId, name: name.trim() });
      onClose();
    } catch (err) {
      console.error('Error saving template:', err);
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setIsSaving(false);
    }
  }, [name, isSaving, folderId, exercises, onSaved, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Save as template"
      description="Reuse this workout later — exercises, sets, reps and working weights are captured as defaults."
      size="md"
    >
      <div className="space-y-4" data-testid="save-as-template-modal">
        <Input
          label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Push A"
          maxLength={80}
          autoFocus
          leftIcon={<IconTemplate size={18} />}
          className="pl-10"
        />

        {folders.length > 0 && (
          <Select
            label="Folder"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            options={[
              { value: NO_FOLDER, label: 'No folder' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
          />
        )}

        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-surface-200 mb-1.5">
            <IconFolder size={16} className="text-surface-400" />
            {exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'}
          </p>
          <ul
            className="max-h-48 overflow-y-auto rounded-lg border border-surface-700 divide-y divide-surface-800"
            data-testid="save-as-template-preview"
          >
            {exercises.map((exercise) => (
              <li
                key={`${exercise.exercise_id}-${exercise.sort_order}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-surface-200 truncate">{exercise.exercise_name}</span>
                <span className="flex-shrink-0 text-xs text-surface-500 tabular-nums">
                  {exercise.default_sets} × {exercise.default_reps}
                  {exercise.default_weight
                    ? ` · ${formatWeight(exercise.default_weight, units, 0)}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p className="text-sm text-danger-400" role="alert">
            {error}
          </p>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!name.trim() || exercises.length === 0}
          isLoading={isSaving}
        >
          Save template
        </Button>
      </ModalFooter>
    </Modal>
  );
}
