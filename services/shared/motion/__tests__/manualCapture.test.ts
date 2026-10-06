import type { ImuSample } from '@/types/motion';
import {
  finishManualCapture,
  isMountedNow,
  liveRepCount,
  ManualCaptureClock,
} from '../manualCapture';
import { MOTION_SET_CONFIG } from '../motionSetConfig';
import { generateReps, type SyntheticRepSpec } from './synthetic';

const still = (fromMs: number, toMs: number, gyro = 0.01): ImuSample[] => {
  const out: ImuSample[] = [];
  for (let t = fromMs; t <= toMs; t += 16) {
    out.push({ tMs: t, gyro: { x: gyro, y: 0, z: 0 }, accel: { x: 0, y: -9.8, z: 0 } });
  }
  return out;
};

const rep: SyntheticRepSpec = {
  romDeg: 60,
  concentricMs: 1000,
  pauseTopMs: 300,
  eccentricMs: 1300,
  restAfterMs: 600,
};

describe('isMountedNow', () => {
  it('needs a full hold window of near-still samples', () => {
    expect(isMountedNow(still(0, 500))).toBe(false); // too short
    expect(isMountedNow(still(0, 1200))).toBe(true);
    expect(isMountedNow(still(0, 1200, 0.5))).toBe(false); // hand-held wobble
  });
});

describe('ManualCaptureClock', () => {
  it('auto-stops only after ≥ 1 rep and the configured quiet time', () => {
    const quiet = MOTION_SET_CONFIG.capture.autoStopQuietMs;
    const clock = new ManualCaptureClock();
    clock.feed({ tMs: 0, gyro: { x: 2, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 } });
    clock.feed({ tMs: quiet - 1, gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 } });
    expect(clock.shouldAutoStop(3)).toBe(false);
    clock.feed({ tMs: quiet + 1, gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 } });
    expect(clock.shouldAutoStop(0)).toBe(false); // no rep yet: never auto-stop
    expect(clock.shouldAutoStop(1)).toBe(true);
    expect(clock.lastMotion()).toBe(0);
  });
});

describe('finishManualCapture', () => {
  it('counts the reps live and at stop, and backdates the end to the last rep', () => {
    const { samples } = generateReps(Array(6).fill(rep), { gyroNoise: 0.005, sampleRateHz: 60 });
    // 12 s of stillness after the set (the safety auto-stop case).
    const lastT = samples[samples.length - 1].tMs;
    const all = [...samples, ...still(lastT + 16, lastT + 12_000, 0)];
    expect(liveRepCount(all)).toBe(6);

    const clock = new ManualCaptureClock();
    for (const s of all) clock.feed(s);
    expect(clock.shouldAutoStop(6)).toBe(true);

    const done = finishManualCapture(all, clock.lastMotion());
    expect(done.gating.reps).toHaveLength(6);
    expect(done.endTMs).not.toBeNull();
    // The set ended within a rep-rest of the last motion, ~12 s before "now".
    expect(lastT + 12_000 - done.endTMs!).toBeGreaterThan(11_000);
    expect(done.samples[done.samples.length - 1].tMs).toBeLessThan(lastT + 1_000);
  });

  it('reports zero reps for a capture with no movement', () => {
    const done = finishManualCapture(still(0, 3000));
    expect(done.gating.reps).toHaveLength(0);
  });
});
