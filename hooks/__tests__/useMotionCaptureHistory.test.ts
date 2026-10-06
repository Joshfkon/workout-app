import { compactSamples } from '@/lib/motion/motionPersistence';
import { cleanCapture } from '@/services/shared/motion';
import { analysisFromColumns, SETUP_STROKE_CAPTURE } from '@/services/shared/motion/__tests__/fixtures/realCaptures';
import { generateReps } from '@/services/shared/motion/__tests__/synthetic';
import { resolveStoredCapture } from '../useMotionCaptureHistory';
import type { CaptureAnalysisMetrics } from '@/types/motion';

const legacyMetrics: CaptureAnalysisMetrics = {
  pc1VarianceShare: 0.9,
  pc1GravityAngleDeg: 80,
  reps: [{ index: 0, romDeg: 60, meanConcentricW_radps: 1.46, peakConcentricW_radps: 2.88, bottomDwellMs: null, turnaroundPeakAccel_radps2: null }],
};
const row = (m: CaptureAnalysisMetrics | null) => ({ id: 'cap-1', calibration_id: 'cal-1', analysis_metrics: m });

describe('resolveStoredCapture', () => {
  it('reprocesses through the current pipeline when the raw buffer exists', () => {
    const rep = { romDeg: 60, concentricMs: 1000, pauseTopMs: 300, eccentricMs: 1300, restAfterMs: 600 };
    const samples = generateReps(Array(6).fill(rep), { gyroNoise: 0.005, sampleRateHz: 60 }).samples;
    const out = resolveStoredCapture(row(legacyMetrics), compactSamples(samples));
    expect(out.source).toBe('reprocessed');
    expect(out.cleaned!.reps).toHaveLength(6);
    expect(out.cleaned!.pc1ShareClean).not.toBeNull();
    expect(out.analysis).not.toBeNull();
  });

  it('uses a current cleaning snapshot when there is no raw', () => {
    const cleaned = cleanCapture(analysisFromColumns(SETUP_STROKE_CAPTURE));
    const out = resolveStoredCapture(row({ ...legacyMetrics, cleaningVersion: 2, cleaned }), null);
    expect(out.source).toBe('stored');
    expect(out.cleaned!.reps).toHaveLength(8);
  });

  it('never coaches a pre-cleaning capture without raw (legacy auto-capture path)', () => {
    const out = resolveStoredCapture(row(legacyMetrics), null);
    expect(out.source).toBe('legacy');
    expect(out.cleaned).toBeNull();
    expect(out.metrics).toBe(legacyMetrics); // raw details still openable
  });
});
