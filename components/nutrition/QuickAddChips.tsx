'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconPlus } from '@tabler/icons-react';
import { Chip } from '@/components/ui';
import { formatPortion, frequentFoodPortion } from '@/lib/nutrition/frequentFoods';
import type { FrequentFood, MealType } from '@/types/nutrition';

/** How long a tapped chip reads "Added" before it goes back to the food. */
export const QUICK_ADD_CONFIRM_MS = 1600;

interface QuickAddChipsProps {
  foods: FrequentFood[];
  mealType: MealType;
  mealLabel: string;
  meals: Array<{ type: MealType; label: string }>;
  onMealChange: (meal: MealType) => void;
  /** Logs the food to `mealType`. Rejects on a failed save (no "Added"). */
  onAdd: (food: FrequentFood) => Promise<void>;
  /** Display name for a food (e.g. title-casing ALL-CAPS database names). */
  formatName?: (name: string) => string;
}

/**
 * Eat's one-tap row of the user's recent foods. The header says what the
 * row is and where a tap goes ("Foods you log most — tap to add to Dinner"); a
 * tapped chip turns into "✓ Added" for a moment, so the confirmation is
 * where the finger is (the Undo toast still announces it via role=status).
 */
export function QuickAddChips({
  foods,
  mealType,
  mealLabel,
  meals,
  onMealChange,
  onAdd,
  formatName = (name) => name,
}: QuickAddChipsProps) {
  const [addedName, setAddedName] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  if (foods.length === 0) return null;

  async function handleTap(food: FrequentFood) {
    try {
      await onAdd(food);
    } catch (err) {
      console.error('[QuickAddChips] quick add failed:', err);
      return;
    }
    setAddedName(food.food_name);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setAddedName(null), QUICK_ADD_CONFIRM_MS);
  }

  return (
    <div data-testid="quick-add-row">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 px-1 text-subhead text-ink-2">
        <span id="quick-add-label">Foods you log most — tap to add to</span>
        <select
          aria-labelledby="quick-add-label"
          value={mealType}
          onChange={(e) => onMealChange(e.target.value as MealType)}
          className="rounded-md bg-transparent font-medium text-ink underline decoration-dotted underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
          data-testid="quick-add-meal"
        >
          {meals.map((meal) => (
            <option key={meal.type} value={meal.type}>{meal.label}</option>
          ))}
        </select>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {foods.map((food) => {
          const name = formatName(food.food_name);
          const portion = formatPortion(frequentFoodPortion(food).serving_size);
          const added = addedName === food.food_name;
          return (
            <Chip
              key={food.food_name}
              onClick={() => void handleTap(food)}
              title={`${name} · ${portion}`}
              aria-label={`Log ${name}, ${portion}, to ${mealLabel}`}
              icon={added ? <IconCheck size={16} /> : <IconPlus size={16} />}
              className={`max-w-[16rem] ${added ? 'bg-status-ok/15 text-status-ok [&>span]:text-status-ok' : ''}`}
              data-testid="quick-add-chip"
              data-added={added ? 'true' : undefined}
            >
              {added ? (
                <span data-testid="quick-add-chip-added">Added to {mealLabel}</span>
              ) : (
                <>
                  <span className="truncate">{name}</span>
                  <span className="flex-shrink-0 text-subhead text-ink-2" data-testid="quick-add-chip-portion">· {portion}</span>
                </>
              )}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}
