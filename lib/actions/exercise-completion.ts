'use server';

/**
 * Server Action for AI Exercise Completion
 *
 * Handles the actual LLM API call to complete exercise metadata.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import type { BasicExerciseInput, CompletedExerciseData } from '@/lib/exercises/types';
import {
  renderPrompt,
  parseAIResponse,
  getDefaultsByEquipment,
  inheritFromBaseExercise,
  type AIResponse,
} from '@/lib/exercises/exercise-ai-completion';
import { getExerciseById, getExercises } from '@/services/exerciseService';

// ============================================
// USAGE TRACKING
// ============================================

interface UsageRecord {
  today: number;
  thisMonth: number;
}

async function getAIUsage(userId: string): Promise<UsageRecord> {
  const supabase = await createClient();

  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().split('T')[0];

  // Check for existing usage record
  const { data } = await (supabase
    .from('ai_exercise_completions') as any)
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', monthStartStr);

  const records = (data || []) as { created_at: string }[];
  const todayCount = records.filter(
    (r) => r.created_at.split('T')[0] === today
  ).length;

  return {
    today: todayCount,
    thisMonth: records.length,
  };
}

async function recordAIUsage(userId: string, exerciseName: string): Promise<void> {
  const supabase = await createClient();

  await (supabase.from('ai_exercise_completions') as any).insert({
    user_id: userId,
    exercise_name: exerciseName,
    created_at: new Date().toISOString(),
  });
}

// Default limits
const DAILY_LIMIT = 10;
const MONTHLY_LIMIT = 50;

// ============================================
// MAIN API
// ============================================

export interface CompleteExerciseResult {
  success: boolean;
  data?: CompletedExerciseData;
  error?: string;
  limitReached?: boolean;
}

/**
 * Complete exercise metadata using AI
 */
export async function completeExerciseWithAI(
  input: BasicExerciseInput
): Promise<CompleteExerciseResult> {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Check usage limits
    const usage = await getAIUsage(user.id);
    if (usage.today >= DAILY_LIMIT) {
      return {
        success: false,
        error: `Daily AI limit reached (${DAILY_LIMIT}/day). You can create exercises with manual entry or wait until tomorrow.`,
        limitReached: true,
      };
    }
    if (usage.thisMonth >= MONTHLY_LIMIT) {
      return {
        success: false,
        error: `Monthly AI limit reached (${MONTHLY_LIMIT}/month). Please use manual entry for additional exercises.`,
        limitReached: true,
      };
    }

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[Exercise AI] No API key, returning defaults');
      return {
        success: true,
        data: getDefaultsByEquipment(input),
      };
    }

    // If this is a variation, get the base exercise for inheritance
    let baseExerciseData: Partial<CompletedExerciseData> = {};
    if (input.variationOf) {
      const baseExercise = await getExerciseById(input.variationOf);
      if (baseExercise) {
        baseExerciseData = inheritFromBaseExercise(input, baseExercise);
        input.variationOfName = baseExercise.name;
      }
    }

    // Build the prompt
    const prompt = renderPrompt(input);

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: apiKey,
    });

    // Call API
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1500,
      system:
        'You are an exercise science expert. Respond only with valid JSON, no markdown or additional text.',
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract response text
    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('')
      .trim();

    // Parse JSON response
    let aiResponse: AIResponse;
    try {
      // Try to extract JSON if wrapped in markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText;
      aiResponse = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[Exercise AI] Failed to parse response:', responseText);
      return {
        success: true,
        data: getDefaultsByEquipment(input),
      };
    }

    // Parse and validate the response
    const completedData = parseAIResponse(aiResponse, input);

    // Merge with base exercise data for variations
    const finalData: CompletedExerciseData = {
      ...completedData,
      // For variations, prefer inherited values for certain fields if AI confidence is low
      ...(input.variationOf && completedData.aiConfidence === 'low'
        ? baseExerciseData
        : {}),
    };

    // Record usage
    await recordAIUsage(user.id, input.name);

    return {
      success: true,
      data: finalData,
    };
  } catch (error: any) {
    console.error('[Exercise AI] Error:', error?.message || error);

    // Return fallback on error
    return {
      success: true,
      data: getDefaultsByEquipment(input),
    };
  }
}

/**
 * Check if user can use AI completion
 */
export async function checkAIUsageAllowed(): Promise<{
  allowed: boolean;
  remaining: { today: number; thisMonth: number };
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { allowed: false, remaining: { today: 0, thisMonth: 0 } };
    }

    const usage = await getAIUsage(user.id);

    return {
      allowed: usage.today < DAILY_LIMIT && usage.thisMonth < MONTHLY_LIMIT,
      remaining: {
        today: Math.max(0, DAILY_LIMIT - usage.today),
        thisMonth: Math.max(0, MONTHLY_LIMIT - usage.thisMonth),
      },
    };
  } catch {
    return { allowed: false, remaining: { today: 0, thisMonth: 0 } };
  }
}

/**
 * Get incomplete custom exercises for a user
 */
export async function getIncompleteExercises(): Promise<
  { id: string; name: string; missingFields: string[] }[]
> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return [];
    }

    const { data: exercises } = await (supabase
      .from('exercises') as any)
      .select('*')
      .eq('created_by', user.id)
      .eq('is_custom', true);

    if (!exercises) return [];

    return (exercises as any[])
      .map((exercise: any) => {
        const missingFields: string[] = [];

        if (!exercise.stabilizers || exercise.stabilizers.length === 0) {
          missingFields.push('Stabilizer muscles');
        }
        if (!exercise.spinal_loading) {
          missingFields.push('Spinal loading');
        }
        if (!exercise.hypertrophy_tier) {
          missingFields.push('Hypertrophy score');
        }
        if (!exercise.position_stress) {
          missingFields.push('Position stress');
        }
        if (!exercise.contraindications) {
          missingFields.push('Contraindications');
        }

        if (missingFields.length === 0) return null;

        return {
          id: exercise.id as string,
          name: exercise.name as string,
          missingFields,
        };
      })
      .filter((e: any): e is { id: string; name: string; missingFields: string[] } => e !== null);
  } catch {
    return [];
  }
}

/**
 * Batch complete all exercises with AI
 * Returns progress updates via callback
 */
export async function batchCompleteAllExercises(
  onProgress?: (current: number, total: number, exerciseName: string) => void
): Promise<{
  success: boolean;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  error?: string;
}> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return {
        success: false,
        processed: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        error: 'Not authenticated',
      };
    }

    // Get all non-custom exercises
    const exercises = await getExercises(false);
    
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Process in small batches to avoid rate limits
    const BATCH_SIZE = 3;
    const DELAY_BETWEEN_EXERCISES = 1000; // 1 second

    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];
      processed++;

      try {
        onProgress?.(i + 1, exercises.length, exercise.name);

        // Check if already complete
        const hasFormCues = exercise.formCues && exercise.formCues.length > 0;
        const hasHypertrophyScore = exercise.hypertrophyScore?.tier;

        if (hasFormCues && hasHypertrophyScore) {
          skipped++;
          continue;
        }

        // Prepare AI input
        const input: BasicExerciseInput = {
          name: exercise.name,
          primaryMuscle: exercise.primaryMuscle,
          equipment: exercise.equipment || 'barbell',
          description: exercise.notes,
        };

        // Get AI completion
        const result = await completeExerciseWithAI(input);

        if (!result.success || !result.data) {
          errors++;
          continue;
        }

        const completed = result.data;
        const updateData: any = {};

        // Only update missing fields
        if (!hasFormCues && completed.formCues?.length) {
          updateData.form_cues = completed.formCues;
        }

        if (!hasHypertrophyScore && completed.hypertrophyScore) {
          updateData.hypertrophy_tier = completed.hypertrophyScore.tier;
          updateData.stretch_under_load = completed.hypertrophyScore.stretchUnderLoad;
          updateData.resistance_profile = completed.hypertrophyScore.resistanceProfile;
          updateData.progression_ease = completed.hypertrophyScore.progressionEase;
        }

        if (!exercise.secondaryMuscles?.length && completed.secondaryMuscles?.length) {
          updateData.secondary_muscles = completed.secondaryMuscles;
        }

        if (!exercise.stabilizers?.length && completed.stabilizers?.length) {
          updateData.stabilizers = completed.stabilizers;
        }

        if (!exercise.spinalLoading && completed.spinalLoading) {
          updateData.spinal_loading = completed.spinalLoading;
        }

        if (completed.contraindications?.length) {
          updateData.contraindications = completed.contraindications;
        }

        // Update if we have changes
        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await (supabase
            .from('exercises') as any)
            .update(updateData)
            .eq('id', exercise.id);

          if (updateError) {
            errors++;
          } else {
            updated++;
          }
        } else {
          skipped++;
        }

        // Delay to avoid rate limits
        if (i < exercises.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_EXERCISES));
        }

      } catch (err: any) {
        console.error(`Error processing ${exercise.name}:`, err);
        errors++;
      }
    }

    return {
      success: true,
      processed,
      updated,
      skipped,
      errors,
    };

  } catch (error: any) {
    return {
      success: false,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      error: error.message,
    };
  }
}