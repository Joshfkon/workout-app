'use server';

/**
 * Server action: AI fallback for the nutrition-label scanner. When on-device
 * OCR + the deterministic parser can't produce a confident read, the captured
 * photo is sent to Claude vision for strict-JSON extraction of the same field
 * set, and the result is validated with the same Atwater identity as the OCR
 * path (`evaluateAtwater`).
 *
 * User-triggered only (one tap) — never called automatically, so network,
 * latency, and cost stay a user choice.
 *
 * Server-only: uses ANTHROPIC_API_KEY and the server Supabase client.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import {
  evaluateAtwater,
  atwaterWarningMessage,
  type AtwaterCheck,
  type ParsedNutritionFields,
  type ConfidenceLevel,
} from '@/lib/nutrition/labelParser';

export interface LabelAiScanSuccess {
  ok: true;
  fields: ParsedNutritionFields;
  confidence: ConfidenceLevel;
  warnings: string[];
  atwater: AtwaterCheck;
  hasCoreFields: boolean;
}

export type LabelAiScanResult = LabelAiScanSuccess | { ok: false; error: string };

/** ~1.1MB of base64 ≈ 800KB image — the client resizes captures well below this. */
const MAX_IMAGE_BASE64_LENGTH = 1_500_000;

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const NUMBER_OR_NULL = { type: ['number', 'null'] } as const;

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    readable: {
      type: 'boolean',
      description: 'False if the image does not contain a readable nutrition facts panel',
    },
    calories: { ...NUMBER_OR_NULL, description: 'Calories per serving' },
    totalFatG: { ...NUMBER_OR_NULL, description: 'Total fat in grams' },
    saturatedFatG: { ...NUMBER_OR_NULL, description: 'Saturated fat in grams' },
    transFatG: { ...NUMBER_OR_NULL, description: 'Trans fat in grams' },
    cholesterolMg: { ...NUMBER_OR_NULL, description: 'Cholesterol in milligrams' },
    sodiumMg: { ...NUMBER_OR_NULL, description: 'Sodium in milligrams' },
    totalCarbsG: { ...NUMBER_OR_NULL, description: 'Total carbohydrate in grams' },
    fiberG: { ...NUMBER_OR_NULL, description: 'Dietary fiber in grams' },
    totalSugarsG: { ...NUMBER_OR_NULL, description: 'Total sugars in grams' },
    addedSugarsG: { ...NUMBER_OR_NULL, description: 'Added sugars in grams' },
    proteinG: { ...NUMBER_OR_NULL, description: 'Protein in grams' },
    servingSizeText: {
      type: ['string', 'null'],
      description: 'Serving size exactly as printed, e.g. "1 Tray (340g)"',
    },
    servingGramWeight: {
      ...NUMBER_OR_NULL,
      description: 'Gram weight of one serving when printed, e.g. 340',
    },
    servingsPerContainer: NUMBER_OR_NULL,
  },
  required: ['readable'],
  additionalProperties: false,
} satisfies Anthropic.Tool['input_schema'];

/** Clamp one numeric field to a sane non-negative value (or null). */
function num(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return null;
  return Math.round(value * 10) / 10;
}

export async function scanLabelWithAi(
  imageBase64: string,
  mediaType: string
): Promise<LabelAiScanResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Sign in to use the AI label scan' };
  }

  if (!ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)) {
    return { ok: false, error: 'Unsupported image format' };
  }
  if (!imageBase64 || imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    return { ok: false, error: 'Image is too large — try retaking the photo' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'AI label scanning is not configured' };
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    // Forced tool use guarantees schema-shaped output; temperature 0 because
    // this is pure transcription, not estimation.
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      temperature: 0,
      system:
        'You transcribe nutrition facts panels. Read ONLY what is printed on the label in the image — never estimate or infer values that are not visible. Use null for any field that is not printed or not legible. Ignore % Daily Value numbers. Values are per serving.',
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
              text: 'Transcribe this nutrition facts label.',
            },
          ],
        },
      ],
      tools: [
        {
          name: 'record_nutrition_label',
          description: 'Record the fields printed on the nutrition facts label',
          input_schema: LABEL_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'record_nutrition_label' },
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: "Couldn't read that image — try again or enter values manually" };
    }

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolBlock) {
      return { ok: false, error: "Couldn't read the label — try again or enter values manually" };
    }

    const raw = toolBlock.input as Record<string, unknown>;
    if (raw.readable === false) {
      return {
        ok: false,
        error: "That doesn't look like a readable nutrition label — retake the photo or enter values manually",
      };
    }

    // Defensive parse: every field re-validated, never trusted as-is.
    const fields: ParsedNutritionFields = {
      calories: num(raw.calories, 1500),
      totalFatG: num(raw.totalFatG, 150),
      saturatedFatG: num(raw.saturatedFatG, 100),
      transFatG: num(raw.transFatG, 20),
      cholesterolMg: num(raw.cholesterolMg, 1500),
      sodiumMg: num(raw.sodiumMg, 8000),
      totalCarbsG: num(raw.totalCarbsG, 300),
      fiberG: num(raw.fiberG, 100),
      totalSugarsG: num(raw.totalSugarsG, 250),
      addedSugarsG: num(raw.addedSugarsG, 250),
      proteinG: num(raw.proteinG, 150),
      servingSizeText:
        typeof raw.servingSizeText === 'string' && raw.servingSizeText.trim()
          ? raw.servingSizeText.trim().slice(0, 60)
          : null,
      servingGramWeight: num(raw.servingGramWeight, 2000),
      servingsPerContainer: num(raw.servingsPerContainer, 100),
    };

    // The exact same Atwater rule as the OCR path.
    const atwater = evaluateAtwater(fields);
    const warnings: string[] = [];
    const atwaterWarning = atwaterWarningMessage(atwater);
    if (atwaterWarning) warnings.push(atwaterWarning);

    const hasCoreFields =
      fields.calories !== null &&
      fields.proteinG !== null &&
      fields.totalCarbsG !== null &&
      fields.totalFatG !== null;
    if (!hasCoreFields) {
      warnings.push("Couldn't read all of calories, protein, carbs, and fat from the label.");
    }

    const confidence: ConfidenceLevel =
      hasCoreFields && atwater.withinTolerance !== false ? 'high' : 'low';

    return { ok: true, fields, confidence, warnings, atwater, hasCoreFields };
  } catch (err) {
    console.error('scanLabelWithAi failed:', err);
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Too many requests — try again in a minute' };
    }
    return { ok: false, error: "Couldn't read the label — try again or enter values manually" };
  }
}
