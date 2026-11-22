'use client';

/**
 * The "Start a workout" options: empty workout, AI-suggested workout, repeat
 * a previous workout. One component for the Train tab and Home's "Start
 * workout" sheet, so both offer exactly the same starts.
 *
 * The empty start runs here (useStartEmptyWorkout — create/reuse today's
 * ad-hoc session and open it). The suggestion and repeat pickers are sheets
 * the caller owns, because Home closes its own sheet before opening them.
 */

import { IconLoader2, IconPlus, IconRepeat, IconSparkles } from '@tabler/icons-react';
import { QuickLogRow } from '@/app/(dashboard)/dashboard/log/_components/LogPageSections';
import { useStartEmptyWorkout } from '@/hooks/useStartEmptyWorkout';

export interface StartWorkoutOptionsProps {
  /** Open the AI-suggested workout sheet. */
  onSuggest: () => void;
  /** Open the "repeat a workout" picker. */
  onRepeat: () => void;
  /** True once the user has a completed workout to repeat. */
  canRepeat: boolean;
}

export function StartWorkoutOptions({ onSuggest, onRepeat, canRepeat }: StartWorkoutOptionsProps) {
  const { start: startEmpty, isStarting: isStartingEmpty, error } = useStartEmptyWorkout();

  return (
    <div className="space-y-2">
      <QuickLogRow
        icon={
          <span className="w-10 h-10 rounded-xl bg-action/15 flex items-center justify-center flex-shrink-0">
            {isStartingEmpty ? (
              <IconLoader2 size={22} className="text-action animate-spin" aria-hidden="true" />
            ) : (
              <IconPlus size={22} className="text-action" aria-hidden="true" />
            )}
          </span>
        }
        title="Start empty workout"
        subtitle={isStartingEmpty ? 'Starting...' : 'Add exercises as you go'}
        onTap={() => void startEmpty()}
        disabled={isStartingEmpty}
      />

      <QuickLogRow
        icon={
          <span className="w-10 h-10 rounded-xl bg-action/15 flex items-center justify-center flex-shrink-0">
            <IconSparkles size={22} className="text-action" aria-hidden="true" />
          </span>
        }
        title="AI-suggested workout"
        subtitle="Built from recovery and weekly volume"
        onTap={onSuggest}
      />

      <QuickLogRow
        icon={
          <span className="w-10 h-10 rounded-xl bg-fill flex items-center justify-center flex-shrink-0">
            <IconRepeat size={22} className="text-ink" aria-hidden="true" />
          </span>
        }
        title="Repeat previous workout"
        subtitle={canRepeat ? 'Same exercises, fresh targets' : 'Available once you complete a workout'}
        onTap={onRepeat}
        disabled={!canRepeat}
      />

      {error && <p className="px-1 text-caption text-status-bad">{error}</p>}
    </div>
  );
}
