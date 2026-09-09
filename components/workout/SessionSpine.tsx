'use client';

/**
 * SessionSpine - Live workout session checklist
 *
 * Extends pre-workout coach notes into a live session spine: 3-5 bullets that
 * update/tick as the workout progresses. Accessible without leaving the workout
 * (collapsible sheet/card), not a separate Coach tab.
 */

import { useState, useEffect } from 'react';
import { IconCheck, IconChevronDown, IconListCheck, IconSparkles } from '@tabler/icons-react';
import { Button } from '@/components/ui';

export interface SessionSpineProps {
  spine: string[];
  completedItems?: Set<number>;
  onToggleItem?: (index: number) => void;
  isGenerating?: boolean;
  onRefresh?: () => void;
}

export function SessionSpine({
  spine,
  completedItems = new Set(),
  onToggleItem,
  isGenerating = false,
  onRefresh,
}: SessionSpineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const completedCount = completedItems.size;
  const totalCount = spine.length;

  return (
    <div
      className="bg-surface-800/60 border border-surface-700 rounded-xl overflow-hidden"
      data-testid="session-spine"
    >
      {/* Collapsed Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-800 transition-colors"
        aria-expanded={isExpanded}
        aria-controls="session-spine-content"
      >
        <IconListCheck className="w-5 h-5 text-primary-400 flex-shrink-0" />
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-semibold text-surface-100">
            Session Focus
          </p>
          <p className="text-xs text-surface-400">
            {completedCount} of {totalCount} completed
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              className="p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
              aria-label="Refresh session spine"
              disabled={isGenerating}
            >
              <IconSparkles
                className={`w-4 h-4 text-primary-400 ${isGenerating ? 'animate-pulse' : ''}`}
              />
            </button>
          )}
          <IconChevronDown
            className={`w-5 h-5 text-surface-400 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div id="session-spine-content" className="px-4 pb-4 space-y-2">
          {isGenerating ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-surface-700/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : spine.length > 0 ? (
            spine.map((item, index) => (
              <SpineItem
                key={index}
                text={item}
                isCompleted={completedItems.has(index)}
                onToggle={onToggleItem ? () => onToggleItem(index) : undefined}
              />
            ))
          ) : (
            <p className="text-sm text-surface-400 italic text-center py-4">
              No session focus items yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface SpineItemProps {
  text: string;
  isCompleted: boolean;
  onToggle?: () => void;
}

function SpineItem({ text, isCompleted, onToggle }: SpineItemProps) {
  return (
    <button
      onClick={onToggle}
      disabled={!onToggle}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all ${
        onToggle
          ? 'hover:bg-surface-700/50 cursor-pointer'
          : 'cursor-default'
      } ${isCompleted ? 'bg-success-900/20' : 'bg-surface-900/40'}`}
      data-testid={`spine-item-${isCompleted ? 'completed' : 'pending'}`}
    >
      <div
        className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
          isCompleted
            ? 'bg-success-500 text-surface-900'
            : 'border-2 border-surface-600'
        }`}
      >
        {isCompleted && <IconCheck className="w-3.5 h-3.5" strokeWidth={3} />}
      </div>
      <p
        className={`flex-1 text-sm text-left leading-snug transition-colors ${
          isCompleted
            ? 'text-surface-300 line-through'
            : 'text-surface-100'
        }`}
      >
        {text}
      </p>
    </button>
  );
}
