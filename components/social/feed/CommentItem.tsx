'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/social/profile';
import { formatRelativeTime, getProfileUrl } from '@/lib/social';
import { CommentInput } from './CommentInput';
import { Button } from '@/components/ui/Button';
import type { ActivityComment } from '@/types/social';

interface CommentItemProps {
  comment: ActivityComment;
  currentUserId?: string;
  onReply?: (content: string, parentCommentId: string) => Promise<{ success: boolean; error?: string }>;
  onDelete?: (commentId: string) => Promise<{ success: boolean; error?: string }>;
  depth?: number;
}

export function CommentItem({ comment, currentUserId, onReply, onDelete, depth = 0 }: CommentItemProps) {
  const [isReplying, setIsReplying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const displayName = comment.user_profile?.display_name || comment.user_profile?.username || 'Unknown';
  const isOwnComment = currentUserId === comment.user_id;
  const maxDepth = 3; // Limit nesting depth

  const handleReply = async (content: string) => {
    if (!onReply) return { success: false, error: 'Reply not available' };
    
    const result = await onReply(content, comment.id);
    if (result.success) {
      setIsReplying(false);
    }
    return result;
  };

  const handleDelete = async () => {
    if (!onDelete || !confirm('Are you sure you want to delete this comment?')) {
      return;
    }

    setIsDeleting(true);
    await onDelete(comment.id);
    setIsDeleting(false);
  };

  return (
    <div className={depth > 0 ? 'ml-6 border-l-2 border-surface-800 pl-4' : ''}>
      <div className="flex gap-3">
        <Link href={comment.user_profile ? getProfileUrl(comment.user_profile.username) : '#'}>
          <Avatar
            src={comment.user_profile?.avatar_url}
            name={displayName}
            size="sm"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Link
                href={comment.user_profile ? getProfileUrl(comment.user_profile.username) : '#'}
                className="font-medium text-surface-100 hover:underline text-sm"
              >
                {displayName}
              </Link>
              <p className="text-sm text-surface-300 mt-1 whitespace-pre-wrap break-words">
                {comment.content}
              </p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-surface-400">
                  {formatRelativeTime(comment.created_at)}
                </span>
                {currentUserId && depth < maxDepth && onReply && (
                  <button
                    onClick={() => setIsReplying(!isReplying)}
                    className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
                  >
                    Reply
                  </button>
                )}
                {isOwnComment && onDelete && (
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="text-xs text-surface-400 hover:text-error-400 transition-colors disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Reply input */}
          {isReplying && currentUserId && (
            <div className="mt-3">
              <CommentInput
                onSubmit={handleReply}
                placeholder="Write a reply..."
                onCancel={() => setIsReplying(false)}
              />
            </div>
          )}

          {/* Nested replies */}
          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-4 space-y-4">
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  currentUserId={currentUserId}
                  onReply={onReply}
                  onDelete={onDelete}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

