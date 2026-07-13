/**
 * DailyCheckIn — the sleep step captures BOTH fields (hours stepper +
 * poor/ok/good chips) and the submit dual-writes them: the 1-5 rating bridge
 * onto daily_check_ins (readiness scorer input) AND the sleep_log upsert the
 * Sleep card / recovery model read.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DailyCheckIn } from '@/components/dashboard/DailyCheckIn';
import { SLEEP_QUALITY_TO_RATING } from '@/types/schema';

// Chainable fake Supabase client: reads resolve empty (fresh day, no prior
// sleep entry), writes are recorded per table.
const upsertCalls: Record<string, [Record<string, unknown>, { onConflict: string }][]> = {
  daily_check_ins: [],
  sleep_log: [],
};

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    eq: self,
    gte: self,
    order: self,
    limit: self,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async (row: Record<string, unknown>, options: { onConflict: string }) => {
      upsertCalls[table]?.push([row, options]);
      return { error: null };
    },
  });
  return chain;
}

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({ from: (table: string) => makeChain(table) }),
}));

function renderCheckIn(onComplete?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DailyCheckIn userId="user-1" userGoal="bulk" onComplete={onComplete} />
    </QueryClientProvider>
  );
}

describe('DailyCheckIn sleep capture', () => {
  beforeEach(() => {
    upsertCalls.daily_check_ins.length = 0;
    upsertCalls.sleep_log.length = 0;
  });

  it('captures hours (0.5-step stepper) + quality chips and saves both fields to both tables', async () => {
    const user = userEvent.setup();
    const onComplete = jest.fn();
    renderCheckIn(onComplete);

    // Sleep step (step 1 of 4 for a non-cut goal): default 7h, bump to 7.5h.
    expect(await screen.findByTestId('sleep-hours-value')).toHaveTextContent('7h');
    await user.click(screen.getByRole('button', { name: 'Increase hours' }));
    expect(screen.getByTestId('sleep-hours-value')).toHaveTextContent('7.5h');
    await user.click(screen.getByTestId('sleep-quality-good'));

    // Walk the remaining steps (energy, mood, soreness) and complete.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Complete' }));

    // daily_check_ins keeps the 1-5 rating column via the shared bridge.
    expect(upsertCalls.daily_check_ins).toHaveLength(1);
    const [checkInRow, checkInOptions] = upsertCalls.daily_check_ins[0];
    expect(checkInOptions).toEqual({ onConflict: 'user_id,date' });
    expect(checkInRow).toMatchObject({
      sleep_hours: 7.5,
      sleep_quality: SLEEP_QUALITY_TO_RATING.good,
    });

    // sleep_log gets the raw pair, one row per local day (upsert).
    expect(upsertCalls.sleep_log).toHaveLength(1);
    const [sleepRow, sleepOptions] = upsertCalls.sleep_log[0];
    expect(sleepOptions).toEqual({ onConflict: 'user_id,local_day' });
    expect(sleepRow).toMatchObject({
      user_id: 'user-1',
      hours: 7.5,
      quality: 'good',
      source: 'manual',
    });
    expect(sleepRow.local_day).toBe(checkInRow.date);

    expect(onComplete).toHaveBeenCalled();
  });
});
