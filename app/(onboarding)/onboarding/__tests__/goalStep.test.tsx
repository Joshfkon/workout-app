import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OnboardingBodyCompPage from '../page';

// ---- Supabase mock: a chainable builder resolved per table + operation ----
type Row = Record<string, unknown>;
let usersRow: Row | null = null;
const userUpdates: Row[] = [];
const stepWrites: unknown[] = [];
// When set, the coaching_sessions insert waits on it (to observe the busy state).
let coachingInsertGate: Promise<void> | null = null;
let coachingInserts = 0;

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
    single: () => {
      if (table === 'coaching_sessions' && op === 'insert') {
        coachingInserts += 1;
        if (coachingInsertGate) return coachingInsertGate.then(() => result());
      }
      return Promise.resolve(result());
    },
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
let mockStoredUnits = 'kg';
jest.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { units: mockStoredUnits, injuryAreas: mockStoredInjuryAreas },
    updatePreference: (...args: unknown[]) => mockUpdatePreference(...args),
  }),
}));

async function reachGoalStep(bodyFat = '15') {
  const user = userEvent.setup();
  render(<OnboardingBodyCompPage />);
  await user.click(screen.getByTestId('units-continue'));
  await user.click(await screen.findByRole('radio', { name: 'Male' }));
  await user.type(screen.getByLabelText('Height (cm)'), '180');
  await user.type(screen.getByLabelText('Weight (kg)'), '80');
  await user.type(screen.getByLabelText('Body fat %'), bodyFat);
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
    mockStoredUnits = 'kg';
    coachingInsertGate = null;
    coachingInserts = 0;
  });

  it('shows Continue as busy while saving and ignores a double tap', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    let release: () => void = () => {};
    coachingInsertGate = new Promise<void>((r) => (release = r));
    await reachGoalStep();

    const cont = screen.getByTestId('goal-continue');
    // Two taps in the same tick, before the busy state re-renders.
    act(() => {
      fireEvent.click(cont);
      fireEvent.click(cont);
    });
    await waitFor(() => expect(screen.getByTestId('goal-continue')).toHaveTextContent('Saving…'));
    expect(screen.getByTestId('goal-continue')).toBeDisabled();
    expect(screen.getByTestId('goal-continue')).toHaveAttribute('aria-busy', 'true');

    await act(async () => release());
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(coachingInserts).toBe(1);
    // Still busy while the route changes: no re-enabled button to tap again.
    expect(screen.getByTestId('goal-continue')).toBeDisabled();
  });

  it('presents the body-fat suggestion as information, not a second selection', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    // 10% (male) is lean enough for the bulk suggestion.
    await reachGoalStep('10');

    expect(screen.getByTestId('goal-body-fat-note')).toHaveTextContent(/a bulk could also suit you/);
    expect(screen.queryByText('Fits your body fat')).not.toBeInTheDocument();
    // Maintain stays the one selected option; Bulk carries no badge or highlight.
    expect(screen.getByTestId('goal-option-maintenance')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('goal-option-bulk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('goal-option-bulk').className).not.toMatch(/border-action/);
    expect(screen.getByTestId('goal-option-bulk')).toHaveTextContent(/^BulkBuild muscle\. Calorie surplus\.$/);
  });
});

describe('Onboarding goal step (saved choices)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    stepWrites.length = 0;
    mockStoredInjuryAreas = [];
    mockStoredUnits = 'kg';
  });

  const injuryWrites = () => mockUpdatePreference.mock.calls.filter(([key]) => key === 'injuryAreas');

  it('preselects Maintain for a fresh user so Continue works in one tap', async () => {
    // Registration writes goal='maintenance'; no onboarding step saved yet.
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep();

    expect(screen.getByTestId('goal-option-maintenance')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('goal-continue')).toBeEnabled();
    expect(screen.queryByTestId('goal-pick-hint')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('goal-option-cut'));
    expect(screen.getByTestId('goal-option-cut')).toHaveAttribute('aria-pressed', 'true');
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

describe('Onboarding units step', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredUnits = 'lb';
  });

  it('treats the highlighted unit as selected, so Continue works without a tap', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);

    expect(screen.getByRole('radio', { name: /Imperial/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Metric/ })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByTestId('units-continue'));

    expect(mockUpdatePreference).toHaveBeenCalledWith('units', 'lb');
    expect(await screen.findByText('Body composition', { selector: 'h1' })).toBeInTheDocument();
  });

  it('saves the unit the user switched to', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    await user.click(screen.getByRole('radio', { name: /Metric/ }));
    expect(screen.getByRole('radio', { name: /Metric/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('units-continue'));
    expect(mockUpdatePreference).toHaveBeenCalledWith('units', 'kg');
  });
});

describe('Onboarding body composition: sex', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredUnits = 'kg';
    usersRow = { goal: 'maintenance', onboarding_step: 'units', onboarding_completed: false };
  });

  it('has no preselected sex and asks for it before Continue', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    await user.click(screen.getByTestId('units-continue'));

    expect(await screen.findByRole('radio', { name: 'Male' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'false');
    await user.type(screen.getByLabelText('Height (cm)'), '170');
    await user.type(screen.getByLabelText('Weight (kg)'), '65');
    await user.type(screen.getByLabelText('Body fat %'), '25');
    expect(screen.getByTestId('body-comp-missing')).toHaveTextContent(/sex/);

    await user.click(screen.getByRole('radio', { name: 'Female' }));
    expect(screen.queryByTestId('body-comp-missing')).not.toBeInTheDocument();
  });
});
