'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui';
import { convertWeightForDisplay, convertWeight, sumDisplayVolume } from '@/lib/utils';
import {
  effortColorClass,
  isNormalDetailSet,
  setRir,
  type ExerciseDetailSession,
} from '@/services/exerciseDetailAnalytics';
import { formatDetailDate } from './helpers';

const PAGE_SIZE = 20;

interface HistoryTabProps {
  sessions: ExerciseDetailSession[] | undefined;
  isLoading: boolean;
  unit: 'kg' | 'lb';
  /** duration_based exercise: seconds live in `reps`, so no tonnage line. */
  isDuration?: boolean;
  /** rep_total exercise: show session rep totals, never an e1RM (ADD 2). */
  repTotalMode?: boolean;
}

function setLabel(weightKg: number, reps: number, unit: 'kg' | 'lb'): string {
  return `${convertWeightForDisplay(weightKg, unit, 1)} ${unit} × ${reps}`;
}

export function HistoryTab({ sessions, isLoading, unit, repTotalMode = false, isDuration = false }: HistoryTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (isLoading && !sessions) {
    return (
      <div className="space-y-2" data-testid="exercise-detail-history-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-fill/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="text-center py-10" data-testid="exercise-detail-history-empty">
        <svg className="w-12 h-12 mx-auto text-ink-3 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-ink-2 text-subhead">No workout history for this exercise yet</p>
        <p className="text-ink-3 text-caption mt-1">Add it to a workout to start tracking progress!</p>
      </div>
    );
  }

  const visible = sessions.slice(0, visibleCount);

  return (
    <div className="space-y-2" data-testid="exercise-detail-history-list">
      {visible.map((session) => {
        const isExpanded = expandedId === session.sessionId;
        return (
          <div key={session.sessionId} className="bg-fill/40 rounded-lg overflow-hidden">
            {/* One-line summary: date · top set · total volume */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : session.sessionId)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-fill/70 transition-colors"
              aria-expanded={isExpanded}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-subhead font-medium text-ink">
                    {formatDetailDate(session.date)}
                  </span>
                  {session.locationName && (
                    <Badge variant="outline" size="sm">{session.locationName}</Badge>
                  )}
                  {session.isDeload && (
                    <Badge variant="info" size="sm">Deload</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-caption text-ink-2 mt-0.5">
                  {session.topSet && (
                    <span>Top: {setLabel(session.topSet.weightKg, session.topSet.reps, unit)}</span>
                  )}
                  {!isDuration && (
                    <>
                      <span>·</span>
                      <span>
                        {/* Native-unit volume: per-set conversion first, so
                            160×12×4 reads 7,680 — not the kg-roundtrip 7,679.
                            Hidden for duration exercises: seconds×weight is
                            not tonnage (Codex P2 on #569). */}
                        {sumDisplayVolume(session.sets, unit, {
                          exerciseType: 'rep_based',
                        }).toLocaleString()}{' '}
                        {unit}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <svg
                className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded: per-set rows + session best e1RM */}
            {isExpanded && (
              <div className="px-3 pb-3 space-y-1 border-t border-sep">
                <div className="pt-2 space-y-1">
                  {session.sets.map((set, idx) => {
                    const rir = setRir(set.rpe);
                    return (
                      <div key={idx} className="flex items-center gap-2 text-subhead">
                        <span className="text-ink-3 text-caption w-5">{idx + 1}</span>
                        <span className="text-ink">
                          {setLabel(set.weightKg, set.reps, unit)}
                        </span>
                        {rir !== null && (
                          <span className={`text-caption font-medium ${effortColorClass(set.rpe)}`}>
                            @ {rir} RIR
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {repTotalMode ? (
                  // rep_total: the progression metric IS the session total —
                  // no e1RM exists for this exercise.
                  <p className="text-caption text-ink-3 pt-1">
                    Session rep total:{' '}
                    <span className="text-action font-medium">
                      {/* Straight sets only — same rule the rep_total policy grades. */}
                      {session.sets
                        .filter(isNormalDetailSet)
                        .reduce((sum, st) => sum + st.reps, 0)}{' '}
                      reps
                    </span>
                  </p>
                ) : (
                  session.bestE1RM > 0 && (
                    <p className="text-caption text-ink-3 pt-1">
                      Session best e1RM:{' '}
                      <span className="text-action font-medium">
                        {Math.round(convertWeight(session.bestE1RM, 'kg', unit))} {unit}
                      </span>
                    </p>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}

      {sessions.length > visibleCount && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="w-full py-2.5 text-subhead text-action bg-fill/40 hover:bg-fill/70 rounded-lg transition-colors"
        >
          Show older sessions ({sessions.length - visibleCount} more)
        </button>
      )}
    </div>
  );
}
