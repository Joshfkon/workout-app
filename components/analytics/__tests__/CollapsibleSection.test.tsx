/**
 * Hideable secondary Progress sections (UX panel: "let users hide the
 * Strength, photos and phases sections"), remembered per viewer.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection } from '../CollapsibleSection';
import { readSectionHidden, SECTION_COLLAPSE_KEY_PREFIX, writeSectionHidden } from '../sectionCollapse';
import { LiftTrendsSkeleton, ProgressSummarySkeleton } from '../RegionSkeletons';

describe('sectionCollapse storage', () => {
  it('round-trips a hidden section and forgets it when shown again', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(readSectionHidden('photos', storage)).toBe(false);
    writeSectionHidden('photos', true, storage);
    expect(store.get(`${SECTION_COLLAPSE_KEY_PREFIX}photos`)).toBe('1');
    expect(readSectionHidden('photos', storage)).toBe(true);
    expect(readSectionHidden('phase', storage)).toBe(false);
    writeSectionHidden('photos', false, storage);
    expect(readSectionHidden('photos', storage)).toBe(false);
  });

  it('never throws when storage is blocked, and shows the section', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSectionHidden('phase', throwing)).toBe(false);
    expect(() => writeSectionHidden('phase', true, throwing)).not.toThrow();
    expect(readSectionHidden('phase', null)).toBe(false);
  });
});

describe('CollapsibleSection', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows by default, hides on tap, and remembers the choice on the next visit', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CollapsibleSection id="photos" title="Photos">
        <p>photo grid</p>
      </CollapsibleSection>
    );
    expect(screen.getByText('photo grid')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Hide photos' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(screen.queryByText('photo grid')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Photos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show photos' })).toHaveAttribute('aria-expanded', 'false');
    unmount();

    render(
      <CollapsibleSection id="photos" title="Photos">
        <p>photo grid</p>
      </CollapsibleSection>
    );
    expect(screen.queryByText('photo grid')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show photos' }));
    expect(screen.getByText('photo grid')).toBeInTheDocument();
    expect(window.localStorage.getItem(`${SECTION_COLLAPSE_KEY_PREFIX}photos`)).toBeNull();
  });

  it('keeps each section separate', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CollapsibleSection id="phase" title="Phase">
          <p>phase card</p>
        </CollapsibleSection>
        <CollapsibleSection id="strength-level" title="Strength level">
          <p>score card</p>
        </CollapsibleSection>
      </>
    );
    await user.click(screen.getByRole('button', { name: 'Hide phase' }));
    expect(screen.queryByText('phase card')).not.toBeInTheDocument();
    expect(screen.getByText('score card')).toBeInTheDocument();
  });
});

describe('region skeletons', () => {
  it('announce loading for their region only', () => {
    render(
      <>
        <ProgressSummarySkeleton />
        <LiftTrendsSkeleton />
      </>
    );
    expect(screen.getByTestId('progress-summary-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('lift-trends-loading')).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('analytics-full-loading')).not.toBeInTheDocument();
  });
});
