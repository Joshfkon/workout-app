/**
 * Discomfort Tracking Service
 *
 * Tracks discomfort logged during sets and integrates with injury tracking.
 * Detects patterns and suggests logging as formal injuries when appropriate.
 */

import type { SetDiscomfort, DiscomfortBodyPart, DiscomfortSeverity } from '@/types/schema';
import { INJURY_TYPES, type InjuryType } from '@/lib/training/injury-types';

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
  }
}

/**
 * Get severity from score
 */
function getSeverityFromScore(score: number): DiscomfortSeverity {
  if (score < 1.5) return 'twinge';
  if (score < 2.5) return 'discomfort';
  return 'pain';
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
  const now = new Date();
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
    const hasPain = bodyPartEntries.some((e) => e.discomfort.severity === 'pain');
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
  if (discomfort.severity === 'pain') {
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
      return { label: 'Pain (Stop)', color: 'text-danger-400', icon: '!!' };
  }
}
