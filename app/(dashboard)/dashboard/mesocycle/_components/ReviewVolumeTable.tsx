import { formatHeadSets, volumeStatus, VOLUME_STATUS_LABEL, type VolumeStatus } from '@/lib/training/builderDefaults';
import { muscleDisplayName } from '@/lib/utils';

export interface ReviewVolumeRow {
  muscle: string;
  /** Sets the peak week's sessions hold (credited). */
  done: number;
  /** The target the sessions aim for (capped to what fits). */
  target: number;
  mev: number;
  mrv: number;
}

const STATUS_CLASS: Record<VolumeStatus, string> = {
  below_mev: 'bg-status-warn/15 text-status-warn',
  over_mrv: 'bg-status-bad/15 text-status-bad',
  short: 'bg-status-warn/15 text-status-warn',
  in_range: 'bg-status-ok/15 text-status-ok',
};

/**
 * The review's first read: one row per muscle, its weekly sets, its
 * MEV–MRV band and a one-word status, so a lifter can skim the plan against
 * the landmarks without reading paragraphs (UX panel round 20).
 */
export function ReviewVolumeTable({
  rows,
  showTarget,
  prioritized,
}: {
  rows: ReviewVolumeRow[];
  /** Show "of N" when the sessions hold less than the target. */
  showTarget: boolean;
  /** Coarse groups the lifter marked high priority (★). */
  prioritized: ReadonlySet<string>;
}) {
  return (
    <table className="w-full text-subhead tabular-nums" data-testid="builder-volume-bands">
      <thead>
        <tr className="text-caption text-ink-3">
          <th scope="col" className="py-1 pr-2 text-left font-medium">Muscle</th>
          <th scope="col" className="py-1 px-2 text-right font-medium">Sets/wk</th>
          <th scope="col" className="py-1 px-2 text-right font-medium">MEV–MRV</th>
          <th scope="col" className="py-1 pl-2 text-right font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ muscle, done, target, mev, mrv }) => {
          const status = volumeStatus(done, target, mev, mrv);
          return (
            <tr key={muscle} className="border-t border-sep" data-testid={`builder-volume-row-${muscle}`}>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">
                {muscleDisplayName(muscle)}
                {prioritized.has(muscle) && (
                  <span className="ml-1 text-action" aria-label="high priority">★</span>
                )}
              </th>
              <td className="py-1.5 px-2 text-right">
                <span className="font-semibold text-ink">{formatHeadSets(done)}</span>
                {showTarget && Math.round(done) < target && <span className="text-ink-3"> of {target}</span>}
              </td>
              <td className="py-1.5 px-2 text-right text-ink-2">{mev}–{mrv}</td>
              <td className="py-1.5 pl-2 text-right">
                <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold ${STATUS_CLASS[status]}`}>
                  {VOLUME_STATUS_LABEL[status]}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
