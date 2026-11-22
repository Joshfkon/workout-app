/**
 * Ask-at-first-use AI consent (components/ai/AiConsentGate).
 *
 * - Nothing is read or shown when the provider mounts (dashboard load).
 * - The sheet appears on the first AI tap while the choice is NULL.
 * - No AI call is made until the user allows; declining shows the note.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}));

const mockGetConsent = jest.fn();
const mockSetConsent = jest.fn();
jest.mock('@/lib/actions/ai-consent', () => ({
  getAiDataSharingConsent: (...args: unknown[]) => mockGetConsent(...args),
  setAiDataSharingConsent: (...args: unknown[]) => mockSetConsent(...args),
}));

const mockParseMeal = jest.fn();
jest.mock('@/lib/actions/nutrition-ai', () => ({
  parseMealDescription: (...args: unknown[]) => mockParseMeal(...args),
}));

import { AiConsentProvider, AI_DECLINED_NOTE, useAiConsentGate } from '../AiConsentGate';
import { publishAiConsent } from '../aiConsentBus';
import { DescribeMealModal } from '@/components/nutrition/DescribeMealModal';

/** Stand-in AI entry point: gate first, then the (mocked) AI action. */
function AiFeatureButton({ onRun }: { onRun: () => void }) {
  const ensureAiConsent = useAiConsentGate();
  return (
    <button
      type="button"
      onClick={async () => {
        if (await ensureAiConsent()) onRun();
      }}
    >
      Use AI
    </button>
  );
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<AiConsentProvider>{ui}</AiConsentProvider>);
}

describe('AiConsentGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetConsent.mockResolvedValue({ ok: true });
  });

  it('shows nothing and reads nothing on mount (dashboard load)', () => {
    mockGetConsent.mockResolvedValue(null);
    renderWithProvider(<div>Dashboard</div>);
    expect(screen.queryByTestId('ai-consent-prompt')).not.toBeInTheDocument();
    expect(mockGetConsent).not.toHaveBeenCalled();
  });

  it('asks on first AI use and runs the feature only after Allow', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(null);
    const run = jest.fn();
    renderWithProvider(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    expect(await screen.findByTestId('ai-consent-prompt')).toBeInTheDocument();
    expect(screen.getByText('Allow AI features?')).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(mockSetConsent).toHaveBeenCalledWith(true);
    await waitFor(() =>
      expect(screen.queryByTestId('ai-consent-prompt')).not.toBeInTheDocument()
    );

    // Answered: the next tap goes straight through, no sheet, no re-read.
    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(mockGetConsent).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ai-consent-prompt')).not.toBeInTheDocument();
  });

  it("Don't allow saves the choice, does not start the feature, and says how to turn it on", async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(null);
    const run = jest.fn();
    renderWithProvider(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await user.click(await screen.findByRole('button', { name: "Don't allow" }));

    expect(mockSetConsent).toHaveBeenCalledWith(false);
    expect(await screen.findByText(AI_DECLINED_NOTE)).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();

    // Declined: later taps show the note again, never the sheet or the feature.
    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    expect(screen.queryByTestId('ai-consent-prompt')).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('dismissing the sheet saves nothing and does not start the feature', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(null);
    const run = jest.fn();
    renderWithProvider(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await screen.findByTestId('ai-consent-prompt');
    await user.click(screen.getByRole('button', { name: 'Close modal' }));

    await waitFor(() => expect(screen.queryByText('Allow AI features?')).not.toBeInTheDocument());
    expect(mockSetConsent).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('a failed save keeps the sheet open with an error and does not start the feature', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(null);
    mockSetConsent.mockResolvedValue({ ok: false, error: 'Failed to save. Please try again.' });
    const run = jest.fn();
    renderWithProvider(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await user.click(await screen.findByRole('button', { name: 'Allow' }));

    expect(await screen.findByText('Failed to save. Please try again.')).toBeInTheDocument();
    expect(screen.getByTestId('ai-consent-prompt')).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('already allowed: no sheet, the feature runs', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(true);
    const run = jest.fn();
    renderWithProvider(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('ai-consent-prompt')).not.toBeInTheDocument();
  });

  it('already declined: no sheet, no feature, the note', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(false);
    const run = jest.fn();
    renderWithProvider(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    expect(await screen.findByText(AI_DECLINED_NOTE)).toBeInTheDocument();
    expect(screen.queryByTestId('ai-consent-prompt')).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('follows the Settings toggle without a refetch', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(true);
    const run = jest.fn();
    renderWithProvider(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    publishAiConsent(false); // AiDataSharingCard turned it off
    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    expect(await screen.findByText(AI_DECLINED_NOTE)).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('outside the provider only an explicit TRUE lets a feature run', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(null);
    const run = jest.fn();
    render(<AiFeatureButton onRun={run} />);

    await user.click(screen.getByRole('button', { name: 'Use AI' }));
    await waitFor(() => expect(mockGetConsent).toHaveBeenCalled());
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Describe meal behind the gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetConsent.mockResolvedValue({ ok: true });
    mockParseMeal.mockResolvedValue({ ok: true, items: [] });
  });

  function renderDescribe() {
    return renderWithProvider(
      <DescribeMealModal
        isOpen
        onClose={jest.fn()}
        defaultMealType="lunch"
        onLogItems={jest.fn()}
      />
    );
  }

  it('sends nothing to the AI until the user allows', async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(null);
    renderDescribe();

    await user.type(screen.getByRole('textbox'), 'two eggs and toast');
    await user.click(screen.getByRole('button', { name: 'Estimate macros' }));

    expect(await screen.findByTestId('ai-consent-prompt')).toBeInTheDocument();
    expect(mockParseMeal).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(mockParseMeal).toHaveBeenCalledWith('two eggs and toast'));
  });

  it("never calls the AI after Don't allow", async () => {
    const user = userEvent.setup();
    mockGetConsent.mockResolvedValue(null);
    renderDescribe();

    await user.type(screen.getByRole('textbox'), 'two eggs and toast');
    await user.click(screen.getByRole('button', { name: 'Estimate macros' }));
    await user.click(await screen.findByRole('button', { name: "Don't allow" }));

    expect(await screen.findByText(AI_DECLINED_NOTE)).toBeInTheDocument();
    expect(mockParseMeal).not.toHaveBeenCalled();
    // The description is kept and the button is usable again.
    expect(screen.getByRole('button', { name: 'Estimate macros' })).toBeEnabled();
  });
});
