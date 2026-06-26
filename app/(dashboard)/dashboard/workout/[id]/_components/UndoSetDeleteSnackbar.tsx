'use client';

interface UndoSetDeleteSnackbarProps {
  visible: boolean;
  onUndo: () => void;
}

export function UndoSetDeleteSnackbar({ visible, onUndo }: UndoSetDeleteSnackbarProps) {
  if (!visible) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md">
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg shadow-lg">
        <svg className="w-5 h-5 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span className="text-sm text-surface-200 flex-1">Set removed</span>
        <button
          onClick={onUndo}
          className="px-3 py-1.5 text-sm font-semibold text-primary-300 hover:text-primary-200 rounded-md hover:bg-primary-500/10 transition-colors"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
