/**
 * @jest-environment jsdom
 *
 * Panel round 18 (Eat):
 *   - the portion is set BEFORE adding: a sensible default (not 100 g), a
 *     − / + stepper, and the last portion remembered for that food;
 *   - the meal a food goes into is said in words and changeable;
 *   - Scan is reachable from the search bar.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFoodModal } from '../AddFoodModal';
import type { FoodLogEntry, SystemFood } from '@/types/nutrition';

jest.mock('@/lib/actions/food-search', () => ({
  searchFoodsAction: jest.fn().mockResolvedValue({ foods: [] }),
  getFoodDetailsAction: jest.fn().mockResolvedValue({ food: null }),
}));
jest.mock('@/services/openFoodFactsService', () => ({
  lookupBarcode: jest.fn().mockResolvedValue({ found: false }),
}));
jest.mock('../BarcodeScanner', () => ({
  BarcodeScanner: () => <div data-testid="fake-barcode-scanner" />,
}));

const CHICKEN: SystemFood = {
  id: 'chicken-id',
  name: 'Chicken Breast (grilled, skinless)',
  category: 'protein',
  subcategory: 'poultry',
  calories_per_100g: 165,
  protein_per_100g: 31,
  carbs_per_100g: 0,
  fat_per_100g: 3.6,
};

function renderAdd(extra: Partial<React.ComponentProps<typeof AddFoodModal>> = {}) {
  const onAdd = jest.fn().mockResolvedValue(undefined);
  const onMealTypeChange = jest.fn();
  const utils = render(
    <AddFoodModal
      isOpen
      onClose={jest.fn()}
      onAdd={onAdd}
      defaultMealType="dinner"
      onMealTypeChange={onMealTypeChange}
      systemFoods={[CHICKEN]}
      {...extra}
    />
  );
  return { onAdd, onMealTypeChange, ...utils };
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
});

describe('portion before adding', () => {
  it('opens a weighed food on a typical portion (113 g), not 100 g', async () => {
    const user = userEvent.setup();
    renderAdd();
    await user.click(screen.getByText(CHICKEN.name));
    expect(screen.getByTestId('add-food-amount')).toHaveValue(113);
    expect(screen.getByTestId('add-food-unit')).toHaveValue('g');
    // 113 g × 1.65 kcal/g
    expect(screen.getByTestId('add-food-preview-calories')).toHaveTextContent('186');
  });

  it('the stepper changes the amount before adding, and that amount is logged', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderAdd();
    await user.click(screen.getByText(CHICKEN.name));
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByTestId('add-food-amount')).toHaveValue(130);
    await user.click(screen.getByRole('button', { name: 'Less' }));
    expect(screen.getByTestId('add-food-amount')).toHaveValue(120);

    await user.click(screen.getByRole('button', { name: 'Add to Dinner' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ food_name: CHICKEN.name, serving_size: '120g', calories: 198, meal_type: 'dinner' })
    );
  });

  it('remembers the last portion for the food, from search and from Recent', async () => {
    const user = userEvent.setup();
    const first = renderAdd();
    await user.click(screen.getByText(CHICKEN.name));
    const amount = screen.getByTestId('add-food-amount');
    await user.clear(amount);
    await user.type(amount, '200');
    await user.click(screen.getByRole('button', { name: 'Add to Dinner' }));
    first.unmount();

    // Search again: the same food opens on 200 g.
    const second = renderAdd();
    await user.click(screen.getByText(CHICKEN.name));
    expect(screen.getByTestId('add-food-amount')).toHaveValue(200);
    second.unmount();

    // The logged row (no system id, named the same) reopens on 200 g too.
    const logged: FoodLogEntry = {
      id: 'row-1', user_id: 'u1', logged_at: '2026-11-22', meal_type: 'dinner', food_name: CHICKEN.name,
      serving_size: '150g', servings: 1, calories: 248, protein: 46.5, carbs: 0, fat: 5.4,
      source: 'manual', food_id: null, nutritionix_id: null, created_at: '2026-11-22T19:00:00Z',
    };
    renderAdd({ systemFoods: [], recentEntries: [logged] });
    await user.click(screen.getByText(CHICKEN.name));
    expect(screen.getByTestId('add-food-amount')).toHaveValue(200);
    expect(screen.getByTestId('add-food-unit')).toHaveValue('g');
  });

  it('says that tapping a food lets you choose the amount', () => {
    renderAdd();
    expect(screen.getByTestId('add-food-portion-hint')).toHaveTextContent(/choose how much before it's added/);
  });
});

describe('target meal', () => {
  it('says which meal the food goes into, and follows a change', async () => {
    const user = userEvent.setup();
    const { onAdd, onMealTypeChange } = renderAdd();
    expect(screen.getByTestId('add-food-target-meal')).toHaveTextContent('Adding to Dinner');

    await user.click(screen.getByRole('radio', { name: 'Lunch' }));
    expect(screen.getByTestId('add-food-target-meal')).toHaveTextContent('Adding to Lunch');
    expect(onMealTypeChange).toHaveBeenCalledWith('lunch');

    await user.click(screen.getByText(CHICKEN.name));
    await user.click(screen.getByRole('button', { name: 'Add to Lunch' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'lunch' }));
  });

  it("uses the user's own meal names", () => {
    renderAdd({ mealNames: { dinner: 'Post-workout' } });
    expect(screen.getByTestId('add-food-target-meal')).toHaveTextContent('Adding to Post-workout');
    expect(screen.getByRole('radio', { name: 'Post-workout' })).toBeInTheDocument();
  });
});

describe('scan from the search bar', () => {
  it('the scan icon in the search bar opens the barcode scanner', async () => {
    const user = userEvent.setup();
    renderAdd();
    await user.click(screen.getByRole('button', { name: 'Scan a barcode' }));
    expect(await screen.findByTestId('fake-barcode-scanner')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Scan/ })).toHaveAttribute('aria-selected', 'true');
  });
});
