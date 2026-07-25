'use client';

import { useMemo } from 'react';
import { convertWeight, convertWeightForDisplay } from '@/lib/utils';
import {
  computeExerciseRecords,
  isNormalDetailSet,
  type ExerciseDetailSession,
} from '@/services/exerciseDetailAnalytics';
import { formatDetailDate } from './helpers';

interface RecordsTabProps {
  sessions: ExerciseDetailSession[] | undefined;
  unit: 'kg' | 'lb';
  /** rep_total exercise: no e1RM record; best session rep total instead. */
  repTotalMode?: boolean;
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="bg-surface-800/50 rounded-lg p-3">
      <p className="text-[11px] text-surface-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-surface-100 mt-0.5">{value}</p>
      {detail && <p className="text-xs text-surface-500 mt-0.5">{detail}</p>}
    </div>
  );
}

export function RecordsTab({ sessions, unit, repTotalMode = false }: RecordsTabProps) {
  // rep_total headline record: the biggest session rep total (non-deload).
  const bestSessionReps = useMemo(() => {
    if (!repTotalMode || !sessions) return null;
    let best: { total: number; date: string } | null = null;
    for (const session of sessions) {
      if (session.isDeload) continue;
      // Straight sets only — same rule the rep_total policy grades.
      const total = session.sets
        .filter(isNormalDetailSet)
        .reduce((sum, st) => sum + st.reps, 0);
      if (total > 0 && (!best || total > best.total)) best = { total, date: session.date };
    }
    return best;
  }, [repTotalMode, sessions]);
  // Lazy-computed on first tab visit — this component only mounts then.
  const records = useMemo(
    () => (sessions ? computeExerciseRecords(sessions) : null),
    [sessions]
  );

  if (sessions === undefined) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-surface-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!records || records.lifetime.totalSets === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-surface-400 text-sm">No records yet</p>
        <p className="text-surface-600 text-xs mt-1">
          Log a few sets of this exercise and your PRs will show up here.
        </p>
      </div>
    );
  }

  const w = (kg: number) => `${convertWeightForDisplay(kg, unit, 1)} ${unit}`;
  const vol = (kg: number) => `${Math.round(convertWeight(kg, 'kg', unit)).toLocaleString()} ${unit}`;

  const repRecordByReps = new Map(records.repRecords.map((r) => [r.reps, r]));
  const repRows = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-5" data-testid="exercise-detail-records">
      {/* Headline records */}
      <div className="grid grid-cols-2 gap-2">
        {/* rep_total: no e1RM record exists — the headline is the best
            session rep total (ADD 2). */}
        {repTotalMode
          ? bestSessionReps && (
              <StatCard
                label="Best session reps"
                value={`${bestSessionReps.total} reps`}
                detail={formatDetailDate(bestSessionReps.date)}
              />
            )
          : records.bestE1RM && (
              <StatCard
                label="Best est. 1RM"
                value={`${Math.round(convertWeight(records.bestE1RM.valueKg, 'kg', unit))} ${unit}`}
                detail={`${w(records.bestE1RM.set.weightKg)} × ${records.bestE1RM.set.reps} · ${formatDetailDate(records.bestE1RM.date)}`}
              />
            )}
        {records.heaviestWeight && (
          <StatCard
            label="Heaviest weight"
            value={w(records.heaviestWeight.weightKg)}
            detail={`× ${records.heaviestWeight.reps} · ${formatDetailDate(records.heaviestWeight.date)}`}
          />
        )}
        {records.bestSetVolume && (
          <StatCard
            label="Best set volume"
            value={vol(records.bestSetVolume.volumeKg)}
            detail={`${w(records.bestSetVolume.set.weightKg)} × ${records.bestSetVolume.set.reps} · ${formatDetailDate(records.bestSetVolume.date)}`}
          />
        )}
        {records.bestSessionVolume && (
          <StatCard
            label="Best session volume"
            value={vol(records.bestSessionVolume.volumeKg)}
            detail={formatDetailDate(records.bestSessionVolume.date)}
          />
        )}
      </div>

      {/* Rep records table */}
      <div>
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
          Rep records
        </p>
        <div className="bg-surface-800/40 rounded-lg overflow-hidden">
          <table className="w-full text-sm" data-testid="exercise-detail-rep-records">
            <thead>
              <tr className="text-[11px] text-surface-500 uppercase tracking-wider border-b border-surface-800">
                <th className="text-left font-medium px-3 py-2">Reps</th>
                <th className="text-right font-medium px-3 py-2">Best weight</th>
                <th className="text-right font-medium px-3 py-2">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/60">
              {repRows.map((reps) => {
                const record = repRecordByReps.get(reps);
                return (
                  <tr key={reps}>
                    <td className="px-3 py-1.5 text-surface-300">{reps}</td>
                    <td className="px-3 py-1.5 text-right">
                      {record ? (
                        <span className="text-surface-100 font-medium">{w(record.weightKg)}</span>
                      ) : (
                        <span className="text-surface-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs text-surface-500">
                      {record ? formatDetailDate(record.date) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-surface-600 mt-1.5">
          Heaviest weight ever logged for at least that many reps.
        </p>
      </div>

      {/* Lifetime */}
      <div>
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
          Lifetime
        </p>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Sets" value={records.lifetime.totalSets.toLocaleString()} />
          <StatCard label="Volume" value={vol(records.lifetime.totalVolumeKg)} />
          <StatCard
            label="First logged"
            value={records.lifetime.firstDate ? formatDetailDate(records.lifetime.firstDate) : '—'}
          />
        </div>
      </div>
    </div>
  );
}
