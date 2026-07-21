/**
 * Unit tests for the shared muscle hierarchy list: chevron expansion, pinned
 * (lagging) children, divergence auto-expand with user override, and the
 * per-user-per-surface localStorage persistence that must survive app restarts
 * (simulated here as unmount + fresh mount).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

jest.mock('@/stores', () => ({
  useUserStore: () => ({ user: { id: 'u1' } }),
}));

import {
  MuscleGroupList,
  useMuscleRowExpansion,
  withVisibleChildren,
  type MuscleListRow,
} from '../MuscleGroupList';

interface FixtureChild {
  muscle: string;
  pinned?: boolean;
}
interface FixtureRow extends MuscleListRow<FixtureChild> {
  children: FixtureChild[];
}

const ROWS: FixtureRow[] = [
  {
    muscle: 'shoulders',
    displayName: 'Shoulders',
    children: [{ muscle: 'front_delts' }, { muscle: 'lateral_delts' }, { muscle: 'rear_delts' }],
  },
  { muscle: 'biceps', displayName: 'Biceps', children: [] },
  {
    muscle: 'back',
    displayName: 'Back',
    children: [{ muscle: 'lats' }, { muscle: 'erectors', pinned: true }],
  },
];

function Harness({
  rows = ROWS,
  surface = 'test',
  renderRowDetail,
}: {
  rows?: FixtureRow[];
  surface?: string;
  renderRowDetail?: (row: FixtureRow) => ReactNode;
}) {
  const expansion = useMuscleRowExpansion(surface, rows);
  return (
    <MuscleGroupList
      rows={rows}
      expansion={expansion}
      renderRow={(row) => <span>{row.displayName}</span>}
      renderChild={(child) => <span>{child.muscle}</span>}
      pinChild={(child) => child.pinned === true}
      renderRowDetail={renderRowDetail}
      testIdPrefix="row"
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('MuscleGroupList', () => {
  it('renders every row; only rows with children get a chevron toggle', () => {
    render(<Harness />);
    expect(screen.getByTestId('row-shoulders')).toBeInTheDocument();
    expect(screen.getByTestId('row-biceps')).toBeInTheDocument();
    expect(screen.getByTestId('row-toggle-shoulders')).toBeInTheDocument();
    expect(screen.queryByTestId('row-toggle-biceps')).not.toBeInTheDocument();
  });

  it('children hide behind the chevron; pinned children stay visible while collapsed', () => {
    render(<Harness />);
    // Collapsed shoulders: no members visible.
    expect(screen.queryByTestId('row-lateral_delts')).not.toBeInTheDocument();
    // Collapsed back: the pinned (lagging) erectors child is still visible.
    expect(screen.getByTestId('row-erectors')).toBeInTheDocument();
    expect(screen.queryByTestId('row-lats')).not.toBeInTheDocument();
  });

  it('toggling expands all children and aria-expanded tracks it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByTestId('row-toggle-shoulders');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('row-front_delts')).toBeInTheDocument();
    expect(screen.getByTestId('row-lateral_delts')).toBeInTheDocument();
    expect(screen.getByTestId('row-rear_delts')).toBeInTheDocument();
  });

  it('persists expansion per user per surface across a fresh mount (app restart)', async () => {
    const user = userEvent.setup();
    const first = render(<Harness />);
    await user.click(screen.getByTestId('row-toggle-shoulders'));
    expect(screen.getByTestId('row-lateral_delts')).toBeInTheDocument();
    first.unmount();

    // Fresh mount, same surface + user → still expanded (localStorage).
    const second = render(<Harness />);
    expect(screen.getByTestId('row-lateral_delts')).toBeInTheDocument();
    second.unmount();

    // The choice is keyed per surface — a different surface starts collapsed.
    render(<Harness surface="other" />);
    expect(screen.queryByTestId('row-lateral_delts')).not.toBeInTheDocument();
  });

  it('an explicit collapse hides pinned children too, and persists; re-expanding restores the pin default after a reset', async () => {
    const user = userEvent.setup();
    const first = render(<Harness />);
    // Untouched back: pinned erectors visible by default.
    expect(screen.getByTestId('row-erectors')).toBeInTheDocument();

    // Expand, then explicitly collapse — everything hides, pin included.
    await user.click(screen.getByTestId('row-toggle-back'));
    expect(screen.getByTestId('row-lats')).toBeInTheDocument();
    await user.click(screen.getByTestId('row-toggle-back'));
    expect(screen.queryByTestId('row-erectors')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-lats')).not.toBeInTheDocument();
    first.unmount();

    // The full collapse survives a restart.
    render(<Harness />);
    expect(screen.queryByTestId('row-erectors')).not.toBeInTheDocument();
  });

  it('renderRowDetail makes a childless row expandable and reveals the detail behind the chevron', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        renderRowDetail={(row) => (row.muscle === 'biceps' ? <span data-testid="detail-biceps">detail</span> : null)}
      />
    );

    // Biceps has no children but a detail → it now gets a toggle; the detail
    // stays hidden until expanded.
    const toggle = screen.getByTestId('row-toggle-biceps');
    expect(screen.queryByTestId('detail-biceps')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('detail-biceps')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByTestId('detail-biceps')).not.toBeInTheDocument();

    // A row for which the renderer returns null stays chevronless… unless it
    // has children (shoulders keeps its toggle regardless).
    expect(screen.getByTestId('row-toggle-shoulders')).toBeInTheDocument();
  });

  it('renders the detail after the children when a parent with both expands', async () => {
    const user = userEvent.setup();
    render(<Harness renderRowDetail={() => <span data-testid="detail-any">detail</span>} />);

    await user.click(screen.getByTestId('row-toggle-shoulders'));
    const shoulders = screen.getByTestId('row-shoulders');
    expect(shoulders.querySelector('[data-testid="detail-any"]')).toBeInTheDocument();
    expect(screen.getByTestId('row-lateral_delts')).toBeInTheDocument();
  });

  it('autoExpand defaults a divergent parent open; an explicit collapse overrides and persists', async () => {
    const user = userEvent.setup();
    const rows: FixtureRow[] = [{ ...ROWS[0], autoExpand: true }];

    const first = render(<Harness rows={rows} />);
    // Self-revealed without any stored choice.
    expect(screen.getByTestId('row-lateral_delts')).toBeInTheDocument();

    // The user's collapse wins over the divergence default…
    await user.click(screen.getByTestId('row-toggle-shoulders'));
    expect(screen.queryByTestId('row-lateral_delts')).not.toBeInTheDocument();
    first.unmount();

    // …and survives a restart.
    render(<Harness rows={rows} />);
    expect(screen.queryByTestId('row-lateral_delts')).not.toBeInTheDocument();
  });
});

describe('withVisibleChildren', () => {
  it('narrows children to expanded-or-pinned, mirroring the rendered list', () => {
    const expanded = new Set(['shoulders']);
    const visible = withVisibleChildren(ROWS, expanded, (c) => c.pinned === true);
    expect(visible.find((r) => r.muscle === 'shoulders')!.children).toHaveLength(3);
    expect(visible.find((r) => r.muscle === 'back')!.children.map((c) => c.muscle)).toEqual([
      'erectors',
    ]);
    expect(visible.find((r) => r.muscle === 'biceps')!.children).toHaveLength(0);
  });

  it('an explicitly collapsed parent hides its pinned children, mirroring the rendered list', () => {
    const expanded = new Set<string>();
    const collapsed = new Set(['back']);
    const visible = withVisibleChildren(ROWS, expanded, (c) => c.pinned === true, collapsed);
    expect(visible.find((r) => r.muscle === 'back')!.children).toHaveLength(0);
  });
});
