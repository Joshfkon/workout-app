'use client';

/**
 * Per-entry editor for one measurement site — fix or remove a mislogged value
 * (e.g. a calf logged as a thigh). Rendered inside MeasurementTrendCard's
 * detail view with key={site} so all edit state resets on site switch. Calls
 * onChanged after a successful write so the card (and sibling widgets)
 * refetch.
 */

import { useState } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { MEASUREMENT_FIELDS } from '@/components/dashboard/BodyMeasurements';
import { cmToIn, inToCm } from '@/lib/utils';
import {
  updateMeasurementSiteEntry,
  deleteMeasurementSiteEntry,
} from '@/lib/body/bodyLog';

export function SiteEntriesEditor({
  site,
  label,
  entries,
  tapeUnit,
  onChanged,
}: {
  site: string;
  label: string;
  entries: { date: string; valueCm: number }[];
  tapeUnit: 'in' | 'cm';
  onChanged: () => void;
}) {
  const [showEntries, setShowEntries] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDeleteDate, setConfirmDeleteDate] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const startEdit = (entry: { date: string; valueCm: number }) => {
    setConfirmDeleteDate(null);
    setMutateError(null);
    setEditingDate(entry.date);
    setEditValue(
      (tapeUnit === 'in' ? cmToIn(entry.valueCm) : entry.valueCm).toFixed(1)
    );
  };

  const runMutation = async (fn: (userId: string) => Promise<void>) => {
    setIsMutating(true);
    setMutateError(null);
    try {
      const supabase = createUntypedClient();
      // Local session read — getUser() hits the network and reads a blip as
      // "logged out"; RLS still verifies the token on the write itself.
      const userId = await getLocalUserId(supabase);
      if (!userId) throw new Error('Not signed in');
      await fn(userId);
      setEditingDate(null);
      setConfirmDeleteDate(null);
      onChanged();
    } catch (err) {
      console.error('Failed to update measurement entry:', err);
      setMutateError('Could not save that change — try again.');
    } finally {
      setIsMutating(false);
    }
  };

  const saveEdit = (date: string) => {
    const parsed = parseFloat(editValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMutateError('Enter a value greater than 0.');
      return;
    }
    const valueCm = tapeUnit === 'in' ? inToCm(parsed) : parsed;
    return runMutation((userId) =>
      updateMeasurementSiteEntry(
        createUntypedClient(),
        userId,
        date,
        site,
        Math.round(valueCm * 100) / 100
      )
    );
  };

  const deleteEntry = (date: string) =>
    runMutation((userId) =>
      deleteMeasurementSiteEntry(
        createUntypedClient(),
        userId,
        date,
        site,
        MEASUREMENT_FIELDS.map((f) => f.key)
      )
    );

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setShowEntries((s) => !s)}
        data-testid="measurement-entries-toggle"
        className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
      >
        {showEntries ? 'Hide entries' : `Edit entries (${entries.length})`}
      </button>
      {showEntries && (
        <div
          className="mt-2 space-y-1 max-h-56 overflow-y-auto"
          data-testid="measurement-entries-list"
        >
          {entries.map((entry) => (
            <div
              key={entry.date}
              className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-surface-800/40"
              data-testid={`measurement-entry-${entry.date}`}
            >
              <span className="text-xs text-surface-400">
                {new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              {editingDate === entry.date ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    data-testid="measurement-entry-input"
                    className="w-16 px-2 py-0.5 text-sm bg-surface-900 border border-surface-700 rounded text-surface-100 text-center"
                    aria-label={`${label} on ${entry.date}`}
                  />
                  <span className="text-xs text-surface-500">{tapeUnit}</span>
                  <button
                    type="button"
                    onClick={() => saveEdit(entry.date)}
                    disabled={isMutating}
                    data-testid="measurement-entry-save"
                    className="text-xs font-medium text-primary-400 hover:text-primary-300 disabled:opacity-50 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDate(null);
                      setMutateError(null);
                    }}
                    disabled={isMutating}
                    className="text-xs text-surface-500 hover:text-surface-300 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : confirmDeleteDate === entry.date ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-danger-400">Delete this entry?</span>
                  <button
                    type="button"
                    onClick={() => deleteEntry(entry.date)}
                    disabled={isMutating}
                    data-testid="measurement-entry-delete-confirm"
                    className="text-xs font-medium text-danger-400 hover:text-danger-300 disabled:opacity-50 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteDate(null)}
                    disabled={isMutating}
                    className="text-xs text-surface-500 hover:text-surface-300 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-surface-200">
                    {(tapeUnit === 'in' ? cmToIn(entry.valueCm) : entry.valueCm).toFixed(1)}{' '}
                    {tapeUnit}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(entry)}
                    data-testid={`measurement-entry-edit-${entry.date}`}
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDate(null);
                      setMutateError(null);
                      setConfirmDeleteDate(entry.date);
                    }}
                    data-testid={`measurement-entry-delete-${entry.date}`}
                    className="text-xs text-surface-500 hover:text-danger-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {mutateError && (
        <p className="text-xs text-danger-400 mt-1.5" data-testid="measurement-entry-error">
          {mutateError}
        </p>
      )}
    </div>
  );
}
