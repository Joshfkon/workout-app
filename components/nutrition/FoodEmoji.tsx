'use client';

/**
 * Leading emoji avatar for food rows (day log, recents/picker, add sheet).
 * Purely decorative — the food name is always adjacent, so it's aria-hidden.
 * No image assets / icon fonts: plain Unicode via lib/nutrition/foodEmoji.
 */

import { foodEmoji } from '@/lib/nutrition/foodEmoji';

export function FoodEmojiAvatar({
  name,
  brand,
  size = 'md',
}: {
  name: string;
  brand?: string | null;
  size?: 'sm' | 'md';
}) {
  const sizeClasses =
    size === 'sm' ? 'h-6 w-6 text-subhead' : 'h-8 w-8 text-body';
  return (
    <span
      aria-hidden="true"
      data-testid="food-emoji-avatar"
      className={`flex flex-shrink-0 items-center justify-center rounded-full bg-fill ${sizeClasses}`}
    >
      {foodEmoji(name, brand)}
    </span>
  );
}
