/**
 * The Add food sheet (Eat redesign): meal picker and ways-to-add as
 * segmented controls, plus shortcuts to Describe and Saved meals so every
 * way to add food starts from one place. The macro summary card's ring.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
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
