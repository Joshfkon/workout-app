'use client';

interface WorkoutErrorAlertProps {
  error: string | null;
  onDismiss: () => void;
}

export function WorkoutErrorAlert({ error, onDismiss }: WorkoutErrorAlertProps) {
  if (!error) return null;

  return (
    <div className="p-3 bg-danger-500/10 border border-danger-500/30 rounded-lg flex items-center gap-2">
      <svg className="w-5 h-5 text-danger-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="text-sm text-danger-300">{error}</span>
      <button
        onClick={onDismiss}
        className="ml-auto p-1 hover:bg-danger-500/20 rounded"
      >
        <svg className="w-4 h-4 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
