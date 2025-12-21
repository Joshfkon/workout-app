'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ExerciseVisibilityStatus } from '@/types/user-exercise-preferences';

interface ExerciseOptionsMenuProps {
  exerciseId: string;
  exerciseName: string;
  status: ExerciseVisibilityStatus;
  onMute: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onAddToWorkout?: () => void;
  onViewHistory?: () => void;
}

export function ExerciseOptionsMenu({
  exerciseName,
  status,
  onMute,
  onArchive,
  onRestore,
  onAddToWorkout,
  onViewHistory,
}: ExerciseOptionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Position menu when opening
  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 220;
      const menuHeight = 200;

      // Position menu below button, aligned to right
      let left = rect.right - menuWidth;
      let top = rect.bottom + 8;

      // Keep menu in viewport
      if (left < 8) left = 8;
      if (top + menuHeight > window.innerHeight - 8) {
        top = rect.top - menuHeight - 8;
      }

      setMenuPosition({ top, left });
    }
    setIsOpen(!isOpen);
  };

  const handleAction = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  const menuContent = isOpen && (
    <div
      ref={menuRef}
      className="fixed z-50 w-56 bg-surface-900 border border-surface-700 rounded-lg shadow-xl py-1 animate-fade-in"
      style={{ top: menuPosition.top, left: menuPosition.left }}
    >
      <div className="px-3 py-2 border-b border-surface-800">
        <p className="text-sm font-medium text-surface-200 truncate">{exerciseName}</p>
        {status !== 'active' && (
          <p className="text-xs text-surface-500 mt-0.5">
            {status === 'do_not_suggest' ? 'Not suggesting' : 'Archived'}
          </p>
        )}
      </div>

      <div className="py-1">
        {onAddToWorkout && (
          <button
            onClick={() => handleAction(onAddToWorkout)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add to Workout
          </button>
        )}

        {onViewHistory && (
          <button
            onClick={() => handleAction(onViewHistory)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            View History
          </button>
        )}
      </div>

      <div className="border-t border-surface-800 py-1">
        {status === 'active' && (
          <>
            <button
              onClick={() => handleAction(onMute)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-surface-200 hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                />
              </svg>
              Don&apos;t Suggest This
            </button>
            <button
              onClick={() => handleAction(onArchive)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-surface-200 hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              Archive (Hide)
            </button>
          </>
        )}

        {status === 'do_not_suggest' && (
          <>
            <button
              onClick={() => handleAction(onRestore)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-emerald-400 hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Allow Suggestions Again
            </button>
            <button
              onClick={() => handleAction(onArchive)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-surface-200 hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              Archive (Hide)
            </button>
          </>
        )}

        {status === 'archived' && (
          <button
            onClick={() => handleAction(onRestore)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-emerald-400 hover:bg-surface-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Unarchive
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="p-1.5 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
        aria-label="Exercise options"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
          />
        </svg>
      </button>
      {typeof window !== 'undefined' && createPortal(menuContent, document.body)}
    </>
  );
}
