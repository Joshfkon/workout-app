'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthUser } from '@/hooks/useAuthUser';
import type { ReactionType } from '@/types/social';

interface ReactionRow {
  id: string;
  reaction_type: ReactionType;
}

export function useReactions() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user: authUser } = useAuthUser();

  const addReaction = useCallback(async (activityId: string, reactionType: ReactionType) => {
    setIsLoading(true);
    setError(null);

    try {
      if (!authUser) {
        throw new Error('Must be logged in to react');
      }

      const supabase = createClient();

      // Check if already reacted
      const { data: existing } = await supabase
        .from('activity_reactions')
        .select('id')
        .eq('activity_id', activityId)
        .eq('user_id', authUser.id)
        .single();

      if (existing) {
        // Update existing reaction
        const { error: updateError } = await supabase
          .from('activity_reactions')
          .update({ reaction_type: reactionType })
          .eq('id', existing.id);

        if (updateError) throw updateError;
      } else {
        // Insert new reaction
        const { error: insertError } = await supabase
          .from('activity_reactions')
          .insert({
            activity_id: activityId,
            user_id: authUser.id,
            reaction_type: reactionType,
          });

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
  }, [authUser]);

  const removeReaction = useCallback(async (activityId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      if (!authUser) {
        throw new Error('Must be logged in');
      }

      const supabase = createClient();

      const { error: deleteError } = await supabase
        .from('activity_reactions')
        .delete()
        .eq('activity_id', activityId)
        .eq('user_id', authUser.id);

      if (deleteError) throw deleteError;

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove reaction';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, [authUser]);

  const getReactions = useCallback(async (activityId: string) => {
    try {
      const supabase = createClient();

      const { data, error: fetchError } = await supabase
        .from('activity_reactions')
        .select('id, reaction_type, user_id')
        .eq('activity_id', activityId);

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
