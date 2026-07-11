/**
 * Exercise Duplicate Grouping
 *
 * Pure grouping logic for the duplicate audit (scripts/exerciseDedupAudit.ts).
 * Two passes, matching the audit's two confidence tiers:
 *   1. near-certain — exercises whose normalized key is identical (same words,
 *      any order, ignoring parentheticals/punctuation/plurals).
 *   2. possible — of what's left, exercises within the SAME primary muscle whose
 *      names are fuzzily similar above a conservative threshold, connected into
 *      groups.
 *
 * Report-only: this never mutates anything.
 */

import { normalizeExerciseKey, exerciseNameSimilarity } from './exerciseNameMatch';

export interface DedupExercise {
  id: string;
  name: string;
  primaryMuscle?: string;
  /** 'seed' (from seed migration) vs 'custom' (user-created). */
  source?: string;
  createdAt?: string | null;
  tier?: string | null;
  equipment?: string | null;
  bodyweightType?: string | null;
  /** Count of set logs attached (via exercise_blocks). */
  setLogCount?: number;
  /** Most recent set log date (ISO), or null. */
  lastLoggedAt?: string | null;
  /** True if referenced by a saved routine/template or mesocycle. */
  inRoutineOrMeso?: boolean;
}

export type DedupConfidence = 'near-certain' | 'possible';

export interface DedupGroup {
  /** Representative key/name for the group. */
  key: string;
  confidence: DedupConfidence;
  members: DedupExercise[];
  reason: string;
}

export interface GroupDuplicatesOptions {
  /**
   * Minimum soft similarity for the fuzzy "possible" pass (default 0.6).
   * Deliberately inclusive — "possible" groups are human-reviewed and kept
   * separate from the "near-certain" tier, so surfacing a few false positives
   * is preferable to missing a real duplicate.
   */
  fuzzyThreshold?: number;
}

export interface GroupDuplicatesResult {
  nearCertain: DedupGroup[];
  possible: DedupGroup[];
}

/** Group exercises into near-certain and possible duplicate sets. */
export function groupDuplicates(
  exercises: DedupExercise[],
  opts: GroupDuplicatesOptions = {}
): GroupDuplicatesResult {
  const fuzzyThreshold = opts.fuzzyThreshold ?? 0.6;

  // --- Pass 1: exact normalized-key groups (near-certain) ------------------
  const byKey = new Map<string, DedupExercise[]>();
  for (const ex of exercises) {
    const key = normalizeExerciseKey(ex.name);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(ex);
    byKey.set(key, list);
  }

  const nearCertain: DedupGroup[] = [];
  const remainder: DedupExercise[] = [];
  byKey.forEach((members, key) => {
    if (members.length >= 2) {
      nearCertain.push({
        key,
        confidence: 'near-certain',
        members: sortMembers(members),
        reason: 'Identical normalized name (parentheticals/punctuation/plurals ignored).',
      });
    } else {
      remainder.push(members[0]);
    }
  });

  // --- Pass 2: fuzzy, within the same primary muscle (possible) ------------
  const possible: DedupGroup[] = [];
  const byMuscle = new Map<string, DedupExercise[]>();
  for (const ex of remainder) {
    const m = (ex.primaryMuscle ?? '').toLowerCase();
    const list = byMuscle.get(m) ?? [];
    list.push(ex);
    byMuscle.set(m, list);
  }

  byMuscle.forEach((group) => {
    if (group.length < 2) return;
    // Union-find over pairs above the threshold.
    const parent = group.map((_item: DedupExercise, i: number) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number) => {
      parent[find(a)] = find(b);
    };

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (exerciseNameSimilarity(group[i].name, group[j].name) >= fuzzyThreshold) {
          union(i, j);
        }
      }
    }

    const components = new Map<number, DedupExercise[]>();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      const list = components.get(root) ?? [];
      list.push(group[i]);
      components.set(root, list);
    }

    components.forEach((members) => {
      if (members.length >= 2) {
        possible.push({
          key: normalizeExerciseKey(members[0].name),
          confidence: 'possible',
          members: sortMembers(members),
          reason: `Similar names within the same primary muscle (≥ ${Math.round(
            fuzzyThreshold * 100
          )}% name similarity).`,
        });
      }
    });
  });

  // Biggest groups first, then most-history first.
  const bySize = (a: DedupGroup, b: DedupGroup) =>
    b.members.length - a.members.length || groupSetLogs(b) - groupSetLogs(a);
  nearCertain.sort(bySize);
  possible.sort(bySize);

  return { nearCertain, possible };
}

/** Sort group members: most set history first, then oldest (likely canonical). */
function sortMembers(members: DedupExercise[]): DedupExercise[] {
  return [...members].sort((a, b) => {
    const logs = (b.setLogCount ?? 0) - (a.setLogCount ?? 0);
    if (logs !== 0) return logs;
    const at = a.createdAt ? Date.parse(a.createdAt) : Infinity;
    const bt = b.createdAt ? Date.parse(b.createdAt) : Infinity;
    return at - bt;
  });
}

function groupSetLogs(g: DedupGroup): number {
  return g.members.reduce((sum, m) => sum + (m.setLogCount ?? 0), 0);
}

/**
 * Suggest a survivor for a group: the member with the most set history, then
 * the oldest, preferring seed exercises on ties. This is only a hint for the
 * audit doc — the human still decides.
 */
export function suggestSurvivor(group: DedupGroup): DedupExercise {
  return [...group.members].sort((a, b) => {
    const logs = (b.setLogCount ?? 0) - (a.setLogCount ?? 0);
    if (logs !== 0) return logs;
    const seed = Number(b.source === 'seed') - Number(a.source === 'seed');
    if (seed !== 0) return seed;
    const at = a.createdAt ? Date.parse(a.createdAt) : Infinity;
    const bt = b.createdAt ? Date.parse(b.createdAt) : Infinity;
    return at - bt;
  })[0];
}
