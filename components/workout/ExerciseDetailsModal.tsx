'use client';

/**
 * Exercise detail sheet — tabbed (About / History / Charts / Records) under a
 * compact header, modeled on Strong's exercise view.
 *
 * - Reference material a user reads once lives in About; personal data they
 *   consult constantly lives in History/Charts/Records.
 * - Defaults to History when the exercise has logged sessions, About when new.
 * - History renders from the persisted React Query cache so the sheet opens
 *   fast mid-workout; Charts/Records derive lazily on first tab visit
 *   (their components only mount then).
 *
 * Data derivations are pure and live in `services/exerciseDetailAnalytics.ts`;
 * the fetch lives in `hooks/useExerciseDetailHistory.ts`.
 */

import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui';
import type { Exercise } from '@/types/schema';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useExerciseDetailHistory } from '@/hooks/useExerciseDetailHistory';
import { resolveProgressionModel } from '@/services/suggestionEngine/repTotalPolicy';
import { isNormalDetailSet } from '@/services/exerciseDetailAnalytics';
import { estimateE1RMFromRpe } from '@/services/shared/e1rm';
import { HISTORY_SESSIONS_PER_EXERCISE } from '@/services/suggestionEngine/constants';
import { resolveDefaultTab, type ExerciseDetailTab } from '@/services/exerciseDetailAnalytics';
import { getFailureSafetyTier, getTierDisplayInfo } from '@/services/exerciseSafety';
import { convertWeightForDisplay } from '@/lib/utils';
import { getExerciseProp, getTierBadgeClasses } from './exercise-details/helpers';
import { AboutTab } from './exercise-details/AboutTab';
import { HistoryTab } from './exercise-details/HistoryTab';
import { ChartsTab } from './exercise-details/ChartsTab';
import { RecordsTab } from './exercise-details/RecordsTab';
import { ExerciseEditForm } from './exercise-details/ExerciseEditForm';

interface ExerciseDetailsModalProps {
  exercise: Exercise | null;
  isOpen: boolean;
  onClose: () => void;
  unit?: 'kg' | 'lb';
  /**
   * Workout-context chips (only meaningful when opened from an active
   * session). These carry the metadata the exercise card's title row no
   * longer shows: position among non-skipped exercises ("3/8") and logged
   * set count ("2/3 sets").
   */
  positionLabel?: string;
  setCountLabel?: string;
}

const TABS: { id: ExerciseDetailTab; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'history', label: 'History' },
  { id: 'charts', label: 'Charts' },
  { id: 'records', label: 'Records' },
];

/**
 * Header metadata block — line 2 chips (tier · caution · workout context ·
 * muscle · equipment · pattern) plus the caution reason and compact
 * last-session lines. This is where the metadata removed from the workout
 * card's title area (grade, caution flag + reason, muscle group, position,
 * set count, last session) now renders.
 */
function DetailHeaderMeta({
  exercise,
  positionLabel,
  setCountLabel,
  lastSessionSummary,
}: {
  exercise: Exercise;
  positionLabel?: string;
  setCountLabel?: string;
  lastSessionSummary: string | null;
}) {
  const tier = getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score')?.tier;
  const primaryMuscle = getExerciseProp(exercise, 'primaryMuscle', 'primary_muscle');
  const movementPattern = getExerciseProp(exercise, 'movementPattern', 'movement_pattern');
  const equipmentRequired = getExerciseProp(exercise, 'equipmentRequired', 'equipment_required');
  const equipmentLabel =
    Array.isArray(equipmentRequired) && equipmentRequired.length > 0
      ? equipmentRequired[0]
      : getExerciseProp(exercise, 'equipment', 'equipment');

  // Caution flag (failure-safety tier) with its reason — the metadata the
  // workout card's header line used to badge ("Caution"/"Protect"); the card
  // now signals it only via the amber (i) tint and points here for the why.
  const safetyTier = getFailureSafetyTier(exercise.name);
  const safetyInfo = getTierDisplayInfo(safetyTier);
  const isCautioned = safetyTier !== 'push_freely';

  const chip = (label: string, key: string) => (
    <span
      key={key}
      className="px-2 py-0.5 rounded-full bg-surface-800 text-surface-300 text-xs capitalize"
    >
      {label}
    </span>
  );

  return (
    <>
      {/* Line 2: tier · caution · position/sets (workout context) · muscle ·
          equipment · pattern as one wrapping chip row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {tier && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getTierBadgeClasses(tier)}`}>
            Tier {tier}
          </span>
        )}
        {isCautioned && (
          <span
            data-testid="exercise-detail-caution"
            className="px-2 py-0.5 rounded-full bg-warning-500/15 text-warning-400 text-xs font-medium"
          >
            ⚠ {safetyInfo.shortLabel}
          </span>
        )}
        {positionLabel && chip(`Exercise ${positionLabel}`, 'position')}
        {setCountLabel && chip(setCountLabel, 'set-count')}
        {primaryMuscle && chip(String(primaryMuscle), 'muscle')}
        {equipmentLabel && chip(String(equipmentLabel), 'equipment')}
        {movementPattern && chip(String(movementPattern).replace(/_/g, ' '), 'pattern')}
      </div>

      {/* Caution reason — why this exercise carries the flag */}
      {isCautioned && (
        <p className="mt-2 text-xs text-warning-400/90">{safetyInfo.description}</p>
      )}

      {/* Compact last-session summary (full history lives in the History tab) */}
      {lastSessionSummary && (
        <p data-testid="exercise-detail-last-session" className="mt-2 text-xs text-surface-400">
          {lastSessionSummary}
        </p>
      )}
    </>
  );
}

/**
 * Compact last-session summary (most recent completed session), mirroring the
 * workout card's old header meta line: "60 lbs × 9, × 8 @ 2 RIR".
 */
function buildLastSessionSummary(
  session:
    | {
        date: string;
        sets: {
          weightKg: number;
          reps: number;
          rpe: number | null;
          bw?: { modification: 'none' | 'weighted' | 'assisted'; addedWeightKg?: number; assistanceWeightKg?: number };
        }[];
      }
    | undefined,
  unit: 'kg' | 'lb',
  isDuration = false
): string | null {
  if (!session || session.sets.length === 0) return null;
  const first = session.sets[0];
  const repsPart = session.sets
    .slice(0, 3)
    .map((s) => `× ${s.reps}${isDuration ? 's' : ''}`)
    .join(', ');
  const rir = first.rpe != null ? Math.max(0, Math.round(10 - first.rpe)) : null;
  const unitLabel = unit === 'lb' ? 'lbs' : 'kg';
  const date = new Date(session.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  // Bodyweight sets with a recorded breakdown lead with the composition
  // ("BW+25 lbs") instead of the blended effective load.
  const weightPart = first.bw
    ? first.bw.modification === 'weighted' && (first.bw.addedWeightKg ?? 0) > 0
      ? `BW+${convertWeightForDisplay(first.bw.addedWeightKg!, unit)} ${unitLabel}`
      : first.bw.modification === 'assisted' && (first.bw.assistanceWeightKg ?? 0) > 0
        ? `BW−${convertWeightForDisplay(first.bw.assistanceWeightKg!, unit)} ${unitLabel}`
        : 'BW'
    : `${convertWeightForDisplay(first.weightKg, unit)} ${unitLabel}`;
  return `Last session (${date}): ${weightPart} ${repsPart}${
    rir !== null ? ` @ ${rir} RIR` : ''
  }`;
}

export function ExerciseDetailsModal({
  exercise,
  isOpen,
  onClose,
  unit = 'kg',
  positionLabel,
  setCountLabel,
}: ExerciseDetailsModalProps) {
  const { inset: keyboardInset, scrollContainerRef } =
    useKeyboardInset<HTMLDivElement>(isOpen);
  const [isEditing, setIsEditing] = useState(false);
  // null = default tab not resolved yet (depends on whether history exists)
  const [activeTab, setActiveTab] = useState<ExerciseDetailTab | null>(null);

  const exerciseId = exercise?.id ?? null;
  const historyQuery = useExerciseDetailHistory(exerciseId, isOpen);
  const sessions = historyQuery.data;

  // rep_total routing (ADD 2 follow-up): the detail sheet must not present
  // e1RM-derived records/charts for a rep_total exercise. Same resolution
  // rule as the workout card: explicit progression_model wins; NULL
  // auto-classifies from the recent window's estimability under the
  // canonical estimator (majority of normal sets beyond its domain).
  const repTotalMode = useMemo(() => {
    if (!exercise) return false;
    const explicit =
      ((exercise as any).progressionModel ?? (exercise as any).progression_model ?? null) as
        | 'e1rm'
        | 'rep_total'
        | null;
    let estimable = 0;
    let inestimable = 0;
    for (const session of (sessions ?? [])
      .filter((sn) => !sn.isDeload)
      .slice(0, HISTORY_SESSIONS_PER_EXERCISE)) {
      for (const set of session.sets) {
        // Same eligibility as the workout card's classification: NORMAL sets
        // only — a stack of high-rep dropsets must not flip this sheet to
        // rep-total while the card stays on e1RM.
        if (!isNormalDetailSet(set)) continue;
        if (estimateE1RMFromRpe(set.weightKg, set.reps, set.rpe)) estimable++;
        else inestimable++;
      }
    }
    return resolveProgressionModel(explicit, estimable, inestimable) === 'rep_total';
  }, [exercise, sessions]);

  // Reset per exercise / per open.
  useEffect(() => {
    setActiveTab(null);
    setIsEditing(false);
  }, [exerciseId, isOpen]);

  // Resolve the default tab once we know whether history exists: a familiar
  // exercise is a lookup (History), a new one is a learning moment (About).
  useEffect(() => {
    if (!isOpen || activeTab !== null) return;
    if (sessions !== undefined) {
      setActiveTab(resolveDefaultTab(sessions.length));
    } else if (historyQuery.isError) {
      setActiveTab('about');
    }
  }, [isOpen, activeTab, sessions, historyQuery.isError]);

  if (!isOpen || !exercise) return null;

  const sessionCount = sessions?.length ?? 0;
  const lastSessionSummary = buildLastSessionSummary(
    sessions?.[0],
    unit,
    getExerciseProp(exercise, 'exerciseType', 'exercise_type') === 'duration_based'
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      style={{
        // Re-center above the on-screen keyboard; safe-area stays additive.
        paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px) + ${keyboardInset}px)`,
      }}
      onClick={onClose}
    >
      <Card
        ref={scrollContainerRef}
        variant="elevated"
        className="max-w-2xl w-full overflow-y-auto overflow-x-hidden"
        style={{ maxHeight: `min(90vh, calc(100vh - 2rem - ${keyboardInset}px))` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6">
          {/* Compact header — line 1: name · edit · close */}
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex-1 min-w-0 text-xl font-bold text-surface-100 break-words">
              {exercise.name}
            </h2>
            <div className="flex items-center gap-1 shrink-0">
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
                  aria-label="Edit exercise"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <DetailHeaderMeta
            exercise={exercise}
            positionLabel={positionLabel}
            setCountLabel={setCountLabel}
            lastSessionSummary={lastSessionSummary}
          />

          {isEditing ? (
            <div className="mt-4">
              <ExerciseEditForm exercise={exercise} onCancel={() => setIsEditing(false)} />
            </div>
          ) : (
            <>
              {/* Tab bar */}
              <div
                className="flex border-b border-surface-800 mt-3 -mx-4 px-4 sm:-mx-6 sm:px-6"
                role="tablist"
              >
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={isActive}
                      data-testid={`exercise-detail-tab-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        isActive
                          ? 'text-primary-400 border-primary-500'
                          : 'text-surface-400 border-transparent hover:text-surface-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab content — only the active tab mounts, so Charts/Records
                  derive their data lazily on first visit. */}
              <div className="pt-4" key={exercise.id}>
                {activeTab === null && (
                  <div className="space-y-2" data-testid="exercise-detail-resolving">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-14 rounded-lg bg-surface-800/50 animate-pulse" />
                    ))}
                  </div>
                )}
                {activeTab === 'about' && (
                  <AboutTab exercise={exercise} sessionCount={sessionCount} />
                )}
                {activeTab === 'history' && (
                  <HistoryTab
                    sessions={sessions}
                    isLoading={historyQuery.isLoading}
                    unit={unit}
                    repTotalMode={repTotalMode}
                    isDuration={
                      getExerciseProp(exercise, 'exerciseType', 'exercise_type') ===
                      'duration_based'
                    }
                  />
                )}
                {activeTab === 'charts' && (
                  <ChartsTab sessions={sessions} unit={unit} repTotalMode={repTotalMode} />
                )}
                {activeTab === 'records' && (
                  <RecordsTab sessions={sessions} unit={unit} repTotalMode={repTotalMode} />
                )}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
