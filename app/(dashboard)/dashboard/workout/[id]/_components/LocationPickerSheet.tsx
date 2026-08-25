'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconMapPin, IconPlus } from '@tabler/icons-react';
import { BottomSheet } from '@/components/workout';

/** A training location as the picker needs it. */
export interface PickerLocation {
  id: string;
  name: string;
  is_default?: boolean;
}

/**
 * What the picker is choosing a location FOR.
 *
 * `session` sets the whole workout's location; `exercise` overrides it for one
 * block. They differ in exactly two ways — the exercise scope offers an
 * "inherit the session" row (which the session scope has nothing to inherit
 * from), and the copy names the exercise — so they share one component rather
 * than drifting into two pickers that disagree about what a location means.
 */
export type LocationPickerScope =
  | { kind: 'session' }
  | { kind: 'exercise'; exerciseName: string; sessionLocationName: string | null };

interface LocationPickerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  scope: LocationPickerScope;
  locations: PickerLocation[];
  /** Currently stored value: a location id, or null (unset / inheriting). */
  selectedId: string | null;
  /** Sets already logged under the current value — the re-stamp cost, shown up front. */
  loggedSetCount: number;
  onSelect: (locationId: string | null) => void;
  /** Creates a location and returns it, so the picker can select it immediately. */
  onCreate: (name: string) => Promise<PickerLocation | null>;
}

/**
 * Choose where a workout — or one exercise inside it — is being trained.
 *
 * This exists because load is not comparable across implements: 320 lb on one
 * gym's hip adduction machine is a different resistance from 320 lb on
 * another's, so mixing them into one history produces suggestions that fit
 * neither. The location is the key those histories are filed under
 * (services/progressionScope), and this sheet is the one-tap way to set it at
 * the moment the user actually knows it — sitting at the machine, not before
 * the workout started.
 *
 * Two things are stated rather than left to be discovered: how many
 * already-logged sets will move onto the new track, and — for the exercise
 * scope — that this is the switch for "a different machine for this one lift".
 */
export function LocationPickerSheet({
  isOpen,
  onClose,
  scope,
  locations,
  selectedId,
  loggedSetCount,
  onSelect,
  onCreate,
}: LocationPickerSheetProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reopening the sheet must not resume a half-typed name from last time.
  useEffect(() => {
    if (!isOpen) {
      setIsAdding(false);
      setNewName('');
      setCreateError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    setCreateError(null);
    try {
      const created = await onCreate(name);
      if (!created) {
        setCreateError("Couldn't save that location — try again.");
        return;
      }
      setIsAdding(false);
      setNewName('');
      onSelect(created.id);
    } finally {
      setIsSaving(false);
    }
  };

  const title = scope.kind === 'session' ? 'Where are you training?' : 'Which machine?';

  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-colors ${
      active
        ? 'border-primary-500/60 bg-primary-500/10 text-surface-100'
        : 'border-surface-800 bg-surface-800/40 text-surface-300 hover:bg-surface-800'
    }`;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-3" data-testid="location-picker-sheet">
        <p className="text-[13px] leading-relaxed text-surface-400">
          {scope.kind === 'session' ? (
            <>
              Machine loads aren&rsquo;t comparable between gyms, so each location keeps its own
              weight history. Everything logged in this workout is filed here.
            </>
          ) : (
            <>
              Use this when <span className="text-surface-200">{scope.exerciseName}</span> is on a
              different machine than the rest of the workout. Its weight history is kept separate,
              so the two stacks never average together.
            </>
          )}
        </p>

        <div className="space-y-2">
          {/* Exercise scope only: hand the block back to the session's location. */}
          {scope.kind === 'exercise' && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={rowClass(selectedId === null)}
              data-testid="location-option-inherit"
            >
              <IconMapPin size={18} className="flex-shrink-0 text-surface-500" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">Same as workout</span>
                <span className="block text-xs text-surface-500 truncate">
                  {scope.sessionLocationName ?? 'No location set'}
                </span>
              </span>
              {selectedId === null && (
                <IconCheck size={18} className="flex-shrink-0 text-primary-400" />
              )}
            </button>
          )}

          {locations.map((location) => {
            const active = selectedId === location.id;
            return (
              <button
                key={location.id}
                type="button"
                onClick={() => onSelect(location.id)}
                className={rowClass(active)}
                data-testid="location-option"
                data-location-id={location.id}
              >
                <IconMapPin
                  size={18}
                  className={`flex-shrink-0 ${active ? 'text-primary-400' : 'text-surface-500'}`}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{location.name}</span>
                  {location.is_default && (
                    <span className="block text-xs text-surface-500">Default</span>
                  )}
                </span>
                {active && <IconCheck size={18} className="flex-shrink-0 text-primary-400" />}
              </button>
            );
          })}
        </div>

        {/* Add a location without leaving the workout — the case this is for
            (a machine you've never logged before) is exactly the case where the
            location doesn't exist yet. */}
        {isAdding ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                  if (e.key === 'Escape') {
                    setIsAdding(false);
                    setNewName('');
                  }
                }}
                placeholder={
                  scope.kind === 'session' ? 'e.g. Hotel Gym' : 'e.g. Annex adduction machine'
                }
                maxLength={60}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500"
                data-testid="location-new-name"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || isSaving}
                className="px-4 py-2.5 rounded-xl text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {createError && <p className="text-xs text-danger-400">{createError}</p>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-surface-700 text-sm font-medium text-surface-400 hover:border-surface-600 hover:text-surface-200 transition-colors"
            data-testid="location-add-trigger"
          >
            <IconPlus size={16} />
            Add a location
          </button>
        )}

        {/* Already-logged sets follow the change. Saying so beats letting the
            user wonder whether today's work was left on the old track. */}
        {loggedSetCount > 0 && (
          <p className="text-xs text-surface-500">
            {loggedSetCount} set{loggedSetCount === 1 ? '' : 's'} already logged{' '}
            {scope.kind === 'session' ? 'in this workout' : 'for this exercise'} will move with it.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}

export default LocationPickerSheet;
