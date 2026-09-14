/**
 * Exhaustiveness guard for stabilizer classification (the structural fix from
 * docs/STABILIZER_COVERAGE_AUDIT.md §F5).
 *
 * The stabilizer-recovery channel is gated entirely on `stabilizers` tags, so
 * an exercise nobody classified is silently invisible to it — no pre-set
 * warning, no dose credit — and "no tags by omission" looks identical to "no
 * tags by decision". This test makes the omission state unrepresentable for
 * the STOCK library: every stock exercise must live in exactly ONE of
 *
 *   1. STABILIZERS_BY_EXERCISE_NAME  (tagged),
 *   2. NO_STABILIZERS_BY_DECISION    (decided: no tags, reason in the audit),
 *   3. UNSEEDED_STABILIZER_EXERCISES (open question recorded for Josh).
 *
 * Adding a stock exercise without classifying it fails here. Custom
 * exercises are out of scope by design — they are covered at creation (AI
 * completion / variation inheritance) and by the name-matching backfill
 * migrations (see stabilizerCustomBackfill.test.ts).
 */

import {
  STABILIZERS_BY_EXERCISE_NAME,
  NO_STABILIZERS_BY_DECISION,
  UNSEEDED_STABILIZER_EXERCISES,
} from '@/services/shared/stabilizerTags';
import { SEED_EXERCISE_TAGS } from '@/services/generated/seedExerciseTags';

describe('stabilizer classification coverage (stock library)', () => {
  const tagged = Object.keys(STABILIZERS_BY_EXERCISE_NAME);
  const decidedNo = [...NO_STABILIZERS_BY_DECISION];
  const unseeded = UNSEEDED_STABILIZER_EXERCISES.map((e) => e.name);
  const stock = Object.keys(SEED_EXERCISE_TAGS);

  it('every stock exercise is classified into exactly one bucket', () => {
    const buckets = new Map<string, string[]>();
    const record = (name: string, bucket: string) => {
      buckets.set(name, [...(buckets.get(name) ?? []), bucket]);
    };
    tagged.forEach((n) => record(n, 'tagged'));
    decidedNo.forEach((n) => record(n, 'no-by-decision'));
    unseeded.forEach((n) => record(n, 'unseeded'));

    const unclassified = stock.filter((n) => !buckets.has(n));
    const multiClassified = stock
      .filter((n) => (buckets.get(n) ?? []).length > 1)
      .map((n) => ({ name: n, buckets: buckets.get(n) }));

    // A name listed here means someone added a stock exercise without
    // deciding its stabilizer classification — decide it (tag it, record it
    // as no-by-decision, or file the open question), don't widen a list
    // blindly to silence the test.
    expect(unclassified).toEqual([]);
    expect(multiClassified).toEqual([]);
  });

  it('classification lists contain only real stock exercises (no rot)', () => {
    const stockSet = new Set(stock);
    const ghosts = [...tagged, ...decidedNo, ...unseeded].filter((n) => !stockSet.has(n));
    expect(ghosts).toEqual([]);
  });

  it('no list contains duplicates', () => {
    for (const [label, list] of [
      ['tagged', tagged],
      ['no-by-decision', decidedNo],
      ['unseeded', unseeded],
    ] as const) {
      expect({ label, size: new Set(list).size }).toEqual({ label, size: list.length });
    }
  });
});
