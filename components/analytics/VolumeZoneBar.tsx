'use client';

import {
  zoneBarClass,
  zoneTextClass,
  zoneBandLabel,
  type VolumeRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * The shared volume bar used by the volume page (and any surface that renders
 * the coarse-row model). ONE zone rule everywhere: gray/amber below MEV, green
 * across the whole MEV–MRV band, red only past MRV — and the denominator is the
 * band ("12 · zone 8–20"), never n/MEV, so hitting the target is never punished
 * with a red bar.
 */
function BarTrack({ row }: { row: VolumeRow }) {
  const { sets, band, zone } = row;
  // Scale so MRV sits at ~83% and there's headroom to show an over-MRV overrun.
  const maxDisplay = band.mrv * 1.2;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / maxDisplay) * 100))}%`;

  return (
    <div className="relative h-3 rounded-full bg-surface-800 overflow-hidden">
      {/* Green MEV–MRV zone band */}
      <div
        className="absolute top-0 bottom-0 bg-success-500/10"
        style={{ left: pct(band.mev), width: `${Math.max(0, (band.mrv - band.mev) / maxDisplay) * 100}%` }}
      />
      {/* MEV marker */}
      <div className="absolute top-0 bottom-0 w-px bg-surface-500" style={{ left: pct(band.mev) }} />
      {/* MRV marker */}
      <div className="absolute top-0 bottom-0 w-px bg-danger-500/60" style={{ left: pct(band.mrv) }} />
      {/* Current fill */}
      <div
        className={`absolute top-0 bottom-0 left-0 ${zoneBarClass(zone, sets)} transition-all duration-300`}
        style={{ width: pct(sets) }}
      />
    </div>
  );
}

export function VolumeZoneBar({
  row,
  expanded,
  onToggle,
}: {
  row: VolumeRow;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const hasChildren = row.children.length > 0;

  return (
    <div className="py-3 border-b border-surface-800 last:border-b-0" data-testid={`volume-row-${row.muscle}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {hasChildren && onToggle ? (
            <button
              onClick={onToggle}
              className="flex items-center gap-1.5 text-surface-200 hover:text-surface-100"
              aria-expanded={expanded}
            >
              <svg
                className={`w-3.5 h-3.5 text-surface-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">{row.displayName}</span>
            </button>
          ) : (
            <span className="font-medium text-surface-200">{row.displayName}</span>
          )}
        </div>
        <span className="text-sm tabular-nums flex-shrink-0">
          <span className={`font-semibold ${zoneTextClass(row.zone, row.sets)}`} data-testid={`volume-sets-${row.muscle}`}>
            {row.sets}
          </span>
          <span className="text-surface-500"> · {zoneBandLabel(row.band)}</span>
        </span>
      </div>

      <BarTrack row={row} />

      {/* Fine children: lagging ones always show; the rest on expand. */}
      {(expanded || row.children.some((c) => c.belowMev)) && hasChildren && (
        <div className="mt-2 space-y-2 pl-4 border-l border-surface-800/80">
          {row.children
            .filter((c) => expanded || c.belowMev)
            .map((child) => (
              <div key={child.key} data-testid={`volume-row-${child.muscle}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-surface-400">{child.displayName}</span>
                  <span className="text-xs tabular-nums">
                    <span className={zoneTextClass(child.zone, child.sets)} data-testid={`volume-sets-${child.muscle}`}>
                      {child.sets}
                    </span>
                    <span className="text-surface-600"> · {zoneBandLabel(child.band)}</span>
                  </span>
                </div>
                <BarTrack row={child} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
