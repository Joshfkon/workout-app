import { trainingAgeForDisplay, trainingAgeForSave } from '../trainingAge';
import { effectiveTrainingAge } from '@/services/mesocycleBuilder';

describe('training age in Settings', () => {
  it('saves an empty or zero field as null (unknown), never 0', () => {
    expect(trainingAgeForSave('')).toBeNull();
    expect(trainingAgeForSave('0')).toBeNull();
    expect(trainingAgeForSave('-1')).toBeNull();
    expect(trainingAgeForSave('abc')).toBeNull();
    expect(trainingAgeForSave('2.5')).toBe(2.5);
  });

  it('shows an old 0 row (and null) as an empty field', () => {
    expect(trainingAgeForDisplay(0)).toBe('');
    expect(trainingAgeForDisplay('0.0')).toBe('');
    expect(trainingAgeForDisplay(null)).toBe('');
    expect(trainingAgeForDisplay(undefined)).toBe('');
    expect(trainingAgeForDisplay(3)).toBe('3');
    // PostgREST returns NUMERIC as a string.
    expect(trainingAgeForDisplay('1.5')).toBe('1.5');
  });

  it('null and an old 0 both fall back to the experience level in the planners', () => {
    expect(effectiveTrainingAge(trainingAgeForSave(''), 'advanced')).toBe(effectiveTrainingAge(0, 'advanced'));
    expect(effectiveTrainingAge(null, 'novice')).toBeLessThan(1);
  });
});
