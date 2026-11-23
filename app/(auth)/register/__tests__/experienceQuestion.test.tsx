/**
 * Sign-up asks "Do you lift weights?" in plain words, optional, with nothing
 * preselected. Skipping it keeps the previous default (intermediate); "No,
 * food tracking" is a real answer that leads Home with food.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../page';
import { isAuthFormRoute } from '@/components/providers/SplashProvider';

const mockSignUp = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: (...args: unknown[]) => mockSignUp(...args) } }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

async function fillIn() {
  const user = userEvent.setup();
  render(<RegisterPage />);
  await user.type(screen.getByLabelText('Email'), 'someone@example.com');
  await user.type(screen.getByLabelText('Password'), 'Sample-pass1');
  return user;
}

const sentData = () => mockSignUp.mock.calls[0][0].options.data;
const sentExperience = () => sentData().experience;

describe('RegisterPage — experience question', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignUp.mockReturnValue(new Promise(() => {}));
  });

  it('is optional, plain, and has nothing preselected', async () => {
    await fillIn();
    expect(screen.getByRole('radiogroup', { name: /Do you lift weights\? .*\(optional\)/ })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.queryByText(/Intermediate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hypertrophy/i)).not.toBeInTheDocument();
  });

  it('keeps the previous default (intermediate) when skipped', async () => {
    const user = await fillIn();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    expect(sentExperience()).toBe('intermediate');
    expect(sentData()).not.toHaveProperty('tracking_focus');
  });

  it('"No, food tracking" signs up as a food tracker (novice if they ever lift)', async () => {
    const user = await fillIn();
    await user.click(screen.getByRole('radio', { name: 'No, food tracking' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    expect(sentData()).toMatchObject({ experience: 'novice', tracking_focus: 'food' });
  });

  it('sends the picked answer, mapped onto the experience level', async () => {
    const user = await fillIn();
    await user.click(screen.getByRole('radio', { name: '3–5 years' }));
    expect(screen.getByRole('radio', { name: '3–5 years' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    expect(sentExperience()).toBe('advanced');
    expect(sentData()).not.toHaveProperty('tracking_focus');
  });

  it('offers a "just started" answer and finer, non-overlapping ranges', async () => {
    await fillIn();
    const labels = screen.getAllByRole('radio').map((r) => r.textContent);
    expect(labels).toEqual([
      'No, food tracking',
      'Just started (under 6 months)',
      '6–12 months',
      '1–2 years',
      '2–3 years',
      '3–5 years',
      '5+ years',
    ]);
  });

  it('a lifter of about two years can answer exactly (signs up as intermediate)', async () => {
    const user = await fillIn();
    await user.click(screen.getByRole('radio', { name: '2–3 years' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    expect(sentExperience()).toBe('intermediate');
  });

  it('says what the answer changes', async () => {
    await fillIn();
    expect(screen.getByText(/starting weekly sets and first weight suggestions/)).toBeInTheDocument();
    expect(screen.getByText(/Change it any time in Settings/)).toBeInTheDocument();
  });
});

describe('isAuthFormRoute (no branded splash over auth forms)', () => {
  it('matches the auth form pages only', () => {
    expect(isAuthFormRoute('/register')).toBe(true);
    expect(isAuthFormRoute('/login')).toBe(true);
    expect(isAuthFormRoute('/verify-code')).toBe(true);
    expect(isAuthFormRoute('/dashboard')).toBe(false);
    expect(isAuthFormRoute('/registered-elsewhere')).toBe(false);
  });
});
