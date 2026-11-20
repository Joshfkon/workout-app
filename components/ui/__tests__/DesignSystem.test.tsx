/**
 * Tests for the design-system building blocks: ListGroup/ListRow, StatTile,
 * Chip, SegmentedControl, ProgressRing, Sparkline — plus the cn() merge
 * rules that keep their custom scale classes from being dropped.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListGroup, ListRow } from '../ListRow';
import { StatTile } from '../StatTile';
import { Chip } from '../Chip';
import { SegmentedControl } from '../SegmentedControl';
import { ProgressRing } from '../ProgressRing';
import { Sparkline } from '../Sparkline';
import { cn } from '@/lib/utils';

describe('cn with design-system classes', () => {
  it('keeps a type-scale size next to a text colour', () => {
    expect(cn('text-body', 'text-ink')).toBe('text-body text-ink');
  });
  it('lets a later size or radius override an earlier one', () => {
    expect(cn('text-body', 'text-subhead')).toBe('text-subhead');
    expect(cn('rounded-button', 'rounded-full')).toBe('rounded-full');
  });
});

describe('ListGroup / ListRow', () => {
  it('puts a separator between rows only', () => {
    const { container } = render(
      <ListGroup title="Today">
        <ListRow title="Eat" />
        <ListRow title="Recovery" />
        <ListRow title="This week" />
      </ListGroup>
    );
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-sep')).toHaveLength(2);
  });

  it('renders a link with a chevron when given href', () => {
    render(<ListRow title="Weight & trends" subtitle="No weigh-in yet" href="/dashboard/nutrition/trends" />);
    const link = screen.getByRole('link', { name: /Weight & trends/ });
    expect(link).toHaveAttribute('href', '/dashboard/nutrition/trends');
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('renders a button when given onClick', () => {
    const onClick = jest.fn();
    render(<ListRow title="Joint aches" value="None" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Joint aches/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it('is static without href or onClick', () => {
    render(<ListRow title="185 × 8" value="Today" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('StatTile', () => {
  it('shows label, value, unit and a toned note', () => {
    render(<StatTile label="HRV" value={48} unit="ms" note="12% below usual" noteTone="warn" />);
    expect(screen.getByText('HRV')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('12% below usual')).toHaveClass('text-status-warn');
  });
});

describe('Chip', () => {
  it('reports pressed state and uses the tint when selected', () => {
    render(
      <Chip selected onClick={() => {}}>
        Push
      </Chip>
    );
    const chip = screen.getByRole('button', { name: 'Push' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveClass('bg-action-tint');
  });
});

describe('SegmentedControl', () => {
  it('is a radio group and reports changes', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl
        label="Add food"
        value="search"
        onChange={onChange}
        options={[
          { value: 'search', label: 'Search' },
          { value: 'scan', label: 'Scan' },
        ]}
      />
    );
    expect(screen.getByRole('radio', { name: 'Search' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Scan' }));
    expect(onChange).toHaveBeenCalledWith('scan');
  });
});

describe('ProgressRing', () => {
  it('draws no arc at zero and clamps above one', () => {
    const { rerender } = render(<ProgressRing progress={0} label="0 eaten" />);
    expect(screen.queryByTestId('progress-ring-arc')).toBeNull();
    rerender(<ProgressRing progress={3} label="over" size={100} strokeWidth={10} />);
    const arc = screen.getByTestId('progress-ring-arc');
    const c = 2 * Math.PI * 45;
    expect(arc.getAttribute('stroke-dasharray')).toBe(`${c} ${c}`);
    expect(screen.getByRole('img', { name: 'over' })).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('draws a polyline for two or more points and nothing otherwise', () => {
    const { container, rerender } = render(<Sparkline values={[1, 3, 2]} />);
    expect(container.querySelector('polyline')).not.toBeNull();
    rerender(<Sparkline values={[5]} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
