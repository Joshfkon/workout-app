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
      expect.objectContaining({ calories: 234, servingSize: '300g' })
    );
  });
});

describe('edit corruption regression (Giant Eagle fries)', () => {
  // 140 cal / P3 / C21 / F5 per 1 serving (85 g)
  const friesEntry: FoodLogEntry = {
    id: 'log-fries',
    user_id: 'u1',
    logged_at: '2026-07-12',
    meal_type: 'breakfast',
    food_name: 'Giant Eagle French Fried Potatoes',
    serving_size: '1 serving (85g)',
    servings: 1,
    calories: 140,
    protein: 3,
    carbs: 21,
    fat: 5,
    source: 'nutritionix',
    food_id: null,
    nutritionix_id: null,
    created_at: '2026-07-12T00:00:00Z',
  };

  function renderEdit(entry: FoodLogEntry, onSave = jest.fn().mockResolvedValue(undefined)) {
    render(
      <EditFoodModal
        isOpen
        onClose={jest.fn()}
        onSave={onSave}
        onDelete={jest.fn()}
        entry={entry}
      />
    );
    return onSave;
  }

  it('mistaken "180 servings" save persists serving_size and never mutates the food record', async () => {
    const user = userEvent.setup();
    const onSave = renderEdit(friesEntry);

    expect(screen.getByTestId('edit-food-per-serving')).toHaveTextContent('Per serving: 140 cal');

    const amount = screen.getByTestId('edit-food-amount');
    await user.clear(amount);
    await user.type(amount, '180'); // unit still "serving" — the user's mistake

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [, updates] = onSave.mock.calls[0];
    expect(updates).toMatchObject({
      servings: 180,
      servingSize: '180 serving (15300g)',
      calories: 25200,
    });
    // The food record (per-serving nutrition) must NOT be rewritten by an
    // amount-only edit — only the pencil "edit nutrition" path may do that.
    expect(updates).not.toHaveProperty('perServing');
  });

  it('reopening the mistaken entry still shows 140 cal / 85 g per serving (no corruption)', () => {
    // The entry as it would be persisted after the 180-servings save above.
    const savedEntry: FoodLogEntry = {
      ...friesEntry,
      servings: 180,
      serving_size: '180 serving (15300g)',
      calories: 25200,
      protein: 540,
      carbs: 3780,
      fat: 900,
    };
    renderEdit(savedEntry);
    expect(screen.getByTestId('edit-food-per-serving')).toHaveTextContent('Per serving: 140 cal');
    // Reopens in servings, showing "180", not a fraction.
    expect(screen.getByTestId('edit-food-amount')).toHaveValue(180);
  });

  it('grams path against a clean record computes ~296 cal for 180 g', async () => {
    const user = userEvent.setup();
    const onSave = renderEdit(friesEntry);

    await user.selectOptions(screen.getByTestId('edit-food-unit'), 'g');
    const amount = screen.getByTestId('edit-food-amount');
    await user.clear(amount);
    await user.type(amount, '180');

    // 180 / 85 × 140 ≈ 296
    expect(screen.getByTestId('edit-food-calories')).toHaveTextContent('296');

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    const [, updates] = onSave.mock.calls[0];
    expect(updates).toMatchObject({ servingSize: '180g', calories: 296 });
    expect(updates).not.toHaveProperty('perServing');
  });

  it('a grams entry reopens displaying grams, not a serving fraction', () => {
    const gramsEntry: FoodLogEntry = {
      ...friesEntry,
      servings: 180 / 85,
      serving_size: '180g',
      calories: 296,
      protein: 6.4,
      carbs: 44.5,
      fat: 10.6,
    };
    renderEdit(gramsEntry);
    expect(screen.getByTestId('edit-food-amount')).toHaveValue(180);
    // Grams unit selected → serving hint is not shown for the weight unit.
    expect(screen.queryByTestId('edit-food-serving-hint')).not.toBeInTheDocument();
    // Per-serving reference recovered cleanly.
    expect(screen.getByTestId('edit-food-per-serving')).toHaveTextContent('Per serving: 140 cal');
  });
});
