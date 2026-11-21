/**
 * Hevy CSV import — parser + mapping.
 *
 * The header below is byte-for-byte what Hevy's "Export Workouts" writes
 * (confirmed against two independent real exports). Data rows are synthetic.
 */
import {
  parseHevyCSV,
  parseDelimited,
  parseHevyTimestamp,
  looksLikeHevyCSV,
  hevySetToSetLog,
  isDurationExercise,
  workoutDurationSeconds,
  resolveHevyExercises,
  equipmentAwareKey,
  hevyExerciseNames,
  filterAlreadyImported,
  HevyFormatError,
  KG_PER_LB,
  type ParsedHevySet,
} from '../hevyImport';

const HEADER =
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';

function row(cells: Array<string | number | null>): string {
  return cells.map((c) => (c === null ? '' : typeof c === 'number' ? String(c) : `"${c.replace(/"/g, '""')}"`)).join(',');
}

const PUSH = ['Push Day', '18 Nov 2026, 18:22', '18 Nov 2026, 19:42', 'Felt strong'];
const LEGS = ['Leg Day', '20 Nov 2026, 07:05', '20 Nov 2026, 08:15', ''];

const SAMPLE = [
  HEADER,
  row([...PUSH, 'Bench Press (Barbell)', null, 'Pause at bottom', 0, 'warmup', 40, 10, null, null, null]),
  row([...PUSH, 'Bench Press (Barbell)', null, 'Pause at bottom', 1, 'normal', 80, 8, null, null, 8]),
  row([...PUSH, 'Bench Press (Barbell)', null, 'Pause at bottom', 2, 'failure', 80, 6, null, null, null]),
  row([...PUSH, 'Bench Press (Barbell)', null, 'Pause at bottom', 3, 'dropset', 60, 10, null, null, 9.5]),
  row([...PUSH, 'Plank', null, '', 0, 'normal', null, null, null, 75, null]),
  row([...LEGS, 'Squat (Barbell)', null, '', 0, 'normal', 100, 5, null, null, 7]),
  row([...LEGS, 'Treadmill', null, '', 0, 'normal', null, null, 2.5, 900, null]),
].join('\n');

describe('header detection', () => {
  it('recognises a Hevy export header', () => {
    expect(looksLikeHevyCSV(SAMPLE)).toBe(true);
  });

  it('rejects a Strong export with a pointer to the Strong importer', () => {
    const strong = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n2024-01-01,A,Squat,1,100,5';
    expect(looksLikeHevyCSV(strong)).toBe(false);
    expect(() => parseHevyCSV(strong)).toThrow(/Strong export/);
  });

  it('rejects an unrelated CSV and an empty file', () => {
    expect(() => parseHevyCSV('a,b,c\n1,2,3')).toThrow(HevyFormatError);
    expect(() => parseHevyCSV('')).toThrow(HevyFormatError);
  });

  it('tolerates a BOM, CRLF line endings and unquoted headers', () => {
    const text = '﻿' + HEADER.replace(/"/g, '') + '\r\n' + row([...PUSH, 'Squat (Barbell)', null, '', 0, 'normal', 100, 5, null, null, null]) + '\r\n';
    const { workouts } = parseHevyCSV(text);
    expect(workouts).toHaveLength(1);
    expect(workouts[0].exercises[0].sets[0]).toMatchObject({ weightKg: 100, repCount: 5 });
  });

  it('reads a tab-separated export', () => {
    const tsv = [HEADER, row([...PUSH, 'Squat (Barbell)', null, '', 0, 'normal', 100, 5, null, null, null])]
      .map((l) => parseDelimited(l)[0].join('\t'))
      .join('\n');
    expect(parseHevyCSV(tsv).workouts[0].exercises[0].name).toBe('Squat (Barbell)');
  });
});

describe('CSV parsing', () => {
  it('keeps newlines, commas and escaped quotes inside quoted fields', () => {
    const rows = parseDelimited('a,b\n"line 1\nline 2","say ""hi"", ok"');
    expect(rows).toEqual([['a', 'b'], ['line 1\nline 2', 'say "hi", ok']]);
  });

  it('carries a multi-line workout description through', () => {
    const text = [HEADER, row(['Push', '18 Nov 2026, 18:22', '18 Nov 2026, 19:00', 'Line one\nLine two', 'Squat (Barbell)', null, '', 0, 'normal', 100, 5, null, null, null])].join('\n');
    expect(parseHevyCSV(text).workouts[0].description).toBe('Line one\nLine two');
  });
});

describe('timestamps', () => {
  it('parses the 24-hour day-month format as local wall-clock time', () => {
    const d = parseHevyTimestamp('18 Nov 2026, 18:22')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 18, 18, 22]);
  });

  it('parses the 12-hour month-day format', () => {
    const am = parseHevyTimestamp('Jan 5, 2026, 6:30 AM')!;
    expect([am.getMonth(), am.getDate(), am.getHours(), am.getMinutes()]).toEqual([0, 5, 6, 30]);
    expect(parseHevyTimestamp('Aug 31, 2026, 12:05 PM')!.getHours()).toBe(12);
    expect(parseHevyTimestamp('Aug 31, 2026, 12:05 AM')!.getHours()).toBe(0);
    expect(parseHevyTimestamp('Aug 31, 2026, 8:05 PM')!.getHours()).toBe(20);
  });

  it('parses ISO-like local and absolute timestamps', () => {
    expect(parseHevyTimestamp('2026-02-10 10:00:00')!.getHours()).toBe(10);
    expect(parseHevyTimestamp('2026-02-10T10:00:00Z')!.toISOString()).toBe('2026-02-10T10:00:00.000Z');
  });

  it('rejects garbage and impossible dates', () => {
    expect(parseHevyTimestamp('yesterday')).toBeNull();
    expect(parseHevyTimestamp('31 Feb 2026, 10:00')).toBeNull();
    expect(parseHevyTimestamp('18 Foo 2026, 10:00')).toBeNull();
    expect(parseHevyTimestamp('18 Nov 2026, 25:00')).toBeNull();
  });
});

describe('multi-workout files', () => {
  const { workouts, errors, badRowCount } = parseHevyCSV(SAMPLE);

  it('groups rows into workouts by title + start time, oldest first', () => {
    expect(errors).toEqual([]);
    expect(badRowCount).toBe(0);
    expect(workouts.map((w) => w.title)).toEqual(['Push Day', 'Leg Day']);
    expect(workouts[0].exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Plank']);
    expect(workouts[1].exercises.map((e) => e.name)).toEqual(['Squat (Barbell)', 'Treadmill']);
  });

  it('keeps start/end times, duration, description and exercise notes', () => {
    const push = workouts[0];
    expect(new Date(push.startedAt).getHours()).toBe(18);
    expect(workoutDurationSeconds(push)).toBe(80 * 60);
    expect(push.description).toBe('Felt strong');
    expect(push.exercises[0].notes).toBe('Pause at bottom');
    expect(workouts[1].description).toBeUndefined();
  });

  it('splits two same-titled workouts with different start times', () => {
    const text = [
      HEADER,
      row(['Push', '1 Nov 2026, 10:00', '1 Nov 2026, 11:00', '', 'Squat (Barbell)', null, '', 0, 'normal', 100, 5, null, null, null]),
      row(['Push', '3 Nov 2026, 10:00', '3 Nov 2026, 11:00', '', 'Squat (Barbell)', null, '', 0, 'normal', 102.5, 5, null, null, null]),
    ].join('\n');
    expect(parseHevyCSV(text).workouts).toHaveLength(2);
  });

  it('orders sets by set_index even when rows are shuffled', () => {
    const text = [
      HEADER,
      row([...PUSH, 'Squat (Barbell)', null, '', 1, 'normal', 100, 5, null, null, null]),
      row([...PUSH, 'Squat (Barbell)', null, '', 0, 'warmup', 60, 5, null, null, null]),
    ].join('\n');
    const sets = parseHevyCSV(text).workouts[0].exercises[0].sets;
    expect(sets.map((s) => s.setType)).toEqual(['warmup', 'normal']);
  });

  it('ignores an end time earlier than the start', () => {
    const text = [HEADER, row(['A', '1 Nov 2026, 10:00', '1 Nov 2026, 09:00', '', 'Squat (Barbell)', null, '', 0, 'normal', 100, 5, null, null, null])].join('\n');
    expect(parseHevyCSV(text).workouts[0].endedAt).toBeUndefined();
  });
});

describe('set types and RPE', () => {
  const sets = parseHevyCSV(SAMPLE).workouts[0].exercises[0].sets;

  it('reads all four Hevy set types', () => {
    expect(sets.map((s) => s.setType)).toEqual(['warmup', 'normal', 'failure', 'dropset']);
  });

  it('keeps RPE only where present and in range', () => {
    expect(sets.map((s) => s.rpe)).toEqual([undefined, 8, undefined, 9.5]);
  });

  it('maps set types onto set_logs', () => {
    const logs = sets.map(hevySetToSetLog);
    expect(logs[0]).toMatchObject({ set_type: 'warmup', is_warmup: true, rpe: 7 });
    expect(logs[1]).toMatchObject({ set_type: 'normal', is_warmup: false, rpe: 8, weight_kg: 80, reps: 8 });
    // HyperTrack has no "failure" type: normal set at RPE 10 (0 RIR).
    expect(logs[2]).toMatchObject({ set_type: 'normal', rpe: 10 });
    expect(logs[3]).toMatchObject({ set_type: 'dropset', rpe: 9.5 });
  });

  it('keeps an explicit RPE on a failure set', () => {
    const s: ParsedHevySet = { setType: 'failure', weightKg: 50, repCount: 10, rpe: 9 };
    expect(hevySetToSetLog(s)!.rpe).toBe(9);
  });
});

describe('units', () => {
  it('stores kg exports as-is', () => {
    const r = parseHevyCSV(SAMPLE);
    expect(r.sourceWeightUnit).toBe('kg');
    expect(r.workouts[1].exercises[0].sets[0].weightKg).toBe(100);
  });

  it('converts a pound-labelled weight column and mile distances', () => {
    const text = [
      HEADER.replace('weight_kg', 'weight_lbs').replace('distance_km', 'distance_miles'),
      row([...PUSH, 'Squat (Barbell)', null, '', 0, 'normal', 225, 5, null, null, null]),
      row([...PUSH, 'Treadmill', null, '', 0, 'normal', null, null, 1, 600, null]),
    ].join('\n');
    const r = parseHevyCSV(text);
    expect(r.sourceWeightUnit).toBe('lb');
    expect(r.workouts[0].exercises[0].sets[0].weightKg).toBeCloseTo(225 * KG_PER_LB, 1);
    expect(r.workouts[0].exercises[0].sets[0].weightKg).toBeCloseTo(102.06, 2);
    expect(r.workouts[0].exercises[1].sets[0].distanceM).toBeCloseTo(1609.34, 1);
  });

  it('converts km distances to metres', () => {
    const treadmill = parseHevyCSV(SAMPLE).workouts[1].exercises[1].sets[0];
    expect(treadmill.distanceM).toBe(2500);
  });
});

describe('duration and distance sets', () => {
  const [push, legs] = parseHevyCSV(SAMPLE).workouts;

  it('stores a duration-only set as seconds in reps', () => {
    const plank = push.exercises[1];
    expect(isDurationExercise(plank)).toBe(true);
    expect(hevySetToSetLog(plank.sets[0])).toMatchObject({ reps: 75, weight_kg: 0, note: null });
  });

  it('keeps distance in the note for timed cardio', () => {
    const log = hevySetToSetLog(legs.exercises[1].sets[0])!;
    expect(log.reps).toBe(600); // 900 s capped at the 600 s reps bound
    expect(log.note).toBe('Distance: 2.5 km · Time: 900s');
  });

  it('notes time on a weighted carry that also has reps', () => {
    const s: ParsedHevySet = { setType: 'normal', weightKg: 40, repCount: 1, durationSeconds: 45, distanceM: 30 };
    expect(hevySetToSetLog(s)).toMatchObject({ reps: 1, note: 'Distance: 30 m · Time: 45s' });
  });

  it('drops sets with nothing storable', () => {
    expect(hevySetToSetLog({ setType: 'normal', weightKg: 0, repCount: 0 })).toBeNull();
    expect(hevySetToSetLog({ setType: 'normal', weightKg: 0, repCount: 0, distanceM: 5000 })).toBeNull();
  });

  it('does not treat a rep-based lift as a duration exercise', () => {
    expect(isDurationExercise(push.exercises[0])).toBe(false);
  });
});

describe('bad rows', () => {
  it('skips and reports bad rows without failing the file', () => {
    const text = [
      HEADER,
      row([...PUSH, 'Squat (Barbell)', null, '', 0, 'normal', 100, 5, null, null, null]),
      row(['Push Day', '', '', '', 'Squat (Barbell)', null, '', 1, 'normal', 100, 5, null, null, null]),
      row(['Push Day', 'not a date', '', '', 'Squat (Barbell)', null, '', 1, 'normal', 100, 5, null, null, null]),
      row([...PUSH, '', null, '', 1, 'normal', 100, 5, null, null, null]),
      row([...PUSH, 'Squat (Barbell)', null, '', 1, 'superset??', 100, 5, null, null, null]),
      row([...PUSH, 'Squat (Barbell)', null, '', 1, 'normal', -5, 5, null, null, null]),
      'garbage',
    ].join('\n');
    const r = parseHevyCSV(text);
    expect(r.workouts).toHaveLength(1);
    expect(r.workouts[0].exercises[0].sets).toHaveLength(1);
    expect(r.badRowCount).toBe(6);
    expect(r.errors[0]).toMatch(/^Row 3: missing/);
    expect(r.errors.some((e) => e.includes('unreadable start_time "not a date"'))).toBe(true);
    expect(r.errors.some((e) => e.includes('unknown set_type'))).toBe(true);
    expect(r.errors.some((e) => e.includes('negative'))).toBe(true);
  });

  it('treats non-numeric cells as empty and drops out-of-range RPE', () => {
    const text = [HEADER, row([...PUSH, 'Squat (Barbell)', null, '', 0, 'normal', 'abc', 5, null, null, 42])].join('\n');
    const s = parseHevyCSV(text).workouts[0].exercises[0].sets[0];
    expect(s.weightKg).toBe(0);
    expect(s.rpe).toBeUndefined();
  });

  it('caps the reported error list but counts every bad row', () => {
    const bad = Array.from({ length: 30 }, () => row(['X', 'nope', '', '', 'Squat', null, '', 0, 'normal', 1, 1, null, null, null]));
    const r = parseHevyCSV([HEADER, ...bad].join('\n'));
    expect(r.badRowCount).toBe(30);
    expect(r.errors).toHaveLength(20);
  });
});

describe('exercise matching', () => {
  const library = [
    { id: 'bb-bench', name: 'Barbell Bench Press' },
    { id: 'db-bench', name: 'Dumbbell Bench Press' },
    { id: 'squat', name: 'Barbell Back Squat' },
    { id: 'plank', name: 'Plank' },
    { id: 'lat', name: 'Lat Pulldown' },
  ];

  it('matches exact names case-insensitively (the Strong rule)', () => {
    const [r] = resolveHevyExercises(['plank'], library);
    expect(r.exerciseId).toBe('plank');
  });

  it('matches Hevy "Name (Equipment)" to "Equipment Name"', () => {
    const [bb, db] = resolveHevyExercises(['Bench Press (Barbell)', 'Bench Press (Dumbbell)'], library);
    expect(bb.exerciseId).toBe('bb-bench');
    expect(db.exerciseId).toBe('db-bench');
  });

  it('keeps equipment distinct in the key', () => {
    expect(equipmentAwareKey('Bench Press (Barbell)')).toBe(equipmentAwareKey('Barbell Bench Press'));
    expect(equipmentAwareKey('Bench Press (Barbell)')).not.toBe(equipmentAwareKey('Bench Press (Smith Machine)'));
  });

  it('leaves unknown names unmatched with suggestions for the user', () => {
    const [squat, unknown] = resolveHevyExercises(['Squat (Barbell)', 'Zercher Carry'], library);
    expect(squat.exerciseId).toBeNull();
    expect(squat.suggestions.map((s) => s.id)).toContain('squat');
    expect(unknown.exerciseId).toBeNull();
  });

  it('lists each exercise name once', () => {
    const { workouts } = parseHevyCSV(SAMPLE);
    expect(hevyExerciseNames(workouts)).toEqual(['Bench Press (Barbell)', 'Plank', 'Squat (Barbell)', 'Treadmill']);
    expect(resolveHevyExercises(['Plank', 'Plank '], library)).toHaveLength(1);
  });
});

describe('re-import dedupe', () => {
  const { workouts } = parseHevyCSV(SAMPLE);

  it('skips workouts whose start time is already in history', () => {
    // Supabase returns timestamptz with an offset, not Z.
    const existing = [workouts[0].startedAt.replace('.000Z', '+00:00'), null];
    const { fresh, duplicates } = filterAlreadyImported(workouts, existing);
    expect(duplicates).toBe(1);
    expect(fresh.map((w) => w.title)).toEqual(['Leg Day']);
  });

  it('a second import of the same file imports nothing', () => {
    const { fresh, duplicates } = filterAlreadyImported(workouts, workouts.map((w) => w.startedAt));
    expect(fresh).toEqual([]);
    expect(duplicates).toBe(2);
  });

  it('imports everything into an empty history', () => {
    expect(filterAlreadyImported(workouts, []).fresh).toHaveLength(2);
  });
});
