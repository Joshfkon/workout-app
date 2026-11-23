/**
 * Text size can be set on the register page, before an account exists. It
 * writes the same localStorage key as Settings, so the account picks it up.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../page';
import { __resetTextSizeStateForTests } from '@/hooks/useTextSize';

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: jest.fn() } }),
  createUntypedClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

describe('RegisterPage — text size', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-text-size');
    __resetTextSizeStateForTests();
  });

  it('offers the three sizes in the footer and applies + stores a pick', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    const footer = screen.getByTestId('register-text-size');
    expect(footer).toHaveTextContent('Text size:');
    await user.click(within(footer).getByRole('button', { name: 'Larger text' }));
    expect(document.documentElement.getAttribute('data-text-size')).toBe('larger');
    expect(localStorage.getItem('textSize')).toBe('larger');
    expect(within(footer).getByRole('button', { name: 'Larger text' })).toHaveAttribute('aria-pressed', 'true');
  });
});
