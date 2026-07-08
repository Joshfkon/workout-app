import {
  ALL_EQUIPMENT_IDS,
  LOCATION_PRESETS,
  locationIcon,
  pickDefaultLocation,
  presetUnavailableEquipmentIds,
} from '@/services/locationProfiles';

describe('LOCATION_PRESETS', () => {
  it('defines the Gym / Home / Hotel presets with icons', () => {
    expect(LOCATION_PRESETS.map((p) => p.kind)).toEqual(['gym', 'home', 'travel']);
    LOCATION_PRESETS.forEach((p) => {
      expect(p.icon).toBeTruthy();
      expect(p.name).toBeTruthy();
    });
  });

  it('Gym has the full inventory (no blocklist rows to seed)', () => {
    const gym = LOCATION_PRESETS.find((p) => p.kind === 'gym')!;
    expect(presetUnavailableEquipmentIds(gym)).toEqual([]);
  });

  it('Hotel keeps only dumbbells and bands', () => {
    const travel = LOCATION_PRESETS.find((p) => p.kind === 'travel')!;
    const unavailable = presetUnavailableEquipmentIds(travel);
    expect(unavailable).not.toContain('dumbbells');
    expect(unavailable).not.toContain('resistance_bands');
    expect(unavailable).toContain('barbell');
    expect(unavailable).toContain('cable_machine');
    expect(unavailable).toContain('squat_rack');
    // Everything except the two kept items is blocked.
    expect(unavailable.length).toBe(ALL_EQUIPMENT_IDS.length - 2);
  });

  it('Home keeps a modest dumbbell/band/bench/pull-up setup', () => {
    const home = LOCATION_PRESETS.find((p) => p.kind === 'home')!;
    const unavailable = new Set<string>(presetUnavailableEquipmentIds(home));
    ['dumbbells', 'resistance_bands', 'flat_bench', 'pull_up_bar'].forEach((kept) =>
      expect(unavailable.has(kept)).toBe(false)
    );
    expect(unavailable.has('leg_press')).toBe(true);
  });
});

describe('locationIcon', () => {
  it('uses the explicit icon when present', () => {
    expect(locationIcon({ icon: '💪', presetKind: 'gym' })).toBe('💪');
  });

  it('falls back to the preset icon, then a pin', () => {
    expect(locationIcon({ icon: null, presetKind: 'travel' })).toBe('🧳');
    expect(locationIcon({ icon: null, presetKind: 'custom' })).toBe('📍');
    expect(locationIcon({ icon: null, presetKind: null })).toBe('📍');
  });
});

describe('pickDefaultLocation', () => {
  const loc = (id: string, overrides: Partial<{ isDefault: boolean; lastUsedAt: string | null }> = {}) => ({
    id,
    isDefault: false,
    lastUsedAt: null,
    ...overrides,
  });

  it('returns null for no locations', () => {
    expect(pickDefaultLocation([])).toBeNull();
  });

  it('prefers the most recently used location', () => {
    const picked = pickDefaultLocation([
      loc('a', { isDefault: true, lastUsedAt: '2026-07-01T10:00:00Z' }),
      loc('b', { lastUsedAt: '2026-07-07T10:00:00Z' }),
      loc('c'),
    ]);
    expect(picked?.id).toBe('b');
  });

  it('falls back to the default location when nothing was used yet', () => {
    const picked = pickDefaultLocation([loc('a'), loc('b', { isDefault: true })]);
    expect(picked?.id).toBe('b');
  });

  it('falls back to the first location when there is no default', () => {
    const picked = pickDefaultLocation([loc('a'), loc('b')]);
    expect(picked?.id).toBe('a');
  });
});
