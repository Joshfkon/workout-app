/**
 * Regression: with a workout in progress, opening the "Log body data" sheet
 * from Home put the resume pill directly on top of the sheet's weight field,
 * so the user physically could not log a weigh-in without discarding or
 * resuming their planned session.
 *
 * The pill is fixed at the layout root and renders after page content, so at
 * equal z-index DOM order handed it the top of the stack. It now yields the
 * screen while any Modal/BottomSheet is open.
 */

import { render, screen } from '@testing-library/react';
import { BottomSheet } from '../BottomSheet';
import { ResumeWorkoutBanner } from '../ResumeWorkoutBanner';
import { resetOverlayRegistry } from '@/lib/ui/overlayRegistry';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/dashboard',
}));

const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5m ago

const storeState = {
  activeSession: { id: 'session-1', startedAt },
  exerciseBlocks: [{ id: 'block-1', exerciseId: 'ex-1', targetSets: 18 }],
  exercises: { 'ex-1': { primaryMuscle: 'forearms' } },
  setLogs: {},
  endSession: jest.fn(),
};

jest.mock('@/stores/workoutStore', () => ({
  useWorkoutStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));

function Harness({ sheetOpen }: { sheetOpen: boolean }) {
  return (
    <>
      {/* Page content first, chrome last — the real layout's DOM order. */}
      <BottomSheet isOpen={sheetOpen} onClose={() => {}} title="Log body data">
        <label htmlFor="weight">Weight (lb)</label>
        <input id="weight" type="number" />
        <button type="button">Save weight</button>
      </BottomSheet>
      <ResumeWorkoutBanner />
    </>
  );
}

describe('ResumeWorkoutBanner vs. open overlays', () => {
  afterEach(() => {
    resetOverlayRegistry();
  });

  it('shows the resume pill when no sheet is open', () => {
    render(<Harness sheetOpen={false} />);
    expect(screen.getByRole('button', { name: 'Resume workout' })).toBeInTheDocument();
  });

  it('hides the resume pill while a sheet is open, leaving its fields reachable', () => {
    const { rerender } = render(<Harness sheetOpen={false} />);
    expect(screen.getByRole('button', { name: 'Resume workout' })).toBeInTheDocument();

    rerender(<Harness sheetOpen />);

    expect(screen.queryByRole('button', { name: 'Resume workout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Weight (lb)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save weight' })).toBeInTheDocument();
  });

  it('brings the pill back once the sheet closes', () => {
    const { rerender } = render(<Harness sheetOpen />);
    expect(screen.queryByRole('button', { name: 'Resume workout' })).not.toBeInTheDocument();

    rerender(<Harness sheetOpen={false} />);
    expect(screen.getByRole('button', { name: 'Resume workout' })).toBeInTheDocument();
  });
});
