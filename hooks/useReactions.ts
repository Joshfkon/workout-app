'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ReactionType } from '@/types/social';

interface ReactionRow {
  id: string;
  reaction_type: ReactionType;
}

export function useReactions() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addReaction = useCallback(async (activityId: string, reactionType: ReactionType) => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Must be logged in to react');
      }

      // Check if already reacted
      const { data: existing } = (await supabase
        .from('activity_reactions' as never)
        .select('id')
        .eq('activity_id', activityId)
        .eq('user_id', user.id)
        .single()) as { data: { id: string } | null };

      if (existing) {
        // Update existing reaction
        const { error: updateError } = await (supabase
          .from('activity_reactions' as never) as ReturnType<typeof supabase.from>)
          .update({ reaction_type: reactionType } as never)
          .eq('id', existing.id);

        if (updateError) throw updateError;
      } else {
        // Insert new reaction
        const { error: insertError } = await (supabase
          .from('activity_reactions' as never) as ReturnType<typeof supabase.from>)
          .insert({
            activity_id: activityId,
            user_id: user.id,
            reaction_type: reactionType,
          } as never);

        if (insertError) throw insertError;
      }

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add reaction';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const removeReaction = useCallback(async (activityId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Must be logged in');
      }

      const { error: deleteError } = await (supabase
        .from('activity_reactions' as never) as ReturnType<typeof supabase.from>)
        .delete()
        .eq('activity_id', activityId)
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove reaction';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getReactions = useCallback(async (activityId: string) => {
    try {
      const supabase = createClient();

      const { data, error: fetchError } = (await supabase
        .from('activity_reactions' as never)
        .select('id, reaction_type, user_id')
        .eq('activity_id', activityId)) as { data: ReactionRow[] | null; error: Error | null };

      if (fetchError) throw fetchError;

      return { data: data || [], error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get reactions';
      return { data: [], error: message };
    }
  }, []);

  return {
    addReaction,
    removeReaction,
    getReactions,
    isLoading,
    error,
  };
}
