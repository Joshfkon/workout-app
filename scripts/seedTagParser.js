/**
 * Seed muscle-tag parser — the SINGLE derivation of canonical exercise muscle
 * tags from the SQL corpus (supabase/migrations chronologically, then
 * supabase/seed.sql as the fresh-database final word).
 *
 * Used by BOTH scripts/generate-seed-exercise-tags.js (writes the checked-in
 * generated module the static fallback DB applies) and the drift test
 * (services/__tests__/seedExerciseTags.test.ts) — so the generated copy can
 * never silently diverge from a fresh parse, and the next seed migration
 * fails a test instead of quietly re-splitting exercise credit (the
 * shoulders-audit bug class).
 *
 * Deliberately NOT a SQL engine: it understands exactly the statement shapes
 * this repo's seed/migrations use —
 *   INSERT INTO exercises (col, ...) VALUES (tuple), (tuple), ... ;
 *   UPDATE exercises SET primary_muscle = '…' [, secondary_muscles = …]
 *     WHERE name = '…' | name IN ('…', …) [AND …];
 * with array values as ARRAY['a','b'], ARRAY[]::TEXT[], '{a,b}' or '{}'.
 * Plain CommonJS so the node generation script and jest both load it as-is.
 */

'use strict';

/** Strip -- comments (quote-aware; '' escapes respected). */
function stripComments(sql) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      out += c;
      if (c === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/** Split into statements on ';' outside string literals. */
function splitStatements(sql) {
  const statements = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (sql[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === ';') {
      if (cur.trim()) statements.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) statements.push(cur.trim());
  return statements;
}

/** Parse a SQL string literal starting at s[i] === "'" → [value, indexAfter]. */
function readString(s, i) {
  if (s[i] !== "'") throw new Error(`expected string at ${i}: ${s.slice(i, i + 30)}`);
  let out = '';
  i++;
  for (; i < s.length; i++) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i++;
      } else {
        return [out, i + 1];
      }
    } else {
      out += s[i];
    }
  }
  throw new Error('unterminated string literal');
}

/** Split a tuple/list body into top-level comma-separated value tokens. */
function splitTopLevel(body) {
  const tokens = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (body[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      tokens.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) tokens.push(cur.trim());
  return tokens;
}

/** Parse an array-valued token: ARRAY['a','b'] | ARRAY[]::TEXT[] | '{a,b}' | '{}'. */
function parseArrayToken(token) {
  const t = token.trim();
  const arrayMatch = /^ARRAY\[([\s\S]*?)\](?:::TEXT\[\])?$/i.exec(t);
  if (arrayMatch) {
    const inner = arrayMatch[1].trim();
    if (inner === '') return [];
    return splitTopLevel(inner).map((el) => readString(el.trim(), 0)[0]);
  }
  if (t.startsWith("'")) {
    const [value] = readString(t, 0);
    const inner = value.replace(/^\{/, '').replace(/\}$/, '').trim();
    if (inner === '') return [];
    return inner.split(',').map((el) => el.trim().replace(/^"|"$/g, ''));
  }
  throw new Error(`unrecognized array token: ${t.slice(0, 40)}`);
}

/** Extract top-level parenthesized tuples from an INSERT's VALUES section. */
function readTuples(valuesSection) {
  const tuples = [];
  let depth = 0;
  let inStr = false;
  let start = -1;
  for (let i = 0; i < valuesSection.length; i++) {
    const c = valuesSection[i];
    if (inStr) {
      if (c === "'") {
        if (valuesSection[i + 1] === "'") i++;
        else inStr = false;
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      continue;
    }
    if (c === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) tuples.push(valuesSection.slice(start, i));
    }
  }
  return tuples;
}

const INSERT_RE = /^INSERT\s+INTO\s+exercises\s*\(([\s\S]*?)\)\s*VALUES([\s\S]*)$/i;
const UPDATE_RE = /^UPDATE\s+exercises\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*)$/i;

/**
 * Parse one SQL source. `apply(name, {primary?, secondaries?})` receives every
 * tag fact in statement order. Returns per-file stats for diagnostics.
 */
function parseSql(sql, apply) {
  const stats = { inserts: 0, updates: 0, skippedStatements: 0 };
  for (const statement of splitStatements(stripComments(sql))) {
    const insert = INSERT_RE.exec(statement);
    if (insert) {
      const cols = insert[1].split(',').map((c) => c.trim().toLowerCase());
      const nameIdx = cols.indexOf('name');
      const primaryIdx = cols.indexOf('primary_muscle');
      const secondaryIdx = cols.indexOf('secondary_muscles');
      if (nameIdx === -1 || primaryIdx === -1) continue;
      // Trailing clauses (ON CONFLICT (name) …, RETURNING …) would otherwise
      // read as value tuples.
      const clauseIdx = insert[2].search(/\b(ON\s+CONFLICT|RETURNING)\b/i);
      const valuesSection = clauseIdx === -1 ? insert[2] : insert[2].slice(0, clauseIdx);
      for (const tuple of readTuples(valuesSection)) {
        const values = splitTopLevel(tuple);
        if (values.length !== cols.length) {
          throw new Error(
            `INSERT tuple arity ${values.length} != ${cols.length} columns near: ${tuple.slice(0, 60)}`
          );
        }
        const name = readString(values[nameIdx].trim(), 0)[0];
        const primary = readString(values[primaryIdx].trim(), 0)[0];
        const secondaries =
          secondaryIdx !== -1 ? parseArrayToken(values[secondaryIdx]) : [];
        apply(name, { primary, secondaries });
        stats.inserts++;
      }
      continue;
    }

    const update = UPDATE_RE.exec(statement);
    if (update) {
      const setPart = update[1];
      const wherePart = update[2];
      const patch = {};
      const primaryMatch = /primary_muscle\s*=\s*('(?:[^']|'')*')/i.exec(setPart);
      if (primaryMatch) patch.primary = readString(primaryMatch[1], 0)[0];
      const secondaryMatch =
        /secondary_muscles\s*=\s*(ARRAY\[[\s\S]*?\](?:::TEXT\[\])?|'\{[^}]*\}')/i.exec(setPart);
      if (secondaryMatch) patch.secondaries = parseArrayToken(secondaryMatch[1]);
      if (patch.primary === undefined && patch.secondaries === undefined) {
        stats.skippedStatements++;
        continue;
      }

      const names = [];
      const eqMatch = /\bname\s*=\s*('(?:[^']|'')*')/i.exec(wherePart);
      const inOpen = /\bname\s+IN\s*\(/i.exec(wherePart);
      if (eqMatch) {
        names.push(readString(eqMatch[1], 0)[0]);
      } else if (inOpen) {
        // Quote-aware scan to the MATCHING close paren — names themselves can
        // contain parens ('Dips (Chest Focus)'), which defeats a lazy regex.
        const start = inOpen.index + inOpen[0].length;
        let depth = 1;
        let inStr = false;
        let end = -1;
        for (let i = start; i < wherePart.length; i++) {
          const c = wherePart[i];
          if (inStr) {
            if (c === "'") {
              if (wherePart[i + 1] === "'") i++;
              else inStr = false;
            }
            continue;
          }
          if (c === "'") inStr = true;
          else if (c === '(') depth++;
          else if (c === ')') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end === -1) throw new Error(`unbalanced IN list: ${statement.slice(0, 80)}`);
        for (const tok of splitTopLevel(wherePart.slice(start, end)))
          names.push(readString(tok.trim(), 0)[0]);
      } else {
        throw new Error(`UPDATE exercises without a name filter: ${statement.slice(0, 80)}`);
      }

      for (const name of names) apply(name, patch);
      stats.updates++;
      continue;
    }

    stats.skippedStatements++;
  }
  return stats;
}

/**
 * Derive canonical tags from an ordered SQL corpus:
 * `files` = [{ name, sql }] with migrations FIRST (chronological by filename)
 * and seed.sql LAST — the seed carries the fresh-database final values and
 * the migrations' own comments document that they converge on it.
 * Returns { tags: { [exerciseName]: { primary, secondaries } }, stats }.
 */
function deriveSeedExerciseTags(files) {
  const tags = new Map();
  const stats = [];
  for (const file of files) {
    const fileStats = parseSql(file.sql, (name, patch) => {
      const existing = tags.get(name) ?? { primary: null, secondaries: [] };
      tags.set(name, {
        primary: patch.primary !== undefined ? patch.primary : existing.primary,
        secondaries:
          patch.secondaries !== undefined ? patch.secondaries : existing.secondaries,
      });
    });
    stats.push({ file: file.name, ...fileStats });
  }
  const out = {};
  for (const name of Array.from(tags.keys()).sort()) {
    const t = tags.get(name);
    if (t.primary === null) continue; // UPDATE against a name never inserted
    out[name] = { primary: t.primary, secondaries: t.secondaries };
  }
  return { tags: out, stats };
}

module.exports = { deriveSeedExerciseTags, parseSql, parseArrayToken, stripComments };
