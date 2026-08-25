/**
 * Seeded RNG — the single source of randomness in the harness.
 *
 * Every stochastic decision a persona makes draws from here. Nothing in the
 * simulation may call `Math.random()`: a run has to be exactly reproducible
 * from `{persona, seed, initial state, start date, config}` alone, because the
 * only useful bug report from a stochastic harness is one a developer can
 * replay with a single command.
 *
 * mulberry32 — 32-bit state, one multiply-xorshift round. Chosen over a
 * cryptographic generator on purpose: it is tiny, has no platform-dependent
 * behaviour (no BigInt, no crypto, no Node/browser split), and its period
 * (2^32) is enormous relative to a six-month simulated run. It is NOT suitable
 * for anything security-related, which nothing here is.
 *
 * DETERMINISM IS ORDER-SENSITIVE. Two runs match only if they draw the same
 * values in the same sequence. So a persona must not, for example, draw a
 * value inside a conditional that depends on engine output unless that
 * output is itself deterministic. When adding draws, add them at the END of a
 * decision, never in the middle — inserting a draw shifts every subsequent
 * value and silently invalidates every previously recorded seed.
 */

/** FNV-1a — lets a run be seeded from a readable string as well as a number. */
export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(readonly seed: string | number) {
    this.state = hashSeed(seed);
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: empty range [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  bool(p: number): boolean {
    return this.next() < p;
  }

  /** A uniformly chosen element. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)];
  }

  /**
   * Normal deviate via Box–Muller.
   *
   * Both generated values would normally be cached and the second returned on
   * the next call; that is deliberately NOT done here. A cache makes the draw
   * count depend on how many times the method has been called before, which
   * turns "insert a draw somewhere" into a silent, hard-to-diagnose divergence.
   * Discarding the second value costs one extra draw and keeps every call
   * consuming exactly two.
   */
  normal(mean = 0, stdDev = 1): number {
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** A normal deviate clamped to [min, max] — for bounded human variation. */
  boundedNormal(mean: number, stdDev: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.normal(mean, stdDev)));
  }

  /**
   * A child generator whose stream is independent of this one but still fully
   * determined by the parent's seed and `label`.
   *
   * Use it to isolate a sub-decision (one exercise's noise, say) so that adding
   * draws elsewhere doesn't shift it. Same parent seed + same label = same
   * child stream, always.
   */
  fork(label: string): Rng {
    return new Rng(`${this.seed}:${label}`);
  }
}

/** Convenience for a fresh generator. */
export function rng(seed: string | number): Rng {
  return new Rng(seed);
}
