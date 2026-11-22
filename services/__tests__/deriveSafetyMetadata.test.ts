/**
 * Joint-stress metadata: an empty stored {} (the stock default) is derived;
 * any stored keys — including explicit false values a user saved for a custom
 * exercise — are kept as data.
 */
import { deriveSafetyMetadata } from '../exerciseService';

const upright = { pattern: 'vertical_pull', equipment: 'barbell' as const, mechanic: 'compound', name: 'Upright Row' };

describe('deriveSafetyMetadata', () => {
  it('derives joint stress when the stored value is missing or an empty {}', () => {
    expect(deriveSafetyMetadata({ ...upright }).positionStress.shoulders).toBe(true);
    expect(deriveSafetyMetadata({ ...upright, storedPositionStress: {} }).positionStress.shoulders).toBe(true);
  });

  it('keeps explicitly saved values, including false', () => {
    const saved = { shoulders: false };
    expect(deriveSafetyMetadata({ ...upright, storedPositionStress: saved }).positionStress).toEqual(saved);
  });
});
