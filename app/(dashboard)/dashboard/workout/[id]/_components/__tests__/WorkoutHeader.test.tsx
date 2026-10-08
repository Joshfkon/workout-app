import { render, screen, fireEvent } from '@testing-library/react';
import { WorkoutHeader } from '../WorkoutHeader';
import type { WorkoutHeaderProps } from '../WorkoutHeader';

describe('WorkoutHeader', () => {
  const defaultProps: WorkoutHeaderProps = {
    workoutName: 'Push Day',
    exerciseNumber: 2,
    exerciseTotal: 5,
    segments: ['completed', 'active', 'pending', 'pending', 'pending'],
    remainingDurationLabel: '45m',
    remainingDurationHint: 'About 45 minutes remaining',
    startedAt: '2024-01-01T10:00:00Z',
    timerStarted: true,
    workoutTimer: {
      isPaused: false,
      formattedTime: '12:34',
      toggle: jest.fn(),
    },
    allCollapsed: false,
    onToggleAllCollapsed: jest.fn(),
    showToolsMenu: false,
    onToggleToolsMenu: jest.fn(),
    onCloseToolsMenu: jest.fn(),
    injuryCount: 0,
    onOpenInjuryModal: jest.fn(),
    onOpenReadinessModal: jest.fn(),
    onOpenMuscleReadiness: jest.fn(),
    onOpenPlateCalculator: jest.fn(),
    locationName: 'Home Gym',
    onOpenLocationPicker: jest.fn(),
    isDeload: false,
    onToggleDeload: jest.fn(),
    onCancelWorkout: jest.fn(),
    onAddExercise: jest.fn(),
    onSaveAsTemplate: jest.fn(),
    onFinishWorkout: jest.fn(),
    onMinimize: jest.fn(),
  };

  it('has no backdrop-blur class on root element', () => {
    const { container } = render(<WorkoutHeader {...defaultProps} />);
    
    const header = container.querySelector('[data-testid="workout-header"]');
    expect(header).toBeInTheDocument();
    expect(header?.className).not.toContain('backdrop-blur');
  });

  it('has no transform or will-change-transform on root element', () => {
    const { container } = render(<WorkoutHeader {...defaultProps} />);
    
    const header = container.querySelector('[data-testid="workout-header"]');
    expect(header).toBeInTheDocument();
    expect(header?.className).not.toContain('will-change-transform');
    expect(header?.className).not.toContain('[transform:translateZ(0)]');
    expect(header?.className).not.toContain('transform');
  });

  it('calls onCloseToolsMenu when clicking the tools menu backdrop', () => {
    const onCloseToolsMenu = jest.fn();
    const props = {
      ...defaultProps,
      showToolsMenu: true,
      onCloseToolsMenu,
    };

    render(<WorkoutHeader {...props} />);

    // Find the backdrop (fixed inset-0 z-10 div)
    const backdrop = screen.getByTestId('workout-header').parentElement?.querySelector('.fixed.inset-0.z-10');
    expect(backdrop).toBeInTheDocument();

    // Click the backdrop
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    expect(onCloseToolsMenu).toHaveBeenCalledTimes(1);
  });

  it('does not render tools menu backdrop when showToolsMenu is false', () => {
    const props = {
      ...defaultProps,
      showToolsMenu: false,
    };

    const { container } = render(<WorkoutHeader {...props} />);

    // Backdrop should not exist
    const backdrop = container.querySelector('.fixed.inset-0.z-10');
    expect(backdrop).not.toBeInTheDocument();
  });
});
