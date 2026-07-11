import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareWorkoutText } from '../ShareWorkoutText';
import type { WorkoutShareTextInput } from '@/services/workoutShareText';

const mockIsNativePlatform = jest.fn();
const mockCapacitorShare = jest.fn();

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockIsNativePlatform() },
}));

jest.mock('@capacitor/share', () => ({
  Share: { share: (...args: unknown[]) => mockCapacitorShare(...args) },
}));

const input: Omit<WorkoutShareTextInput, 'cryptic'> = {
  title: 'Push',
  subtitle: 'Jul 8',
  exercises: [
    {
      name: 'Bench Press',
      primaryMuscle: 'chest',
      targetSets: 2,
      targetRepRange: [8, 12],
      targetRir: 2,
      hasPR: true,
      sets: [
        { reps: 10, weightKg: 100, rpe: 8 }, // hit → 🟩
        { reps: 8, weightKg: 100, rpe: 9 }, // harder than planned (1 RIR < 2) → 🟨
      ],
    },
  ],
  durationSeconds: 1800,
  unit: 'kg',
};

async function openModalAndShare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Share 📋' }));
  // Two "Share 📋" buttons exist once the modal is open; the last is the action.
  const shareButtons = screen.getAllByRole('button', { name: 'Share 📋' });
  await user.click(shareButtons[shareButtons.length - 1]);
}

describe('ShareWorkoutText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsNativePlatform.mockReturnValue(false);
    // jsdom has neither navigator.share nor navigator.clipboard by default.
    delete (navigator as any).share;
    delete (navigator as any).clipboard;
  });

  it('previews the exact share text before sharing', async () => {
    const user = userEvent.setup();
    render(<ShareWorkoutText input={input} />);

    await user.click(screen.getByRole('button', { name: 'Share 📋' }));

    expect(screen.getByText(/HyperTrack 💪 Push/)).toBeInTheDocument();
    expect(screen.getByText(/🟩🟨\s+Bench Press 🏆/)).toBeInTheDocument();
    expect(screen.getByText(/2 sets · 1,800 kg · 30 min · 🏆 1 PR/)).toBeInTheDocument();
  });

  it('uses the Capacitor Share plugin on native', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    const user = userEvent.setup();
    render(<ShareWorkoutText input={input} />);

    await openModalAndShare(user);

    expect(mockCapacitorShare).toHaveBeenCalledWith({
      text: expect.stringContaining('HyperTrack 💪 Push'),
    });
  });

  it('uses navigator.share on the web when available', async () => {
    const user = userEvent.setup();
    const webShare = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: webShare, configurable: true });
    // Installed after userEvent.setup() so user-event's clipboard stub doesn't replace it.
    const clipboardWrite = jest.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
    render(<ShareWorkoutText input={input} />);

    await openModalAndShare(user);

    expect(webShare).toHaveBeenCalledWith({
      text: expect.stringContaining('HyperTrack 💪 Push'),
    });
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(mockCapacitorShare).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard with a "Copied!" confirmation (plain Safari)', async () => {
    const user = userEvent.setup();
    // Installed after userEvent.setup() so user-event's clipboard stub doesn't replace it.
    const clipboardWrite = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
    render(<ShareWorkoutText input={input} />);

    await openModalAndShare(user);

    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining('HyperTrack 💪 Push'));
    expect(mockCapacitorShare).not.toHaveBeenCalled();
    expect(await screen.findByText('✓ Copied!')).toBeInTheDocument();
  });

  it('does not copy when the user cancels the web share sheet', async () => {
    const user = userEvent.setup();
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    Object.defineProperty(navigator, 'share', {
      value: jest.fn().mockRejectedValue(abort),
      configurable: true,
    });
    const clipboardWrite = jest.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
    render(<ShareWorkoutText input={input} />);

    await openModalAndShare(user);

    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it('switches the preview to cryptic mode', async () => {
    const user = userEvent.setup();
    render(<ShareWorkoutText input={input} />);

    await user.click(screen.getByRole('button', { name: 'Share 📋' }));
    expect(screen.getByText(/Bench Press/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch'));

    expect(screen.queryByText(/Bench Press/)).not.toBeInTheDocument();
    expect(screen.getByText(/🟩🟨\s+🏋️ 🏆/)).toBeInTheDocument();
  });
});
