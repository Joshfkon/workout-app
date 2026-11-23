import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BodyAddMoreData } from '@/components/body/BodyAddMoreData';

function renderRow(props: Partial<React.ComponentProps<typeof BodyAddMoreData>> = {}) {
  const handlers = { onLogScan: jest.fn(), onSetGoals: jest.fn() };
  render(
    <BodyAddMoreData
      needsPhase
      phaseHref="/dashboard/phases"
      scanCount={0}
      needsGoals
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe('BodyAddMoreData', () => {
  it('collects the setup prompts in plain words, technical terms in brackets', () => {
    renderRow();
    expect(screen.getByText('Add more data')).toBeInTheDocument();
    expect(screen.getByText('Set a goal phase')).toBeInTheDocument();
    expect(screen.getByText(/Cut, maintain or bulk/)).toBeInTheDocument();
    expect(screen.getByText('Log a body scan (DEXA)')).toBeInTheDocument();
    expect(screen.getByText('Set body goals')).toBeInTheDocument();
  });

  it('only lists what is missing, and renders nothing when complete', () => {
    const { rerender } = render(
      <BodyAddMoreData
        needsPhase={false}
        phaseHref="/dashboard/phases"
        scanCount={1}
        onLogScan={jest.fn()}
        needsGoals={false}
        onSetGoals={jest.fn()}
      />
    );
    expect(screen.queryByText('Set a goal phase')).not.toBeInTheDocument();
    expect(screen.getByText(/One more scan/)).toBeInTheDocument();

    rerender(
      <BodyAddMoreData
        needsPhase={false}
        phaseHref="/dashboard/phases"
        scanCount={2}
        onLogScan={jest.fn()}
        needsGoals={false}
        onSetGoals={jest.fn()}
      />
    );
    expect(screen.queryByTestId('body-add-more-data')).not.toBeInTheDocument();
  });

  it('wires the scan and goals rows to their actions', async () => {
    const user = userEvent.setup();
    const { onLogScan, onSetGoals } = renderRow();
    await user.click(screen.getByText('Log a body scan (DEXA)'));
    await user.click(screen.getByText('Set body goals'));
    expect(onLogScan).toHaveBeenCalledTimes(1);
    expect(onSetGoals).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Set a goal phase').closest('a')).toHaveAttribute(
      'href',
      '/dashboard/phases'
    );
  });

  it('never offers a body scan when offerScan is false (food-only users)', () => {
    renderRow({ offerScan: false });
    expect(screen.queryByText('Log a body scan (DEXA)')).not.toBeInTheDocument();
    expect(screen.getByText('Set a goal phase')).toBeInTheDocument();
  });
});
