/**
 * The FFMI label and the FFMI sentence must agree for both sexes. The label
 * used the male scale for everyone while the sentence adjusted for women, so
 * a woman at FFMI 19.6 read "Average" next to "excellent muscular
 * development" (synthetic panel, 2026-11-22).
 */
import { getFFMIAssessment, getFFMIBracket } from '../coachingEngine';

const SENTENCE_WORD: Record<string, RegExp> = {
  below_average: /below-average/,
  average: /average muscle mass/,
  above_average: /above-average/,
  excellent: /excellent/,
  elite: /elite/,
};

describe('FFMI label vs sentence', () => {
  for (const sex of ['male', 'female'] as const) {
    it(`agree across the range for ${sex}`, () => {
      for (let ffmi = 13; ffmi <= 27; ffmi += 0.3) {
        const bracket = getFFMIBracket(ffmi, sex);
        expect(getFFMIAssessment(ffmi, sex)).toMatch(SENTENCE_WORD[bracket]);
      }
    });
  }

  it('rates the same FFMI higher for a woman than a man', () => {
    expect(getFFMIBracket(19.6, 'male')).toBe('average');
    expect(getFFMIBracket(19.6, 'female')).toBe('excellent');
  });

  it('defaults to the male scale for existing callers', () => {
    expect(getFFMIBracket(19.6)).toBe('average');
  });
});
