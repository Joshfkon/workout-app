'use client';

import { ReactNode, memo } from 'react';

interface WorkoutCardProps {
  id: string;
  children: ReactNode;
  isEditMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  isHidden?: boolean;
  hiddenLabel?: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisibility?: () => void;
}

export const WorkoutCard = memo(function WorkoutCard({
  children,
  isEditMode,
  isFirst,
  isLast,
  isHidden = false,
  hiddenLabel = 'Hidden from workouts',
  onMoveUp,
  onMoveDown,
  onToggleVisibility,
}: WorkoutCardProps) {
  if (!isEditMode) {
    return <>{children}</>;
  }

  return (
    <div className={`relative group ${isHidden ? 'opacity-50' : ''}`}>
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
      <div className={`relative ring-2 ring-offset-2 ring-offset-surface-900 rounded-xl ${
        isHidden ? 'ring-surface-600/50' : 'ring-primary-500/30'
      }`}>
        {/* Top controls: drag handle and hide/show button */}
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
          {/* Drag handle indicator */}
          <div className={`px-3 py-1 rounded-full border ${
            isHidden
              ? 'bg-surface-700/50 border-surface-600/50'
              : 'bg-primary-500/20 border-primary-500/30'
          }`}>
            <svg className={`w-4 h-4 ${isHidden ? 'text-surface-500' : 'text-primary-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </div>

          {/* Hide/Show toggle button */}
          {onToggleVisibility && (
            <button
              onClick={onToggleVisibility}
              className={`px-2 py-1 rounded-full border transition-all flex items-center gap-1.5 ${
                isHidden
                  ? 'bg-surface-700 border-surface-600 text-surface-400 hover:bg-surface-600 hover:text-surface-200'
                  : 'bg-surface-800 border-surface-700 text-surface-400 hover:bg-danger-500/20 hover:border-danger-500/50 hover:text-danger-400'
              }`}
              title={isHidden ? 'Show card' : 'Hide card'}
            >
              {isHidden ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span className="text-xs font-medium">Show</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                  <span className="text-xs font-medium">Hide</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Hidden badge overlay */}
        {isHidden && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="bg-surface-900/80 px-4 py-2 rounded-lg border border-surface-700">
              <span className="text-sm text-surface-400 font-medium">{hiddenLabel}</span>
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
});
