import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFoodModal } from '../AddFoodModal';

jest.mock('@/lib/actions/food-search', () => ({
  searchFoodsAction: jest.fn().mockResolvedValue({ foods: [] }),
  getFoodDetailsAction: jest.fn().mockResolvedValue({ food: null }),
}));
jest.mock('@/services/openFoodFactsService', () => ({
  lookupBarcode: jest.fn().mockResolvedValue({
    found: true,
    product: {
      name: 'Greek Yogurt', brand: 'Fage', servingSize: '170 g', servingQuantity: 170,
      calories: 100, protein: 18, carbs: 6, fat: 0, imageUrl: 'https://images.openfoodfacts.org/x.jpg', barcode: '0123456789012',
    },
  }),
}));
jest.mock('../BarcodeScanner', () => ({
  BarcodeScanner: ({ onScan }: { onScan: (b: string) => Promise<void> }) => (
    <button onClick={() => onScan('0123456789012')}>fake scan</button>
  ),
}));

it('shows the scanned product without crashing', async () => {
  render(<AddFoodModal isOpen onClose={jest.fn()} onAdd={jest.fn()} defaultMealType="lunch" initialTab="barcode" />);
  await userEvent.click(await screen.findByRole('button', { name: 'fake scan' }));
  expect(await screen.findByText('Greek Yogurt')).toBeInTheDocument();
});
