/**
 * Discomfort Tracking Service
 *
 * Tracks discomfort logged during sets and integrates with injury tracking.
 * Detects patterns and suggests logging as formal injuries when appropriate.
 */

import type {
  SetDiscomfort,
  DiscomfortBodyPart,
  DiscomfortSeverity,
  JointPainJoint,
} from '@/types/schema';
import { INJURY_TYPES, type InjuryType } from '@/lib/training/injury-types';

import { now as clockNow } from '@/lib/clock';

/**
 * A logged discomfort entry with context
 */
export interface DiscomfortEntry {
  id: string;
  userId: string;
  /** When the discomfort was logged */
  loggedAt: string;
  /** Exercise that caused the discomfort */
  exerciseId: string;
  exerciseName: string;
  /** The discomfort details */
  discomfort: SetDiscomfort;
  /** Set number when logged */
  setNumber: number;
  /** Weight being used */
  weightKg: number;
}

/**
 * Pattern detection result
 */
export interface DiscomfortPattern {
  /** Body part with repeated discomfort */
  bodyPart: DiscomfortBodyPart;
  /** Number of occurrences in the time window */
  occurrences: number;
  /** Days covered by the pattern */
  daysSpan: number;
  /** Average severity */
  averageSeverity: DiscomfortSeverity;
  /** Exercises involved */
  exercises: string[];
  /** Whether this pattern suggests an injury */
  suggestsInjury: boolean;
  /** Recommended injury type if applicable */
  suggestedInjuryType?: InjuryType;
}

/**
 * Prompt for creating an injury from discomfort patterns
 */
export interface InjuryCreationPrompt {
  /** The body part affected */
  bodyPart: DiscomfortBodyPart;
  /** Suggested injury type */
  suggestedType: InjuryType;
  /** Human-readable message */
  message: string;
  /** Number of discomfort occurrences */
  occurrenceCount: number;
  /** Days over which discomfort occurred */
  daysSpan: number;
}

/**
 * Pain severity warning
 */
export interface PainWarning {
  title: string;
  message: string;
  actions: ('skip_remaining' | 'continue_carefully' | 'end_workout')[];
}

/**
 * Map discomfort body part to injury types
 */
function mapBodyPartToInjuryTypes(bodyPart: DiscomfortBodyPart): InjuryType[] {
  const bodyPartToCategory: Record<string, string[]> = {
    lower_back: ['lower_back_strain', 'herniated_disc', 'sciatica'],
    upper_back: ['upper_back_strain'],
    neck: ['neck_strain', 'cervical_disc'],
    left_shoulder: ['shoulder_impingement', 'rotator_cuff_strain', 'shoulder_instability'],
    right_shoulder: ['shoulder_impingement', 'rotator_cuff_strain', 'shoulder_instability'],
    shoulders: ['shoulder_impingement', 'rotator_cuff_strain', 'shoulder_instability'],
    left_elbow: ['elbow_tendinitis'],
    right_elbow: ['elbow_tendinitis'],
    elbows: ['elbow_tendinitis'],
    left_wrist: ['wrist_strain', 'carpal_tunnel'],
    right_wrist: ['wrist_strain', 'carpal_tunnel'],
    wrists: ['wrist_strain', 'carpal_tunnel'],
    left_knee: ['knee_injury', 'patellofemoral', 'meniscus_tear'],
    right_knee: ['knee_injury', 'patellofemoral', 'meniscus_tear'],
    knees: ['knee_injury', 'patellofemoral', 'meniscus_tear'],
    left_hip: ['hip_flexor_strain', 'hip_impingement', 'hip_bursitis'],
    right_hip: ['hip_flexor_strain', 'hip_impingement', 'hip_bursitis'],
    hips: ['hip_flexor_strain', 'hip_impingement', 'hip_bursitis'],
    other: [],
  };

  const injuryIds = bodyPartToCategory[bodyPart] || [];
  return INJURY_TYPES.filter((type) => injuryIds.includes(type.id));
}

/**
 * Get severity score for averaging
 */
function getSeverityScore(severity: DiscomfortSeverity): number {
  switch (severity) {
    case 'twinge':
      return 1;
    case 'discomfort':
      return 2;
    case 'pain':
      return 3;
    case 'stop':
      return 4;
  }
}

/**
 * Get severity from score
 */
function getSeverityFromScore(score: number): DiscomfortSeverity {
  if (score < 1.5) return 'twinge';
  if (score < 2.5) return 'discomfort';
  if (score < 3.5) return 'pain';
  return 'stop';
}

/**
 * Check for discomfort patterns that might indicate injury
 * @param entries - Recent discomfort entries
 * @param daysWindow - Number of days to check (default 14)
 * @returns Detected patterns
 */
export function detectDiscomfortPatterns(
  entries: DiscomfortEntry[],
  daysWindow: number = 14
): DiscomfortPattern[] {
  const patterns: DiscomfortPattern[] = [];
  const now = clockNow();
  const windowStart = new Date(now.getTime() - daysWindow * 24 * 60 * 60 * 1000);

  // Filter to recent entries
  const recentEntries = entries.filter(
    (e) => new Date(e.loggedAt) >= windowStart
  );

  // Group by body part
  const byBodyPart = new Map<DiscomfortBodyPart, DiscomfortEntry[]>();
  recentEntries.forEach((entry) => {
    const bodyPart = entry.discomfort.bodyPart;
    const existing = byBodyPart.get(bodyPart) || [];
    existing.push(entry);
    byBodyPart.set(bodyPart, existing);
  });

  // Analyze each body part
  byBodyPart.forEach((bodyPartEntries, bodyPart) => {
    if (bodyPartEntries.length < 2) return; // Need at least 2 occurrences

    // Calculate pattern metrics
    const dates = bodyPartEntries.map((e) => new Date(e.loggedAt).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const daysSpan = Math.ceil((maxDate - minDate) / (24 * 60 * 60 * 1000)) + 1;

    const avgSeverityScore =
      bodyPartEntries.reduce(
        (sum, e) => sum + getSeverityScore(e.discomfort.severity),
        0
      ) / bodyPartEntries.length;

    const exercises = Array.from(new Set(bodyPartEntries.map((e) => e.exerciseName)));

    // Pattern is concerning if 3+ occurrences or any pain-level severity
    const hasPain = bodyPartEntries.some(
      (e) => e.discomfort.severity === 'pain' || e.discomfort.severity === 'stop'
    );
    const suggestsInjury = bodyPartEntries.length >= 3 || hasPain;

    // Get suggested injury type
    const suggestedInjuryTypes = mapBodyPartToInjuryTypes(bodyPart);
    const suggestedInjuryType = suggestedInjuryTypes[0]; // Default to most common

    patterns.push({
      bodyPart,
      occurrences: bodyPartEntries.length,
      daysSpan,
      averageSeverity: getSeverityFromScore(avgSeverityScore),
      exercises,
      suggestsInjury,
      suggestedInjuryType,
    });
  });

  // Sort by severity (pain > discomfort > twinge) and occurrences
  return patterns.sort((a, b) => {
    const severityA = getSeverityScore(a.averageSeverity);
    const severityB = getSeverityScore(b.averageSeverity);
    if (severityA !== severityB) return severityB - severityA;
    return b.occurrences - a.occurrences;
  });
}

/**
 * Process a new discomfort log entry
 */
export function processDiscomfortLog(
  discomfort: SetDiscomfort,
  exerciseId: string,
  exerciseName: string,
  recentHistory: DiscomfortEntry[]
): {
  injuryPrompt?: InjuryCreationPrompt;
  painWarning?: PainWarning;
} {
  const result: {
    injuryPrompt?: InjuryCreationPrompt;
    painWarning?: PainWarning;
  } = {};

  // Check for pain severity - immediate warning
  if (discomfort.severity === 'pain' || discomfort.severity === 'stop') {
    result.painWarning = {
      title: 'Pain Logged',
      message:
        'Consider stopping this exercise. Continuing through pain can worsen injury.',
      actions: ['skip_remaining', 'continue_carefully', 'end_workout'],
    };
  }

  // Check for patterns with recent history
  const recentForBodyPart = recentHistory.filter(
    (e) => e.discomfort.bodyPart === discomfort.bodyPart
  );

  // If 3+ occurrences in the last 14 days, suggest logging as injury
  if (recentForBodyPart.length >= 2) {
    // This is the 3rd+ occurrence
    const patterns = detectDiscomfortPatterns(recentHistory, 14);
    const relevantPattern = patterns.find(
      (p) => p.bodyPart === discomfort.bodyPart && p.suggestsInjury
    );

    if (relevantPattern && relevantPattern.suggestedInjuryType) {
      result.injuryPrompt = {
        bodyPart: discomfort.bodyPart,
        suggestedType: relevantPattern.suggestedInjuryType,
        message: `You've logged ${relevantPattern.bodyPart.replace('_', ' ')} discomfort ${relevantPattern.occurrences + 1} times recently. Consider tracking this as an injury for better exercise recommendations.`,
        occurrenceCount: relevantPattern.occurrences + 1,
        daysSpan: relevantPattern.daysSpan,
      };
    }
  }

  return result;
}

// ============================================================
// EXERCISE-LEVEL PAIN PATTERN (variation-suggestion notice)
// ============================================================

/** Pain events on one exercise within this window trigger the notice. */
export const EXERCISE_PAIN_PATTERN_WINDOW_DAYS = 42; // 6 weeks

/** Minimum events on one exercise within the window. */
export const EXERCISE_PAIN_PATTERN_THRESHOLD = 3;

/** After dismissal the notice stays hidden for this long. */
export const EXERCISE_PAIN_NOTICE_SUPPRESS_DAYS = 28; // 4 weeks

/** Minimal event shape for the pattern check (a joint_pain_events row). */
export interface ExercisePainEvent {
  joint: string;
  occurredAt: Date;
}

export interface ExercisePainPattern {
  /** The most-flagged joint within the window (for the notice copy). */
  joint: string;
  /** Events on this exercise within the window. */
  count: number;
}

/**
 * Detect the "≥3 pain events on one exercise within 6 weeks" pattern and
 * honor the 4-week dismissal window. Returns the pattern to show, or null.
 *
 * @param events      pain events for ONE exercise (any order)
 * @param dismissedAt when the user last dismissed this exercise's notice, or null
 * @param now         injected clock
 */
export function getExercisePainPattern(
  events: ExercisePainEvent[],
  dismissedAt: Date | null,
  now: Date
): ExercisePainPattern | null {
  if (
    dismissedAt &&
    now.getTime() - dismissedAt.getTime() <
      EXERCISE_PAIN_NOTICE_SUPPRESS_DAYS * 24 * 60 * 60 * 1000
  ) {
    return null;
  }

  const cutoff = now.getTime() - EXERCISE_PAIN_PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => {
    const t = e.occurredAt.getTime();
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime();
  });
  if (recent.length < EXERCISE_PAIN_PATTERN_THRESHOLD) return null;

  // Most-flagged joint wins the notice copy.
  const counts = new Map<string, number>();
  for (const e of recent) counts.set(e.joint, (counts.get(e.joint) ?? 0) + 1);
  let topJoint = recent[0].joint;
  let topCount = 0;
  counts.forEach((count, joint) => {
    if (count > topCount) {
      topJoint = joint;
      topCount = count;
    }
  });

  return { joint: topJoint, count: recent.length };
}

/**
 * Map the two-tap picker's joint vocabulary onto the existing per-set
 * DiscomfortBodyPart values, so joint picks ride SetFeedback.discomfort
 * unchanged.
 */
export function jointToBodyPart(joint: JointPainJoint): DiscomfortBodyPart {
  switch (joint) {
    case 'elbow':
      return 'elbows';
    case 'shoulder':
      return 'shoulders';
    case 'knee':
      return 'knees';
    case 'hip':
      return 'hips';
    case 'wrist':
      return 'wrists';
    case 'lower_back':
      return 'lower_back';
    case 'other':
      return 'other';
  }
}

/**
 * Collapse any DiscomfortBodyPart (incl. sided variants from the bottom-sheet
 * logger) to the joint_pain_events joint vocabulary. Non-joint parts (neck,
 * upper back) fall to 'other'.
 */
export function bodyPartToJoint(bodyPart: DiscomfortBodyPart): JointPainJoint {
  switch (bodyPart) {
    case 'left_elbow':
    case 'right_elbow':
    case 'elbows':
      return 'elbow';
    case 'left_shoulder':
    case 'right_shoulder':
    case 'shoulders':
      return 'shoulder';
    case 'left_knee':
    case 'right_knee':
    case 'knees':
      return 'knee';
    case 'left_hip':
    case 'right_hip':
    case 'hips':
      return 'hip';
    case 'left_wrist':
    case 'right_wrist':
    case 'wrists':
      return 'wrist';
    case 'lower_back':
      return 'lower_back';
    default:
      return 'other';
  }
}

/** Display name for a joint_pain_events joint value. */
export function getJointDisplayName(joint: string): string {
  const names: Record<string, string> = {
    elbow: 'elbow',
    shoulder: 'shoulder',
    knee: 'knee',
    hip: 'hip',
    wrist: 'wrist',
    lower_back: 'lower back',
    other: 'joint',
  };
  return names[joint] ?? joint.replace(/_/g, ' ');
}

/**
 * Get body part display name
 */
export function getBodyPartDisplayName(bodyPart: DiscomfortBodyPart): string {
  const names: Record<DiscomfortBodyPart, string> = {
    lower_back: 'Lower Back',
    upper_back: 'Upper Back',
    neck: 'Neck',
    left_shoulder: 'Left Shoulder',
    right_shoulder: 'Right Shoulder',
    shoulders: 'Shoulders',
    left_elbow: 'Left Elbow',
    right_elbow: 'Right Elbow',
    elbows: 'Elbows',
    left_wrist: 'Left Wrist',
    right_wrist: 'Right Wrist',
    wrists: 'Wrists',
    left_knee: 'Left Knee',
    right_knee: 'Right Knee',
    knees: 'Knees',
    left_hip: 'Left Hip',
    right_hip: 'Right Hip',
    hips: 'Hips',
    other: 'Other',
  };
  return names[bodyPart] || bodyPart;
}

/**
 * Get severity display info
 */
export function getSeverityInfo(severity: DiscomfortSeverity): {
  label: string;
  color: string;
  icon: string;
} {
  switch (severity) {
    case 'twinge':
      return { label: 'Twinge (Mild)', color: 'text-yellow-400', icon: '~' };
    case 'discomfort':
      return { label: 'Discomfort (Moderate)', color: 'text-orange-400', icon: '!' };
    case 'pain':
      return { label: 'Painful', color: 'text-danger-400', icon: '!!' };
    case 'stop':
      return { label: 'Had to Stop', color: 'text-danger-400', icon: '!!!' };
  }
}
