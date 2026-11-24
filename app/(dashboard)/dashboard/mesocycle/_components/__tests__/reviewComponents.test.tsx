import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveBlockBar } from '../SaveBlockBar';
import { ReviewVolumeTable } from '../ReviewVolumeTable';
import { SessionCeilingChooser } from '../SessionCeilingChooser';
import { hasSavedBlockFlag } from '../SavedBlockBanner';

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));

describe('SaveBlockBar', () => {
  const base = { onBack: jest.fn(), onSave: jest.fn(), isSaving: false, saved: false, error: null, blockName: 'Hypertrophy Block - Bro Split' };

  it('is a pinned, clearly labelled save that says where the block goes', async () => {
    const onSave = jest.fn();
    render(<SaveBlockBar {...base} onSave={onSave} />);
    expect(screen.getByTestId('builder-save-bar').className).toMatch(/sticky/);
    expect(screen.getByText(/Find it under Train → Plan/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save training block' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows a save failure beside the button', () => {
    render(<SaveBlockBar {...base} error="network down" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: network down');
  });

  it('confirms the save with the block name and where it lives', () => {
    render(<SaveBlockBar {...base} saved />);
    expect(screen.getByTestId('builder-saved')).toHaveTextContent('Saved “Hypertrophy Block - Bro Split”');
    expect(screen.getByTestId('builder-saved')).toHaveTextContent('under Train → Plan');
    expect(screen.queryByRole('button', { name: 'Save training block' })).toBeNull();
  });
});

describe('ReviewVolumeTable', () => {
  it('one row per muscle: sets, MEV–MRV, a status word and the priority star', () => {
    render(
      <ReviewVolumeTable
        rows={[
          { muscle: 'hamstrings', done: 19, target: 20, mev: 6, mrv: 20 },
          { muscle: 'chest', done: 11, target: 20, mev: 8, mrv: 22 },
          { muscle: 'calves', done: 6, target: 12, mev: 8, mrv: 20 },
        ]}
        showTarget
        prioritized={new Set(['hamstrings'])}
      />
    );
    const ham = screen.getByTestId('builder-volume-row-hamstrings');
    expect(ham).toHaveTextContent('19 of 20');
    expect(ham).toHaveTextContent('6–20');
    expect(ham).toHaveTextContent('In range');
    expect(screen.getByLabelText('high priority')).toBeInTheDocument();
    expect(screen.getByTestId('builder-volume-row-chest')).toHaveTextContent('Short of target');
    expect(screen.getByTestId('builder-volume-row-calves')).toHaveTextContent('At/below MEV');
  });
});

describe('SessionCeilingChooser', () => {
  it('offers 12 (default) to 16 with an honest note', async () => {
    const onChange = jest.fn();
    render(<SessionCeilingChooser value={12} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: '12 sets (default)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/diminishing returns past ~10–12/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: '16 sets' }));
    expect(onChange).toHaveBeenCalledWith(16);
  });
});

describe('hasSavedBlockFlag', () => {
  it('reads the builder flag only', () => {
    expect(hasSavedBlockFlag('?saved=1')).toBe(true);
    expect(hasSavedBlockFlag('')).toBe(false);
    expect(hasSavedBlockFlag('?saved=0')).toBe(false);
  });
});
