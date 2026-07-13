/**
 * Calendar sheet integration tests, with the Supabase client mocked at the
 * module boundary so we can count round trips: a 31-day month must render
 * from ONE aggregate food_log query (plus the one-off phase-history read) —
 * never a per-day fetch.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NutritionCalendarSheet } from '../NutritionCalendarSheet';

// ---- Supabase client mock (chainable builder, thenable at the end) --------

const foodLogFetches: Array<Record<string, unknown>> = [];
let phaseHistoryFetches = 0;

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      // getLocalUserId reads the locally persisted session (no network).
      getSession: jest
        .fn()
        .mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }),
    },
    from: (table: string) => makeBuilder(table),
  }),
}));

function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  const builder: any = {
    select: () => builder,
    order: () => builder,
    eq: (col: string, val: unknown) => ((filters[col] = val), builder),
    gte: (col: string, val: unknown) => ((filters[`${col}>=`] = val), builder),
    lte: (col: string, val: unknown) => ((filters[`${col}<=`] = val), builder),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
      if (table === 'food_log') {
        foodLogFetches.push({ ...filters });
        return Promise.resolve(
          resolve({
            data: [
              // Cut side of the boundary: 88% of target → green on a cut
              { logged_at: '2026-07-10', calories: 2200 },
              // Bulk side, same intake: 88% → red on a bulk
              { logged_at: '2026-07-16', calories: 1100 },
              { logged_at: '2026-07-16', calories: 1100 },
            ],
            error: null,
          })
        );
      }
      if (table === 'phase_history') {
        phaseHistoryFetches += 1;
        return Promise.resolve(
          resolve({
            data: [
              { phase: 'cut', started_on: '2026-05-01' },
              { phase: 'bulk', started_on: '2026-07-15' },
            ],
            error: null,
          })
        );
      }
      return Promise.resolve(resolve({ data: [], error: null }));
    },
  };
  return builder;
}

// ----------------------------------------------------------------------------

function renderSheet(overrides: Partial<React.ComponentProps<typeof NutritionCalendarSheet>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSelectDate = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <NutritionCalendarSheet
        isOpen
        onClose={onClose}
        selectedDate="2026-07-20"
        onSelectDate={onSelectDate}
        calorieTarget={2500}
        currentPhase="bulk"
        eatingWindow={{ startMinutes: 7 * 60, endMinutes: 21 * 60 }}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return { ...utils, onSelectDate, onClose, client };
}

describe('NutritionCalendarSheet', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-07-20T12:00:00') });
    foodLogFetches.length = 0;
    phaseHistoryFetches = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const user = () => userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

  it('renders a 31-day month from ONE aggregate food_log query', async () => {
    renderSheet();

    await waitFor(() => expect(screen.getAllByTestId('day-ring-arc').length).toBeGreaterThan(0));

    // All 31 July day cells rendered…
    expect(screen.getAllByTestId('calendar-day')).toHaveLength(31);
    // …from exactly one food_log round trip covering the whole month range.
    expect(foodLogFetches).toHaveLength(1);
    expect(foodLogFetches[0]['logged_at>=']).toBe('2026-07-01');
    expect(foodLogFetches[0]['logged_at<=']).toBe('2026-07-31');
    // Phase history is its own single, month-independent read.
    expect(phaseHistoryFetches).toBe(1);
  });

  it('flips the ring color for identical intake across the cut→bulk boundary', async () => {
    renderSheet();

    // Jul 10 (cut, 88% under target) → green; Jul 16 (bulk, same 88%) → red.
    const green = await screen.findByLabelText('2026-07-10 — 88% of calorie target, green');
    const red = await screen.findByLabelText('2026-07-16 — 88% of calorie target, red');
    expect(green).toBeInTheDocument();
    expect(red).toBeInTheDocument();
  });

  it('shows phase-aware week nets with phase labels on a boundary month', async () => {
    renderSheet();

    await waitFor(() => expect(screen.getAllByTestId('day-ring-arc').length).toBeGreaterThan(0));
    const weeks = screen.getAllByTestId('week-summary');
    // 31 days + 3 leading pads = 5 week rows.
    expect(weeks).toHaveLength(5);

    // Week of Jul 5–11 holds the cut day: −300 net, harmless on a cut → green.
    const cutWeek = weeks.find((w) => w.textContent?.includes('−300'));
    expect(cutWeek).toBeDefined();
    expect(cutWeek!.dataset.tone).toBe('green');
    expect(cutWeek!.textContent).toContain('Cut');

    // Week of Jul 12–18 holds the bulk day: same −300 reads RED on a bulk.
    const bulkWeek = weeks.find(
      (w) => w.textContent?.includes('−300') && w.dataset.tone === 'red'
    );
    expect(bulkWeek).toBeDefined();
    expect(bulkWeek!.textContent).toContain('Bulk');
  });

  it('navigates the Eat tab to a tapped day and closes', async () => {
    const { onSelectDate, onClose } = renderSheet();
    const day = await screen.findByLabelText('2026-07-10 — 88% of calorie target, green');
    await user().click(day);
    expect(onSelectDate).toHaveBeenCalledWith('2026-07-10');
    expect(onClose).toHaveBeenCalled();
  });

  it('disables future days', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getAllByTestId('day-ring-arc').length).toBeGreaterThan(0));
    const future = screen.getByLabelText('2026-07-25 — nothing logged');
    expect(future).toBeDisabled();
  });

  it('pages months and jumps back with Today', async () => {
    const { onSelectDate } = renderSheet();
    await waitFor(() => expect(screen.getAllByTestId('day-ring-arc').length).toBeGreaterThan(0));

    await user().click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    // Paging fetched the new month — still one aggregate query per month.
    await waitFor(() => expect(foodLogFetches).toHaveLength(2));
    expect(foodLogFetches[1]['logged_at>=']).toBe('2026-06-01');
    expect(foodLogFetches[1]['logged_at<=']).toBe('2026-06-30');

    await user().click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(onSelectDate).not.toHaveBeenCalled();
  });
});
