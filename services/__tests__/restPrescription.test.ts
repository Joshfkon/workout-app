import { prescribeRestSeconds } from '../restPrescription';
import {
  DEFAULT_REST_SECONDS,
  REST_EXTEND_FAILURE_S,
  REST_EXTEND_HARD_S,
  REST_MAX_S,
} from '../suggestionEngine/constants';

describe('prescribeRestSeconds', () => {
  it('base rest, no note, when the set landed on target', () => {
    const rx = prescribeRestSeconds({ baseSeconds: 120, lastSetRir: 2, targetRir: 2 });
    expect(rx).toEqual({ seconds: 120, adjustmentSeconds: 0, note: null });
  });

  it('a set at/past the failure deadband extends rest by the failure step', () => {
    // The live-session gap: 0 RIR against a 2-RIR target got stock rest.
    const rx = prescribeRestSeconds({ baseSeconds: 120, lastSetRir: 0, targetRir: 2 });
    expect(rx.seconds).toBe(120 + REST_EXTEND_FAILURE_S);
    expect(rx.adjustmentSeconds).toBe(REST_EXTEND_FAILURE_S);
    expect(rx.note).toMatch(/failure/);
  });

  it('a full rep hotter than target extends by the hard step', () => {
    const rx = prescribeRestSeconds({ baseSeconds: 120, lastSetRir: 1, targetRir: 2 });
    expect(rx.seconds).toBe(120 + REST_EXTEND_HARD_S);
    expect(rx.note).toMatch(/hotter than target/);
  });

  it('the half-chip tolerance does not extend (RPE-7.5 chip → RIR 2.5 vs target 3)', () => {
    const rx = prescribeRestSeconds({ baseSeconds: 120, lastSetRir: 2.5, targetRir: 3 });
    expect(rx.adjustmentSeconds).toBe(0);
    expect(rx.note).toBeNull();
  });

  it('an EASIER-than-target set never shortens rest', () => {
    const rx = prescribeRestSeconds({ baseSeconds: 120, lastSetRir: 4, targetRir: 2 });
    expect(rx.seconds).toBe(120);
    expect(rx.note).toBeNull();
  });

  it('no effort signal (dropset finale) → base rest, unmodulated', () => {
    const rx = prescribeRestSeconds({ baseSeconds: 120, targetRir: 2 });
    expect(rx).toEqual({ seconds: 120, adjustmentSeconds: 0, note: null });
  });

  it('a missing/zero stored rest falls back to the default LOUDLY', () => {
    for (const base of [0, null, undefined, NaN, -30]) {
      const rx = prescribeRestSeconds({ baseSeconds: base, targetRir: 2 });
      expect(rx.seconds).toBe(DEFAULT_REST_SECONDS);
      expect(rx.note).toMatch(/no stored rest/);
    }
  });

  it('fallback and effort extension compose, both named', () => {
    const rx = prescribeRestSeconds({ baseSeconds: 0, lastSetRir: 0, targetRir: 2 });
    expect(rx.seconds).toBe(DEFAULT_REST_SECONDS + REST_EXTEND_FAILURE_S);
    expect(rx.note).toMatch(/no stored rest/);
    expect(rx.note).toMatch(/failure/);
  });

  it('caps at the DB bound', () => {
    const rx = prescribeRestSeconds({ baseSeconds: 590, lastSetRir: 0, targetRir: 2 });
    expect(rx.seconds).toBe(REST_MAX_S);
  });
});
