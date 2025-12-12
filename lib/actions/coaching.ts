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
  const supabase = await createClient();

  // Get authenticated user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  // Build coaching context
  const context = await buildCoachingContext();
  if (!context) {
    throw new Error('Unable to build coaching context');
  }

  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
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
    context,
  };
  messages.push(userMessage);

  // Format context for AI
  const contextString = formatCoachingContext(context);

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
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: apiMessages,
  });

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
    await supabase
      .from('ai_coaching_conversations')
      .update({
        messages,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  } else {
    // Create new conversation with a generated title
    const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
    const { data, error } = await supabase
      .from('ai_coaching_conversations')
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

    conversation = data;
    conversationId = data.id;
  }

  return {
    conversationId: conversationId!,
    message: assistantContent,
    timestamp: assistantMessage.timestamp,
  };
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
