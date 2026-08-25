/**
 * Mandatory muscle review — the honesty contract on AI completion.
 *
 * Custom-exercise creation always routes through the review form; what makes
 * the review REAL is that (a) a completion that didn't come from the model is
 * marked aiSource 'fallback' so the form can disclose it and the exercise
 * stays in the incomplete-review queue, and (b) the prompt actually teaches
 * the stabilizer classification the recovery channel depends on, including
 * the rotator_cuff vocabulary added with it.
 */

import {
  getDefaultsByEquipment,
  parseAIResponse,
  renderPrompt,
  type AIResponse,
} from '@/lib/exercises/exercise-ai-completion';
import type { BasicExerciseInput } from '@/lib/exercises/types';

const INPUT: BasicExerciseInput = {
  name: 'Trap Bar Deadlift (Low Handle)',
  primaryMuscle: 'hamstrings',
  equipment: 'barbell',
};

const AI_RESPONSE: AIResponse = {
  primaryMuscleDetailed: 'hamstrings_semis',
  secondaryMuscles: ['glute_max'],
  stabilizers: ['erectors', 'forearm_flexors'],
  pattern: 'hip_hinge',
  mechanic: 'compound',
  difficulty: 'intermediate',
  fatigueRating: 3,
  defaultRepRange: [5, 8],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  spinalLoading: 'high',
  requiresBackArch: false,
  requiresSpinalFlexion: false,
  requiresSpinalExtension: true,
  requiresSpinalRotation: false,
  positionStress: { lowerBack: true },
  contraindications: ['lower_back_strain'],
  hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 5 },
  formCues: ['Brace hard'],
  confidence: 'high',
  notes: '',
} as unknown as AIResponse;

describe('aiSource honesty contract', () => {
  it('a parsed model response is marked ai', () => {
    const completed = parseAIResponse(AI_RESPONSE, INPUT);
    expect(completed.aiSource).toBe('ai');
    expect(completed.stabilizers).toEqual(['erectors', 'forearm_flexors']);
  });

  it('equipment defaults are marked fallback and never carry stabilizer guesses', () => {
    const defaults = getDefaultsByEquipment(INPUT);
    expect(defaults.aiSource).toBe('fallback');
    // The fallback must not fabricate muscle review data — empty stabilizers
    // keep the exercise in the incomplete-review queue.
    expect(defaults.stabilizers).toEqual([]);
    expect(defaults.aiConfidence).toBe('low');
  });
});

describe('completion prompt teaches the stabilizer channel', () => {
  const prompt = renderPrompt(INPUT);

  it('offers rotator_cuff in the muscle vocabulary', () => {
    expect(prompt).toContain('rotator_cuff');
  });

  it('carries the stabilizer classification rules', () => {
    // The rules the seeded stock library was classified under
    // (services/shared/stabilizerTags) — the AI must apply the same ones.
    expect(prompt).toMatch(/erectors — on unsupported rows/i);
    expect(prompt).toMatch(/rotator_cuff AND rear_delts — on horizontal\/vertical pressing/i);
    expect(prompt).toMatch(/forearm_flexors — on hand-supported pulling/i);
  });
});
