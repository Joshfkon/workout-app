/**
 * Exercise Name Matching
 *
 * Pure, dependency-free helpers for normalizing exercise names and scoring
 * how similar two names are. Shared by:
 *   - the duplicate audit script (scripts/exerciseDedupAudit.ts)
 *   - the merge tool (scripts/mergeExercises.ts)
 *   - the creation-time duplicate check (CustomExerciseBasicForm)
 *   - the exercise similarity score (services/exerciseSwapper.ts)
 *
 * Design notes:
 *   - `normalizeExerciseKey` produces a conservative grouping key by stripping
 *     ONLY parentheticals, punctuation, plural/singular and whitespace, then
 *     sorting tokens. Two names collapse to the same key only when they are
 *     genuinely the same words in any order (e.g. "Seated Calf Raise",
 *     "Seated Calf Raise (Machine)", "Seated calf raise (ameri fit)"). This is
 *     the "near-certain" duplicate signal.
 *   - `exerciseNameSimilarity` is a soft 0..1 score (token Jaccard blended with
 *     character-trigram Dice) that tolerates typos and word additions. This is
 *     the "possible" duplicate signal and the name component of the swap
 *     similarity score.
 *
 * The raw name is never discarded — normalization is only ever used for
 * matching, never for display.
 */

// ============================================
// NORMALIZATION
// ============================================

/** Collapse a plural token to its singular form. Conservative on purpose —
 * over-stemming risks false merges. Handles the endings that actually show up
 * in exercise names (raises, curls, rows, extensions, flies, calves, presses). */
export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'; // flies -> fly
  if (word.endsWith('sses')) return word.slice(0, -2); // presses -> press
  if (/(xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2); // boxes -> box, crunches -> crunch
  if (word.endsWith('ves')) return word.slice(0, -3) + 'f'; // calves -> calf
  if (word.endsWith('ss')) return word; // press, cross — already singular
  if (word.endsWith('s')) return word.slice(0, -1); // raises -> raise, curls -> curl, rows -> row
  return word;
}

/** Lowercase, strip parentheticals + punctuation, singularize each token and
 * collapse whitespace. Preserves token order. */
export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // strip parentheticals: "(Machine)", "(ameri fit)"
    .replace(/[^a-z0-9\s]/g, ' ') // strip punctuation
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .join(' ')
    .trim();
}

/** Grouping key for the "near-certain" duplicate pass: normalized tokens
 * sorted alphabetically so word order doesn't matter. */
export function normalizeExerciseKey(name: string): string {
  return normalizeExerciseName(name).split(' ').filter(Boolean).sort().join(' ');
}

// ============================================
// SIMILARITY
// ============================================

/** Character trigram set for a (space-padded) string. Padding makes short
 * strings share edge trigrams and improves discrimination. */
function charTrigrams(s: string): Set<string> {
  const padded = ` ${s.replace(/\s+/g, ' ').trim()} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  a.forEach((g) => {
    if (b.has(g)) intersection++;
  });
  return (2 * intersection) / (a.size + b.size);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  a.forEach((t) => {
    if (b.has(t)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Soft name similarity in [0, 1]. Blends token Jaccard (catches word overlap /
 * additions like "... (Machine)") with character-trigram Dice (catches typos
 * like "rase" -> "raise"). Identical normalized names score 1.
 */
export function exerciseNameSimilarity(nameA: string, nameB: string): number {
  const na = normalizeExerciseName(nameA);
  const nb = normalizeExerciseName(nameB);
  if (!na && !nb) return 1;
  if (na === nb) return 1;

  const tokenSim = jaccard(new Set(na.split(' ')), new Set(nb.split(' ')));
  const trigramSim = diceCoefficient(charTrigrams(na), charTrigrams(nb));
  return 0.5 * tokenSim + 0.5 * trigramSim;
}

// ============================================
// MATCHING AGAINST A LIBRARY
// ============================================

export interface NameMatchable {
  id: string;
  name: string;
  primaryMuscle?: string;
}

export interface NameMatch<T extends NameMatchable> {
  exercise: T;
  /** 0..1 soft similarity (1 for an exact normalized-key match). */
  similarity: number;
  /** True when normalized grouping keys are identical (near-certain dup). */
  exact: boolean;
}

/**
 * Find existing exercises whose name is the same-or-similar to `name`.
 * Used by the creation-time duplicate check and the audit's fuzzy pass.
 *
 * @param threshold Minimum soft similarity to surface (default 0.55).
 * @param limit     Max matches to return (default 5).
 * @param sameMusclePreferred When a primaryMuscle is provided, matches on the
 *   same muscle sort first; cross-muscle matches still surface if the name is
 *   very similar.
 */
export function findNameMatches<T extends NameMatchable>(
  name: string,
  candidates: T[],
  opts: { threshold?: number; limit?: number; primaryMuscle?: string } = {}
): NameMatch<T>[] {
  const { threshold = 0.55, limit = 5, primaryMuscle } = opts;
  const key = normalizeExerciseKey(name);
  if (!key) return [];

  const matches: NameMatch<T>[] = [];
  for (const candidate of candidates) {
    const exact = normalizeExerciseKey(candidate.name) === key;
    const similarity = exact ? 1 : exerciseNameSimilarity(name, candidate.name);
    if (similarity >= threshold) {
      matches.push({ exercise: candidate, similarity, exact });
    }
  }

  matches.sort((a, b) => {
    // Exact normalized matches always rank first.
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    // Then same-muscle matches when a target muscle is known.
    if (primaryMuscle) {
      const aSame = a.exercise.primaryMuscle === primaryMuscle;
      const bSame = b.exercise.primaryMuscle === primaryMuscle;
      if (aSame !== bSame) return aSame ? -1 : 1;
    }
    return b.similarity - a.similarity;
  });

  return matches.slice(0, limit);
}
