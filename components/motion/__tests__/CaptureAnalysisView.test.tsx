import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CaptureAnalysis, CaptureRep } from '@/services/shared/motion';
import { CaptureAnalysisView } from '../CaptureAnalysisView';

const MEAN_W = [0.64, 0.69, 0.75, 0.69, 0.69, 0.64, 0.67, 0.62, 0.55, 0.42];

function mkRep(index: number, meanW: number): CaptureRep {
  return {
    index,
    concentric: { dir: 1, startIdx: 0, endIdx: 0, durationMs: 1000, romDeg: 70, peakW: 1, meanW, romGravityDeg: null },
    eccentric: { dir: -1, startIdx: 0, endIdx: 0, durationMs: 1000, romDeg: 70, peakW: 1, meanW, romGravityDeg: null },
    concentricMs: 1000,
    eccentricMs: 1040,
    peakW: meanW * 1.6,
    meanWConcentric: meanW,
    romConcentricDeg: 72,
    romEccentricDeg: 72,
    romGravityDeg: null,
    bottomDwellMs: index === 0 ? null : 100,
    turnaroundPeakAccelRadps2: index === 0 ? null : 3,
  };
}

function mkAnalysis(overrides: Partial<CaptureAnalysis> = {}): CaptureAnalysis {
  return {
    sampleRateHz: 60,
    droppedFrames: 0,
    durationMs: 30000,
    stillness: {} as CaptureAnalysis['stillness'],
    tier: 'mounted',
    axis: { x: 1, y: 0, z: 0 },
    pc1VarianceShare: 0.95,
    pc1Pc2Ratio: 20,
    lowConfidence: false,
    pc1GravityAngleDeg: 80,
    gravityRomStatus: 'ok',
    romSuppressed: false,
    tMs: [],
    w: [],
    halfReps: [],
    reps: MEAN_W.map((w, i) => mkRep(i, w)),
    unpairedHalfReps: 0,
    ...overrides,
  };
}

describe('CaptureAnalysisView', () => {
  it('leads with reps, velocity loss vs the fastest rep, and the zone phrase', () => {
    render(<CaptureAnalysisView analysis={mkAnalysis()} />);
    expect(screen.getByTestId('motion-summary-line')).toHaveTextContent('10 reps · 44% velocity loss');
    expect(screen.getByTestId('motion-summary-status')).toHaveTextContent('Near failure');
    expect(screen.getByTestId('motion-quality-badge')).toHaveTextContent('Clean capture');
    expect(screen.getByTestId('motion-callouts')).toHaveTextContent(
      'Rep 10 slowed sharply — likely close to failure.'
    );
    expect(screen.queryByText(/measurements, not errors/)).toBeNull();
  });

  it('hides the loss headline under 3 reps', () => {
    render(<CaptureAnalysisView analysis={mkAnalysis({ reps: [mkRep(0, 0.7), mkRep(1, 0.6)] })} />);
    expect(screen.getByTestId('motion-summary-line')).toHaveTextContent(/^2 reps$/);
    expect(screen.queryByTestId('motion-summary-status')).toBeNull();
  });

  it('shows only Rep | Tempo | Velocity | ROM, with detail on tap', async () => {
    const user = userEvent.setup();
    render(<CaptureAnalysisView analysis={mkAnalysis()} />);
    const table = screen.getByTestId('motion-analysis-rep-table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Rep', 'Tempo', 'Velocity', 'ROM']);
    const row3 = screen.getByTestId('motion-rep-row-3');
    expect(row3).toHaveTextContent('1.0↑ 1.0↓');
    expect(row3).toHaveTextContent('100%');
    expect(row3).not.toHaveTextContent('rad/s');

    await user.click(row3);
    const detail = screen.getByTestId('motion-rep-detail-3');
    expect(detail).toHaveTextContent('Mean ω43°/s'); // 0.75 rad/s
    expect(detail).toHaveTextContent('Peak ω');
    expect(detail).toHaveTextContent('Dwell');
    expect(detail).toHaveTextContent('ROM (gravity)');
  });

  it('keeps diagnostics collapsed; the warning badge names the problem and opens them', async () => {
    const user = userEvent.setup();
    const onDownloadCsv = jest.fn();
    render(
      <CaptureAnalysisView
        analysis={mkAnalysis({ droppedFrames: 2, tier: 'handheld' })}
        stopLatencyMs={42}
        onDownloadCsv={onDownloadCsv}
      />
    );
    expect(screen.queryByTestId('motion-download-csv')).toBeNull();
    const badge = screen.getByTestId('motion-quality-badge');
    expect(badge).toHaveTextContent('2 dropped samples +1');

    Element.prototype.scrollIntoView = jest.fn();
    await user.click(badge);
    expect(screen.getByTestId('motion-stop-latency')).toHaveTextContent('42 ms');
    await user.click(screen.getByTestId('motion-download-csv'));
    expect(onDownloadCsv).toHaveBeenCalled();
  });

  it('keeps the rep-detection chart collapsed by default', () => {
    render(<CaptureAnalysisView analysis={mkAnalysis()} />);
    expect(screen.getByTestId('motion-rep-detection-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});
