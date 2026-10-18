'use server';

/**
 * Read / record the signed-in user's choice about sending personal data to
 * third-party AI providers. The server-side gate the AI actions use is in
 * lib/ai/consent.ts.
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import { now } from '@/lib/clock';

/** null = never asked, true = allowed, false = declined. */
export type AiDataSharingConsent = boolean | null;

/** The signed-in user's current choice (null when signed out or never asked). */
export async function getAiDataSharingConsent(): Promise<AiDataSharingConsent> {
  const supabase = await createUntypedServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('users')
    .select('ai_data_sharing_consent')
    .eq('id', user.id)
    .single();
  const value = data?.ai_data_sharing_consent;
  return typeof value === 'boolean' ? value : null;
}

export async function setAiDataSharingConsent(
  allowed: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createUntypedServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase
    .from('users')
    .update({
      ai_data_sharing_consent: allowed,
      ai_data_sharing_consent_at: now().toISOString(),
    })
    .eq('id', user.id);
  if (error) {
    console.error('[AI consent] Failed to save consent:', error);
    return { ok: false, error: 'Failed to save. Please try again.' };
  }
  return { ok: true };
}
