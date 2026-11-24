import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitChooser } from '../SplitChooser';
import { StartingVolumeChooser } from '../StartingVolumeChooser';
import { PriorityFrequencyWarning } from '../PriorityFrequencyWarning';
import { PlanBuildingIndicator } from '../PlanBuildingIndicator';
import { SaveBlockBar } from '../SaveBlockBar';

describe('SplitChooser', () => {
  it('shows every split as a card with its week, the recommended one marked', async () => {
    const onChoose = jest.fn();
    render(<SplitChooser value="Upper/Lower" recommended="Upper/Lower" sessionsPerWeek={4} onChoose={onChoose} />);
    const cards = screen.getAllByRole('radio');
    expect(cards).toHaveLength(5);
    const upperLower = screen.getByTestId('builder-split-upperlower');
    expect(upperLower).toHaveAttribute('aria-checked', 'true');
    expect(upperLower).toHaveTextContent('Recommended');
    expect(upperLower).toHaveTextContent('Upper A · Lower A · Upper B · Lower B');
    // A Bro Split needs five days; the card says so before the tap.
    const bro = screen.getByTestId('builder-split-brosplit');
    expect(bro).toHaveTextContent('Needs 5 days a week');
    expect(bro).toHaveTextContent('Chest · Back · Shoulders · Arms · Legs');
    await userEvent.setup().click(bro);
    expect(onChoose).toHaveBeenCalledWith('Bro Split');
  });

  it('marks the split recent training reads as', () => {
    render(<SplitChooser value="PPL" recommended="Upper/Lower" matchesHistory="PPL" sessionsPerWeek={6} onChoose={jest.fn()} />);
    expect(screen.getByTestId('builder-split-ppl')).toHaveTextContent('Your recent split');
  });

  it('recommends the lifter’s own split and says so (round 22)', () => {
    render(
      <SplitChooser value="Upper/Lower" recommended="Upper/Lower" matchesHistory="Upper/Lower" sessionsPerWeek={4} onChoose={jest.fn()} />
    );
    expect(screen.getByTestId('builder-split-upperlower')).toHaveTextContent('Recommended · your split');
    expect(screen.getByTestId('builder-split-fullbody')).not.toHaveTextContent('Recommended');
  });
});

describe('StartingVolumeChooser', () => {
  it('maps each choice to the landmarks and reports the pick', async () => {
    const onChange = jest.fn();
    render(
      <StartingVolumeChooser
        value="standard"
        onChange={onChange}
        examples={{ high: 'e.g. quads 19, back 24 sets a week' }}
      />
    );
    expect(screen.getByTestId('builder-starting-volume-standard')).toHaveTextContent('at MAV');
    expect(screen.getByTestId('builder-starting-volume-conservative')).toHaveTextContent('halfway from MEV to MAV');
    expect(screen.getByTestId('builder-starting-volume-high')).toHaveTextContent('quads 19');
    await userEvent.setup().click(screen.getByTestId('builder-starting-volume-high'));
    expect(onChange).toHaveBeenCalledWith('high');
  });
});

describe('PriorityFrequencyWarning', () => {
  const base = {
    muscles: [{ label: 'Hamstrings', muscleGroup: 'hamstrings' as const }],
    split: 'Bro Split',
    ceiling: 12,
    canRaiseCeiling: true,
    onRaiseCeiling: jest.fn(),
    twiceWeeklySplit: 'Upper/Lower' as const,
    onSwitchSplit: jest.fn(),
  };

  it('warns where priority is set, with both one-tap fixes', async () => {
    const onRaiseCeiling = jest.fn();
    const onSwitchSplit = jest.fn();
    render(<PriorityFrequencyWarning {...base} onRaiseCeiling={onRaiseCeiling} onSwitchSplit={onSwitchSplit} />);
    expect(screen.getByTestId('builder-priority-frequency-warning')).toHaveTextContent(
      'Bro Split trains Hamstrings once a week'
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('builder-priority-fix-ceiling'));
    expect(onRaiseCeiling).toHaveBeenCalled();
    await user.click(screen.getByTestId('builder-priority-fix-split'));
    expect(onSwitchSplit).toHaveBeenCalledWith('Upper/Lower');
  });

  it('offers no raise to a lifter who cannot raise it, and nothing without a muscle', () => {
    const { rerender } = render(<PriorityFrequencyWarning {...base} canRaiseCeiling={false} />);
    expect(screen.queryByTestId('builder-priority-fix-ceiling')).toBeNull();
    rerender(<PriorityFrequencyWarning {...base} muscles={[]} />);
    expect(screen.queryByTestId('builder-priority-frequency-warning')).toBeNull();
  });
});

describe('plan building', () => {
  it('says the plan is building, and holds the save until it is', () => {
    const { rerender } = render(<PlanBuildingIndicator active />);
    expect(screen.getByTestId('builder-plan-building')).toHaveTextContent('Building your plan');
    rerender(<PlanBuildingIndicator active={false} />);
    expect(screen.queryByTestId('builder-plan-building')).toBeNull();

    render(
      <SaveBlockBar onBack={jest.fn()} onSave={jest.fn()} isSaving={false} saved={false} error={null} blockName="B" isBuilding />
    );
    expect(screen.getByTestId('builder-save')).toBeDisabled();
    expect(screen.getByTestId('builder-save')).toHaveTextContent('Building your plan');
  });
});
