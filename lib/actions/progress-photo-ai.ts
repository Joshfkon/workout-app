'use server';

/**
 * Server action: AI body fat estimate for a progress photo. The client sends
 * a downscaled copy of the photo; Claude vision returns a body fat RANGE,
 * anchored to the user's DEXA history when one exists so the estimate is
 * calibrated to this specific body rather than a generic eyeball.
 *
 * User-triggered only (one tap) — never called automatically. The estimate
 * is display/trend-only and must never feed prescription, e1RM, or volume
 * engines (same policy as motion capture).
 *
 * Server-only: uses ANTHROPIC_API_KEY and the server Supabase client.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createUntypedServerClient } from '@/lib/supabase/server';

export interface BfEstimateSuccess {
  ok: true;
  /** Body fat range, e.g. 14–17 (%) */
  low: number;
  high: number;
  /** One-sentence, user-facing rationale */
  rationale: string;
  /** True when the estimate was anchored to a DEXA scan */
  dexaCalibrated: boolean;
  estimatedAt: string;
}

export type BfEstimateResult = BfEstimateSuccess | { ok: false; error: string };

/** ~1.1MB of base64 ≈ 800KB image — the client downscales well below this. */
const MAX_IMAGE_BASE64_LENGTH = 1_500_000;

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    assessable: {
      type: 'boolean',
      description:
        'False if the image is not a physique photo where body composition can reasonably be assessed (clothed torso, poor lighting, not a person, etc.)',
    },
    bodyFatLow: {
      type: ['number', 'null'],
      description: 'Lower bound of the estimated body fat percentage range',
    },
    bodyFatHigh: {
      type: ['number', 'null'],
      description: 'Upper bound of the estimated body fat percentage range',
    },
    rationale: {
      type: ['string', 'null'],
      description:
        'One sentence naming the visual cues used (e.g. ab visibility, vascularity, lower-back fullness). No preamble.',
    },
  },
  required: ['assessable'],
  additionalProperties: false,
} satisfies Anthropic.Tool['input_schema'];

function clampPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 3 || value > 60) return null;
  return Math.round(value * 10) / 10;
}

interface DexaAnchor {
  scan_date: string;
  body_fat_percent: number;
  weight_kg: number;
}

function buildContextLines(
  profile: { sex: string | null; height_cm: number | null } | null,
  photo: { photo_date: string; weight_kg: number | null },
  dexaScans: DexaAnchor[]
): string[] {
  const lines: string[] = [];
  if (profile?.sex) lines.push(`Sex: ${profile.sex}`);
  if (profile?.height_cm) lines.push(`Height: ${profile.height_cm} cm`);
  if (photo.weight_kg) lines.push(`Weight at photo: ${photo.weight_kg} kg`);
  lines.push(`Photo date: ${photo.photo_date}`);
  if (dexaScans.length > 0) {
    lines.push('DEXA scan history for this person (measured, use as calibration anchors):');
    for (const scan of dexaScans) {
      lines.push(`  ${scan.scan_date}: ${scan.body_fat_percent}% body fat at ${scan.weight_kg} kg`);
    }
  }
  return lines;
}

/** Defensive parse of the tool output; null when unusable. */
function parseEstimateRange(raw: Record<string, unknown>): { low: number; high: number } | null {
  let low = clampPercent(raw.bodyFatLow);
  let high = clampPercent(raw.bodyFatHigh);
  if (low === null || high === null) return null;
  if (low > high) [low, high] = [high, low];
  return { low, high };
}

export async function estimateBodyFatFromPhoto(
  photoId: string,
  imageBase64: string,
  mediaType: string
): Promise<BfEstimateResult> {
  const supabase = await createUntypedServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Sign in to use body fat estimation' };
  }

  if (!ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)) {
    return { ok: false, error: 'Unsupported image format' };
  }
  if (!imageBase64 || imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    return { ok: false, error: 'Image is too large — try again' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'AI body fat estimation is not configured' };
  }

  // RLS scopes both queries to this user; the photo lookup also verifies
  // ownership of the row we will write the estimate back to.
  const { data: photo, error: photoError } = await supabase
    .from('progress_photos')
    .select('id, photo_date, weight_kg')
    .eq('id', photoId)
    .eq('user_id', user.id)
    .single();
  if (photoError || !photo) {
    return { ok: false, error: 'Photo not found' };
  }

  const [{ data: profile }, { data: dexaScans }] = await Promise.all([
    supabase.from('users').select('sex, height_cm').eq('id', user.id).single(),
    supabase
      .from('dexa_scans')
      .select('scan_date, body_fat_percent, weight_kg')
      .eq('user_id', user.id)
      .order('scan_date', { ascending: false })
      .limit(3),
  ]);

  const anchors: DexaAnchor[] = dexaScans ?? [];
  const dexaCalibrated = anchors.length > 0;
  const contextLines = buildContextLines(profile, photo, anchors);

  try {
    const anthropic = new Anthropic({ apiKey });
    // Forced tool use guarantees schema-shaped output. Thinking is disabled
    // because forced tool_choice requires it; the task is a single visual
    // judgement, not multi-step reasoning.
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 500,
      thinking: { type: 'disabled' },
      system:
        'You estimate body fat percentage from physique photos for a fitness tracking app. ' +
        'Give a RANGE (typically 3-4 points wide), never a single number — photo-based estimation is imprecise. ' +
        'Use standard visual markers: ab definition, oblique/serratus visibility, vascularity, lower-back and glute fullness, face leanness. ' +
        'When DEXA history is provided, anchor your estimate to it: judge whether the person looks leaner or fuller than at their measured scans and adjust from those measured values. ' +
        'Lighting and pump can shift appearance by a couple of points — reflect that in the range width. ' +
        'You may say a brief sentence before using a tool.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as AllowedMediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `Estimate this person's body fat percentage range.\n\n${contextLines.join('\n')}`,
            },
          ],
        },
      ],
      tools: [
        {
          name: 'record_bf_estimate',
          description: 'Record the estimated body fat percentage range',
          input_schema: ESTIMATE_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'record_bf_estimate' },
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: "Couldn't assess this photo — try a clearer physique photo" };
    }

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolBlock) {
      return { ok: false, error: "Couldn't produce an estimate — try again" };
    }

    const raw = toolBlock.input as Record<string, unknown>;
    if (raw.assessable === false) {
      return {
        ok: false,
        error:
          "This photo isn't clear enough to assess — use a well-lit photo showing your torso",
      };
    }

    const range = parseEstimateRange(raw);
    if (!range) {
      return { ok: false, error: "Couldn't produce an estimate — try again" };
    }
    const { low, high } = range;

    const estimatedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('progress_photos')
      .update({
        bf_estimate_low: low,
        bf_estimate_high: high,
        bf_estimated_at: estimatedAt,
      })
      .eq('id', photoId)
      .eq('user_id', user.id);
    if (updateError) {
      console.error('Failed to store body fat estimate:', updateError);
      // The estimate is still useful this session even if persistence failed.
    }

    const rationale =
      typeof raw.rationale === 'string' && raw.rationale.trim()
        ? raw.rationale.trim().slice(0, 300)
        : '';

    return { ok: true, low, high, rationale, dexaCalibrated, estimatedAt };
  } catch (err) {
    console.error('estimateBodyFatFromPhoto failed:', err);
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Too many requests — try again in a minute' };
    }
    return { ok: false, error: "Couldn't produce an estimate — try again" };
  }
}
