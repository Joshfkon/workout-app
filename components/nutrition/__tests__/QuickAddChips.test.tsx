/**
 * Eat's recent-food chips: the row says what it is and where a tap goes, and
 * a tap confirms on the chip itself ("Added to Dinner") — still one tap.
 */

import { act, render, screen, fireEvent } from '@testing-library/react';
import { QuickAddChips, QUICK_ADD_CONFIRM_MS } from '../QuickAddChips';
import type { FrequentFood, MealType } from '@/types/nutrition';

const yogurt: FrequentFood = {
  user_id: 'u1',
  meal_type: 'snack',
  food_name: 'Greek yogurt',
  serving_size: '170 g',
  avg_calories: 100,
  avg_protein: 17,
  avg_carbs: 6,
  avg_fat: 0,
  times_logged: 4,
  last_logged: '2026-11-20T10:00:00Z',
  latest: {
    serving_size: '170 g',
    servings: 1,
    calories: 100,
    protein: 17,
    carbs: 6,
    fat: 0,
    source: null,
    food_id: null,
  },
} as FrequentFood;

const meals: Array<{ type: MealType; label: string }> = [
  { type: 'breakfast', label: 'Breakfast' },
  { type: 'dinner', label: 'Dinner' },
];

function renderChips(onAdd = jest.fn().mockResolvedValue(undefined)) {
  render(
    <QuickAddChips
      foods={[yogurt]}
      mealType="dinner"
      mealLabel="Dinner"
      meals={meals}
      onMealChange={jest.fn()}
      onAdd={onAdd}
    />
  );
  return onAdd;
}

describe('QuickAddChips', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('labels the row as the foods you log most and names the meal a tap adds to', () => {
    renderChips();
    expect(screen.getByText('Foods you log most — tap to add to')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /foods you log most — tap to add to/i })).toHaveValue('dinner');
    expect(screen.getByRole('button', { name: 'Log Greek yogurt, 170 g, to Dinner' })).toBeInTheDocument();
  });

  it('one tap adds, then the chip reads "Added to Dinner" for a moment', async () => {
    const onAdd = renderChips();
    await act(async () => {
      fireEvent.click(screen.getByTestId('quick-add-chip'));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(yogurt);
    expect(screen.getByTestId('quick-add-chip-added')).toHaveTextContent('Added to Dinner');
    expect(screen.getByTestId('quick-add-chip')).toHaveAttribute('data-added', 'true');

    act(() => {
      jest.advanceTimersByTime(QUICK_ADD_CONFIRM_MS);
    });
    expect(screen.queryByTestId('quick-add-chip-added')).not.toBeInTheDocument();
    expect(screen.getByText('Greek yogurt')).toBeInTheDocument();
  });

  it('a failed save shows no "Added"', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    renderChips(jest.fn().mockRejectedValue(new Error('offline')));
    await act(async () => {
      fireEvent.click(screen.getByTestId('quick-add-chip'));
    });
    expect(screen.queryByTestId('quick-add-chip-added')).not.toBeInTheDocument();
    error.mockRestore();
  });

  it('renders nothing with no recent foods', () => {
    const { container } = render(
      <QuickAddChips foods={[]} mealType="dinner" mealLabel="Dinner" meals={meals} onMealChange={jest.fn()} onAdd={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
