/**
 * Equipment Filter Service
 * Filters exercises based on user's available gym equipment.
 *
 * Pure functions only — no database calls.
 * Use lib/actions/equipment.ts / lib/actions/locations.ts to fetch the
 * blocklist (equipment_types ids marked is_available=false).
 *
 * FAIL-CLOSED CONTRACT (when a blocklist is configured, i.e. non-empty):
 * an exercise is available only when its equipment requirements are known
 * AND every requirement is satisfiable by equipment outside the blocklist.
 *   - No equipment tags and not bodyweight  → excluded ('missing_equipment_tags')
 *   - A tag that maps to no known equipment → excluded ('unknown_requirement')
 *   - A requirement whose equipment is all blocked → excluded ('unavailable_equipment')
 * An empty blocklist means "no inventory constraint configured" and filters
 * nothing — absence of a constraint is not the same as an unknown constraint.
 *
 * Two matching layers, both must pass:
 *   1. Name/tag signals against the blocklist (legacy keyword layer, kept so
 *      mis-tagged exercises whose NAME reveals blocked equipment still get
 *      excluded, e.g. "Leg Extension" tagged just 'machine').
 *   2. Requirement resolution: each equipment tag resolves to one or more
 *      equipment_types ids ("bench" → any bench; "machine" → any machine);
 *      a requirement is satisfied when at least one resolved id is NOT in
 *      the blocklist.
 *
 * Derived concepts (not their own checklist item, but real constraints):
 *   - weight plates  — available iff a barbell or trap bar is available
 *     (the checklist item is literally "Barbell + Plates"); required by
 *     'plate'/'plate loaded' tags and names.
 *   - nordic anchor  — something to hook your feet under (rack, barbell,
 *     lat pulldown or leg curl pads); required by 'nordic'/'anchor'/'ghd'
 *     tags and names.
 */

// ============================================================
// Equipment catalog (mirrors the equipment_types table)
// ============================================================

const MACHINE_IDS = [
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
] as const;

const BENCH_IDS = ['flat_bench', 'incline_bench', 'decline_bench'] as const;

export const KNOWN_EQUIPMENT_IDS: readonly string[] = [
  ...MACHINE_IDS,
  'barbell',
  'dumbbells',
  'kettlebells',
  'ez_bar',
  'trap_bar',
  ...BENCH_IDS,
  'squat_rack',
  'dip_station',
  'pull_up_bar',
  'resistance_bands',
  'trx',
  'ab_wheel',
  'medicine_ball',
  'battle_ropes',
  'landmine',
];

/** Derived concept: plates come with bars ("Barbell + Plates" checklist item). */
const WEIGHT_PLATES_SOURCES = ['barbell', 'trap_bar'];
/** Derived concept: anything to anchor feet under for Nordic curls / GHRs. */
const NORDIC_ANCHOR_SOURCES = ['squat_rack', 'barbell', 'lat_pulldown', 'leg_curl'];

// ============================================================
// Layer 1: name/tag keywords per blocklisted equipment id
// ============================================================

// Keywords are matched with word boundaries against the exercise name and
// equipment tags. Keep these SPECIFIC to the equipment id — a generic term
// here (e.g. 'machine' under leg_press) would exclude every machine exercise
// whenever one specific machine is missing.
const EQUIPMENT_MAPPING: Record<string, string[]> = {
  // Machines
  leg_press: ['leg press'],
  leg_extension: ['leg extension'],
  leg_curl: ['leg curl'],
  hack_squat: ['hack squat'],
  smith_machine: ['smith machine', 'smith'],
  chest_press: ['chest press machine'],
  pec_deck: ['pec deck', 'fly machine'],
  shoulder_press_machine: ['shoulder press machine'],
  lat_pulldown: ['lat pulldown', 'pulldown'],
  seated_row: ['seated row', 'cable row'],
  cable_machine: ['cable', 'pulley'],
  assisted_dip: ['assisted'],
  preacher_curl: ['preacher'],
  calf_raise: ['calf raise machine', 'calf machine'],
  hip_abductor: ['hip abductor', 'hip adductor'],
  glute_kickback: ['glute kickback'],
  reverse_hyper: ['reverse hyper'],

  // Free Weights
  barbell: ['barbell'],
  dumbbells: ['dumbbell', 'dumbbells', 'db'],
  kettlebells: ['kettlebell', 'kb'],
  ez_bar: ['ez bar', 'ez curl', 'curl bar'],
  trap_bar: ['trap bar', 'hex bar'],

  // Benches & Racks
  flat_bench: ['flat bench'],
  incline_bench: ['incline bench', 'incline'],
  decline_bench: ['decline bench', 'decline'],
  squat_rack: ['squat rack', 'power rack', 'rack'],
  dip_station: ['dip', 'dips', 'dip bars', 'parallel bars'],
  pull_up_bar: ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup', 'chin up'],

  // Other
  resistance_bands: ['band', 'bands', 'resistance band', 'banded'],
  trx: ['trx', 'suspension'],
  ab_wheel: ['ab wheel', 'rollout'],
  medicine_ball: ['medicine ball', 'med ball'],
  battle_ropes: ['battle ropes', 'battle rope'],
  landmine: ['landmine'],
};

// ============================================================
// Layer 2: requirement-tag → equipment ids resolution
// ============================================================

interface RequirementSynonym {
  /** Word-boundary phrase found inside an equipment tag (or exercise name). */
  phrase: string;
  /** Equipment ids that satisfy the requirement (ANY one available = satisfied). */
  ids: readonly string[];
  /** True for the no-equipment sentinel ('bodyweight'). */
  bodyweight?: boolean;
  /** Human label used in exclusion details. */
  label?: string;
}

const BW = { bodyweight: true, ids: [] as string[] };

const REQUIREMENT_SYNONYMS: RequirementSynonym[] = [
  // Bodyweight sentinel
  { phrase: 'bodyweight', ...BW },
  { phrase: 'body weight', ...BW },
  { phrase: 'none', ...BW },

  // Benches (specific before generic; matching is longest-phrase-first anyway)
  { phrase: 'adjustable bench', ids: ['incline_bench'] },
  { phrase: 'incline bench', ids: ['incline_bench'] },
  { phrase: 'decline bench', ids: ['decline_bench'] },
  { phrase: 'flat bench', ids: ['flat_bench'] },
  { phrase: 'weight bench', ids: BENCH_IDS },
  { phrase: 'bench', ids: BENCH_IDS },
  { phrase: 'incline', ids: ['incline_bench'] },
  { phrase: 'decline', ids: ['decline_bench'] },

  // Racks & stations
  { phrase: 'squat rack', ids: ['squat_rack'] },
  { phrase: 'power rack', ids: ['squat_rack'] },
  { phrase: 'rack', ids: ['squat_rack'] },
  { phrase: 'pull-up bar', ids: ['pull_up_bar'] },
  { phrase: 'pull up bar', ids: ['pull_up_bar'] },
  { phrase: 'pullup bar', ids: ['pull_up_bar'] },
  { phrase: 'pull-up', ids: ['pull_up_bar'] },
  { phrase: 'pullup', ids: ['pull_up_bar'] },
  { phrase: 'chin-up', ids: ['pull_up_bar'] },
  { phrase: 'chinup', ids: ['pull_up_bar'] },
  { phrase: 'chin up', ids: ['pull_up_bar'] },
  { phrase: 'dip bars', ids: ['dip_station'] },
  { phrase: 'dip station', ids: ['dip_station'] },
  { phrase: 'parallel bars', ids: ['dip_station'] },
  { phrase: 'dip', ids: ['dip_station'] },

  // Specific machines
  { phrase: 'smith machine', ids: ['smith_machine'] },
  { phrase: 'smith', ids: ['smith_machine'] },
  { phrase: 'leg press', ids: ['leg_press'] },
  { phrase: 'leg extension', ids: ['leg_extension'] },
  { phrase: 'leg curl', ids: ['leg_curl'] },
  { phrase: 'hack squat', ids: ['hack_squat'] },
  { phrase: 'chest press', ids: ['chest_press'] },
  { phrase: 'pec deck', ids: ['pec_deck'] },
  { phrase: 'fly machine', ids: ['pec_deck'] },
  { phrase: 'shoulder press machine', ids: ['shoulder_press_machine'] },
  { phrase: 'assisted pull-up machine', ids: ['assisted_dip'] },
  { phrase: 'assisted dip', ids: ['assisted_dip'] },
  { phrase: 'lat pulldown', ids: ['lat_pulldown'] },
  { phrase: 'pulldown', ids: ['lat_pulldown'] },
  { phrase: 'seated row', ids: ['seated_row'] },
  { phrase: 'cable row', ids: ['seated_row', 'cable_machine'] },
  { phrase: 'cable', ids: ['cable_machine'] },
  { phrase: 'pulley', ids: ['cable_machine'] },
  { phrase: 'rope attachment', ids: ['cable_machine'] },
  { phrase: 'row handle', ids: ['cable_machine'] },
  { phrase: 'preacher', ids: ['preacher_curl'] },
  { phrase: 'calf raise machine', ids: ['calf_raise'] },
  { phrase: 'calf machine', ids: ['calf_raise'] },
  { phrase: 'hip abduction machine', ids: ['hip_abductor'] },
  { phrase: 'hip adduction machine', ids: ['hip_abductor'] },
  { phrase: 'hip abductor', ids: ['hip_abductor'] },
  { phrase: 'hip adductor', ids: ['hip_abductor'] },
  { phrase: 'glute kickback', ids: ['glute_kickback'] },
  { phrase: 'reverse hyper', ids: ['reverse_hyper'] },
  // Generic / brand machines ('mts machine', 'hammer strength machine', ...)
  { phrase: 'machine', ids: MACHINE_IDS, label: 'a machine' },

  // Free weights
  { phrase: 'barbell', ids: ['barbell'] },
  { phrase: 'dumbbell', ids: ['dumbbells'] },
  { phrase: 'dumbbells', ids: ['dumbbells'] },
  { phrase: 'db', ids: ['dumbbells'] },
  { phrase: 'kettlebell', ids: ['kettlebells'] },
  { phrase: 'kettlebells', ids: ['kettlebells'] },
  { phrase: 'kb', ids: ['kettlebells'] },
  { phrase: 'ez curl bar', ids: ['ez_bar'] },
  { phrase: 'ez bar', ids: ['ez_bar'] },
  { phrase: 'ez curl', ids: ['ez_bar'] },
  { phrase: 'curl bar', ids: ['ez_bar'] },
  { phrase: 'trap bar', ids: ['trap_bar'] },
  { phrase: 'hex bar', ids: ['trap_bar'] },
  { phrase: 'landmine', ids: ['landmine'] },

  // Other
  { phrase: 'resistance bands', ids: ['resistance_bands'] },
  { phrase: 'resistance band', ids: ['resistance_bands'] },
  { phrase: 'banded', ids: ['resistance_bands'] },
  { phrase: 'bands', ids: ['resistance_bands'] },
  { phrase: 'band', ids: ['resistance_bands'] },
  { phrase: 'trx', ids: ['trx'] },
  { phrase: 'suspension', ids: ['trx'] },
  { phrase: 'ab wheel', ids: ['ab_wheel'] },
  { phrase: 'medicine ball', ids: ['medicine_ball'] },
  { phrase: 'med ball', ids: ['medicine_ball'] },
  { phrase: 'battle ropes', ids: ['battle_ropes'] },
  { phrase: 'battle rope', ids: ['battle_ropes'] },

  // Derived concepts
  { phrase: 'weight plates', ids: WEIGHT_PLATES_SOURCES, label: 'weight plates' },
  { phrase: 'plate loaded', ids: WEIGHT_PLATES_SOURCES, label: 'weight plates' },
  { phrase: 'plate-loaded', ids: WEIGHT_PLATES_SOURCES, label: 'weight plates' },
  { phrase: 'plates', ids: WEIGHT_PLATES_SOURCES, label: 'weight plates' },
  { phrase: 'plate', ids: WEIGHT_PLATES_SOURCES, label: 'weight plates' },
  { phrase: 'nordic anchor', ids: NORDIC_ANCHOR_SOURCES, label: 'a foot anchor' },
  { phrase: 'nordic', ids: NORDIC_ANCHOR_SOURCES, label: 'a foot anchor' },
  { phrase: 'ghd', ids: NORDIC_ANCHOR_SOURCES, label: 'a foot anchor' },
  { phrase: 'glute ham', ids: NORDIC_ANCHOR_SOURCES, label: 'a foot anchor' },
  { phrase: 'anchor', ids: NORDIC_ANCHOR_SOURCES, label: 'a foot anchor' },
]
  // Longest phrase first so 'incline bench' wins over 'bench'/'incline'.
  .sort((a, b) => b.phrase.length - a.phrase.length);

// Requirements the exercise NAME implies regardless of (possibly missing or
// too-coarse) tags. This is what catches "Seated Calf Raise (Plate Loaded)"
// or "Nordic Curl" even when the row is tagged 'machine' or 'bodyweight'.
const NAME_IMPLIED_REQUIREMENTS: RequirementSynonym[] = [
  { phrase: 'plate loaded', ids: WEIGHT_PLATES_SOURCES, label: 'weight plates' },
  { phrase: 'plate-loaded', ids: WEIGHT_PLATES_SOURCES, label: 'weight plates' },
  { phrase: 'nordic', ids: NORDIC_ANCHOR_SOURCES, label: 'a foot anchor' },
  { phrase: 'glute ham raise', ids: NORDIC_ANCHOR_SOURCES, label: 'a foot anchor' },
  { phrase: 'machine', ids: MACHINE_IDS, label: 'a machine' },
];

// ============================================================
// Matching helpers
// ============================================================

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const phraseRegexCache = new Map<string, RegExp>();
/** Word-boundary regex for a phrase ('db' must not match inside 'deadbug'). */
function phraseRegex(phrase: string): RegExp {
  let regex = phraseRegexCache.get(phrase);
  if (!regex) {
    regex = new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`);
    phraseRegexCache.set(phrase, regex);
  }
  return regex;
}

function containsPhrase(text: string, phrase: string): boolean {
  return phraseRegex(phrase).test(text);
}

interface ResolvedRequirement {
  ids: readonly string[];
  bodyweight: boolean;
  label: string;
}

/**
 * Resolve one equipment tag (or a legacy space-joined blob of tags) to the
 * equipment concepts it requires. Phrases are extracted longest-first and
 * blanked out so 'cable machine' yields cable + any-machine, not just one.
 * Returns `matched: false` when the token names no known equipment at all.
 *
 * Exported for the exercise-DB audit (every tag in the library must resolve).
 */
export function resolveEquipmentRequirement(token: string): {
  matched: boolean;
  requirements: ResolvedRequirement[];
} {
  let text = ` ${token.toLowerCase().trim()} `;
  const requirements: ResolvedRequirement[] = [];
  let extracted = true;
  while (extracted) {
    extracted = false;
    for (const synonym of REQUIREMENT_SYNONYMS) {
      if (!containsPhrase(text, synonym.phrase)) continue;
      requirements.push({
        ids: synonym.ids,
        bodyweight: synonym.bodyweight === true,
        label: synonym.label ?? synonym.phrase,
      });
      text = text.replace(phraseRegex(synonym.phrase), '$1$2');
      extracted = true;
      break;
    }
  }
  return { matched: requirements.length > 0, requirements };
}

// ============================================================
// Public API
// ============================================================

export interface EquipmentCheckInput {
  name: string;
  /**
   * Equipment tags (exercises.equipment_required). A plain string is
   * accepted for legacy callers that pass a single tag or a joined blob.
   */
  equipment?: string | string[] | null;
  /** exercises.is_bodyweight — no-tag bodyweight exercises pass the filter. */
  isBodyweight?: boolean | null;
}

export type EquipmentExclusionReason =
  | 'unavailable_equipment'
  | 'unknown_requirement'
  | 'missing_equipment_tags';

export interface EquipmentCheck {
  available: boolean;
  reason?: EquipmentExclusionReason;
  /** Human-readable detail for debug logs ("requires weight plates"). */
  detail?: string;
}

const AVAILABLE: EquipmentCheck = { available: true };

function normalizeTags(equipment: EquipmentCheckInput['equipment']): string[] {
  if (equipment == null) return [];
  const tags = Array.isArray(equipment) ? equipment : [equipment];
  return tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
}

/**
 * Fail-closed availability check for one exercise against a blocklist of
 * unavailable equipment_types ids. See the module doc for the contract.
 */
export function checkExerciseEquipment(
  exercise: EquipmentCheckInput,
  unavailableEquipmentIds: string[]
): EquipmentCheck {
  // No configured constraint — nothing to filter against.
  if (unavailableEquipmentIds.length === 0) return AVAILABLE;

  const blocked = new Set(unavailableEquipmentIds);
  const name = exercise.name.toLowerCase();
  const tags = normalizeTags(exercise.equipment);
  const tagBlob = tags.join(' ');

  // Layer 1: blocked-equipment keywords in the name or tags. Catches
  // mis-tagged rows whose name reveals the dependency.
  for (const equipmentId of unavailableEquipmentIds) {
    for (const keyword of EQUIPMENT_MAPPING[equipmentId] ?? []) {
      if (containsPhrase(name, keyword) || containsPhrase(tagBlob, keyword)) {
        return {
          available: false,
          reason: 'unavailable_equipment',
          detail: `name/tags mention unavailable equipment '${equipmentId}' ('${keyword}')`,
        };
      }
    }
  }

  const satisfied = (req: ResolvedRequirement): boolean =>
    req.bodyweight || req.ids.some((id) => !blocked.has(id));

  // Layer 1.5: requirements implied by the exercise name regardless of tags.
  for (const implied of NAME_IMPLIED_REQUIREMENTS) {
    if (!containsPhrase(name, implied.phrase)) continue;
    if (!implied.ids.some((id) => !blocked.has(id))) {
      return {
        available: false,
        reason: 'unavailable_equipment',
        detail: `requires ${implied.label ?? implied.phrase} (from name)`,
      };
    }
  }

  // Layer 2: fail-closed tag resolution.
  if (tags.length === 0) {
    // is_bodyweight flag, or the name itself declaring the loading style
    // ("Bodyweight Squat"), counts as an explicit no-equipment tag.
    if (exercise.isBodyweight === true || containsPhrase(name, 'bodyweight')) return AVAILABLE;
    return {
      available: false,
      reason: 'missing_equipment_tags',
      detail: 'no equipment tags and not marked bodyweight',
    };
  }

  for (const tag of tags) {
    const { matched, requirements } = resolveEquipmentRequirement(tag);
    if (!matched) {
      return {
        available: false,
        reason: 'unknown_requirement',
        detail: `equipment tag '${tag}' names no known equipment`,
      };
    }
    for (const requirement of requirements) {
      if (!satisfied(requirement)) {
        return {
          available: false,
          reason: 'unavailable_equipment',
          detail: `requires ${requirement.label}`,
        };
      }
    }
  }

  return AVAILABLE;
}

/**
 * Check if an exercise cannot be performed with the given blocklist.
 * Fail-closed: also true for untagged/unknown-tagged exercises whenever a
 * blocklist is configured.
 */
export function exerciseRequiresUnavailableEquipment(
  exercise: EquipmentCheckInput,
  unavailableEquipmentIds: string[]
): boolean {
  return !checkExerciseEquipment(exercise, unavailableEquipmentIds).available;
}

/**
 * Filter exercises to only those the user can perform. Excluded exercises
 * are reported through `onExcluded` (and a single debug log line) so
 * taxonomy gaps stay visible instead of failing silently.
 */
export function filterExercisesByEquipment<T extends EquipmentCheckInput>(
  exercises: T[],
  unavailableEquipmentIds: string[],
  onExcluded?: (exercise: T, check: EquipmentCheck) => void
): T[] {
  if (unavailableEquipmentIds.length === 0) return exercises;

  const excludedLog: string[] = [];
  const kept = exercises.filter((ex) => {
    const check = checkExerciseEquipment(ex, unavailableEquipmentIds);
    if (!check.available) {
      excludedLog.push(`${ex.name} [${check.reason}: ${check.detail}]`);
      onExcluded?.(ex, check);
    }
    return check.available;
  });

  if (excludedLog.length > 0 && typeof console !== 'undefined') {
    // One line per filter pass — enough to diagnose taxonomy gaps in the wild.
    console.debug(
      `[equipmentFilter] excluded ${excludedLog.length}/${exercises.length} exercises for blocklist [${unavailableEquipmentIds.join(', ')}]: ${excludedLog.join('; ')}`
    );
  }

  return kept;
}

/**
 * Get exercises that user CAN'T do (for UI display)
 */
export function getUnavailableExercises<T extends EquipmentCheckInput>(
  exercises: T[],
  unavailableEquipmentIds: string[]
): T[] {
  if (unavailableEquipmentIds.length === 0) return [];

  return exercises.filter(ex => exerciseRequiresUnavailableEquipment(ex, unavailableEquipmentIds));
}

/**
 * Report of exercises the fail-closed filter would exclude at ANY location
 * because their metadata is unusable: no tags (and not bodyweight), or a tag
 * that names no known equipment. These need taxonomy fixes.
 */
export function getUntaggedExercises<T extends EquipmentCheckInput>(
  exercises: T[]
): { exercise: T; reason: EquipmentExclusionReason; detail?: string }[] {
  const report: { exercise: T; reason: EquipmentExclusionReason; detail?: string }[] = [];
  for (const exercise of exercises) {
    const tags = normalizeTags(exercise.equipment);
    if (tags.length === 0) {
      if (exercise.isBodyweight !== true) {
        report.push({
          exercise,
          reason: 'missing_equipment_tags',
          detail: 'no equipment tags and not marked bodyweight',
        });
      }
      continue;
    }
    for (const tag of tags) {
      if (!resolveEquipmentRequirement(tag).matched) {
        report.push({
          exercise,
          reason: 'unknown_requirement',
          detail: `equipment tag '${tag}' names no known equipment`,
        });
        break;
      }
    }
  }
  return report;
}

/**
 * Post-generation invariant: every selected exercise must pass the equipment
 * check. Violations mean a generation path skipped the shared filter — throw
 * in dev so the gap is found immediately; in production drop the exercise
 * and log, never hand the user an impossible workout.
 *
 * `isUserOverride` marks items the user explicitly chose to keep despite the
 * equipment gap (or that the UI flags as "no substitute available") — those
 * are visible, deliberate exceptions, not silent violations.
 */
export function enforceEquipmentInvariant<T extends EquipmentCheckInput>(
  items: T[],
  unavailableEquipmentIds: string[],
  options?: { context?: string; isUserOverride?: (item: T) => boolean }
): T[] {
  if (unavailableEquipmentIds.length === 0) return items;

  const context = options?.context ?? 'workout generation';
  const kept: T[] = [];
  const violations: string[] = [];

  for (const item of items) {
    if (options?.isUserOverride?.(item)) {
      kept.push(item);
      continue;
    }
    const check = checkExerciseEquipment(item, unavailableEquipmentIds);
    if (check.available) {
      kept.push(item);
    } else {
      violations.push(`${item.name} [${check.reason}: ${check.detail}]`);
    }
  }

  if (violations.length > 0) {
    const message = `[equipmentFilter] invariant violated in ${context}: ${violations.join('; ')}`;
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(message);
    }
    console.error(message);
  }

  return kept;
}

/**
 * Legacy users.available_equipment is a coarse allowlist
 * ('barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'kettlebell').
 * Convert it to the blocklist of equipment_types ids the filter consumes.
 * Equipment classes the legacy enum can't express (benches, racks, bands...)
 * are left available.
 */
export function unavailableIdsFromLegacyAllowlist(availableEquipment: string[]): string[] {
  const groups: Record<string, readonly string[]> = {
    barbell: ['barbell', 'ez_bar', 'trap_bar', 'landmine'],
    dumbbell: ['dumbbells'],
    kettlebell: ['kettlebells'],
    cable: ['cable_machine', 'lat_pulldown', 'seated_row', 'glute_kickback'],
    machine: MACHINE_IDS,
    bodyweight: [],
  };

  const available = new Set(availableEquipment.map((e) => e.toLowerCase().trim()));
  const availableIds = new Set<string>();
  const unavailableIds = new Set<string>();
  for (const [legacy, ids] of Object.entries(groups)) {
    for (const id of ids) {
      if (available.has(legacy)) availableIds.add(id);
      else unavailableIds.add(id);
    }
  }
  // Overlapping groups (cable ids are also machine ids): available wins.
  return Array.from(unavailableIds).filter((id) => !availableIds.has(id));
}

/**
 * Create an equipment filter from pre-fetched unavailable equipment IDs.
 * Use fetchUnavailableEquipment() from lib/actions/equipment.ts to get the IDs first.
 */
export function createEquipmentFilter(unavailableIds: string[]) {
  return {
    unavailableIds,
    filter: <T extends EquipmentCheckInput>(exercises: T[]) =>
      filterExercisesByEquipment(exercises, unavailableIds),
    isAvailable: (exercise: EquipmentCheckInput) =>
      !exerciseRequiresUnavailableEquipment(exercise, unavailableIds),
    check: (exercise: EquipmentCheckInput) => checkExerciseEquipment(exercise, unavailableIds),
  };
}
