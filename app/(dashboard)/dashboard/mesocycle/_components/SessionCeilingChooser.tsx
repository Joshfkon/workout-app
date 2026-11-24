import {
  MAX_SETS_PER_MUSCLE_PER_SESSION,
  SESSION_MUSCLE_CEILING_OPTIONS,
} from '@/services/sessionBuilderWithFatigue';

/**
 * "Max hard sets per muscle in one session" for an advanced lifter: 12 by
 * default, up to 16. A 5-day body-part split trains each muscle once, so the
 * fixed 12-set ceiling capped its weekly sets with no way to change it (UX
 * panel round 20). The note is honest about the trade-off.
 */
export function SessionCeilingChooser({
  value,
  onChange,
  compact = false,
}: {
  value: number;
  onChange: (sets: number) => void;
  /** Inline under the once-a-week note on the review (no heading). */
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'mt-2' : 'space-y-1.5'} data-testid={compact ? 'builder-ceiling-inline' : 'builder-ceiling'}>
      {!compact && (
        <p className="text-subhead font-medium text-ink" id="builder-ceiling-label">
          Max hard sets per muscle in one session
        </p>
      )}
      <div
        className="flex flex-wrap items-center gap-2"
        role="radiogroup"
        aria-label="Max hard sets per muscle in one session"
      >
        {compact && <span className="text-caption text-ink-2">Per-session limit</span>}
        {SESSION_MUSCLE_CEILING_OPTIONS.map((sets) => {
          const selected = sets === value;
          return (
            <button
              key={sets}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(sets)}
              className={`min-h-[36px] rounded-full px-3 py-1 text-caption font-semibold ${
                selected ? 'bg-action text-white' : 'border border-action text-action hover:bg-action/10'
              }`}
              data-testid={`builder-ceiling-${sets}`}
            >
              {sets} sets{sets === MAX_SETS_PER_MUSCLE_PER_SESSION ? ' (default)' : ''}
            </button>
          );
        })}
      </div>
      {!compact && (
        <p className="text-caption text-ink-3">
          Most research finds diminishing returns past ~10–12 hard sets for one muscle in one session, so 12 is
          the default. Raise it if your split trains a muscle once a week and you recover well; a second day for
          that muscle usually does more.
        </p>
      )}
    </div>
  );
}
