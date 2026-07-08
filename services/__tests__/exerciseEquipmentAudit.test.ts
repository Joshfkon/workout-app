/**
 * Full exercise-DB equipment audit (CI guard).
 *
 * The equipment filter is fail-closed: an exercise with no equipment tags
 * (and no bodyweight flag), or with a tag that names no known equipment,
 * is EXCLUDED from every equipment-constrained generation path. This audit
 * parses supabase/seed.sql + supabase/migrations/*.sql and asserts every
 * seeded exercise carries classifiable equipment metadata — so a new
 * exercise added without tags fails CI instead of silently disappearing
 * from (or, pre-fix, leaking into) generated workouts.
 */

import * as path from 'path';
import {
  loadSeededExercises,
  effectiveEquipmentTags,
  type SeededExercise,
} from '../../scripts/exerciseEquipmentAudit';
import { resolveEquipmentRequirement, checkExerciseEquipment } from '../equipmentFilter';

const REPO_ROOT = path.join(__dirname, '..', '..');

describe('exercise equipment audit', () => {
  let exercises: SeededExercise[];

  beforeAll(() => {
    exercises = loadSeededExercises(REPO_ROOT);
  });

  it('parses a plausible exercise library', () => {
    expect(exercises.length).toBeGreaterThan(100);
  });

  it('every exercise has >= 1 equipment tag or is explicitly bodyweight', () => {
    const untagged = exercises.filter(
      (ex) =>
        effectiveEquipmentTags(ex).length === 0 &&
        !ex.isBodyweight &&
        !/bodyweight/i.test(ex.name)
    );
    expect(
      untagged.map((ex) => `${ex.name} (${ex.source})`)
    ).toEqual([]);
  });

  it('every equipment tag resolves to known equipment', () => {
    const unknown: string[] = [];
    for (const ex of exercises) {
      for (const tag of effectiveEquipmentTags(ex)) {
        if (!resolveEquipmentRequirement(tag).matched) {
          unknown.push(`${ex.name}: '${tag}' (${ex.source})`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('every exercise is classifiable by the fail-closed filter (never reason missing/unknown)', () => {
    // Against a non-empty blocklist the filter must reach an availability
    // verdict from real metadata — not exclude for unusable metadata.
    const unclassifiable: string[] = [];
    for (const ex of exercises) {
      const check = checkExerciseEquipment(
        { name: ex.name, equipment: effectiveEquipmentTags(ex), isBodyweight: ex.isBodyweight },
        ['barbell'] // any non-empty blocklist activates fail-closed checks
      );
      if (
        !check.available &&
        (check.reason === 'missing_equipment_tags' || check.reason === 'unknown_requirement')
      ) {
        unclassifiable.push(`${ex.name}: ${check.reason} (${ex.source})`);
      }
    }
    expect(unclassifiable).toEqual([]);
  });

  it('the Attic repro exercises are correctly classified after the taxonomy migration', () => {
    const byName = new Map(exercises.map((ex) => [ex.name.toLowerCase(), ex]));
    expect(effectiveEquipmentTags(byName.get('nordic curl')!)).toEqual(['nordic anchor']);
    // The library keeps at least one calf exercise performable without machines.
    const singleLegCalf = byName.get('single leg calf raise');
    expect(singleLegCalf?.isBodyweight).toBe(true);
  });
});
