'use client';

import { useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { BottomSheet } from '../BottomSheet';
import type { PlanEdit } from '@/services/workoutSetup/planEdits';
import type { GroupProjection, PlanWarning } from '@/services/workoutSetup/planProjection';
import type { SwapCandidate, SwapSearchResult } from '@/services/workoutSetup/swapRanking';
import type { PlanItem, SetupExercise } from '@/services/workoutSetup/types';
import { SETUP_CONFIG } from '@/services/workoutSetup/config';

export interface DraftPlanEditorProps {
  items: PlanItem[];
  exercisesById: ReadonlyMap<string, SetupExercise>;
  projection: GroupProjection[];
  estimatedMinutes: number;
  timeBudget: number | null;
  warnings: PlanWarning[];
  /** Sets the generator trimmed to fit the budget (shown once, as context). */
  trimmedSets: number;
  /** Selected groups with no usable exercise at this gym. */
  unfilledGroups: string[];
  onEdit: (edit: PlanEdit) => void;
  /** Swap sheet results for a free-text query ('' = ranked recommendations). */
  searchSwaps: (item: PlanItem, query: string) => SwapSearchResult;
  onAddExercise: () => void;
  onBack: () => void;
  onStart: () => void;
  isStarting?: boolean;
  startError?: string | null;
  /** Inline content under a row (AI suggestions) — optional slot. */
  renderRowExtra?: (item: PlanItem) => React.ReactNode;
  /** Extra footer actions (the Review button) — optional slot. */
  secondaryAction?: React.ReactNode;
  /** Banner above the list (AI summary) — optional slot. */
  banner?: React.ReactNode;
}

function muscleLabel(token: string): string {
  const s = token.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PlanRow({
  item,
  exercise,
  index,
  onEdit,
  onSwap,
  extra,
}: {
  item: PlanItem;
  exercise: SetupExercise | undefined;
  index: number;
  onEdit: (edit: PlanEdit) => void;
  onSwap: () => void;
  extra?: React.ReactNode;
}) {
  const controls = useDragControls();
  const name = exercise?.name ?? 'Unknown exercise';
  const muscles = exercise
    ? [exercise.primaryMuscle, ...exercise.secondaryMuscles.slice(0, 2)].map(muscleLabel).join(' · ')
    : '';

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="list-none rounded-card bg-card shadow-card"
      data-testid={`setup-row-${item.itemId}`}
    >
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          aria-label={`Drag to reorder ${name}`}
          onPointerDown={(e) => controls.start(e)}
          className="-ml-1 flex h-11 w-7 flex-shrink-0 touch-none items-center justify-center text-ink-3 hover:text-ink-2"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <circle cx="7" cy="5" r="1.4" /><circle cx="13" cy="5" r="1.4" />
            <circle cx="7" cy="10" r="1.4" /><circle cx="13" cy="10" r="1.4" />
            <circle cx="7" cy="15" r="1.4" /><circle cx="13" cy="15" r="1.4" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-subhead font-medium text-ink">
              <span className="mr-1 text-ink-3 tabular-nums">{index + 1}.</span>
              {name}
            </p>
            <div className="flex flex-shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={onSwap}
                aria-label={`Swap ${name}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-fill hover:text-ink"
                data-testid={`setup-swap-${item.itemId}`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onEdit({ type: 'remove', itemId: item.itemId })}
                aria-label={`Remove ${name}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-fill hover:text-status-bad"
                data-testid={`setup-remove-${item.itemId}`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <p className="truncate text-caption text-ink-3">{muscles}</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center rounded-lg bg-fill" role="group" aria-label="Sets">
              <button
                type="button"
                onClick={() => onEdit({ type: 'set_sets', itemId: item.itemId, sets: item.sets - 1 })}
                disabled={item.sets <= SETUP_CONFIG.minSetsPerItem}
                aria-label="Fewer sets"
                className="h-9 w-10 text-headline text-ink-2 disabled:opacity-30"
                data-testid={`setup-sets-dec-${item.itemId}`}
              >
                −
              </button>
              <span className="min-w-[3.5rem] text-center text-subhead tabular-nums text-ink" data-testid={`setup-sets-${item.itemId}`}>
                {item.sets} sets
              </span>
              <button
                type="button"
                onClick={() => onEdit({ type: 'set_sets', itemId: item.itemId, sets: item.sets + 1 })}
                disabled={item.sets >= SETUP_CONFIG.maxSetsPerItem}
                aria-label="More sets"
                className="h-9 w-10 text-headline text-ink-2 disabled:opacity-30"
                data-testid={`setup-sets-inc-${item.itemId}`}
              >
                +
              </button>
            </div>
            <span className="text-caption tabular-nums text-ink-2">
              {item.repRange[0]}–{item.repRange[1]} reps
            </span>
          </div>
          {extra}
        </div>
      </div>
    </Reorder.Item>
  );
}

function SwapOption({ candidate: c, onPick }: { candidate: SwapCandidate; onPick: (exercise: SetupExercise) => void }) {
  return (
    <li>
      <button
        type="button"
        disabled={!c.equipmentAvailable}
        onClick={() => onPick(c.exercise)}
        className="flex w-full items-center justify-between gap-3 py-3 text-left disabled:opacity-40"
        data-testid={`setup-swap-option-${c.exercise.id}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-subhead text-ink">{c.exercise.name}</span>
          <span className="block text-caption text-ink-3">
            {[
              !c.equipmentAvailable && 'Equipment unavailable',
              c.doneRecently && 'Done this week',
              c.usageCount > 0 && `Used ${c.usageCount}×`,
            ]
              .filter(Boolean)
              .join(' · ') || muscleLabel(c.exercise.primaryMuscle)}
          </span>
        </span>
        {c.exercise.tier && (
          <span className="flex-shrink-0 rounded bg-fill px-1.5 py-0.5 text-caption text-ink-2">
            {c.exercise.tier}
          </span>
        )}
      </button>
    </li>
  );
}

function SwapSheet({
  item,
  current,
  query,
  onQueryChange,
  results,
  onPick,
  onClose,
}: {
  item: PlanItem | null;
  current: SetupExercise | undefined;
  query: string;
  onQueryChange: (query: string) => void;
  results: SwapSearchResult;
  onPick: (exercise: SetupExercise) => void;
  onClose: () => void;
}) {
  const searching = query.trim().length > 0;
  const { matches, otherMatches } = results;
  return (
    <BottomSheet isOpen={item !== null} onClose={onClose} title={current ? `Swap ${current.name}` : 'Swap'}>
      <div className="px-4 pb-4" data-testid="setup-swap-sheet">
        <div className="pb-2">
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search all exercises"
            aria-label="Search exercises"
            autoComplete="off"
            enterKeyHint="search"
            className="w-full rounded-lg border border-sep bg-fill px-3 py-2.5 text-body text-ink placeholder:text-ink-3 focus:border-action focus:outline-none"
            data-testid="setup-swap-search"
          />
        </div>
        {matches.length === 0 && otherMatches.length === 0 ? (
          <p className="py-6 text-center text-subhead text-ink-2">
            {searching ? `No exercises match “${query.trim()}”.` : 'No alternatives for this muscle in your library.'}
          </p>
        ) : (
          <>
            {searching && matches.length > 0 && otherMatches.length > 0 && (
              <p className="pt-2 text-caption font-medium text-ink-3">Same muscle</p>
            )}
            <ul className="divide-y divide-sep">
              {matches.map((c) => (
                <SwapOption key={c.exercise.id} candidate={c} onPick={onPick} />
              ))}
            </ul>
            {otherMatches.length > 0 && (
              <>
                <p className="pt-4 text-caption font-medium text-ink-3" data-testid="setup-swap-other-heading">
                  Other exercises
                </p>
                <ul className="divide-y divide-sep">
                  {otherMatches.map((c) => (
                    <SwapOption key={c.exercise.id} candidate={c} onPick={onPick} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function ProjectionBar({ row }: { row: GroupProjection }) {
  const scale = Math.max(row.zoneMax, row.projected, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const fill =
    row.zone === 'over' ? 'bg-status-bad' : row.zone === 'in' ? 'bg-status-ok' : 'bg-action';
  return (
    <div className="flex items-center gap-2" data-testid={`setup-projection-${row.group}`}>
      <span className="w-20 flex-shrink-0 truncate text-caption text-ink-2">{row.displayName}</span>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
        <span className="absolute inset-y-0 bg-status-ok/10" style={{ left: pct(row.zoneMin), width: `calc(${pct(row.zoneMax)} - ${pct(row.zoneMin)})` }} />
        <span className={`absolute inset-y-0 left-0 rounded-full ${fill} opacity-50`} style={{ width: pct(row.projected) }} />
        <span className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: pct(row.weeklyCredited) }} />
      </span>
      <span className="w-20 flex-shrink-0 text-right text-caption tabular-nums text-ink-2">
        {row.weeklyCredited}+{row.planned} / {row.zoneMin}–{row.zoneMax}
      </span>
    </div>
  );
}

export function DraftPlanEditor({
  items,
  exercisesById,
  projection,
  estimatedMinutes,
  timeBudget,
  warnings,
  trimmedSets,
  unfilledGroups,
  onEdit,
  searchSwaps,
  onAddExercise,
  onBack,
  onStart,
  isStarting = false,
  startError = null,
  renderRowExtra,
  secondaryAction,
  banner,
}: DraftPlanEditorProps) {
  const [swapItemId, setSwapItemId] = useState<string | null>(null);
  const [swapQuery, setSwapQuery] = useState('');
  const swapItem = items.find((i) => i.itemId === swapItemId) ?? null;
  const selectedRows = projection.filter((r) => r.selected);
  const overBudget = timeBudget != null && estimatedMinutes > timeBudget;

  return (
    <div className="mt-4 flex flex-col gap-3" data-testid="setup-draft-editor">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="py-2 text-subhead text-ink-2 hover:text-ink" data-testid="setup-back">
          ← Targets
        </button>
        {trimmedSets > 0 && (
          <span className="text-caption text-ink-3">Trimmed {trimmedSets} sets to fit {timeBudget} min</span>
        )}
      </div>

      {banner}

      {unfilledGroups.length > 0 && (
        <p className="rounded-lg bg-fill/60 px-3 py-2 text-caption text-ink-2">
          No usable exercise for {unfilledGroups.join(', ')} at this gym — add one manually.
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-8 text-center text-subhead text-ink-2">No exercises in the plan yet.</p>
      ) : (
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={(next: PlanItem[]) => onEdit({ type: 'reorder', itemIds: next.map((i) => i.itemId) })}
          className="flex flex-col gap-2"
        >
          {items.map((item, index) => (
            <PlanRow
              key={item.itemId}
              item={item}
              index={index}
              exercise={exercisesById.get(item.exerciseId)}
              onEdit={onEdit}
              onSwap={() => {
                setSwapQuery('');
                setSwapItemId(item.itemId);
              }}
              extra={renderRowExtra?.(item)}
            />
          ))}
        </Reorder.Group>
      )}

      <button
        type="button"
        onClick={onAddExercise}
        className="rounded-xl border border-dashed border-sep py-3 text-subhead font-medium text-ink-2 hover:bg-card"
        data-testid="setup-add-exercise"
      >
        + Add exercise
      </button>

      {/* Pinned footer: weekly projection, duration, warnings, actions. */}
      <div className="sticky bottom-0 -mx-4 mt-2 border-t border-sep bg-canvas/95 px-4 pb-3 pt-3 backdrop-blur" data-testid="setup-footer">
        {selectedRows.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {selectedRows.map((row) => (
              <ProjectionBar key={row.group} row={row} />
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-caption">
          <span className={overBudget ? 'text-status-warn' : 'text-ink-2'} data-testid="setup-duration">
            ~{estimatedMinutes} min{timeBudget != null ? ` / ${timeBudget} budget` : ''}
          </span>
          <span className="text-ink-3">{items.reduce((n, i) => n + i.sets, 0)} working sets</span>
        </div>
        {warnings.filter((w) => w.severity === 'warn').length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-0.5" data-testid="setup-warnings">
            {warnings
              .filter((w) => w.severity === 'warn')
              .slice(0, 3)
              .map((w, k) => (
                <li key={`${w.kind}-${k}`} className="text-caption text-status-warn">
                  ⚠ {w.message}
                </li>
              ))}
          </ul>
        )}
        {startError && <p className="mt-1.5 text-caption text-status-bad" data-testid="setup-start-error">{startError}</p>}
        <div className="mt-3 flex gap-2">
          {secondaryAction}
          <button
            type="button"
            onClick={onStart}
            disabled={isStarting || items.length === 0}
            className="bg-action flex-1 rounded-2xl py-3.5 text-headline font-semibold text-on-action shadow-lg shadow-action/25 active:scale-[0.99] disabled:opacity-60"
            data-testid="setup-start"
          >
            {isStarting ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>

      <SwapSheet
        item={swapItem}
        current={swapItem ? exercisesById.get(swapItem.exerciseId) : undefined}
        query={swapQuery}
        onQueryChange={setSwapQuery}
        results={swapItem ? searchSwaps(swapItem, swapQuery) : { matches: [], otherMatches: [] }}
        onPick={(exercise) => {
          if (swapItem) onEdit({ type: 'swap', itemId: swapItem.itemId, exercise });
          setSwapItemId(null);
        }}
        onClose={() => setSwapItemId(null)}
      />
    </div>
  );
}
