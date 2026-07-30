import { segmentPhases } from '../segmentation';
import { LiveCaptureGate } from '../liveGate';

/** Build (omega, t, theta) series from a per-sample rate array at 100 Hz. */
function series(omega: number[]): { omega: number[]; t: number[]; theta: number[] } {
  const t = omega.map((_, i) => i * 10);
  const theta: number[] = [0];
  for (let i = 1; i < omega.length; i++) theta.push(theta[i - 1] + omega[i] * 0.01);
  return { omega, t, theta };
}

describe('segmentPhases (hysteresis)', () => {
  it('does not chatter on noise around zero (below the high threshold)', () => {
    // ±0.2 rad/s sign-flipping noise: crosses zero constantly, never exceeds
    // OMEGA_HIGH — a bare zero-crossing segmenter would emit dozens of phases.
    const noisy = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? 0.2 : -0.2));
    const { omega, t, theta } = series(noisy);
    expect(segmentPhases(omega, t, theta)).toHaveLength(0);
  });

  it('keeps one phase open across a mid-stroke dip that stays above the low band', () => {
    // 0.6 → 0.15 → 0.6 rad/s: the dip crosses the high threshold but not the
    // low one, so hysteresis must keep a single phase open.
    const omega = [
      ...Array(30).fill(0),
      ...Array(60).fill(0.6),
      ...Array(20).fill(0.15),
      ...Array(60).fill(0.6),
      ...Array(30).fill(0),
    ];
    const { t, theta } = series(omega);
    const phases = segmentPhases(omega, t, theta);
    expect(phases).toHaveLength(1);
    expect(phases[0].dir).toBe(1);
  });

  it('splits opposite-direction strokes into separate phases', () => {
    const omega = [
      ...Array(30).fill(0),
      ...Array(80).fill(0.5),
      ...Array(40).fill(0),
      ...Array(80).fill(-0.5),
      ...Array(30).fill(0),
    ];
    const { t, theta } = series(omega);
    const phases = segmentPhases(omega, t, theta);
    expect(phases.map((p) => p.dir)).toEqual([1, -1]);
  });
});

describe('LiveCaptureGate', () => {
  it('collects a bias estimate while armed, starts on motion onset, auto-stops after quiet', () => {
    const gate = new LiveCaptureGate();
    // 1 s armed-quiet with a 0.02 rad/s bias.
    for (let t = 0; t < 1000; t += 10) expect(gate.feed(t, 0.02)).toBe('armed');
    expect(gate.biasEstimate()).toBeCloseTo(0.02, 3);

    // Motion onset.
    expect(gate.feed(1000, 0.8)).toBe('recording');
    expect(gate.motionStartedAt()).toBe(1000);

    // Active movement holds the recording open.
    for (let t = 1010; t < 3000; t += 10) expect(gate.feed(t, 0.5)).toBe('recording');

    // 5 s below the rest threshold → done.
    let state: string = 'recording';
    for (let t = 3000; t <= 8100 && state !== 'done'; t += 10) {
      state = gate.feed(t, 0.02);
    }
    expect(state).toBe('done');
  });

  it('does not auto-stop before the quiet window elapses', () => {
    const gate = new LiveCaptureGate();
    for (let t = 0; t < 500; t += 10) gate.feed(t, 0);
    gate.feed(500, 0.8);
    for (let t = 510; t < 4900; t += 10) gate.feed(t, 0);
    expect(gate.current()).toBe('recording');
  });
});
