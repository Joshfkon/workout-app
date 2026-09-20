/**
 * Set-quality DISPLAY relabeling — derived from the set's RIR at render time.
 *
 * The stored `quality` column keeps its original four-value taxonomy
 * ('junk' | 'effective' | 'stimulative' | 'excessive'); this module only
 * changes what the user READS. It exists to fix a labeling contradiction:
 * the volume accounting (services/effectiveVolume.ts) gives 0–2 RIR full
 * credit (1.0×), 3 RIR partial (0.6×) and 4+ RIR a sliver (0.25×), but the
 * stored label filed a 0 RIR set under the same "effective" bucket as a
 * 4 RIR cruise set — a harder set reading as a demotion despite earning
 * identical credit to "stimulative".
 *
 * Display buckets mirror the credit table's tiers exactly:
 *
 *   RIR 0    → 'maxed'        1.0× credit, flagged for its recovery cost
 *   RIR 1–2  → 'stimulative'  1.0× credit, the target zone
 *   RIR 3    → 'effective'    0.6× credit
 *   RIR 4+   → 'easy'         0.25× credit
 *
 * A stored 'junk' (ugly form, or RPE ≤ 5) or 'excessive' (legacy rows only —
 * the live logging path never writes it) verdict is never relabeled: those
 * carry information the RIR alone doesn't. A set with no resolvable RIR
 * falls back to its stored label.
 */

import { rpeToRir } from '@/types/schema';
import type { RepsInTank, SetQuality } from '@/types/schema';
import { EFFECTIVE_VOLUME_WEIGHTS } from '@/services/effectiveVolume';

export type SetQualityDisplay =
  | 'junk'
  | 'easy'
  | 'effective'
  | 'stimulative'
  | 'maxed'
  | 'excessive';

export interface SetQualityDisplayInput {
  /** The stored quality verdict from log time. */
  quality: SetQuality;
  /** Logged feedback RIR (feedback.repsInTank), when the user tapped a chip. */
  rir?: number | null;
  /** Stored RPE — the fallback RIR source, matching the row's RIR readout. */
  rpe?: number | null;
}

const CREDIT_SUFFIX = (rir: RepsInTank) =>
  `counts as ${EFFECTIVE_VOLUME_WEIGHTS[rir]}× toward weekly volume`;

/**
 * Label text, short (table) form, and a tooltip-ready description per bucket.
 * Descriptions state the credit multiplier so the label can never read as a
 * hidden discount again.
 */
export const SET_QUALITY_DISPLAY_META: Readonly<
  Record<SetQualityDisplay, { label: string; shortLabel: string; description: string }>
> = {
  maxed: {
    label: 'maxed',
    shortLabel: 'Max',
    description: `To failure (0 RIR) — full stimulus credit (${CREDIT_SUFFIX(0)}), but costs more recovery than stopping at 1–2 RIR`,
  },
  stimulative: {
    label: 'stimulative',
    shortLabel: 'Stim',
    description: `1–2 RIR — the target zone; ${CREDIT_SUFFIX(1)}`,
  },
  effective: {
    label: 'effective',
    shortLabel: 'Eff',
    description: `3 RIR — ${CREDIT_SUFFIX(3)}; push closer to failure for full credit`,
  },
  easy: {
    label: 'easy',
    shortLabel: 'Easy',
    description: `4+ RIR — ${CREDIT_SUFFIX(4)}; too far from failure to stimulate much growth`,
  },
  junk: {
    label: 'junk',
    shortLabel: 'Junk',
    description: 'Form breakdown or far too easy — not contributing usable stimulus',
  },
  excessive: {
    label: 'excessive',
    shortLabel: 'Excess',
    description: 'Failure reached when not intended — may impact remaining sets',
  },
};

/** Resolve the RIR the row displays: logged chip first, then RPE-derived. */
function resolveDisplayRir(rir?: number | null, rpe?: number | null): RepsInTank | null {
  if (typeof rir === 'number' && Number.isFinite(rir)) {
    const rounded = Math.round(rir);
    if (rounded >= 0 && rounded <= 4) return rounded as RepsInTank;
    return null;
  }
  if (typeof rpe === 'number' && Number.isFinite(rpe)) return rpeToRir(rpe);
  return null;
}

/**
 * The display bucket for a logged set. Pure relabeling — never touches the
 * stored value or any accounting.
 */
export function displaySetQuality(input: SetQualityDisplayInput): SetQualityDisplay {
  // A junk/excessive verdict carries form or context the RIR doesn't; keep it.
  if (input.quality === 'junk' || input.quality === 'excessive') return input.quality;

  const rir = resolveDisplayRir(input.rir, input.rpe);
  if (rir === null) return input.quality;

  if (rir === 0) return 'maxed';
  if (rir <= 2) return 'stimulative';
  if (rir === 3) return 'effective';
  return 'easy';
}
