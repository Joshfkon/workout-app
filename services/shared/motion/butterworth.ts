/**
 * 4th-order Butterworth low-pass with zero-phase (filtfilt-equivalent)
 * application, for conditioning gyro streams before segmentation.
 *
 * Implementation: two cascaded RBJ-cookbook low-pass biquads with the
 * Butterworth quality factors for order 4 (Q = 1/(2·cos(π/8)) and
 * 1/(2·cos(3π/8))), which is the standard bilinear-transform realization of
 * a 4th-order Butterworth. Zero phase comes from forward-backward filtering
 * with odd-reflection edge padding (the scipy filtfilt default), so rep
 * boundaries do not shift in time — a phase-lagged filter would bias every
 * zero-crossing late.
 *
 * Assumes near-uniform sampling (devicemotion at a nominal rate); design
 * uses the MEASURED mean rate. Pure and framework-free.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Butterworth pole quality factors for order 4 (two conjugate pairs). */
const BUTTERWORTH4_Q = [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos((3 * Math.PI) / 8))];

/**
 * Design the two biquad sections of a 4th-order Butterworth low-pass.
 * `cutoffHz` must be below Nyquist; callers clamp if the stream is slow.
 */
export function designButterworthLP4(cutoffHz: number, sampleRateHz: number): Biquad[] {
  const fc = Math.min(cutoffHz, 0.45 * sampleRateHz);
  const w0 = (2 * Math.PI * fc) / sampleRateHz;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  return BUTTERWORTH4_Q.map((q) => {
    const alpha = sinW0 / (2 * q);
    const a0 = 1 + alpha;
    return {
      b0: (1 - cosW0) / 2 / a0,
      b1: (1 - cosW0) / a0,
      b2: (1 - cosW0) / 2 / a0,
      a1: (-2 * cosW0) / a0,
      a2: (1 - alpha) / a0,
    };
  });
}

/** Direct-form-II-transposed single pass of one biquad. */
function biquadPass(x: number[], s: Biquad): number[] {
  const y = new Array<number>(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const out = s.b0 * x[i] + z1;
    z1 = s.b1 * x[i] - s.a1 * out + z2;
    z2 = s.b2 * x[i] - s.a2 * out;
    y[i] = out;
  }
  return y;
}

/**
 * Zero-phase filtering: odd-reflection pad both ends, run the cascade
 * forward, reverse, run again, reverse, strip the padding.
 */
export function filtfilt(signal: number[], sections: Biquad[]): number[] {
  const n = signal.length;
  if (n < 4) return [...signal];
  // Long enough for the 3 Hz/60 Hz startup transient to decay below 1e-8 —
  // the padding is what stands in for steady-state initial conditions.
  const pad = Math.min(150, n - 2);

  // Odd reflection: pre[i] = 2·x0 − x[pad−i], post mirrored likewise —
  // keeps the extension continuous in value and slope, absorbing the
  // filter's startup transient outside the real data.
  const x0 = signal[0];
  const xn = signal[n - 1];
  const padded = new Array<number>(n + 2 * pad);
  for (let i = 0; i < pad; i++) padded[i] = 2 * x0 - signal[pad - i];
  for (let i = 0; i < n; i++) padded[pad + i] = signal[i];
  for (let i = 0; i < pad; i++) padded[pad + n + i] = 2 * xn - signal[n - 2 - i];

  let y = padded;
  for (const s of sections) y = biquadPass(y, s);
  y.reverse();
  for (const s of sections) y = biquadPass(y, s);
  y.reverse();

  return y.slice(pad, pad + n);
}

/** Convenience: zero-phase 4th-order Butterworth low-pass in one call. */
export function lowpassZeroPhase(
  signal: number[],
  cutoffHz: number,
  sampleRateHz: number
): number[] {
  return filtfilt(signal, designButterworthLP4(cutoffHz, sampleRateHz));
}
