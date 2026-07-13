/**
 * Muscle-chip coverage guard for the Exercise Library picker.
 *
 * The Library page (`app/(dashboard)/dashboard/exercises/page.tsx`) renders a
 * filter chip per legacy `MUSCLE_GROUPS` value and filters with
 * `muscleMatchesGroup(primary_muscle, chip)`. Historically several chips
 * ("Forearms", "Adductors") returned "No exercises found" because the seed
 * library had no exercise tagged with that muscle as its PRIMARY mover, and
 * the old exact-string filter also hid standard-token primaries ('lats',
 * 'rear_delts', ...) from their coarse legacy chip.
 *
 * This parses the real seed + migrations, reproduces the final primary-muscle
 * of every exercise (first-writer-wins across migrations then seed, plus the
 * reclassify UPDATEs), and asserts — through the SAME `muscleMatchesGroup`
 * the page uses — that every chip surfaces at least one exercise. A new muscle
 * group or a dropped-to-zero group fails CI here instead of shipping an empty
 * chip.
 */

import * as fs from 'fs';
import * as path from 'path';
import { muscleMatchesGroup, MUSCLE_GROUPS } from '@/types/schema';

const REPO_ROOT = process.cwd();

// db reset applies migrations in filename order, THEN seed.sql. Every insert
// path uses ON CONFLICT (name) DO NOTHING, so the first writer of a name wins.
const SOURCES_IN_APPLY_ORDER = [
  'supabase/migrations/20241209000003_additional_exercises.sql',
  'supabase/migrations/20241212000002_add_new_exercises.sql',
  'supabase/migrations/20260705000001_forearm_erector_oblique_exercises.sql',
  'supabase/migrations/20260708000002_equipment_taxonomy_fixes.sql',
  'supabase/migrations/20260710000001_adductor_glutemed_upperback_and_grip_exercises.sql',
  'supabase/seed.sql',
];

// primary_muscle UPDATEs that run after the inserts (kept in sync with the
// reclassify blocks in 20260710000001 and 20260713000001). Applied last, like
// the real migrations.
const RECLASSIFY: Record<string, string> = {
  'Hip Adduction Machine': 'adductors',
  'Hip Abduction Machine': 'glute_med',
  "Farmer's Carry": 'forearms',
  // 20260713000001 — fine traps/calves retag.
  'Dumbbell Shrug': 'upper_traps',
  'Barbell Shrug': 'upper_traps',
  'Seated Calf Raise': 'soleus',
  'Standing Calf Raise': 'gastrocnemius',
  'Smith Machine Calf Raise': 'gastrocnemius',
  'Donkey Calf Raise': 'gastrocnemius',
  'Single Leg Calf Raise': 'gastrocnemius',
  'Leg Press Calf Raise': 'gastrocnemius',
  'Calf Press Machine': 'gastrocnemius',
};

function buildFinalLibrary(): Map<string, string> {
  // Matches `('Name', 'primary_muscle', <secondary array>` at each row start.
  const rowRe = /\(\s*'((?:[^']|'')+)'\s*,\s*'([a-z_]+)'\s*,\s*(?:ARRAY\[[^\]]*\]|'\{[^}]*\}')/g;
  const primaryByName = new Map<string, string>();
  for (const rel of SOURCES_IN_APPLY_ORDER) {
    const raw = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    // Drop line comments so a "-- ... ON CONFLICT ..." note can't truncate parsing.
    const noComments = raw
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    const insertBody = noComments.split('ON CONFLICT')[0];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(insertBody)) !== null) {
      const name = m[1].replace(/''/g, "'");
      if (!primaryByName.has(name)) primaryByName.set(name, m[2]);
    }
  }
  for (const [name, muscle] of Object.entries(RECLASSIFY)) {
    if (primaryByName.has(name)) primaryByName.set(name, muscle);
  }
  return primaryByName;
}

describe('Exercise Library muscle-chip coverage', () => {
  const library = buildFinalLibrary();

  it('parses a plausible library', () => {
    expect(library.size).toBeGreaterThan(100);
  });

  it('every muscle-group chip surfaces >= 1 exercise', () => {
    const empty = MUSCLE_GROUPS.filter(
      (chip) => !Array.from(library.values()).some((primary) => muscleMatchesGroup(primary, chip))
    );
    expect(empty).toEqual([]);
  });

  it('standard-token primaries are reachable via their legacy chip', () => {
    const reach = (name: string, chip: string) =>
      muscleMatchesGroup(library.get(name)!, chip);
    // lats -> back, delts -> shoulders, chest split -> chest, glute_med -> glutes
    expect(library.has('Lat Pulldown')).toBe(true);
    expect(reach('Lat Pulldown', 'back')).toBe(true);
    expect(reach('Lateral Raise', 'shoulders')).toBe(true);
    expect(reach('Incline Dumbbell Press', 'chest')).toBe(true);
    expect(reach('Clamshell', 'glutes')).toBe(true); // glute_med primary
    expect(reach('Seal Row', 'back')).toBe(true); // upper_back primary
    // 20260713000001 fine retags roll up to their coarse chips.
    expect(reach('Barbell Shrug', 'traps')).toBe(true); // upper_traps primary
    expect(reach('Seated Calf Raise', 'calves')).toBe(true); // soleus primary
    expect(reach('Standing Calf Raise', 'calves')).toBe(true); // gastrocnemius primary
  });

  it('Forearms and Adductors chips are populated (the reported gaps)', () => {
    const under = (chip: string) =>
      Array.from(library.entries()).filter(([, p]) => muscleMatchesGroup(p, chip)).map(([n]) => n);
    const forearms = under('forearms');
    expect(forearms).toEqual(
      expect.arrayContaining(['Plate Pinch Hold', 'Dead Hang', 'Wrist Roller', "Farmer's Carry"])
    );
    expect(under('adductors')).toEqual(
      expect.arrayContaining(['Hip Adduction Machine', 'Copenhagen Plank'])
    );
  });
});
