/**
 * wearableRecovery.ts — PURE HRV/RHR-based global recovery modifier.
 *
 * Given per-local-day wellness metrics (HRV SDNN and resting HR from Apple
 * Health), this module maintains rolling 14-day baselines (median) and turns
 * today's deviation into a single bounded multiplier on muscle recovery
 * windows: HRV meaningfully below baseline and/or RHR meaningfully above
 * baseline slows recovery (windows stretch, up to x1.15); HRV meaningfully
 * above with calm RHR speeds it slightly (down to x0.95).
 *
 * The modifier is a WHISPER, not a readiness score: it composes with the
 * existing windowScale/learned multipliers in services/muscleRecovery.ts and
 * the combined global effect is clamped to x1.25. Missing data (many sources
 * never write HRV) is normal — the modifier stays neutral and the UI says
 * nothing.
 *
 * All thresholds live in WEARABLE_RECOVERY below, documented together.
 * No clock reads, no I/O — `today` is always injected.
 */

/** Every tunable for the HRV/RHR recovery signal, in one place. */
export const WEARABLE_RECOVERY = {
  /** Rolling window (days, excluding today) for the median baseline. */
  baselineDays: 14,
  /** Minimum days with data inside the window before a baseline exists. */
  minBaselineSamples: 5,
  /**
   * Deviation onset thresholds: a day "deviates" when HRV is >=20% below its
   * baseline and/or resting HR is >=8% above its baseline.
   */
  hrvLowOnsetFraction: 0.2,
  rhrHighOnsetFraction: 0.08,
  /**
   * Modifier ramp: crossing an onset threshold maps to x1.05, scaling
   * linearly to the x1.15 cap over a further ramp width (HRV 20%->30% below,
   * RHR 8%->16% above). When both signals fire, the stronger one wins —
   * they are alternative views of the same systemic state, not additive.
   */
  slowdownOnsetScale: 1.05,
  hrvRampWidthFraction: 0.1,
  rhrRampWidthFraction: 0.08,
  /**
   * Recovery-speedup branch: HRV >=20% ABOVE baseline with RHR not elevated
   * nudges windows down, from x0.97 at onset to the x0.95 floor.
   */
  hrvHighOnsetFraction: 0.2,
  speedupOnsetScale: 0.97,
  /** Hard bounds on this modifier alone. */
  scaleMin: 0.95,
  scaleMax: 1.15,
  /**
   * Cap on the PRODUCT of all global recovery-window scalars (athlete-profile
   * windowScale x this modifier). Per-muscle learned multipliers have their
   * own bounds and are not part of this product.
   */
  totalGlobalScaleCap: 1.25,
  /** Deload advisor: deviation sustained this many consecutive days counts. */
  sustainedDeviationDays: 5,
  /** Deload advisor: points at onset and per extra sustained day, capped. */
  deloadOnsetPoints: 5,
  deloadPointsPerExtraDay: 1,
  deloadMaxPoints: 8,
} as const;

/** One local day of wellness metrics. Either metric may be absent. */
export interface WellnessDay {
  /** Local day, YYYY-MM-DD. */
  date: string;
  hrvSdnnMs: number | null;
  restingHrBpm: number | null;
}

export interface WearableRecoveryState {
  /** Global recovery-window multiplier, always within [scaleMin, scaleMax]. */
  scale: number;
  /** Quiet evidence line for the readiness sheet, or null when neutral. */
  reason: string | null;
  /** Signed fraction vs baseline (negative = below), null without data. */
  hrvDeviationFraction: number | null;
  rhrDeviationFraction: number | null;
  hrvBaseline: number | null;
  rhrBaseline: number | null;
  /** Consecutive days (ending today) with a meaningful deviation. */
  consecutiveDeviationDays: number;
  /** Capped deload fatigue-score contribution (0 when not sustained). */
  deloadSignalPoints: number;
  /** Evidence string for the deload advisor, or null. */
  deloadEvidence: string | null;
}

export const NEUTRAL_WEARABLE_RECOVERY: WearableRecoveryState = {
  scale: 1,
  reason: null,
  hrvDeviationFraction: null,
  rhrDeviationFraction: null,
  hrvBaseline: null,
  rhrBaseline: null,
  consecutiveDeviationDays: 0,
  deloadSignalPoints: 0,
  deloadEvidence: null,
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Rolling median baseline for one metric over the window ending the day
 * BEFORE `day` (today never biases its own baseline).
 */
export function rollingBaseline(
  history: WellnessDay[],
  day: string,
  metric: 'hrvSdnnMs' | 'restingHrBpm',
  config = WEARABLE_RECOVERY
): number | null {
  // Local-day strings are compared as UTC instants — only relative ordering
  // and day-spacing matter here, so the fixed offset cancels out.
  const windowValues: number[] = [];
  const dayMs = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(dayMs)) return null;
  const windowStartMs = dayMs - config.baselineDays * 86_400_000;

  for (const entry of history) {
    const value = entry[metric];
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    const entryMs = Date.parse(`${entry.date}T00:00:00Z`);
    if (!Number.isFinite(entryMs)) continue;
    if (entryMs >= dayMs || entryMs < windowStartMs) continue;
    windowValues.push(value);
  }

  if (windowValues.length < config.minBaselineSamples) return null;
  return median(windowValues);
}

/** Does this day meaningfully deviate (HRV low and/or RHR high)? */
function isDeviatingDay(
  day: WellnessDay,
  hrvBaseline: number | null,
  rhrBaseline: number | null,
  config = WEARABLE_RECOVERY
): boolean {
  const hrvLow =
    day.hrvSdnnMs != null &&
    hrvBaseline != null &&
    (hrvBaseline - day.hrvSdnnMs) / hrvBaseline >= config.hrvLowOnsetFraction;
  const rhrHigh =
    day.restingHrBpm != null &&
    rhrBaseline != null &&
    (day.restingHrBpm - rhrBaseline) / rhrBaseline >= config.rhrHighOnsetFraction;
  return hrvLow || rhrHigh;
}

/**
 * Compute the full wearable-recovery state for `today` from daily history.
 * Neutral (scale 1, no UI mention) whenever data or baselines are missing —
 * per-type absence is expected, never an error.
 */
export function computeWearableRecoveryState(
  history: WellnessDay[],
  today: string,
  config = WEARABLE_RECOVERY
): WearableRecoveryState {
  const todayEntry = history.find((d) => d.date === today) ?? null;
  const hrvBaseline = rollingBaseline(history, today, 'hrvSdnnMs', config);
  const rhrBaseline = rollingBaseline(history, today, 'restingHrBpm', config);

  const hrvToday = todayEntry?.hrvSdnnMs ?? null;
  const rhrToday = todayEntry?.restingHrBpm ?? null;

  const hrvDeviationFraction =
    hrvToday != null && hrvBaseline != null ? (hrvToday - hrvBaseline) / hrvBaseline : null;
  const rhrDeviationFraction =
    rhrToday != null && rhrBaseline != null ? (rhrToday - rhrBaseline) / rhrBaseline : null;

  // --- Slowdown branch: ramp each fired signal, take the stronger one. ---
  let scale = 1;
  const reasons: string[] = [];

  if (
    hrvDeviationFraction != null &&
    -hrvDeviationFraction >= config.hrvLowOnsetFraction
  ) {
    const over = -hrvDeviationFraction - config.hrvLowOnsetFraction;
    const ramp = clamp(over / config.hrvRampWidthFraction, 0, 1);
    scale = Math.max(
      scale,
      config.slowdownOnsetScale + ramp * (config.scaleMax - config.slowdownOnsetScale)
    );
    reasons.push('HRV below your baseline');
  }

  if (
    rhrDeviationFraction != null &&
    rhrDeviationFraction >= config.rhrHighOnsetFraction
  ) {
    const over = rhrDeviationFraction - config.rhrHighOnsetFraction;
    const ramp = clamp(over / config.rhrRampWidthFraction, 0, 1);
    scale = Math.max(
      scale,
      config.slowdownOnsetScale + ramp * (config.scaleMax - config.slowdownOnsetScale)
    );
    reasons.push('resting heart rate above your baseline');
  }

  // --- Speedup branch: only when nothing fired and HRV is clearly high. ---
  if (
    scale === 1 &&
    hrvDeviationFraction != null &&
    hrvDeviationFraction >= config.hrvHighOnsetFraction &&
    (rhrDeviationFraction == null || rhrDeviationFraction < config.rhrHighOnsetFraction)
  ) {
    const over = hrvDeviationFraction - config.hrvHighOnsetFraction;
    const ramp = clamp(over / config.hrvRampWidthFraction, 0, 1);
    scale = config.speedupOnsetScale - ramp * (config.speedupOnsetScale - config.scaleMin);
  }

  scale = clamp(Math.round(scale * 1000) / 1000, config.scaleMin, config.scaleMax);

  // --- Sustained deviation streak (ending today) for the deload advisor. ---
  let consecutiveDeviationDays = 0;
  if (scale > 1) {
    const byDate = new Map(history.map((d) => [d.date, d]));
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    for (let offset = 0; ; offset++) {
      const dayMs = todayMs - offset * 86_400_000;
      const dayStr = new Date(dayMs).toISOString().slice(0, 10);
      const entry = byDate.get(dayStr);
      if (!entry) break;
      const dayHrvBaseline = rollingBaseline(history, dayStr, 'hrvSdnnMs', config);
      const dayRhrBaseline = rollingBaseline(history, dayStr, 'restingHrBpm', config);
      if (!isDeviatingDay(entry, dayHrvBaseline, dayRhrBaseline, config)) break;
      consecutiveDeviationDays++;
    }
  }

  const deloadSignalPoints = wearableDeloadPoints(consecutiveDeviationDays, config);
  const deloadEvidence = wearableDeloadEvidence(consecutiveDeviationDays, config);

  const reason =
    scale > 1 && reasons.length > 0 ? `Recovery slowed — ${reasons.join(' and ')}.` : null;

  return {
    scale,
    reason,
    hrvDeviationFraction,
    rhrDeviationFraction,
    hrvBaseline,
    rhrBaseline,
    consecutiveDeviationDays,
    deloadSignalPoints,
    deloadEvidence,
  };
}

/**
 * Deload-advisor fatigue-score contribution for a sustained deviation streak:
 * 0 below the sustained threshold, then a small capped ramp
 * (5 days -> 5 points, +1/extra day, capped at 8).
 */
export function wearableDeloadPoints(
  consecutiveDeviationDays: number,
  config = WEARABLE_RECOVERY
): number {
  if (consecutiveDeviationDays < config.sustainedDeviationDays) return 0;
  return Math.min(
    config.deloadMaxPoints,
    config.deloadOnsetPoints +
      (consecutiveDeviationDays - config.sustainedDeviationDays) *
        config.deloadPointsPerExtraDay
  );
}

/** Evidence string naming the wearable signal in deload reasons, or null. */
export function wearableDeloadEvidence(
  consecutiveDeviationDays: number,
  config = WEARABLE_RECOVERY
): string | null {
  if (consecutiveDeviationDays < config.sustainedDeviationDays) return null;
  return `HRV/resting HR deviated from baseline for ${consecutiveDeviationDays} straight days (Apple Health)`;
}

/**
 * Compose the athlete-profile windowScale with the wearable modifier, keeping
 * the combined global effect inside the documented cap. The lower side needs
 * no extra clamp: both inputs are already individually bounded.
 */
export function composeGlobalRecoveryScale(
  baseWindowScale: number,
  wearableScale: number,
  config = WEARABLE_RECOVERY
): number {
  return Math.min(config.totalGlobalScaleCap, baseWindowScale * wearableScale);
}
