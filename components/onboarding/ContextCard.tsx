'use client';

import { useState, memo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CONTEXT_CARDS, type ContextCardContent } from '@/types/education';

export interface ContextCardProps {
  /** Use a predefined context card */
  cardKey?: keyof typeof CONTEXT_CARDS;

  /** Or provide custom content */
  content?: ContextCardContent;

  /** Whether the card can be collapsed */
  collapsible?: boolean;

  /** Initial collapsed state */
  defaultCollapsed?: boolean;

  /** Additional children to render below the card */
  children?: ReactNode;

  /** Custom class name */
  className?: string;

  /** Variant styling */
  variant?: 'default' | 'subtle' | 'highlighted';
}

export const ContextCard = memo(function ContextCard({
  cardKey,
  content: customContent,
  collapsible = true,
  defaultCollapsed = false,
  children,
  className,
  variant = 'default',
}: ContextCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // Get content from library or use custom
  const content = customContent || (cardKey ? CONTEXT_CARDS[cardKey] : null);

  if (!content) {
    console.warn(`ContextCard: No content found for key "${cardKey}"`);
    return null;
  }

  const variants = {
    default: 'bg-surface-800/50 border-surface-700',
    subtle: 'bg-surface-900/50 border-surface-800',
    highlighted: 'bg-primary-900/20 border-primary-800',
  };

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-all duration-300',
        variants[variant],
        className
      )}
    >
      {/* Header - always visible */}
      <button
        onClick={() => collapsible && setIsCollapsed(!isCollapsed)}
        className={cn(
          'w-full flex items-center gap-3 p-4 text-left',
          collapsible && 'hover:bg-surface-800/50 transition-colors cursor-pointer',
          !collapsible && 'cursor-default'
        )}
        disabled={!collapsible}
      >
        {/* Icon */}
        <span className="text-2xl flex-shrink-0" role="img" aria-hidden="true">
          {content.icon}
        </span>

        {/* Title */}
        <span className="flex-1 font-medium text-surface-100">
          {content.title}
        </span>

        {/* Collapse indicator */}
        {collapsible && (
          <svg
            className={cn(
              'w-5 h-5 text-surface-400 transition-transform duration-200',
              isCollapsed && 'rotate-180'
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 15l7-7 7 7"
            />
          </svg>
        )}
      </button>

      {/* Collapsible content */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300',
          isCollapsed ? 'max-h-0' : 'max-h-96'
        )}
      >
        <div className="px-4 pb-4 space-y-3">
          {/* Bullet points */}
          <ul className="space-y-2">
            {content.points.map((point, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-surface-300">
                <svg
                  className="w-4 h-4 text-primary-500 mt-0.5 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>{point}</span>
              </li>
            ))}
          </ul>

          {/* Preview text */}
          {content.preview && (
            <p className="text-xs text-surface-400 italic border-t border-surface-700 pt-3">
              {content.preview}
            </p>
          )}

          {/* Additional children */}
          {children}
        </div>
      </div>
    </div>
  );
});

ContextCard.displayName = 'ContextCard';

/**
 * A simpler inline context banner
 */
export const ContextBanner = memo(function ContextBanner({
  icon,
  title,
  description,
  className,
}: {
  icon: string;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-lg',
        'bg-surface-800/50 border border-surface-700',
        className
      )}
    >
      <span className="text-xl flex-shrink-0" role="img" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h4 className="font-medium text-surface-100 text-sm">{title}</h4>
        <p className="text-xs text-surface-400 mt-0.5">{description}</p>
      </div>
    </div>
  );
});

ContextBanner.displayName = 'ContextBanner';

/**
 * Welcome card for the start of onboarding
 */
export const WelcomeCard = memo(function WelcomeCard({
  userName,
  onContinue,
  className,
}: {
  userName?: string;
  onContinue: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'p-6 rounded-xl',
        'bg-gradient-to-br from-primary-900/30 to-surface-900',
        'border border-primary-800/50',
        className
      )}
    >
      <h2 className="text-xl font-bold text-surface-100 mb-2">
        Welcome{userName ? `, ${userName}` : ''} to HyperTrack
      </h2>

      <p className="text-surface-300 mb-4">
        Let&apos;s set up your personalized training experience. This takes about 5-7 minutes and helps us:
      </p>

      <ul className="space-y-2 mb-6">
        {[
          'Recommend the right weights for your workouts',
          'Calculate your optimal training volume',
          'Set personalized nutrition targets',
          'Track your progress accurately',
        ].map((point, index) => (
          <li key={index} className="flex items-center gap-2 text-sm text-surface-300">
            <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-xs flex items-center justify-center">
              {index + 1}
            </span>
            {point}
          </li>
        ))}
      </ul>

      <button
        onClick={onContinue}
        className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-lg transition-colors"
      >
        Let&apos;s Get Started
      </button>

      <p className="text-xs text-surface-500 text-center mt-3">
        You can always update these settings later
      </p>
    </div>
  );
});

WelcomeCard.displayName = 'WelcomeCard';
