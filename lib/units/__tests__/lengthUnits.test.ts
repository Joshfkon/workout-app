import {
  lengthUnitForWeightUnit,
  lengthUnitLabel,
  parseLengthUnit,
  resolveLengthUnit,
} from '../lengthUnits';

describe('length units', () => {
  it('derives the old bundled length unit from the weight unit', () => {
    expect(lengthUnitForWeightUnit('kg')).toBe('cm');
    expect(lengthUnitForWeightUnit('lb')).toBe('in');
  });

  it('leaves existing users unchanged: no length choice follows the weight unit', () => {
    expect(resolveLengthUnit({ units: 'kg' })).toBe('cm');
    expect(resolveLengthUnit({ units: 'lb' })).toBe('in');
  });

  it('uses an explicit length choice even when it differs from the weight unit', () => {
    expect(resolveLengthUnit({ units: 'lb', lengthUnits: 'cm' })).toBe('cm');
    expect(resolveLengthUnit({ units: 'kg', lengthUnits: 'in' })).toBe('in');
  });

  it('ignores invalid stored values', () => {
    expect(resolveLengthUnit({ units: 'kg', lengthUnits: 'ft' })).toBe('cm');
    expect(parseLengthUnit('mm')).toBeNull();
    expect(parseLengthUnit(null)).toBeNull();
    expect(parseLengthUnit('in')).toBe('in');
  });

  it('falls back to the given weight unit when preferences are missing', () => {
    expect(resolveLengthUnit(null)).toBe('in');
    expect(resolveLengthUnit(undefined, 'kg')).toBe('cm');
    expect(resolveLengthUnit({ units: 'stone' }, 'kg')).toBe('cm');
  });

  it('labels units for fields', () => {
    expect(lengthUnitLabel('cm')).toBe('cm');
    expect(lengthUnitLabel('in')).toBe('inches');
  });
});
