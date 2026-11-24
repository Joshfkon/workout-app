import { STARTING_VOLUME_CHOICES } from '@/lib/training/builderDefaults';
import type { StartingVolume } from '@/services/mesocycleBuilder';

/**
 * "Starting volume: conservative / standard / high", each mapped to the
 * muscle's own landmarks (UX panel round 21: "Let me edit volume directly
 * or pick a higher starting volume"). `examples` shows what each choice
 * means in sets for this lifter, so the words are anchored to numbers.
 */
export function StartingVolumeChooser({
  value,
  onChange,
  examples,
}: {
  value: StartingVolume;
  onChange: (v: StartingVolume) => void;
  /** One short line per choice, e.g. "Quads 15, back 20 sets a week". */
  examples?: Partial<Record<StartingVolume, string>>;
}) {
  return (
    <div className="space-y-1.5" data-testid="builder-starting-volume">
      <p className="text-subhead font-medium text-ink" id="builder-starting-volume-label">
        Starting volume
      </p>
      <p className="text-caption text-ink-3">
        Where each muscle&apos;s peak-week target sits between MEV (the least that grows it) and MRV (the most you
        recover from). MAV is the middle, where most growth happens.
      </p>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="builder-starting-volume-label">
        {STARTING_VOLUME_CHOICES.map((c) => {
          const selected = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(c.value)}
              className={`min-h-[48px] rounded-lg border px-3 py-2 text-left ${
                selected ? 'border-action bg-action/10' : 'border-sep bg-fill/30 hover:border-action/60'
              }`}
              data-testid={`builder-starting-volume-${c.value}`}
            >
              <span className="block font-semibold text-ink">{c.label}</span>
              <span className="block text-caption text-ink-2">{c.detail}</span>
              {examples?.[c.value] && <span className="block text-caption text-ink-3">{examples[c.value]}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-caption text-ink-3">
        These are targets. A session holds only so many sets, so the review shows what your sessions actually fit.
      </p>
    </div>
  );
}
