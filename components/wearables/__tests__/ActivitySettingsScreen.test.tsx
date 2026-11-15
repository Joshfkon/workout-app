import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivitySettingsScreen } from '../ActivitySettingsScreen';
import * as wearableActions from '@/lib/actions/wearable';

jest.mock('@/lib/actions/wearable', () => ({
  getActivitySettings: jest.fn(),
  saveActivitySettings: jest.fn(),
  getActiveWearableConnections: jest.fn(),
}));
jest.mock('@/lib/actions/step-calorie-adjustment', () => ({
  getStepAdjustmentInputs: jest.fn(),
}));

const defaults = {
  userId: 'u1',
  adjustmentMode: 'fixed' as const,
  maxDailyAdjustment: 300,
  targetDeficitCals: 500,
  useAppWorkoutEstimates: true,
  useWearableWorkoutCalories: false,
  preferredWearableSource: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderScreen() {
  const qc = new QueryClient();
  const invalidate = jest.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <ActivitySettingsScreen />
    </QueryClientProvider>
  );
  return { invalidate };
}

describe('ActivitySettingsScreen — calorie adjustment mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (wearableActions.getActiveWearableConnections as jest.Mock).mockResolvedValue([]);
    (wearableActions.saveActivitySettings as jest.Mock).mockResolvedValue({ success: true });
  });

  it('defaults to Fixed and offers Step-adjusted (no "coming soon", no deficit-locked)', async () => {
    (wearableActions.getActivitySettings as jest.Mock).mockResolvedValue(defaults);
    renderScreen();
    const fixed = await screen.findByRole('radio', { name: /Fixed target/ });
    expect(fixed).toBeChecked();
    expect(screen.getByRole('radio', { name: /Step-adjusted/ })).not.toBeChecked();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/isn.t active yet/i)).toBeNull();
    expect(screen.queryByRole('radio', { name: /Deficit-locked/ })).toBeNull();
  });

  it('saves Step-adjusted and refreshes the adjusted target', async () => {
    (wearableActions.getActivitySettings as jest.Mock).mockResolvedValue(defaults);
    const { invalidate } = renderScreen();
    await userEvent.click(await screen.findByRole('radio', { name: /Step-adjusted/ }));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(wearableActions.saveActivitySettings).toHaveBeenCalledWith(
        expect.objectContaining({ adjustmentMode: 'activity_adjusted' })
      )
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['step-calorie-adjustment'] })
    );
  });

  it('shows a stored legacy deficit_locked value as retired', async () => {
    (wearableActions.getActivitySettings as jest.Mock).mockResolvedValue({
      ...defaults,
      adjustmentMode: 'deficit_locked',
    });
    renderScreen();
    expect(await screen.findByRole('radio', { name: /Deficit-locked \(retired\)/ })).toBeChecked();
  });
});
