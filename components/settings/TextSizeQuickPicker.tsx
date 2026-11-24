'use client';

import { useTextSize } from '@/hooks/useTextSize';
import { TEXT_SIZES, TEXT_SIZE_LABELS, type TextSize } from '@/lib/textSize';
import { cn } from '@/lib/utils';

/**
 * Three "A" buttons, each drawn at its own size, for the places that offer
 * text size without a full settings row: Home's one-time "Text too small?"
 * card and the top of the register page. Same store as Settings
 * (hooks/useTextSize): applies on tap, saved on this device, and on the
 * account once there is one.
 */

// Fixed px on purpose: the letters show the three steps side by side and
// must not themselves grow with the root size.
const LETTER_PX: Record<TextSize, number> = { default: 15, large: 19, larger: 23 };

export function TextSizeQuickPicker({
  compact = false,
  onPick,
  className,
}: {
  /** Footer style: small, borderless buttons. */
  compact?: boolean;
  onPick?: (size: TextSize) => void;
  className?: string;
}) {
  const { textSize, setTextSize } = useTextSize();
  return (
    <div role="group" aria-label="Text size" className={cn('flex items-center gap-2', className)}>
      {TEXT_SIZES.map((size) => {
        const selected = textSize === size;
        return (
          <button
            key={size}
            type="button"
            aria-pressed={selected}
            aria-label={`${TEXT_SIZE_LABELS[size]} text`}
            data-testid={`text-size-pick-${size}`}
            onClick={() => {
              setTextSize(size);
              onPick?.(size);
            }}
            className={cn(
              'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-button font-semibold leading-none transition-colors',
              compact
                ? selected
                  ? 'text-action'
                  : 'text-ink-3 hover:text-ink-2'
                : selected
                  ? 'bg-action text-on-action'
                  : 'bg-fill text-ink hover:bg-fill/70'
            )}
            style={{ fontSize: `${compact ? LETTER_PX[size] - 2 : LETTER_PX[size]}px` }}
          >
            <span aria-hidden="true">A</span>
          </button>
        );
      })}
    </div>
  );
}
