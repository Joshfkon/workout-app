import { IconAlertTriangle } from '@tabler/icons-react';
import { splitLabel, type OncePerWeekPriority } from '@/lib/training/builderDefaults';
import { MAX_SESSION_MUSCLE_CEILING } from '@/services/sessionBuilderWithFatigue';
import type { Split } from '@/types/schema';

/**
 * Beside the priority editor in Customize: a high-priority muscle the split
 * trains once a week can gain little, because one session holds
 * about `ceiling` hard sets of it. Round 21 said so only on the review;
 * Vince set hamstrings to high on a Bro Split and got +1 set with no
 * warning where he set it (UX panel round 21). One tap fixes it: raise the
 * per-session limit (advanced lifters), or switch to a split that trains
 * the muscle twice a week.
 */
export function PriorityFrequencyWarning({
  muscles,
  split,
  ceiling,
  canRaiseCeiling,
  onRaiseCeiling,
  twiceWeeklySplit,
  onSwitchSplit,
}: {
  muscles: readonly OncePerWeekPriority[];
  split: string;
  ceiling: number;
  canRaiseCeiling: boolean;
  onRaiseCeiling: () => void;
  /** A split that trains every muscle twice a week on the lifter's days. */
  twiceWeeklySplit: Split;
  onSwitchSplit: (split: Split) => void;
}) {
  if (muscles.length === 0) return null;
  const names = muscles.map((m) => m.label);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const raise = canRaiseCeiling && ceiling < MAX_SESSION_MUSCLE_CEILING;
  return (
    <div
      className="mt-3 rounded-lg border border-status-warn/30 bg-status-warn/10 p-3"
      role="status"
      data-testid="builder-priority-frequency-warning"
    >
      <p className="flex items-start gap-2 text-subhead text-ink">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-warn" stroke={1.75} aria-hidden="true" />
        <span>
          {splitLabel(split)} trains {list} once a week, and one session holds about {ceiling} hard sets of a
          muscle, so high priority can&apos;t add past that. A second day a week adds more.
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {raise && (
          <button
            type="button"
            onClick={onRaiseCeiling}
            className="min-h-[44px] rounded-full border border-action px-3 py-1 text-caption font-semibold text-action hover:bg-action/10"
            data-testid="builder-priority-fix-ceiling"
          >
            Raise limit to {MAX_SESSION_MUSCLE_CEILING} sets
          </button>
        )}
        {twiceWeeklySplit !== split && (
          <button
            type="button"
            onClick={() => onSwitchSplit(twiceWeeklySplit)}
            className="min-h-[44px] rounded-full border border-action px-3 py-1 text-caption font-semibold text-action hover:bg-action/10"
            data-testid="builder-priority-fix-split"
          >
            Switch to {splitLabel(twiceWeeklySplit)} (twice a week)
          </button>
        )}
      </div>
    </div>
  );
}
