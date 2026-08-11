/**
 * equipmentClass — normalized equipment classification (pure).
 *
 * The exercise library has NO clean equipment field: `equipment_required` is a
 * free-text REQUIREMENTS list (often multi-tag, mixing the implement with
 * supports — `['dumbbells', 'bench']`), the legacy scalar `equipment` column
 * defaults to 'barbell' and is stale, and implement info also hides in the
 * name suffix (`"(Machine)"`, `"(cable)"`). None of them answers the one
 * question the equipment filter axis needs: "what implement IS this?"
 *
 * This module derives a single normalized {@link EquipmentClass} from whatever
 * signals an exercise carries, in a fixed precedence. It is the SINGLE source
 * of truth for that derivation — used both to backfill the stored
 * `exercises.equipment_class` column (see the add_equipment_class migration)
 * and as a read-time fallback when that column is absent/null (older rows,
 * tests, freshly-created customs).
 *
 * WHY plate-loaded vs pin-loaded are SEPARATE classes:
 * load on a plate-loaded machine and a selectorized (pin) stack is not
 * interchangeable, and collapsing the two is a real regression the app already
 * guards against elsewhere (progressionScope's LOCAL_EQUIPMENT_IDS,
 * exerciseSwapper's class comparison). The taxonomy keeps them distinct at the
 * data layer; the picker UI rolls both up under a single "Machine" chip so the
 * user sees a simple axis while the distinction survives for progression/swap
 * logic. Never merge the two in storage.
 *
 * Pure service: no DB calls. Callers pass the exercise fields in.
 */

// ============================================================
// Taxonomy
// ============================================================

/**
 * Stored, normalized equipment class. Granular enough to keep the distinctions
 * the app cares about (cable ≠ machine, plate-loaded ≠ pin-loaded, Smith on its
 * own) without being unusably fine. `other` is the closed-set catch-all
 * (landmine lives under barbell; TRX/ab-wheel/etc. land here).
 */
export type EquipmentClass =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'cable'
  | 'machine_plate_loaded'
  | 'machine_pin_loaded'
  | 'smith'
  | 'bodyweight'
  | 'band'
  | 'other';

export const EQUIPMENT_CLASSES: readonly EquipmentClass[] = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'cable',
  'machine_plate_loaded',
  'machine_pin_loaded',
  'smith',
  'bodyweight',
  'band',
  'other',
];

/**
 * User-facing filter groups. Each maps to one or more stored classes; "Machine"
 * intentionally spans both machine sub-classes so the picker stays a simple
 * axis while the plate/pin split survives underneath. Ordered for chip display:
 * the common six the product cares about lead, the rest trail (and only render
 * when something in the pool matches — see the picker).
 */
export type EquipmentGroup =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'smith'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'other';

export const EQUIPMENT_GROUP_ORDER: readonly EquipmentGroup[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'smith',
  'bodyweight',
  'kettlebell',
  'band',
  'other',
];

const GROUP_TO_CLASSES: Record<EquipmentGroup, readonly EquipmentClass[]> = {
  barbell: ['barbell'],
  dumbbell: ['dumbbell'],
  machine: ['machine_plate_loaded', 'machine_pin_loaded'],
  cable: ['cable'],
  smith: ['smith'],
  bodyweight: ['bodyweight'],
  kettlebell: ['kettlebell'],
  band: ['band'],
  other: ['other'],
};

const CLASS_TO_GROUP: Record<EquipmentClass, EquipmentGroup> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebell: 'kettlebell',
  cable: 'cable',
  machine_plate_loaded: 'machine',
  machine_pin_loaded: 'machine',
  smith: 'smith',
  bodyweight: 'bodyweight',
  band: 'band',
  other: 'other',
};

const GROUP_LABELS: Record<EquipmentGroup, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  smith: 'Smith',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Band',
  other: 'Other',
};

/** Top-level filter group a stored class rolls up into. */
export function equipmentClassToGroup(cls: EquipmentClass): EquipmentGroup {
  return CLASS_TO_GROUP[cls];
}

/** Human label for a group chip / result-row badge (e.g. 'machine' → 'Machine'). */
export function equipmentGroupLabel(group: EquipmentGroup): string {
  return GROUP_LABELS[group] ?? group;
}

/** Human label for a stored class, rolled up to its group (plate/pin → 'Machine'). */
export function equipmentClassLabel(cls: EquipmentClass): string {
  return equipmentGroupLabel(equipmentClassToGroup(cls));
}

// ============================================================
// Derivation
// ============================================================

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regexCache = new Map<string, RegExp>();
/** Word-boundary test so 'db' doesn't hit 'deadbug' and 'band' doesn't hit 'headband'... */
function contains(text: string, phrase: string): boolean {
  let re = regexCache.get(phrase);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`);
    regexCache.set(phrase, re);
  }
  return re.test(text);
}

const anyPhrase = (text: string, phrases: readonly string[]) =>
  phrases.some((p) => contains(text, p));

// Signal phrase-sets, checked against the name + equipment tags blob. Keep each
// SPECIFIC to its class; a generic term in the wrong bucket misclassifies whole
// swaths of the library.
const SMITH = ['smith', 'smith machine'];
const CABLE = ['cable', 'pulley', 'lat pulldown', 'pulldown', 'pull-down', 'cable row', 'rope pushdown', 'rope pull'];
// Explicit plate-loaded signals. Hammer Strength / Iso-Lateral / lever /
// pendulum machines are plate-loaded; hack squat and belt squat are too.
const MACHINE_PLATE = [
  'plate loaded', 'plate-loaded', 'plate load',
  'iso-lateral', 'iso lateral', 'hammer strength',
  'lever', 'pendulum', 'hack squat', 'belt squat', 'v-squat', 'v squat',
];
// Selectorized / pin stacks and specific stack machines. Generic 'machine' with
// no plate signal defaults here (the conservative "collapse" default; leg press
// and bare 'machine' are flagged AMBIGUOUS for the review pass, not trusted).
const MACHINE_PIN = [
  'selectorized', 'machine', 'pec deck', 'pec-deck', 'fly machine',
  'chest press machine', 'shoulder press machine', 'leg press', 'leg extension',
  'leg curl', 'seated row', 'preacher curl machine', 'assisted', 'hip abduct',
  'hip adduct', 'glute kickback', 'reverse hyper', 'calf raise machine',
  'calf machine', 'mts', 'nautilus', 'cybex', 'technogym', 'matrix', 'precor',
  'life fitness', 'katana',
];
// Barbell family: straight bar, EZ/curl bar, trap/hex bar, landmine (bar-anchored).
const BARBELL = ['barbell', 'ez bar', 'ez curl', 'curl bar', 'trap bar', 'hex bar', 'landmine'];
const DUMBBELL = ['dumbbell', 'dumbbells', 'db'];
const KETTLEBELL = ['kettlebell', 'kettlebells', 'kb'];
const BAND = ['band', 'bands', 'resistance band', 'resistance bands', 'banded'];
const OTHER = ['trx', 'suspension', 'ab wheel', 'rollout', 'medicine ball', 'med ball', 'battle rope', 'battle ropes'];
// Bodyweight stations / movements. Checked LATE (after machines) so an
// "Assisted Dip Machine" or "Assisted Pull-Up Machine" stays a machine, but a
// plain Dip / Pull-Up / Chin-Up (tagged only 'dip bars' / 'pull-up bar', often
// with is_bodyweight unset) reads as bodyweight rather than falling to 'other'.
const BODYWEIGHT_STATION = [
  'dip bars', 'dip station', 'parallel bars', 'pull-up bar', 'pull up bar',
  'pullup bar', 'chin-up bar', 'pull-up', 'pullup', 'pull up',
  'chin-up', 'chinup', 'chin up', 'dips',
];

/**
 * Machine signals whose plate-vs-pin split is a DEFAULT GUESS, not a known
 * fact — surfaced by the backfill's audit query for a manual review pass.
 * 'leg press' and a bare 'machine' tag are the usual offenders (both plate and
 * selectorized versions exist in the wild).
 */
export const AMBIGUOUS_MACHINE_PHRASES: readonly string[] = ['machine', 'leg press'];

export interface EquipmentClassInput {
  /** exercises.equipment_required — free-text requirement tags. */
  equipmentRequired?: string[] | null;
  /** Legacy snake_case alias, tolerated so DB rows can be passed straight in. */
  equipment_required?: string[] | null;
  /** exercises.is_bodyweight. */
  isBodyweight?: boolean | null;
  /** Legacy snake_case alias. */
  is_bodyweight?: boolean | null;
  /** Exercise name — the fallback signal when tags are missing/coarse. */
  name?: string | null;
  /** Hand-correction: exercises.equipment_class, wins over derivation if set. */
  equipmentClass?: EquipmentClass | null;
  /**
   * Legacy snake_case alias. Typed loosely (string) so raw DB rows pass
   * straight in; an unrecognized value simply falls through to derivation.
   */
  equipment_class?: string | null;
}

function readTags(input: EquipmentClassInput): string[] {
  const raw = input.equipmentRequired ?? input.equipment_required ?? [];
  return raw.filter(Boolean).map((t) => String(t).toLowerCase());
}

/**
 * Derive an exercise's equipment class from its signals, in fixed precedence.
 *
 * A stored `equipment_class` (or its snake_case alias) always wins — it is the
 * hand-correctable canonical value. Otherwise: bodyweight flag first (BW
 * movements are BW even when loaded with a plate/DB), then the most-specific
 * implement — Smith and cable before machines (a "cable machine" is a cable,
 * not a generic machine), explicit plate signals before the pin/selectorized
 * default, free weights before the generic-'machine' fallback so a
 * `['dumbbells','bench']` row never reads as a machine. Supports (bench, rack)
 * are NOT class signals and are ignored. Unknown → 'other'.
 */
export function deriveEquipmentClass(input: EquipmentClassInput): EquipmentClass {
  const stored = input.equipmentClass ?? input.equipment_class;
  if (stored && (EQUIPMENT_CLASSES as readonly string[]).includes(stored)) {
    return stored as EquipmentClass;
  }

  const isBw = input.isBodyweight ?? input.is_bodyweight;
  const name = (input.name ?? '').toLowerCase();
  const tags = readTags(input);
  // Name + tags searched together so a signal in either place counts.
  const blob = ` ${[name, ...tags].join(' ')} `;

  if (isBw === true) return 'bodyweight';

  if (anyPhrase(blob, SMITH)) return 'smith';
  if (anyPhrase(blob, CABLE)) return 'cable';
  if (anyPhrase(blob, MACHINE_PLATE)) return 'machine_plate_loaded';
  // Free weights before the generic-machine default: a tagged implement wins
  // over an incidental 'machine' word, and over supports like 'bench'/'rack'.
  if (anyPhrase(blob, BARBELL)) return 'barbell';
  if (anyPhrase(blob, DUMBBELL)) return 'dumbbell';
  if (anyPhrase(blob, KETTLEBELL)) return 'kettlebell';
  if (anyPhrase(blob, MACHINE_PIN)) return 'machine_pin_loaded';
  if (anyPhrase(blob, BAND)) return 'band';
  if (anyPhrase(blob, OTHER)) return 'other';
  // Bodyweight stations/movements (after machines so assisted variants stay machine).
  if (anyPhrase(blob, BODYWEIGHT_STATION)) return 'bodyweight';
  // Name explicitly declares no equipment.
  if (contains(blob, 'bodyweight') || contains(blob, 'body weight')) return 'bodyweight';

  return 'other';
}

/**
 * True when the machine plate/pin split for this exercise was a default guess
 * (needs the review pass), i.e. the class is a machine and the only machine
 * signal present is an ambiguous one. Used by the backfill audit; harmless at
 * runtime.
 */
export function isMachineClassAmbiguous(input: EquipmentClassInput): boolean {
  const cls = deriveEquipmentClass(input);
  if (cls !== 'machine_pin_loaded' && cls !== 'machine_plate_loaded') return false;
  const blob = ` ${[(input.name ?? '').toLowerCase(), ...readTags(input)].join(' ')} `;
  // Ambiguous only if a specific (non-ambiguous) machine signal is absent.
  const specificPin = MACHINE_PIN.filter((p) => !AMBIGUOUS_MACHINE_PHRASES.includes(p));
  const specificPlate = MACHINE_PLATE;
  if (anyPhrase(blob, specificPin) || anyPhrase(blob, specificPlate)) return false;
  return anyPhrase(blob, AMBIGUOUS_MACHINE_PHRASES);
}

// ============================================================
// Load floor (the lightest weight an implement can be set up with)
// ============================================================

/** Bar variants whose empty weight differs enough to change a prescription. */
export type BarbellKind = 'olympic' | 'womens' | 'ez_curl' | 'trap';

/**
 * Empty-bar weights in kg. Mirrors BARBELL_WEIGHTS in lib/utils (kept here so
 * pure services don't have to reach into the display layer for a constant).
 */
export const BAR_WEIGHTS_KG: Record<BarbellKind, number> = {
  olympic: 20,
  womens: 15,
  ez_curl: 10,
  trap: 25,
};

const EZ_BAR = ['ez bar', 'ez curl', 'curl bar'];
const TRAP_BAR = ['trap bar', 'hex bar'];
/**
 * Bar-anchored but NOT loaded like a bar: only one end of the bar is in the
 * lifter's hands, so the load at the handle is roughly half the bar and the
 * empty-bar floor does not apply. Better no floor than a wrong one.
 */
const NO_BAR_FLOOR = ['landmine'];

function signalBlob(input: EquipmentClassInput): string {
  return ` ${[(input.name ?? '').toLowerCase(), ...readTags(input)].join(' ')} `;
}

/**
 * Which bar an exercise is loaded on, or null when it isn't a barbell lift
 * (or is a bar variant with no meaningful empty-bar floor — see NO_BAR_FLOOR).
 */
export function inferBarbellKind(input: EquipmentClassInput): BarbellKind | null {
  if (deriveEquipmentClass(input) !== 'barbell') return null;
  const blob = signalBlob(input);
  if (anyPhrase(blob, NO_BAR_FLOOR)) return null;
  if (anyPhrase(blob, EZ_BAR)) return 'ez_curl';
  if (anyPhrase(blob, TRAP_BAR)) return 'trap';
  return 'olympic';
}

/**
 * The lightest load this exercise can actually be set up with, in kg.
 *
 * For a barbell lift that is the EMPTY BAR: there is no such thing as a 40 lb
 * bench press, so any prescription (warmup ramps especially) that lands below
 * the bar is not a light option — it is an unloadable number, exactly like
 * prescribing a chin-up below the lifter's bodyweight. Everything else returns
 * 0: dumbbells, cables, stacks and plate-loaded machines all go down to their
 * smallest increment, and a Smith bar's counterbalanced weight varies too much
 * per machine to assert one here.
 *
 * `barbellKindOverride` lets a caller state the bar in use (the user's gym has
 * a women's bar on the rack) instead of inferring it from the name/tags.
 */
export function minLoadableWeightKg(
  input: EquipmentClassInput,
  barbellKindOverride?: BarbellKind | null
): number {
  if (barbellKindOverride) return BAR_WEIGHTS_KG[barbellKindOverride];
  const kind = inferBarbellKind(input);
  return kind ? BAR_WEIGHTS_KG[kind] : 0;
}

// ============================================================
// Matching (the picker's equipment axis)
// ============================================================

/** Resolve selected UI groups to the concrete stored classes they cover. */
export function groupsToClasses(groups: readonly EquipmentGroup[]): Set<EquipmentClass> {
  const out = new Set<EquipmentClass>();
  for (const g of groups) for (const c of GROUP_TO_CLASSES[g] ?? []) out.add(c);
  return out;
}

/**
 * Equipment-axis match for the picker. An empty selection matches everything
 * (no constraint). Otherwise the exercise's class (stored, else derived) must
 * fall in one of the selected groups — a UNION within the axis. This is meant
 * to be AND-composed with the muscle-group match by the caller.
 */
export function exerciseMatchesEquipmentGroups(
  ex: EquipmentClassInput,
  groups: readonly EquipmentGroup[] | null | undefined
): boolean {
  if (!groups || groups.length === 0) return true;
  return groupsToClasses(groups).has(deriveEquipmentClass(ex));
}
