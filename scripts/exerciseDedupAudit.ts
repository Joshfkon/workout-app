/**
 * Exercise Duplicate Audit (REPORT ONLY — never mutates data)
 *
 * Produces a grouped Markdown report of likely-duplicate exercises across seed
 * and custom exercises, with set-log history counts and routine/mesocycle
 * references, so a human can decide which groups to merge (see
 * scripts/mergeExercises.ts). This script writes docs/EXERCISE_DEDUP_AUDIT.md
 * and changes nothing in the database.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *     npx tsx scripts/exerciseDedupAudit.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadEnv } from './_env';
import {
  groupDuplicates,
  suggestSurvivor,
  type DedupExercise,
  type DedupGroup,
} from '../services/exerciseDedup';

loadEnv();

type Row = Record<string, any>;

async function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.'
    );
  }
  // Masked diagnostic so truncation/wrong-key-type is visible without leaking
  // the secret. A valid secret key starts with `sb_secret_` or `eyJ` and is long.
  const prefix = key.slice(0, 10);
  console.error(
    `[creds] url=${url} | key prefix="${prefix}…" length=${key.length}`
  );
  if (!key.startsWith('sb_secret_') && !key.startsWith('eyJ')) {
    console.error(
      '[creds] WARNING: key does not look like a service/secret key (expected sb_secret_… or eyJ…). ' +
        'You may have pasted the publishable key or the JWT signing secret.'
    );
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Page through a table 1000 rows at a time (PostgREST's default cap). */
async function fetchAll(supabase: any, table: string, columns: string): Promise<Row[]> {
  const pageSize = 1000;
  let from = 0;
  const out: Row[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  const supabase = await getClient();

  // --- Exercises. Exclude already-merged (soft-deleted) rows if the column
  // exists; fall back gracefully when the migration hasn't been applied. ---
  let exercisesRaw: Row[];
  try {
    exercisesRaw = await fetchAll(
      supabase,
      'exercises',
      'id, name, primary_muscle, is_custom, created_at, created_by, hypertrophy_tier, equipment, equipment_required, bodyweight_type, deleted_at'
    );
    exercisesRaw = exercisesRaw.filter((e) => !e.deleted_at);
  } catch {
    exercisesRaw = await fetchAll(
      supabase,
      'exercises',
      'id, name, primary_muscle, is_custom, created_at, created_by, hypertrophy_tier, equipment, equipment_required, bodyweight_type'
    );
  }

  // --- Set-log history via exercise_blocks -> set_logs --------------------
  const blocks = await fetchAll(supabase, 'exercise_blocks', 'id, exercise_id');
  const blockToExercise = new Map<string, string>();
  for (const b of blocks) blockToExercise.set(b.id, b.exercise_id);

  const setLogs = await fetchAll(supabase, 'set_logs', 'exercise_block_id, logged_at');
  const logCount = new Map<string, number>();
  const lastLogged = new Map<string, string>();
  for (const s of setLogs) {
    const exId = blockToExercise.get(s.exercise_block_id);
    if (!exId) continue;
    logCount.set(exId, (logCount.get(exId) ?? 0) + 1);
    const prev = lastLogged.get(exId);
    if (!prev || (s.logged_at && s.logged_at > prev)) {
      if (s.logged_at) lastLogged.set(exId, s.logged_at);
    }
  }

  // --- Routine / mesocycle references ------------------------------------
  const referenced = new Set<string>();
  const templateRows = await fetchAll(
    supabase,
    'workout_template_exercises',
    'exercise_id'
  ).catch(() => [] as Row[]);
  for (const t of templateRows) if (t.exercise_id) referenced.add(t.exercise_id);

  const mesoRows = await fetchAll(supabase, 'mesocycles', 'exercise_overrides').catch(
    () => [] as Row[]
  );
  for (const m of mesoRows) {
    const overrides = Array.isArray(m.exercise_overrides) ? m.exercise_overrides : [];
    for (const o of overrides) {
      if (o?.originalExerciseId) referenced.add(o.originalExerciseId);
      if (o?.replacementExerciseId) referenced.add(o.replacementExerciseId);
    }
  }

  // --- Build the dedup input ---------------------------------------------
  const exercises: DedupExercise[] = exercisesRaw.map((e) => ({
    id: e.id,
    name: e.name,
    primaryMuscle: e.primary_muscle,
    source: e.is_custom ? 'custom' : 'seed',
    createdAt: e.created_at ?? null,
    tier: e.hypertrophy_tier ?? null,
    equipment:
      e.equipment ??
      (Array.isArray(e.equipment_required) ? e.equipment_required.join(', ') : null),
    bodyweightType: e.bodyweight_type ?? null,
    setLogCount: logCount.get(e.id) ?? 0,
    lastLoggedAt: lastLogged.get(e.id) ?? null,
    inRoutineOrMeso: referenced.has(e.id),
  }));

  const { nearCertain, possible } = groupDuplicates(exercises);

  const md = renderMarkdown({
    totalExercises: exercises.length,
    nearCertain,
    possible,
  });

  const outPath = path.join(process.cwd(), 'docs', 'EXERCISE_DEDUP_AUDIT.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);

  console.log(`Audited ${exercises.length} exercises.`);
  console.log(
    `Near-certain duplicate groups: ${nearCertain.length}  |  Possible: ${possible.length}`
  );
  console.log(`Report written to ${outPath}`);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function renderGroup(group: DedupGroup, index: number): string {
  const survivor = suggestSurvivor(group);
  const header = `#### Group ${index + 1}: \`${group.key}\` (${group.members.length} entries)`;
  const rows = group.members
    .map((m) => {
      const isSurvivor = m.id === survivor.id ? ' ✅' : '';
      return `| ${escapePipe(m.name)}${isSurvivor} | \`${m.id}\` | ${m.source ?? '—'} | ${fmtDate(
        m.createdAt
      )} | ${m.primaryMuscle ?? '—'} | ${m.tier ?? '—'} | ${escapePipe(
        String(m.equipment ?? '—')
      )} | ${m.bodyweightType ?? '—'} | ${m.setLogCount ?? 0} | ${fmtDate(m.lastLoggedAt)} | ${
        m.inRoutineOrMeso ? 'yes' : 'no'
      } |`;
    })
    .join('\n');

  const survivorIds = group.members.filter((m) => m.id !== survivor.id).map((m) => m.id);
  const cmd =
    survivorIds.length > 0
      ? `\n\nSuggested merge (review first — survivor ✅ keeps its settings):\n\n\`\`\`bash\nnpx tsx scripts/mergeExercises.ts --survivor ${survivor.id} --duplicates ${survivorIds.join(
          ','
        )} --dry-run\n\`\`\``
      : '';

  return (
    `${header}\n\n_${group.reason}_\n\n` +
    `| Name | ID | Source | Created | Muscle | Tier | Equipment | BW type | Set logs | Last logged | In routine/meso |\n` +
    `|------|----|--------|---------|--------|------|-----------|---------|---------:|-------------|-----------------|\n` +
    `${rows}${cmd}`
  );
}

function renderMarkdown(input: {
  totalExercises: number;
  nearCertain: DedupGroup[];
  possible: DedupGroup[];
}): string {
  const { totalExercises, nearCertain, possible } = input;
  const lines: string[] = [];
  lines.push('# Exercise Duplicate Audit');
  lines.push('');
  lines.push(
    '> Generated by `scripts/exerciseDedupAudit.ts`. **Report only — no data was changed.**'
  );
  lines.push(
    '> The ✅ marks the *suggested* survivor (most set history, then oldest / seed). ' +
      'You decide; merge one group at a time with `scripts/mergeExercises.ts`.'
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Exercises audited: **${totalExercises}**`);
  lines.push(`- Near-certain duplicate groups: **${nearCertain.length}**`);
  lines.push(`- Possible duplicate groups: **${possible.length}**`);
  lines.push('');

  lines.push('## Near-certain duplicates');
  lines.push('');
  lines.push(
    'Identical normalized names (parentheticals, punctuation, and plural/singular ignored).'
  );
  lines.push('');
  if (nearCertain.length === 0) {
    lines.push('_None found._');
  } else {
    nearCertain.forEach((g, i) => {
      lines.push(renderGroup(g, i));
      lines.push('');
    });
  }
  lines.push('');

  lines.push('## Possible duplicates');
  lines.push('');
  lines.push(
    'Fuzzily similar names within the same primary muscle. Review carefully — ' +
      'legitimate variants (e.g. seated vs standing) can appear here.'
  );
  lines.push('');
  if (possible.length === 0) {
    lines.push('_None found._');
  } else {
    possible.forEach((g, i) => {
      lines.push(renderGroup(g, i));
      lines.push('');
    });
  }

  return lines.join('\n') + '\n';
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
