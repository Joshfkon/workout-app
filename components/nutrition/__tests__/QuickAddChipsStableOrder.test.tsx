/**
 * r22 panel (6 of 6): "I meant to tap rice, but the chips reshuffled and the
 * oatmeal chip sat where I tapped." The Eat page re-ranked the chips by count
 * after every add, so the chip just tapped jumped to the front and the rest
 * slid right under the finger. The order is now frozen for the visit.
 *
 * This drives the chips the way the Eat page does: the parent re-ranks with
 * rankQuickAddFoods and folds each add in with addLoggedRowsToFrequentFoods
 * (the production functions), and the user taps by POSITION, the way a thumb
 * does, at the places the chips were when the page opened.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { QuickAddChips } from '../QuickAddChips';
import {
  addLoggedRowsToFrequentFoods,
  buildFrequentFoods,
  rankQuickAddFoods,
  stableChipOrder,
  type FrequentFoodRow,
} from '@/lib/nutrition/frequentFoods';
import type { FrequentFood, MealType } from '@/types/nutrition';

const NOW = '2026-11-24T12:00:00.000Z';

function rows(name: string, times: number, serving: string, calories: number): FrequentFoodRow[] {
  return Array.from({ length: times }, () => ({
    meal_type: 'lunch',
    food_name: name,
    serving_size: serving,
    calories,
    protein: 5,
    carbs: 20,
    fat: 2,
    servings: 1,
  }));
}

// Greek yogurt (5×) > Oatmeal (4×) > White rice (3×) > Banana (2×)
const history: FrequentFoodRow[] = [
  ...rows('Greek yogurt', 5, '170 g', 100),
  ...rows('Oatmeal with banana', 4, '1 bowl', 310),
  ...rows('White rice', 3, '1 cup', 205),
  ...rows('Banana', 2, '1 medium', 105),
];

const meals: Array<{ type: MealType; label: string }> = [{ type: 'lunch', label: 'Lunch' }];

function EatPageChips({ logged }: { logged: string[] }) {
  const [frequent, setFrequent] = useState<FrequentFood[]>(() => buildFrequentFoods(history, 'u1', NOW));
  return (
    <QuickAddChips
      foods={rankQuickAddFoods(frequent)}
      mealType="lunch"
      mealLabel="Lunch"
      meals={meals}
      onMealChange={() => {}}
      onAdd={async (food) => {
        logged.push(food.food_name);
        const latest = food.latest!;
        // Each add bumps that food's count — what used to re-sort the row.
        setFrequent((prev) =>
          addLoggedRowsToFrequentFoods(
            prev,
            [{ ...latest, meal_type: 'lunch', food_name: food.food_name, user_id: 'u1' }],
            NOW
          )
        );
      }}
    />
  );
}

const chipNames = () => screen.getAllByTestId('quick-add-chip').map((c) => c.getAttribute('data-food'));

describe('Quick-add chips keep their order within a visit', () => {
  it('tapping two chips in a row adds the two intended foods', async () => {
    const logged: string[] = [];
    render(<EatPageChips logged={logged} />);
    const before = chipNames();
    expect(before).toEqual(['Greek yogurt', 'Oatmeal with banana', 'White rice', 'Banana']);

    // Tap rice (3rd), then banana (4th), by position as first seen.
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('quick-add-chip')[2]);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('quick-add-chip')[3]);
    });
    // Rice again would now out-rank Oatmeal by count (5 vs 4) — still tap the 2nd.
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('quick-add-chip')[2]);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('quick-add-chip')[1]);
    });

    expect(logged).toEqual(['White rice', 'Banana', 'White rice', 'Oatmeal with banana']);
    expect(chipNames()).toEqual(before);
  });

  it('shows the portion and calories on each chip', () => {
    render(<EatPageChips logged={[]} />);
    const rice = screen.getAllByTestId('quick-add-chip')[2];
    expect(rice).toHaveTextContent('White rice');
    expect(rice).toHaveTextContent('1 cup · 205 kcal');
  });
});

describe('stableChipOrder', () => {
  const food = (name: string) => ({ food_name: name }) as FrequentFood;

  it('takes the first ranking as is, up to the limit', () => {
    expect(stableChipOrder(null, [food('a'), food('b'), food('c')], 2)).toEqual(['a', 'b']);
  });

  it('never moves a frozen chip; new foods join at the end while there is room', () => {
    expect(stableChipOrder(['a', 'b'], [food('c'), food('b'), food('a')], 3)).toEqual(['a', 'b', 'c']);
    expect(stableChipOrder(['a', 'b', 'c'], [food('d'), food('c')], 3)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a frozen chip that left the ranking, so nothing slides left', () => {
    expect(stableChipOrder(['a', 'b', 'c'], [food('a'), food('c')], 10)).toEqual(['a', 'b', 'c']);
  });
});
