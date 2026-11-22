import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadinessCheckIn } from '../ReadinessCheckIn';
import type { TemporaryInjury } from '@/types/schema';

const defaults: TemporaryInjury[] = [
  { area: 'knee_left', severity: 1 },
  { area: 'knee_right', severity: 1 },
];

function submitButton() {
  return screen.getByRole('button', { name: 'Start workout' });
}

describe('ReadinessCheckIn default (onboarding) injuries', () => {
  it('prefills standing areas at mild and submits them', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ReadinessCheckIn onSubmit={onSubmit} defaultInjuries={defaults} />);

    expect(screen.getByTestId('checkin-default-injuries-note')).toBeInTheDocument();
    await user.click(submitButton());

    expect(onSubmit.mock.calls[0][0].temporaryInjuries).toEqual(defaults);
  });

  it('lets the lifter remove a prefilled area for today', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ReadinessCheckIn onSubmit={onSubmit} defaultInjuries={defaults} />);

    await user.click(screen.getByRole('button', { name: /pain or injury today/ }));
    await user.click(screen.getByRole('button', { name: 'Remove Right knee' }));
    await user.click(submitButton());

    expect(onSubmit.mock.calls[0][0].temporaryInjuries).toEqual([{ area: 'knee_left', severity: 1 }]);
  });

  it('applies defaults that arrive after mount', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ReadinessCheckIn onSubmit={onSubmit} defaultInjuries={[]} />);
    rerender(<ReadinessCheckIn onSubmit={onSubmit} defaultInjuries={defaults} />);

    await user.click(submitButton());
    expect(onSubmit.mock.calls[0][0].temporaryInjuries).toEqual(defaults);
  });

  it('submits no injuries without defaults', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ReadinessCheckIn onSubmit={onSubmit} />);

    await user.click(submitButton());
    expect(onSubmit.mock.calls[0][0].temporaryInjuries).toBeUndefined();
  });
});
