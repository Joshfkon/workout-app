'use client';

import { ReactNode, memo } from 'react';

interface DashboardCardProps {
  id: string;
  children: ReactNode;
  isEditMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export const DashboardCard = memo(function DashboardCard({
  children,
  isEditMode,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: DashboardCardProps) {
  if (!isEditMode) {
    return <>{children}</>;
  }

  return (
    <div className="relative group">
      {/* Edit mode overlay with controls */}
      <div className="absolute -left-12 top-1/2 -translate-y-1/2 flex flex-col gap-1 z-10">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={`p-2 rounded-lg transition-all ${
            isFirst
              ? 'bg-surface-800/50 text-surface-600 cursor-not-allowed'
              : 'bg-surface-700 text-surface-300 hover:bg-primary-500 hover:text-white'
          }`}
          title="Move up"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={`p-2 rounded-lg transition-all ${
            isLast
              ? 'bg-surface-800/50 text-surface-600 cursor-not-allowed'
              : 'bg-surface-700 text-surface-300 hover:bg-primary-500 hover:text-white'
          }`}
          title="Move down"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Card with edit mode styling */}
      <div className="relative ring-2 ring-primary-500/30 ring-offset-2 ring-offset-surface-900 rounded-xl">
        {/* Drag handle indicator */}
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary-500/20 rounded-full border border-primary-500/30">
          <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
        </div>
        {children}
      </div>
    </div>
  );
});
