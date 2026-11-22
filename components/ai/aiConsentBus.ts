'use client';

/**
 * Tiny in-memory channel so places that RECORD the AI data-sharing choice
 * (the Settings card) can tell the place that GATES on it (AiConsentProvider)
 * without a refetch. Session-only: the provider is mounted in the dashboard
 * shell, which unmounts on sign-out, so nothing here outlives a user.
 */

import type { AiDataSharingConsent } from '@/lib/actions/ai-consent';

type Listener = (consent: AiDataSharingConsent) => void;
const listeners = new Set<Listener>();

export function publishAiConsent(consent: AiDataSharingConsent): void {
  listeners.forEach((listener) => listener(consent));
}

export function subscribeAiConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
