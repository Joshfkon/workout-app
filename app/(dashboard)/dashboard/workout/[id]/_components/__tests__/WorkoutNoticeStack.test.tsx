/**
 * UX panel round 21 (Dre): "Banners and warnings clutter the top of the
 * workout screen". One banner at a time; the rest behind "N more notes";
 * safety notices never collapse.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkoutNoticeStack, moreNotesLabel, splitNotices, type WorkoutNotice } from '../WorkoutNoticeStack';

const notice = (key: string, safety = false): WorkoutNotice => ({
  key,
  safety,
  node: <p>{key} banner</p>,
});

describe('splitNotices', () => {
  it('shows only the first notice and collapses the rest', () => {
    const { shown, collapsed } = splitNotices([notice('offline'), notice('readiness'), notice('recalc')]);
    expect(shown.map((n) => n.key)).toEqual(['offline']);
    expect(collapsed.map((n) => n.key)).toEqual(['readiness', 'recalc']);
  });

  it('never collapses a safety notice, and collapses everything else while one is up', () => {
    const { shown, collapsed } = splitNotices([notice('offline'), notice('pain', true), notice('recalc')]);
    expect(shown.map((n) => n.key)).toEqual(['pain']);
    expect(collapsed.map((n) => n.key)).toEqual(['offline', 'recalc']);
  });

  it('is empty with no notices', () => {
    expect(splitNotices([])).toEqual({ shown: [], collapsed: [] });
  });

  it('labels the disclosure', () => {
    expect(moreNotesLabel(1)).toBe('1 more note');
    expect(moreNotesLabel(3)).toBe('3 more notes');
  });
});

describe('WorkoutNoticeStack', () => {
  it('renders nothing without notices', () => {
    const { container } = render(<WorkoutNoticeStack notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one banner and opens the rest on request', async () => {
    const user = userEvent.setup();
    render(<WorkoutNoticeStack notices={[notice('offline'), notice('readiness'), notice('recalc')]} />);
    expect(screen.getByText('offline banner')).toBeInTheDocument();
    expect(screen.queryByText('readiness banner')).not.toBeInTheDocument();

    const more = screen.getByRole('button', { name: '2 more notes' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.getByText('readiness banner')).toBeInTheDocument();
    expect(screen.getByText('recalc banner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide notes' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('has no disclosure for a single notice', () => {
    render(<WorkoutNoticeStack notices={[notice('offline')]} />);
    expect(screen.queryByTestId('workout-notices-more')).not.toBeInTheDocument();
  });
});
