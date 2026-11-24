import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BenchmarksPage from '../page';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams('session=sess-1'),
}));

const mockComplete = jest.fn();
const mockUpdateStep = jest.fn();
jest.mock('@/lib/onboarding/onboardingProgress', () => ({
  completeOnboarding: (...args: unknown[]) => mockComplete(...args),
  updateOnboardingStep: (...args: unknown[]) => mockUpdateStep(...args),
}));

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  }),
}));

describe('Onboarding benchmarks page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ error: null });
  });

  it('starts with no lifts chosen and no time estimate; recommended lifts are badged', () => {
    render(<BenchmarksPage />);

    expect(screen.queryByTestId('benchmark-time-estimate')).not.toBeInTheDocument();
    expect(screen.queryByText(/68 min/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Recommended').length).toBeGreaterThan(0);
    // No per-lift minutes on the cards: the only time shown is the total, later.
    expect(screen.queryByText(/min\b/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pick lifts to test/ })).toBeDisabled();
  });

  it('says what the tests are for and what skipping does, with skip first', () => {
    render(<BenchmarksPage />);
    const purpose = screen.getByTestId('benchmarks-purpose');
    expect(screen.getByTestId('benchmarks-optional-badge')).toHaveTextContent('Optional');
    expect(screen.getByTestId('skip-benchmarks')).toHaveTextContent('Skip for now');
    expect(purpose).toHaveTextContent(/warm-up sets and one hard set/);
    expect(purpose).toHaveTextContent(/starting weights we suggest/);
    const cost = screen.getByTestId('benchmarks-skip-cost');
    expect(cost).toHaveTextContent(/start from estimates \(your experience and body weight\)/);
    expect(cost).toHaveTextContent(/adjust after your first sessions/);
    expect(cost).toHaveTextContent(/Strength percentiles stay off until you test\./);
    const skip = screen.getByTestId('skip-benchmarks');
    const start = screen.getByRole('button', { name: /Pick lifts to test/ });
    // Skip comes before any lift choice in the page.
    expect(skip.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Nothing here affects food tracking/)).toBeInTheDocument();
  });

  it('tells an injured lifter not to test that area', () => {
    render(<BenchmarksPage />);
    const note = screen.getByTestId('benchmarks-injury-note');
    expect(note).toHaveTextContent(/Don.t test a lift that loads it/);
    expect(note).toHaveTextContent(/Testing isn.t needed/);
    // Inside the purpose box, so it is read before Skip or any lift.
    expect(screen.getByTestId('benchmarks-purpose')).toContainElement(note);
  });

  it('shows the time estimate once a lift is chosen', async () => {
    const user = userEvent.setup();
    render(<BenchmarksPage />);

    await user.click(screen.getByRole('button', { name: /Bench Press/i }));

    const estimate = screen.getByTestId('benchmark-time-estimate');
    expect(estimate).toHaveTextContent('1 lift selected');
    expect(estimate).toHaveTextContent('~17 min');
    // Still no per-card minutes once a lift is picked.
    expect(screen.getAllByText(/min\b/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Start Testing \(1 lift\)/ })).toBeEnabled();
  });

  it('skip finishes onboarding and lands on the dashboard in one tap', async () => {
    const user = userEvent.setup();
    render(<BenchmarksPage />);

    await user.click(screen.getByTestId('skip-benchmarks'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledWith(expect.anything(), 'u1');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('puts what the tests are for and what skipping changes in a bulleted box above everything else', () => {
    render(<BenchmarksPage />);
    const box = screen.getByTestId('benchmarks-purpose');
    expect(box.querySelectorAll('li').length).toBeGreaterThanOrEqual(4);
    expect(box).toHaveTextContent(/What a test does:/);
    expect(box).toHaveTextContent(/If you skip:/);
    // Above Skip and above every lift card.
    for (const later of [screen.getByTestId('skip-benchmarks'), screen.getByRole('button', { name: /Bench Press/i })]) {
      expect(box.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('Skip shows it is working the moment it is tapped', async () => {
    let finish: () => void = () => {};
    mockComplete.mockReturnValue(new Promise((r) => (finish = () => r({ error: null }))));
    const user = userEvent.setup();
    render(<BenchmarksPage />);

    await user.click(screen.getByTestId('skip-benchmarks'));

    const skip = screen.getByTestId('skip-benchmarks');
    expect(skip).toHaveTextContent('Opening the app…');
    expect(skip).toHaveAttribute('aria-busy', 'true');
    expect(skip).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Skipped\. Finishing setup/);
    expect(mockPush).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
  });

  it('Start Testing goes busy at once and stays busy through navigation', async () => {
    const user = userEvent.setup();
    render(<BenchmarksPage />);
    await user.click(screen.getByRole('button', { name: /Bench Press/i }));
    await user.click(screen.getByTestId('start-benchmarks'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/calibrate?session=sess-1'));
    expect(screen.getByTestId('start-benchmarks')).toHaveTextContent('Starting…');
    expect(screen.getByTestId('start-benchmarks')).toBeDisabled();
  });

  it('still lands on the dashboard if saving completion fails', async () => {
    mockComplete.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<BenchmarksPage />);

    await user.click(screen.getByTestId('skip-benchmarks'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
  });
});
