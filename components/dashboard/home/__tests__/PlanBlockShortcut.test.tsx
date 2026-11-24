import React from 'react';
import { render, screen } from '@testing-library/react';
import { PlanBlockShortcut } from '../PlanBlockShortcut';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/dashboard',
}));

describe('PlanBlockShortcut', () => {
  // UX panel round 21 (Dre): "The mesocycle builder isn't obvious from the dashboard."
  it('links Home straight to the training block builder', () => {
    render(<PlanBlockShortcut />);
    const link = screen.getByTestId('home-plan-block');
    expect(link).toHaveAttribute('href', '/dashboard/mesocycle/new');
    expect(link).toHaveTextContent('Plan a training block');
  });
});
