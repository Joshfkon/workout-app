import { fireEvent, render, screen } from '@testing-library/react';
import { cleanCapture } from '@/services/shared/motion';
import {
  analysisFromColumns,
  SETUP_STROKE_CAPTURE,
} from '@/services/shared/motion/__tests__/fixtures/realCaptures';
import { MotionCoachSheet } from '../MotionCoachSheet';

jest.mock('@/lib/actions/motion-coach', () => ({ phraseCoachFeedback: jest.fn() }));

const ctx = { loggedReps: 8, loggedRir: 3, weightKg: 40, pausePoint: 'bottom' as const, history: null };
const props = {
  title: 'Set 2 · 90 lb × 8',
  exerciseName: 'Leg Extension',
  coachContext: ctx,
  nextSetCall: 'Next set: add 5 lb (95 lb × 12–13).',
  loggedWeightLabel: '90 lb',
  workoutSessionId: 'session-1',
};

describe('MotionCoachSheet', () => {
  it('verdict, up to two cues, the next-set call — details collapsed', () => {
    const analysis = analysisFromColumns(SETUP_STROKE_CAPTURE);
    render(
      <MotionCoachSheet
        {...props}
        capture={{ analysis, cleaned: cleanCapture(analysis), metrics: null }}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId('coach-verdict')).toHaveTextContent('Steady set — you had more in the tank.');
    expect(screen.getAllByTestId('coach-cue')).toHaveLength(2);
    expect(screen.getByTestId('coach-next-set')).toHaveTextContent('Next set: add 5 lb (95 lb × 12–13).');
    expect(screen.getByTestId('motion-sheet-details-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('motion-analysis-rep-table')).toBeNull();
  });

  it('a pre-cleaning capture without raw gets no coach feedback, only its stored numbers', () => {
    render(
      <MotionCoachSheet
        {...props}
        capture={{
          analysis: null,
          cleaned: null,
          metrics: {
            pc1VarianceShare: 0.9,
            pc1GravityAngleDeg: 80,
            reps: [{ index: 0, romDeg: 60, meanConcentricW_radps: 0.6, peakConcentricW_radps: 1.1, bottomDwellMs: null, turnaroundPeakAccel_radps2: null }],
          },
        }}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId('motion-legacy-capture')).toBeInTheDocument();
    expect(screen.queryByTestId('coach-verdict')).toBeNull();
    fireEvent.click(screen.getByTestId('motion-sheet-details-toggle'));
    expect(screen.getByTestId('motion-legacy-metrics')).toHaveTextContent('34°/s');
  });

  it('dismisses on a downward swipe past the threshold, not on a short drag', () => {
    const onClose = jest.fn();
    const analysis = analysisFromColumns(SETUP_STROKE_CAPTURE);
    render(
      <MotionCoachSheet {...props} capture={{ analysis, cleaned: cleanCapture(analysis), metrics: null }} onClose={onClose} />
    );
    const sheet = screen.getByTestId('bottom-sheet');
    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientY: 140 }] });
    fireEvent.touchEnd(sheet);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientY: 220 }] });
    fireEvent.touchEnd(sheet);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
