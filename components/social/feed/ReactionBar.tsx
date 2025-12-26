'use client';

import { memo, useState } from 'react';
import { cn } from '@/lib/utils';
import { getReactionEmoji, getReactionColor, formatSocialCount } from '@/lib/social';
import type { ActivityReaction, ReactionType } from '@/types/social';

export interface ReactionBarProps {
  activityId: string;
  reactionCount: number;
  commentCount: number;
  userReaction?: ActivityReaction;
  currentUserId?: string;
  onReact?: (activityId: string, reactionType: string) => void;
  onUnreact?: (activityId: string) => void;
  onComment?: (activityId: string) => void;
}

const REACTION_TYPES: ReactionType[] = ['like', 'fire', 'muscle', 'clap'];

function ReactionBarComponent({
  activityId,
  reactionCount,
  commentCount,
  userReaction,
  currentUserId,
  onReact,
  onUnreact,
  onComment,
}: ReactionBarProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleReactionClick = () => {
    if (userReaction) {
      // Already reacted - toggle off
      onUnreact?.(activityId);
    } else {
      // Show picker or default to like
      if (showPicker) {
        setShowPicker(false);
      } else {
        // Quick tap = like, long press would show picker
        handleSelectReaction('like');
      }
    }
  };

  const handleSelectReaction = (type: ReactionType) => {
    setIsAnimating(true);
    onReact?.(activityId, type);
    setShowPicker(false);
    setTimeout(() => setIsAnimating(false), 300);
  };

  const handleLongPress = () => {
    setShowPicker(true);
  };

  return (
    <div className="flex items-center justify-between">
      {/* Left side - Reactions */}
      <div className="flex items-center gap-4">
        {/* Reaction button */}
        <div className="relative">
          <button
            onClick={handleReactionClick}
            onContextMenu={(e) => {
              e.preventDefault();
              handleLongPress();
            }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all',
              userReaction
                ? 'bg-surface-800 text-surface-100'
                : 'hover:bg-surface-800 text-surface-400 hover:text-surface-200',
              isAnimating && 'scale-110'
            )}
          >
            <span className={cn('text-lg', isAnimating && 'animate-bounce')}>
              {userReaction ? getReactionEmoji(userReaction.reaction_type as ReactionType) : '❤️'}
            </span>
            {reactionCount > 0 && (
              <span className="text-sm">{formatSocialCount(reactionCount)}</span>
            )}
          </button>

          {/* Reaction picker */}
          {showPicker && (
            <div className="absolute bottom-full left-0 mb-2 flex gap-1 bg-surface-900 border border-surface-700 rounded-full p-1 shadow-lg">
              {REACTION_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => handleSelectReaction(type)}
                  className={cn(
                    'w-10 h-10 flex items-center justify-center rounded-full',
                    'hover:bg-surface-700 transition-transform hover:scale-125',
                    userReaction?.reaction_type === type && 'bg-surface-700'
                  )}
                >
                  <span className="text-xl">{getReactionEmoji(type)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Comment button */}
        <button
          onClick={() => onComment?.(activityId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          {commentCount > 0 && (
            <span className="text-sm">{formatSocialCount(commentCount)}</span>
          )}
        </button>
      </div>

      {/* Right side - Share (optional) */}
      <button
        className="p-2 rounded-full hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
        title="Share"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
      </button>
    </div>
  );
}

export const ReactionBar = memo(ReactionBarComponent);
ReactionBar.displayName = 'ReactionBar';
