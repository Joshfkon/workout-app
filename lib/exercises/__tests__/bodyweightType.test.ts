/**
 * Bodyweight loading-type completion + validation.
 *
 * Guards the fix for the "custom bodyweight exercise silently lacks a
 * bodyweightType" bug: new customs always get a sensible default, and a
 * bodyweight exercise with no loading type fails validation.
 */

import {
  defaultBodyweightType,
  getDefaultsByEquipment,
  validateCompletedExercise,
} from '../exercise-ai-completion';
import type { BasicExerciseInput, CompletedExerciseData } from '../types';

describe('defaultBodyweightType', () => {
  it('returns undefined for non-bodyweight equipment', () => {
    expect(defaultBodyweightType('barbell', 'Back Squat')).toBeUndefined();
    expect(defaultBodyweightType('machine', 'Leg Press')).toBeUndefined();
  });

  it('classifies pull-ups / chin-ups / dips as both', () => {
    expect(defaultBodyweightType('bodyweight', 'Pull-Ups')).toBe('both');
    expect(defaultBodyweightType('bodyweight', 'Weighted Chin-Up')).toBe('both');
    expect(defaultBodyweightType('bodyweight', 'Dips (Chest Focus)')).toBe('both');
  });

  it('classifies assisted machines as assisted_possible', () => {
    expect(defaultBodyweightType('bodyweight', 'Assisted Pull-Up Machine')).toBe(
      'assisted_possible'
    );
  });

  it('classifies isometric holds as pure', () => {
    expect(defaultBodyweightType('bodyweight', 'Plank')).toBe('pure');
    expect(defaultBodyweightType('bodyweight', 'Dead Hang')).toBe('pure');
    expect(defaultBodyweightType('bodyweight', 'Superman Hold')).toBe('pure');
  });

  it('defaults other loadable bodyweight movements to weighted_possible', () => {
    expect(defaultBodyweightType('bodyweight', 'Back extensions')).toBe(
      'weighted_possible'
    );
    expect(defaultBodyweightType('bodyweight', 'Push-Up')).toBe('weighted_possible');
    expect(defaultBodyweightType('bodyweight', 'Hanging Leg Raise')).toBe(
      'weighted_possible'
    );
  });
});

describe('getDefaultsByEquipment bodyweight', () => {
  it('always populates a bodyweightType for bodyweight equipment', () => {
    const input: BasicExerciseInput = {
      name: 'Back extensions',
      primaryMuscle: 'back',
      equipment: 'bodyweight',
    };
    const data = getDefaultsByEquipment(input);
    expect(data.bodyweightType).toBe('weighted_possible');
  });

  it('leaves bodyweightType undefined for non-bodyweight equipment', () => {
    const input: BasicExerciseInput = {
      name: 'Barbell Row',
      primaryMuscle: 'back',
      equipment: 'barbell',
    };
    expect(getDefaultsByEquipment(input).bodyweightType).toBeUndefined();
  });
});

describe('validateCompletedExercise bodyweight loading type', () => {
  const base = (): CompletedExerciseData =>
    getDefaultsByEquipment({
      name: 'Back extensions',
      primaryMuscle: 'back',
      equipment: 'bodyweight',
    });

  it('passes when a bodyweight exercise has a loading type', () => {
    const result = validateCompletedExercise(base());
    expect(result.errors).not.toContain(
      'Select how this bodyweight exercise is loaded'
    );
  });

  it('fails when a bodyweight exercise has no loading type', () => {
    const data = { ...base(), bodyweightType: undefined };
    const result = validateCompletedExercise(data);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Select how this bodyweight exercise is loaded'
    );
  });

  it('does not require a loading type for non-bodyweight equipment', () => {
    const data = getDefaultsByEquipment({
      name: 'Barbell Row',
      primaryMuscle: 'back',
      equipment: 'barbell',
    });
    const result = validateCompletedExercise(data);
    expect(result.errors).not.toContain(
      'Select how this bodyweight exercise is loaded'
    );
  });
});
