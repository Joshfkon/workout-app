import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OnboardingBodyCompPage from '../page';
import { starterTargets } from '@/lib/nutrition/phaseTargets';

// ---- Supabase mock: a chainable builder resolved per table + operation ----
type Row = Record<string, unknown>;
let usersRow: Row | null = null;
const userUpdates: Row[] = [];
const stepWrites: unknown[] = [];
// When set, the coaching_sessions insert waits on it (to observe the busy state).
let coachingInsertGate: Promise<void> | null = null;
let coachingInserts = 0;
let targetsRow: Row | null = null;
let macroSettingsRow: Row | null = null;
const targetInserts: Row[] = [];
// Auth user_metadata (tracking_focus: 'food' for a food-only sign-up).
let mockUserMetadata: Row = {};

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
    if (table === 'nutrition_targets' && op === 'select') return { data: targetsRow, error: null };
    if (table === 'nutrition_targets' && op === 'insert') {
      if (payload) targetInserts.push(payload);
      return { data: null, error: null };
    }
    if (table === 'macro_settings') return { data: macroSettingsRow, error: null };
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve(result()),
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
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1', user_metadata: mockUserMetadata } } }) },
    from: (table: string) => builder(table),
  }),
}));

const mockSaveMacroSettings = jest.fn();
jest.mock('@/lib/actions/nutrition', () => ({
  saveMacroSettings: (...args: unknown[]) => mockSaveMacroSettings(...args),
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

async function reachGoalStep(bodyFat = '15', age = '') {
  const user = userEvent.setup();
  render(<OnboardingBodyCompPage />);
  await user.click(await screen.findByRole('radio', { name: 'Male' }));
  await user.type(screen.getByLabelText('Height (cm)'), '180');
  await user.type(screen.getByLabelText('Weight (kg)'), '80');
  if (age) await user.type(screen.getByLabelText('Age (optional)'), age);
  await user.type(screen.getByLabelText('Body fat % (optional)'), bodyFat);
  await user.click(screen.getByTestId('body-continue'));
  await screen.findByText("What's your goal right now?");
  return user;
}

/** Continue on the goal step, then Skip the optional training step if it shows (lifters). */
async function finishGoal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('goal-continue'));
  const skip = screen.queryByTestId('training-skip');
  if (skip) await user.click(skip);
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
    const user = await reachGoalStep();
    // Lifters go on to the optional training step; nothing is saved yet.
    await user.click(screen.getByTestId('goal-continue'));
    expect(coachingInserts).toBe(0);

    const cont = screen.getByTestId('training-continue');
    // Two taps in the same tick, before the busy state re-renders.
    act(() => {
      fireEvent.click(cont);
      fireEvent.click(cont);
    });
    await waitFor(() => expect(screen.getByTestId('training-continue')).toHaveTextContent('Saving…'));
    expect(screen.getByTestId('training-continue')).toBeDisabled();
    expect(screen.getByTestId('training-continue')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('training-skip')).toBeDisabled();

    await act(async () => release());
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(coachingInserts).toBe(1);
    // Still busy while the route changes: no re-enabled button to tap again.
    expect(screen.getByTestId('training-continue')).toBeDisabled();
  });

  it('Skip on the training step shows it is working at once', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    let release: () => void = () => {};
    coachingInsertGate = new Promise<void>((r) => (release = r));
    const user = await reachGoalStep();
    await user.click(screen.getByTestId('goal-continue'));
    act(() => {
      fireEvent.click(screen.getByTestId('training-skip'));
    });
    await waitFor(() => expect(screen.getByTestId('training-skip')).toHaveTextContent('Using defaults…'));
    expect(screen.getByTestId('training-skip-defaults')).toHaveTextContent(/^Skipped\. Skip keeps your goal/);
    expect(screen.getByTestId('training-skip')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('training-continue')).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/benchmarks?session=sess-1'));
  });

  it('presents the body-fat suggestion as information, not a second selection', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    // 10% (male) is lean enough for the bulk suggestion.
    await reachGoalStep('10');

    expect(screen.getByTestId('goal-body-fat-note')).toHaveTextContent(/building muscle \(a bulk\) could also suit you/);
    expect(screen.queryByText('Fits your body fat')).not.toBeInTheDocument();
    // Maintain stays the one selected option; Bulk carries no badge or highlight.
    expect(screen.getByTestId('goal-option-maintenance')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('goal-option-bulk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('goal-option-bulk').className).not.toMatch(/border-action/);
    expect(screen.getByTestId('goal-option-bulk')).toHaveTextContent(
      /^Build muscle \(bulk\)Eat a little more than you burn to gain about 0\.25% of your body weight a week, mostly muscle\.$/
    );
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
    await finishGoal(user);

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
    await finishGoal(user);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(injuryWrites()).toEqual([]);
  });

  it('"None" saves an empty list', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep();

    await user.click(screen.getByTestId('goal-option-cut'));
    await user.click(screen.getByTestId('injury-chip-none'));
    await finishGoal(user);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(injuryWrites()).toEqual([['injuryAreas', []]]);
  });

  it('restores saved areas on re-entry, and clearing them saves []', async () => {
    mockStoredInjuryAreas = ['knee'];
    usersRow = { goal: 'cut', onboarding_step: 'goal', onboarding_completed: false };
    const user = await reachGoalStep();

    expect(screen.getByTestId('injury-chip-knee')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('injury-chip-knee'));
    await finishGoal(user);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(injuryWrites()).toEqual([['injuryAreas', []]]);
  });
});

describe('Onboarding goal step: plain goal labels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    targetsRow = null;
    mockStoredUnits = 'kg';
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
  });

  it('leads with plain labels (gym term in brackets), one plain line each, Maintain preselected', async () => {
    // 18% body fat: the default 0.5% cut is within the leanness cap.
    await reachGoalStep('18');
    expect(screen.getByTestId('goal-option-cut')).toHaveTextContent(
      'Lose fat (cut)Eat a little less than you burn to lose about 0.5% of your body weight a week, keeping your muscle.'
    );
    expect(screen.getByTestId('goal-option-bulk')).toHaveTextContent(/^Build muscle \(bulk\)/);
    expect(screen.getByTestId('goal-option-maintenance')).toHaveTextContent(/^Maintainpreselected.+getting back into it\.$/);
    expect(screen.getByTestId('goal-option-maintenance')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a lean lifter\'s "Lose fat" line gives the slower pace the targets really use (Dre, UX round 23)', async () => {
    await reachGoalStep('12', '31');
    expect(screen.getByTestId('goal-option-cut')).toHaveTextContent(
      /lose about 0\.3% of your body weight a week\. That.s slower than the usual 0\.5% because you.re already lean/
    );
  });

  it('says out loud that Maintain is preselected and how to change it, until a goal is tapped (UX round 21)', async () => {
    const user = await reachGoalStep();
    expect(screen.getByTestId('goal-preselected-note')).toHaveTextContent(
      'Maintain is picked to start. Cutting or bulking? Tap Lose fat or Build muscle instead.'
    );
    expect(screen.getByTestId('goal-preselected-tag')).toHaveTextContent('preselected');
    await user.click(screen.getByTestId('goal-option-cut'));
    expect(screen.queryByTestId('goal-preselected-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goal-preselected-tag')).not.toBeInTheDocument();
  });

  it('preselects from food targets already set up in Eat, and says so', async () => {
    macroSettingsRow = { user_id: 'u1', goal: 'moderate_cut' };
    try {
      await reachGoalStep();
      expect(screen.getByTestId('goal-option-cut')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('goal-preselected-note')).toHaveTextContent(/food targets you already set up/);
    } finally {
      macroSettingsRow = null;
    }
  });

  it('shows the step in words, moving forward on each screen', async () => {
    await reachGoalStep();
    expect(screen.getByTestId('onboarding-step-label')).toHaveTextContent('Step 2 of 4: Goal');
    expect(screen.getByTestId('onboarding-later-note')).toHaveTextContent(/filled in later/);
  });
});

describe('Onboarding goal step: daily targets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    targetInserts.length = 0;
    targetsRow = null;
    mockStoredUnits = 'kg';
    mockStoredInjuryAreas = [];
    mockSaveMacroSettings.mockResolvedValue({ success: true });
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
  });

  // Body fat 15% (reachGoalStep's default) is the user's own number, so the
  // calculator sizes protein to that lean mass, as Eat does.
  const expected = (phase: 'cut' | 'maintenance' | 'bulk') =>
    starterTargets({ phase, weightKg: 80, heightCm: 180, age: 30, sex: 'male', bodyFatPercent: 15 })!;

  it('shows the calorie and protein targets for the picked goal, then saves exactly those', async () => {
    const user = await reachGoalStep('15', '30');

    const card = screen.getByTestId('goal-daily-targets');
    const maintain = expected('maintenance').targets;
    expect(screen.getByTestId('targets-calories-row')).toHaveTextContent(`${maintain.calories.toLocaleString()} kcal`);
    expect(screen.getByTestId('targets-protein-row')).toHaveTextContent(`${maintain.protein} g`);
    expect(card).toHaveTextContent(/Change them any time in Eat/);
    // Where the numbers come from, in plain words: maintenance, then the goal's change.
    const maintainBasis = expected('maintenance').calories;
    expect(screen.getByTestId('goal-targets-source')).toHaveTextContent(
      `Estimated maintenance: ~${maintainBasis.maintenanceKcal.toLocaleString()} kcal a day`
    );
    expect(screen.getByTestId('goal-targets-source')).toHaveTextContent(/from your lean mass/);
    expect(screen.getByTestId('targets-edit')).toHaveTextContent('Type exact numbers');
    expect(screen.getByTestId('goal-protein-basis')).toHaveTextContent(
      'Protein: 2.2 g per kg of lean mass. Your lean mass is 68 kg (from your body fat), so about 1.9 g per kg of body weight.'
    );

    await user.click(screen.getByTestId('goal-option-cut'));
    const cut = expected('cut');
    expect(cut.targets.calories).toBeLessThan(maintain.calories);
    expect(screen.getByTestId('goal-daily-targets')).toHaveTextContent(
      `${cut.targets.calories.toLocaleString()} kcal`
    );

    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockSaveMacroSettings).toHaveBeenCalledWith({ ...cut.settings, target_weight_change_per_week: null });
    expect(targetInserts).toEqual([{ user_id: 'u1', ...cut.targets }]);
    expect(userUpdates.find((u) => 'goal' in u)).toMatchObject({ goal: 'cut', age: 30 });
  });

  it('asks for an age instead of guessing one, and saves no targets', async () => {
    const user = await reachGoalStep();

    expect(screen.queryByTestId('goal-daily-targets')).not.toBeInTheDocument();
    expect(screen.getByTestId('goal-targets-need-age')).toHaveTextContent(/Add your age/);
    // Asked right here, not "go Back".
    expect(screen.getByTestId('goal-targets-need-age')).not.toHaveTextContent(/Back|last step/);
    expect(screen.getByLabelText('Age')).toHaveValue(null);

    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockSaveMacroSettings).not.toHaveBeenCalled();
    expect(targetInserts).toEqual([]);
  });

  it('takes the age on the goal step: targets appear at once and the age is saved like the body-comp one', async () => {
    const user = await reachGoalStep();

    // Out of range (13–100): still no targets, and the field stays put.
    await user.type(screen.getByLabelText('Age'), '9');
    expect(screen.queryByTestId('goal-daily-targets')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Age'));

    await user.type(screen.getByLabelText('Age'), '30');
    const maintain = expected('maintenance').targets;
    expect(screen.getByTestId('targets-calories-row')).toHaveTextContent(`${maintain.calories.toLocaleString()} kcal`);
    expect(screen.queryByTestId('goal-targets-need-age')).not.toBeInTheDocument();
    // The field doesn't vanish mid-typing once the age becomes valid.
    expect(screen.getByLabelText('Age')).toHaveValue(30);

    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(userUpdates.find((u) => 'goal' in u)).toMatchObject({ goal: 'maintenance', age: 30 });
    expect(targetInserts).toEqual([{ user_id: 'u1', ...maintain }]);
  });

  it('does not ask for an age when it was given on the body-comp step', async () => {
    await reachGoalStep('15', '30');
    expect(screen.queryByTestId('goal-age-field')).not.toBeInTheDocument();
  });

  it('shows targets the user already has and never overwrites them', async () => {
    targetsRow = { calories: 2400, protein: 180 };
    const user = await reachGoalStep('15', '30');

    await waitFor(() =>
      expect(screen.getByTestId('goal-daily-targets')).toHaveTextContent('2,400 kcal')
    );
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockSaveMacroSettings).not.toHaveBeenCalled();
    expect(targetInserts).toEqual([]);
  });
});

describe('Onboarding goal step: food-only users', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    targetInserts.length = 0;
    targetsRow = null;
    mockStoredUnits = 'kg';
    mockStoredInjuryAreas = [];
    mockSaveMacroSettings.mockResolvedValue({ success: true });
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
  });
  afterEach(() => {
    mockUserMetadata = {};
  });

  it('drops training talk and folds the injuries question away for a food tracker', async () => {
    mockUserMetadata = { tracking_focus: 'food' };
    const user = await reachGoalStep('15', '30');

    expect(screen.getByText('This sets your daily food targets.')).toBeInTheDocument();
    expect(screen.queryByText(/training is planned/)).not.toBeInTheDocument();
    for (const g of ['cut', 'maintenance', 'bulk']) {
      expect(screen.getByTestId(`goal-option-${g}`)).not.toHaveTextContent(/muscle|training|workout/i);
    }
    expect(screen.getByTestId('goal-option-maintenance')).toHaveAttribute('aria-pressed', 'true');
    // Targets count no workouts.
    const food = starterTargets({ phase: 'maintenance', weightKg: 80, heightCm: 180, age: 30, sex: 'male', liftsWeights: false, bodyFatPercent: 15 })!;
    expect(screen.getByTestId('goal-daily-targets')).toHaveTextContent(`${food.targets.calories.toLocaleString()} kcal`);

    // Injuries: collapsed, neutral, still answerable.
    expect(screen.queryByTestId('injury-chip-knee')).not.toBeInTheDocument();
    expect(screen.queryByText(/check-in/)).not.toBeInTheDocument();
    await user.click(screen.getByTestId('injury-question-toggle'));
    expect(screen.getByText('Optional. Only used if you ever log a workout.')).toBeInTheDocument();
    await user.click(screen.getByTestId('injury-chip-knee'));
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockUpdatePreference).toHaveBeenCalledWith('injuryAreas', ['knee']);
  });

  it('keeps the training copy and open injuries question for lifters', async () => {
    await reachGoalStep('15', '30');
    expect(screen.getByText(/how your training is planned/)).toBeInTheDocument();
    expect(screen.getByTestId('injury-chip-knee')).toBeInTheDocument();
    expect(screen.queryByTestId('injury-question-toggle')).not.toBeInTheDocument();
    expect(screen.getByText(/pre-workout check-in/)).toBeInTheDocument();
  });
});

describe('Onboarding body fat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredUnits = 'kg';
    usersRow = { goal: 'maintenance', onboarding_step: 'units', onboarding_completed: false };
  });

  it('says what it is, why it is asked and how to estimate it, and lets the user skip', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    const why = await screen.findByTestId('body-fat-why');
    // Why, in terms of what it sets (UX round 22): protein and the burn estimate.
    expect(why).toHaveTextContent(/Why we ask: it splits your weight into lean mass and fat/);
    expect(why).toHaveTextContent(/protein target is set from your lean mass, and so is your resting calorie burn/);
    expect(why).toHaveTextContent(/look-alike guess below is fine/);
    expect(why).toHaveTextContent(/Don.t know it\? Leave it empty and we use a typical value for now/);

    await user.click(screen.getByRole('radio', { name: 'Female' }));
    expect(screen.getByTestId('body-fat-not-sure')).toHaveTextContent('I don’t know — skip');
    await user.click(screen.getByTestId('body-fat-not-sure'));
    const field = screen.getByLabelText('Body fat % (optional)');
    expect(field).toHaveValue(32);
    // The filled value is marked as an estimate, not left looking typed.
    const note = screen.getByTestId('body-fat-estimate-note');
    expect(note).toHaveTextContent(
      /^Skipped\s*Using 32%, about average for women, for now\. Type your own number any time\.$/
    );
    expect(field).toHaveAttribute('data-estimated', 'true');
    expect(field).toHaveAttribute('aria-describedby', 'body-fat-estimate-note');
    expect(field.className).toMatch(/italic/);
    expect(field.className).toMatch(/border-dashed/);
    // The reason line stays.
    expect(screen.getByTestId('body-fat-why')).toBeInTheDocument();
  });

  it('follows a sex change, and drops the estimate mark once the user types a value', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    await user.click(await screen.findByRole('radio', { name: 'Female' }));
    await user.click(screen.getByTestId('body-fat-not-sure'));

    await user.click(screen.getByRole('radio', { name: 'Male' }));
    expect(screen.getByLabelText('Body fat % (optional)')).toHaveValue(22);
    expect(screen.getByTestId('body-fat-estimate-note')).toHaveTextContent(/22%, about average for men, for now\./);

    await user.clear(screen.getByLabelText('Body fat % (optional)'));
    await user.type(screen.getByLabelText('Body fat % (optional)'), '18');
    expect(screen.queryByTestId('body-fat-estimate-note')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Body fat % (optional)')).not.toHaveAttribute('data-estimated');
    expect(screen.getByLabelText('Body fat % (optional)').className).not.toMatch(/italic/);
  });

  it('drops the estimate mark when a level is picked from the visual guide', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    await user.click(await screen.findByRole('radio', { name: 'Female' }));
    await user.click(screen.getByTestId('body-fat-not-sure'));
    await user.click(screen.getByRole('button', { name: /^25%/ }));

    expect(screen.getByLabelText('Body fat % (optional)')).toHaveValue(25);
    expect(screen.queryByTestId('body-fat-estimate-note')).not.toBeInTheDocument();
  });
});

describe('Onboarding body fat: the guide is in plain sight (UX round 21)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredUnits = 'kg';
    usersRow = { goal: 'maintenance', onboarding_step: 'units', onboarding_completed: false };
  });

  it('shows the look-alike levels under the field as soon as sex is picked, photos one tap away', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    expect(screen.queryByTestId('body-fat-guide')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('radio', { name: 'Male' }));
    const guide = screen.getByTestId('body-fat-guide');
    expect(guide).toHaveTextContent('Not sure? Tap the look closest to yours:');
    expect(within(guide).getByRole('button', { name: /^15%/ })).toBeInTheDocument();
    expect(within(guide).queryByRole('img')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('body-fat-photos'));
    expect(within(guide).getByRole('img')).toHaveAttribute('alt', 'Male body fat percentage visual guide');
    // Picking a look fills the field and folds the guide away.
    await user.click(within(guide).getByRole('button', { name: /^12%/ }));
    expect(screen.getByLabelText('Body fat % (optional)')).toHaveValue(12);
    expect(screen.queryByTestId('body-fat-guide')).not.toBeInTheDocument();
  });
});

describe('Onboarding body composition: age', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    stepWrites.length = 0;
    mockStoredInjuryAreas = [];
    mockStoredUnits = 'kg';
    usersRow = { goal: 'maintenance', onboarding_step: 'units', onboarding_completed: false };
  });

  it('asks for age with the basics, before body fat, and says why', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    const age = await screen.findByLabelText('Age (optional)');
    const sex = screen.getByRole('radio', { name: 'Female' });

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(sex, age)).toBe(true);
    expect(follows(age, screen.getByLabelText('Weight (kg)'))).toBe(true);
    expect(follows(age, screen.getByTestId('body-fat-why'))).toBe(true);
    expect(follows(age, screen.getByLabelText('Body fat % (optional)'))).toBe(true);
    // Why it's optional and what skipping it costs (UX round 23).
    expect(
      screen.getByText(/Optional, but your daily calorie target needs it: your resting burn changes with age\. Skip it and you can set calories later in Eat\./)
    ).toBeInTheDocument();
  });

  it('saves the age typed here through the one users update', async () => {
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep('15', '34');
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(userUpdates.filter((u) => 'age' in u)).toEqual([expect.objectContaining({ age: 34 })]);
  });
});

describe('Onboarding units, on the first (body) screen (UX round 23: one screen fewer)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredUnits = 'lb';
    usersRow = { goal: 'maintenance', onboarding_step: null, onboarding_completed: false };
  });

  /** Sex, height and weight in whatever units are showing; body fat left empty. */
  async function fillBasics(user: ReturnType<typeof userEvent.setup>, metricHeight: boolean) {
    await user.click(screen.getByRole('radio', { name: 'Male' }));
    if (metricHeight) {
      await user.type(screen.getByLabelText('Height (cm)'), '180');
    } else {
      await user.type(screen.getByLabelText('Height, feet'), '5');
      await user.type(screen.getByLabelText('Height, inches'), '11');
    }
  }

  it('opens on units, text size and the body questions together; Continue saves the units shown', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    expect(screen.getByTestId('onboarding-units')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-text-size')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Male' })).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-step-label')).toHaveTextContent('Step 1 of 4: Units and your body');
    expect(screen.queryByTestId('units-continue')).not.toBeInTheDocument();

    expect(screen.getByRole('radio', { name: /Imperial/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Metric/ })).toHaveAttribute('aria-checked', 'false');
    await fillBasics(user, false);
    await user.type(screen.getByLabelText('Weight (lbs)'), '180');
    await user.click(screen.getByTestId('body-continue'));

    expect(mockUpdatePreference).toHaveBeenCalledWith('units', 'lb');
    expect(mockUpdatePreference).toHaveBeenCalledWith('lengthUnits', 'in');
    expect(await screen.findByText("What's your goal right now?")).toBeInTheDocument();
  });

  it('saves the unit the user switched to, and carries a typed weight across', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    await user.type(screen.getByLabelText('Weight (lbs)'), '176.4');
    await user.click(screen.getByRole('radio', { name: /Metric/ }));
    expect(screen.getByRole('radio', { name: /Metric/ })).toHaveAttribute('aria-checked', 'true');
    // 176.4 lb is 80 kg: the number follows the unit instead of being re-read.
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(80);
    await fillBasics(user, true);
    await user.click(screen.getByTestId('body-continue'));
    expect(mockUpdatePreference).toHaveBeenCalledWith('units', 'kg');
    expect(mockUpdatePreference).toHaveBeenCalledWith('lengthUnits', 'cm');
  });

  it('lets weight and length be chosen separately (kg with inches)', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    const weight = screen.getByRole('radiogroup', { name: 'Weight units' });
    const length = screen.getByRole('radiogroup', { name: 'Length units' });
    // Both start from the stored (Imperial) choice.
    expect(within(weight).getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'true');
    expect(within(length).getByRole('radio', { name: 'inches' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(weight).getByRole('radio', { name: 'kg' }));
    // A mixed choice is neither preset.
    expect(screen.getByRole('radio', { name: /Imperial/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Metric/ })).toHaveAttribute('aria-checked', 'false');
    // Height is asked in feet + inches, weight in kg.
    expect(screen.getByLabelText('Height, feet')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight (kg)')).toBeInTheDocument();

    await fillBasics(user, false);
    await user.type(screen.getByLabelText('Weight (kg)'), '80');
    await user.click(screen.getByTestId('body-continue'));
    expect(mockUpdatePreference).toHaveBeenCalledWith('units', 'kg');
    expect(mockUpdatePreference).toHaveBeenCalledWith('lengthUnits', 'in');
  });

  it('switching the length unit carries a typed height across', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    await fillBasics(user, false);
    await user.click(within(screen.getByRole('radiogroup', { name: 'Length units' })).getByRole('radio', { name: 'cm' }));
    expect(screen.getByLabelText('Height (cm)')).toHaveValue(180);
  });

  it('body fat is optional for real: left empty, Continue uses a typical value marked as an estimate', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    await user.click(screen.getByRole('radio', { name: /Metric/ }));
    await fillBasics(user, true);
    await user.type(screen.getByLabelText('Weight (kg)'), '80');
    expect(screen.getByTestId('body-continue')).toBeEnabled();
    expect(screen.getByTestId('body-fat-empty-note')).toHaveTextContent('Continue uses a typical 22% for now');
    expect(screen.queryByTestId('body-comp-missing')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('body-continue'));
    await screen.findByText("What's your goal right now?");
    // Back on the body screen, the estimate is marked as one.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Body fat % (optional)')).toHaveValue(22);
    expect(screen.getByTestId('body-fat-estimate-note')).toBeInTheDocument();
  });
  it('asks height as one field with a cm / ft & in toggle that carries the number across (UX round 22)', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    const toggle = await screen.findByRole('radiogroup', { name: 'Height unit' });
    expect(within(toggle).getByRole('radio', { name: 'ft & in' })).toHaveAttribute('aria-checked', 'true');
    // Typing the feet digit moves straight on to inches: one tap for the pair.
    await user.click(screen.getByLabelText('Height, feet'));
    await user.keyboard('5');
    expect(screen.getByLabelText('Height, inches')).toHaveFocus();
    await user.keyboard('11');
    await user.click(within(toggle).getByRole('radio', { name: 'cm' }));
    expect(screen.getByLabelText('Height (cm)')).toHaveValue(180);
    await user.click(within(toggle).getByRole('radio', { name: 'ft & in' }));
    expect(screen.getByLabelText('Height, feet')).toHaveValue(5);
    expect(screen.getByLabelText('Height, inches')).toHaveValue(11);
    // Only how height is typed changes; the saved length unit stays.
    expect(mockUpdatePreference).not.toHaveBeenCalledWith('lengthUnits', 'cm');
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

    expect(await screen.findByRole('radio', { name: 'Male' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'false');
    await user.type(screen.getByLabelText('Height (cm)'), '170');
    await user.type(screen.getByLabelText('Weight (kg)'), '65');
    await user.type(screen.getByLabelText('Body fat % (optional)'), '25');
    expect(screen.getByTestId('body-comp-missing')).toHaveTextContent(/sex/);

    await user.click(screen.getByRole('radio', { name: 'Female' }));
    expect(screen.queryByTestId('body-comp-missing')).not.toBeInTheDocument();
  });
});

describe('Onboarding: food-only users skip the strength benchmarks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    stepWrites.length = 0;
    coachingInserts = 0;
    targetsRow = null;
    mockStoredUnits = 'kg';
    mockStoredInjuryAreas = [];
    mockSaveMacroSettings.mockResolvedValue({ success: true });
    usersRow = { goal: 'maintenance', onboarding_step: 'body_comp', onboarding_completed: false };
  });
  afterEach(() => {
    mockUserMetadata = {};
    window.history.replaceState({}, '', '/');
  });

  it('finishes onboarding and goes to the dashboard, with no coaching session', async () => {
    mockUserMetadata = { tracking_focus: 'food' };
    const user = await reachGoalStep('15', '30');
    await finishGoal(user);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/onboarding/benchmarks'));
    expect(coachingInserts).toBe(0);
    // The goal is saved as usual, then onboarding is marked complete.
    expect(userUpdates.find((u) => 'goal' in u)).toMatchObject({ goal: 'maintenance' });
    expect(stepWrites.slice(-2)).toEqual(['goal', null]);
  });

  it('still reaches the benchmarks when a food tracker asked to calibrate', async () => {
    mockUserMetadata = { tracking_focus: 'food' };
    window.history.replaceState({}, '', '/onboarding?benchmarks=1');
    const user = await reachGoalStep('15', '30');
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/benchmarks?session=sess-1'));
    expect(coachingInserts).toBe(1);
  });

  it('leaves lifters on the benchmarks path', async () => {
    const user = await reachGoalStep('15', '30');
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/benchmarks?session=sess-1'));
    expect(stepWrites[stepWrites.length - 1]).toBe('goal');
  });
});

describe('Onboarding: beginner mode on the goal step', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    stepWrites.length = 0;
    targetsRow = null;
    mockStoredUnits = 'kg';
    mockStoredInjuryAreas = [];
    mockSaveMacroSettings.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    mockUserMetadata = {};
  });

  const savedBeginner = () =>
    userUpdates
      .map((u) => u.preferences as Record<string, unknown> | undefined)
      .find((p) => p && 'beginnerMode' in p)?.beginnerMode;

  it('is on for a novice and saved on Continue', async () => {
    usersRow = { goal: 'maintenance', experience: 'novice', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep('15', '30');
    expect(screen.getByTestId('experience-summary-beginner')).toHaveTextContent('Beginner mode: on');
    await user.click(screen.getByTestId('experience-summary-change'));
    const toggle = within(screen.getByTestId('onboarding-beginner-mode')).getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(savedBeginner()).toBe(true);
  });

  it('is off for an experienced lifter, and saves what they switch it to', async () => {
    usersRow = { goal: 'maintenance', experience: 'advanced', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('experience-summary-change'));
    const toggle = within(screen.getByTestId('onboarding-beginner-mode')).getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(screen.getByTestId('experience-summary-beginner')).toHaveTextContent('Beginner mode: on');
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(savedBeginner()).toBe(true);
  });

  it('is not offered to a food-only user', async () => {
    mockUserMetadata = { tracking_focus: 'food' };
    usersRow = { goal: 'maintenance', experience: 'novice', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep('15', '30');
    expect(screen.queryByTestId('onboarding-beginner-mode')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-experience-summary')).not.toBeInTheDocument();
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(savedBeginner()).toBeUndefined();
  });
});

describe('Onboarding: experience is asked once (at sign-up)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    stepWrites.length = 0;
    targetsRow = null;
    mockStoredInjuryAreas = [];
    mockSaveMacroSettings.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    mockUserMetadata = {};
  });

  it('shows the sign-up answer back as a summary, with no question to answer again', async () => {
    mockUserMetadata = { lifting_answer: '2_to_3_years' };
    usersRow = { goal: 'maintenance', experience: 'intermediate', onboarding_step: 'body_comp', onboarding_completed: false };
    await reachGoalStep('15', '30');
    const summary = screen.getByTestId('onboarding-experience-summary');
    expect(summary).toHaveTextContent('Lifting experience: 2–3 years (from sign-up)');
    expect(summary).toHaveTextContent('Beginner mode: off');
    // The switch is one tap away, not a second question on the screen.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(/Intermediate/)).not.toBeInTheDocument();
  });

  it('turns Beginner mode on for "Just started" even when the row still has the default level, and saves the level', async () => {
    mockUserMetadata = { lifting_answer: 'under_6_months' };
    usersRow = { goal: 'maintenance', experience: 'intermediate', onboarding_step: 'body_comp', onboarding_completed: false };
    const user = await reachGoalStep('15', '30');
    const line = screen.getByTestId('experience-summary-beginner');
    expect(line).toHaveTextContent('Beginner mode: on');
    // Explained in one line, with how to turn it off.
    expect(line).toHaveTextContent(/Simpler workout screen.*Turn it off under Change/);
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(userUpdates.find((u) => 'goal' in u)).toMatchObject({ experience: 'novice' });
    const prefs = userUpdates
      .map((u) => u.preferences as Record<string, unknown> | undefined)
      .find((p) => p && 'beginnerMode' in p);
    expect(prefs?.beginnerMode).toBe(true);
  });

  it('leaves the stored level alone once setup is finished', async () => {
    mockUserMetadata = { lifting_answer: 'under_6_months' };
    usersRow = { goal: 'maintenance', experience: 'advanced', onboarding_step: 'complete', onboarding_completed: true };
    const user = await reachGoalStep('15', '30');
    expect(screen.getByTestId('experience-summary-beginner')).toHaveTextContent('Beginner mode: off');
    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(userUpdates.find((u) => 'goal' in u)).not.toHaveProperty('experience');
  });

  it('falls back to the stored level when sign-up was skipped, without claiming it was asked', async () => {
    usersRow = { goal: 'maintenance', experience: 'intermediate', onboarding_step: 'body_comp', onboarding_completed: false };
    await reachGoalStep('15', '30');
    const summary = screen.getByTestId('onboarding-experience-summary');
    expect(summary).toHaveTextContent('Lifting experience: 1–3 years');
    expect(summary).not.toHaveTextContent('from sign-up');
  });
});

describe('Onboarding: optional training step (lifters)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    stepWrites.length = 0;
    targetsRow = null;
    mockStoredUnits = 'kg';
    mockStoredInjuryAreas = [];
    mockSaveMacroSettings.mockResolvedValue({ success: true });
    usersRow = { goal: 'maintenance', experience: 'advanced', onboarding_step: 'body_comp', onboarding_completed: false };
  });
  afterEach(() => {
    mockUserMetadata = {};
  });

  const savedPrefs = () =>
    userUpdates
      .map((u) => u.preferences as Record<string, unknown> | undefined)
      .find((p) => p && 'beginnerMode' in p);

  it('asks days, split and bulk pace on one screen, and saves each where it belongs', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-option-bulk'));
    await user.click(screen.getByTestId('goal-continue'));

    expect(screen.getByRole('heading', { name: 'How do you train now?' })).toBeInTheDocument();
    // The calculator's own levels; lean bulk (the default pace) shown picked.
    expect(screen.getByTestId('training-rate-slow_bulk')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('training-rate-slow_bulk')).toHaveTextContent(
      'Lean bulk+0.25% of body weight a week (about +0.2 kg a week)'
    );
    expect(mockSaveMacroSettings).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('training-days-5'));
    await user.click(screen.getByTestId('training-split-body_part'));
    await user.click(screen.getByTestId('training-rate-moderate_bulk'));
    const expected = starterTargets({
      phase: 'bulk',
      weightKg: 80,
      heightCm: 180,
      age: 30,
      sex: 'male',
      liftsWeights: true,
      nutritionGoal: 'moderate_bulk',
      workoutsPerWeek: 5,
      bodyFatPercent: 15,
    })!;
    expect(screen.getByTestId('training-rate-targets')).toHaveTextContent(
      `${expected.targets.calories.toLocaleString()} kcal`
    );

    await user.click(screen.getByTestId('training-continue'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/benchmarks?session=sess-1'));
    expect(savedPrefs()).toMatchObject({ trainingDaysPerWeek: 5, currentSplit: 'body_part', beginnerMode: false });
    expect(mockSaveMacroSettings).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'moderate_bulk', workouts_per_week: 5 })
    );
    expect(targetInserts[targetInserts.length - 1]).toMatchObject(expected.targets);
  });

  it('Skip saves none of the answers and keeps the default pace', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-option-bulk'));
    await user.click(screen.getByTestId('goal-continue'));
    await user.click(screen.getByTestId('training-days-6'));
    await user.click(screen.getByTestId('training-rate-aggressive_bulk'));
    // Before tapping, Skip says which pace it uses (not the one picked) and its targets.
    // One calorie figure on screen (UX round 21): the targets line, which
    // Continue saves. Skip names what it drops instead of a second number.
    const onScreen = starterTargets({
      phase: 'bulk', weightKg: 80, heightCm: 180, age: 30, sex: 'male', liftsWeights: true,
      nutritionGoal: 'aggressive_bulk', workoutsPerWeek: 6, bodyFatPercent: 15,
    })!;
    expect(screen.getByTestId('training-rate-targets')).toHaveTextContent(
      `${onScreen.targets.calories.toLocaleString()} kcal`
    );
    const skipLine = screen.getByTestId('training-skip-defaults');
    expect(skipLine).toHaveTextContent(
      'Skip drops your answers above: your targets go back to the default pace (lean bulk) and 4 workouts a week'
    );
    expect(skipLine).not.toHaveTextContent(/kcal/);
    await user.click(screen.getByTestId('training-skip'));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(savedPrefs()).not.toHaveProperty('trainingDaysPerWeek');
    expect(savedPrefs()).not.toHaveProperty('currentSplit');
    expect(mockSaveMacroSettings).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'slow_bulk', workouts_per_week: 4 })
    );
  });

  it('asks no pace for Maintain, and Back returns to the goal step', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-continue'));
    expect(screen.queryByTestId('training-rate')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText("What's your goal right now?")).toBeInTheDocument();
  });

  it('keeps existing food targets: no pace picker, a pointer to Eat instead', async () => {
    targetsRow = { calories: 2500, protein: 180 };
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-option-cut'));
    await user.click(screen.getByTestId('goal-continue'));
    expect(screen.getByTestId('training-rate-kept')).toHaveTextContent(/kept/);
    expect(screen.queryByTestId('training-rate-moderate_cut')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('training-continue'));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockSaveMacroSettings).not.toHaveBeenCalled();
  });

  it('is never shown to a food-only user', async () => {
    mockUserMetadata = { tracking_focus: 'food' };
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-continue'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByTestId('onboarding-training-step')).not.toBeInTheDocument();
  });
});

describe('Onboarding units step: text size', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredUnits = 'kg';
    localStorage.clear();
    document.documentElement.removeAttribute('data-text-size');
  });

  it('offers Default / Large / Larger with a live preview, starting on Default', async () => {
    const user = userEvent.setup();
    render(<OnboardingBodyCompPage />);
    const card = screen.getByTestId('onboarding-text-size');
    expect(within(card).getByTestId('text-size-preview')).toBeInTheDocument();
    const group = within(card).getByRole('radiogroup', { name: 'Text size' });
    expect(within(group).getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(group).getByRole('radio', { name: 'Larger' }));
    expect(within(group).getByRole('radio', { name: 'Larger' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('larger');
    expect(localStorage.getItem('textSize')).toBe('larger');
  });
});

describe('Onboarding: protein is explained and editable, and a pace can be typed (UX round 21)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userUpdates.length = 0;
    targetInserts.length = 0;
    targetsRow = null;
    mockStoredUnits = 'kg';
    mockStoredInjuryAreas = [];
    mockSaveMacroSettings.mockResolvedValue({ success: true });
    usersRow = { goal: 'maintenance', experience: 'advanced', onboarding_step: 'body_comp', onboarding_completed: false };
  });

  it('follows the body fat given (not an assumed 20%) for protein', async () => {
    await reachGoalStep('10', '30');
    await userEvent.setup().click(screen.getByTestId('goal-option-bulk'));
    const withBf = starterTargets({ phase: 'bulk', weightKg: 80, heightCm: 180, age: 30, sex: 'male', bodyFatPercent: 10 })!;
    const assumed = starterTargets({ phase: 'bulk', weightKg: 80, heightCm: 180, age: 30, sex: 'male' })!;
    expect(withBf.targets.protein).toBeGreaterThan(assumed.targets.protein);
    expect(screen.getByTestId('targets-protein-row')).toHaveTextContent(`${withBf.targets.protein} g`);
  });

  it('lets protein be set by hand: calories stay, it is saved, and auto-updates are switched off', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-option-bulk'));
    const before = starterTargets({ phase: 'bulk', weightKg: 80, heightCm: 180, age: 30, sex: 'male', bodyFatPercent: 15 })!;
    await user.click(screen.getByTestId('targets-edit'));
    await user.type(screen.getByTestId('goal-protein-input'), '180');
    const card = screen.getByTestId('goal-daily-targets');
    expect(screen.getByTestId('targets-protein-row')).toHaveTextContent('180 g');
    expect(card).toHaveTextContent(`${before.targets.calories.toLocaleString()} kcal`);
    expect(screen.getByTestId('goal-protein-basis')).toHaveTextContent(/set by you.*calculated figure was/);

    await finishGoal(user);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockSaveMacroSettings).toHaveBeenCalledWith(expect.objectContaining({ auto_update_enabled: false }));
    expect(targetInserts[targetInserts.length - 1]).toMatchObject({ protein: 180, calories: before.targets.calories });
  });

  it('lets calories be set by hand from the visible Edit: protein stays, it is saved, auto-updates off (UX round 22)', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-option-cut'));
    const before = starterTargets({ phase: 'cut', weightKg: 80, heightCm: 180, age: 30, sex: 'male', bodyFatPercent: 15 })!;
    await user.click(screen.getByTestId('targets-edit'));
    await user.type(screen.getByTestId('targets-calories-input'), '2300');
    const card = screen.getByTestId('goal-daily-targets');
    expect(screen.getByTestId('targets-calories-row')).toHaveTextContent('2,300 kcal');
    expect(screen.getByTestId('targets-protein-row')).toHaveTextContent(`${before.targets.protein} g`);
    expect(screen.getByTestId('goal-targets-source')).toHaveTextContent(
      `Calories: set by you. The calculated figure was ${before.targets.calories.toLocaleString()} kcal.`
    );
    // The edit carries to the training step's card too.
    await user.click(screen.getByTestId('goal-continue'));
    expect(screen.getByTestId('training-rate-targets')).toHaveTextContent('2,300 kcal');
    await user.click(screen.getByTestId('training-continue'));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockSaveMacroSettings).toHaveBeenCalledWith(expect.objectContaining({ auto_update_enabled: false }));
    expect(targetInserts[targetInserts.length - 1]).toMatchObject({ calories: 2300, protein: before.targets.protein });
  });

  it('shows the sum right under the numbers and names what Edit changes (Dre, UX round 23)', async () => {
    const user = await reachGoalStep('12', '31');
    await user.click(screen.getByTestId('goal-option-cut'));
    const s = starterTargets({ phase: 'cut', weightKg: 80, heightCm: 180, age: 31, sex: 'male', bodyFatPercent: 12 })!;
    const formula = screen.getByTestId('targets-formula');
    expect(formula).toHaveTextContent(
      `~${s.calories.maintenanceKcal.toLocaleString('en-US')} kcal you burn a day − ${Math.abs(Math.round(s.calories.adjustmentKcal)).toLocaleString('en-US')} for a moderate cut`
    );
    expect(screen.getByRole('button', { name: 'Edit calories and protein' })).toBeInTheDocument();
    // Each number has its own −/+ right next to it (final panel run: 5 of 6
    // still missed that the targets could be changed).
    const calBefore = s.calories.calculated;
    await user.click(screen.getByRole('button', { name: 'Raise calories by 50 kcal' }));
    const expected = calBefore + 50;
    expect(screen.getByTestId('targets-calories-row')).toHaveTextContent(`${expected.toLocaleString('en-US')} kcal`);
    expect(screen.getByRole('button', { name: 'Lower protein by 5 g' })).toBeInTheDocument();
    expect(screen.getByTestId('targets-protein-short')).toHaveTextContent(/of your lean mass/);
  });

  it('cut paces above the leanness cap say what the targets use, so they agree with the sum (Dre, UX round 23)', async () => {
    const user = await reachGoalStep('12', '31');
    await user.click(screen.getByTestId('goal-option-cut'));
    await user.click(screen.getByTestId('goal-continue'));
    expect(screen.getByTestId('training-rate-cap-note')).toHaveTextContent(
      'At 12% body fat the app holds loss to 0.3% of body weight a week, so you keep muscle. Faster paces use that rate.'
    );
    // 0.3% of 80 kg = 0.24 kg a week, on the moderate and aggressive options.
    expect(screen.getByTestId('training-rate-held-moderate_cut')).toHaveTextContent('Held to −0.3% (about −0.24 kg a week) at your body fat');
    expect(screen.getByTestId('training-rate-held-aggressive_cut')).toBeInTheDocument();
    expect(screen.queryByTestId('training-rate-held-slow_cut')).not.toBeInTheDocument();
    expect(screen.getByTestId('training-rate-targets')).toHaveTextContent(/to lose about 0\.24 kg a week/);
  });

  it('says why days and split are asked, and that both are optional (UX round 23)', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-continue'));
    expect(screen.getByText(/Days a week you lift/)).toHaveTextContent('Days a week you lift (optional)');
    expect(screen.getByTestId('training-days-why')).toHaveTextContent(/first plan is built for this many days/);
    expect(screen.getByText(/Your split right now/)).toHaveTextContent('Your split right now (optional)');
    expect(screen.getByTestId('training-split-why')).toHaveTextContent(/keeps the split you already run/);
  });

  it('shows the working on the training step, including the lean-lifter loss cap (Dre, UX round 22)', async () => {
    const user = await reachGoalStep('11', '31');
    await user.click(screen.getByTestId('goal-option-cut'));
    await user.click(screen.getByTestId('goal-continue'));
    await user.click(screen.getByTestId('training-days-4'));
    const card = screen.getByTestId('training-rate-targets');
    expect(card).toHaveTextContent(/Estimated maintenance: ~[\d,]+ kcal a day/);
    expect(card).toHaveTextContent(/plus 4 workouts a week/);
    expect(card).toHaveTextContent(/Moderate cut: −[\d,]+ kcal a day/);
    expect(card).toHaveTextContent(/At 11% body fat the app holds loss to 0.3% of body weight a week \(not 0.5%\)/);
    expect(card).toHaveTextContent(/1.1 g per lb|2.4 g per kg of lean mass/);
    expect(within(card).getByTestId('targets-edit')).toBeInTheDocument();
  });

  it('takes a pace in kg a week, shows the % alongside, and saves it as the weekly-change override', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-option-bulk'));
    await user.click(screen.getByTestId('goal-continue'));
    await user.type(screen.getByTestId('training-rate-custom-input'), '0.25');
    expect(screen.getByTestId('training-rate-custom-percent')).toHaveTextContent(
      'Gain 0.25 kg a week = 0.31% of your body weight a week.'
    );
    // No preset shown as picked while a typed pace is in use.
    expect(screen.getByTestId('training-rate-slow_bulk')).toHaveAttribute('aria-checked', 'false');
    const expected = starterTargets({
      phase: 'bulk', weightKg: 80, heightCm: 180, age: 30, sex: 'male', liftsWeights: true,
      nutritionGoal: 'slow_bulk', bodyFatPercent: 15, weeklyChangeKg: 0.25,
    })!;
    expect(screen.getByTestId('training-rate-targets')).toHaveTextContent(
      `${expected.targets.calories.toLocaleString()} kcal`
    );

    await user.click(screen.getByTestId('training-continue'));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockSaveMacroSettings).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'slow_bulk', target_weight_change_per_week: 0.25 })
    );
  });

  it('when nothing on the training step changes the targets, Skip quotes the same figure as the targets line', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('goal-option-bulk'));
    await user.click(screen.getByTestId('goal-continue'));
    await user.click(screen.getByTestId('training-split-ppl'));
    const line = screen.getByTestId('training-rate-targets').textContent ?? '';
    const figure = line.match(/([\d,]+) kcal/)?.[1];
    expect(figure).toBeTruthy();
    expect(screen.getByTestId('training-skip-defaults')).toHaveTextContent(`(${figure} kcal`);
  });

  it('says what marking an injured area changes', async () => {
    const user = await reachGoalStep('15', '30');
    await user.click(screen.getByTestId('injury-chip-shoulder'));
    expect(screen.getByTestId('injury-effect')).toHaveTextContent(
      /exercises that load your shoulder are swapped for gentler ones or flagged before you start/
    );
  });
});
