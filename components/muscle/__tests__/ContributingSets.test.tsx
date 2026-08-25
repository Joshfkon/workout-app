/**
 * Unit tests for the shared counted-sets drill-down: the panel's exercise
 * list + fractional-credit footnote, and the fine-child disclosure wrapper
 * (tap-to-toggle, no-op passthrough when there's nothing to show).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  ContributingSets,
  SourcesDisclosure,
  formatCreditedSets,
  formatPerformedToCredited,
} from '../ContributingSets';

describe('formatCreditedSets', () => {
  it('keeps fractions and pluralizes', () => {
    expect(formatCreditedSets(4)).toBe('4 sets');
    expect(formatCreditedSets(1)).toBe('1 set');
    expect(formatCreditedSets(1.5)).toBe('1.5 sets');
    // Guards against float drift from repeated credit merges.
    expect(formatCreditedSets(2.4999999)).toBe('2.5 sets');
  });
});

describe('formatPerformedToCredited', () => {
  it('shows performed → credited when the fractional math changed the count', () => {
    expect(formatPerformedToCredited(4, 1.3333)).toBe('4 sets → 1.3 credited');
    expect(formatPerformedToCredited(3, 1.5)).toBe('3 sets → 1.5 credited');
    expect(formatPerformedToCredited(1, 0.5)).toBe('1 set → 0.5 credited');
  });

  it('collapses to the plain count when credit equals performed (full-credit direct work)', () => {
    expect(formatPerformedToCredited(4, 4)).toBe('4 sets');
    expect(formatPerformedToCredited(4, 3.99999)).toBe('4 sets');
  });

  it('falls back to credited-only when performed is unavailable (pre-migration cache shapes)', () => {
    expect(formatPerformedToCredited(undefined, 1.5)).toBe('1.5 sets');
    expect(formatPerformedToCredited(0, 1.5)).toBe('1.5 sets');
  });
});

describe('ContributingSets', () => {
  it('lists each exercise with its credited sets; no footnote for whole counts', () => {
    render(
      <ContributingSets
        muscle="chest"
        testIdPrefix="volume-sources"
        exercises={[
          { id: 'e1', name: 'Incline Press', performedSets: 8, sets: 8, effective: 8, direct: 8, indirect: 0, directEffective: 8, indirectEffective: 0 },
          { id: 'e2', name: 'Dips', performedSets: 2, sets: 2, effective: 2, direct: 2, indirect: 0, directEffective: 2, indirectEffective: 0 },
        ]}
      />
    );
    const panel = screen.getByTestId('volume-sources-chest');
    expect(panel).toHaveTextContent('Incline Press');
    expect(panel).toHaveTextContent('8 sets');
    expect(panel).toHaveTextContent('Dips');
    expect(panel).toHaveTextContent('2 sets');
    expect(panel).not.toHaveTextContent('shared credit');
  });

  it('explains fractional counts with the shared-credit footnote', () => {
    render(
      <ContributingSets
        muscle="triceps"
        testIdPrefix="volume-sources"
        exercises={[{ id: 'e1', name: 'Bench Press', performedSets: 3, sets: 1.5, effective: 1.5, direct: 0, indirect: 1.5, directEffective: 0, indirectEffective: 1.5 }]}
      />
    );
    const panel = screen.getByTestId('volume-sources-triceps');
    // The fractional credit shows next to the sets actually performed —
    // the panel exposes the input of the math, not just its output.
    expect(panel).toHaveTextContent('3 sets → 1.5 credited');
    expect(panel).toHaveTextContent('shared credit');
  });

  it('labels the panel with its muscle scope when one is provided', () => {
    render(
      <ContributingSets
        muscle="shoulders"
        testIdPrefix="volume-sources"
        scopeLabel="Shoulders · whole group"
        exercises={[
          { id: 'e1', name: 'Arnold Press', performedSets: 4, sets: 4, effective: 4, direct: 4, indirect: 0, directEffective: 4, indirectEffective: 0 },
        ]}
      />
    );
    expect(screen.getByTestId('volume-sources-shoulders')).toHaveTextContent(
      'Shoulders · whole group · Counted sets'
    );
  });

  it('explains the dedup on a group-scope panel, so the header need not equal Σ(sub-muscle rows)', () => {
    // The group total is capped at 1.0 credit per performed set per exercise,
    // while each sub-muscle row keeps its uncapped per-head credit — so the two
    // legitimately differ. Say why, rather than leaving the user to reconcile.
    render(
      <ContributingSets
        muscle="back"
        testIdPrefix="volume-sources"
        scopeLabel="Back · whole group"
        groupScope
        exercises={[
          { id: 'e1', name: 'Barbell Row', performedSets: 8, sets: 8, effective: 8, direct: 8, indirect: 0, directEffective: 8, indirectEffective: 0 },
        ]}
      />
    );
    expect(screen.getByTestId('volume-sources-group-dedup-note-back')).toHaveTextContent(
      'A set counts once for the group'
    );
  });

  it('omits the dedup note on a single sub-muscle panel, where nothing is deduped', () => {
    render(
      <ContributingSets
        muscle="lats"
        testIdPrefix="volume-sources"
        scopeLabel="Lats"
        exercises={[
          { id: 'e1', name: 'Lat Pulldown', performedSets: 4, sets: 4, effective: 4, direct: 4, indirect: 0, directEffective: 4, indirectEffective: 0 },
        ]}
      />
    );
    expect(
      screen.queryByTestId('volume-sources-group-dedup-note-lats')
    ).not.toBeInTheDocument();
  });
});

describe('SourcesDisclosure', () => {
  it('toggles the panel on tap and tracks aria-expanded', async () => {
    const user = userEvent.setup();
    render(
      <SourcesDisclosure
        muscle="lats"
        displayName="Lats"
        testIdPrefix="volume-sources"
        exercises={[{ id: 'e1', name: 'Pulldown', performedSets: 6, sets: 6, effective: 6, direct: 6, indirect: 0, directEffective: 6, indirectEffective: 0 }]}
      >
        <span>row content</span>
      </SourcesDisclosure>
    );

    const toggle = screen.getByTestId('volume-sources-toggle-lats');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('volume-sources-lats')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('volume-sources-lats')).toHaveTextContent('Pulldown');

    await user.click(toggle);
    expect(screen.queryByTestId('volume-sources-lats')).not.toBeInTheDocument();
  });

  it('renders the content untouched (no toggle) when there is nothing to show', () => {
    render(
      <SourcesDisclosure muscle="lats" displayName="Lats" testIdPrefix="volume-sources" exercises={[]}>
        <span>row content</span>
      </SourcesDisclosure>
    );
    expect(screen.getByText('row content')).toBeInTheDocument();
    expect(screen.queryByTestId('volume-sources-toggle-lats')).not.toBeInTheDocument();
  });
});

describe('secondary (indirect-only) annotation', () => {
  it('tags indirect-only entries and leaves direct entries untagged', () => {
    render(
      <ContributingSets
        muscle="front_delts"
        testIdPrefix="volume-sources"
        exercises={[
          // Direct work — no tag.
          { id: 'ohp', name: 'Overhead Press', performedSets: 4, sets: 4, effective: 4, direct: 4, indirect: 0, directEffective: 4, indirectEffective: 0 },
          // Pure secondary credit (a bench variant on the front-delt row) — tagged.
          { id: 'bench', name: 'Barbell Bench Press', performedSets: 3, sets: 1.5, effective: 1.5, direct: 0, indirect: 1.5, directEffective: 0, indirectEffective: 1.5 },
        ]}
      />
    );
    expect(screen.queryByTestId('volume-sources-secondary-ohp')).not.toBeInTheDocument();
    const tag = screen.getByTestId('volume-sources-secondary-bench');
    expect(tag).toHaveTextContent(/secondary/i);
    // The footer still explains what the tag means.
    expect(screen.getByTestId('volume-sources-front_delts')).toHaveTextContent('shared credit');
  });
});
