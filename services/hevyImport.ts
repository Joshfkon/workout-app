/**
 * Hevy CSV Import
 *
 * Pure parsing + mapping for Hevy's workout export
 * (Hevy → Profile → Settings → Export & Import Data → Export Workouts).
 *
 * The export is one row per set. The header, as written by real exports:
 *
 *   "title","start_time","end_time","description","exercise_title",
 *   "superset_id","exercise_notes","set_index","set_type","weight_kg",
 *   "reps","distance_km","duration_seconds","rpe"
 *
 * - `start_time` / `end_time` are LOCAL wall-clock times with no timezone.
 *   Hevy has used at least two formats over time: "18 Nov 2026, 18:22"
 *   (24-hour) and "Jan 5, 2026, 6:30 AM" (12-hour). Both are parsed here.
 * - `set_type` is one of "normal", "warmup", "dropset", "failure".
 * - Weight/distance columns are metric in every export we have seen. An
 *   imperial-labelled variant (`weight_lbs` / `distance_miles`) is accepted
 *   too and converted, since the column name states its unit unambiguously.
 *
 * Everything leaving this module is metric: weights in kg (CLAUDE.md: all
 * weights stored in kg), distances in metres, durations in seconds.
 *
 * DB writes live in lib/import/runHevyImport.ts — this file must stay pure.
 */

import { findNameMatches, singularize } from './exerciseNameMatch';

// ============================================
// TYPES
// ============================================

export type HevySetType = 'normal' | 'warmup' | 'dropset' | 'failure';

export interface ParsedHevySet {
  setType: HevySetType;
  /** Always kg (converted from lb when the file is imperial). */
  weightKg: number;
  /** Hevy's `reps` column — real repetitions, never seconds (time is in
   * durationSeconds). Named apart from the set_logs reps column on purpose. */
  repCount: number;
  rpe?: number;
  /** Metres. */
  distanceM?: number;
  durationSeconds?: number;
}

export interface ParsedHevyExercise {
  name: string;
  notes?: string;
  sets: ParsedHevySet[];
}

export interface ParsedHevyWorkout {
  title: string;
  /** ISO string (UTC) of the local start time the file states. */
  startedAt: string;
  /** ISO string, or undefined if the file gave none / an unreadable one. */
  endedAt?: string;
  description?: string;
  exercises: ParsedHevyExercise[];
}

export interface HevyParseResult {
  workouts: ParsedHevyWorkout[];
  /** Human-readable problems (bad rows). Capped; see `badRowCount`. */
  errors: string[];
  badRowCount: number;
  /** Unit the file's weight column was written in (before conversion). */
  sourceWeightUnit: 'kg' | 'lb';
}

export class HevyFormatError extends Error {}

// ============================================
// CONSTANTS
// ============================================

export const KG_PER_LB = 0.45359237;
const METRES_PER_KM = 1000;
const METRES_PER_MILE = 1609.344;
/** Upper bound of the set_logs reps CHECK (seconds for duration sets). */
const MAX_REPS = 600;
const MAX_ERRORS_REPORTED = 20;

const REQUIRED_COLUMNS = ['title', 'start_time', 'exercise_title', 'set_type'] as const;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// ============================================
// CSV
// ============================================

/**
 * RFC-4180-ish CSV parser. Unlike the line-splitting helper in
 * importExport.ts this handles quoted fields that contain newlines, which
 * Hevy workout descriptions and exercise notes routinely do. Delimiter is
 * auto-detected (comma, or tab for the .tsv some Hevy plans produce).
 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Normalise a header cell: trim, lowercase, spaces → underscores. */
function headerKey(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

/** True when the header row is a Hevy workout export. */
export function isHevyHeader(header: string[]): boolean {
  const keys = new Set(header.map(headerKey));
  return REQUIRED_COLUMNS.every((c) => keys.has(c));
}

/** Cheap check on raw file text, for routing/validation in the UI. */
export function looksLikeHevyCSV(text: string): boolean {
  const rows = parseDelimited(text.split(/\r?\n/, 1)[0] ?? '');
  return rows.length > 0 && isHevyHeader(rows[0]);
}

// ============================================
// VALUE PARSING
// ============================================

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function to24h(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const pm = ampm.toLowerCase() === 'pm';
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function buildLocal(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  const date = new Date(y, mo, d, h, mi, s);
  // Reject roll-overs like "31 Feb" or "25:00".
  if (
    date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d ||
    date.getHours() !== h || date.getMinutes() !== mi
  ) {
    return null;
  }
  return date;
}

/**
 * Parse a Hevy timestamp. Hevy writes local wall-clock time with no zone, so
 * the result is that wall-clock time in the importing device's timezone —
 * the same assumption every Hevy-export tool makes.
 *
 * Accepts:
 *   "18 Nov 2026, 18:22"      (day-month-year, 24h)
 *   "Jan 5, 2026, 6:30 AM"    (month-day-year, 12h)
 *   "2026-02-10 10:00:00"     (ISO-like, local)
 *   full ISO with Z/offset    (absolute)
 */
export function parseHevyTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo === undefined) return null;
    return buildLocal(+m[3], mo, +m[1], to24h(+m[4], m[7]), +m[5], +(m[6] ?? 0));
  }

  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo === undefined) return null;
    return buildLocal(+m[3], mo, +m[2], to24h(+m[4], m[7]), +m[5], +(m[6] ?? 0));
  }

  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return buildLocal(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  }

  return null;
}

function parseSetType(raw: string): HevySetType | null {
  const v = raw.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (v === '' || v === 'normal') return 'normal';
  if (v === 'warmup') return 'warmup';
  if (v === 'dropset' || v === 'drop') return 'dropset';
  if (v === 'failure') return 'failure';
  return null;
}

// ============================================
// MAIN PARSER
// ============================================

/**
 * Parse a Hevy workout export into workouts. Throws HevyFormatError when the
 * file is not a Hevy export at all; individual bad rows are skipped and
 * reported in `errors` instead.
 */
export function parseHevyCSV(text: string): HevyParseResult {
  const rows = parseDelimited(text);
  if (rows.length === 0) throw new HevyFormatError('The file is empty.');

  const header = rows[0].map(headerKey);
  if (!isHevyHeader(rows[0])) {
    const looksStrong = header.includes('exercise_name') && header.includes('set_order');
    throw new HevyFormatError(
      looksStrong
        ? 'This looks like a Strong export. Choose "Strong" as the source instead.'
        : 'This is not a Hevy workout export (missing title / start_time / exercise_title / set_type columns).'
    );
  }

  const col = (name: string) => header.indexOf(name);
  const idx = {
    title: col('title'),
    start: col('start_time'),
    end: col('end_time'),
    description: col('description'),
    exercise: col('exercise_title'),
    exerciseNotes: col('exercise_notes'),
    setIndex: col('set_index'),
    setType: col('set_type'),
    repsCol: col('reps'),
    duration: col('duration_seconds'),
    rpe: col('rpe'),
  };

  let weightCol = col('weight_kg');
  let weightFactor = 1;
  let sourceWeightUnit: 'kg' | 'lb' = 'kg';
  if (weightCol < 0) {
    weightCol = col('weight_lbs') >= 0 ? col('weight_lbs') : col('weight_lb');
    if (weightCol >= 0) {
      weightFactor = KG_PER_LB;
      sourceWeightUnit = 'lb';
    }
  }

  let distanceCol = col('distance_km');
  let distanceFactor = METRES_PER_KM;
  if (distanceCol < 0) {
    if (col('distance_miles') >= 0) {
      distanceCol = col('distance_miles');
      distanceFactor = METRES_PER_MILE;
    } else if (col('distance_meters') >= 0) {
      distanceCol = col('distance_meters');
      distanceFactor = 1;
    }
  }

  const errors: string[] = [];
  let badRowCount = 0;
  const bad = (rowNumber: number, msg: string) => {
    badRowCount++;
    if (errors.length < MAX_ERRORS_REPORTED) errors.push(`Row ${rowNumber}: ${msg}`);
  };

  // Keyed by title + raw start_time: two workouts can share a title but
  // never a start time.
  const workouts = new Map<string, ParsedHevyWorkout>();
  const setOrder = new Map<ParsedHevySet, number>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowNumber = r + 1; // 1-based, counting the header
    const cell = (i: number) => (i >= 0 && i < row.length ? row[i].trim() : '');

    const title = cell(idx.title);
    const startRaw = cell(idx.start);
    const exerciseName = cell(idx.exercise);

    if (!startRaw || !exerciseName) {
      bad(rowNumber, 'missing start_time or exercise_title');
      continue;
    }
    const start = parseHevyTimestamp(startRaw);
    if (!start) {
      bad(rowNumber, `unreadable start_time "${startRaw}"`);
      continue;
    }
    const setType = parseSetType(cell(idx.setType));
    if (!setType) {
      bad(rowNumber, `unknown set_type "${cell(idx.setType)}"`);
      continue;
    }

    const key = `${title}\u0000${startRaw}`;
    let workout = workouts.get(key);
    if (!workout) {
      const end = parseHevyTimestamp(cell(idx.end));
      workout = {
        title: title || 'Hevy Workout',
        startedAt: start.toISOString(),
        endedAt: end && end.getTime() >= start.getTime() ? end.toISOString() : undefined,
        description: cell(idx.description) || undefined,
        exercises: [],
      };
      workouts.set(key, workout);
    }

    let exercise = workout.exercises.find((e) => e.name === exerciseName);
    if (!exercise) {
      exercise = { name: exerciseName, sets: [] };
      workout.exercises.push(exercise);
    }
    const exNotes = cell(idx.exerciseNotes);
    if (exNotes && !exercise.notes?.includes(exNotes)) {
      exercise.notes = exercise.notes ? `${exercise.notes}\n${exNotes}` : exNotes;
    }

    const weightRaw = num(cell(weightCol));
    const repsRaw = num(cell(idx.repsCol));
    const distance = num(cell(distanceCol));
    const duration = num(cell(idx.duration));
    const rpe = num(cell(idx.rpe));

    if ([weightRaw, repsRaw, distance, duration].some((v) => v !== undefined && v < 0)) {
      bad(rowNumber, 'negative value');
      continue;
    }

    const set: ParsedHevySet = {
      setType,
      weightKg: weightRaw !== undefined ? round2(weightRaw * weightFactor) : 0,
      repCount: repsRaw !== undefined ? Math.round(repsRaw) : 0,
    };
    if (rpe !== undefined && rpe >= 1 && rpe <= 10) set.rpe = rpe;
    if (distance !== undefined && distance > 0) set.distanceM = round2(distance * distanceFactor);
    if (duration !== undefined && duration > 0) set.durationSeconds = Math.round(duration);

    exercise.sets.push(set);
    const setIndex = num(cell(idx.setIndex));
    setOrder.set(set, setIndex ?? exercise.sets.length - 1);
  }

  const result = Array.from(workouts.values());
  for (const w of result) {
    for (const e of w.exercises) {
      // Stable sort by Hevy's set_index (rows are usually already ordered).
      e.sets = e.sets
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (setOrder.get(a.s)! - setOrder.get(b.s)!) || a.i - b.i)
        .map(({ s }) => s);
    }
  }
  result.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  return { workouts: result, errors, badRowCount, sourceWeightUnit };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================
// SET → set_logs ROW
// ============================================

export interface ImportedSetLog {
  weight_kg: number;
  reps: number;
  rpe: number;
  is_warmup: boolean;
  set_type: 'normal' | 'warmup' | 'dropset';
  note: string | null;
}

/** Default RPE when the file has none — same default the Strong import uses. */
export const DEFAULT_IMPORT_RPE = 7;

/** True when an exercise was logged by time rather than reps (planks, holds). */
export function isDurationExercise(ex: ParsedHevyExercise): boolean {
  const working = ex.sets.filter((s) => s.repCount > 0 || (s.durationSeconds ?? 0) > 0);
  return working.length > 0 && working.every((s) => s.repCount === 0 && (s.durationSeconds ?? 0) > 0);
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${round2(m / 1000)} km` : `${Math.round(m)} m`;
}

/**
 * Convert one Hevy set to a set_logs row, or null when it carries nothing
 * HyperTrack can store (e.g. an empty placeholder set, or a distance-only
 * cardio set with no reps or time).
 *
 * - warmup  → set_type 'warmup', is_warmup true
 * - dropset → set_type 'dropset'
 * - failure → set_type 'normal' with RPE 10 unless the file gave one
 *             (HyperTrack has no "failure" type; RPE 10 = 0 RIR)
 * - duration-only sets store seconds in `reps` (the app's convention for
 *   duration-based exercises; capped at the 600 s CHECK)
 * - distance and time that have no column of their own go into `note`
 */
export function hevySetToSetLog(set: ParsedHevySet): ImportedSetLog | null {
  const durationOnly = set.repCount === 0 && (set.durationSeconds ?? 0) > 0;
  const reps = durationOnly ? Math.min(set.durationSeconds!, MAX_REPS) : Math.min(set.repCount, MAX_REPS);
  if (reps < 1) return null;

  const noteParts: string[] = [];
  if (set.distanceM) noteParts.push(`Distance: ${formatDistance(set.distanceM)}`);
  if (set.durationSeconds && !durationOnly) noteParts.push(`Time: ${set.durationSeconds}s`);
  if (durationOnly && set.durationSeconds! > MAX_REPS) noteParts.push(`Time: ${set.durationSeconds}s`);

  let rpe = set.rpe ?? (set.setType === 'failure' ? 10 : DEFAULT_IMPORT_RPE);
  if (rpe < 1 || rpe > 10) rpe = DEFAULT_IMPORT_RPE;

  return {
    weight_kg: Math.max(0, set.weightKg),
    reps,
    rpe,
    is_warmup: set.setType === 'warmup',
    set_type: set.setType === 'warmup' ? 'warmup' : set.setType === 'dropset' ? 'dropset' : 'normal',
    note: noteParts.length ? noteParts.join(' · ') : null,
  };
}

/** Workout duration in seconds from start/end, or null. */
export function workoutDurationSeconds(w: ParsedHevyWorkout): number | null {
  if (!w.endedAt) return null;
  const secs = Math.round((Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 1000);
  return secs > 0 ? secs : null;
}

// ============================================
// EXERCISE MATCHING
// ============================================

export interface LibraryExercise {
  id: string;
  name: string;
}

export interface ExerciseResolution {
  /** Name as written in the Hevy file. */
  sourceName: string;
  /** Matched library exercise, or null → create as custom (unless mapped). */
  exerciseId: string | null;
  matchedName?: string;
  /** Close library names to offer when there is no confident match. */
  suggestions: LibraryExercise[];
}

/**
 * Equipment-aware grouping key. Hevy (like Strong) names exercises
 * "Bench Press (Barbell)", HyperTrack "Barbell Bench Press". The shared
 * normalizeExerciseKey drops parentheticals, which would wrongly merge
 * "(Barbell)" and "(Dumbbell)" variants; here the parenthetical's words are
 * kept as tokens so equipment still has to agree.
 */
export function equipmentAwareKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .sort()
    .join(' ');
}

/** "Bench Press (Barbell)" → "Barbell Bench Press" (for fuzzy suggestions,
 * which otherwise drop the parenthetical). */
export function equipmentFirst(name: string): string {
  const m = name.trim().match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? `${m[2]} ${m[1]}`.trim() : name.trim();
}

/**
 * Map each Hevy exercise name to a library exercise:
 *   1. exact case-insensitive name (the Strong importer's rule), then
 *   2. same words in any order, parenthetical equipment included.
 * Anything else is left unmatched (null) with up to 5 suggestions so the
 * user can map it by hand or let it become a custom exercise.
 */
export function resolveHevyExercises(
  names: string[],
  library: LibraryExercise[]
): ExerciseResolution[] {
  const byLower = new Map<string, LibraryExercise>();
  const byKey = new Map<string, LibraryExercise>();
  for (const ex of library) {
    const lower = ex.name.toLowerCase().trim();
    if (!byLower.has(lower)) byLower.set(lower, ex);
    const k = equipmentAwareKey(ex.name);
    if (k && !byKey.has(k)) byKey.set(k, ex);
  }

  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  return unique.map((sourceName) => {
    const hit = byLower.get(sourceName.toLowerCase()) ?? byKey.get(equipmentAwareKey(sourceName));
    if (hit) {
      return { sourceName, exerciseId: hit.id, matchedName: hit.name, suggestions: [] };
    }
    const suggestions = findNameMatches(equipmentFirst(sourceName), library, { threshold: 0.5, limit: 5 })
      .map((m) => m.exercise);
    return { sourceName, exerciseId: null, suggestions };
  });
}

/** All distinct exercise names in a parsed file, in first-seen order. */
export function hevyExerciseNames(workouts: ParsedHevyWorkout[]): string[] {
  const seen = new Set<string>();
  for (const w of workouts) for (const e of w.exercises) seen.add(e.name);
  return Array.from(seen);
}

// ============================================
// RE-IMPORT DEDUPE
// ============================================

/**
 * Drop workouts that are already in the user's history. Hevy start times are
 * minute-precise and unique per workout, so a session whose started_at falls
 * in the same minute is the same workout imported before.
 */
export function filterAlreadyImported(
  workouts: ParsedHevyWorkout[],
  existingStartedAt: Array<string | null>
): { fresh: ParsedHevyWorkout[]; duplicates: number } {
  const minute = (iso: string) => Math.floor(Date.parse(iso) / 60000);
  const existing = new Set(
    existingStartedAt.filter((s): s is string => !!s && !isNaN(Date.parse(s))).map(minute)
  );
  const fresh = workouts.filter((w) => !existing.has(minute(w.startedAt)));
  return { fresh, duplicates: workouts.length - fresh.length };
}
