'use server';

/**
 * Server action: parse a free-text meal description into structured food items
 * (Phase 4 "Describe" quick action). Uses Claude with a strict JSON schema so
 * the response is guaranteed parseable — no regex extraction, no retries on
 * malformed output.
 *
 * Server-only: uses ANTHROPIC_API_KEY and the server Supabase client (never
 * the browser client — see project memory on server actions).
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';

export interface ParsedMealItem {
  /** Food name, title case, e.g. "Greek yogurt" */
  name: string;
  /** Human-readable quantity, e.g. "1 cup", "6 oz", "2 slices" */
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type ParseMealResult =
  | { ok: true; items: ParsedMealItem[] }
  | { ok: false; error: string };

const MAX_DESCRIPTION_LENGTH = 600;
const MAX_ITEMS = 30;

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Food name in title case' },
          quantity: {
            type: 'string',
            description: 'Human-readable portion, e.g. "1 cup", "6 oz", "2 slices"',
          },
          calories: { type: 'number', description: 'Estimated kcal for this portion' },
          protein: { type: 'number', description: 'Grams of protein' },
          carbs: { type: 'number', description: 'Grams of carbohydrate' },
          fat: { type: 'number', description: 'Grams of fat' },
        },
        required: ['name', 'quantity', 'calories', 'protein', 'carbs', 'fat'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} satisfies Anthropic.Tool['input_schema'];

/** Clamp AI-estimated macros to sane, non-negative values. */
function sanitizeItem(item: ParsedMealItem): ParsedMealItem {
  const clamp = (v: number, max: number) =>
    Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), max) : 0;
  return {
    name: item.name.slice(0, 120),
    quantity: item.quantity.slice(0, 60),
    calories: clamp(item.calories, 5000),
    protein: clamp(item.protein, 500),
    carbs: clamp(item.carbs, 1000),
    fat: clamp(item.fat, 500),
  };
}

export async function parseMealDescription(description: string): Promise<ParseMealResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Sign in to use meal parsing' };
  }

  const text = description.trim();
  if (!text) {
    return { ok: false, error: 'Describe what you ate first' };
  }
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters` };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Meal parsing is not configured' };
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    // Forced tool use guarantees schema-shaped output on SDK 0.71.x (which
    // predates output_config structured outputs — see task to upgrade).
    const response = await anthropic.messages.create({
      // Extraction task on a fast/cheap tier per the refactor plan; swap to a
      // larger model only if estimate quality proves insufficient.
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      system:
        'You are a nutrition estimator. Parse the meal description into distinct food items with realistic portion sizes and macro estimates typical of USDA data. When the user gives a quantity, respect it; otherwise assume a typical single serving. Round macros to whole numbers.',
      messages: [{ role: 'user', content: text }],
      tools: [
        {
          name: 'record_meal_items',
          description: 'Record the parsed food items from the meal description',
          input_schema: MEAL_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'record_meal_items' },
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: "Couldn't parse that description — try rewording it" };
    }
    if (response.stop_reason === 'max_tokens') {
      return { ok: false, error: 'Description too complex — try splitting it into two entries' };
    }

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolBlock) {
      return { ok: false, error: "Couldn't parse that description — try again" };
    }

    const parsed = toolBlock.input as { items?: ParsedMealItem[] };
    const items = (parsed.items ?? []).slice(0, MAX_ITEMS).map(sanitizeItem).filter((i) => i.name);
    if (items.length === 0) {
      return { ok: false, error: "Couldn't find any foods in that description" };
    }
    return { ok: true, items };
  } catch (err) {
    console.error('parseMealDescription failed:', err);
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Too many requests — try again in a minute' };
    }
    return { ok: false, error: "Couldn't parse that description — try again" };
  }
}
