'use client';

import { SegmentedControl } from '@/components/ui';
import { useTextSize } from '@/hooks/useTextSize';
import { TEXT_SIZES, TEXT_SIZE_LABELS, type TextSize } from '@/lib/textSize';

/**
 * Default / Large / Larger. Applies the moment it is tapped (the whole app
 * scales, this screen included), saves on this device and to the account.
 * Used in Settings → Preferences and on the first onboarding step.
 */
export function TextSizeControl({ preview = false }: { preview?: boolean }) {
  const { textSize, setTextSize } = useTextSize();
  return (
    <div>
      <SegmentedControl<TextSize>
        label="Text size"
        value={textSize}
        onChange={setTextSize}
        options={TEXT_SIZES.map((size) => ({ value: size, label: TEXT_SIZE_LABELS[size] }))}
        className="w-full"
      />
      {preview && (
        <p
          data-testid="text-size-preview"
          className="mt-3 rounded-lg bg-fill/60 px-3 py-2 text-body text-ink"
        >
          Bench press · 3 sets of 8 reps.{' '}
          <span className="text-ink-2">This is how text will look.</span>
        </p>
      )}
    </div>
  );
}
