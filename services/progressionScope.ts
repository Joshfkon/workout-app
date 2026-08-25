/**
 * progressionScope — location-scoped exercise calibration (pure).
 *
 * Machine load is implement-specific: 100 lb on one gym's plate-loaded seated
 * calf raise is not 100 lb on another gym's selectorized version. Rather than
 * duplicating exercises per gym, we keep ONE canonical exercise and decide, per
 * exercise, whether its progression history is location-independent (`global`)
 * or must be read per-location (`local`):
 *
 *   - `global`: barbell, dumbbell, bodyweight, band, kettlebell — a barbell is
 *     a barbell anywhere, so history carries across locations unchanged.
 *   - `local`: machine, cable / selectorized stack, plate-loaded machine, Smith
 *     machine — the implement differs between gyms, so 100 lb "here" is its own
 *     track.
 *
 * The scope is derived once from equipment class (below), with a per-exercise
 * override possible (exercises.progression_scope_override). NO cross-machine
 * conversion math exists — scoped history IS the calibration; a first session
 * at a new implement is a (softened) starting point, not a converted estimate.
 *
 * This module is a pure service (no DB calls): callers pass data in. It owns
 * (a) the equipment-class → scope mapping, (b) the history-read scoping that
 * decides WHICH history feeds the existing suggestion math, and (c) the
 * legacy null-location attribution rule.
 */

export type ProgressionScope = 'global' | 'local';

/**
 * equipment_types ids (services/locationProfiles.ts ALL_EQUIPMENT_IDS) whose
 * load is implement-specific — a `local`-scope signal. Machines, selectorized
 * cable stacks, plate-loaded machines, and the Smith machine all differ enough
 * between gyms that the same displayed load is a different real resistance.
 */
export const LOCAL_EQUIPMENT_IDS: ReadonlySet<string> = new Set([
  // Selectorized / plate-loaded machines
  'leg_press',
  'leg_extension',
  'leg_curl',
  'hack_squat',
  'smith_machine',
  'chest_press',
  'pec_deck',
  'shoulder_press_machine',
  'assisted_dip',
  'preacher_curl',
  'calf_raise',
  'hip_abductor',
  'glute_kickback',
  'reverse_hyper',
  // Cable / pulley stacks
  'cable_machine',
  'lat_pulldown',
  'seated_row',
]);

/**
 * Free-weight / bodyweight / band equipment ids — `global` scope. Benches,
 * racks, and stations are supporting equipment (a barbell bench press is still
 * a barbell lift), so they never make an exercise local on their own.
 */
export const GLOBAL_EQUIPMENT_IDS: ReadonlySet<string> = new Set([
  'barbell',
  'dumbbells',
  'kettlebells',
  'ez_bar',
  'trap_bar',
  'landmine',
  'resistance_bands',
  'trx',
  'ab_wheel',
  'medicine_ball',
  'battle_ropes',
  'flat_bench',
  'incline_bench',
  'decline_bench',
  'squat_rack',
  'dip_station',
  'pull_up_bar',
]);

/**
 * Name-substring fallbacks for exercises with no (or ambiguous) equipment tags.
 * Only local signals live here — a match means "treat as machine/cable-loaded".
 * Order-independent; any hit → local.
 */
const LOCAL_NAME_PATTERNS: readonly string[] = [
  'machine',
  'cable',
  'smith',
  'pec deck',
  'pec-deck',
  'hack squat',
  'leg press',
  'leg extension',
  'leg curl',
  'lying leg curl',
  'seated leg curl',
  'pulldown',
  'pull-down',
  'pull down',
  'seated row',
  'selectorized',
  'plate loaded',
  'plate-loaded',
  'lever ',
];

export interface ProgressionScopeInput {
  /** equipment_types ids the exercise requires (exercises.equipment_required). */
  equipmentRequired?: string[] | null;
  /** True for bodyweight-loaded exercises — always global. */
  isBodyweight?: boolean | null;
  /** Exercise name, used as a fallback when equipment tags are absent. */
  name?: string | null;
  /** Per-exercise override (exercises.progression_scope_override). Wins if set. */
  scopeOverride?: ProgressionScope | null;
}

/**
 * Derive an exercise's progression scope from its equipment class, honoring a
 * per-exercise override first.
 *
 * Rule: an override always wins. Otherwise, an exercise is `local` iff its
 * loading implement is machine/cable/plate-loaded — signaled by a required
 * LOCAL_EQUIPMENT_ID, or (when equipment is untagged) a local name pattern.
 * Bodyweight and anything free-weight is `global`. When in doubt we default to
 * `global` (full, location-independent history) — the conservative choice,
 * since over-scoping would needlessly fragment a barbell lift's trend.
 */
export function deriveProgressionScope(input: ProgressionScopeInput): ProgressionScope {
  if (input.scopeOverride === 'global' || input.scopeOverride === 'local') {
    return input.scopeOverride;
  }

  if (input.isBodyweight) return 'global';

  const equipment = input.equipmentRequired ?? [];
  if (equipment.length > 0) {
    const hasLocal = equipment.some((id) => LOCAL_EQUIPMENT_IDS.has(id));
    if (hasLocal) return 'local';
    // Equipment is present and none of it is local-class → global.
    // (A free-weight lift on a bench/rack stays global.)
    const hasKnownGlobal = equipment.some((id) => GLOBAL_EQUIPMENT_IDS.has(id));
    if (hasKnownGlobal) return 'global';
    // Equipment tags exist but are all unrecognized — fall through to the name
    // heuristic before defaulting.
  }

  const name = (input.name ?? '').toLowerCase();
  if (name && LOCAL_NAME_PATTERNS.some((p) => name.includes(p))) return 'local';

  return 'global';
}

// ---------------------------------------------------------------------------
// Effective location (session location + per-exercise override)
// ---------------------------------------------------------------------------

/**
 * The location one exercise is actually being performed at.
 *
 * A session carries a location (workout_sessions.location_id), but "which gym"
 * and "which machine" are not the same question: one gym can hold two hip
 * adduction machines whose stacks disagree by 40 lb. `exercise_blocks
 * .location_id` overrides the session for a single exercise, so the resolution
 * is simply override-then-session — with `null` meaning unknown/legacy at both
 * levels.
 *
 * This is the single place that ordering is decided: set stamping, history
 * scoping and the UI's badge all call it, so they cannot drift apart and start
 * writing sets to one track while reading suggestions off another.
 */
export function resolveEffectiveLocation(
  blockLocationId: string | null | undefined,
  sessionLocationId: string | null | undefined
): string | null {
  return blockLocationId ?? sessionLocationId ?? null;
}

/**
 * True when a block's override actually changes where it is logged — i.e. it
 * is set AND differs from the session. An override equal to the session
 * location is a no-op and should not be badged in the UI as "somewhere else".
 */
export function hasLocationOverride(
  blockLocationId: string | null | undefined,
  sessionLocationId: string | null | undefined
): boolean {
  return blockLocationId != null && blockLocationId !== sessionLocationId;
}

// ---------------------------------------------------------------------------
// Legacy null-location attribution (rule 6)
// ---------------------------------------------------------------------------

export interface LegacyAttribution {
  /**
   * Location that null-location (legacy) sets are attributed to — the user's
   * most-used location. Null when the attribution is ambiguous (no locations,
   * or a tie for most-used), in which case legacy sets stay visible in EVERY
   * location's track rather than being guessed into one.
   */
  legacyLocationId: string | null;
  /** True when we declined to attribute (no clear most-used location). */
  ambiguous: boolean;
}

/**
 * Decide where null-location legacy sets belong. Rule 6: they count toward the
 * user's most-used location; if that's ambiguous (tie / no data), leave them
 * global-visible (matching every location) rather than guessing.
 *
 * `usageCounts` maps locationId → number of sets/sessions logged there (any
 * monotonic usage signal works). Pure and deterministic (ties → ambiguous).
 */
export function resolveLegacyLocationAttribution(
  usageCounts: Record<string, number>
): LegacyAttribution {
  const entries = Object.entries(usageCounts).filter(([, n]) => n > 0);
  if (entries.length === 0) return { legacyLocationId: null, ambiguous: true };

  entries.sort((a, b) => b[1] - a[1]);
  const [topId, topCount] = entries[0];
  const tie = entries.length > 1 && entries[1][1] === topCount;
  if (tie) return { legacyLocationId: null, ambiguous: true };

  return { legacyLocationId: topId, ambiguous: false };
}

// ---------------------------------------------------------------------------
// History-read scoping (rules 4–6)
// ---------------------------------------------------------------------------

/**
 * How much to discount a first-session-at-a-new-implement suggestion seeded
 * from another location's history: a starting point, not a target (rule 4).
 */
export const OTHER_LOCATION_SOFTEN_FACTOR = 0.9;

/** A set annotated with the location it was logged at (null = legacy/unknown). */
export interface LocatedSet<T> {
  locationId: string | null;
  set: T;
}

export interface ScopeHistoryResult<T> {
  /** The sets the suggestion math should read for this exercise + location. */
  sets: T[];
  /** Whether the suggestion is scoped to a location at all. */
  scope: ProgressionScope;
  /**
   * True when no history exists at the current location and we fell back to
   * another location's history — the suggestion is a softened starting point.
   */
  estimatedFromOtherLocation: boolean;
  /** Human-readable rationale when estimatedFromOtherLocation, else undefined. */
  calibrationNote?: string;
}

/**
 * Choose which located sets feed the suggestion math for one exercise at the
 * current location. The suggestion MATH is untouched — this only decides the
 * input set list (the history-read path) and flags a softened fallback.
 *
 *   global scope → all sets, unchanged.
 *   local scope, history exists here → only this location's sets.
 *   local scope, none here → other locations' sets, flagged as an estimate.
 *
 * Legacy null-location sets are attributed per `legacy` (rule 6): to the
 * most-used location, or — when ambiguous — treated as matching every location
 * so they stay visible instead of being hidden.
 */
export function scopeHistorySets<T>(
  located: LocatedSet<T>[],
  opts: {
    scope: ProgressionScope;
    currentLocationId: string | null;
    legacy?: LegacyAttribution;
  }
): ScopeHistoryResult<T> {
  const { scope, currentLocationId } = opts;

  if (scope === 'global' || !currentLocationId) {
    // Global exercises (and the locationless case) always read full history.
    return {
      sets: located.map((l) => l.set),
      scope,
      estimatedFromOtherLocation: false,
    };
  }

  const legacy = opts.legacy ?? { legacyLocationId: null, ambiguous: true };

  const effectiveLocation = (l: LocatedSet<T>): string | null => {
    if (l.locationId) return l.locationId;
    // Attribute legacy nulls to the most-used location; if ambiguous, they
    // match every location (returned as the current one so they're included).
    if (legacy.legacyLocationId) return legacy.legacyLocationId;
    return currentLocationId;
  };

  const here = located.filter((l) => effectiveLocation(l) === currentLocationId);
  if (here.length > 0) {
    return {
      sets: here.map((l) => l.set),
      scope,
      estimatedFromOtherLocation: false,
    };
  }

  // No history at this implement yet — seed from other locations as a starting
  // point (softened + flagged by the caller / e1RM adjuster).
  return {
    sets: located.map((l) => l.set),
    scope,
    estimatedFromOtherLocation: located.length > 0,
    calibrationNote:
      located.length > 0
        ? 'Estimated from another gym — treat as a starting point. First session here calibrates it.'
        : undefined,
  };
}

/**
 * Apply the first-session-at-a-new-implement discount to an e1RM/weight seeded
 * from another location (rule 4): drop ~10% so the user starts conservatively
 * and the real load is discovered this session. Returns the value unchanged
 * when not an other-location estimate.
 */
export function softenOtherLocationEstimate(
  valueKg: number,
  estimatedFromOtherLocation: boolean
): number {
  if (!estimatedFromOtherLocation || !(valueKg > 0)) return valueKg;
  return valueKg * OTHER_LOCATION_SOFTEN_FACTOR;
}
