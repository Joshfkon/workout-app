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

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui';
import type { Exercise } from '@/types/schema';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useExerciseDetailHistory } from '@/hooks/useExerciseDetailHistory';
import { resolveDefaultTab, type ExerciseDetailTab } from '@/services/exerciseDetailAnalytics';
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
}

const TABS: { id: ExerciseDetailTab; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'history', label: 'History' },
  { id: 'charts', label: 'Charts' },
  { id: 'records', label: 'Records' },
];

export function ExerciseDetailsModal({ exercise, isOpen, onClose, unit = 'kg' }: ExerciseDetailsModalProps) {
  const { inset: keyboardInset, scrollContainerRef } =
    useKeyboardInset<HTMLDivElement>(isOpen);
  const [isEditing, setIsEditing] = useState(false);
  // null = default tab not resolved yet (depends on whether history exists)
  const [activeTab, setActiveTab] = useState<ExerciseDetailTab | null>(null);

  const exerciseId = exercise?.id ?? null;
  const historyQuery = useExerciseDetailHistory(exerciseId, isOpen);
  const sessions = historyQuery.data;

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

  const tier = getExerciseProp(exercise, 'hypertrophyScore', 'hypertrophy_score')?.tier;
  const primaryMuscle = getExerciseProp(exercise, 'primaryMuscle', 'primary_muscle');
  const movementPattern = getExerciseProp(exercise, 'movementPattern', 'movement_pattern');
  const equipmentRequired = getExerciseProp(exercise, 'equipmentRequired', 'equipment_required');
  const equipmentLabel =
    Array.isArray(equipmentRequired) && equipmentRequired.length > 0
      ? equipmentRequired[0]
      : getExerciseProp(exercise, 'equipment', 'equipment');

  const chip = (label: string, key: string) => (
    <span
      key={key}
      className="px-2 py-0.5 rounded-full bg-surface-800 text-surface-300 text-xs capitalize"
    >
      {label}
    </span>
  );

  const sessionCount = sessions?.length ?? 0;

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

          {/* Line 2: tier · muscle · equipment · pattern as one wrapping chip row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {tier && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getTierBadgeClasses(tier)}`}>
                Tier {tier}
              </span>
            )}
            {primaryMuscle && chip(String(primaryMuscle), 'muscle')}
            {equipmentLabel && chip(String(equipmentLabel), 'equipment')}
            {movementPattern && chip(String(movementPattern).replace(/_/g, ' '), 'pattern')}
          </div>

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
                  />
                )}
                {activeTab === 'charts' && <ChartsTab sessions={sessions} unit={unit} />}
                {activeTab === 'records' && <RecordsTab sessions={sessions} unit={unit} />}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
