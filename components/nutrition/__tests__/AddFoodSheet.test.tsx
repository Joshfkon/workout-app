/**
 * The Add food sheet (Eat redesign): meal picker and ways-to-add as
 * segmented controls, plus shortcuts to Describe and Saved meals so every
 * way to add food starts from one place. The macro summary card's ring.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFoodModal } from '../AddFoodModal';
import { MacroSummaryCard } from '../MacroSummaryCard';

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

function renderSheet(props: Partial<React.ComponentProps<typeof AddFoodModal>> = {}) {
  return render(
    <AddFoodModal isOpen onClose={jest.fn()} onAdd={jest.fn()} defaultMealType="dinner" {...props} />
  );
}

describe('Search takes one tap (r20 panel, 6 of 6: "my first tap on Search did nothing")', () => {
  // The sheet focuses the box on the next frame, after it has painted.
  const flushFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  it('opened from the Search quick action, the cursor is already in the search box', async () => {
    renderSheet({ focusSearch: true, initialTab: 'search' });
    await act(flushFrame);
    expect(screen.getByLabelText('Search foods')).toHaveFocus();
  });

  it('opened from "Log food" / "Add food", the Recent list is not hidden behind a keyboard', async () => {
    renderSheet();
    await act(flushFrame);
    expect(screen.getByLabelText('Search foods')).not.toHaveFocus();
  });

  it('tapping the Search tab puts the cursor in the box', async () => {
    const user = userEvent.setup();
    renderSheet({ initialTab: 'manual' });
    await user.click(screen.getByRole('tab', { name: 'Search' }));
    await act(flushFrame);
    expect(screen.getByLabelText('Search foods')).toHaveFocus();
  });

  it('changing the meal while open does not throw the user back to another tab', async () => {
    const user = userEvent.setup();
    const onMealTypeChange = jest.fn();
    const { rerender } = renderSheet({ initialTab: 'search', onMealTypeChange });
    await user.click(screen.getByRole('tab', { name: 'Manual' }));
    await user.click(screen.getByRole('radio', { name: 'Lunch' }));
    // The page follows the sheet's meal and passes it back down.
    rerender(
      <AddFoodModal isOpen onClose={jest.fn()} onAdd={jest.fn()} defaultMealType="lunch" initialTab="search" onMealTypeChange={onMealTypeChange} />
    );
    expect(screen.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'Lunch' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Add food sheet', () => {
  it('picks the meal with a segmented control, defaulting to the one passed in', async () => {
    renderSheet();
    expect(screen.getByRole('radio', { name: 'Dinner' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Lunch' }));
    expect(screen.getByRole('radio', { name: 'Lunch' })).toHaveAttribute('aria-checked', 'true');
  });

  it('offers Search, Scan, Label and Manual as tabs', () => {
    renderSheet();
    for (const name of ['Search', 'Scan', 'Label', 'Manual']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
  });

  it('links to Describe and Saved meals when the page wires them', async () => {
    const onOpenDescribe = jest.fn();
    const onOpenSavedMeals = jest.fn();
    renderSheet({ onOpenDescribe, onOpenSavedMeals });
    await userEvent.click(screen.getByRole('button', { name: 'Describe it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Saved meals' }));
    expect(onOpenDescribe).toHaveBeenCalled();
    expect(onOpenSavedMeals).toHaveBeenCalled();
  });

  it('shows no shortcuts when the page does not wire them', () => {
    renderSheet();
    expect(screen.queryByTestId('add-food-shortcuts')).not.toBeInTheDocument();
  });
});

describe('MacroSummaryCard', () => {
  const targets = { calories: 2450, protein: 180, carbs: 260, fat: 70 };

  it('leads with what is left in a ring, plus the three macros', () => {
    render(
      <MacroSummaryCard
        totals={{ calories: 1210, protein: 85, carbs: 140, fat: 38 }}
        targets={targets}
        mealsRemaining={2}
        onCalculateMacros={jest.fn()}
        onEnterManually={jest.fn()}
      />
    );
    expect(screen.getByRole('img', { name: '1,210 of 2,450 kcal eaten' })).toHaveTextContent('1,240kcal left');
    expect(screen.getByText('85 / 180 g')).toBeInTheDocument();
    expect(screen.getByText(/~620 per meal/)).toBeInTheDocument();
  });

  it('says "over" in the status colour once past the target', () => {
    render(
      <MacroSummaryCard
        totals={{ calories: 2600, protein: 190, carbs: 270, fat: 80 }}
        targets={targets}
        mealsRemaining={0}
        onCalculateMacros={jest.fn()}
        onEnterManually={jest.fn()}
      />
    );
    expect(screen.getByText('kcal over')).toHaveClass('text-status-bad');
    expect(screen.getByText('150')).toBeInTheDocument();
  });
});
