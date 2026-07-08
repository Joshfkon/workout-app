/**
 * Training location profiles
 *
 * Pure helpers for the location-aware workout adjuster. A "training location"
 * is a gym_locations row plus its per-location equipment checklist
 * (user_equipment, blocklist model: rows with is_available=false are the
 * equipment the location LACKS).
 *
 * Presets seed a user's first locations so the pre-workout sheet's chip row
 * works with zero setup: Gym (full commercial inventory), Home (modest
 * dumbbell/band setup, meant to be edited), Hotel/Travel (dumbbells + bands +
 * bodyweight). The DB write happens in lib/actions/locations.ts — this file
 * only defines the data.
 */

// Canonical equipment_types ids (kept in sync with EQUIPMENT_MAPPING in
// services/equipmentFilter.ts and the equipment_types seed migration).
export const ALL_EQUIPMENT_IDS = [
  // Machines
  'leg_press',
  'leg_extension',
  'leg_curl',
  'hack_squat',
  'smith_machine',
  'chest_press',
  'pec_deck',
  'shoulder_press_machine',
  'lat_pulldown',
  'seated_row',
  'cable_machine',
  'assisted_dip',
  'preacher_curl',
  'calf_raise',
  'hip_abductor',
  'glute_kickback',
  'reverse_hyper',
  // Free weights
  'barbell',
  'dumbbells',
  'kettlebells',
  'ez_bar',
  'trap_bar',
  // Benches
  'flat_bench',
  'incline_bench',
  'decline_bench',
  // Racks & stations
  'squat_rack',
  'dip_station',
  'pull_up_bar',
  // Other
  'resistance_bands',
  'trx',
  'ab_wheel',
  'medicine_ball',
  'battle_ropes',
  'landmine',
] as const;

export type EquipmentId = (typeof ALL_EQUIPMENT_IDS)[number];

export type LocationPresetKind = 'gym' | 'home' | 'travel' | 'custom';

export interface TrainingLocation {
  id: string;
  name: string;
  icon: string | null;
  presetKind: LocationPresetKind | null;
  isDefault: boolean;
  lastUsedAt: string | null;
  dumbbellMaxKg: number | null;
}

export interface LocationPreset {
  kind: Exclude<LocationPresetKind, 'custom'>;
  name: string;
  icon: string;
  /** Equipment the location HAS (blocklist rows are derived from this). */
  availableEquipmentIds: EquipmentId[];
}

const HOME_EQUIPMENT: EquipmentId[] = [
  'dumbbells',
  'resistance_bands',
  'flat_bench',
  'pull_up_bar',
];

const TRAVEL_EQUIPMENT: EquipmentId[] = ['dumbbells', 'resistance_bands'];

export const LOCATION_PRESETS: LocationPreset[] = [
  {
    kind: 'gym',
    name: 'Gym',
    icon: '🏋️',
    availableEquipmentIds: [...ALL_EQUIPMENT_IDS],
  },
  {
    kind: 'home',
    name: 'Home',
    icon: '🏠',
    availableEquipmentIds: HOME_EQUIPMENT,
  },
  {
    kind: 'travel',
    name: 'Hotel',
    icon: '🧳',
    availableEquipmentIds: TRAVEL_EQUIPMENT,
  },
];

/** Equipment a preset lacks — the user_equipment blocklist rows to seed. */
export function presetUnavailableEquipmentIds(preset: LocationPreset): EquipmentId[] {
  const available = new Set<EquipmentId>(preset.availableEquipmentIds);
  return ALL_EQUIPMENT_IDS.filter((id) => !available.has(id));
}

/** Chip icon for a location: explicit icon, else preset icon, else a pin. */
export function locationIcon(location: Pick<TrainingLocation, 'icon' | 'presetKind'>): string {
  if (location.icon) return location.icon;
  const preset = LOCATION_PRESETS.find((p) => p.kind === location.presetKind);
  return preset?.icon ?? '📍';
}

/**
 * Which location the pre-workout sheet should preselect: most recently used,
 * else the default, else the first. (Weekday-pattern inference is deliberately
 * out of scope for v1 — last-used covers the common case.)
 */
export function pickDefaultLocation<T extends Pick<TrainingLocation, 'isDefault' | 'lastUsedAt'>>(
  locations: T[]
): T | null {
  if (locations.length === 0) return null;

  const lastUsed = locations
    .filter((l) => l.lastUsedAt)
    .sort((a, b) => new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime())[0];
  if (lastUsed) return lastUsed;

  return locations.find((l) => l.isDefault) ?? locations[0];
}
