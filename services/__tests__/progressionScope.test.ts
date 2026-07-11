import {
  deriveProgressionScope,
  resolveLegacyLocationAttribution,
  scopeHistorySets,
  softenOtherLocationEstimate,
  OTHER_LOCATION_SOFTEN_FACTOR,
  type LocatedSet,
} from '@/services/progressionScope';

describe('deriveProgressionScope', () => {
  it('scopes machine / cable / plate-loaded exercises as local', () => {
    expect(deriveProgressionScope({ equipmentRequired: ['calf_raise'] })).toBe('local');
    expect(deriveProgressionScope({ equipmentRequired: ['cable_machine'] })).toBe('local');
    expect(deriveProgressionScope({ equipmentRequired: ['leg_press'] })).toBe('local');
    expect(deriveProgressionScope({ equipmentRequired: ['lat_pulldown'] })).toBe('local');
    expect(deriveProgressionScope({ equipmentRequired: ['smith_machine'] })).toBe('local');
  });

  it('scopes barbell / dumbbell / bodyweight / band as global', () => {
    expect(deriveProgressionScope({ equipmentRequired: ['barbell'] })).toBe('global');
    expect(deriveProgressionScope({ equipmentRequired: ['dumbbells'] })).toBe('global');
    expect(deriveProgressionScope({ equipmentRequired: ['resistance_bands'] })).toBe('global');
    expect(deriveProgressionScope({ isBodyweight: true })).toBe('global');
  });

  it('keeps a free-weight lift on a bench/rack global (supporting equipment)', () => {
    expect(deriveProgressionScope({ equipmentRequired: ['barbell', 'flat_bench'] })).toBe('global');
    expect(deriveProgressionScope({ equipmentRequired: ['barbell', 'squat_rack'] })).toBe('global');
  });

  it('treats any required local implement as local even alongside free weights', () => {
    // A cable+bench combo is still implement-specific on the cable side.
    expect(deriveProgressionScope({ equipmentRequired: ['cable_machine', 'flat_bench'] })).toBe(
      'local'
    );
  });

  it('falls back to the name heuristic when equipment is untagged', () => {
    expect(deriveProgressionScope({ equipmentRequired: [], name: 'Seated Calf Raise (Machine)' })).toBe(
      'local'
    );
    expect(deriveProgressionScope({ name: 'Cable Fly' })).toBe('local');
    expect(deriveProgressionScope({ name: 'Barbell Back Squat' })).toBe('global');
    expect(deriveProgressionScope({ name: 'Dumbbell Curl' })).toBe('global');
  });

  it('lets a per-exercise override win over the derived class', () => {
    // A globally-tagged lift forced local, and vice versa.
    expect(
      deriveProgressionScope({ equipmentRequired: ['barbell'], scopeOverride: 'local' })
    ).toBe('local');
    expect(
      deriveProgressionScope({ equipmentRequired: ['leg_press'], scopeOverride: 'global' })
    ).toBe('global');
  });

  it('defaults to global when nothing is known', () => {
    expect(deriveProgressionScope({})).toBe('global');
    expect(deriveProgressionScope({ equipmentRequired: ['some_unknown_thing'], name: '' })).toBe(
      'global'
    );
  });
});

describe('resolveLegacyLocationAttribution', () => {
  it('attributes to the most-used location', () => {
    expect(resolveLegacyLocationAttribution({ gymA: 10, gymB: 3 })).toEqual({
      legacyLocationId: 'gymA',
      ambiguous: false,
    });
  });

  it('is ambiguous on a tie', () => {
    expect(resolveLegacyLocationAttribution({ gymA: 5, gymB: 5 })).toEqual({
      legacyLocationId: null,
      ambiguous: true,
    });
  });

  it('is ambiguous with no usage', () => {
    expect(resolveLegacyLocationAttribution({})).toEqual({
      legacyLocationId: null,
      ambiguous: true,
    });
    expect(resolveLegacyLocationAttribution({ gymA: 0 })).toEqual({
      legacyLocationId: null,
      ambiguous: true,
    });
  });
});

describe('scopeHistorySets', () => {
  const s = (locationId: string | null, tag: string): LocatedSet<string> => ({
    locationId,
    set: tag,
  });

  it('returns all sets unchanged for global scope', () => {
    const located = [s('A', 'a1'), s('B', 'b1')];
    const result = scopeHistorySets(located, { scope: 'global', currentLocationId: 'A' });
    expect(result.sets).toEqual(['a1', 'b1']);
    expect(result.estimatedFromOtherLocation).toBe(false);
  });

  it('filters local-scope history to the current location when it has history', () => {
    const located = [s('A', 'a1'), s('A', 'a2'), s('B', 'b1')];
    const result = scopeHistorySets(located, { scope: 'local', currentLocationId: 'A' });
    expect(result.sets).toEqual(['a1', 'a2']);
    expect(result.estimatedFromOtherLocation).toBe(false);
  });

  it('at location A ignores location B loads entirely', () => {
    const located = [s('B', 'b1'), s('B', 'b2')];
    const result = scopeHistorySets(located, { scope: 'local', currentLocationId: 'A' });
    // Falls back to B as an estimate — but the "here" track is empty.
    expect(result.estimatedFromOtherLocation).toBe(true);
    // Verify the "here" filter really excluded B: scoping at B returns them directly.
    const atB = scopeHistorySets(located, { scope: 'local', currentLocationId: 'B' });
    expect(atB.sets).toEqual(['b1', 'b2']);
    expect(atB.estimatedFromOtherLocation).toBe(false);
  });

  it('falls back to other-location history flagged as an estimate on first session here', () => {
    const located = [s('B', 'b1'), s('B', 'b2')];
    const result = scopeHistorySets(located, { scope: 'local', currentLocationId: 'A' });
    expect(result.sets).toEqual(['b1', 'b2']);
    expect(result.estimatedFromOtherLocation).toBe(true);
    expect(result.calibrationNote).toMatch(/starting point/i);
  });

  it('attributes legacy null-location sets to the most-used location', () => {
    const located = [s(null, 'legacy1'), s('B', 'b1')];
    const result = scopeHistorySets(located, {
      scope: 'local',
      currentLocationId: 'A',
      legacy: { legacyLocationId: 'A', ambiguous: false },
    });
    // legacy1 attributed to A (most-used) → counts as "here".
    expect(result.sets).toEqual(['legacy1']);
    expect(result.estimatedFromOtherLocation).toBe(false);
  });

  it('keeps ambiguous legacy sets visible at every location', () => {
    const located = [s(null, 'legacy1')];
    const atA = scopeHistorySets(located, {
      scope: 'local',
      currentLocationId: 'A',
      legacy: { legacyLocationId: null, ambiguous: true },
    });
    const atB = scopeHistorySets(located, {
      scope: 'local',
      currentLocationId: 'B',
      legacy: { legacyLocationId: null, ambiguous: true },
    });
    expect(atA.sets).toEqual(['legacy1']);
    expect(atA.estimatedFromOtherLocation).toBe(false);
    expect(atB.sets).toEqual(['legacy1']);
    expect(atB.estimatedFromOtherLocation).toBe(false);
  });

  it('has no history to estimate from → not flagged', () => {
    const result = scopeHistorySets<string>([], { scope: 'local', currentLocationId: 'A' });
    expect(result.sets).toEqual([]);
    expect(result.estimatedFromOtherLocation).toBe(false);
  });
});

describe('softenOtherLocationEstimate', () => {
  it('drops ~10% for an other-location estimate', () => {
    expect(softenOtherLocationEstimate(100, true)).toBeCloseTo(100 * OTHER_LOCATION_SOFTEN_FACTOR);
  });

  it('leaves same-location values unchanged', () => {
    expect(softenOtherLocationEstimate(100, false)).toBe(100);
  });

  it('leaves non-positive values unchanged', () => {
    expect(softenOtherLocationEstimate(0, true)).toBe(0);
  });
});
