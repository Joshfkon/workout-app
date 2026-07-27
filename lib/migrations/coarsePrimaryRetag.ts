/**
 * Coarse-primary retag DRY-RUN report (shoulders volume-card audit, Phase 3).
 *
 * Custom exercises created through the old picker carry coarse legacy
 * primaries ('shoulders', 'chest', 'back') that the volume counter splits
 * evenly across the group's standard muscles (resolvePrimaryMuscleCredits) —
 * so a machine lateral raise tagged 'shoulders' leaks ⅓ of its credit to the
 * front AND rear delts. The 20260702000001 SQL migration fixed the STOCK
 * library; user-created exercises still smear.
 *
 * This module is REPORT-ONLY: pure functions that, given exercise rows,
 * propose precise retags with per-set credit deltas, plus a console printer.
 * Nothing here mutates data — applying a proposal is a separate, explicitly
 * confirmed step (audit policy: no silent migration of user data).
 */

import { resolvePrimaryMuscleCredits } from '@/services/volumeTracker';
import { perSetStandardCredit } from '@/services/muscleAttributionAudit';
import { normalizeMuscleToken } from '@/types/schema';

/** Minimum exercise shape the report needs (matches the weekly-volume rows). */
export interface RetagExerciseRow {
  id: string;
  name: string;
  primary_muscle?: string | null;
  secondary_muscles?: string[] | null;
}

export interface RetagProposal {
  id: string;
  name: string;
  currentPrimary: string;
  currentSecondaries: string[];
  /** null = no confident proposal — needs a human decision. */
  proposedPrimary: string | null;
  /** Secondaries the proposal would store (null when proposedPrimary is null). */
  proposedSecondaries: string[] | null;
  /** Which heuristic produced the proposal (or why there is none). */
  rule:
    | 'name_pattern'
    | 'ai_completion_default'
    | 'intentionally_coarse'
    | 'needs_review';
  /** Human-readable rationale for the review surface. */
  note: string;
  /** Splitting coarse tokens found in secondary_muscles (informational). */
  coarseSecondaries: string[];
  /** Per-set standard-muscle credit under the CURRENT tags. */
  creditPerSetBefore: Record<string, number>;
  /** Per-set credit under the PROPOSED tags (null when no proposal). */
  creditPerSetAfter: Record<string, number> | null;
}

/** A coarse token whose primary credit splits across >1 standard muscle. */
export function isSplittingCoarseToken(muscle: string): boolean {
  return resolvePrimaryMuscleCredits(muscle).length > 1;
}

/**
 * Name-pattern rules for coarse primaries where the exercise name makes the
 * intended muscle unambiguous. First match wins. Mappings follow the stock
 * library's 20260702000001 retag decisions; Arnold Press keeps a side-delt
 * secondary (real side-delt stimulus — front-only would crater side-delt
 * volume by the full ⅓ share it used to receive).
 */
const NAME_RULES: Array<{
  appliesTo: string;
  pattern: RegExp;
  primary: string;
  /** Secondaries ADDED to the exercise's existing list (deduped). */
  addSecondaries: string[];
  note: string;
}> = [
  // — coarse 'shoulders' —
  {
    appliesTo: 'shoulders',
    pattern: /arnold/i,
    primary: 'front_delts',
    addSecondaries: ['lateral_delts'],
    note: 'Arnold press: front-delt dominant with real side-delt stimulus (0.5 credit) — only the rear-delt ⅓ leakage was wrong.',
  },
  {
    appliesTo: 'shoulders',
    pattern: /lateral raise|side raise|side lateral/i,
    primary: 'lateral_delts',
    addSecondaries: [],
    note: 'Lateral raises: side delts, full stop (matches the stock retag).',
  },
  {
    appliesTo: 'shoulders',
    pattern: /front raise/i,
    primary: 'front_delts',
    addSecondaries: [],
    note: 'Front raises isolate the front delts.',
  },
  {
    appliesTo: 'shoulders',
    pattern: /rear delt|reverse fly|reverse pec|reverse crossover|face pull/i,
    primary: 'rear_delts',
    addSecondaries: [],
    note: 'Rear-delt work: rear delts (matches the stock retag).',
  },
  {
    appliesTo: 'shoulders',
    pattern: /upright row/i,
    primary: 'lateral_delts',
    addSecondaries: ['traps'],
    note: 'Upright rows: side delts + traps (matches the stock retag).',
  },
  {
    appliesTo: 'shoulders',
    pattern: /shrug/i,
    primary: 'traps',
    addSecondaries: [],
    note: "Shrugs are trap work; as 'shoulders' they credited all three delt heads.",
  },
  {
    appliesTo: 'shoulders',
    pattern: /press/i,
    primary: 'front_delts',
    addSecondaries: [],
    note: 'Overhead pressing is front-delt dominant (matches the stock retag).',
  },
  // — coarse 'chest' —
  {
    appliesTo: 'chest',
    pattern: /incline/i,
    primary: 'chest_upper',
    addSecondaries: ['chest_lower'],
    note: 'Incline pressing is clavicular-head dominant (matches the stock retag).',
  },
  {
    appliesTo: 'chest',
    pattern: /decline|dip/i,
    primary: 'chest_lower',
    addSecondaries: ['chest_upper'],
    note: 'Decline pressing / dips are sternal-head dominant (matches the stock retag).',
  },
  // — coarse 'back' —
  {
    appliesTo: 'back',
    pattern: /pulldown|pull.?up|chin.?up/i,
    primary: 'lats',
    addSecondaries: [],
    note: 'Vertical pulls are lat-dominant (matches the stock retag).',
  },
];

/** Stock-policy patterns where COARSE IS CORRECT (both sub-groups work hard). */
const INTENTIONALLY_COARSE: Array<{ appliesTo: string; pattern: RegExp; note: string }> = [
  {
    appliesTo: 'chest',
    pattern: /bench|press|fly|flye|pec deck|push.?up/i,
    note: "Flat pressing / flys genuinely train both chest heads — stock library keeps these 'chest'.",
  },
  {
    appliesTo: 'back',
    pattern: /row/i,
    note: "Rows load lats AND upper back — stock library keeps these 'back'.",
  },
];

/**
 * AI-completion fallback (lib/exercises/exercise-ai-completion.ts's
 * LEGACY_TO_DETAILED_FALLBACK, reduced to standard tokens): the default the
 * auto-completer would pick when nothing about the name disambiguates.
 * Presented for review only — never auto-applied.
 */
const AI_COMPLETION_DEFAULT: Record<string, string> = {
  shoulders: 'lateral_delts',
  chest: 'chest_lower',
  back: 'lats',
};

/**
 * Per-set standard-muscle credit for a tag set, exactly as the counter sees
 * it — delegates to the shared derivation in services/muscleAttributionAudit
 * (one credit formula everywhere), rounded to 2 decimals for display.
 */
export function perSetCredit(
  primary: string,
  secondaries: string[]
): Record<string, number> {
  const raw = perSetStandardCredit(primary, secondaries);
  const out: Record<string, number> = {};
  for (const [muscle, credit] of Object.entries(raw)) {
    out[muscle] = Math.round(credit * 100) / 100;
  }
  return out;
}

function proposeFor(row: RetagExerciseRow): RetagProposal | null {
  const primary = normalizeMuscleToken(row.primary_muscle ?? '');
  const secondaries = (row.secondary_muscles ?? []).filter(Boolean);
  const coarseSecondaries = secondaries.filter((s) =>
    isSplittingCoarseToken(normalizeMuscleToken(s))
  );
  const splittingPrimary = primary !== '' && isSplittingCoarseToken(primary);

  // Only exercises whose credit actually smears belong in the report.
  if (!splittingPrimary && coarseSecondaries.length === 0) return null;

  const base = {
    id: row.id,
    name: row.name,
    currentPrimary: row.primary_muscle ?? '',
    currentSecondaries: secondaries,
    coarseSecondaries,
    creditPerSetBefore: perSetCredit(primary, secondaries),
  };

  if (!splittingPrimary) {
    // Precise primary, but a coarse secondary smears partial credit.
    return {
      ...base,
      proposedPrimary: null,
      proposedSecondaries: null,
      rule: 'needs_review',
      note: `Precise primary, but coarse secondary tag(s) [${coarseSecondaries.join(', ')}] split 0.5 credit across a whole group — consider a specific muscle.`,
      creditPerSetAfter: null,
    };
  }

  for (const rule of NAME_RULES) {
    if (rule.appliesTo !== primary || !rule.pattern.test(row.name)) continue;
    const proposedSecondaries = Array.from(
      new Set([...secondaries.filter((s) => normalizeMuscleToken(s) !== primary), ...rule.addSecondaries])
    ).filter((s) => normalizeMuscleToken(s) !== rule.primary);
    return {
      ...base,
      proposedPrimary: rule.primary,
      proposedSecondaries,
      rule: 'name_pattern',
      note: rule.note,
      creditPerSetAfter: perSetCredit(rule.primary, proposedSecondaries),
    };
  }

  for (const keep of INTENTIONALLY_COARSE) {
    if (keep.appliesTo === primary && keep.pattern.test(row.name)) {
      return {
        ...base,
        proposedPrimary: null,
        proposedSecondaries: null,
        rule: 'intentionally_coarse',
        note: keep.note,
        creditPerSetAfter: null,
      };
    }
  }

  const aiDefault = AI_COMPLETION_DEFAULT[primary];
  return {
    ...base,
    proposedPrimary: aiDefault ?? null,
    proposedSecondaries: aiDefault ? secondaries : null,
    rule: aiDefault ? 'ai_completion_default' : 'needs_review',
    note: aiDefault
      ? `Name doesn't disambiguate — AI-completion default for '${primary}' is '${aiDefault}'. Review before applying.`
      : `No mapping heuristic for coarse primary '${primary}'.`,
    creditPerSetAfter: aiDefault ? perSetCredit(aiDefault, secondaries) : null,
  };
}

/**
 * Build the dry-run report: one proposal per DISTINCT exercise whose tags
 * smear credit (splitting coarse primary, or coarse secondary). Rows with
 * precise tags are omitted. Pure — safe to run anywhere.
 */
export function buildCoarsePrimaryRetagReport(
  rows: RetagExerciseRow[]
): RetagProposal[] {
  const seen = new Set<string>();
  const out: RetagProposal[] = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const proposal = proposeFor(row);
    if (proposal) out.push(proposal);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const fmtCredit = (c: Record<string, number>): string =>
  Object.entries(c)
    .map(([m, v]) => `${m} ${v}`)
    .join(', ');

/**
 * Console printer for the dry-run (development builds — see
 * useWeeklyMevSummary). Prints proposals only; APPLIES NOTHING.
 */
export function logCoarsePrimaryRetagDryRun(rows: RetagExerciseRow[]): void {
  const report = buildCoarsePrimaryRetagReport(rows);
  if (report.length === 0) return;
  /* eslint-disable no-console */
  console.groupCollapsed(
    `[coarsePrimaryRetag] DRY RUN — ${report.length} exercise(s) with credit-smearing coarse tags (nothing applied)`
  );
  for (const p of report) {
    console.log(
      `${p.name} [${p.rule}]\n` +
        `  current:  ${p.currentPrimary}${p.currentSecondaries.length ? ` + [${p.currentSecondaries.join(', ')}]` : ''}` +
        ` → per set: ${fmtCredit(p.creditPerSetBefore)}\n` +
        (p.proposedPrimary
          ? `  proposed: ${p.proposedPrimary}${p.proposedSecondaries?.length ? ` + [${p.proposedSecondaries.join(', ')}]` : ''}` +
            ` → per set: ${fmtCredit(p.creditPerSetAfter!)}\n`
          : '') +
        `  ${p.note}`
    );
  }
  console.groupEnd();
  /* eslint-enable no-console */
}
