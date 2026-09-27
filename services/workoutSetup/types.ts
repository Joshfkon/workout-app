/**
 * Shared types for the pre-workout setup flow (target picker → draft editor →
 * optional AI review). Pure data — the engines in this folder take these as
 * input and never touch React, Supabase or the network.
 */

import type { CoarseMuscle } from '@/services/volumeBands';
import type { StandardMuscleGroup } from '@/types/schema';

/** Mirrors the readiness layer's status (fresh/recovering/fatigued + unknown). */
export type SetupReadinessStatus = 'fresh' | 'recovering' | 'fatigued' | 'unknown';

/** Stabilizer-channel load bucket for grip / lower back / rotator cuff / rear delts. */
export type StabilizerLoadLevel = 'ok' | 'elevated' | 'high';

/** One coarse muscle group's state going into the plan. */
export interface SetupGroupState {
  group: CoarseMuscle;
  displayName: string;
  status: SetupReadinessStatus;
  /** Weekly credited sets so far (same number the readiness sheet shows). */
  weeklyCredited: number;
  /** Zone = the shared MEV–MRV band. */
  zoneMin: number;
  zoneMax: number;
  /** Reachable fine muscles that are Good Targets on their own (e.g. rear delts). */
  focusMuscles: StandardMuscleGroup[];
}

/** The exercise-library slice the setup engines read. */
export interface SetupExercise {
  id: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  mechanic: 'compound' | 'isolation' | null;
  movementPattern: string | null;
  /** exercises.equipment_required tags. */
  equipment: string[];
  equipmentClass: string | null;
  isBodyweight: boolean;
  /** Hypertrophy tier S–F. */
  tier: string | null;
  defaultRepRange: [number, number] | null;
  defaultRir: number | null;
  /** Stabilizer tags (erectors / forearms / rotator_cuff / rear_delts). */
  stabilizers: string[];
  exerciseType?: string | null;
}

/** Where a plan item came from — recorded for later analysis. */
export type PlanItemSource = 'generated' | 'manual' | 'swap' | 'ai' | 'repeat';

/** One exercise in the draft plan. Order = position in the items array. */
export interface PlanItem {
  /** Stable within a plan (survives reorders, swaps and set changes). */
  itemId: string;
  exerciseId: string;
  /** The group this item serves (its primary group). */
  group: CoarseMuscle | null;
  /** Working sets, 1–10 (the exercise_blocks.target_sets constraint). */
  sets: number;
  repRange: [number, number];
  targetRir: number;
  restSeconds: number;
  source: PlanItemSource;
  /** Short human-readable reason (why the generator picked it). */
  reason?: string;
}

/** A recent completed session, as the shortcuts and swap recency read it. */
export interface RecentSessionSummary {
  sessionId: string;
  completedAt: string;
  exercises: {
    exerciseId: string;
    name: string;
    primaryMuscle: string;
    secondaryMuscles: string[];
    workingSets: number;
  }[];
}
