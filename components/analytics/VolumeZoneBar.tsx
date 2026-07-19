'use client';

import {
  zoneBarClass,
  zoneTextClass,
  zoneBandLabel,
  type VolumeRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { formatEffectiveVolume } from '@/services/effectiveVolume';

/**
 * Volume-surface row CONTENT for the shared MuscleGroupList: the name + count
 * line and the zone bar. The hierarchy chrome (chevron, indentation, child
 * visibility, expansion persistence) lives in MuscleGroupList — these renderers
 * only draw one row's numbers. ONE zone rule everywhere: gray/amber below MEV,
 * green across the whole MEV–MRV band, red only past MRV — and the denominator
 * is the band ("12 · zone 8–20"), never n/MEV, so hitting the target is never
 * punished with a red bar.
 */
export function BarTrack({ row }: { row: VolumeRow }) {
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

/** Coarse-row content: "Chest    14.2 eff / 18 · zone 8–22" over the zone bar.
 *  Effective Volume (RIR-weighted) is the primary number; the raw set count
 *  rides secondary. Zone/bar math stays on raw sets. */
export function VolumeRowContent({ row }: { row: VolumeRow }) {
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-surface-200">{row.displayName}</span>
        <span className="text-sm tabular-nums flex-shrink-0">
          <span className={`font-semibold ${zoneTextClass(row.zone, row.sets)}`} data-testid={`volume-sets-${row.muscle}`}>
            {formatEffectiveVolume(row.effectiveSets)}
          </span>
          <span className="text-surface-500"> eff / {row.sets} · {zoneBandLabel(row.band)}</span>
        </span>
      </div>
      <BarTrack row={row} />
    </>
  );
}

/** Fine-child content: the smaller indented variant of the same line + bar. */
export function VolumeChildContent({ child }: { child: VolumeRow }) {
  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-surface-400">{child.displayName}</span>
        <span className="text-xs tabular-nums">
          <span className={zoneTextClass(child.zone, child.sets)} data-testid={`volume-sets-${child.muscle}`}>
            {formatEffectiveVolume(child.effectiveSets)}
          </span>
          <span className="text-surface-600"> eff / {child.sets} · {zoneBandLabel(child.band)}</span>
        </span>
      </div>
      <BarTrack row={child} />
    </>
  );
}
