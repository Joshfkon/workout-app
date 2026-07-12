/**
 * @jest-environment jsdom
 *
 * Recents + Grab-from-prior-meal in the add-food sheet:
 *   - Recent is the default view, deduped, with last-logged date labels.
 *   - Quick-add (+) re-logs the snapshot into the selected meal WITHOUT closing.
 *   - Tapping a recent's body opens the shared detail/serving editor.
 *   - Meals view groups prior meals; a food's + and "Add all" copy into today.
 */

import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFoodModal } from '../AddFoodModal';
import type { FoodLogEntry } from '@/types/nutrition';

jest.mock('@/lib/actions/food-search', () => ({
  searchFoodsAction: jest.fn().mockResolvedValue({ foods: [] }),
  getFoodDetailsAction: jest.fn().mockResolvedValue({ food: null }),
}));
jest.mock('@/services/openFoodFactsService', () => ({
  lookupBarcode: jest.fn().mockResolvedValue({ found: false }),
}));
jest.mock('../BarcodeScanner', () => ({ BarcodeScanner: () => null }));

// Pin "now" to a stable local day so date labels are deterministic.
const NOW = new Date(2026, 6, 12, 10, 0, 0); // Jul 12 2026, local
beforeAll(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

const d = (offset: number) => {
  const dt = new Date(NOW);
  dt.setDate(dt.getDate() + offset);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const TODAY = d(0);
const YESTERDAY = d(-1);

function entry(o: Partial<FoodLogEntry> & { id: string; logged_at: string }): FoodLogEntry {
  return {
    user_id: 'u1', meal_type: 'breakfast', food_name: 'Oats', serving_size: '1 cup',
    servings: 1, calories: 300, protein: 10, carbs: 54, fat: 5, source: 'manual',
    food_id: null, nutritionix_id: null, created_at: `${o.logged_at}T08:00:00Z`, ...o,
  } as FoodLogEntry;
}

const RECENT_ENTRIES: FoodLogEntry[] = [
  // Chicken logged twice — must dedupe to one row (most recent = yesterday, 2 servings).
  entry({ id: 'c-old', logged_at: d(-3), food_name: 'Chicken', meal_type: 'lunch', servings: 1, calories: 200 }),
  entry({ id: 'c-new', logged_at: YESTERDAY, food_name: 'Chicken', meal_type: 'lunch', servings: 2, serving_size: '200g', calories: 400 }),
  entry({ id: 'oats-1', logged_at: TODAY, food_name: 'Oats', meal_type: 'breakfast', calories: 300 }),
  entry({ id: 'salmon-1', logged_at: YESTERDAY, food_name: 'Salmon', meal_type: 'dinner', calories: 280 }),
];

function setup(extra: Partial<React.ComponentProps<typeof AddFoodModal>> = {}) {
  const onAdd = jest.fn().mockResolvedValue(undefined);
  const onQuickAdd = jest.fn().mockResolvedValue(undefined);
  const onQuickAddMany = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  render(
    <AddFoodModal
      isOpen
      onClose={onClose}
      onAdd={onAdd}
      defaultMealType="dinner"
      recentEntries={RECENT_ENTRIES}
      selectedDay={TODAY}
      onQuickAdd={onQuickAdd}
      onQuickAddMany={onQuickAddMany}
      {...extra}
    />
  );
  return { onAdd, onQuickAdd, onQuickAddMany, onClose };
}

describe('Recent view', () => {
  it('is the default view with deduped rows and last-logged date labels', () => {
    setup();
    const list = screen.getByTestId('recent-foods-list');
    // Chicken appears once (deduped) despite two logs.
    expect(within(list).getAllByText('Chicken')).toHaveLength(1);
    expect(within(list).getByText('Oats')).toBeInTheDocument();
    expect(within(list).getByText('Salmon')).toBeInTheDocument();
    // Oats logged today, Chicken/Salmon most-recently yesterday.
    expect(within(list).getByText(/Today/)).toBeInTheDocument();
    expect(within(list).getAllByText(/Yesterday/).length).toBeGreaterThan(0);
  });

  it('quick-add (+) re-logs the most-recent snapshot into the selected meal, sheet stays open', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { onQuickAdd, onClose } = setup();
    const list = screen.getByTestId('recent-foods-list');
    const chickenRow = within(list).getByText('Chicken').closest('[data-testid="recent-food-row"]')!;
    await user.click(within(chickenRow as HTMLElement).getByRole('button', { name: /quick-add chicken/i }));

    await waitFor(() => expect(onQuickAdd).toHaveBeenCalledTimes(1));
    expect(onQuickAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        food_name: 'Chicken',
        serving_size: '200g', // most-recent serving
        servings: 2,
        calories: 400,
        meal_type: 'dinner', // the selected meal, not the original 'lunch'
      })
    );
    expect(onClose).not.toHaveBeenCalled(); // stays open for more grabs
  });

  it('tapping a recent row body opens the shared serving editor', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    setup();
    const list = screen.getByTestId('recent-foods-list');
    await user.click(within(list).getByText('Salmon'));
    // Detail panel with the shared amount editor appears.
    expect(screen.getByTestId('add-food-detail')).toBeInTheDocument();
    expect(screen.getByTestId('add-food-amount')).toBeInTheDocument();
  });

  it('shows an empty state (not a blank pane) for a user with no history', () => {
    setup({ recentEntries: [] });
    expect(screen.getByTestId('recent-foods-empty')).toBeInTheDocument();
  });
});

describe('Meals view', () => {
  it('groups prior meals, expands to show foods, and quick-adds one item', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { onQuickAdd } = setup();
    await user.click(screen.getByTestId('add-food-view-meals'));

    const mealsList = screen.getByTestId('prior-meals-list');
    // Today's meals are excluded (selectedDay=TODAY); yesterday's lunch+dinner remain.
    expect(within(mealsList).getByText(/Yesterday · Lunch/)).toBeInTheDocument();
    expect(within(mealsList).queryByText('Oats')).not.toBeInTheDocument();

    // Expand yesterday's dinner and add Salmon.
    await user.click(within(mealsList).getByText(/Yesterday · Dinner/));
    const salmonItem = within(mealsList).getByText('Salmon').closest('[data-testid="prior-meal-food"]')!;
    await user.click(within(salmonItem as HTMLElement).getByRole('button', { name: /add salmon/i }));
    await waitFor(() => expect(onQuickAdd).toHaveBeenCalledTimes(1));
    expect(onQuickAdd).toHaveBeenCalledWith(
      expect.objectContaining({ food_name: 'Salmon', meal_type: 'dinner' })
    );
  });

  it('"Add all" copies every item of a prior meal', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { onQuickAddMany } = setup();
    await user.click(screen.getByTestId('add-food-view-meals'));
    const mealsList = screen.getByTestId('prior-meals-list');
    const lunch = within(mealsList).getByText(/Yesterday · Lunch/).closest('[data-testid="prior-meal"]')!;
    await user.click(within(lunch as HTMLElement).getByTestId('prior-meal-add-all'));

    await waitFor(() => expect(onQuickAddMany).toHaveBeenCalledTimes(1));
    const foods = onQuickAddMany.mock.calls[0][0];
    expect(foods).toHaveLength(1); // yesterday lunch has one item (Chicken)
    expect(foods[0]).toEqual(expect.objectContaining({ food_name: 'Chicken', meal_type: 'dinner' }));
  });
});
