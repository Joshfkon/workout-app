'use client';

/**
 * Optional LLM wording for the coach sheet. Returns null (→ template)
 * unless NEXT_PUBLIC_MOTION_COACH_LLM === 'true', and falls back to null on
 * any error or after MOTION_SET_CONFIG.llm.timeoutMs.
 */

import { useEffect, useState } from 'react';
import { MOTION_SET_CONFIG } from '@/services/shared/motion';
import type { CoachPhrasedText, CoachPhrasingPayload } from '@/lib/motion/coachPhrasing';
import { phraseCoachFeedback } from '@/lib/actions/motion-coach';

export const COACH_LLM_ENABLED = process.env.NEXT_PUBLIC_MOTION_COACH_LLM === 'true';

const cache = new Map<string, CoachPhrasedText | null>();

export function useCoachPhrasing(payload: CoachPhrasingPayload | null): CoachPhrasedText | null {
  const key = payload ? JSON.stringify(payload) : null;
  const [text, setText] = useState<CoachPhrasedText | null>(key ? cache.get(key) ?? null : null);

  useEffect(() => {
    if (!COACH_LLM_ENABLED || !payload || !key) return;
    if (cache.has(key)) {
      setText(cache.get(key) ?? null);
      return;
    }
    let live = true;
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), MOTION_SET_CONFIG.llm.timeoutMs)
    );
    Promise.race([phraseCoachFeedback(payload).then((r) => (r.ok ? r.text : null)), timeout])
      .catch(() => null)
      .then((result) => {
        cache.set(key, result);
        if (live) setText(result);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return text;
}
