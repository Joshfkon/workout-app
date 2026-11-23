import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetLiftingOn = jest.fn();
let mockFocus = { foodOnly: true, statedFood: true as boolean | undefined };
jest.mock('@/hooks/useTrackingFocus', () => ({
  useTrackingFocus: () => ({ ...mockFocus, setLiftingOn: mockSetLiftingOn }),
}));

import { AlsoLiftsCard } from '../PreferencesTabPanel';

describe('AlsoLiftsCard ("I also lift weights")', () => {
  beforeEach(() => {
    mockSetLiftingOn.mockReset().mockResolvedValue(undefined);
    mockFocus = { foodOnly: true, statedFood: true };
  });

  it('is off for a food-only user and turns lifting on', async () => {
    const user = userEvent.setup();
    render(<AlsoLiftsCard />);
    const toggle = screen.getByRole('switch', { name: 'I also lift weights' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(mockSetLiftingOn).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId('save-status-alsoLifts')).toHaveTextContent('Saved');
  });

  it('says so when the save fails', async () => {
    mockSetLiftingOn.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<AlsoLiftsCard />);
    await user.click(screen.getByRole('switch', { name: 'I also lift weights' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn’t save/);
  });

  it('is not shown to people who signed up as lifters', () => {
    mockFocus = { foodOnly: false, statedFood: false };
    render(<AlsoLiftsCard />);
    expect(screen.queryByTestId('also-lifts-card')).not.toBeInTheDocument();
  });
});
