import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkoutHeader, type ExerciseSegmentStatus, type WorkoutHeaderProps } from '../WorkoutHeader';

/**
 * Guards the two active-workout header fixes:
 *  1. Progress indicator can never overlap the timer/count text, and switches
 *     from individual segments (≤8 exercises) to a single continuous bar (>8).
 *  2. The timer is a tappable pause/resume pill (≥44pt hit area) whose paused
 *     state is unmistakable (amber, ▶, "Paused · m:ss"), wired to the existing
 *     pause action only.
 */

function makeSegments(total: number, completed: number, activeIndex = completed): ExerciseSegmentStatus[] {
  return Array.from({ length: total }, (_, i): ExerciseSegmentStatus =>
    i < completed ? 'completed' : i === activeIndex ? 'active' : 'pending'
  );
}

function renderHeader(overrides: Partial<WorkoutHeaderProps> = {}) {
  const toggle = jest.fn();
  const total = overrides.exerciseTotal ?? 4;
  const props: WorkoutHeaderProps = {
    workoutName: 'Push Day',
    exerciseNumber: 3,
    exerciseTotal: total,
    segments: makeSegments(total, 2),
    startedAt: '2026-07-11T10:00:00.000Z',
    timerStarted: true,
    workoutTimer: { isPaused: false, formattedTime: '5:13', toggle },
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
    isDeload: false,
    onToggleDeload: jest.fn(),
    onCancelWorkout: jest.fn(),
    onAddExercise: jest.fn(),
    onSaveAsTemplate: jest.fn(),
    onFinishWorkout: jest.fn(),
    onMinimize: jest.fn(),
    ...overrides,
  };
  const utils = render(<WorkoutHeader {...props} />);
  return { ...utils, toggle, props };
}

describe('WorkoutHeader progress indicator', () => {
  it('renders individual segments for ≤8 exercises', () => {
    renderHeader({ exerciseTotal: 4, segments: makeSegments(4, 2) });
    const seg = screen.getByTestId('workout-progress-segments');
    expect(seg).toBeInTheDocument();
    expect(screen.queryByTestId('workout-progress-bar')).not.toBeInTheDocument();
    // One dash per exercise.
    expect(seg.children).toHaveLength(4);
  });

  it('renders segments at the 8-exercise boundary (inclusive)', () => {
    renderHeader({ exerciseTotal: 8, segments: makeSegments(8, 3) });
    expect(screen.getByTestId('workout-progress-segments').children).toHaveLength(8);
    expect(screen.queryByTestId('workout-progress-bar')).not.toBeInTheDocument();
  });

  it('switches to a single continuous bar above 8 exercises', () => {
    renderHeader({ exerciseTotal: 12, segments: makeSegments(12, 3) });
    expect(screen.queryByTestId('workout-progress-segments')).not.toBeInTheDocument();
    const fill = screen.getByTestId('workout-progress-bar-fill');
    // 3 of 12 completed -> 25%.
    expect(fill).toHaveStyle({ width: '25%' });
  });

  it('progress lives in a separate element from the timer/count text (no overlap by construction)', () => {
    renderHeader({ exerciseTotal: 12, segments: makeSegments(12, 3) });
    const bar = screen.getByTestId('workout-progress-bar');
    const pill = screen.getByTestId('workout-timer-pill');
    // Neither is an ancestor of the other — they occupy independent rows.
    expect(bar.contains(pill)).toBe(false);
    expect(pill.contains(bar)).toBe(false);
  });
});

describe('WorkoutHeader timer pill', () => {
  it('is hidden until the session has started', () => {
    renderHeader({ startedAt: null });
    expect(screen.queryByTestId('workout-timer-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workout-timer-pill-idle')).not.toBeInTheDocument();
  });

  it('shows a muted non-interactive hint before the first set logs (no ⏸ 0:00, no pause affordance)', async () => {
    const user = userEvent.setup();
    const toggle = jest.fn();
    renderHeader({
      timerStarted: false,
      workoutTimer: { isPaused: false, formattedTime: '0:00', toggle },
    });
    expect(screen.queryByTestId('workout-timer-pill')).not.toBeInTheDocument();
    const idle = screen.getByTestId('workout-timer-pill-idle');
    expect(idle).toHaveTextContent('starts with first set');
    expect(idle).not.toHaveTextContent('0:00');
    // Not a button and no pause icon — nothing to pause yet.
    expect(idle.tagName).not.toBe('BUTTON');
    expect(idle.querySelector('.tabler-icon-player-pause')).not.toBeInTheDocument();
    await user.click(idle);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('switches to the live pause/resume pill once the timer has started', () => {
    renderHeader({ timerStarted: true });
    expect(screen.getByTestId('workout-timer-pill')).toBeInTheDocument();
    expect(screen.queryByTestId('workout-timer-pill-idle')).not.toBeInTheDocument();
  });

  it('reserves a ≥44pt hit area', () => {
    renderHeader();
    expect(screen.getByTestId('workout-timer-pill').className).toContain('min-h-[44px]');
  });

  it('shows a plain time and a pause icon while running', () => {
    renderHeader({ workoutTimer: { isPaused: false, formattedTime: '5:13', toggle: jest.fn() } });
    const pill = screen.getByTestId('workout-timer-pill');
    expect(pill).toHaveAttribute('data-paused', 'false');
    expect(pill).toHaveTextContent('5:13');
    expect(pill).not.toHaveTextContent('Paused');
    expect(pill.querySelector('.tabler-icon-player-pause')).toBeInTheDocument();
  });

  it('is unmistakably paused: amber, ▶ icon, "Paused · m:ss"', () => {
    renderHeader({ workoutTimer: { isPaused: true, formattedTime: '5:13', toggle: jest.fn() } });
    const pill = screen.getByTestId('workout-timer-pill');
    expect(pill).toHaveAttribute('data-paused', 'true');
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(pill).toHaveTextContent('Paused · 5:13');
    expect(pill.className).toContain('text-warning-400'); // amber
    expect(pill.querySelector('.tabler-icon-player-play')).toBeInTheDocument();
  });

  it('taps toggle the existing pause action only', async () => {
    const user = userEvent.setup();
    const { toggle, props } = renderHeader();
    await user.click(screen.getByTestId('workout-timer-pill'));
    expect(toggle).toHaveBeenCalledTimes(1);
    // No other page action is invoked by the pill tap.
    expect(props.onFinishWorkout).not.toHaveBeenCalled();
    expect(props.onCancelWorkout).not.toHaveBeenCalled();
    expect(props.onMinimize).not.toHaveBeenCalled();
  });
});

describe('WorkoutHeader save-as-template action', () => {
  it('is offered in the overflow menu', () => {
    renderHeader({ showToolsMenu: true });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByTestId('save-as-template-trigger')).toHaveTextContent(
      'Save as template'
    );
  });

  it('is not reachable while the menu is closed', () => {
    renderHeader({ showToolsMenu: false });
    expect(screen.queryByTestId('save-as-template-trigger')).not.toBeInTheDocument();
  });

  it('fires the save handler and closes the menu, touching nothing else', async () => {
    const user = userEvent.setup();
    const { props } = renderHeader({ showToolsMenu: true });
    await user.click(screen.getByTestId('save-as-template-trigger'));
    expect(props.onSaveAsTemplate).toHaveBeenCalledTimes(1);
    expect(props.onCloseToolsMenu).toHaveBeenCalledTimes(1);
    // Saving a template must never end or cancel the session.
    expect(props.onFinishWorkout).not.toHaveBeenCalled();
    expect(props.onCancelWorkout).not.toHaveBeenCalled();
  });
});

describe('WorkoutHeader duration estimate', () => {
  it('shows time remaining alongside the exercise count', () => {
    renderHeader({ remainingDurationLabel: '1h 05m' });
    expect(screen.getByTestId('workout-duration-remaining')).toHaveTextContent('~1h 05m left');
  });

  it('exposes the fuller estimate as a tooltip', () => {
    renderHeader({
      remainingDurationLabel: '35 min',
      remainingDurationHint: 'Estimated 1h 10m total · 18 sets across 5 exercises',
    });
    expect(screen.getByTestId('workout-duration-remaining')).toHaveAttribute(
      'title',
      'Estimated 1h 10m total · 18 sets across 5 exercises'
    );
  });

  it('says nothing when there is no time left to report', () => {
    renderHeader({ remainingDurationLabel: null });
    expect(screen.queryByTestId('workout-duration-remaining')).not.toBeInTheDocument();
  });

  it('leaves the exercise count intact', () => {
    renderHeader({ exerciseNumber: 3, exerciseTotal: 6, remainingDurationLabel: '20 min' });
    expect(screen.getByText(/exercise 3 of 6/)).toBeInTheDocument();
  });
});
