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

  it('offers everyday units alongside grams, and one tap switches to one (panel r19)', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderAdd({ units: 'lb' });
    await user.click(screen.getByText(CHICKEN.name));
    const line = screen.getByTestId('add-food-equivalents');
    expect(line).toHaveTextContent('Same as4 oz·1 palm-size portion');
    // The everyday measure is in the unit picker too, but not the default.
    expect(screen.getByTestId('add-food-unit')).toHaveValue('g');
    expect(screen.getByRole('option', { name: 'palm-size portion (113 g)' })).toBeInTheDocument();
    // The food still has no standard serving of its own.
    await user.click(screen.getByRole('button', { name: 'Switch to 1 palm-size portion' }));
    expect(screen.getByTestId('add-food-unit')).toHaveValue('everyday');
    expect(screen.getByTestId('add-food-amount')).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'Add to Dinner' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ serving_size: '1 palm-size portion (113g)', calories: 186 })
    );
  });

  it('leaves ounces out of the equivalents for a metric user', async () => {
    const user = userEvent.setup();
    renderAdd({ units: 'kg' });
    await user.click(screen.getByText(CHICKEN.name));
    const line = screen.getByTestId('add-food-equivalents');
    expect(line).toHaveTextContent('1 palm-size portion');
    expect(line).not.toHaveTextContent('oz');
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

  it('says where the starting amount came from, in the user\'s units, with its kcal/protein (panel r19)', async () => {
    const user = userEvent.setup();
    const first = renderAdd({ units: 'lb' });
    await user.click(screen.getByText(CHICKEN.name));
    expect(screen.getByTestId('add-food-portion-source')).toHaveTextContent(
      'Starting amount: 113 g · about 4 oz, a typical cooked portion, about the size of your palm · 186 kcal, 35 g protein'
    );
    // Once the user changes it, it's their amount: no source line.
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByTestId('add-food-portion-source')).not.toBeInTheDocument();
    first.unmount();

    renderAdd({ units: 'kg' });
    await user.click(screen.getByText(CHICKEN.name));
    const metric = screen.getByTestId('add-food-portion-source');
    expect(metric).toHaveTextContent('113 g · a typical cooked portion, about the size of your palm');
    expect(metric).not.toHaveTextContent('oz');
  });

  it('says "what you logged last time" when the amount is remembered', async () => {
    const user = userEvent.setup();
    const first = renderAdd();
    await user.click(screen.getByText(CHICKEN.name));
    const amount = screen.getByTestId('add-food-amount');
    await user.clear(amount);
    await user.type(amount, '150');
    await user.click(screen.getByRole('button', { name: 'Add to Dinner' }));
    first.unmount();

    renderAdd();
    await user.click(screen.getByText(CHICKEN.name));
    expect(screen.getByTestId('add-food-portion-source')).toHaveTextContent(
      '150 g · what you logged last time · 248 kcal, 47 g protein'
    );
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
  const realMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  afterEach(() => {
    if (realMediaDevices) Object.defineProperty(navigator, 'mediaDevices', realMediaDevices);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it('a labelled Scan barcode button beside the search box opens the barcode scanner', async () => {
    const user = userEvent.setup();
    renderAdd();
    await user.click(screen.getByRole('button', { name: 'Scan barcode' }));
    expect(await screen.findByTestId('fake-barcode-scanner')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Scan/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('says up front, before the tap, when there is no camera', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve([{ kind: 'audioinput' }]) },
    });
    renderAdd();
    expect(await screen.findByTestId('search-scan-no-camera')).toHaveTextContent(/type the number/);
  });

  it('says nothing extra when a camera is there', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve([{ kind: 'videoinput' }]) },
    });
    renderAdd();
    await screen.findByRole('button', { name: 'Scan barcode' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('search-scan-no-camera')).not.toBeInTheDocument();
  });
});
