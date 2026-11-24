import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackingDueCard } from '../TrackingDueCard';
import type { TrackingStatus } from '@/services/trackingReminders';

const weigh: TrackingStatus = { kind: 'weigh', dueDate: '2026-11-24', isDue: true, daysSinceLast: 9, cadenceDays: 7 };
const photo: TrackingStatus = { kind: 'photo', dueDate: '2026-11-24', isDue: true, daysSinceLast: null, cadenceDays: 28 };

describe('TrackingDueCard', () => {
  it('one item: title, last-logged line, one action, and Not now', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    const onSnooze = jest.fn();
    render(<TrackingDueCard items={[weigh]} onLog={onLog} onSnooze={onSnooze} />);

    expect(screen.getByText('Time to weigh in')).toBeInTheDocument();
    expect(screen.getByText('Last weigh-in 9 days ago')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Weigh in' }));
    expect(onLog).toHaveBeenCalledWith('weigh');
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onSnooze).toHaveBeenCalledWith(['weigh']);
  });

  it('several items: one card, a row and button each; Not now snoozes all', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    const onSnooze = jest.fn();
    render(<TrackingDueCard items={[weigh, photo]} onLog={onLog} onSnooze={onSnooze} />);

    expect(screen.getAllByTestId('home-nudge')).toHaveLength(1);
    expect(screen.getByText('Due: weigh-in and progress photos')).toBeInTheDocument();
    expect(screen.getByText('First photos: same light, same pose, every time')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add photos' }));
    expect(onLog).toHaveBeenCalledWith('photo');
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onSnooze).toHaveBeenCalledWith(['weigh', 'photo']);
  });

  it('renders nothing with no items', () => {
    const { container } = render(<TrackingDueCard items={[]} onLog={jest.fn()} onSnooze={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
