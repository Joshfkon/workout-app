'use client';

import { useMemo } from 'react';
import { now as clockNow } from '@/lib/clock';
import {
  volumeZone,
  zoneBarClass,
  zoneTextClass,
  type VolumeBand,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import {
  FORECAST_HORIZON_DAYS,
  firstDayBelow,
  projectRollingSets,
} from '@/services/volumeProjection';

/**
 * RollingVolumeForecast — the "when does it fall off?" companion to the
 * counted-sets panel. The weekly number is a rolling 7-local-day window, so it
 * decays as sessions age out; this mini bar chart projects that decay forward
 * (today + the next 7 days, assuming nothing new is logged), with every bar
 * colored by the SAME zone rule as the row's own bar and the body map —
 * green inside the MEV–MRV band, yellow below MEV, red past MRV — and a
 * dashed line marking the zone floor (MEV) so the drop-out day is visible at
 * a glance. Rendered inside a row's expansion on the readiness sheet and the
 * volume page; purely presentational over the projection service.
 */

/** Bar heights scale against MRV (like the row bars); a bar over MRV clamps
 *  to full height and signals overrun by color, exactly like barFillPct. */
function heightPct(sets: number, scaleMax: number): number {
  if (scaleMax <= 0 || sets <= 0) return 0;
  // Keep a sliver visible for small non-zero values so the last counted days
  // don't visually vanish before they actually age out.
  return Math.min(100, Math.max(4, (sets / scaleMax) * 100));
}

/** Column label: today, then short weekdays; +7d is today's weekday again, so
 *  name it by distance instead to avoid reading as "now" twice. */
function dayLabel(offset: number, base: Date): string {
  if (offset === 0) return 'Now';
  if (offset >= 7) return `+${offset}d`;
  const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return day.toLocaleDateString(undefined, { weekday: 'short' });
}

/** Caption phrasing for a day offset ("tomorrow", "on Tue", "in 7 days"). */
function dayPhrase(offset: number, base: Date): string {
  if (offset <= 1) return 'tomorrow';
  if (offset >= 7) return `in ${offset} days`;
  return `on ${dayLabel(offset, base)}`;
}

export function RollingVolumeForecast({
  daily,
  band,
  muscle,
  displayName,
  testIdPrefix,
}: {
  /** Credited group sets per day, indexed by days ago (0 = today). */
  daily: readonly number[];
  band: VolumeBand;
  /** Muscle id — testids get `${testIdPrefix}-${muscle}`. */
  muscle: string;
  displayName: string;
  testIdPrefix: string;
}) {
  const projection = useMemo(() => projectRollingSets(daily), [daily]);
  // Visual-only label base; the projection itself was bucketed upstream
  // against the injected clock.
  const base = useMemo(() => clockNow(), []);

  if (projection.length === 0 || projection[0] <= 0) return null;

  // Scale against MRV like the row bars; a current total past MRV still fits.
  const scaleMax = Math.max(band.mrv, projection[0]);
  const mevPct = Math.min(100, (band.mev / scaleMax) * 100);
  const dropDay = firstDayBelow(projection, band.mev);
  const emptyDay = projection.findIndex((sets) => sets <= 0);

  return (
    <div
      className="rounded-lg bg-surface-800/40 px-2.5 py-2 mt-1.5"
      data-testid={`${testIdPrefix}-${muscle}`}
    >
      <p className="text-[10px] uppercase tracking-wide text-surface-500 mb-1.5">
        Rolling 7-day forecast · if nothing new is logged
      </p>
      <div className="relative h-16">
        {/* Zone floor (MEV) — the dashed line the bars fall through. */}
        <div
          className="absolute inset-x-0 border-t border-dashed border-surface-500/50 pointer-events-none"
          style={{ bottom: `${mevPct}%` }}
          aria-hidden="true"
        />
        <span
          className="absolute right-0 text-[9px] leading-none text-surface-500 pointer-events-none"
          style={{ bottom: `calc(${mevPct}% + 2px)` }}
          aria-hidden="true"
        >
          {band.mev}
        </span>
        <div className="flex h-full items-end gap-1">
          {projection.map((sets, d) => {
            const zone = volumeZone(sets, band);
            return (
              <div
                key={d}
                className="flex-1 h-full flex items-end"
                title={`${dayLabel(d, base)}: ${sets} credited sets`}
                data-testid={`${testIdPrefix}-bar-${muscle}-${d}`}
              >
                <div
                  className={`w-full rounded-sm ${sets > 0 ? zoneBarClass(zone, sets) : 'bg-surface-800'}`}
                  style={{ height: `${sets > 0 ? heightPct(sets, scaleMax) : 2}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1 mt-0.5">
        {projection.map((_, d) => (
          <span
            key={d}
            className={`flex-1 text-center text-[9px] ${d === 0 ? 'text-surface-400' : 'text-surface-600'}`}
          >
            {dayLabel(d, base)}
          </span>
        ))}
      </div>
      <p
        className="mt-1 text-[10px] leading-relaxed text-surface-600"
        data-testid={`${testIdPrefix}-caption-${muscle}`}
      >
        {dropDay === 0 ? (
          <>
            <span className={zoneTextClass('below_mev', projection[0])}>
              Already below the {band.mev}-set zone floor
            </span>
            {emptyDay > 0 && <> — the remaining sets age out {dayPhrase(emptyDay, base)}</>}
            .
          </>
        ) : dropDay !== null ? (
          <>
            Falls below the {band.mev}-set zone floor{' '}
            <span className="text-surface-400">{dayPhrase(dropDay, base)}</span> as older{' '}
            {displayName} sets leave the 7-day window.
          </>
        ) : (
          <>Holds its zone through the next {FORECAST_HORIZON_DAYS} days.</>
        )}
      </p>
    </div>
  );
}
