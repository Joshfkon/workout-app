/**
 * @jest-environment jsdom
 */
import {
  foodKeyFor,
  getLastUsedServing,
  getRecentAmounts,
  recordLastUsedServing,
} from '../lastUsedServing';

beforeEach(() => {
  window.localStorage.clear();
});

describe('foodKeyFor', () => {
  it('prefers the most stable identifier available', () => {
    expect(foodKeyFor({ barcode: '123' })).toBe('barcode:123');
    expect(foodKeyFor({ foodId: 'fdc-9' })).toBe('usda:fdc-9');
    expect(foodKeyFor({ id: 'row-1' })).toBe('id:row-1');
    expect(foodKeyFor({ name: '  Peas  ' })).toBe('name:peas');
  });
});

describe('last-used amount + unit', () => {
  it('records and returns the most recent amount+unit', () => {
    const key = foodKeyFor({ foodId: 'peas' });
    expect(getLastUsedServing(key)).toBeNull();

    recordLastUsedServing(key, 150, 'g');
    expect(getLastUsedServing(key)).toMatchObject({ amount: 150, unitId: 'g' });

    recordLastUsedServing(key, 200, 'g');
    expect(getLastUsedServing(key)).toMatchObject({ amount: 200, unitId: 'g' });
  });

  it('surfaces the last N distinct amounts for a unit', () => {
    const key = foodKeyFor({ foodId: 'peas' });
    recordLastUsedServing(key, 100, 'g');
    recordLastUsedServing(key, 150, 'g');
    recordLastUsedServing(key, 150, 'g'); // dup collapses
    recordLastUsedServing(key, 200, 'g');
    expect(getRecentAmounts(key, 'g', 2)).toEqual([200, 150]);
  });

  it('scopes recent amounts to the requested unit', () => {
    const key = foodKeyFor({ foodId: 'peas' });
    recordLastUsedServing(key, 100, 'g');
    recordLastUsedServing(key, 4, 'oz');
    expect(getRecentAmounts(key, 'g', 2)).toEqual([100]);
    expect(getRecentAmounts(key, 'oz', 2)).toEqual([4]);
  });

  it('ignores invalid amounts', () => {
    const key = foodKeyFor({ foodId: 'x' });
    recordLastUsedServing(key, 0, 'g');
    recordLastUsedServing(key, NaN, 'g');
    expect(getLastUsedServing(key)).toBeNull();
  });
});
