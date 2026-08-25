/**
 * Mesocycle-generation comparison dump.
 *
 * Generates full mesocycles for a fixed set of representative profiles and
 * prints a DETERMINISTIC, diff-friendly summary. Capture it before and after
 * any change to the generation path and diff the two files — this is the
 * before/after instrument the #634 fatigue-model port shipped with, kept
 * because every future generation change needs the same evidence.
 *
 * Usage:
 *   npx -y tsx scripts/compareMesocycleGeneration.ts > /tmp/plans-before.json
 *   # ...make changes...
 *   npx -y tsx scripts/compareMesocycleGeneration.ts > /tmp/plans-after.json
 *   diff /tmp/plans-before.json /tmp/plans-after.json
 *
 * READ-ONLY: no database, no network — exercise data comes from the static
 * fallback catalog (getExercisesSync with a cold cache), so output depends
 * only on the generation code and these fixed profiles.
 */

import { generateFullMesocycleWithFatigue } from '../services/sessionBuilderWithFatigue';
import type { ExtendedUserProfile } from '../types/schema';

interface Scenario {
  name: string;
  daysPerWeek: number;
  sessionMinutes: number;
  profile: ExtendedUserProfile;
}

const baseProfile: Omit<ExtendedUserProfile, 'age' | 'experience' | 'goal'> = {
  sleepQuality: 4 as const,
  stressLevel: 2 as const,
  availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
  injuryHistory: [],
  trainingAge: 3,
  heightCm: 178,
  latestDexa: null,
};

const SCENARIOS: Scenario[] = [
  {
    name: 'intermediate-bulk-4day-60min',
    daysPerWeek: 4,
    sessionMinutes: 60,
    profile: { ...baseProfile, age: 30, experience: 'intermediate', goal: 'bulk' },
  },
  {
    name: 'novice-cut-3day-45min',
    daysPerWeek: 3,
    sessionMinutes: 45,
    profile: {
      ...baseProfile,
      age: 24,
      experience: 'novice',
      goal: 'cut',
      trainingAge: 1,
      sleepQuality: 3 as const,
    },
  },
  {
    name: 'advanced-bulk-6day-75min-enhanced',
    daysPerWeek: 6,
    sessionMinutes: 75,
    profile: {
      ...baseProfile,
      age: 35,
      experience: 'advanced',
      goal: 'bulk',
      trainingAge: 10,
      enhancedAthleteMode: true,
    },
  },
  {
    name: 'age50-maintain-4day-60min-poor-sleep',
    daysPerWeek: 4,
    sessionMinutes: 60,
    profile: {
      ...baseProfile,
      age: 50,
      experience: 'intermediate',
      goal: 'maintenance',
      sleepQuality: 2 as const,
      stressLevel: 4 as const,
    },
  },
];

function summarize(scenario: Scenario) {
  const program = generateFullMesocycleWithFatigue(
    scenario.daysPerWeek,
    scenario.profile,
    scenario.sessionMinutes
  );

  return {
    scenario: scenario.name,
    split: program.split,
    schedule: program.schedule,
    periodization: program.periodization.model,
    weeks: (program.mesocycleWeeks ?? []).map((week) => ({
      week: week.weekNumber,
      isDeload: week.isDeload,
      sessions: week.sessions.map((session) => ({
        day: session.day,
        totalSets: session.totalSets,
        estimatedMinutes: session.estimatedMinutes,
        capacityUsed: session.fatigueSummary.systemicCapacityUsed,
        exercises: session.exercises.map(
          (e) => `${e.exercise.name} ${e.sets}x${e.reps.min}-${e.reps.max}@${e.reps.targetRIR}`
        ),
      })),
    })),
    warnings: program.warnings,
  };
}

const output = SCENARIOS.map(summarize);
// Deterministic, human-diffable output.
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
