/**
 * @jest-environment jsdom
 *
 * Editable-serving-at-add-time: the add sheet and edit sheet share one
 * AMOUNT + UNIT control (ServingAmountEditor). These cover the feature's
 * acceptance tests that exercise the real components:
 *   - weight food: 100g → 150g re-previews to 117 cal and logs "150g" + scaled macros
 *   - last-used amount prefills on the next add of the same food
 *   - the add sheet and edit sheet render identical controls
 * (The packaged-food / gram-equivalence math is covered in
 *  lib/nutrition/__tests__/servingScaling.test.ts.)
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFoodModal } from '../AddFoodModal';
import { EditFoodModal } from '../EditFoodModal';
import type { SystemFood, FoodLogEntry } from '@/types/nutrition';

// The add sheet imports server actions / camera scanner — stub them so the
// jsdom render never reaches server-only or html5-qrcode code.
jest.mock('@/lib/actions/food-search', () => ({
  searchFoodsAction: jest.fn().mockResolvedValue({ foods: [] }),
  getFoodDetailsAction: jest.fn().mockResolvedValue({ food: null }),
}));
jest.mock('@/services/openFoodFactsService', () => ({
  lookupBarcode: jest.fn().mockResolvedValue({ found: false }),
}));
jest.mock('../BarcodeScanner', () => ({
  BarcodeScanner: () => null,
}));

const PEAS: SystemFood = {
  id: 'peas-id',
  name: 'Peas',
  category: 'vegetables',
  subcategory: null,
  calories_per_100g: 78,
  protein_per_100g: 5.4,
  carbs_per_100g: 14,
  fat_per_100g: 0.4,
};

function renderAdd(onAdd = jest.fn().mockResolvedValue(undefined)) {
  render(
    <AddFoodModal
      isOpen
      onClose={jest.fn()}
      onAdd={onAdd}
      defaultMealType="lunch"
      systemFoods={[PEAS]}
    />
  );
  return onAdd;
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
});

describe('weight food — editable amount at add time', () => {
  it('re-previews 100g → 150g as 117 cal and logs "150g" with scaled macros', async () => {
    const user = userEvent.setup();
    const onAdd = renderAdd();

    await user.click(screen.getByText('Peas'));

    // Defaults to the food's 100g serving = 78 cal
    expect(screen.getByTestId('add-food-preview-calories')).toHaveTextContent('78');

    const amount = screen.getByTestId('add-food-amount');
    await user.clear(amount);
    await user.type(amount, '150');

    expect(screen.getByTestId('add-food-preview-calories')).toHaveTextContent('117');

    await user.click(screen.getByRole('button', { name: /add to log/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        food_name: 'Peas',
        serving_size: '150g',
        calories: 117,
        protein: 8.1,
        carbs: 21,
        fat: 0.6,
        meal_type: 'lunch',
      })
    );
  });

  it('lets you tap a quick-amount chip instead of typing', async () => {
    const user = userEvent.setup();
    const onAdd = renderAdd();
    await user.click(screen.getByText('Peas'));

    const chips = screen.getByTestId('add-food-chips');
    await user.click(within(chips).getByRole('button', { name: '200g' }));

    expect(screen.getByTestId('add-food-preview-calories')).toHaveTextContent('156');
  });
});

describe('last-used amount prefills the next add of the same food', () => {
  it('remembers 150g and prefills it on re-selection', async () => {
    const user = userEvent.setup();
    const onAdd = renderAdd();

    await user.click(screen.getByText('Peas'));
    const amount = screen.getByTestId('add-food-amount');
    await user.clear(amount);
    await user.type(amount, '150');
    await user.click(screen.getByRole('button', { name: /add to log/i }));

    // Back on the list; pick the same food again — it should prefill 150.
    await user.click(screen.getByText('Peas'));
    expect(screen.getByTestId('add-food-amount')).toHaveValue(150);

    // ...and the last-used amount now appears as a quick-chip.
    const chips = screen.getByTestId('add-food-chips');
    expect(within(chips).getByRole('button', { name: '150g' })).toBeInTheDocument();
  });
});

describe('add sheet and edit sheet render identical controls', () => {
  const CONTROL_TESTIDS = ['amount', 'unit', 'chips'];

  it('both surfaces expose the same AMOUNT + UNIT control', async () => {
    const user = userEvent.setup();

    // Add sheet
    const { unmount } = render(
      <AddFoodModal
        isOpen
        onClose={jest.fn()}
        onAdd={jest.fn()}
        defaultMealType="lunch"
        systemFoods={[PEAS]}
      />
    );
    await user.click(screen.getByText('Peas'));
    for (const id of CONTROL_TESTIDS) {
      expect(screen.getByTestId(`add-food-${id}`)).toBeInTheDocument();
    }
    unmount();

    // Edit sheet, fed a logged weight entry
    const entry: FoodLogEntry = {
      id: 'log-1',
      user_id: 'u1',
      logged_at: '2026-07-12',
      meal_type: 'lunch',
      food_name: 'Peas',
      serving_size: '150g',
      servings: 1,
      calories: 117,
      protein: 8.1,
      carbs: 21,
      fat: 0.6,
      source: 'manual',
      food_id: null,
      nutritionix_id: null,
      created_at: '2026-07-12T00:00:00Z',
    };
    render(
      <EditFoodModal
        isOpen
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
        onDelete={jest.fn()}
        entry={entry}
      />
    );
    for (const id of CONTROL_TESTIDS) {
      expect(screen.getByTestId(`edit-food-${id}`)).toBeInTheDocument();
    }
  });

  it('edit sheet scales a logged weight entry when the amount changes', async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const entry: FoodLogEntry = {
      id: 'log-1',
      user_id: 'u1',
      logged_at: '2026-07-12',
      meal_type: 'lunch',
      food_name: 'Peas',
      serving_size: '150g',
      servings: 1,
      calories: 117,
      protein: 8.1,
      carbs: 21,
      fat: 0.6,
      source: 'manual',
      food_id: null,
      nutritionix_id: null,
      created_at: '2026-07-12T00:00:00Z',
    };
    render(
      <EditFoodModal
        isOpen
        onClose={jest.fn()}
        onSave={onSave}
        onDelete={jest.fn()}
        entry={entry}
      />
    );

    // Entry logged as 1 serving of 150g → switch unit to grams and set 300g.
    await user.selectOptions(screen.getByTestId('edit-food-unit'), 'g');
    const amount = screen.getByTestId('edit-food-amount');
    await user.clear(amount);
    await user.type(amount, '300');

    expect(screen.getByTestId('edit-food-calories')).toHaveTextContent('234');

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ calories: 234 })
    );
  });
});
