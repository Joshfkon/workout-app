'use client';

import type { CoarseMuscle } from '@/services/volumeBands';
import type { TargetChip, SetupShortcuts } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/setup/targetPicker';
import type { ReadinessStatus } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readinessStatus';
import type { RecentSessionSummary } from '@/services/workoutSetup/types';
import { SETUP_CONFIG } from '@/services/workoutSetup/config';

/** Status dot colours — Fresh/Recovering match the readiness badges; unknown is grey. */
const STATUS_DOT: Record<ReadinessStatus, string> = {
  fresh: 'bg-success-500',
  recovering: 'bg-warning-500',
  fatigued: 'bg-danger-500',
  unknown: 'bg-surface-600',
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  fresh: 'Fresh',
  recovering: 'Recovering',
  fatigued: 'Fatigued',
  unknown: 'No recent data',
};

export interface TargetPickerProps {
  chips: TargetChip[];
  selected: ReadonlySet<CoarseMuscle>;
  onToggle: (group: CoarseMuscle) => void;
  shortcuts: SetupShortcuts;
  onRepeatType: (groups: CoarseMuscle[]) => void;
  onLoadSession: (session: RecentSessionSummary) => void;
  timeBudget: number | null;
  onTimeBudgetChange: (minutes: number | null) => void;
  onBuild: () => void;
  onBuildManually: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

function daysAgoLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function DeficitMeter({ chip }: { chip: TargetChip }) {
  if (chip.status === 'unknown') return null;
  const pct = chip.zoneMin > 0 ? Math.min(100, (chip.weeklyCredited / chip.zoneMin) * 100) : 100;
  return (
    <span className="flex items-center gap-1" aria-hidden>
      <span className="relative h-1 w-8 overflow-hidden rounded-full bg-surface-700">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${chip.deficit > 0 ? 'bg-primary-400' : 'bg-success-500'}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[10px] tabular-nums text-surface-400">
        {Math.round(chip.weeklyCredited)}/{chip.zoneMin}
      </span>
    </span>
  );
}

export function TargetPicker({
  chips,
  selected,
  onToggle,
  shortcuts,
  onRepeatType,
  onLoadSession,
  timeBudget,
  onTimeBudgetChange,
  onBuild,
  onBuildManually,
  disabled = false,
  isLoading = false,
}: TargetPickerProps) {
  const budgetOptions: (number | null)[] = [...SETUP_CONFIG.timeBudgetOptions, null];
  const hasShortcuts = shortcuts.repeatType !== null || shortcuts.recentSessions.length > 0;

  return (
    <div className="mt-6 flex flex-col gap-5" data-testid="setup-target-picker">
      <div>
        <h2 className="text-lg font-semibold text-surface-100">What are you training?</h2>
        <p className="text-sm text-surface-400">
          Good targets are pre-selected. Tap to change.
        </p>
      </div>

      {hasShortcuts && (
        <div className="-mx-4 px-4 flex gap-2 overflow-x-auto pb-1" data-testid="setup-shortcuts">
          {shortcuts.repeatType && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRepeatType(shortcuts.repeatType!.groups)}
              className="flex-shrink-0 rounded-full border border-surface-700 bg-surface-800 px-3.5 py-2 text-sm text-surface-200 hover:bg-surface-700 disabled:opacity-50"
              data-testid="setup-shortcut-repeat-type"
            >
              ↻ Repeat last {shortcuts.repeatType.label}
            </button>
          )}
          {shortcuts.recentSessions.map(({ session, label, daysAgo }) => (
            <button
              key={session.sessionId}
              type="button"
              disabled={disabled}
              onClick={() => onLoadSession(session)}
              className="flex-shrink-0 rounded-full border border-surface-700 bg-surface-900 px-3.5 py-2 text-sm text-surface-300 hover:bg-surface-800 disabled:opacity-50"
              data-testid={`setup-shortcut-session-${session.sessionId}`}
            >
              {label} · {daysAgoLabel(daysAgo)}
            </button>
          ))}
        </div>
      )}

      {isLoading && chips.length === 0 ? (
        <div className="grid grid-cols-2 gap-2" data-testid="setup-chips-skeleton">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-14 rounded-xl bg-surface-800/60 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Muscle groups">
          {chips.map((chip) => {
            const isSelected = selected.has(chip.group);
            return (
              <button
                key={chip.group}
                type="button"
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => onToggle(chip.group)}
                className={`min-h-14 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  isSelected
                    ? 'border-primary-500 bg-primary-500/15'
                    : 'border-surface-800 bg-surface-900 hover:bg-surface-800'
                }`}
                data-testid={`setup-chip-${chip.group}`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[chip.status]}`}
                    title={STATUS_LABEL[chip.status]}
                  />
                  <span className={`truncate text-sm font-medium ${isSelected ? 'text-surface-50' : 'text-surface-200'}`}>
                    {chip.displayName}
                  </span>
                </span>
                <span className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-surface-500">{STATUS_LABEL[chip.status]}</span>
                  <DeficitMeter chip={chip} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs text-surface-500">Time budget</p>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Time budget">
          {budgetOptions.map((opt) => {
            const active = timeBudget === opt;
            return (
              <button
                key={opt ?? 'none'}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => onTimeBudgetChange(opt)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-primary-500 text-white' : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                }`}
                data-testid={`setup-budget-${opt ?? 'none'}`}
              >
                {opt === null ? 'None' : `${opt}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Thumb-reachable primary action. */}
      <div className="sticky bottom-0 -mx-4 bg-surface-950/95 px-4 pb-3 pt-2 backdrop-blur">
        <button
          type="button"
          onClick={onBuild}
          disabled={disabled || selected.size === 0}
          className="w-full rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 py-4 text-lg font-semibold text-white shadow-lg shadow-purple-500/25 transition-all active:scale-[0.99] disabled:opacity-50"
          data-testid="setup-build-plan"
        >
          Build plan{selected.size > 0 ? ` · ${selected.size} group${selected.size === 1 ? '' : 's'}` : ''}
        </button>
        <button
          type="button"
          onClick={onBuildManually}
          disabled={disabled}
          className="mt-2 w-full py-2 text-sm font-medium text-surface-400 hover:text-surface-200 disabled:opacity-50"
          data-testid="setup-build-manually"
        >
          Build manually
        </button>
      </div>
    </div>
  );
}
