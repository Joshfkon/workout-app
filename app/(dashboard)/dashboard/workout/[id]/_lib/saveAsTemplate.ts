/**
 * saveAsTemplate.ts
 *
 * Persists a session-derived template (workout_templates +
 * workout_template_exercises). The row shapes come from
 * services/templateFromSession (pure); this file only writes them.
 *
 * Kept as a plain function that receives the supabase client so the page
 * stays 'use client', matching sessionWrites.ts. Errors are thrown, not
 * swallowed — the caller surfaces them as a toast.
 */

import type { TemplateExerciseDraft } from '@/services/templateFromSession';

type SupabaseClient = ReturnType<typeof import('@/lib/supabase/client').createUntypedClient>;

export interface SaveAsTemplateArgs {
  userId: string;
  name: string;
  folderId: string | null;
  notes?: string | null;
  exercises: TemplateExerciseDraft[];
}

/**
 * Create the template and its exercises. If the exercise insert fails the
 * parent template is deleted again — an empty template the user never asked
 * for is worse than no template.
 */
export async function saveSessionAsTemplate(
  supabase: SupabaseClient,
  { userId, name, folderId, notes = null, exercises }: SaveAsTemplateArgs
): Promise<{ templateId: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Template name is required');
  if (exercises.length === 0) throw new Error('This workout has no exercises to save');

  const { data: template, error: templateError } = await supabase
    .from('workout_templates')
    .insert({
      user_id: userId,
      name: trimmedName,
      folder_id: folderId,
      notes: notes?.trim() || null,
      sort_order: 0,
    })
    .select('id')
    .single();

  if (templateError) throw templateError;
  const templateId = (template as { id: string } | null)?.id;
  if (!templateId) throw new Error('Template was created without an id');

  const { error: exerciseError } = await supabase
    .from('workout_template_exercises')
    .insert(exercises.map((exercise) => ({ ...exercise, template_id: templateId })));

  if (exerciseError) {
    await supabase.from('workout_templates').delete().eq('id', templateId);
    throw exerciseError;
  }

  return { templateId };
}
