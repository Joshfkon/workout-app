import type { ImuSample } from '@/types/motion';
import { trimCaptureTail } from '../autoGate';
import { generateReps, type SyntheticRepSpec } from './synthetic';

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
