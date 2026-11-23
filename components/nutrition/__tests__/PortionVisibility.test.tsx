/**
 * @jest-environment jsdom
 *
 * The add sheet always shows WHAT a tap will log before it's tapped:
 *   - Recent / Your foods rows show the portion and the meal + adds to.
 *   - A frequent food's + logs its last portion as shown; its body opens the
 *     amount editor on that portion.
 *   - Common foods say what their numbers are per ("1 large egg", "100 g"),
 *     and a food with no standard serving says so in the editor.
 */

import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFoodModal } from '../AddFoodModal';
import type { FoodLogEntry, FrequentFood, SystemFood } from '@/types/nutrition';
import { buildFrequentFoods } from '@/lib/nutrition/frequentFoods';

jest.mock('@/lib/actions/food-search', () => ({
  searchFoodsAction: jest.fn().mockResolvedValue({ foods: [] }),
  getFoodDetailsAction: jest.fn().mockResolvedValue({ food: null }),
}));
jest.mock('@/services/openFoodFactsService', () => ({
  lookupBarcode: jest.fn().mockResolvedValue({ found: false }),
}));
jest.mock('../BarcodeScanner', () => ({ BarcodeScanner: () => null }));

const EGGS: SystemFood = {
  id: 'eggs', name: 'Whole Eggs (large, cooked)', category: 'protein', subcategory: null,
  calories_per_100g: 155, protein_per_100g: 13, carbs_per_100g: 1.1, fat_per_100g: 11,
};
const PEAS: SystemFood = {
  id: 'peas', name: 'Peas', category: 'vegetables', subcategory: null,
  calories_per_100g: 78, protein_per_100g: 5.4, carbs_per_100g: 14, fat_per_100g: 0.4,
};

const OATS: FoodLogEntry = {
  id: 'o1', user_id: 'u1', logged_at: '2026-07-11', meal_type: 'breakfast', food_name: 'Oatmeal',
  serving_size: '1 cup (80g)', servings: 1, calories: 300, protein: 10, carbs: 54, fat: 5,
  source: 'manual', food_id: null, nutritionix_id: null, created_at: '2026-07-11T08:00:00Z',
};

// Newest first: last time it was 2 servings.
const FREQUENT: FrequentFood[] = buildFrequentFoods(
  [
    { meal_type: 'dinner', food_name: 'Rice', serving_size: '2 serving (300g)', servings: 2, calories: 390, protein: 8, carbs: 86, fat: 1, source: 'usda', food_id: 'r1' },
    { meal_type: 'dinner', food_name: 'Rice', serving_size: '1 serving (150g)', servings: 1, calories: 195, protein: 4, carbs: 43, fat: 0.5, source: 'usda', food_id: 'r1' },
  ],
  'u1',
  '2026-07-12T10:00:00Z'
);

function setup(extra: Partial<React.ComponentProps<typeof AddFoodModal>> = {}) {
  const onAdd = jest.fn().mockResolvedValue(undefined);
  const onQuickAdd = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  render(
    <AddFoodModal
      isOpen
      onClose={onClose}
      onAdd={onAdd}
      defaultMealType="dinner"
      recentEntries={[OATS]}
      frequentFoods={FREQUENT}
      systemFoods={[EGGS, PEAS]}
      onQuickAdd={onQuickAdd}
      {...extra}
    />
  );
  return { onAdd, onQuickAdd, onClose };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('quick-add rows show what they log', () => {
  it('recent rows show the portion and which meal + adds to', () => {
    setup();
    const list = screen.getByTestId('recent-foods-list');
    expect(within(list).getAllByTestId('quick-add-target')[0]).toHaveTextContent('+ adds to Dinner');
    const row = within(list).getByTestId('recent-food-row');
    expect(row).toHaveTextContent('1 cup · 80 g · 300 cal');
    expect(
      within(row).getByRole('button', { name: 'Quick-add Oatmeal, 1 cup · 80 g, to Dinner' })
    ).toBeInTheDocument();
  });

  it('the meal named follows the meal picker', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('radio', { name: 'Lunch' }));
    expect(within(screen.getByTestId('recent-foods-list')).getAllByTestId('quick-add-target')[0])
      .toHaveTextContent('+ adds to Lunch');
  });

  it("a frequent food's + logs its last portion as shown, sheet stays open", async () => {
    const user = userEvent.setup();
    const { onQuickAdd, onAdd, onClose } = setup();
    const row = screen.getByTestId('frequent-food-row');
    expect(row).toHaveTextContent('2 servings · 300 g · 390 cal');

    await user.click(within(row).getByRole('button', { name: /quick-add rice, 2 servings · 300 g, to dinner/i }));
    await waitFor(() => expect(onQuickAdd).toHaveBeenCalledTimes(1));
    expect(onQuickAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        food_name: 'Rice', serving_size: '2 serving (300g)', servings: 2, calories: 390,
        meal_type: 'dinner', source: 'usda', food_id: 'r1',
      })
    );
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tapping a frequent food's name opens the amount editor on that portion", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    await user.click(within(screen.getByTestId('frequent-food-row')).getByText('Rice'));
    expect(screen.getByTestId('add-food-amount')).toHaveValue(2);

    const amount = screen.getByTestId('add-food-amount');
    await user.clear(amount);
    await user.type(amount, '1');
    await user.click(screen.getByRole('button', { name: 'Add to Dinner' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ food_name: 'Rice', servings: 1, calories: 195, meal_type: 'dinner' })
    );
  });
});

describe('common foods say what their numbers are per', () => {
  it('uses the household serving when there is one, else "100 g"', () => {
    setup();
    const rows = screen.getAllByTestId('system-food-row');
    const egg = rows.find((r) => r.textContent?.includes('Whole Eggs'))!;
    const peas = rows.find((r) => r.textContent?.includes('Peas'))!;
    // 1 large egg = 50 g of a 155 cal/100 g row.
    expect(egg).toHaveTextContent('per 1 large egg');
    expect(egg).toHaveTextContent('78 cal');
    expect(peas).toHaveTextContent('per 100 g');
    expect(peas).toHaveTextContent('78 cal');
  });

  it('flags a food with no standard serving in the editor, not one with a household unit', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText('Peas'));
    // Opens on a typical portion, which says so (panel r19); once the amount
    // is the user's own, the editor says there is no standard serving.
    expect(screen.getByTestId('add-food-portion-source')).toHaveTextContent('85 g · about 3 oz, a typical portion');
    expect(screen.queryByTestId('add-food-no-serving')).not.toBeInTheDocument();
    const amount = screen.getByTestId('add-food-amount');
    await user.clear(amount);
    await user.type(amount, '60');
    expect(screen.queryByTestId('add-food-portion-source')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-food-no-serving')).toHaveTextContent('No standard serving');
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    await user.click(screen.getByText('Whole Eggs (large, cooked)'));
    expect(screen.queryByTestId('add-food-no-serving')).not.toBeInTheDocument();
  });
});
