'use client';

/**
 * useBodyStatsSince
 *
 * The Body tab's "Change since" reference date — the date the header stat
 * cards measure their deltas from (e.g. the day a bulk started). Persisted in
 * localStorage so the choice survives reloads; null means no reference date
 * (cards fall back to their scan-to-scan monthly rates).
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'body-stats-since-date';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function useBodyStatsSince(): [string | null, (date: string | null) => void] {
  const [sinceDate, setSinceDateState] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && DATE_RE.test(stored)) setSinceDateState(stored);
    } catch {
      // localStorage unavailable (private mode / SSR) — stay at null.
    }
  }, []);

  const setSinceDate = useCallback((date: string | null) => {
    setSinceDateState(date && DATE_RE.test(date) ? date : null);
    try {
      if (date && DATE_RE.test(date)) localStorage.setItem(STORAGE_KEY, date);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Persistence is best-effort; in-memory state still applies.
    }
  }, []);

  return [sinceDate, setSinceDate];
}
