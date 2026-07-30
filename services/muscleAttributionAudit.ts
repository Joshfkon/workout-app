/**
 * Muscle-attribution audit (volume-panel attribution defect, Phase 1).
 *
 * REPORT-ONLY: pure functions that compute, for a set of exercise tag entries,
 * the per-set standard-muscle credit EXACTLY as the live volume counter sees
 * it (resolvePrimaryMuscleCredits + SECONDARY_MUSCLE_CREDIT — the same
 * primitives volumeTracker, weeklyVolume, mesocycleBuilder's allocator and
 * the coarse-primary retag report all use), then assert the one invariant a
 * sane attribution table must hold:
 *
 *   THE PRIMARY TARGET RECEIVES THE LARGEST PER-SET COEFFICIENT.
 *
 * Any exercise where a non-primary muscle ties or out-credits every muscle
 * the primary tag resolves to is a defect. The known mechanism (confirmed by
 * the shoulders-panel numbers): a legacy coarse primary ('shoulders') smears
 * UNIFORMLY across its heads (⅓ each via LEGACY_PRIMARY_VOLUME_WEIGHTS),
 * so a lateral raise credits the rear delts exactly as much as its actual
 * target — and any 0.5 secondary out-credits every ⅓ head.
 *
 * Nothing here mutates data; applying corrections is Phase 2, gated on
 * explicit review (same protocol as progression_model / rom_demands).
 */

import {
  perSetStandardCredit as canonicalPerSetStandardCredit,
  resolvePrimaryMuscleCredits,
} from '@/services/shared/volumeCredit';
import { normalizeMuscleToken, resolveMuscleToStandard } from '@/types/schema';

/** One exercise's muscle tags, from any attribution source. */
export interface AttributionEntry {
  name: string;
  /** Which table the tags came from (seed DB, service fallback, program template). */
  source: string;
  primary: string;
  secondaries: string[];
}

export type AttributionVerdict = 'ok' | 'tied' | 'inverted';

export interface AttributionRow extends AttributionEntry {
  /** Per-set standard-muscle credit exactly as the volume counter computes it. */
  credits: Record<string, number>;
  /** Standard muscles the primary tag resolves to (the nominal target set). */
  primaryStandards: string[];
  /** Highest per-set credit any primary-resolved muscle receives. */
  primaryPeak: number;
  /** Highest per-set credit any NON-primary muscle receives (0 when none). */
  rivalPeak: number;
  /** The non-primary muscle carrying rivalPeak (null when none). */
  rival: string | null;
  /** inverted: a non-primary muscle out-credits the primary target; tied: equals it. */
  verdict: AttributionVerdict;
  /**
   * Primary is a coarse token the counter splits uniformly across >1 standard
   * muscle — the exercise cannot express which head it actually targets.
   * This is the mechanism behind a lateral raise crediting rear delts.
   */
  uniformHeadSplit: boolean;
  /** Tags that resolve to no standard muscle — that credit is silently dropped. */
  droppedTokens: string[];
}

/**
 * Per-set standard-muscle credit for a tag pair, exactly as the live counter
 * applies it (weighted primary split, 0.5 secondary split across the standards
 * a secondary token covers, primary-overlap suppressed). Unrounded.
 */
export function perSetStandardCredit(
  primary: string,
  secondaries: string[]
): Record<string, number> {
  // Delegates to the CANONICAL set-credit module (services/shared/volumeCredit)
  // so the audit can never drift from the live counter's math.
  return canonicalPerSetStandardCredit(primary, secondaries);
}

/**
 * Whether a primary-muscle token splits its credit across more than one
 * standard muscle ('shoulders' ⅓/⅓/⅓, 'chest'/'back' ½/½). This is the ONE
 * BAD RULE behind every audited inversion: a split share is ≤ the 0.5
 * secondary credit, so the exercise's own target can never strictly
 * out-rank its secondaries. New exercises must not be created with one.
 */
export function isGroupSplitPrimary(muscle: string): boolean {
  return resolvePrimaryMuscleCredits(muscle).length > 1;
}

/**
 * Creation-time constraint for an exercise's PRIMARY muscle: returns a
 * user-facing error message when the token is a group-level (splitting)
 * primary, null when it is acceptable. Enforced in createCustomExercise and
 * the insert server action so no new exercise can reintroduce the smear the
 * 2026-07 retag removed.
 */
export function validateExercisePrimary(muscle: string): string | null {
  if (!isGroupSplitPrimary(muscle)) return null;
  const heads = resolvePrimaryMuscleCredits(muscle)
    .map((c) => c.muscle)
    .join(', ');
  return `Pick the specific muscle this exercise targets (${heads}). A whole-group primary ("${muscle}") splits its credit evenly across every head, so the actual target gets under-counted.`;
}

/** Audit one entry against the primary-gets-the-largest-coefficient invariant. */
export function auditAttributionEntry(entry: AttributionEntry): AttributionRow {
  const credits = perSetStandardCredit(entry.primary, entry.secondaries);
  const primaryCredits = resolvePrimaryMuscleCredits(entry.primary);
  const primaryStandards = primaryCredits.map((c) => c.muscle as string);
  const primarySet = new Set(primaryStandards);

  const droppedTokens: string[] = [];
  if (entry.primary && primaryCredits.length === 0) droppedTokens.push(entry.primary);
  for (const s of entry.secondaries) {
    if (resolveMuscleToStandard(s).length === 0) droppedTokens.push(s);
  }

  let primaryPeak = 0;
  let rivalPeak = 0;
  let rival: string | null = null;
  for (const [muscle, credit] of Object.entries(credits)) {
    if (primarySet.has(muscle)) {
      if (credit > primaryPeak) primaryPeak = credit;
    } else if (credit > rivalPeak) {
      rivalPeak = credit;
      rival = muscle;
    }
  }

  // Float-safe comparison (⅓ and ⅙ weights).
  const EPS = 1e-9;
  const verdict: AttributionVerdict =
    rivalPeak > primaryPeak + EPS ? 'inverted' : Math.abs(rivalPeak - primaryPeak) <= EPS && rivalPeak > 0 ? 'tied' : 'ok';

  return {
    ...entry,
    credits,
    primaryStandards,
    primaryPeak,
    rivalPeak,
    rival,
    verdict,
    uniformHeadSplit: primaryCredits.length > 1,
    droppedTokens,
  };
}

/** Audit a whole table (any mix of sources). */
export function auditAttributionTable(entries: AttributionEntry[]): AttributionRow[] {
  return entries.map(auditAttributionEntry);
}

/** Rows failing the invariant, worst first (inverted, then tied). */
export function attributionFailures(rows: AttributionRow[]): AttributionRow[] {
  const rank: Record<AttributionVerdict, number> = { inverted: 0, tied: 1, ok: 2 };
  return rows
    .filter((r) => r.verdict !== 'ok')
    .sort(
      (a, b) => rank[a.verdict] - rank[b.verdict] || a.name.localeCompare(b.name)
    );
}

/** Rows whose primary smears uniformly across heads (mechanism class). */
export function uniformSplitRows(rows: AttributionRow[]): AttributionRow[] {
  return rows.filter((r) => r.uniformHeadSplit).sort((a, b) => a.name.localeCompare(b.name));
}

/** Rows with tokens that resolve to nothing (silently dropped credit). */
export function droppedTokenRows(rows: AttributionRow[]): AttributionRow[] {
  return rows.filter((r) => r.droppedTokens.length > 0);
}

const fmt = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return String(r);
};

const fmtCredits = (credits: Record<string, number>): string =>
  Object.entries(credits)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([m, v]) => `${m} ${fmt(v)}`)
    .join(', ');

/** One line per exercise: name [source] primary+secondaries → per-set credit. */
export function formatAttributionRow(row: AttributionRow): string {
  const tags = `${row.primary}${row.secondaries.length ? ` + [${row.secondaries.join(', ')}]` : ''}`;
  const flags = [
    row.verdict !== 'ok' ? row.verdict.toUpperCase() : null,
    row.uniformHeadSplit ? 'uniform-split' : null,
    row.droppedTokens.length ? `dropped:[${row.droppedTokens.join(',')}]` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `${row.name} [${row.source}] ${tags} → ${fmtCredits(row.credits)}${flags ? `  ⚠ ${flags}` : ''}`;
}

/** Full printable report: table, then the failure sections. */
export function formatAttributionReport(rows: AttributionRow[]): string {
  const failures = attributionFailures(rows);
  const uniform = uniformSplitRows(rows);
  const dropped = droppedTokenRows(rows);
  const lines: string[] = [];
  lines.push(`MUSCLE ATTRIBUTION AUDIT — ${rows.length} entries`);
  lines.push('');
  lines.push('== FULL TABLE ==');
  for (const row of [...rows].sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))) {
    lines.push(formatAttributionRow(row));
  }
  lines.push('');
  lines.push(`== INVARIANT FAILURES (primary not strictly largest) — ${failures.length} ==`);
  for (const row of failures) {
    lines.push(
      `${row.name} [${row.source}] ${row.verdict}: primary peak ${fmt(row.primaryPeak)} (${row.primaryStandards.join('/')}) vs ${row.rival} ${fmt(row.rivalPeak)}`
    );
  }
  lines.push('');
  lines.push(`== UNIFORM HEAD-SPLIT PRIMARIES (coarse smear mechanism) — ${uniform.length} ==`);
  for (const row of uniform) lines.push(formatAttributionRow(row));
  lines.push('');
  lines.push(`== DROPPED TOKENS (credit silently lost) — ${dropped.length} ==`);
  for (const row of dropped) lines.push(formatAttributionRow(row));
  return lines.join('\n');
}
