import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OnboardingBodyCompPage from '../page';

// ---- Supabase mock: a chainable builder resolved per table + operation ----
type Row = Record<string, unknown>;
let usersRow: Row | null = null;
const userUpdates: Row[] = [];
const stepWrites: unknown[] = [];

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let payload: Row | null = null;
  const result = () => {
    if (table === 'users' && op === 'select') return { data: usersRow, error: null };
    if (table === 'users' && op === 'update') {
      if (payload && 'onboarding_step' in payload) stepWrites.push(payload.onboarding_step);
      else if (payload) userUpdates.push(payload);
      return { data: null, error: null };
    }
    if (table === 'coaching_sessions' && op === 'insert') return { data: { id: 'sess-1' }, error: null };
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    eq: () => b,
    order: () => b,
    limit: () => b,
    single: () => Promise.resolve(result()),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return b;
}

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => builder(table),
  }),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
const mockUpdatePreference = jest.fn();
let mockStoredInjuryAreas: string[] = [];
jest.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { units: 'kg', injuryAreas: mockStoredInjuryAreas },
    updatePreference: (...args: unknown[]) => mockUpdatePreference(...args),
  }),
}));

async function reachGoalStep() {
  const user = userEvent.setup();
  render(<OnboardingBodyCompPage />);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Height (cm)'), '180');
  await user.type(screen.getByLabelText('Weight (kg)'), '80');
  await user.type(screen.getByLabelText('Body fat %'), '15');
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText("What's your goal right now?");
  return user;
}

describe('Onboarding goal step', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    stepWrites.length = 0;
    mockStoredInjuryAreas = [];
  });

  const injuryWrites = () => mockUpdatePreference.mock.calls.filter(([key]) => key === 'injuryAreas');

  it('preselects nothing for a fresh user (registration placeholder) and blocks Continue until a pick', async () => {
    // Registration writes goal='maintenance'; no onboarding step saved yet.
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep();

    for (const g of ['cut', 'maintenance', 'bulk']) {
      expect(screen.getByTestId(`goal-option-${g}`)).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.getByTestId('goal-continue')).toBeDisabled();
    expect(screen.getByTestId('goal-pick-hint')).toHaveTextContent('Pick one to continue');

    await user.click(screen.getByTestId('goal-option-cut'));
    expect(screen.getByTestId('goal-continue')).toBeEnabled();
    expect(screen.queryByTestId('goal-pick-hint')).not.toBeInTheDocument();
  });

  it('preselects a goal the user already saved in onboarding', async () => {
    usersRow = { goal: 'cut', onboarding_step: 'benchmarks', onboarding_completed: false };
    await reachGoalStep();

    await waitFor(() =>
      expect(screen.getByTestId('goal-option-cut')).toHaveAttribute('aria-pressed', 'true')
    );
    expect(screen.getByTestId('goal-continue')).toBeEnabled();
  });

  it('treats a finished onboarding as a real choice, even for maintenance', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: null, onboarding_completed: true };
    await reachGoalStep();
    await waitFor(() =>
      expect(screen.getByTestId('goal-option-maintenance')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('saves the optional injury answer as body areas in preferences, never injury_history', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep();

    await user.click(screen.getByTestId('goal-option-bulk'));
    await user.click(screen.getByTestId('injury-chip-shoulder'));
    await user.click(screen.getByTestId('injury-chip-lower_back'));
    await user.click(screen.getByTestId('goal-continue'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/benchmarks?session=sess-1'));
    expect(injuryWrites()).toEqual([['injuryAreas', ['shoulder', 'lower_back']]]);
    for (const u of userUpdates) expect(u).not.toHaveProperty('injury_history');
    expect(userUpdates.find((u) => 'goal' in u)).toMatchObject({ goal: 'bulk' });
    expect(stepWrites).toContain('goal');
  });

  it('writes nothing for injuries when the question is skipped, and never blocks Continue', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep();

    await user.click(screen.getByTestId('goal-option-cut'));
    expect(screen.getByTestId('goal-continue')).toBeEnabled();
    await user.click(screen.getByTestId('goal-continue'));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(injuryWrites()).toEqual([]);
  });

  it('"None" saves an empty list', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep();

    await user.click(screen.getByTestId('goal-option-cut'));
    await user.click(screen.getByTestId('injury-chip-none'));
    await user.click(screen.getByTestId('goal-continue'));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(injuryWrites()).toEqual([['injuryAreas', []]]);
  });

  it('restores saved areas on re-entry, and clearing them saves []', async () => {
    mockStoredInjuryAreas = ['knee'];
    usersRow = { goal: 'cut', onboarding_step: 'goal', onboarding_completed: false };
    const user = await reachGoalStep();

    expect(screen.getByTestId('injury-chip-knee')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('injury-chip-knee'));
    await user.click(screen.getByTestId('goal-continue'));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(injuryWrites()).toEqual([['injuryAreas', []]]);
  });
});
