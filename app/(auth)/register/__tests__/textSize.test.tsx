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

  it('offers the three sizes at the very top of the page and applies + stores a pick', async () => {
    const user = userEvent.setup();
    const { container } = render(<RegisterPage />);
    const footer = screen.getByTestId('register-text-size');
    expect(footer).toHaveTextContent('Text size');
    // First thing on the page: before the logo, the heading and the form.
    const heading = screen.getByRole('heading', { name: 'Create your account' });
    expect(footer.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('a[href="/"]')!.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    await user.click(within(footer).getByRole('button', { name: 'Larger text' }));
    expect(document.documentElement.getAttribute('data-text-size')).toBe('larger');
    expect(localStorage.getItem('textSize')).toBe('larger');
    expect(within(footer).getByRole('button', { name: 'Larger text' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets the form text at the app body size or larger (no 12–13px copy in the question)', () => {
    render(<RegisterPage />);
    expect(screen.getByTestId('experience-option-2_to_3_years').className).toContain('text-headline');
    expect(screen.getByText(/Sets your starting weekly sets/).className).toContain('text-headline');
  });

  it('uses large fields and labels by default, before any text size is picked (UX panel round 19)', () => {
    render(<RegisterPage />);
    const email = screen.getByLabelText('Email');
    expect(email.className).toContain('text-headline');
    expect(email.className).toContain('min-h-[52px]');
    expect(screen.getByText('Email', { selector: 'label' }).className).toContain('text-headline');
    // The terms line is no longer 12px caption text.
    expect(screen.getByText(/By signing up/).className).toContain('text-body');
  });

  it('keeps every line before the text-size pick at 17px, the password rule included (UX panel round 20)', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/8\+ characters with lowercase/).className).toContain('text-headline');
    expect(screen.getByText(/Get full Elite access/).className).toContain('text-headline');
    expect(screen.getByText(/Already have an account/).className).toContain('text-headline');
    expect(within(screen.getByTestId('register-text-size')).getByText('Text size').className).toContain('text-headline');
  });
});
