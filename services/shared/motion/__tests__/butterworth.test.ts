import { designButterworthLP4, filtfilt, lowpassZeroPhase } from '../butterworth';

const FS = 60;

function sine(freqHz: number, n: number, fs: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * freqHz * (i / fs)));
}

describe('butterworth zero-phase low-pass (4th order, 3 Hz)', () => {
  it('preserves DC exactly', () => {
    const out = lowpassZeroPhase(new Array(400).fill(2.5), 3, FS);
    for (const v of out) expect(v).toBeCloseTo(2.5, 6);
  });

  it('passes a 0.5 Hz sinusoid with unit gain and ZERO phase shift', () => {
    const n = 600;
    const x = sine(0.5, n, FS);
    const y = lowpassZeroPhase(x, 3, FS);
    // Compare away from the edges.
    let maxErr = 0;
    for (let i = 60; i < n - 60; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - x[i]));
    // Zero-phase and ~unit passband gain → the output tracks the input
    // sample-for-sample; a single-pass (phase-lagged) filter would miss by
    // sin(phase) ≈ 0.1 here.
    expect(maxErr).toBeLessThan(0.02);
  });

  it('strongly attenuates 10 Hz (above the 3 Hz cutoff)', () => {
    const n = 600;
    const y = lowpassZeroPhase(sine(10, n, FS), 3, FS);
    const peak = Math.max(...y.slice(60, n - 60).map(Math.abs));
    // 4th order applied twice (forward+backward) ⇒ ~84 dB at 10/3 octaves.
    expect(peak).toBeLessThan(0.01);
  });

  it('returns short signals unchanged (nothing to filter)', () => {
    expect(filtfilt([1, 2, 3], designButterworthLP4(3, FS))).toEqual([1, 2, 3]);
  });

  it('clamps the cutoff below Nyquist and stays stable on slow streams', () => {
    // 3 Hz cutoff on a 5 Hz stream would be above Nyquist — the design must
    // clamp instead of producing an unstable filter.
    const out = lowpassZeroPhase(new Array(200).fill(1), 3, 5);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(out[100]).toBeCloseTo(1, 3);
  });

  it('does not shift zero crossings of a mixed signal (rep-boundary safety)', () => {
    const n = 900;
    const fs = 60;
    const x = Array.from({ length: n }, (_, i) => {
      const t = i / fs;
      return 1.5 * Math.sin(2 * Math.PI * 0.4 * t) + 0.2 * Math.sin(2 * Math.PI * 12 * t);
    });
    const y = filtfilt(x, designButterworthLP4(3, fs));
    // Zero crossings of the filtered signal should sit at the 0.4 Hz
    // component's crossings (every 1.25 s = 75 samples), within a sample.
    const crossings: number[] = [];
    for (let i = 1; i < n; i++) {
      if (y[i - 1] < 0 && y[i] >= 0) crossings.push(i);
    }
    for (const c of crossings) {
      const nearest = Math.round(c / 75) * 75;
      expect(Math.abs(c - nearest)).toBeLessThanOrEqual(1);
    }
  });
});
