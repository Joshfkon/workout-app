'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconChevronRight, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useEducationStore } from '@/hooks/useEducationPreferences';
import { useHydrated } from '@/hooks/useHydrated';
import { rowBarClass, rowTextClass, type VolumeRow } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/** Rows shown before "See all". */
export const WEEKLY_SETS_CARD_MAX_ROWS = 6;

/**
 * Which coarse rows Home shows, in order: the ones that need a decision first
 * (past MRV, then furthest below MEV — warnable only, so an un-feedable group
 * never nags), then trained muscles inside their range. Pure; exported for tests.
 */
export function pickWeeklySetsRows(rows: VolumeRow[], max = WEEKLY_SETS_CARD_MAX_ROWS): { shown: VolumeRow[]; total: number } {
  const coarse = rows.filter((r) => !r.isChild && (r.sets > 0 || (r.belowMev && r.warnable)));
  const rank = (r: VolumeRow): number => (r.zone === 'over_mrv' ? 0 : r.zone === 'below_mev' ? 1 : 2);
  const shortfall = (r: VolumeRow): number => (r.band.mev > 0 ? (r.band.mev - r.sets) / r.band.mev : 0);
  const sorted = [...coarse].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    if (a.zone === 'below_mev') return shortfall(b) - shortfall(a);
    return b.sets - a.sets;
  });
  return { shown: sorted.slice(0, max), total: coarse.length };
}

/**
 * One-line digest for the header, in plain words with the acronym after:
 * "2 muscles under their minimum (MEV) · 1 over its max (MRV)", or all-clear.
 * "13 below MEV" alone was unexplained jargon to 6 of 6 panel personas
 * (round 19).
 */
export function weeklySetsDigest(rows: VolumeRow[]): string {
  const coarse = rows.filter((r) => !r.isChild);
  const below = coarse.filter((r) => r.zone === 'below_mev' && r.warnable).length;
  const over = coarse.filter((r) => r.zone === 'over_mrv').length;
  const parts = [
    below > 0 ? `${below} ${below === 1 ? 'muscle' : 'muscles'} under ${below === 1 ? 'its' : 'their'} minimum (MEV)` : null,
    over > 0 ? `${over} over ${over === 1 ? 'its' : 'their'} max (MRV)` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Every trained muscle is in its range';
}

/** The plain-language key for MEV / MRV, shown from the card's info button. */
export const MEV_MRV_EXPLAINER =
  'MEV (minimum effective volume) is the fewest hard sets a week that still grow a muscle. ' +
  'MRV (maximum recoverable volume) is the most you can recover from. Aim to land between the two.';

/**
 * The one plain line shown under the heading until dismissed, so a first-run
 * lifter reads what the range means without finding the info key (UX panel
 * round 20, Sam: "MEV–MRV is shown with no explanation").
 */
export const MEV_MRV_FIRST_LINE =
  'Each bar is this week’s hard sets for a muscle. The shaded range runs from MEV, the fewest sets that still build it, to MRV, the most you can recover from.';

/** Dismissal key in the education store (dismissedHints). */
export const MEV_MRV_LINE_HINT_ID = 'home-weekly-sets-mev-mrv-line';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface WeeklySetsCardProps {
  rows: VolumeRow[];
}

/**
 * Home's "Sets this week": each muscle's weekly hard sets against its
 * MEV–MRV range, at a glance. The redesign had moved this one tap deep into
 * the Today sheet; an advanced lifter on the UX panel looked for it on Home
 * and Progress, didn't find it, and named its absence as his reason not to
 * switch. Same rows (buildVolumeRows) as the sheet, the workout strip and the
 * Sets per week page, so the numbers agree everywhere.
 */
export function WeeklySetsCard({ rows }: WeeklySetsCardProps) {
  const [showKey, setShowKey] = useState(false);
  const { shown, total } = pickWeeklySetsRows(rows);
  // Client-only (the dismissal lives in persisted local state): rendering it
  // during hydration would mismatch the server HTML for anyone who dismissed it.
  const hydrated = useHydrated();
  const lineDismissed = useEducationStore((s) => s.dismissedHints.includes(MEV_MRV_LINE_HINT_ID));
  const dismissHint = useEducationStore((s) => s.dismissHint);
  const showFirstLine = hydrated && !lineDismissed;
  if (shown.length === 0) return null;
  return (
    <section className="rounded-card bg-card shadow-card px-4 py-3.5" data-testid="home-weekly-sets" aria-labelledby="home-weekly-sets-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="home-weekly-sets-title" className="text-headline text-ink">
          Sets this week
        </h2>
        {/* The jargon gets its key one tap away, right where it is used. */}
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          aria-expanded={showKey}
          aria-controls="home-weekly-sets-key"
          className="-my-2 -mr-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-caption text-ink-2 hover:text-ink"
          data-testid="home-weekly-sets-info"
        >
          vs MEV–MRV
          <IconInfoCircle size={16} aria-hidden="true" />
          <span className="sr-only">: what do these mean?</span>
        </button>
      </div>
      {showFirstLine && (
        <div
          className="mt-1.5 flex items-start gap-2 rounded-lg bg-fill px-3 py-2"
          data-testid="home-weekly-sets-first-line"
        >
          <p className="min-w-0 flex-1 text-subhead text-ink">{MEV_MRV_FIRST_LINE}</p>
          <button
            type="button"
            onClick={() => dismissHint(MEV_MRV_LINE_HINT_ID)}
            className="-my-1.5 -mr-2 inline-flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center gap-1 text-subhead font-semibold text-action"
            data-testid="home-weekly-sets-first-line-dismiss"
          >
            Got it
            <IconX size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {showKey && (
        <p
          id="home-weekly-sets-key"
          className="mt-1 rounded-lg bg-fill px-3 py-2 text-caption text-ink-2"
          data-testid="home-weekly-sets-key"
        >
          {MEV_MRV_EXPLAINER}
        </p>
      )}
      <p className="mt-0.5 text-subhead text-ink-2" data-testid="home-weekly-sets-digest">
        {weeklySetsDigest(rows)}
      </p>
      <ul className="mt-3 space-y-2.5">
        {shown.map((row) => {
          // Bar scale: the band's top plus headroom, so MRV sits inside the track.
          const scale = Math.max(row.band.mrv * 1.15, row.sets, 1);
          const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
          return (
            <li key={row.key} data-testid="home-weekly-sets-row">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-body text-ink">{row.displayName}</span>
                <span className="text-subhead tabular-nums text-ink-2">
                  <span className={`font-semibold ${rowTextClass(row)}`}>{fmt(row.sets)}</span> of {row.band.mev}–{row.band.mrv}
                </span>
              </div>
              <div className="relative mt-1 h-1.5 rounded-full bg-fill" aria-hidden="true">
                {/* The MEV–MRV range, faint, behind the fill. */}
                <div className="absolute inset-y-0 rounded-full bg-ink-3/25" style={{ left: pct(row.band.mev), width: `calc(${pct(row.band.mrv)} - ${pct(row.band.mev)})` }} />
                <div className={`absolute inset-y-0 left-0 rounded-full ${rowBarClass(row)}`} style={{ width: pct(row.sets) }} />
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href="/dashboard/volume"
        className="mt-3 flex min-h-[44px] items-center justify-between text-subhead font-semibold text-action"
        data-testid="home-weekly-sets-all"
      >
        {total > shown.length ? `See all ${total} muscles` : 'Sets per week'}
        <IconChevronRight size={18} aria-hidden="true" />
      </Link>
    </section>
  );
}
