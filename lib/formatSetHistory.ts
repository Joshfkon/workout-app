/**
 * Set-history line formatter (Phase 0b).
 *
 * Live defect (Arnold Press header): "last session 45 lbs x 8, x 8, x 10
 * @ 3 RIR" rendered for a session that was actually
 * 45×8 @7RPE | 45×8 @9 | 40×10 @10 | 40×8 @10 — set 3's 40 lb load
 * mislabeled as 45, set 4 dropped entirely (a hard-coded 3-set slice), and
 * the whole session's effort collapsed to set 1's RIR. Silently truncating
 * or mislabeling set history is the invisible-anchor family of bug.
 *
 * Rules:
 *  - NEVER collapse heterogeneous loads to a single number: consecutive
 *    sets at the same displayed load group together, and every load that
 *    was lifted appears ("45 lbs × 8, × 8 · 40 lbs × 10, × 8").
 *  - NEVER drop sets. Beyond MAX_DETAILED_SETS the line switches to an
 *    honest RANGE summary ("40–45 lbs × 8–10 (7 sets)") instead of a
 *    truncated list.
 *  - Effort renders as the honest span: one value when homogeneous
 *    ("@ 2 RIR"), a range when not ("@ 0–3 RIR"), nothing when unlogged.
 *
 * Pure function. `weightLabel` arrives fully formed from the caller — units
 * included, bodyweight composition ("BW+25 lbs") included — so the formatter
 * is purely structural; reps carry seconds via the `secondsSuffix` flag.
 */

export interface HistorySetLine {
  /** Fully-formed display label for the load, e.g. "45 lbs", "BW+25 lbs". */
  weightLabel: string;
  reps: number;
  /** Resolved reps-in-reserve for the set, when an effort signal exists. */
  rir: number | null;
}

/** Above this many sets the per-set list becomes a range summary. */
export const MAX_DETAILED_SETS = 6;

const formatRirSpan = (sets: HistorySetLine[]): string => {
  const rirs = sets
    .map((s) => s.rir)
    .filter((r): r is number => r !== null && Number.isFinite(r));
  if (rirs.length === 0) return '';
  const min = Math.min(...rirs);
  const max = Math.max(...rirs);
  return min === max ? ` @ ${min} RIR` : ` @ ${min}–${max} RIR`;
};

/**
 * Format a previous session's sets for the card header meta line.
 * Returns null for an empty list.
 */
export function formatSetHistoryLine(
  sets: HistorySetLine[],
  opts: { secondsSuffix?: boolean } = {}
): string | null {
  if (sets.length === 0) return null;
  const s = opts.secondsSuffix ? 's' : '';
  const rirPart = formatRirSpan(sets);

  if (sets.length > MAX_DETAILED_SETS) {
    // Honest range summary — never a silent truncation.
    const weights = Array.from(new Set(sets.map((x) => x.weightLabel)));
    const reps = sets.map((x) => x.reps);
    const repMin = Math.min(...reps);
    const repMax = Math.max(...reps);
    const weightPart = weights.length === 1 ? weights[0] : weights.join('–');
    const repPart = repMin === repMax ? `× ${repMin}${s}` : `× ${repMin}–${repMax}${s}`;
    return `${weightPart} ${repPart} (${sets.length} sets)${rirPart}`;
  }

  // Group CONSECUTIVE sets at the same displayed load; every group names its
  // own load, so heterogeneous sessions can never collapse to one number.
  const groups: { weightLabel: string; reps: number[] }[] = [];
  for (const set of sets) {
    const last = groups[groups.length - 1];
    if (last && last.weightLabel === set.weightLabel) last.reps.push(set.reps);
    else groups.push({ weightLabel: set.weightLabel, reps: [set.reps] });
  }
  const body = groups
    .map((g) => `${g.weightLabel} ${g.reps.map((r) => `× ${r}${s}`).join(', ')}`)
    .join(' · ');
  return `${body}${rirPart}`;
}
