'use client';

/**
 * usePlanReview — client side of the optional AI review.
 *
 *  - Results are cached per plan hash; a response for any other hash than
 *    the current plan is never shown (stale results are discarded).
 *  - Prefetch: once the plan hash has been unchanged for
 *    REVIEW_PREFETCH_DEBOUNCE_MS, the review is requested in the background
 *    (online only, once per hash). Nothing is shown until the user taps
 *    Review — then a warm result appears instantly.
 *  - Manual Review: uses the cache or requests; 10s timeout → 'unavailable'.
 *  - Failures are logged, never toasted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewWorkoutPlan, type PlanReviewResult } from '@/lib/actions/workoutPlanReview';
import {
  REVIEW_PREFETCH_DEBOUNCE_MS,
  REVIEW_TIMEOUT_MS,
  validateReviewObject,
  type PlanReview,
  type ReviewPayload,
} from '@/services/workoutSetup/aiReview';

export type ReviewStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface CacheEntry {
  payload: ReviewPayload;
  review: PlanReview;
}

export type ReviewRequester = (payload: ReviewPayload) => Promise<PlanReviewResult>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('review timed out')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function usePlanReview(
  hash: string,
  buildPayload: () => ReviewPayload,
  opts: { enabled: boolean; requester?: ReviewRequester }
) {
  const requester = opts.requester ?? reviewWorkoutPlan;
  const cache = useRef(new Map<string, CacheEntry>());
  const inFlight = useRef(new Map<string, Promise<CacheEntry | null>>());
  const currentHash = useRef(hash);
  currentHash.current = hash;
  const buildRef = useRef(buildPayload);
  buildRef.current = buildPayload;

  const [status, setStatus] = useState<ReviewStatus>('idle');
  /** The review being shown, with the payload it answers (for accept checks). */
  const [shown, setShown] = useState<CacheEntry | null>(null);

  const fetchFor = useCallback(
    (forHash: string): Promise<CacheEntry | null> => {
      const cached = cache.current.get(forHash);
      if (cached) return Promise.resolve(cached);
      const pending = inFlight.current.get(forHash);
      if (pending) return pending;
      const payload = buildRef.current();
      const run = withTimeout(requester(payload), REVIEW_TIMEOUT_MS)
        .then((result) => {
          if (!result.ok) {
            console.warn('[Plan review] unavailable:', result.error);
            return null;
          }
          // Defense in depth: re-validate the server's answer against OUR payload.
          const checked = validateReviewObject(result.review, payload);
          if (!checked.ok) {
            console.warn('[Plan review] rejected on client:', checked.error);
            return null;
          }
          const entry = { payload, review: checked.review };
          cache.current.set(forHash, entry);
          return entry;
        })
        .catch((err) => {
          console.warn('[Plan review] failed:', err instanceof Error ? err.message : err);
          return null;
        })
        .finally(() => inFlight.current.delete(forHash));
      inFlight.current.set(forHash, run);
      return run;
    },
    [requester]
  );

  // Set right before an accepted suggestion is applied: the hash change it
  // causes must NOT trigger a re-review (only user edits re-arm prefetch).
  const skipNextPrefetch = useRef(false);
  const noteAcceptedEdit = useCallback(() => {
    skipNextPrefetch.current = true;
  }, []);

  // Background prefetch after the plan settles.
  useEffect(() => {
    if (skipNextPrefetch.current) {
      skipNextPrefetch.current = false;
      return;
    }
    if (!opts.enabled || cache.current.has(hash) || inFlight.current.has(hash)) return;
    const timer = setTimeout(() => {
      if (currentHash.current === hash && isOnline()) void fetchFor(hash);
    }, REVIEW_PREFETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hash, opts.enabled, fetchFor]);

  const review = useCallback(async () => {
    const forHash = currentHash.current;
    if (!isOnline() && !cache.current.has(forHash)) {
      setStatus('unavailable');
      return;
    }
    setStatus('loading');
    const entry = await fetchFor(forHash);
    if (currentHash.current !== forHash) return; // plan changed meanwhile — discard
    if (!entry) {
      setStatus('unavailable');
      return;
    }
    setShown(entry);
    setStatus('ready');
  }, [fetchFor]);

  /** Hide the shown review (user edited the plan, or everything was handled). */
  const clear = useCallback(() => {
    setShown(null);
    setStatus('idle');
  }, []);

  return { status, shown, review, clear, noteAcceptedEdit };
}
