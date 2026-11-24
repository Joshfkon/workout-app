import { SPLIT_CHOICES } from '@/lib/training/builderDefaults';
import { splitWeekDays } from '@/services/sessionBuilderWithFatigue';
import type { Split } from '@/types/schema';

/**
 * The split as the builder's first decision: one card per split with what
 * its week looks like, the recommended one marked (UX panel round 21: "The
 * split was AI-chosen by default and I didn't see a clear way to choose my
 * own" — it was a dropdown inside Customize). Picking a split that needs
 * more days than the week has says so on the card; the page raises the days.
 */
export function SplitChooser({
  value,
  recommended,
  sessionsPerWeek,
  onChoose,
  matchesHistory,
}: {
  value: string;
  /** The split the app would pick for this schedule (marked "Recommended"). */
  recommended: string | null;
  sessionsPerWeek: number;
  onChoose: (split: Split) => void;
  /** The split recent training reads as, marked "Your recent split". */
  matchesHistory?: string | null;
}) {
  return (
    <section className="space-y-2" data-testid="builder-split-chooser" aria-labelledby="builder-split-heading">
      <div>
        <h2 id="builder-split-heading" className="text-headline font-semibold text-ink">
          Choose your split
        </h2>
        <p className="text-subhead text-ink-2">How your week is divided. The plan follows the one you pick.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="builder-split-heading">
        {SPLIT_CHOICES.map((choice) => {
          const selected = choice.split === value;
          const days = Math.max(sessionsPerWeek, choice.minDays);
          // "Push 1 … Push 2" reads as noise on a card; the order is the point.
          const week = splitWeekDays(choice.split, days).map((d) => d.replace(/ \d+$/, ''));
          return (
            <button
              key={choice.split}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChoose(choice.split)}
              className={`min-h-[48px] rounded-lg border p-3 text-left transition-colors ${
                selected ? 'border-action bg-action/10' : 'border-sep bg-fill/30 hover:border-action/60'
              }`}
              data-testid={`builder-split-${choice.split.replace(/[^A-Za-z]/g, '').toLowerCase()}`}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{choice.label}</span>
                {recommended === choice.split && (
                  <span className="rounded-full bg-status-ok/15 px-2 py-0.5 text-caption font-semibold text-status-ok">
                    Recommended
                  </span>
                )}
                {matchesHistory === choice.split && recommended !== choice.split && (
                  <span className="rounded-full bg-fill px-2 py-0.5 text-caption font-semibold text-ink-2">
                    Your recent split
                  </span>
                )}
              </span>
              <span className="mt-1 block text-caption text-ink-2">{choice.blurb}</span>
              <span className="mt-1 block text-caption text-ink-3">
                {days} days: {week.join(' · ')}
              </span>
              {sessionsPerWeek < choice.minDays && (
                <span className="mt-1 block text-caption text-status-warn">
                  Needs {choice.minDays} days a week; picking it sets {choice.minDays}.
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
