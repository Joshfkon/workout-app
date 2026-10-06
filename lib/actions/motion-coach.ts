'use server';

/**
 * Optional LLM phrasing of motion coach feedback (off unless
 * NEXT_PUBLIC_MOTION_COACH_LLM === 'true'). Sends only the structured
 * findings payload; the reply is validated (lib/motion/coachPhrasing) and
 * any failure returns { ok: false } so the client keeps the template.
 */

import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import {
  COACH_PHRASING_SYSTEM_PROMPT,
  validateCoachPhrasing,
  type CoachPhrasedText,
  type CoachPhrasingPayload,
} from '@/lib/motion/coachPhrasing';

const COACH_MODEL = 'grok-4.6';
const COACH_TIMEOUT_MS = 2_800;
const MAX_PAYLOAD_CHARS = 4_000;

export async function phraseCoachFeedback(
  payload: CoachPhrasingPayload
): Promise<{ ok: true; text: CoachPhrasedText } | { ok: false }> {
  try {
    if (process.env.NEXT_PUBLIC_MOTION_COACH_LLM !== 'true') return { ok: false };
    const body = JSON.stringify(payload);
    if (body.length > MAX_PAYLOAD_CHARS) return { ok: false };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false };

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
      timeout: COACH_TIMEOUT_MS,
      maxRetries: 0,
    });
    const response = await client.chat.completions.create({
      model: COACH_MODEL,
      max_tokens: 300,
      temperature: 0.2,
      messages: [
        { role: 'system', content: COACH_PHRASING_SYSTEM_PROMPT },
        { role: 'user', content: body },
      ],
    });
    const text = validateCoachPhrasing(response.choices[0]?.message?.content ?? '', payload);
    return text ? { ok: true, text } : { ok: false };
  } catch {
    return { ok: false };
  }
}
