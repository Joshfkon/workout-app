'use client';

import { useCallback, useState } from 'react';
import { useUserStore } from '@/stores';
import type { CoarseMuscle } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * useExpandedVolumeRows — the ONE persisted "which coarse muscle groups did I
 * expand?" state, shared by every surface that renders the coarse-row volume
 * model (the volume page bars, the in-workout readiness sheet and the
 * empty-workout inline readiness widget). Expanding Shoulders on the volume
 * page keeps it expanded in the readiness sheet and across visits.
 *
 * Persisted per user in localStorage (keyed by user id, so a shared device
 * doesn't leak one user's expansion state into another's). Auto-expansion of
 * lagging (below-MEV) fine children is NOT stored here — that stays derived
 * inside buildVolumeRows; this is only the explicit chevron toggles.
 */
const STORAGE_PREFIX = 'hypertrack:volume-rows-expanded:';

function storageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`;
}

function readExpanded(userId: string | null): Set<CoarseMuscle> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as CoarseMuscle[]) : []);
  } catch {
    return new Set();
  }
}

function persistExpanded(userId: string | null, expanded: Set<CoarseMuscle>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(Array.from(expanded)));
  } catch {
    /* localStorage unavailable (private mode / SSR) — degrade to in-memory. */
  }
}

export interface UseExpandedVolumeRowsResult {
  /** Coarse groups the user explicitly expanded. */
  expandedRows: Set<CoarseMuscle>;
  /** Chevron handler: flip a group and persist. */
  toggleRow: (muscle: CoarseMuscle) => void;
}

export function useExpandedVolumeRows(): UseExpandedVolumeRowsResult {
  const userId = useUserStore((state) => state.user?.id ?? null);
  const [expandedRows, setExpandedRows] = useState<Set<CoarseMuscle>>(() => readExpanded(userId));

  const toggleRow = useCallback(
    (muscle: CoarseMuscle) => {
      setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(muscle)) next.delete(muscle);
        else next.add(muscle);
        persistExpanded(userId, next);
        return next;
      });
    },
    [userId]
  );

  return { expandedRows, toggleRow };
}

export default useExpandedVolumeRows;
