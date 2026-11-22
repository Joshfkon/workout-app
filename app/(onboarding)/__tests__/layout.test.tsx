import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OnboardingLayout from '../layout';

let mockPathname = '/onboarding';
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
}));

const mockComplete = jest.fn();
jest.mock('@/lib/onboarding/onboardingProgress', () => ({
  completeOnboarding: (...args: unknown[]) => mockComplete(...args),
}));
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }),
}));

describe('Onboarding header "Skip for now"', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ error: null });
  });

  it('is a plain link before the goal is saved (setup still unfinished)', () => {
    mockPathname = '/onboarding';
    render(<OnboardingLayout><div /></OnboardingLayout>);
    expect(screen.getByRole('link', { name: /Skip for now/ })).toHaveAttribute('href', '/dashboard');
  });

  it('finishes onboarding and goes to the dashboard in one tap from benchmarks onward', async () => {
    mockPathname = '/onboarding/benchmarks';
    const user = userEvent.setup();
    render(<OnboardingLayout><div /></OnboardingLayout>);

    await user.click(screen.getByRole('button', { name: /Skip for now/ }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});
