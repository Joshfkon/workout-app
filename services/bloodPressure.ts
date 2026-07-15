/**
 * services/bloodPressure.ts
 *
 * Pure blood-pressure logic — NO database calls, NO React (mirrors the other
 * files in /services). Everything the UI and tests need for categorising a
 * reading, validating input, averaging a day's readings, and summarising a
 * period lives here so thresholds and copy are defined in exactly one place.
 *
 * IMPORTANT: this is not a medical device. Categories follow the commonly
 * cited adult ranges (ACC/AHA-style bands) but the app never claims to
 * diagnose hypertension — the copy is deliberately neutral and defers to a
 * clinician for anything concerning.
 */

import type {
  BloodPressureEntry,
  BloodPressureInput,
} from '@/types/schema';

// ============================================================
// CATEGORIES (single source of truth for thresholds + copy)
// ============================================================

export type BloodPressureCategoryId =
  | 'normal'
  | 'elevated'
  | 'high_stage_1'
  | 'high_stage_2'
  | 'crisis';

export interface BloodPressureCategory {
  id: BloodPressureCategoryId;
  /** Short neutral label for badges/cards. */
  label: string;
  /** Ordinal severity (0 = normal … 4 = crisis) for comparisons/coloring. */
  severity: number;
  /** Tailwind-ish token name callers map to their own classes. */
  tone: 'success' | 'primary' | 'warning' | 'danger';
  /** One-line, non-diagnostic guidance shown under a reading. */
  advice: string;
}

/**
 * Threshold rule for one category. A reading matches when its systolic OR
 * diastolic falls in the band (BP is classified by whichever number is
 * worse). Bands are checked most-severe first, so ranges only need their
 * lower/upper edges where relevant. Keeping this as data (not a chain of
 * ifs scattered around the app) is what "configurable, not hard-coded
 * everywhere" means — change a number here and every surface follows.
 */
interface CategoryRule {
  category: BloodPressureCategory;
  /** Matches if systolic >= this. */
  systolicMin?: number;
  /** Matches if diastolic >= this. */
  diastolicMin?: number;
  /** For bands with an upper bound (elevated / normal): systolic must be <= this. */
  systolicMax?: number;
  /** …and diastolic must be <= this. */
  diastolicMax?: number;
}

export const BLOOD_PRESSURE_CATEGORIES: Record<
  BloodPressureCategoryId,
  BloodPressureCategory
> = {
  normal: {
    id: 'normal',
    label: 'Normal range',
    severity: 0,
    tone: 'success',
    advice: 'Your reading is in the normal range. Keep up your usual habits.',
  },
  elevated: {
    id: 'elevated',
    label: 'Elevated',
    severity: 1,
    tone: 'primary',
    advice:
      'Slightly above the normal range. Regular readings help you spot a trend.',
  },
  high_stage_1: {
    id: 'high_stage_1',
    label: 'High',
    severity: 2,
    tone: 'warning',
    advice:
      'This reading is high. A few consistent readings over time are more telling than one — consider mentioning ongoing high readings to a clinician.',
  },
  high_stage_2: {
    id: 'high_stage_2',
    label: 'Very high',
    severity: 3,
    tone: 'danger',
    advice:
      'Very high — consider rechecking after resting quietly, and contact a clinician if it stays high or you feel unwell.',
  },
  crisis: {
    id: 'crisis',
    label: 'Very high — recheck',
    severity: 4,
    tone: 'danger',
    advice:
      'This is a very high reading. Sit quietly and recheck. If it remains very high or you have chest pain, shortness of breath, severe headache, weakness, vision changes, or other concerning symptoms, seek urgent medical care.',
  },
};

/**
 * Ordered most-severe-first so classify() returns the worst matching band.
 * Thresholds:
 *   Normal:        systolic < 120 AND diastolic < 80
 *   Elevated:      systolic 120–129 AND diastolic < 80
 *   High stage 1:  systolic 130–139 OR diastolic 80–89
 *   High stage 2:  systolic >= 140 OR diastolic >= 90
 *   Crisis:        systolic >= 180 OR diastolic >= 120
 */
const CATEGORY_RULES: CategoryRule[] = [
  {
    category: BLOOD_PRESSURE_CATEGORIES.crisis,
    systolicMin: 180,
    diastolicMin: 120,
  },
  {
    category: BLOOD_PRESSURE_CATEGORIES.high_stage_2,
    systolicMin: 140,
    diastolicMin: 90,
  },
  {
    category: BLOOD_PRESSURE_CATEGORIES.high_stage_1,
    systolicMin: 130,
    diastolicMin: 80,
  },
  {
    category: BLOOD_PRESSURE_CATEGORIES.elevated,
    systolicMin: 120,
    systolicMax: 129,
    diastolicMax: 79,
  },
];

/**
 * Classify a reading into a category. BP is graded by whichever number is
 * worse, so we take the most-severe band either value triggers.
 */
export function classifyBloodPressure(
  systolic: number,
  diastolic: number
): BloodPressureCategory {
  for (const rule of CATEGORY_RULES) {
    // A "min" threshold means: at or above this counts (OR semantics between
    // systolic & diastolic). An upper bound, when present, must also hold for
    // the value that matched — used by the Elevated band.
    const systolicHits =
      rule.systolicMin != null &&
      systolic >= rule.systolicMin &&
      (rule.systolicMax == null || systolic <= rule.systolicMax) &&
      (rule.diastolicMax == null || diastolic <= rule.diastolicMax);

    const diastolicHits =
      rule.diastolicMin != null &&
      diastolic >= rule.diastolicMin &&
      (rule.diastolicMax == null || diastolic <= rule.diastolicMax) &&
      (rule.systolicMax == null || systolic <= rule.systolicMax);

    if (systolicHits || diastolicHits) {
      return rule.category;
    }
  }
  return BLOOD_PRESSURE_CATEGORIES.normal;
}

/** True for readings that warrant the calm-but-clear "recheck" messaging. */
export function isCrisisReading(systolic: number, diastolic: number): boolean {
  return classifyBloodPressure(systolic, diastolic).id === 'crisis';
}

// ============================================================
// VALIDATION
// ============================================================

/** Reasonable adult input bounds — kept in sync with the DB CHECK constraints. */
export const BP_LIMITS = {
  systolic: { min: 70, max: 250 },
  diastolic: { min: 40, max: 150 },
  pulse: { min: 30, max: 220 },
} as const;

export interface BloodPressureValidationResult {
  valid: boolean;
  /** Field-keyed, user-friendly messages (only present keys have errors). */
  errors: Partial<Record<'systolic' | 'diastolic' | 'pulse', string>>;
}

/**
 * Validate one required whole-number field within a range. Returns a friendly
 * message, or undefined when the value is valid.
 */
function checkRequiredField(
  value: number | null | undefined,
  label: string,
  limits: { min: number; max: number },
  missingMessage: string
): string | undefined {
  if (value == null || Number.isNaN(value)) return missingMessage;
  if (!Number.isInteger(value)) return `${label} should be a whole number.`;
  if (value < limits.min || value > limits.max) {
    return `${label} should be between ${limits.min} and ${limits.max} mmHg.`;
  }
  return undefined;
}

/**
 * Validate a reading with friendly, field-scoped messages. Accepts the raw
 * (possibly undefined/NaN) numbers a form produces.
 */
export function validateBloodPressure(input: {
  systolic?: number | null;
  diastolic?: number | null;
  pulse?: number | null;
}): BloodPressureValidationResult {
  const errors: BloodPressureValidationResult['errors'] = {};
  const { systolic, diastolic, pulse } = input;

  errors.systolic = checkRequiredField(
    systolic,
    'Systolic',
    BP_LIMITS.systolic,
    'Enter your systolic (top) number.'
  );
  errors.diastolic = checkRequiredField(
    diastolic,
    'Diastolic',
    BP_LIMITS.diastolic,
    'Enter your diastolic (bottom) number.'
  );

  // Systolic must exceed diastolic (only check once both are individually sane).
  if (
    !errors.systolic &&
    !errors.diastolic &&
    systolic != null &&
    diastolic != null &&
    systolic <= diastolic
  ) {
    errors.systolic = 'Systolic (top) should be higher than diastolic (bottom).';
  }

  // Pulse — optional.
  if (pulse != null && !Number.isNaN(pulse)) {
    if (!Number.isInteger(pulse)) {
      errors.pulse = 'Pulse should be a whole number.';
    } else if (pulse < BP_LIMITS.pulse.min || pulse > BP_LIMITS.pulse.max) {
      errors.pulse = `Pulse should be between ${BP_LIMITS.pulse.min} and ${BP_LIMITS.pulse.max} bpm.`;
    }
  }

  // Drop the undefined placeholders so `errors` only holds real messages.
  if (!errors.systolic) delete errors.systolic;
  if (!errors.diastolic) delete errors.diastolic;

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Guard for the write layer: throws on invalid input, returns a clean entry. */
export function assertValidBloodPressure(input: BloodPressureInput): void {
  const { valid, errors } = validateBloodPressure(input);
  if (!valid) {
    const first = Object.values(errors)[0];
    throw new Error(first ?? 'Invalid blood pressure reading.');
  }
}

// ============================================================
// AVERAGING / SUMMARIES
// ============================================================

export interface BloodPressureAverage {
  systolic: number;
  diastolic: number;
  /** Mean pulse over readings that recorded one (null if none did). */
  pulse: number | null;
  count: number;
}

/** Mean systolic/diastolic (and pulse where present) over a set of readings. */
export function averageReadings(
  readings: readonly Pick<BloodPressureEntry, 'systolic' | 'diastolic' | 'pulse'>[]
): BloodPressureAverage | null {
  if (readings.length === 0) return null;

  const sysSum = readings.reduce((s, r) => s + r.systolic, 0);
  const diaSum = readings.reduce((s, r) => s + r.diastolic, 0);

  const withPulse = readings.filter(
    (r) => r.pulse != null && !Number.isNaN(r.pulse)
  );
  const pulseAvg =
    withPulse.length > 0
      ? Math.round(
          withPulse.reduce((s, r) => s + (r.pulse as number), 0) /
            withPulse.length
        )
      : null;

  return {
    systolic: Math.round(sysSum / readings.length),
    diastolic: Math.round(diaSum / readings.length),
    pulse: pulseAvg,
    count: readings.length,
  };
}

export interface DailyBloodPressure {
  /** YYYY-MM-DD (local). */
  localDay: string;
  /** All readings for the day, newest first. */
  readings: BloodPressureEntry[];
  /** Daily average (always present — a day in the map has >= 1 reading). */
  average: BloodPressureAverage;
}

/**
 * Group readings by local day (newest day first, newest reading first within
 * a day) and attach each day's average. The history screen renders straight
 * from this.
 */
export function groupByDay(
  readings: readonly BloodPressureEntry[]
): DailyBloodPressure[] {
  const byDay = new Map<string, BloodPressureEntry[]>();
  for (const r of readings) {
    const list = byDay.get(r.localDay);
    if (list) list.push(r);
    else byDay.set(r.localDay, [r]);
  }

  return Array.from(byDay.entries())
    .map(([localDay, dayReadings]) => {
      const sorted = [...dayReadings].sort((a, b) =>
        b.measuredAt.localeCompare(a.measuredAt)
      );
      return {
        localDay,
        readings: sorted,
        // Non-null: a grouped day always has at least one reading.
        average: averageReadings(sorted) as BloodPressureAverage,
      };
    })
    .sort((a, b) => b.localDay.localeCompare(a.localDay));
}

export type BloodPressurePeriod = '7d' | '30d' | '90d' | 'all';

/** Days in a period; 'all' has no cutoff. */
export const PERIOD_DAYS: Record<Exclude<BloodPressurePeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Readings whose local day is within `period` of `now`. 'all' returns
 * everything. Comparison is on the local-day string (lexicographic works for
 * YYYY-MM-DD), matching how readings are stored/filtered elsewhere.
 */
export function filterByPeriod(
  readings: readonly BloodPressureEntry[],
  period: BloodPressurePeriod,
  now: Date = new Date()
): BloodPressureEntry[] {
  if (period === 'all') return [...readings];
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (PERIOD_DAYS[period] - 1));
  const cutoffDay = toLocalDay(cutoff);
  return readings.filter((r) => r.localDay >= cutoffDay);
}

export interface BloodPressureSummary {
  count: number;
  avgSystolic: number;
  avgDiastolic: number;
  avgPulse: number | null;
  minSystolic: number;
  maxSystolic: number;
  minDiastolic: number;
  maxDiastolic: number;
  /** Category of the average reading over the period. */
  category: BloodPressureCategory;
}

/** Period stats for the history header: averages, min/max, count, category. */
export function summarizeReadings(
  readings: readonly BloodPressureEntry[]
): BloodPressureSummary | null {
  const avg = averageReadings(readings);
  if (!avg) return null;

  const systolics = readings.map((r) => r.systolic);
  const diastolics = readings.map((r) => r.diastolic);

  return {
    count: avg.count,
    avgSystolic: avg.systolic,
    avgDiastolic: avg.diastolic,
    avgPulse: avg.pulse,
    minSystolic: Math.min(...systolics),
    maxSystolic: Math.max(...systolics),
    minDiastolic: Math.min(...diastolics),
    maxDiastolic: Math.max(...diastolics),
    category: classifyBloodPressure(avg.systolic, avg.diastolic),
  };
}

// ============================================================
// SMALL LOCAL HELPERS (kept here to keep the service dependency-free)
// ============================================================

/** YYYY-MM-DD in local time — local copy so the service imports nothing. */
function toLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Convenience formatter: "120/80". */
export function formatReading(systolic: number, diastolic: number): string {
  return `${systolic}/${diastolic}`;
}
