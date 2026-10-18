/**
 * Server-side gate for third-party AI data sharing (xAI, Anthropic).
 *
 * App Store Review Guideline 5.1.2(i) requires the app to say which data goes
 * to which AI provider and to get explicit permission first. The choice lives
 * on the users row (ai_data_sharing_consent: NULL = not asked, TRUE, FALSE).
 *
 * Every AI server action in lib/actions calls hasAiDataSharingConsent() after
 * authenticating and refuses to call a provider unless it returns true. The
 * prompt (components/ai/AiConsentPrompt.tsx) and the Settings toggle
 * (components/settings/AiDataSharingCard.tsx) only record the choice, via
 * lib/actions/ai-consent.ts.
 *
 * Deliberately NOT a 'use server' module: the check takes a userId, so it must
 * never be callable from the browser.
 */

import { createUntypedServerClient } from '@/lib/supabase/server';

/** Shown by AI features when the user has not allowed AI data sharing. */
export const AI_CONSENT_REQUIRED_MESSAGE =
  'AI features are off. Turn on "AI Features" in Settings → Profile to use this.';

/** True only when this user has explicitly allowed AI data sharing. */
export async function hasAiDataSharingConsent(userId: string): Promise<boolean> {
  const supabase = await createUntypedServerClient();
  const { data, error } = await supabase
    .from('users')
    .select('ai_data_sharing_consent')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('[AI consent] Failed to read consent:', error);
    return false;
  }
  return data?.ai_data_sharing_consent === true;
}
