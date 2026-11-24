/**
 * Eat's recent-food chips: the row says what it is, where a tap goes and
 * which portion it adds; a tap confirms under the row (what, how much, which
 * meal, the day's total) with Undo — still one tap, and no toast over the
 * meal cards.
 */

import { act, render, screen, fireEvent } from '@testing-library/react';
import { QuickAddChips, QUICK_ADD_CONFIRM_MS, QUICK_ADD_STATUS_MS, type QuickAddConfirmation } from '../QuickAddChips';
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

const confirmation = (onUndo = jest.fn()): QuickAddConfirmation => ({
  added: 'Added Greek yogurt (170 g) to Dinner',
  totals: 'Day total 283 / 1,872 kcal · 28 / 144 g protein',
  removed: 'Removed Greek yogurt (170 g) from Dinner',
  onUndo,
});

function renderChips(
  onAdd: jest.Mock = jest.fn().mockResolvedValue(undefined),
  opts: { mealIsTimeDefault?: boolean } = {}
) {
  render(
    <QuickAddChips
      foods={[yogurt]}
      mealType="dinner"
      mealLabel="Dinner"
      meals={meals}
      onMealChange={jest.fn()}
      onAdd={onAdd}
      mealIsTimeDefault={opts.mealIsTimeDefault}
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
    expect(screen.getByTestId('quick-add-chip-portion')).toHaveTextContent('170 g');
  });

  it('says a chip adds the amount you logged last time, and when the meal was picked by time of day', () => {
    renderChips(undefined, { mealIsTimeDefault: true });
    expect(screen.getByTestId('quick-add-explainer')).toHaveTextContent(
      'Each adds the amount you logged last time · Dinner picked for the time of day'
    );
  });

  it('drops the time-of-day note once the user picked the meal', () => {
    renderChips(undefined, { mealIsTimeDefault: false });
    expect(screen.getByTestId('quick-add-explainer')).toHaveTextContent('Each adds the amount you logged last time');
    expect(screen.getByTestId('quick-add-explainer')).not.toHaveTextContent('time of day');
  });

  it('one tap adds; the chip shows a check and the row says what was added with the day total', async () => {
    const onAdd = renderChips(jest.fn().mockResolvedValue(confirmation()));
    await act(async () => {
      fireEvent.click(screen.getByTestId('quick-add-chip'));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(yogurt);
    expect(screen.getByTestId('quick-add-chip')).toHaveAttribute('data-added', 'true');
    // The chip keeps its name (no width jump that scrolls it off screen) and
    // says "Added" in place of the portion while the check shows.
    expect(screen.getByText('Greek yogurt')).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-chip-added')).toHaveTextContent('Added');
    expect(screen.queryByTestId('quick-add-chip-portion')).not.toBeInTheDocument();
    expect(screen.getByTestId('quick-add-status-added')).toHaveTextContent('Added Greek yogurt (170 g) to Dinner');
    expect(screen.getByTestId('quick-add-status-totals')).toHaveTextContent(
      'Day total 283 / 1,872 kcal · 28 / 144 g protein'
    );

    act(() => {
      jest.advanceTimersByTime(QUICK_ADD_CONFIRM_MS);
    });
    expect(screen.getByTestId('quick-add-chip')).not.toHaveAttribute('data-added');
    expect(screen.getByTestId('quick-add-status-added')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(QUICK_ADD_STATUS_MS);
    });
    expect(screen.queryByTestId('quick-add-status-added')).not.toBeInTheDocument();
  });

  it('Undo removes the add and says so', async () => {
    const onUndo = jest.fn().mockResolvedValue(undefined);
    renderChips(jest.fn().mockResolvedValue(confirmation(onUndo)));
    await act(async () => {
      fireEvent.click(screen.getByTestId('quick-add-chip'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('quick-add-status-added')).toHaveTextContent('Removed Greek yogurt (170 g) from Dinner');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('a failed save shows no confirmation', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    renderChips(jest.fn().mockRejectedValue(new Error('offline')));
    await act(async () => {
      fireEvent.click(screen.getByTestId('quick-add-chip'));
    });
    expect(screen.getByTestId('quick-add-chip')).not.toHaveAttribute('data-added');
    expect(screen.queryByTestId('quick-add-status-added')).not.toBeInTheDocument();
    error.mockRestore();
  });

  it('renders nothing with no recent foods', () => {
    const { container } = render(
      <QuickAddChips foods={[]} mealType="dinner" mealLabel="Dinner" meals={meals} onMealChange={jest.fn()} onAdd={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
