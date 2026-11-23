'use client';

import Link from 'next/link';
import { IconChevronRight } from '@tabler/icons-react';
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

/** One-line digest for the header: "2 below MEV · 1 over MRV", or all-clear. */
export function weeklySetsDigest(rows: VolumeRow[]): string {
  const coarse = rows.filter((r) => !r.isChild);
  const below = coarse.filter((r) => r.zone === 'below_mev' && r.warnable).length;
  const over = coarse.filter((r) => r.zone === 'over_mrv').length;
  const parts = [below > 0 ? `${below} below MEV` : null, over > 0 ? `${over} over MRV` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Every trained muscle is in its range';
}

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
  const { shown, total } = pickWeeklySetsRows(rows);
  if (shown.length === 0) return null;
  return (
    <section className="rounded-card bg-card shadow-card px-4 py-3.5" data-testid="home-weekly-sets" aria-labelledby="home-weekly-sets-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="home-weekly-sets-title" className="text-headline text-ink">
          Sets this week
        </h2>
        <span className="text-caption text-ink-2">vs MEV–MRV</span>
      </div>
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
