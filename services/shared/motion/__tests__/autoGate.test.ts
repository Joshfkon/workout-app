import type { ImuSample } from '@/types/motion';
import { AutoCaptureGate, shouldKeepAutoCapture, trimCaptureTail } from '../autoGate';
import { analyzeCapture } from '../captureAnalysis';
import { generateReps, type SyntheticRepSpec } from './synthetic';

const G = { x: 0, y: 0, z: -9.80665 };

function mk(tMs: number, gyroMag: number): ImuSample {
  return { tMs, gyro: { x: gyroMag, y: 0, z: 0 }, accel: G };
}

/** Feed samples at 60 Hz from t0 for durMs with a constant gyro magnitude. */
function feedRun(gate: AutoCaptureGate, t0: number, durMs: number, mag: number): number {
  let t = t0;
  for (; t < t0 + durMs; t += 1000 / 60) gate.feed(mk(t, mag));
  return t;
}

describe('AutoCaptureGate', () => {
  it('starts only after the threshold holds continuously for 200 ms', () => {
    const gate = new AutoCaptureGate();
    let t = feedRun(gate, 0, 2000, 0.05); // armed, quiet
    expect(gate.current()).toBe('armed');

    // A brief spike (100 ms) must NOT start a capture.
    t = feedRun(gate, t, 100, 0.8);
    t = feedRun(gate, t, 300, 0.05);
    expect(gate.current()).toBe('armed');

    // Sustained motion does.
    feedRun(gate, t, 250, 0.8);
    expect(gate.current()).toBe('capturing');
  });

  it('backfills the capture from 500 ms before the crossing', () => {
    const gate = new AutoCaptureGate();
    let t = feedRun(gate, 0, 2000, 0.05);
    const crossingT = t;
    t = feedRun(gate, t, 250, 0.8);
    expect(gate.current()).toBe('capturing');
    feedRun(gate, t, 500, 0.8);

    const samples = gate.collect();
    // First collected sample sits ~500 ms before the threshold crossing —
    // rep 1's ramp is preserved, not clipped at the crossing.
    expect(samples[0].tMs).toBeLessThanOrEqual(crossingT - 450);
    expect(samples[0].tMs).toBeGreaterThanOrEqual(crossingT - 600);
    expect(samples[samples.length - 1].tMs).toBeGreaterThan(crossingT + 700);
  });

  it('disarms after 3 minutes without qualifying motion; rearm revives it', () => {
    const gate = new AutoCaptureGate();
    feedRun(gate, 0, 3 * 60 * 1000 + 2000, 0.05);
    expect(gate.current()).toBe('disarmed');
    // Disarmed: samples are ignored entirely.
    feedRun(gate, 200_000 + 60_000, 400, 0.8);
    expect(gate.current()).toBe('disarmed');

    gate.rearm();
    expect(gate.current()).toBe('armed');
    let t = feedRun(gate, 300_000, 1000, 0.05);
    feedRun(gate, t, 250, 0.8);
    expect(gate.current()).toBe('capturing');
  });

  it('measures the disarm clock from the LAST qualifying motion, not from arming', () => {
    // Field failure this guards: enable → mount phone → load plates → rest.
    // A from-arm clock disarmed 3 min after enabling even though the phone
    // had just been handled, and the working set was silently never
    // captured. Brief above-threshold bursts (handling; < 200 ms sustain so
    // no capture starts) must keep resetting the quiet clock.
    const gate = new AutoCaptureGate();
    let t = 0;
    for (let burst = 0; burst < 3; burst++) {
      t = feedRun(gate, t, 2.5 * 60 * 1000, 0.05); // 2.5 min quiet
      expect(gate.current()).toBe('armed');
      t = feedRun(gate, t, 100, 0.8); // brief handling burst, not sustained
      expect(gate.current()).toBe('armed');
    }
    // 7.5+ minutes since arming, still armed — and still able to start.
    t = feedRun(gate, t, 1000, 0.05);
    feedRun(gate, t, 250, 0.8);
    expect(gate.current()).toBe('capturing');
  });

  it('disarms 3 quiet minutes after the last qualifying motion', () => {
    const gate = new AutoCaptureGate();
    let t = feedRun(gate, 0, 60 * 1000, 0.05);
    t = feedRun(gate, t, 100, 0.8); // handling burst resets the clock
    feedRun(gate, t, 3 * 60 * 1000 + 2000, 0.05);
    expect(gate.current()).toBe('disarmed');
  });

  it('sub-threshold fidgeting does not start a capture but does not block a later start', () => {
    const gate = new AutoCaptureGate();
    let t = feedRun(gate, 0, 5000, 0.3); // below 0.5 the whole time
    expect(gate.current()).toBe('armed');
    feedRun(gate, t, 250, 0.9);
    expect(gate.current()).toBe('capturing');
  });
});

describe('trimCaptureTail', () => {
  const rep: SyntheticRepSpec = {
    romDeg: 60,
    concentricMs: 1200,
    pauseTopMs: 400,
    eccentricMs: 1500,
    restAfterMs: 1200,
  };

  it('cuts the reach-for-the-phone tail back to the last rep boundary', () => {
    const signal = generateReps(Array(4).fill(rep), { gyroNoise: 0.005 });
    const lastT = signal.samples[signal.samples.length - 1].tMs;
    // Append 2 s of multi-axis pickup motion after the set.
    const pickup: ImuSample[] = [];
    for (let t = lastT + 16.7; t < lastT + 2000; t += 16.7) {
      pickup.push({
        tMs: t,
        gyro: { x: 0.9 * Math.sin(t / 90), y: 0.7 * Math.cos(t / 70), z: 0.5 * Math.sin(t / 50) },
        accel: { x: 2.5, y: -3, z: -8.5 },
      });
    }
    const withTail = [...signal.samples, ...pickup];

    const { samples: trimmed, analysis } = trimCaptureTail(withTail);
    expect(trimmed.length).toBeLessThan(withTail.length);
    // The pickup motion is gone (nothing survives past the last boundary +
    // margin) and the reps are intact.
    expect(trimmed[trimmed.length - 1].tMs).toBeLessThan(lastT + 300);
    expect(analysis.reps).toHaveLength(4);
    for (const r of analysis.reps) {
      expect(r.romConcentricDeg).toBeGreaterThan(55);
      expect(r.romConcentricDeg).toBeLessThan(65);
    }
  });

  it('is a no-op when the capture already ends at the last rep', () => {
    const signal = generateReps(Array(3).fill(rep), { gyroNoise: 0.005 });
    const { samples } = trimCaptureTail(signal.samples);
    // Trailing rest is short-bounded; nothing meaningful is removed.
    expect(samples.length).toBeGreaterThan(signal.samples.length * 0.7);
  });
});

describe('shouldKeepAutoCapture', () => {
  const rep: SyntheticRepSpec = {
    romDeg: 60,
    concentricMs: 1200,
    pauseTopMs: 400,
    eccentricMs: 1500,
    restAfterMs: 1200,
  };

  it('discards captures under 3 reps (warmups, seat adjustments, re-racking)', () => {
    const two = analyzeCapture(generateReps(Array(2).fill(rep)).samples);
    expect(two.reps).toHaveLength(2);
    expect(shouldKeepAutoCapture(two)).toBe(false);

    const three = analyzeCapture(generateReps(Array(3).fill(rep)).samples);
    expect(three.reps).toHaveLength(3);
    expect(shouldKeepAutoCapture(three)).toBe(true);
  });
});
