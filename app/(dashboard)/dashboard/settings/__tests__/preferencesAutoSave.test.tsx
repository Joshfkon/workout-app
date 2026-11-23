/**
 * Settings → Preferences saves on change (no Save button): units, switches
 * and the rest timer write only their users.preferences keys, confirm with
 * "Saved", and keep the shared caches (preferences hook, user store,
 * settings query) in step. A failed save puts the control back.
 */

import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Supabase fake -----------------------------------------------------------
const mockUpdate = jest.fn();
let storedPreferences: Record<string, unknown>;
let failNextUpdate = false;
let mockExperience = 'intermediate';

function usersTable() {
  return {
    select: (cols: string) => ({
      eq: () => ({
        maybeSingle: async () =>
          cols === 'preferences'
            ? { data: { preferences: storedPreferences }, error: null }
            : {
                data: {
                  id: 'user-1',
                  goal: 'maintenance',
                  experience: mockExperience,
                  height_cm: 180,
                  weight_kg: 80,
                  preferences: storedPreferences,
                },
                error: null,
              },
      }),
    }),
    update: (values: { preferences: Record<string, unknown> }) => ({
      eq: async () => {
        mockUpdate(values);
        if (failNextUpdate) {
          failNextUpdate = false;
          return { error: { message: 'network down' } };
        }
        storedPreferences = values.preferences;
        return { error: null };
      },
    }),
  };
}

function weightLogTable() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return chain;
}

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } } }) },
    from: (table: string) => (table === 'users' ? usersTable() : weightLogTable()),
  }),
}));

// --- Shared state the page must keep in step --------------------------------
const mockRefreshUserStore = jest.fn(async () => true);
jest.mock('@/components/providers/UserStoreHydrator', () => ({
  refreshUserStore: (...args: unknown[]) => mockRefreshUserStore(...(args as [])),
}));

const mockApplyPreferenceLocally = jest.fn();
jest.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: {}, updatePreference: jest.fn() }),
  applyPreferenceLocally: (...args: unknown[]) => mockApplyPreferenceLocally(...args),
}));

const mockEnsureAiConsent = jest.fn(async () => true);
jest.mock('@/components/ai/AiConsentGate', () => ({
  useAiConsentGate: () => mockEnsureAiConsent,
}));

jest.mock('@/lib/actions/phase', () => ({ updateTrainingPhase: jest.fn() }));
jest.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: jest.fn() }));

// --- Other panels / self-saving cards are out of scope ----------------------
jest.mock('@/components/settings/ProfileTabPanel', () => ({ ProfileTabPanel: () => <div /> }));
jest.mock('@/components/settings/TrainingTabPanel', () => ({ TrainingTabPanel: () => <div /> }));
jest.mock('@/components/settings/AccountTabPanel', () => ({ AccountTabPanel: () => <div /> }));
jest.mock('@/components/settings/EatingWindowSettings', () => ({ EatingWindowSettings: () => <div /> }));
jest.mock('@/components/settings/BloodPressureSettings', () => ({ BloodPressureSettings: () => <div /> }));
jest.mock('@/components/settings/MealReminderSettings', () => ({ MealReminderSettings: () => <div /> }));
jest.mock('@/components/settings/EducationPreferencesCard', () => ({
  EducationPreferencesCard: () => <div />,
}));

import SettingsPage from '../page';
import { useUserStore } from '@/stores/userStore';
import type { User } from '@/types/schema';

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

async function openPreferences(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: 'Preferences' }));
  return screen.getByRole('radiogroup', { name: 'Weight units' });
}

const weightRadio = (name: 'kg' | 'lb') =>
  within(screen.getByRole('radiogroup', { name: 'Weight units' })).getByRole('radio', { name });
const lengthRadio = (name: 'cm' | 'inches') =>
  within(screen.getByRole('radiogroup', { name: 'Length units' })).getByRole('radio', { name });

/** The selected weight unit ('kg' | 'lb'). */
function selectedUnit(): 'kg' | 'lb' | null {
  if (weightRadio('kg').getAttribute('aria-checked') === 'true') return 'kg';
  if (weightRadio('lb').getAttribute('aria-checked') === 'true') return 'lb';
  return null;
}

/** The selected length unit ('cm' | 'in'). */
function selectedLength(): 'cm' | 'in' | null {
  if (lengthRadio('cm').getAttribute('aria-checked') === 'true') return 'cm';
  if (lengthRadio('inches').getAttribute('aria-checked') === 'true') return 'in';
  return null;
}

describe('Settings → Preferences auto-save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    failNextUpdate = false;
    storedPreferences = { units: 'kg', restTimer: 180, theme: 'dark' };
    useUserStore.setState({
      user: {
        id: 'user-1',
        experience: 'novice',
        preferences: { units: 'kg' },
        volumeLandmarks: {},
      } as unknown as User,
    });
  });

  it('saves units the moment they change, with no Save button', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderSettings();
    await openPreferences(user);

    expect(screen.queryByRole('button', { name: /save preferences/i })).not.toBeInTheDocument();
    expect(selectedUnit()).toBe('kg');

    await user.click(weightRadio('lb'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    // Only the preferences JSONB is written, merged over what is stored —
    // keys saved elsewhere (theme) survive. Length is pinned to what it was
    // showing (cm), so changing weight never flips height to inches.
    expect(mockUpdate).toHaveBeenCalledWith({
      preferences: { units: 'lb', lengthUnits: 'cm', restTimer: 180, theme: 'dark' },
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    // Every reader of units follows.
    expect(mockApplyPreferenceLocally).toHaveBeenCalledWith('units', 'lb');
    expect(mockRefreshUserStore).toHaveBeenCalledWith('user-1');
    const cached = queryClient.getQueryData<{ userRow: { preferences: Record<string, unknown> } }>([
      'settings',
      'user',
    ]);
    expect(cached?.userRow.preferences.units).toBe('lb');
    // …and the form was not reset by its own cache write.
    expect(selectedUnit()).toBe('lb');
    expect(selectedLength()).toBe('cm');
  });

  it('shows weight and length as separate top-level choices; an old user gets length from weight', async () => {
    storedPreferences = { units: 'lb', restTimer: 180, theme: 'dark' };
    const user = userEvent.setup();
    renderSettings();
    await openPreferences(user);
    // No lengthUnits stored: inches, as the old "lb & inches" setting gave.
    expect(selectedUnit()).toBe('lb');
    expect(selectedLength()).toBe('in');
  });

  it('saves the length unit on its own', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openPreferences(user);
    expect(selectedLength()).toBe('cm');

    await user.click(lengthRadio('inches'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      preferences: { units: 'kg', lengthUnits: 'in', restTimer: 180, theme: 'dark' },
    });
    expect(mockApplyPreferenceLocally).toHaveBeenCalledWith('lengthUnits', 'in');
    await waitFor(() => expect(screen.getByTestId('save-status-lengthUnits')).toHaveTextContent('Saved'));
    expect(selectedUnit()).toBe('kg');
    expect(selectedLength()).toBe('in');
  });

  it('shows Weight and Length units at the top of Settings, without opening a section', async () => {
    const user = userEvent.setup();
    renderSettings();
    // Landing tab (Profile): the unit controls are already on screen.
    const units = await screen.findByTestId('settings-units-card');
    expect(within(units).getByRole('radiogroup', { name: 'Weight units' })).toBeInTheDocument();
    expect(within(units).getByRole('radiogroup', { name: 'Length units' })).toBeInTheDocument();
    // Above the section switcher, and saved straight from there.
    const sections = screen.getByRole('radiogroup', { name: 'Settings sections' });
    expect(units.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(weightRadio('lb'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('save-status-units')).toHaveTextContent('Saved'));
    // Only one set of unit controls on the Preferences tab too.
    await user.click(screen.getByRole('radio', { name: 'Preferences' }));
    expect(screen.getAllByRole('radiogroup', { name: 'Weight units' })).toHaveLength(1);
  });

  it('puts Units first and confirms a save next to it, announced via aria-live', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openPreferences(user);

    // Units is the first card on the tab, under a plain "Units" heading;
    // Text size (with Beginner mode) comes right after it.
    const headings = screen.getAllByText(/^(Units|Text size|App preferences)$/);
    expect(headings.map((h) => h.textContent)).toEqual(['Units', 'Text size', 'App preferences']);

    await user.click(weightRadio('lb'));

    // ONE confirmation: the visible pill in the Units card is itself the
    // live region's content — no second hidden "Units saved" message.
    const live = screen.getByTestId('save-region-units');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(live).toHaveTextContent(/^Saved$/));
    expect(screen.getAllByText(/saved/i)).toHaveLength(1);
    expect(screen.queryByText(/Units saved/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-status-showFormCues')).not.toBeInTheDocument();

    // A switch moves the confirmation to its own row.
    await user.click(screen.getByRole('switch', { name: 'Show form cues' }));
    await waitFor(() => expect(screen.getByTestId('save-status-showFormCues')).toHaveTextContent('Saved'));
    expect(screen.getByTestId('save-region-showFormCues')).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('save-status-units')).not.toBeInTheDocument();
  });

  it('puts units back and says so when the save fails', async () => {
    const user = userEvent.setup();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    renderSettings();
    await openPreferences(user);

    failNextUpdate = true;
    await user.click(weightRadio('lb'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save: network down/i);
    expect(selectedUnit()).toBe('kg');
    expect(mockApplyPreferenceLocally).not.toHaveBeenCalled();
    expect(mockRefreshUserStore).not.toHaveBeenCalled();
  });

  it('flushes a pending rest-timer change when leaving Settings inside the debounce window', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSettings();
    await openPreferences(user);
    const slider = screen.getByLabelText(/Default rest timer/i);
    fireEvent.change(slider, { target: { value: '120' } });
    expect(mockUpdate).not.toHaveBeenCalled(); // still inside the 600 ms window

    unmount();

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        preferences: expect.objectContaining({ restTimer: 120, units: 'kg', theme: 'dark' }),
      })
    );
  });

  it('saves a switch on change', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openPreferences(user);

    // "Show form cues" (default on).
    await user.click(screen.getByRole('switch', { name: 'Show form cues' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        preferences: expect.objectContaining({ showFormCues: false, units: 'kg', theme: 'dark' }),
      })
    );
    expect(mockApplyPreferenceLocally).toHaveBeenCalledWith('showFormCues', false);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('turning on AI coach notes asks for AI consent and stays off when declined', async () => {
    const user = userEvent.setup();
    mockEnsureAiConsent.mockResolvedValueOnce(false);
    renderSettings();
    await openPreferences(user);

    const aiNotes = screen.getByRole('switch', { name: 'AI coach notes' });
    expect(aiNotes).toHaveAttribute('aria-checked', 'false');
    await act(async () => {
      await user.click(aiNotes);
    });

    expect(mockEnsureAiConsent).toHaveBeenCalled();
    expect(aiNotes).toHaveAttribute('aria-checked', 'false');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('shows Beginner mode under Text size, on for a novice, and saves a change', async () => {
    const user = userEvent.setup();
    mockExperience = 'novice';
    renderSettings();
    await openPreferences(user);

    expect(screen.getByRole('radiogroup', { name: 'Text size' })).toBeInTheDocument();
    const beginner = screen.getByRole('switch', { name: 'Beginner mode' });
    // No saved choice: on because the user is a novice.
    expect(beginner).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/effort in plain words/)).toBeInTheDocument();

    await user.click(beginner);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        preferences: expect.objectContaining({ beginnerMode: false, units: 'kg', theme: 'dark' }),
      })
    );
    expect(await screen.findByTestId('save-status-beginnerMode')).toHaveTextContent('Saved');
    expect(useUserStore.getState().user?.preferences.beginnerMode).toBe(false);
    mockExperience = 'intermediate';
  });
});
