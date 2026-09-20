'use client';

/**
 * Assign pre-location workout history to a gym, once.
 *
 * Why this exists: sets logged before location tracking carry no gym, and
 * the legacy rule (rule 6, services/progressionScope) shows unassigned sets
 * at EVERY gym rather than guessing. For a user whose history predates
 * stamping, a brand-new gym therefore looks like it already has full machine
 * history — no softened starting point, no separated records. Only the user
 * knows where that history actually happened, so this card lets them say it
 * once. The write is one server-side transaction
 * (backfill_legacy_location, supabase/migrations/20260920000001).
 *
 * Degradation: on a database without the location columns (or offline) the
 * count query fails and the card says the feature isn't available, rather
 * than offering a button that would only error.
 */

import { useCallback, useEffect, useState } from 'react';
import { IconCheck, IconMapPin } from '@tabler/icons-react';
import { Button, Modal } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  countLegacyLocationRows,
  runLegacyLocationBackfill,
  type LegacyLocationCounts,
} from '@/lib/training/legacyLocationBackfill';

interface GymOption {
  id: string;
  name: string;
  is_default: boolean;
}

interface LegacyHistoryBackfillProps {
  userId: string;
}

export function LegacyHistoryBackfill({ userId }: LegacyHistoryBackfillProps) {
  const [counts, setCounts] = useState<LegacyLocationCounts | null | 'loading'>('loading');
  const [gyms, setGyms] = useState<GymOption[]>([]);
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createUntypedClient();

  const load = useCallback(async () => {
    const [loadedCounts, gymsRes] = await Promise.all([
      countLegacyLocationRows(supabase, userId),
      supabase
        .from('gym_locations')
        .select('id, name, is_default')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    ]);
    setCounts(loadedCounts);
    if (!gymsRes.error && gymsRes.data) {
      const rows = gymsRes.data as GymOption[];
      setGyms(rows);
      // Preselect the default gym — for most users the answer to "where was
      // my old history?" is their main gym, but the choice stays theirs.
      setSelectedGymId((current) => current ?? rows.find((g) => g.is_default)?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRun = async () => {
    if (!selectedGymId || isRunning) return;
    setIsRunning(true);
    setError(null);
    const res = await runLegacyLocationBackfill(supabase, selectedGymId);
    setIsRunning(false);
    setConfirming(false);
    if (res.ok) {
      const gymName = gyms.find((g) => g.id === selectedGymId)?.name ?? 'that gym';
      setResult(
        `Assigned ${res.setsStamped.toLocaleString('en-US')} sets across ` +
          `${res.sessionsStamped.toLocaleString('en-US')} workouts to ${gymName}.`
      );
      await load();
    } else {
      setError(res.message);
    }
  };

  if (counts === 'loading') {
    return (
      <p className="text-sm text-surface-500" data-testid="legacy-backfill-loading">
        Checking your workout history…
      </p>
    );
  }

  if (counts === null) {
    return (
      <p className="text-sm text-surface-500" data-testid="legacy-backfill-unavailable">
        Gym assignment isn&rsquo;t available right now.
      </p>
    );
  }

  const nothingToDo = counts.setCount === 0 && counts.sessionCount === 0;

  return (
    <div className="space-y-4" data-testid="legacy-backfill">
      <p className="text-sm text-surface-400">
        Machine weights aren&rsquo;t comparable between gyms, so each gym keeps its own history
        for machine and cable exercises. Workouts logged before gym tracking aren&rsquo;t tied to
        a gym yet — until they are, they show up in every gym&rsquo;s history.
      </p>

      {result && (
        <p
          className="flex items-start gap-2 text-sm text-success-400"
          data-testid="legacy-backfill-result"
        >
          <IconCheck size={16} className="mt-0.5 flex-shrink-0" />
          <span>{result}</span>
        </p>
      )}

      {nothingToDo ? (
        <p className="text-sm text-surface-300" data-testid="legacy-backfill-done">
          All of your completed workouts are assigned to a gym. New sets are tagged automatically
          with the workout&rsquo;s location.
        </p>
      ) : (
        <>
          {/* Deliberately "all", not "almost all": completed workouts have no
              per-workout correction flow yet (updateSessionLocation is only
              reachable from an active session), so a mixed history assigned
              here cannot be untangled afterwards. */}
          <p className="text-sm text-surface-200" data-testid="legacy-backfill-count">
            <span className="font-semibold">{counts.setCount.toLocaleString('en-US')} sets</span>{' '}
            across{' '}
            <span className="font-semibold">
              {counts.sessionCount.toLocaleString('en-US')} workouts
            </span>{' '}
            aren&rsquo;t assigned to a gym. If they were <span className="font-semibold">all</span>{' '}
            at one gym, assign them to it so other gyms start their own clean history. If they
            span several gyms, leave them unassigned for now.
          </p>

          <div className="space-y-2">
            {gyms.map((gym) => {
              const active = selectedGymId === gym.id;
              return (
                <button
                  key={gym.id}
                  type="button"
                  onClick={() => setSelectedGymId(gym.id)}
                  data-testid="legacy-backfill-gym-option"
                  data-gym-id={gym.id}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-colors ${
                    active
                      ? 'border-primary-500/60 bg-primary-500/10 text-surface-100'
                      : 'border-surface-800 bg-surface-800/40 text-surface-300 hover:bg-surface-800'
                  }`}
                >
                  <IconMapPin
                    size={18}
                    className={`flex-shrink-0 ${active ? 'text-primary-400' : 'text-surface-500'}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{gym.name}</span>
                    {gym.is_default && (
                      <span className="block text-xs text-surface-500">Default</span>
                    )}
                  </span>
                  {active && <IconCheck size={18} className="flex-shrink-0 text-primary-400" />}
                </button>
              );
            })}
            {gyms.length === 0 && (
              <p className="text-sm text-surface-500">
                Add a gym under Gym Equipment &amp; Locations first.
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-danger-400" data-testid="legacy-backfill-error">
              {error}
            </p>
          )}

          <Button
            onClick={() => setConfirming(true)}
            disabled={!selectedGymId}
            data-testid="legacy-backfill-open-confirm"
          >
            Assign past workouts…
          </Button>

          <Modal
            isOpen={confirming}
            onClose={() => !isRunning && setConfirming(false)}
            title="Assign past workouts?"
            size="sm"
          >
            <div className="space-y-4">
              <p className="text-sm text-surface-300">
                This tags {counts.setCount.toLocaleString('en-US')} sets across{' '}
                {counts.sessionCount.toLocaleString('en-US')} completed workouts as trained at{' '}
                <span className="font-semibold text-surface-100">
                  {gyms.find((g) => g.id === selectedGymId)?.name ?? 'the selected gym'}
                </span>
                . Machine exercise suggestions and records at other gyms will start fresh from a
                conservative estimate.
              </p>
              <p className="text-xs text-surface-500">
                This can&rsquo;t be undone, and completed workouts can&rsquo;t be re-assigned
                afterwards — only continue if this history was genuinely all at{' '}
                {gyms.find((g) => g.id === selectedGymId)?.name ?? 'this gym'}.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                  disabled={isRunning}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleRun()}
                  isLoading={isRunning}
                  data-testid="legacy-backfill-confirm"
                >
                  Assign
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
