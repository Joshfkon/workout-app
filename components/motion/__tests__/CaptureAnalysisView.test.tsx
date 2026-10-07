import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cleanCapture } from '@/services/shared/motion';
import {
  analysisFromColumns,
  SETUP_STROKE_CAPTURE,
} from '@/services/shared/motion/__tests__/fixtures/realCaptures';
import { CaptureAnalysisView } from '../CaptureAnalysisView';

const analysis = () => analysisFromColumns(SETUP_STROKE_CAPTURE);

describe('CaptureAnalysisView', () => {
  it('leads with the coach, on clean reps: 8 reps, 0% loss — not 56%', () => {
    render(<CaptureAnalysisView analysis={analysis()} coachContext={{ loggedReps: 8 }} />);
    expect(screen.getByTestId('coach-verdict')).toHaveTextContent('Steady set — you had more in the tank.');
    expect(screen.getAllByTestId('coach-cue')[0]).toHaveTextContent(/^Rep 3 took 2\.3 seconds to lower/);
    expect(screen.getByTestId('motion-summary-line')).toHaveTextContent('8 reps · 0% velocity loss');
    expect(screen.getByTestId('motion-summary-status')).toHaveTextContent('Easy');
    expect(screen.queryByText(/measurements, not errors/)).toBeNull();
  });

  it('shows only Rep | Tempo | Velocity | ROM, renumbered after cleaning, detail on tap', async () => {
    const user = userEvent.setup();
    render(<CaptureAnalysisView analysis={analysis()} />);
    const table = screen.getByTestId('motion-analysis-rep-table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Rep',
      'Tempo',
      'Velocity',
      'ROM',
    ]);
    // Clean rep 1 is detected rep 2 (the setup stroke is gone) and is the baseline.
    const row1 = screen.getByTestId('motion-rep-row-1');
    expect(row1).toHaveTextContent('1.2↑ 1.1↓');
    expect(row1).toHaveTextContent('100%');
    await user.click(row1);
    expect(screen.getByTestId('motion-rep-detail-1')).toHaveTextContent('Mean ω32°/s'); // 0.56 rad/s
  });

  it('logs the rejected setup stroke in diagnostics', async () => {
    const user = userEvent.setup();
    render(<CaptureAnalysisView analysis={analysis()} />);
    await user.click(screen.getByTestId('motion-diagnostics-toggle'));
    expect(screen.getByTestId('motion-cleaning-log')).toHaveTextContent(
      'Detected rep 1 set aside as setup motion: lifted in 0.47 s (typical 1.02 s)'
    );
  });

  it('low confidence: the reason, no velocity bars, no cues', () => {
    render(<CaptureAnalysisView analysis={analysis()} coachContext={{ loggedReps: 12 }} />);
    expect(screen.getByTestId('coach-unclear')).toHaveTextContent(
      'Capture unclear: The sensor counted 8 reps but you logged 12.'
    );
    expect(screen.queryByTestId('motion-velocity-bars')).toBeNull();
    expect(screen.queryByTestId('coach-cue')).toBeNull();
    expect(screen.getByTestId('motion-summary-line')).toHaveTextContent(/^8 reps$/);
  });

  it('multi-axis motion reads in plain language; the PC1 detail stays in diagnostics', async () => {
    const user = userEvent.setup();
    render(<CaptureAnalysisView analysis={analysisFromColumns(SETUP_STROKE_CAPTURE, 0.6)} />);
    expect(screen.getByTestId('motion-multi-axis-note')).toHaveTextContent(
      'The sensor picked up movement in more than one direction, so these numbers are rough.'
    );
    expect(screen.queryByText(/single-DOF/)).toBeNull();
    await user.click(screen.getByTestId('motion-diagnostics-toggle'));
    expect(screen.getByTestId('motion-pc1-technical')).toHaveTextContent(/below 80%, the motion is not single-DOF/);
  });

  it('works from a cleaning snapshot alone (no raw: no chart, no sensor badge)', () => {
    const cleaned = cleanCapture(analysis());
    render(<CaptureAnalysisView analysis={null} cleaned={cleaned} />);
    expect(screen.getByTestId('motion-summary-line')).toHaveTextContent('8 reps');
    expect(screen.queryByTestId('motion-rep-detection')).toBeNull();
    expect(screen.queryByTestId('motion-quality-badge')).toBeNull();
  });
});
