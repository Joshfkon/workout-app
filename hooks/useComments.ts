'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ActivityComment } from '@/types/social';

export function useComments() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getComments = useCallback(async (activityId: string): Promise<{ data: ActivityComment[]; error: string | null }> => {
    try {
      const supabase = createClient();

      // First fetch comments
      const { data: commentsData, error: commentsError } = (await supabase
        .from('activity_comments' as never)
        .select(`
          id,
          activity_id,
          user_id,
          content,
          parent_comment_id,
          created_at,
          updated_at,
          deleted_at
        `)
        .eq('activity_id', activityId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })) as {
        data: Array<{
          id: string;
          activity_id: string;
          user_id: string;
          content: string;
          parent_comment_id: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        }> | null;
        error: Error | null;
      };

      if (commentsError) throw commentsError;
      if (!commentsData || commentsData.length === 0) {
        return { data: [], error: null };
      }

      // Fetch user profiles for all comment authors
      const userIds = Array.from(new Set(commentsData.map(c => c.user_id)));
      const { data: profilesData, error: profilesError } = await supabase
        .from('user_profiles' as never)
        .select('id, user_id, username, display_name, avatar_url')
        .in('user_id', userIds) as { data: Array<{
          id: string;
          user_id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
        }> | null; error: any };

      if (profilesError) {
        console.error('[useComments] Profiles query error:', profilesError);
      }

      // Create profiles map
      const profilesMap = new Map();
      if (profilesData) {
        profilesData.forEach(profile => {
          profilesMap.set(profile.user_id, profile);
        });
      }

      // Combine comments with profiles
      const data = commentsData.map((row) => ({
        ...row,
        user_profiles: profilesMap.get(row.user_id) || null,
      }));

      // Transform and organize comments into tree structure
      const commentsMap = new Map<string, ActivityComment>();
      const rootComments: ActivityComment[] = [];

      // First pass: create all comment objects
      data.forEach((row) => {
        if (!row.user_profiles) {
          // Skip comments without profiles
          return;
        }
        const comment: ActivityComment = {
          id: row.id,
          activity_id: row.activity_id,
          user_id: row.user_id,
          content: row.content,
          parent_comment_id: row.parent_comment_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          deleted_at: row.deleted_at,
          user_profile: {
            id: row.user_profiles.id,
            user_id: row.user_profiles.user_id,
            username: row.user_profiles.username,
            display_name: row.user_profiles.display_name,
            avatar_url: row.user_profiles.avatar_url,
            bio: null,
            profile_visibility: 'public',
            show_workouts: true,
            show_stats: true,
            show_progress_photos: false,
            follower_count: 0,
            following_count: 0,
            workout_count: 0,
            total_volume_kg: 0,
            training_experience: null,
            primary_goal: null,
            gym_name: null,
            badges: [],
            featured_achievement: null,
            created_at: '',
            updated_at: '',
          },
          replies: [],
        };
        commentsMap.set(row.id, comment);
      });

      // Second pass: build tree structure
      Array.from(commentsMap.values()).forEach((comment) => {
        if (comment.parent_comment_id) {
          const parent = commentsMap.get(comment.parent_comment_id);
          if (parent) {
            if (!parent.replies) {
              parent.replies = [];
            }
            parent.replies.push(comment);
          }
        } else {
          rootComments.push(comment);
        }
      });

      return { data: rootComments, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get comments';
      return { data: [], error: message };
    }
  }, []);

  const addComment = useCallback(async (activityId: string, content: string, parentCommentId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Must be logged in to comment');
      }

      if (!content.trim()) {
        throw new Error('Comment cannot be empty');
      }

      if (content.length > 1000) {
        throw new Error('Comment must be 1000 characters or less');
      }

      const { data, error: insertError } = (await supabase
        .from('activity_comments' as never)
        .insert({
          activity_id: activityId,
          user_id: user.id,
          content: content.trim(),
          parent_comment_id: parentCommentId || null,
        } as never)
        .select()
        .single()) as { data: any; error: Error | null };

      if (insertError) throw insertError;

      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add comment';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteComment = useCallback(async (commentId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Must be logged in');
      }

      // Soft delete by setting deleted_at
      const { error: updateError } = await (supabase
        .from('activity_comments' as never) as ReturnType<typeof supabase.from>)
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', commentId)
        .eq('user_id', user.id); // Only allow deleting own comments

      if (updateError) throw updateError;

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete comment';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    getComments,
    addComment,
    deleteComment,
    isLoading,
    error,
  };
}

