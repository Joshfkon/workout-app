'use client';

import { useState, useEffect, useCallback } from 'react';
import { useComments } from '@/hooks/useComments';
import { CommentItem } from './CommentItem';
import { CommentInput } from './CommentInput';
import { Button } from '@/components/ui/Button';
import type { ActivityComment } from '@/types/social';

interface CommentSectionProps {
  activityId: string;
  commentCount: number;
  currentUserId?: string;
  onCommentAdded?: () => void;
}

export function CommentSection({ activityId, commentCount, currentUserId, onCommentAdded }: CommentSectionProps) {
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { getComments, addComment, deleteComment } = useComments();

  const loadComments = useCallback(async () => {
    if (!isExpanded) return;

    setIsLoading(true);
    const { data, error } = await getComments(activityId);
    if (!error) {
      setComments(data);
    }
    setIsLoading(false);
  }, [activityId, isExpanded, getComments]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleAddComment = useCallback(async (content: string, parentCommentId?: string) => {
    const result = await addComment(activityId, content, parentCommentId);
    if (result.success) {
      // Reload comments
      await loadComments();
      onCommentAdded?.();
    }
    return result;
  }, [activityId, addComment, loadComments, onCommentAdded]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    const result = await deleteComment(commentId);
    if (result.success) {
      // Reload comments
      await loadComments();
    }
    return result;
  }, [deleteComment, loadComments]);

  if (commentCount === 0 && !isExpanded) {
    return (
      <div className="px-4 pb-3">
        <button
          onClick={() => setIsExpanded(true)}
          className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
        >
          Add a comment...
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-surface-800">
      {/* Toggle button */}
      {!isExpanded && commentCount > 0 && (
        <div className="px-4 py-3">
          <button
            onClick={() => setIsExpanded(true)}
            className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
          >
            View {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
          </button>
        </div>
      )}

      {/* Expanded comments */}
      {isExpanded && (
        <div className="px-4 py-3 space-y-4">
          {/* Comments list */}
          {isLoading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary-500" />
            </div>
          ) : comments.length > 0 ? (
            <div className="space-y-4">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  currentUserId={currentUserId}
                  onReply={handleAddComment}
                  onDelete={handleDeleteComment}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-surface-400 text-center py-4">No comments yet</p>
          )}

          {/* Comment input */}
          {currentUserId && (
            <CommentInput
              onSubmit={handleAddComment}
              placeholder="Add a comment..."
            />
          )}

          {/* Collapse button */}
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(false)}
              className="text-sm"
            >
              Hide comments
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

