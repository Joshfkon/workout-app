'use server';

/**
 * AI review of a draft workout plan (xAI Grok, same client setup as the
 * coach). Optional and non-blocking by design: the caller never waits on it
 * to start a workout, and any failure — no key, timeout, bad JSON — comes back
 * as `{ ok: false }` for the client to swallow (log, show nothing).
 *
 * The response is validated here against the exact payload sent, and the
 * client validates again before display.
 */

import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import {
  REVIEW_RESPONSE_SCHEMA_HINT,
  REVIEW_SYSTEM_PROMPT,
  REVIEW_TIMEOUT_MS,
  validateReviewResponse,
  type PlanReview,
  type ReviewPayload,
} from '@/services/workoutSetup/aiReview';

export type PlanReviewResult = { ok: true; review: PlanReview } | { ok: false; error: string };

const REVIEW_MODEL = 'grok-4.6';
/** Bounds on what a client may send (a plan is ~6–10 items). */
const MAX_PLAN_ITEMS = 20;
const MAX_PAYLOAD_CHARS = 24_000;

export async function reviewWorkoutPlan(payload: ReviewPayload): Promise<PlanReviewResult> {
  try {
    if (!payload || !Array.isArray(payload.plan) || payload.plan.length === 0) {
      return { ok: false, error: 'empty plan' };
    }
    const body = JSON.stringify(payload);
    if (payload.plan.length > MAX_PLAN_ITEMS || body.length > MAX_PAYLOAD_CHARS) {
      return { ok: false, error: 'plan too large to review' };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'not signed in' };

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: 'review not configured' };

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
      timeout: REVIEW_TIMEOUT_MS,
      maxRetries: 0,
    });
    const response = await client.chat.completions.create({
      model: REVIEW_MODEL,
      max_tokens: 900,
      temperature: 0.2,
      messages: [
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: `${body}\n\n${REVIEW_RESPONSE_SCHEMA_HINT}` },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '';
    const result = validateReviewResponse(raw, payload);
    if (!result.ok) {
      console.error('[Plan review] invalid model response:', result.error, raw.slice(0, 500));
      return { ok: false, error: result.error };
    }
    if (result.dropped.length > 0) {
      console.warn('[Plan review] dropped suggestions:', result.dropped.map((d) => d.why));
    }
    return { ok: true, review: result.review };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Plan review] failed:', message);
    return { ok: false, error: message };
  }
}
