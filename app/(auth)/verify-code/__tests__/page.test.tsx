/**
 * OTP fallback page: verifyOtp is called with the right type and the flow
 * continues to reset-password (recovery) / onboarding (signup) — this is the
 * path that rescues links opened on a different device.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockVerifyOtp = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { verifyOtp: mockVerifyOtp },
  }),
}));

import VerifyCodePage from '../page';

function setSearch(search: string) {
  window.history.replaceState(null, '', `/verify-code${search}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  setSearch('');
});

it('recovery code → verifyOtp(recovery) → reset-password', async () => {
  const user = userEvent.setup();
  setSearch('?type=recovery&reason=cross_device');
  sessionStorage.setItem('ht-pending-recovery-email', 'lifter@example.com');
  mockVerifyOtp.mockResolvedValue({ error: null });

  render(<VerifyCodePage />);

  // Cross-device explainer + prefilled email from sessionStorage.
  expect(screen.getByRole('status')).toHaveTextContent(/different device/i);
  expect(screen.getByLabelText(/email/i)).toHaveValue('lifter@example.com');

  await user.type(screen.getByLabelText(/6-digit code/i), '123456');
  await user.click(screen.getByRole('button', { name: /verify & set new password/i }));

  expect(mockVerifyOtp).toHaveBeenCalledWith({
    type: 'recovery',
    email: 'lifter@example.com',
    token: '123456',
  });
  expect(mockPush).toHaveBeenCalledWith('/reset-password');
});

it('signup code → verifyOtp(signup) → onboarding', async () => {
  const user = userEvent.setup();
  setSearch('?type=signup');
  mockVerifyOtp.mockResolvedValue({ error: null });

  render(<VerifyCodePage />);

  await user.type(screen.getByLabelText(/email/i), 'new@example.com');
  await user.type(screen.getByLabelText(/6-digit code/i), '654321');
  await user.click(screen.getByRole('button', { name: /confirm account/i }));

  expect(mockVerifyOtp).toHaveBeenCalledWith({
    type: 'signup',
    email: 'new@example.com',
    token: '654321',
  });
  expect(mockPush).toHaveBeenCalledWith('/onboarding');
});

it('expired code surfaces actionable copy instead of a dead end', async () => {
  const user = userEvent.setup();
  mockVerifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });

  render(<VerifyCodePage />);

  await user.type(screen.getByLabelText(/email/i), 'new@example.com');
  await user.type(screen.getByLabelText(/6-digit code/i), '000000');
  await user.click(screen.getByRole('button', { name: /confirm account/i }));

  expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
  // Escape hatch to a fresh email is always present.
  expect(screen.getByRole('link', { name: /resend the confirmation email/i })).toBeInTheDocument();
});

it('rejects a malformed code client-side without calling the API', async () => {
  const user = userEvent.setup();
  render(<VerifyCodePage />);

  await user.type(screen.getByLabelText(/email/i), 'new@example.com');
  await user.type(screen.getByLabelText(/6-digit code/i), '12ab');
  await user.click(screen.getByRole('button', { name: /confirm account/i }));

  expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();
  expect(mockVerifyOtp).not.toHaveBeenCalled();
});
