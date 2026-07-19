/**
 * MeasurementTrendCard — date-range filtering over the per-site tape trend.
 *
 * Chart internals (Recharts) render empty at jsdom's zero size; the LineChart
 * stub captures the `data` prop so we can assert how many points survive the
 * selected range without pixel output.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Recharts' ES-module build doesn't resolve under Jest, and jsdom has no
// layout anyway — stub the chart primitives; we assert on component logic.
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  LineChart: ({ data }: { data?: unknown[] }) => (
    <div data-testid="line-chart" data-points={data?.length ?? 0} />
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

let mockRows: Array<Record<string, unknown>> = [];
/** Every update/delete the card issued, so tests can assert the write path. */
let mockMutations: Array<{
  type: 'update' | 'delete';
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}> = [];

// Chainable builder covering the card's three query shapes: the history
// fetch (select→eq→order), the delete helper's row lookup
// (select→eq→eq→maybeSingle), and the mutations (update/delete→eq→eq,
// awaited as thenables). Mutations are applied to mockRows so the card's
// post-save refetch sees the new state.
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: {
      // The card resolves identity from the locally persisted session
      // (getLocalUserId → getSession), never a getUser() network round trip.
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
    },
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const sel = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return sel;
          },
          // Fresh row copies each fetch — returning the same references would
          // let React bail out of the post-mutation setRows.
          order: async () => ({ data: mockRows.map((r) => ({ ...r })) }),
          maybeSingle: async () => ({
            data: mockRows.find((r) => r.logged_at === filters.logged_at) ?? null,
            error: null,
          }),
        };
        return sel;
      },
      update: (payload: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const upd = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return upd;
          },
          then(resolve: (v: { error: null }) => void) {
            mockMutations.push({ type: 'update', payload, filters });
            const row = mockRows.find((r) => r.logged_at === filters.logged_at);
            if (row) Object.assign(row, payload);
            resolve({ error: null });
          },
        };
        return upd;
      },
      delete: () => {
        const filters: Record<string, unknown> = {};
        const del = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return del;
          },
          then(resolve: (v: { error: null }) => void) {
            mockMutations.push({ type: 'delete', filters });
            mockRows = mockRows.filter((r) => r.logged_at !== filters.logged_at);
            resolve({ error: null });
          },
        };
        return del;
      },
    }),
  }),
}));

import { MeasurementTrendCard } from '@/components/body/MeasurementTrendCard';

/** Local-timezone YYYY-MM-DD for `n` days ago (mirrors getLocalDateString). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const chestRow = (loggedAt: string, chestCm: number) => ({
  logged_at: loggedAt,
  chest: chestCm,
});

describe('MeasurementTrendCard date ranges', () => {
  beforeEach(() => {
    mockRows = [];
    mockMutations = [];
  });

  it('defaults to 1Y and excludes points older than a year', async () => {
    mockRows = [
      chestRow(daysAgo(400), 100),
      chestRow(daysAgo(200), 105),
      chestRow(daysAgo(10), 110),
      chestRow(daysAgo(1), 111),
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);

    const chart = await screen.findByTestId('line-chart');
    expect(chart).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('measurement-trend-range-1y')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('narrows to the last month and widens to full history', async () => {
    mockRows = [
      chestRow(daysAgo(400), 100),
      chestRow(daysAgo(200), 105),
      chestRow(daysAgo(10), 110),
      chestRow(daysAgo(1), 111),
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);
    const user = userEvent.setup();

    await screen.findByTestId('line-chart');

    await user.click(screen.getByTestId('measurement-trend-range-1m'));
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '2');

    await user.click(screen.getByTestId('measurement-trend-range-all'));
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '4');
  });

  it('points at a longer range when all history is outside the window', async () => {
    mockRows = [chestRow(daysAgo(500), 100), chestRow(daysAgo(400), 104)];
    render(<MeasurementTrendCard tapeUnit="cm" />);

    expect(
      await screen.findByText(/No measurements in this date range/)
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('measurement-trend-range-all'));
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '2');
  });

  it('lists each measured site with a direction badge and rate', async () => {
    mockRows = [
      { logged_at: daysAgo(60), chest: 100, waist: 90 },
      { logged_at: daysAgo(30), chest: 103, waist: 87 },
      { logged_at: daysAgo(1), chest: 106, waist: 84, neck: 38 },
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);

    const chestRowEl = await screen.findByTestId('measurement-trend-row-chest');
    expect(chestRowEl).toHaveTextContent('Chest');
    expect(chestRowEl).toHaveTextContent('Rising');
    expect(chestRowEl).toHaveTextContent('106.0 cm');
    expect(chestRowEl).toHaveTextContent('cm/mo');
    expect(chestRowEl).toHaveTextContent('3 entries');

    // Waist is shrinking → labeled Down (improvement coloring is CSS-only).
    expect(screen.getByTestId('measurement-trend-row-waist')).toHaveTextContent('Down');

    // One neck entry → no fitted trend yet.
    const neckRowEl = screen.getByTestId('measurement-trend-row-neck');
    expect(neckRowEl).toHaveTextContent('Building');
    expect(neckRowEl).toHaveTextContent('1 entry');

    // Tapping a row selects it for the detail chart.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('measurement-trend-row-waist'));
    expect(screen.getByText('Waist detail')).toBeInTheDocument();
  });
});

describe('MeasurementTrendCard entry editor', () => {
  beforeEach(() => {
    mockRows = [];
    mockMutations = [];
  });

  it('edits a historical entry in place and refetches', async () => {
    mockRows = [
      { logged_at: daysAgo(20), chest: 100 },
      { logged_at: daysAgo(10), chest: 102 },
      { logged_at: daysAgo(1), chest: 104 },
    ];
    const onDataChanged = jest.fn();
    render(<MeasurementTrendCard tapeUnit="cm" onDataChanged={onDataChanged} />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('measurement-entries-toggle'));

    const badDate = daysAgo(10);
    await user.click(screen.getByTestId(`measurement-entry-edit-${badDate}`));
    const input = screen.getByTestId('measurement-entry-input');
    await user.clear(input);
    await user.type(input, '95.5');
    await user.click(screen.getByTestId('measurement-entry-save'));

    expect(mockMutations).toEqual([
      {
        type: 'update',
        payload: { chest: 95.5 },
        filters: { user_id: 'user-1', logged_at: badDate },
      },
    ]);
    expect(onDataChanged).toHaveBeenCalled();
    // Post-save refetch shows the corrected value in the list.
    expect(
      await screen.findByText('95.5 cm')
    ).toBeInTheDocument();
  });

  it('converts an inch input back to cm before saving', async () => {
    mockRows = [
      { logged_at: daysAgo(5), right_thigh: 54.6 },
      { logged_at: daysAgo(1), right_thigh: 35.8 }, // the mislogged calf value
    ];
    render(<MeasurementTrendCard tapeUnit="in" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('measurement-entries-toggle'));
    await user.click(screen.getByTestId(`measurement-entry-edit-${daysAgo(1)}`));
    const input = screen.getByTestId('measurement-entry-input');
    await user.clear(input);
    await user.type(input, '21.5');
    await user.click(screen.getByTestId('measurement-entry-save'));

    expect(mockMutations).toHaveLength(1);
    expect(mockMutations[0].type).toBe('update');
    expect(mockMutations[0].payload?.right_thigh as number).toBeCloseTo(54.61, 2);
  });

  it('rejects a non-positive value without writing', async () => {
    mockRows = [
      { logged_at: daysAgo(5), chest: 100 },
      { logged_at: daysAgo(1), chest: 102 },
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('measurement-entries-toggle'));
    await user.click(screen.getByTestId(`measurement-entry-edit-${daysAgo(1)}`));
    await user.clear(screen.getByTestId('measurement-entry-input'));
    await user.click(screen.getByTestId('measurement-entry-save'));

    expect(mockMutations).toHaveLength(0);
    expect(screen.getByTestId('measurement-entry-error')).toHaveTextContent(
      'greater than 0'
    );
  });

  it('deleting nulls the site when the day-row has other values', async () => {
    mockRows = [
      { logged_at: daysAgo(5), right_thigh: 54, waist: 86 },
      { logged_at: daysAgo(1), right_thigh: 35.8, waist: 85 },
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);
    const user = userEvent.setup();

    // Select the thigh row explicitly (sort order may differ).
    await user.click(await screen.findByTestId('measurement-trend-row-right_thigh'));
    await user.click(screen.getByTestId('measurement-entries-toggle'));
    await user.click(screen.getByTestId(`measurement-entry-delete-${daysAgo(1)}`));
    // Two-step confirm.
    await user.click(screen.getByTestId('measurement-entry-delete-confirm'));

    expect(mockMutations).toEqual([
      {
        type: 'update',
        payload: { right_thigh: null },
        filters: { user_id: 'user-1', logged_at: daysAgo(1) },
      },
    ]);
  });

  it('deleting the only value on a day removes the whole row', async () => {
    mockRows = [
      { logged_at: daysAgo(5), chest: 100 },
      { logged_at: daysAgo(1), chest: 102 },
    ];
    const onDataChanged = jest.fn();
    render(<MeasurementTrendCard tapeUnit="cm" onDataChanged={onDataChanged} />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('measurement-entries-toggle'));
    await user.click(screen.getByTestId(`measurement-entry-delete-${daysAgo(1)}`));
    await user.click(screen.getByTestId('measurement-entry-delete-confirm'));

    expect(mockMutations).toEqual([
      { type: 'delete', filters: { user_id: 'user-1', logged_at: daysAgo(1) } },
    ]);
    expect(onDataChanged).toHaveBeenCalled();
  });
});
