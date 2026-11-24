'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconPlus } from '@tabler/icons-react';
import { Chip } from '@/components/ui';
import { AddedBanner, type QuickAddConfirmation } from './AddedBanner';
import { formatPortion, frequentFoodPortion } from '@/lib/nutrition/frequentFoods';
import type { FrequentFood, MealType } from '@/types/nutrition';

/** How long a tapped chip shows its check mark before it goes back to "+". */
export const QUICK_ADD_CONFIRM_MS = 3000;
/** How long the confirmation line under the row stays (it has an Undo). */
export const QUICK_ADD_STATUS_MS = 8000;

export type { QuickAddConfirmation } from './AddedBanner';

interface QuickAddChipsProps {
  foods: FrequentFood[];
  mealType: MealType;
  mealLabel: string;
  meals: Array<{ type: MealType; label: string }>;
  onMealChange: (meal: MealType) => void;
  /**
   * Logs the food to `mealType`. Rejects if the add couldn't even start (no
   * confirmation). May resolve with a confirmation to show under the row —
   * right away, before the save lands (its `saved` promise).
   */
  onAdd: (food: FrequentFood) => Promise<QuickAddConfirmation | void>;
  /** True while `mealType` is the time-of-day default (not a meal the user picked). */
  mealIsTimeDefault?: boolean;
  /** Display name for a food (e.g. title-casing ALL-CAPS database names). */
  formatName?: (name: string) => string;
}

/**
 * Eat's one-tap row of the user's recent foods.
 *
 * - The header says where a tap goes ("tap to add to Dinner"), and that the
 *   meal was picked for the time of day until the user changes it.
 * - Each chip shows the portion it will log: the amount the user logged
 *   LAST time for that food (see frequentFoodPortion), not a fixed serving,
 *   and the row says so.
 * - After a tap the chip shows a check, and a line under the row says what
 *   was added, how much, to which meal, and the day's running total, with
 *   Undo. It sits in the flow (no toast over the meal cards) and is a polite
 *   live region, so screen readers hear it too.
 */
export function QuickAddChips({
  foods,
  mealType,
  mealLabel,
  meals,
  onMealChange,
  onAdd,
  mealIsTimeDefault = false,
  formatName = (name) => name,
}: QuickAddChipsProps) {
  const [addedName, setAddedName] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<QuickAddConfirmation | null>(null);
  const chipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    },
    []
  );

  if (foods.length === 0) return null;

  function showStatus(next: QuickAddConfirmation) {
    setConfirmation(next);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setConfirmation(null), QUICK_ADD_STATUS_MS);
  }

  async function handleTap(food: FrequentFood) {
    let result: QuickAddConfirmation | void;
    try {
      // Resolves as soon as the add is shown (optimistic); the save itself
      // is result.saved, which the banner watches.
      result = await onAdd(food);
    } catch (err) {
      console.error('[QuickAddChips] quick add failed:', err);
      return;
    }
    setAddedName(food.food_name);
    if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
    chipTimerRef.current = setTimeout(() => setAddedName(null), QUICK_ADD_CONFIRM_MS);
    if (result) showStatus(result);
  }

  return (
    <div data-testid="quick-add-row">
      <div className="mb-0.5 flex flex-wrap items-center gap-x-1.5 px-1 text-subhead text-ink-2">
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
      <p className="mb-1.5 px-1 text-caption text-ink-3" data-testid="quick-add-explainer">
        Each adds the amount you logged last time
        {mealIsTimeDefault ? ` · ${mealLabel} picked for the time of day` : ''}
      </p>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {foods.map((food) => {
          const name = formatName(food.food_name);
          const portion = formatPortion(frequentFoodPortion(food).serving_size);
          const added = addedName === food.food_name;
          return (
            <Chip
              key={food.food_name}
              onClick={() => void handleTap(food)}
              title={`${name} · ${portion} · adds to ${mealLabel}`}
              aria-label={`Log ${name}, ${portion}, to ${mealLabel}`}
              icon={added ? <IconCheck size={16} /> : <IconPlus size={16} />}
              className={`max-w-[16rem] ${added ? 'bg-status-ok/15 text-status-ok [&>span]:text-status-ok' : ''}`}
              data-testid="quick-add-chip"
              data-added={added ? 'true' : undefined}
            >
              <span className="truncate">{name}</span>
              {added ? (
                <span className="flex-shrink-0 font-semibold" data-testid="quick-add-chip-added">· Added to {mealLabel}</span>
              ) : (
                <span className="flex-shrink-0 text-subhead text-ink-2" data-testid="quick-add-chip-portion">· {portion}</span>
              )}
            </Chip>
          );
        })}
      </div>
      <div role="status" aria-live="polite" data-testid="quick-add-status">
        {confirmation && (
          <div className="mt-2">
            <AddedBanner
              confirmation={confirmation}
              onFailed={() => {
                setAddedName(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
