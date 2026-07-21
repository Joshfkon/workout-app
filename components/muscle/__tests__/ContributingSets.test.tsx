/**
 * Unit tests for the shared counted-sets drill-down: the panel's exercise
 * list + fractional-credit footnote, and the fine-child disclosure wrapper
 * (tap-to-toggle, no-op passthrough when there's nothing to show).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ContributingSets, SourcesDisclosure, formatCreditedSets } from '../ContributingSets';

describe('formatCreditedSets', () => {
  it('keeps fractions and pluralizes', () => {
    expect(formatCreditedSets(4)).toBe('4 sets');
    expect(formatCreditedSets(1)).toBe('1 set');
    expect(formatCreditedSets(1.5)).toBe('1.5 sets');
    // Guards against float drift from repeated credit merges.
    expect(formatCreditedSets(2.4999999)).toBe('2.5 sets');
  });
});

describe('ContributingSets', () => {
  it('lists each exercise with its credited sets; no footnote for whole counts', () => {
    render(
      <ContributingSets
        muscle="chest"
        testIdPrefix="volume-sources"
        exercises={[
          { id: 'e1', name: 'Incline Press', sets: 8, effective: 8, direct: 8, indirect: 0, directEffective: 8, indirectEffective: 0 },
          { id: 'e2', name: 'Dips', sets: 2, effective: 2, direct: 2, indirect: 0, directEffective: 2, indirectEffective: 0 },
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
        exercises={[{ id: 'e1', name: 'Bench Press', sets: 1.5, effective: 1.5, direct: 0, indirect: 1.5, directEffective: 0, indirectEffective: 1.5 }]}
      />
    );
    const panel = screen.getByTestId('volume-sources-triceps');
    expect(panel).toHaveTextContent('1.5 sets');
    expect(panel).toHaveTextContent('shared credit');
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
        exercises={[{ id: 'e1', name: 'Pulldown', sets: 6, effective: 6, direct: 6, indirect: 0, directEffective: 6, indirectEffective: 0 }]}
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
          { id: 'ohp', name: 'Overhead Press', sets: 4, effective: 4, direct: 4, indirect: 0, directEffective: 4, indirectEffective: 0 },
          // Pure secondary credit (a bench variant on the front-delt row) — tagged.
          { id: 'bench', name: 'Barbell Bench Press', sets: 1.5, effective: 1.5, direct: 0, indirect: 1.5, directEffective: 0, indirectEffective: 1.5 },
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
