'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';
import { validateExercisePrimary } from '@/services/muscleAttributionAudit';

/**
 * Fetch all exercises from the database, ordered by name
 */
export async function fetchAllExercises(): Promise<{
  data: Record<string, unknown>[] | null;
  error: { message?: string } | null;
}> {
  const supabase = await createUntypedServerClient();
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    // Hide exercises soft-deleted by a merge (deleted_at/merged_into set in
    // migration 20260711000002).
    .is('deleted_at', null)
    .order('name');

  return { data: data as Record<string, unknown>[] | null, error };
}

/**
 * Insert a custom exercise into the database.
 * Returns the inserted row or an error.
 */
export async function insertCustomExercise(
  payload: Record<string, unknown>
): Promise<{
  data: Record<string, unknown> | null;
  error: { message?: string; details?: string; hint?: string; code?: string } | null;
}> {
  const supabase = await createUntypedServerClient();

  // Verify authentication. The server client reads the session from the
  // request cookies; session refresh is handled by middleware.
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { data: null, error: { message: 'Authentication error', code: 'AUTH_ERROR' } };
  }

  // Server-side attribution constraint (defense in depth behind
  // createCustomExercise's check): no new exercise may carry a group-level
  // splitting primary — that's the rule that ranked targets below
  // secondaries across the whole legacy-tagged library.
  const primaryError = validateExercisePrimary(String(payload.primary_muscle ?? ''));
  if (primaryError) {
    return { data: null, error: { message: primaryError, code: 'GROUP_PRIMARY' } };
  }

  // Use authenticated user's ID for security
  const authenticatedPayload = {
    ...payload,
    created_by: user.id,
    is_custom: true,
  };

  const { data, error } = await supabase
    .from('exercises')
    .insert(authenticatedPayload)
    .select()
    .single();

  return { data: data as Record<string, unknown> | null, error };
}

/**
 * Delete a custom exercise from the database
 */
export async function removeCustomExercise(
  exerciseId: string,
  userId: string
): Promise<{ error: { message?: string; code?: string } | null }> {
  const supabase = await createUntypedServerClient();
  const { error } = await supabase
    .from('exercises')
    .delete()
    .eq('id', exerciseId)
    .eq('created_by', userId)
    .eq('is_custom', true);

  return { error };
}
