'use server';

import { createUntypedClient } from '@/lib/supabase/client';

/**
 * Fetch all exercises from the database, ordered by name
 */
export async function fetchAllExercises(): Promise<{
  data: Record<string, unknown>[] | null;
  error: { message?: string } | null;
}> {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
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
  const supabase = createUntypedClient();

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { data: null, error: { message: 'Authentication error', code: 'AUTH_ERROR' } };
  }

  // Refresh session
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { data: null, error: { message: 'No active session', code: 'NO_SESSION' } };
  }

  const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
  if (refreshedSession) {
    session = refreshedSession;
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
  const supabase = createUntypedClient();
  const { error } = await supabase
    .from('exercises')
    .delete()
    .eq('id', exerciseId)
    .eq('created_by', userId)
    .eq('is_custom', true);

  return { error };
}
