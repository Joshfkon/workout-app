/**
 * Exercise equipment taxonomy audit.
 *
 * Parses every `INSERT INTO exercises` across supabase/seed.sql and
 * supabase/migrations/*.sql (plus literal-name UPDATEs that set
 * equipment_required / is_bodyweight) and reconstructs each exercise's
 * effective equipment metadata. Used by the CI audit test
 * (services/__tests__/exerciseEquipmentAudit.test.ts) to guarantee the
 * fail-closed equipment filter can classify every seeded exercise — new
 * exercises without equipment tags fail CI instead of silently reappearing
 * in workouts they don't belong in.
 *
 * The effective-tag rules mirror the runtime fallback introduced in
 * 20260708000002_equipment_taxonomy_fixes.sql:
 *   - equipment_required non-empty → those tags
 *   - else the scalar `equipment` column (copied into equipment_required
 *     by the migration's catch-all)
 *   - else is_bodyweight / a bodyweight-declaring name
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SeededExercise {
  name: string;
  /** Effective equipment_required after inserts + literal-name updates. */
  equipmentRequired: string[];
  /** Scalar `equipment` column when present in the insert. */
  equipment: string | null;
  isBodyweight: boolean;
  /** File the exercise was first inserted from. */
  source: string;
}

// ------------------------------------------------------------------
// SQL value scanning
// ------------------------------------------------------------------

/** Split the body of a VALUES clause into tuple strings (top-level parens). */
function splitTuples(valuesBody: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = 0; i < valuesBody.length; i++) {
    const ch = valuesBody[i];
    if (inString) {
      if (ch === "'") {
        if (valuesBody[i + 1] === "'") i++; // escaped quote
        else inString = false;
      }
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesBody.slice(start, i));
        start = -1;
      }
    }
  }
  return tuples;
}

/** Split one tuple into top-level comma-separated raw values. */
function splitValues(tuple: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          current += "'";
          i++;
        } else inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) values.push(current.trim());
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** Parse a SQL text-array literal: ARRAY['a','b'], ARRAY[]::TEXT[], '{a,b}'. */
export function parseTextArray(raw: string): string[] | null {
  const value = raw.trim().replace(/::TEXT\[\]$/i, '').trim();
  const arrayMatch = value.match(/^ARRAY\s*\[([\s\S]*)\]$/i);
  if (arrayMatch) {
    const body = arrayMatch[1].trim();
    if (!body) return [];
    return splitValues(body).map(unquote);
  }
  const braceMatch = value.match(/^'\{([\s\S]*)\}'(?:::TEXT\[\])?$/);
  if (braceMatch) {
    const body = braceMatch[1].trim();
    if (!body) return [];
    return body.split(',').map((item) => unquote(item.trim()).replace(/^"|"$/g, ''));
  }
  if (/^NULL$/i.test(value)) return null;
  return null;
}

// ------------------------------------------------------------------
// Statement extraction
// ------------------------------------------------------------------

/** Strip SQL comments (-- to end of line) outside string literals. */
function stripComments(sql: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'" && sql[i + 1] !== "'") inString = false;
      else if (ch === "'" && sql[i + 1] === "'") {
        out += "'";
        i++;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Split a SQL file into statements on top-level semicolons. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let inString = false;
  let current = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'";
          i++;
        } else inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

interface ParsedInsert {
  columns: string[];
  tuples: string[][];
}

function parseExerciseInsert(statement: string): ParsedInsert | null {
  const match = statement.match(
    /INSERT\s+INTO\s+(?:public\.)?exercises\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*)$/i
  );
  if (!match) return null;
  const columns = match[1].split(',').map((c) => c.trim().toLowerCase());
  let valuesBody = match[2];
  // Trim trailing ON CONFLICT / RETURNING clauses.
  valuesBody = valuesBody.replace(/ON\s+CONFLICT[\s\S]*$/i, '').replace(/RETURNING[\s\S]*$/i, '');
  const tuples = splitTuples(valuesBody).map(splitValues);
  return { columns, tuples };
}

interface ParsedUpdate {
  /** Literal exercise names targeted via name = / name IN (lowercased). */
  names: string[] | null;
  equipmentRequired?: string[] | null;
  isBodyweight?: boolean;
}

/**
 * Parse UPDATE exercises ... statements that set equipment_required or
 * is_bodyweight and target exercises BY LITERAL NAME (name = 'X', name IN
 * (...), LOWER(name) variants). Pattern-based updates (LIKE) return
 * names: null and are ignored by the audit — inserts must stand on their
 * own or be fixed by a literal-name migration.
 */
function parseExerciseUpdate(statement: string): ParsedUpdate | null {
  if (!/UPDATE\s+(?:public\.)?exercises\s+SET/i.test(statement)) return null;
  const setMatch = statement.match(/SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*)$/i);
  if (!setMatch) return null;
  const [, setClause, whereClause] = setMatch;

  const update: ParsedUpdate = { names: null };

  const eqMatch = setClause.match(/equipment_required\s*=\s*(ARRAY\s*\[[^\]]*\](?:::TEXT\[\])?|'\{[^}]*\}'(?:::TEXT\[\])?)/i);
  if (eqMatch) update.equipmentRequired = parseTextArray(eqMatch[1]);

  const bwMatch = setClause.match(/is_bodyweight\s*=\s*(true|false)/i);
  if (bwMatch) update.isBodyweight = bwMatch[1].toLowerCase() === 'true';

  if (update.equipmentRequired === undefined && update.isBodyweight === undefined) return null;

  if (/LIKE/i.test(whereClause)) return update; // pattern-based → unresolvable

  const inMatch = whereClause.match(/(?:LOWER\s*\(\s*name\s*\)|name)\s+IN\s*\(([\s\S]*?)\)/i);
  if (inMatch) {
    update.names = splitValues(inMatch[1]).map((v) => unquote(v).toLowerCase());
    return update;
  }
  const eqNameMatch = whereClause.match(/(?:LOWER\s*\(\s*name\s*\)|name)\s*=\s*('(?:[^']|'')*')/i);
  if (eqNameMatch) {
    update.names = [unquote(eqNameMatch[1]).toLowerCase()];
    return update;
  }
  return update; // equipment update with unparseable target → ignored
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Reconstruct the seeded exercise library (migrations in filename order,
 * then seed.sql; first insert wins on name conflicts, literal-name updates
 * applied in order).
 */
export function loadSeededExercises(repoRoot: string): SeededExercise[] {
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(migrationsDir, f));
  files.push(path.join(repoRoot, 'supabase', 'seed.sql'));

  const byName = new Map<string, SeededExercise>();

  for (const file of files) {
    const sql = stripComments(fs.readFileSync(file, 'utf8'));
    for (const statement of splitStatements(sql)) {
      const insert = parseExerciseInsert(statement);
      if (insert) {
        const nameIdx = insert.columns.indexOf('name');
        const eqReqIdx = insert.columns.indexOf('equipment_required');
        const eqIdx = insert.columns.indexOf('equipment');
        const bwIdx = insert.columns.indexOf('is_bodyweight');
        if (nameIdx === -1) continue;
        for (const tuple of insert.tuples) {
          if (tuple.length !== insert.columns.length) {
            throw new Error(
              `Tuple/column mismatch in ${path.basename(file)}: expected ${insert.columns.length} values, got ${tuple.length} — ${tuple[nameIdx] ?? tuple[0]}`
            );
          }
          const name = unquote(tuple[nameIdx]);
          const key = name.toLowerCase();
          if (byName.has(key)) continue; // ON CONFLICT (name) DO NOTHING semantics
          byName.set(key, {
            name,
            equipmentRequired: (eqReqIdx >= 0 ? parseTextArray(tuple[eqReqIdx]) : null) ?? [],
            equipment: eqIdx >= 0 ? (/^NULL$/i.test(tuple[eqIdx].trim()) ? null : unquote(tuple[eqIdx])) : null,
            isBodyweight: bwIdx >= 0 ? /true/i.test(tuple[bwIdx]) : false,
            source: path.basename(file),
          });
        }
        continue;
      }

      const update = parseExerciseUpdate(statement);
      if (update?.names) {
        for (const name of update.names) {
          const existing = byName.get(name);
          if (!existing) continue;
          if (update.equipmentRequired !== undefined && update.equipmentRequired !== null) {
            existing.equipmentRequired = update.equipmentRequired;
          }
          if (update.isBodyweight !== undefined) existing.isBodyweight = update.isBodyweight;
        }
      }
    }
  }

  return Array.from(byName.values());
}

/**
 * The tags the runtime filter will actually see for a seeded exercise,
 * mirroring the 20260708000002 catch-all (scalar `equipment` column is
 * copied into equipment_required when the array is empty).
 */
export function effectiveEquipmentTags(exercise: SeededExercise): string[] {
  if (exercise.equipmentRequired.length > 0) return exercise.equipmentRequired;
  if (exercise.equipment) return [exercise.equipment];
  return [];
}
