'use client';

import { useSubscription } from '@/hooks/useSubscription';
import type { Feature } from '@/lib/subscription';

/**
 * True when the user's plan doesn't include `feature`, so a screen can show
 * an upgrade prompt instead of an AI button that the server would refuse
 * (lib/ai/access). False while the subscription is still loading, so paying
 * users never see a locked state flash.
 */
export function useAiFeatureLocked(feature: Feature = 'aiFeatures'): boolean {
  const { isLoading, canAccess } = useSubscription();
  return !isLoading && !canAccess(feature);
}
