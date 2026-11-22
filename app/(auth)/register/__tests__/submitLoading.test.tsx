import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../page';

const mockSignUp = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: (...args: unknown[]) => mockSignUp(...args) } }),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: jest.fn() }) }));

async function fillIn() {
  const user = userEvent.setup();
  render(<RegisterPage />);
  await user.type(screen.getByLabelText('Email'), 'someone@example.com');
  await user.type(screen.getByLabelText('Password'), 'Sample-pass1');
  return user;
}

describe('RegisterPage — Create account feedback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a busy, disabled button while signing up', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockSignUp.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = await fillIn();

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const busy = screen.getByRole('button', { name: /creating account/i });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolve({ data: { user: { id: 'u1', identities: [] }, session: null }, error: null });
    });
    // An error re-enables it so the user can fix and retry.
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('submits once even when the form is submitted twice in a row', async () => {
    mockSignUp.mockReturnValue(new Promise(() => {}));
    await fillIn();
    const form = screen.getByRole('button', { name: 'Create account' }).closest('form')!;

    // Two submits in the same tick, before the disabled state re-renders.
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(mockSignUp).toHaveBeenCalledTimes(1);
  });

  it('stays busy while navigating after a direct sign-in', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: { access_token: 'x' } },
      error: null,
    });
    const user = await fillIn();
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(mockPush).toHaveBeenCalledWith('/onboarding');
    expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();
  });
});
