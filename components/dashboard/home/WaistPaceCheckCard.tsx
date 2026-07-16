'use client';

/**
 * WaistPaceCheckCard — derived signal 2 (bulk pace check).
 *
 * Surfaces ONE evidence-first line when, on a bulk, the 14-day waist trend is
 * fat-dominant while weight is gaining at/above target. Dismissible, fires at
 * most once per week, and never off a single day's entry (the partition
 * anchor enforces the ≥10-day gate). It states the numbers and stops — no
 * verdict about the user (copy discipline).
 *
 * The cut-phase mirror is intentionally NOT here (out of scope for v1).
 */

import { useEffect, useMemo, useState } from 'react';
import { IconRulerMeasure } from '@tabler/icons-react';
import { Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString, cmToIn, kgToLbs, inputWeightToKg } from '@/lib/utils';
import {
  computePartitionAnchor,
  evaluatePaceCheck,
  type PaceCheckSignal,
} from '@/services/waistTrend';

interface WeightHistoryEntry {
  date: string;
  weight: number;
  unit: string;
}

interface WaistPaceCheckCardProps {
  userId: string;
  weightHistory: WeightHistoryEntry[];
  /** Observed vs target weekly rate in the DISPLAY unit. */
  weightRate: { perWeek: number; target: number | null } | null;
  weightUnit: 'lb' | 'kg';
  phase: 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance' | string;
}

const FIRED_KEY = 'hypertrack_waist_pace_fired_at';
const DISMISSED_KEY = 'hypertrack_waist_pace_dismissed_at';

function readTs(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

function toLbPerWeek(rate: number, unit: 'lb' | 'kg'): number {
  return unit === 'kg' ? rate * 2.20462 : rate;
}

export function WaistPaceCheckCard({
  userId,
  weightHistory,
  weightRate,
  weightUnit,
  phase,
}: WaistPaceCheckCardProps) {
  const [waistRows, setWaistRows] = useState<Array<{ logged_at: string; waist: number | null }> | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [nowMs] = useState(() => Date.now());

  // Only a bulk can trigger this — skip the fetch entirely otherwise.
  const isBulk = phase === 'bulk';

  useEffect(() => {
    if (!isBulk || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        const ninetyAgo = getLocalDateString(new Date(nowMs - 90 * 24 * 60 * 60 * 1000));
        const { data } = await supabase
          .from('body_measurements')
          .select('logged_at, waist')
          .eq('user_id', userId)
          .not('waist', 'is', null)
          .gte('logged_at', ninetyAgo)
          .order('logged_at', { ascending: true });
        if (!cancelled) setWaistRows((data ?? []) as Array<{ logged_at: string; waist: number | null }>);
      } catch {
        if (!cancelled) setWaistRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBulk, userId, nowMs]);

  const signal: PaceCheckSignal | null = useMemo(() => {
    if (!isBulk || !waistRows || !weightRate) return null;
    const anchor = computePartitionAnchor({
      waist: waistRows
        .filter((r) => r.waist != null)
        .map((r) => ({ date: r.logged_at, waistIn: cmToIn(Number(r.waist)) })),
      weight: weightHistory.map((w) => ({
        date: w.date,
        weightLb: kgToLbs(inputWeightToKg(w.weight, (w.unit as 'lb' | 'kg') ?? 'lb')),
      })),
      windowDays: 14,
    });
    return evaluatePaceCheck({
      anchor,
      weightRateLbPerWeek: toLbPerWeek(weightRate.perWeek, weightUnit),
      targetRateLbPerWeek: weightRate.target != null ? toLbPerWeek(weightRate.target, weightUnit) : 0,
      phase,
      lastFiredAtMs: readTs(FIRED_KEY),
      lastDismissedAtMs: readTs(DISMISSED_KEY),
      nowMs,
    });
  }, [isBulk, waistRows, weightRate, weightHistory, weightUnit, phase, nowMs]);

  // Persist the fire so it stays quiet for a week (once-per-week cadence).
  useEffect(() => {
    if (signal) {
      try {
        localStorage.setItem(FIRED_KEY, String(nowMs));
      } catch {
        /* private mode — the in-memory gate still holds for this session */
      }
    }
  }, [signal, nowMs]);

  if (!signal || dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(nowMs));
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div className="rounded-xl bg-warning-500/10 border border-warning-500/20 p-4" data-testid="waist-pace-check">
      <div className="flex items-start gap-3">
        <IconRulerMeasure className="w-5 h-5 text-warning-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-surface-100">Waist is outpacing this gain</p>
          <p className="mt-1.5 text-xs text-surface-400">{signal.message}</p>
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WaistPaceCheckCard;
