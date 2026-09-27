/**
 * targetPicker — the setup flow's first step, as pure data over the SAME
 * readiness rows the readiness sheet renders (no second readiness model):
 * chips, pre-selection from Good Targets, group states for the draft builder,
 * stabilizer load buckets, and the "repeat" shortcuts from recent sessions.
 */

import { perSetGroupCredits } from '@/services/shared/volumeCredit';
import { STABILIZER_TRACKED_MUSCLES } from '@/services/shared/stabilizerTags';
import {
  RECOVERY_CONFIG,
  type MuscleRecoveryResult,
  type RecoveryConfig,
} from '@/services/muscleRecovery';
import { STANDARD_TO_COARSE, type CoarseMuscle } from '@/services/volumeBands';
import type { StandardMuscleGroup } from '@/types/schema';
import type {
  RecentSessionSummary,
  SetupGroupState,
  StabilizerLoadLevel,
} from '@/services/workoutSetup/types';
import type { ReadinessRow, ReadinessTarget } from '../readiness';
import type { ReadinessStatus } from '../readinessStatus';

export interface TargetChip {
  group: CoarseMuscle;
  displayName: string;
  status: ReadinessStatus;
  weeklyCredited: number;
  zoneMin: number;
  zoneMax: number;
  /** Sets below zone min (0 when at/above). */
  deficit: number;
  preselected: boolean;
}

/**
 * One chip per coarse group, in the rows' order (already ranked
 * fresh-with-deficit > fresh > unknown > recovering > fatigued). Pre-selected:
 * every Good Target, a fine-muscle target selecting its parent group. Unknown
 * groups are never Good Targets, so never pre-selected.
 */
export function buildTargetChips(
  rows: readonly ReadinessRow[],
  targets: readonly ReadinessTarget[]
): TargetChip[] {
  const preselected = new Set<string>();
  for (const t of targets) {
    const group = t.isChild ? STANDARD_TO_COARSE[t.muscle as StandardMuscleGroup] : t.muscle;
    if (group) preselected.add(group);
  }
  return rows.map((row) => ({
    group: row.muscle,
    displayName: row.displayName,
    status: row.readiness,
    weeklyCredited: row.sets,
    zoneMin: row.band.mev,
    zoneMax: row.band.mrv,
    deficit: row.volumeGap,
    preselected: row.readiness !== 'unknown' && preselected.has(row.muscle),
  }));
}

/** Group states for the draft builder / projection, for every row. */
export function groupStatesFromRows(
  rows: readonly ReadinessRow[],
  targets: readonly ReadinessTarget[]
): SetupGroupState[] {
  const focusByGroup = new Map<CoarseMuscle, StandardMuscleGroup[]>();
  for (const t of targets) {
    if (!t.isChild) continue;
    const muscle = t.muscle as StandardMuscleGroup;
    const group = STANDARD_TO_COARSE[muscle];
    if (!group) continue;
    focusByGroup.set(group, [...(focusByGroup.get(group) ?? []), muscle]);
  }
  return rows.map((row) => ({
    group: row.muscle,
    displayName: row.displayName,
    status: row.readiness,
    weeklyCredited: row.sets,
    zoneMin: row.band.mev,
    zoneMax: row.band.mrv,
    focusMuscles: focusByGroup.get(row.muscle) ?? [],
  }));
}

/**
 * Stabilizer-channel bucket: 'high' is exactly the band the in-workout
 * stabilizer warning fires in (readinessRatio < stabilizerReadinessThreshold),
 * 'elevated' is still owing recovery, 'ok' is fully recovered.
 */
export function stabilizerLevel(
  recovery: MuscleRecoveryResult,
  config: RecoveryConfig = RECOVERY_CONFIG
): StabilizerLoadLevel {
  if (recovery.readinessRatio < config.stabilizerReadinessThreshold) return 'high';
  if (recovery.readinessRatio < 1) return 'elevated';
  return 'ok';
}

export function stabilizerLoadMap(
  recoveryByStabilizer: Partial<Record<StandardMuscleGroup, MuscleRecoveryResult>>,
  config: RecoveryConfig = RECOVERY_CONFIG
): Partial<Record<StandardMuscleGroup, StabilizerLoadLevel>> {
  const out: Partial<Record<StandardMuscleGroup, StabilizerLoadLevel>> = {};
  for (const muscle of STABILIZER_TRACKED_MUSCLES) {
    const rec = recoveryByStabilizer[muscle];
    if (rec) out[muscle] = stabilizerLevel(rec, config);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

/** A group must carry at least this share of a session's credited sets to
 *  count as one of its dominant groups. */
const DOMINANT_SHARE = 0.2;
const MAX_DOMINANT_GROUPS = 4;

/** Groups carrying ≥20% of a session's credited sets, biggest first. */
export function dominantGroups(session: RecentSessionSummary): CoarseMuscle[] {
  const credit = new Map<CoarseMuscle, number>();
  for (const ex of session.exercises) {
    for (const { group, credit: c } of perSetGroupCredits(ex.primaryMuscle, ex.secondaryMuscles)) {
      credit.set(group, (credit.get(group) ?? 0) + c * ex.workingSets);
    }
  }
  let total = 0;
  credit.forEach((v) => (total += v));
  if (total <= 0) return [];
  return Array.from(credit.entries())
    .filter(([, v]) => v / total >= DOMINANT_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_DOMINANT_GROUPS)
    .map(([g]) => g);
}

const PUSH = new Set<CoarseMuscle>(['chest', 'shoulders', 'triceps']);
const PULL = new Set<CoarseMuscle>(['back', 'biceps', 'traps', 'forearms']);
const LOWER = new Set<CoarseMuscle>(['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'erectors']);

/** "Push" / "Pull" / "Legs" / "Upper" / "Full body", else the group names. */
export function sessionTypeLabel(groups: readonly CoarseMuscle[]): string {
  const g = groups.filter((x) => x !== 'abs');
  if (g.length === 0) return groups.length > 0 ? 'Abs' : 'Workout';
  const hasPush = g.some((x) => PUSH.has(x));
  const hasPull = g.some((x) => PULL.has(x));
  const hasLower = g.some((x) => LOWER.has(x));
  const upper = hasPush || hasPull;
  if (upper && hasLower) return 'Full body';
  if (hasLower) return 'Legs';
  if (hasPush && hasPull) return 'Upper';
  if (hasPush && (g.includes('chest') || g.includes('shoulders'))) return 'Push';
  if (hasPull && g.includes('back')) return 'Pull';
  const names = g.map((x) => x.charAt(0).toUpperCase() + x.slice(1));
  return names.slice(0, 2).join(' & ');
}

export interface SetupShortcuts {
  /** "Repeat last Push" → select these groups and build fresh. */
  repeatType: { label: string; groups: CoarseMuscle[] } | null;
  /** Up to 2 recent distinct sessions → load their exact exercises. */
  recentSessions: { session: RecentSessionSummary; label: string; daysAgo: number }[];
}

/**
 * Shortcut row. `sessions` newest first. Recent sessions are distinct by
 * (type label + dominant groups), so two identical Push days show once.
 */
export function deriveShortcuts(
  sessions: readonly RecentSessionSummary[],
  daysAgoOf: (completedAt: string) => number
): SetupShortcuts {
  const withGroups = sessions
    .map((session) => ({ session, groups: dominantGroups(session) }))
    .filter((s) => s.groups.length > 0);
  if (withGroups.length === 0) return { repeatType: null, recentSessions: [] };

  const latest = withGroups[0];
  const repeatType = { label: sessionTypeLabel(latest.groups), groups: latest.groups };

  const seen = new Set<string>();
  const recentSessions: SetupShortcuts['recentSessions'] = [];
  for (const { session, groups } of withGroups) {
    const label = sessionTypeLabel(groups);
    const key = `${label}|${[...groups].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentSessions.push({ session, label, daysAgo: daysAgoOf(session.completedAt) });
    if (recentSessions.length === 2) break;
  }
  return { repeatType, recentSessions };
}
