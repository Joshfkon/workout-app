'use server';

/**
 * AI Coaching Server Actions
 *
 * Handles communication with Anthropic's Claude API to provide
 * personalized training advice based on user's actual data.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { buildCoachingContext, formatCoachingContext } from '@/services/coachingContextService';
import type { CoachingMessage, CoachingResponse } from '@/types/coaching';

// System prompt for AI coaching
const SYSTEM_PROMPT = `You are an AI strength and physique coach embedded in a training app. You have access to this user's actual data — use it. Never give generic advice when their specific numbers tell a clearer story.

## Core Principles

TRAINING:
- Progressive overload is the driver of adaptation. If lifts are stagnating for 3+ weeks with good adherence, something needs to change (volume, intensity, exercise selection, or recovery).
- RPE 7-9 is the productive training zone for most working sets. Consistent RPE 10 indicates load is too high or fatigue is accumulating.
- More volume is not always better. Look for minimum effective dose, especially in a deficit.
- Deload when planned or when performance degrades across multiple sessions.

BODY COMPOSITION:
- Weight fluctuates. Trends over 2+ weeks matter, daily swings don't.
- Rate of loss in a cut: 0.5-1% bodyweight/week is sustainable. Faster usually means muscle loss.
- Rate of gain in a bulk: 0.25-0.5% bodyweight/week for intermediates. Faster is mostly fat.
- If no DEXA data available, use lift performance as a proxy for muscle retention.

PHASE MANAGEMENT:
- Cuts should not exceed 12-16 weeks without a diet break (1-2 weeks at maintenance).
- If the user is deep into a cut and asking about adding more deficit or cardio, check if a diet break would be smarter.
- Bulks should end when body fat gets uncomfortable or when the user has gained 10-15% of their starting weight.

ANSWERING QUESTIONS:
- Reference their actual data. "Your squat has gone from X to Y over Z weeks" not "typically people..."
- Be direct. No cheerleading, no filler phrases like "great question!"
- If data is missing and it matters, say so. "I don't have your nutrition logs yet, so I'm assuming..."
- If something is outside your expertise (injury diagnosis, medical issues), say so and recommend a professional.
- When recommending changes, explain the reasoning briefly so they learn.

THINGS YOU SHOULD NEVER DO:
- Recommend crash diets or deficits below 1200 calories for women / 1500 for men
- Suggest "just push through" when data shows accumulated fatigue
- Give vague advice like "eat clean and train hard"
- Ignore their data to give textbook answers`;

/**
 * Sends a message to the AI coach and returns the response
 *
 * @param message - User's question or message
 * @param conversationId - Optional ID of existing conversation to continue
 * @returns AI coach's response with conversation ID
 */
export async function sendCoachingMessage(
  message: string,
  conversationId?: string
): Promise<CoachingResponse> {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('[AI Coach] No authenticated user');
      throw new Error('Unauthorized');
    }

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[AI Coach] ANTHROPIC_API_KEY is not set');
      throw new Error('AI coaching is not configured. Please contact support.');
    }
    
    // Debug: Log key info (first 20 chars only for security)
    console.log('[AI Coach] API key starts with:', apiKey.substring(0, 20) + '...');
    console.log('[AI Coach] API key length:', apiKey.length);

    // Build coaching context
    let context;
    try {
      context = await buildCoachingContext();
    } catch (contextError) {
      console.error('[AI Coach] Failed to build context:', contextError);
      // Continue without context rather than failing completely
      context = null;
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: apiKey,
    });

  // Load or create conversation
  let conversation: any;
  let messages: CoachingMessage[] = [];

  if (conversationId) {
    const { data, error } = await supabase
      .from('ai_coaching_conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (error || !data) {
      throw new Error('Conversation not found');
    }

    conversation = data as any;
    const conversationData = data as any;
    messages = (conversationData.messages as CoachingMessage[]) || [];
  }

  // Add user message
  const userMessage: CoachingMessage = {
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
    context: context || undefined,
  };
  messages.push(userMessage);

  // Format context for AI (if available)
  const contextString = context ? formatCoachingContext(context) : 'No user context available yet.';

  // Build message history for Anthropic API
  const apiMessages: { role: 'user' | 'assistant'; content: string }[] = [];

  // Add conversation history (without duplicating context for each message)
  for (const msg of messages) {
    if (msg.role === 'user') {
      // For user messages, only include the actual message content
      apiMessages.push({
        role: 'user',
        content: msg.content,
      });
    } else {
      apiMessages.push({
        role: 'assistant',
        content: msg.content,
      });
    }
  }

  // Replace the last user message with one that includes context
  if (apiMessages.length > 0 && apiMessages[apiMessages.length - 1].role === 'user') {
    apiMessages[apiMessages.length - 1].content = `${contextString}\n\n${message}`;
  }

  // Call Anthropic API
  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
    });
  } catch (apiError: any) {
    console.error('[AI Coach] Anthropic API error:', apiError?.message || apiError);
    throw new Error(`AI service error: ${apiError?.message || 'Unknown error'}`);
  }

  // Extract assistant's response
  const assistantContent = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as any).text)
    .join('\n');

  // Add assistant message
  const assistantMessage: CoachingMessage = {
    role: 'assistant',
    content: assistantContent,
    timestamp: new Date().toISOString(),
  };
  messages.push(assistantMessage);

  // Save or update conversation
  if (conversation) {
    await (supabase
      .from('ai_coaching_conversations') as any)
      .update({
        messages,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId as string);
  } else {
    // Create new conversation with a generated title
    const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
    const { data, error } = await (supabase
      .from('ai_coaching_conversations') as any)
      .insert({
        user_id: user.id,
        title,
        messages,
        started_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error('Failed to save conversation');
    }

    conversation = data as any;
    conversationId = (data as any).id;
  }

  return {
    conversationId: conversationId!,
    message: assistantContent,
    timestamp: assistantMessage.timestamp,
  };
  } catch (error: any) {
    console.error('[AI Coach] Error in sendCoachingMessage:', error?.message || error);
    throw error;
  }
}

/**
 * Gets all coaching conversations for the current user
 */
export async function getCoachingConversations() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('ai_coaching_conversations')
    .select('*')
    .eq('user_id', user.id)
    .order('last_message_at', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch conversations');
  }

  return data;
}

/**
 * Gets a specific coaching conversation by ID
 */
export async function getCoachingConversation(conversationId: string) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('ai_coaching_conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single();

  if (error) {
    throw new Error('Conversation not found');
  }

  return data;
}

/**
 * Deletes a coaching conversation
 */
export async function deleteCoachingConversation(conversationId: string) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { error } = await supabase
    .from('ai_coaching_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', user.id);

  if (error) {
    throw new Error('Failed to delete conversation');
  }
}

/**
 * Gets the coaching context for the current user
 */
export async function getCoachingContext() {
  const context = await buildCoachingContext();
  return context;
}

// ============================================================
// WORKOUT-SPECIFIC AI COACHING
// ============================================================

// System prompt specifically for pre-workout coaching notes
const WORKOUT_COACH_PROMPT = `You are a knowledgeable strength coach giving brief, personalized pre-workout notes. You have access to the user's actual training data.

IMPORTANT STYLE GUIDELINES:
- Be concise. This appears at the START of a workout—don't write an essay.
- Total response should be 3-5 sentences max.
- Sound like a real coach: direct, supportive, specific to TODAY.
- Reference their actual data when relevant (specific weights, recent progress, body comp).
- Don't list every exercise—just give the key focus for the session.
- End with one actionable tip or focus point for today.

WHAT TO INCLUDE (pick the most relevant 1-2):
- If it's early in a mesocycle: mention finding weights, focus on form
- If late in mesocycle: mention pushing intensity, approaching peak
- If they have lagging areas being trained today: brief mention
- If cutting: reinforce intensity over volume, maintain strength
- If bulking: focus on progressive overload
- If specific lifts have plateaued: one technique tip
- Reference recent PRs or improvements if relevant

WHAT TO AVOID:
- Generic motivation ("Let's crush it!")
- Listing all exercises in the workout
- Long explanations of training principles
- Anything that sounds like ChatGPT`;

export interface WorkoutCoachNotesInput {
  exercises: Array<{
    name: string;
    primaryMuscle: string;
    mechanic: 'compound' | 'isolation';
    sets: number;
    targetReps?: string;
  }>;
  workoutType?: string; // e.g., "Push", "Pull", "Legs", "Upper", "Lower", "Full Body"
  weekInMesocycle?: number;
  mesocycleName?: string;
  totalWeeks?: number;
}

export interface WorkoutCoachNotesResult {
  notes: string;
  generated: boolean;
  error?: string;
}

/**
 * Generates AI-powered coach notes for a specific workout
 * 
 * @param input - Workout details including exercises and context
 * @returns AI-generated personalized coaching notes
 */
export async function generateWorkoutCoachNotes(
  input: WorkoutCoachNotesInput
): Promise<WorkoutCoachNotesResult> {
  try {
    // Check for API key first
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[Workout Coach] No API key, returning fallback');
      return {
        notes: generateFallbackNotes(input),
        generated: false,
      };
    }

    // Build coaching context
    let context;
    try {
      context = await buildCoachingContext();
    } catch (contextError) {
      console.error('[Workout Coach] Failed to build context:', contextError);
      context = null;
    }

    // Format workout details for the prompt
    const workoutDescription = formatWorkoutForAI(input);
    const contextString = context ? formatCoachingContext(context) : 'No detailed user context available.';

    // Build the prompt
    const prompt = `${contextString}

TODAY'S WORKOUT:
${workoutDescription}

Please provide brief, personalized pre-workout coaching notes for this session. Remember: 3-5 sentences max.`;

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: apiKey,
    });

    // Call API with a quick model for fast responses
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 500,
      system: WORKOUT_COACH_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract response
    const notes = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('\n')
      .trim();

    return {
      notes: notes || generateFallbackNotes(input),
      generated: true,
    };
  } catch (error: any) {
    console.error('[Workout Coach] Error generating notes:', error?.message || error);
    return {
      notes: generateFallbackNotes(input),
      generated: false,
      error: error?.message,
    };
  }
}

/**
 * Formats workout input for AI consumption
 */
function formatWorkoutForAI(input: WorkoutCoachNotesInput): string {
  const lines: string[] = [];

  if (input.workoutType) {
    lines.push(`Type: ${input.workoutType}`);
  }

  if (input.weekInMesocycle && input.totalWeeks) {
    lines.push(`Week ${input.weekInMesocycle} of ${input.totalWeeks} (${input.mesocycleName || 'current mesocycle'})`);
  }

  // List exercises briefly
  const exerciseList = input.exercises
    .map(e => `- ${e.name} (${e.primaryMuscle}, ${e.mechanic}): ${e.sets} sets${e.targetReps ? ` of ${e.targetReps}` : ''}`)
    .join('\n');
  
  lines.push(`\nExercises (${input.exercises.length} total):\n${exerciseList}`);

  // Summarize workout structure
  const compoundCount = input.exercises.filter(e => e.mechanic === 'compound').length;
  const isolationCount = input.exercises.filter(e => e.mechanic === 'isolation').length;
  const totalSets = input.exercises.reduce((sum, e) => sum + e.sets, 0);
  const muscles = Array.from(new Set(input.exercises.map(e => e.primaryMuscle)));

  lines.push(`\nSummary: ${totalSets} total sets, ${compoundCount} compound / ${isolationCount} isolation`);
  lines.push(`Target muscles: ${muscles.join(', ')}`);

  return lines.join('\n');
}

/**
 * Generates fallback notes when AI is unavailable
 */
function generateFallbackNotes(input: WorkoutCoachNotesInput): string {
  const totalSets = input.exercises.reduce((sum, e) => sum + e.sets, 0);
  const compoundCount = input.exercises.filter(e => e.mechanic === 'compound').length;
  const muscles = Array.from(new Set(input.exercises.map(e => e.primaryMuscle)));
  
  // Determine workout type
  const workoutType = input.workoutType || 
    (muscles.length >= 5 ? 'Full Body' : 
     muscles.includes('chest') && muscles.includes('shoulders') ? 'Push' :
     muscles.includes('back') && muscles.includes('biceps') ? 'Pull' :
     muscles.includes('quads') && muscles.includes('hamstrings') ? 'Legs' :
     muscles.join(' & '));

  // Time-based greeting
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Week-specific advice
  let weekAdvice = '';
  if (input.weekInMesocycle) {
    if (input.weekInMesocycle === 1) {
      weekAdvice = ' Focus on dialing in your working weights and nailing form this week.';
    } else if (input.weekInMesocycle >= 4 && input.totalWeeks && input.weekInMesocycle >= input.totalWeeks - 1) {
      weekAdvice = ' You\'re in the final push—bring the intensity and push close to failure on your top sets.';
    }
  }

  return `${timeGreeting}! Today's ${workoutType} session has ${totalSets} sets across ${input.exercises.length} exercises.${weekAdvice} ${compoundCount > 0 ? 'Start with your compounds while you\'re fresh.' : 'Focus on mind-muscle connection throughout.'}`;
}
