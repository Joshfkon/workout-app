'use client';

interface AutoAdjustMessageProps {
  message: string | null;
  onDismiss: () => void;
}

export function AutoAdjustMessage({ message, onDismiss }: AutoAdjustMessageProps) {
  if (!message) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full mx-4">
      <div className="bg-primary-500/20 backdrop-blur-sm border border-primary-500/30 rounded-xl px-4 py-3 shadow-lg flex items-center gap-3">
        <span className="text-primary-400 text-lg">🔄</span>
        <p className="text-sm text-primary-200 flex-1">{message}</p>
        <button
          onClick={onDismiss}
          className="text-primary-400 hover:text-primary-200"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
