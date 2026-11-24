/**
 * A failed USDA search (rate limit, network) shows a short friendly line
 * with a Retry button instead of the raw service error, and the other
 * sources (common foods etc.) keep rendering.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFoodModal } from '../AddFoodModal';
import { searchFoodsAction } from '@/lib/actions/food-search';
import { friendlyUsdaError } from '@/lib/nutrition/usdaErrorMessage';
import type { SystemFood } from '@/types/nutrition';

jest.mock('@/lib/actions/food-search', () => ({
  searchFoodsAction: jest.fn(),
  getFoodDetailsAction: jest.fn().mockResolvedValue({ food: null }),
}));
jest.mock('@/services/openFoodFactsService', () => ({
  lookupBarcode: jest.fn().mockResolvedValue({ found: false }),
}));
jest.mock('../BarcodeScanner', () => ({
  BarcodeScanner: () => null,
}));

// The sheet retries transient failures quietly before showing anything; run
// those retries without the real pauses.
jest.mock('@/lib/nutrition/usdaRetry', () => {
  const actual = jest.requireActual('@/lib/nutrition/usdaRetry');
  return {
    ...actual,
    searchUsdaWithRetry: (search: () => Promise<unknown>, opts: object = {}) =>
      actual.searchUsdaWithRetry(search, { ...opts, delays: [0, 0, 0] }),
  };
});

const mockSearch = searchFoodsAction as jest.MockedFunction<typeof searchFoodsAction>;

const RAW = 'Rate limit exceeded. Please wait a moment and try again.';

const systemFoods: SystemFood[] = [
  {
    id: 'sf-1',
    name: 'Chicken breast',
    category: 'protein',
    subcategory: null,
    calories_per_100g: 165,
    protein_per_100g: 31,
    carbs_per_100g: 0,
    fat_per_100g: 3.6,
  },
];

describe('USDA search error', () => {
  beforeEach(() => mockSearch.mockReset());

  it('shows a friendly message with Retry only after the quiet retries fail, keeps other sources, and retries', async () => {
    mockSearch
      .mockResolvedValueOnce({ foods: [], error: RAW })
      .mockResolvedValueOnce({ foods: [], error: RAW })
      .mockResolvedValueOnce({ foods: [], error: RAW })
      .mockResolvedValueOnce({ foods: [], error: RAW })
      .mockResolvedValueOnce({
        foods: [
          {
            foodId: '123',
            name: 'Chicken, roasted',
            servingSize: '100 g',
            calories: 190,
            protein: 29,
            carbs: 0,
            fat: 7,
          } as never,
        ],
      });
    const user = userEvent.setup();
    render(
      <AddFoodModal
        isOpen
        onClose={jest.fn()}
        onAdd={jest.fn()}
        defaultMealType="lunch"
        systemFoods={systemFoods}
      />
    );

    await user.type(screen.getByPlaceholderText(/Search your foods/), 'chicken');

    const errorRow = await screen.findByTestId('usda-search-error');
    expect(errorRow).toHaveTextContent('Couldn’t reach the USDA list. Your foods and common foods still work.');
    expect(errorRow).not.toHaveTextContent(/busy/i);
    // 1 try + 3 quiet retries before anything was shown.
    expect(mockSearch).toHaveBeenCalledTimes(4);
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
    // Common foods still render alongside the failed USDA section.
    expect(screen.getByText('Chicken breast')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Chicken, roasted')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('usda-search-error')).not.toBeInTheDocument());
    expect(mockSearch).toHaveBeenCalledTimes(5);
    expect(mockSearch).toHaveBeenLastCalledWith('chicken');
  });

  it('a failure that clears on a quiet retry never shows an error', async () => {
    mockSearch
      .mockResolvedValueOnce({ foods: [], error: RAW })
      .mockResolvedValueOnce({
        foods: [
          {
            foodId: '123',
            name: 'Chicken, roasted',
            servingSize: '100 g',
            calories: 190,
            protein: 29,
            carbs: 0,
            fat: 7,
          } as never,
        ],
      });
    const user = userEvent.setup();
    render(
      <AddFoodModal
        isOpen
        onClose={jest.fn()}
        onAdd={jest.fn()}
        defaultMealType="lunch"
        systemFoods={systemFoods}
      />
    );
    await user.type(screen.getByPlaceholderText(/Search your foods/), 'chicken');
    expect(await screen.findByText('Chicken, roasted')).toBeInTheDocument();
    expect(screen.queryByTestId('usda-search-error')).not.toBeInTheDocument();
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });
});

describe('friendlyUsdaError', () => {
  it('never echoes the raw service text', () => {
    expect(friendlyUsdaError(RAW)).toBe('Couldn’t reach the USDA list. Your foods and common foods still work.');
    expect(friendlyUsdaError('Search failed. Please try again.')).toBe(
      'Couldn’t reach the USDA list. Your foods and common foods still work.'
    );
    expect(friendlyUsdaError('Sign in to search foods')).toMatch(/Sign in/);
  });
});
