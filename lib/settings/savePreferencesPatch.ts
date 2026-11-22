/**
 * Merge a few keys into users.preferences (JSONB) without touching anything
 * else on the row. Used by Settings → Preferences, which saves each choice
 * the moment it changes instead of waiting for the whole-form Save.
 *
 * Reads the CURRENT stored preferences first so keys written elsewhere
 * (theme, training style, reminders, …) survive the whole-object write.
 * Throws on any read/write failure so the caller can revert and say so.
 */

import type { createUntypedClient } from '@/lib/supabase/client';

type Client = ReturnType<typeof createUntypedClient>;

export async function savePreferencesPatch(
  supabase: Client,
  userId: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data, error: readError } = await supabase
    .from('users')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message || 'Could not read your settings');
  if (!data) throw new Error('Could not find your settings');

  const merged = {
    ...((data.preferences as Record<string, unknown> | null) ?? {}),
    ...patch,
  };
  const { error: writeError } = await supabase
    .from('users')
    .update({ preferences: merged })
    .eq('id', userId);
  if (writeError) throw new Error(writeError.message || 'Could not save your settings');
  return merged;
}
