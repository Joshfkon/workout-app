import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../page';

const mockSignUp = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: (...args: unknown[]) => mockSignUp(...args) } }),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: jest.fn() }) }));

async function submit() {
  const user = userEvent.setup();
  render(<RegisterPage />);
  await user.type(screen.getByLabelText('Email'), 'someone@example.com');
  await user.type(screen.getByLabelText('Password'), 'Sample-pass1');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('RegisterPage — an email that is already registered', () => {
  beforeEach(() => jest.clearAllMocks());

  it('says the account exists instead of waiting for a code that never comes', async () => {
    // Supabase's answer for an existing email: no error, no session, no identities.
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [] }, session: null },
      error: null,
    });
    await submit();

    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText(/sent/i)).not.toBeInTheDocument();
  });

  it('still shows the check-your-email screen for a genuinely new email', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u2', identities: [{ id: 'i1' }] }, session: null },
      error: null,
    });
    await submit();

    expect(await screen.findByText(/someone@example.com/)).toBeInTheDocument();
    expect(screen.queryByText('An account with this email already exists.')).not.toBeInTheDocument();
  });
});
