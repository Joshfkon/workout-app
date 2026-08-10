// ============================================================
// DELOAD RECOMMENDATION (Phase 1.4 wiring)
//
// Persists / resolves the reactive deload recommendation produced by
// ProgramEngine.checkDeloadTriggers (which reads weekly_fatigue_logs — see
// app/(dashboard)/dashboard/workout/[id]/_lib/sessionWrites.ts for the
// writer that populates them on session completion).
//
// Flow:
//   1. recordDeloadRecommendationIfTriggered — called fire-and-forget after a
//      session completes. If the triggers fire and no recommendation is
//      pending, stamps mesocycles.deload_recommended_at + deload_reasons.
//   2. fetchDeloadRecommendation — dashboard reads the pending recommendation
//      to render the insight card.
//   3. applyDeloadToUpcomingWeek ("Make next week a deload") — transforms the
//      upcoming week in mesocycle.program_data via deloadEngine's
//      generateDeloadWeek (per-exercise multipliers from
//      getExerciseDeloadMultiplier), points mesocycles.deload_week at it, and
//      clears the recommendation. Sessions materialize lazily from
//      program_data at workout start (mesocycle page handleStartWorkout →
//      getSessionFromProgramData / getWeeklyProgressionModifiers), so editing
//      program_data IS the week-level application; there is no discrete
//      week-advance event to hook.
//   4. dismissDeloadRecommendation — clears the recommendation only.
//
// DB access lives here in lib/training (weeklyRollover.ts precedent), NOT in
// /services. All functions take the (browser) Supabase client from the
// calling client component.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateDeloadWeek,
  type ExerciseDeloadInfo,
} from '@/services/deloadEngine';
import type { FullProgramRecommendation, MesocycleWeek } from '@/types/schema';
import { now as clockNow } from '@/lib/clock';

// ============================================================
// Types
// ============================================================

export type DeloadType = 'volume' | 'intensity' | 'full';

export interface DeloadRecommendation {
  /** ISO timestamp the recommendation was recorded. */
  recommendedAt: string;
  /** Human-readable trigger reasons from checkDeloadTriggers. */
  reasons: string[];
}

export interface ApplyDeloadResult {
  /**
   * 'program_week'  — the upcoming week in program_data.mesocycleWeeks was
   *                   regenerated as a deload (or already was one).
   * 'flag_only'     — legacy program_data (no mesocycleWeeks); only
   *                   mesocycles.deload_week was pointed at the upcoming week.
   */
  applied: 'program_week' | 'flag_only';
  /** 1-based week the deload was applied to. */
  targetWeek: number;
  deloadType: DeloadType;
}

// ============================================================
// Pure helpers
// ============================================================

/** Parse the mesocycles.deload_reasons jsonb value into a string array. */
export function parseDeloadReasons(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Re-derive the suggested deload type from the stored trigger reasons.
 * Mirrors checkDeloadTriggers' assignment order exactly (reasons are stored
 * in the order the engine pushed them, and later triggers overwrite the
 * type): fatigue → volume (default), strength regression → intensity,
 * poor sleep → full, joint pain → intensity.
 */
export function deriveDeloadType(reasons: string[]): DeloadType {
  let type: DeloadType = 'volume';
  for (const reason of reasons) {
    const r = reason.toLowerCase();
    if (r.startsWith('strength regression')) type = 'intensity';
    else if (r.startsWith('poor sleep')) type = 'full';
    else if (r.startsWith('joint pain')) type = 'intensity';
  }
  return type;
}

/** Single-joint movement patterns treated as isolation for deload purposes. */
const ISOLATION_PATTERNS = new Set([
  'isolation',
  'elbow_flexion',
  'elbow_extension',
  'shoulder_isolation',
  'calf_raise',
  'core',
]);

/**
 * Build the per-exercise metadata map generateDeloadWeek feeds into
 * getExerciseDeloadMultiplier, straight from the program week itself
 * (ExerciseEntry carries pattern + equipment; no DB round-trip needed).
 * Exercises without a real id simply get the base deload modifiers.
 */
export function buildExerciseDeloadMetadata(
  week: MesocycleWeek
): Map<string, ExerciseDeloadInfo> {
  const metadata = new Map<string, ExerciseDeloadInfo>();
  for (const session of week.sessions ?? []) {
    for (const block of session.exercises ?? []) {
      const entry = block.exercise;
      const id = entry?.id;
      if (!id || metadata.has(id)) continue;
      metadata.set(id, {
        movementPattern: entry.pattern,
        equipment: entry.equipment,
        mechanic: ISOLATION_PATTERNS.has(entry.pattern) ? 'isolation' : 'compound',
      });
    }
  }
  return metadata;
}

/**
 * Pick the 1-based week the accepted deload should land on: the week AFTER
 * the mesocycle's current week, capped to the block length (DB constraint:
 * deload_week <= total_weeks).
 */
export function pickDeloadTargetWeek(currentWeek: number, totalWeeks: number): number {
  const safeCurrent = Math.max(1, Math.floor(currentWeek || 1));
  const safeTotal = Math.max(1, Math.floor(totalWeeks || 1));
  return Math.min(safeCurrent + 1, safeTotal);
}

// ============================================================
// DB functions (callers pass the browser Supabase client)
// ============================================================

/**
 * Run ProgramEngine.checkDeloadTriggers for the mesocycle and, if it fires
 * and no recommendation is already pending, stamp deload_recommended_at +
 * deload_reasons on the mesocycle. Returns true when a NEW recommendation
 * was recorded.
 *
 * Never call this on the critical finish path without a try/catch — it is
 * designed to be fire-and-forget.
 */
export async function recordDeloadRecommendationIfTriggered(
  supabase: SupabaseClient,
  userId: string,
  mesocycleId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('mesocycles')
    .select('deload_recommended_at')
    .eq('id', mesocycleId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const existing = (data as { deload_recommended_at: string | null } | null)
    ?.deload_recommended_at;
  if (existing) return false; // already pending — keep the original stamp

  // Dynamic import keeps ProgramEngine (and its large exercise constants)
  // out of bundles that only fetch/apply/dismiss (e.g. the dashboard).
  const { checkShouldDeload } = await import('./workoutIntegration');
  const triggers = await checkShouldDeload(userId, mesocycleId);
  if (!triggers.shouldDeload || triggers.reasons.length === 0) return false;

  const { error: updateError } = await supabase
    .from('mesocycles')
    .update({
      deload_recommended_at: clockNow().toISOString(),
      deload_reasons: triggers.reasons,
    })
    .eq('id', mesocycleId)
    .is('deload_recommended_at', null); // race-safe: first writer wins

  if (updateError) throw new Error(updateError.message);
  return true;
}

/** Read the pending recommendation for a mesocycle (null when none). */
export async function fetchDeloadRecommendation(
  supabase: SupabaseClient,
  mesocycleId: string
): Promise<DeloadRecommendation | null> {
  const { data, error } = await supabase
    .from('mesocycles')
    .select('deload_recommended_at, deload_reasons')
    .eq('id', mesocycleId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const row = data as {
    deload_recommended_at: string | null;
    deload_reasons: unknown;
  } | null;
  if (!row?.deload_recommended_at) return null;

  return {
    recommendedAt: row.deload_recommended_at,
    reasons: parseDeloadReasons(row.deload_reasons),
  };
}

/**
 * Accept the recommendation: make the upcoming week a deload.
 *
 * When program_data has mesocycleWeeks (the format getSessionFromProgramData
 * prefers), the target week is regenerated with deloadEngine's
 * generateDeloadWeek — per-exercise set/RIR/load reductions via
 * getExerciseDeloadMultiplier and isDeload=true, which the start-workout path
 * (getWeeklyProgressionModifiers) and weekly rollover both respect. For
 * legacy program_data (flat sessions array, no per-week structure) only
 * mesocycles.deload_week is re-pointed, which the weekly-rollover call site
 * checks (current_week === deload_week).
 *
 * Always clears deload_recommended_at / deload_reasons.
 */
export async function applyDeloadToUpcomingWeek(
  supabase: SupabaseClient,
  mesocycleId: string
): Promise<ApplyDeloadResult> {
  const { data, error } = await supabase
    .from('mesocycles')
    .select('current_week, total_weeks, program_data, deload_reasons')
    .eq('id', mesocycleId)
    .single();

  if (error) throw new Error(error.message);
  const row = data as {
    current_week: number | null;
    total_weeks: number | null;
    program_data: FullProgramRecommendation | null;
    deload_reasons: unknown;
  };

  const currentWeek = Math.max(1, row.current_week ?? 1);
  const totalWeeks = Math.max(currentWeek, row.total_weeks ?? currentWeek);
  const targetWeek = pickDeloadTargetWeek(currentWeek, totalWeeks);
  const deloadType = deriveDeloadType(parseDeloadReasons(row.deload_reasons));

  const update: Record<string, unknown> = {
    deload_week: targetWeek,
    deload_recommended_at: null,
    deload_reasons: null,
  };

  let applied: ApplyDeloadResult['applied'] = 'flag_only';
  const program = row.program_data;
  const weeks = program?.mesocycleWeeks;
  if (program && Array.isArray(weeks) && weeks.length > 0) {
    // Readers clamp week lookups to the array length
    // (getSessionFromProgramData / getWeeklyProgressionModifiers), so
    // transform the element they will actually read for targetWeek.
    const weekIdx = Math.min(targetWeek - 1, weeks.length - 1);
    const baseWeek = weeks[weekIdx];
    if (baseWeek && !baseWeek.isDeload) {
      const deloadWeek = generateDeloadWeek(
        baseWeek,
        deloadType,
        buildExerciseDeloadMetadata(baseWeek)
      );
      const nextWeeks = weeks.slice();
      nextWeeks[weekIdx] = deloadWeek;
      update.program_data = { ...program, mesocycleWeeks: nextWeeks };
      applied = 'program_week';
    } else if (baseWeek?.isDeload) {
      applied = 'program_week'; // already a deload in program_data — nothing to change
    }
  }

  const { error: updateError } = await supabase
    .from('mesocycles')
    .update(update)
    .eq('id', mesocycleId);

  if (updateError) throw new Error(updateError.message);
  return { applied, targetWeek, deloadType };
}

/** Dismiss the recommendation: clears the stamp + reasons, nothing else. */
export async function dismissDeloadRecommendation(
  supabase: SupabaseClient,
  mesocycleId: string
): Promise<void> {
  const { error } = await supabase
    .from('mesocycles')
    .update({ deload_recommended_at: null, deload_reasons: null })
    .eq('id', mesocycleId);

  if (error) throw new Error(error.message);
}
