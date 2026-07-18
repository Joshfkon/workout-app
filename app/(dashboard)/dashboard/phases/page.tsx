'use client';

/**
 * Training phase editor (Progress → Body → Manage).
 *
 * Top: full-history weight chart with phase spans as colored bands and DEXA
 * scan dates as dots. Below: chronological phase cards (stats from
 * services/phasePlanning.computePhaseStats) with add/edit/delete.
 *
 * Span invariants are enforced through validatePhaseSpan before every write;
 * an edit that collides with a neighbor offers to shift that neighbor's
 * boundary (the common contiguous-phases case) instead of failing.
 *
 * First run (zero phases, >= 90 days of weigh-ins) offers deterministic
 * auto-suggested phases from the weight history — nothing is saved without
 * explicit confirmation.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmModal,
} from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useUserStore } from '@/stores';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useTrainingPhases } from '@/hooks/useTrainingPhases';
import { PhaseHistoryChart } from '@/components/body/PhaseHistoryChart';
import { PHASE_STYLE } from '@/components/body/phaseStyle';
import {
  PhaseFormModal,
  DEFAULT_TARGET,
  type PhaseFormSeed,
} from '@/components/body/PhaseFormModal';
import {
  canSuggestPhases,
  computePhaseStats,
  sortPhases,
  suggestPhasesFromHistory,
  validatePhaseSpan,
  type BoundaryShiftProposal,
  type SuggestedPhase,
} from '@/services/phasePlanning';
import type { TrainingPhaseInput } from '@/lib/body/trainingPhases';
import { getDisplayWeight } from '@/lib/weightUtils';
import { lbsToKg } from '@/lib/utils';
import { addLocalDays, localDay, localDaysBetweenDays, parseLocalDay } from '@/lib/date/localDay';
import type { PhaseType, TrainingPhase } from '@/types/schema';
import type { WeighIn } from '@/lib/nutrition/interval-tdee';

interface EditorHistory {
  weighIns: { day: string; weight: number; unit: 'lb' | 'kg' }[];
  scans: { scanDate: string; leanMassKg: number; fatMassKg: number }[];
}

const PHASE_TYPES: PhaseType[] = ['bulk', 'cut', 'recomp', 'maintenance'];

function fmtDay(day: string): string {
  return parseLocalDay(day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TrainingPhasesPage() {
  const { user: authUser } = useAuthUser();
  const storeUserId = useUserStore((state) => state.user?.id ?? null);
  const userId = storeUserId || authUser?.id || null;
  const { preferences } = useUserPreferences();
  const units = preferences.units;

  const { phases, isLoading: phasesLoading, addPhase, updatePhase, removePhase } =
    useTrainingPhases();

  // Full weight + DEXA history (ALL available data — deliberately not the
  // 1-year window the Body tab trend uses; retroactive phases can be older).
  const historyQuery = useQuery<EditorHistory>({
    queryKey: ['phases-editor-history', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const [weightsRes, scansRes] = await Promise.all([
        supabase
          .from('weight_log')
          .select('logged_at, weight, unit')
          .eq('user_id', userId!)
          .order('logged_at', { ascending: true }),
        supabase
          .from('dexa_scans')
          .select('scan_date, lean_mass_kg, fat_mass_kg')
          .eq('user_id', userId!)
          .order('scan_date', { ascending: true }),
      ]);
      if (weightsRes.error) throw new Error(weightsRes.error.message);
      return {
        weighIns: (weightsRes.data ?? []).map((row: { logged_at: string; weight: number; unit: string | null }) => ({
          day: String(row.logged_at).slice(0, 10),
          weight: Number(row.weight),
          unit: (row.unit ?? 'lb') as 'lb' | 'kg',
        })),
        scans: (scansRes.data ?? []).map((row: { scan_date: string; lean_mass_kg: number; fat_mass_kg: number }) => ({
          scanDate: String(row.scan_date).slice(0, 10),
          leanMassKg: Number(row.lean_mass_kg),
          fatMassKg: Number(row.fat_mass_kg),
        })),
      };
    },
  });

  const history = historyQuery.data;
  const weighInsLb: WeighIn[] = useMemo(
    () =>
      (history?.weighIns ?? []).map((w) => ({
        date: w.day,
        weightLb: getDisplayWeight(w.weight, w.unit, 'lb'),
      })),
    [history]
  );
  const chartWeighIns = useMemo(
    () =>
      (history?.weighIns ?? []).map((w) => ({
        day: w.day,
        weight: getDisplayWeight(w.weight, w.unit, units),
      })),
    [history, units]
  );
  const scanDays = useMemo(() => (history?.scans ?? []).map((s) => s.scanDate), [history]);

  const today = localDay();
  const sorted = useMemo(() => sortPhases(phases), [phases]);

  // ---- add / edit flow ----
  const [seed, setSeed] = useState<PhaseFormSeed | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingShift, setPendingShift] = useState<{
    input: TrainingPhaseInput;
    id?: string;
    proposals: BoundaryShiftProposal[];
  } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    const lastEnded = [...sorted].reverse().find((p) => p.endDay !== null);
    const hasActive = sorted.some((p) => p.endDay === null);
    setFormError(null);
    setSeed({
      phaseType: 'bulk',
      // Sensible anchor: continue where tracking stopped, else 8 weeks back.
      startDay: lastEnded ? addLocalDays(lastEnded.endDay!, 1) : addLocalDays(today, -56),
      endDay: hasActive ? today : '',
      targetRate: DEFAULT_TARGET.bulk,
      note: '',
    });
  };

  const openEdit = (phase: TrainingPhase) => {
    setFormError(null);
    setSeed({
      id: phase.id,
      phaseType: phase.phaseType,
      startDay: phase.startDay,
      endDay: phase.endDay ?? '',
      targetRate: phase.targetRateLbsPerWeek?.toString() ?? '',
      note: phase.note ?? '',
    });
  };

  const persist = async (input: TrainingPhaseInput, id?: string) => {
    setSaving(true);
    try {
      if (id) {
        await updatePhase(id, input);
      } else {
        await addPhase(input);
      }
      setSeed(null);
      setPendingShift(null);
      setFormError(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save phase.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (input: TrainingPhaseInput, id?: string) => {
    const validation = validatePhaseSpan(phases, {
      id,
      phaseType: input.phaseType,
      startDay: input.startDay,
      endDay: input.endDay,
    });
    if (validation.errors.includes('end_before_start')) {
      setFormError('End date must be on or after the start date.');
      return;
    }
    if (validation.errors.includes('multiple_active')) {
      setFormError('Another phase is still active — end it first, or give this phase an end date.');
      return;
    }
    if (validation.errors.includes('overlap')) {
      if (validation.proposals.length > 0) {
        // Common contiguous case: offer to shift the neighbors' boundaries.
        setPendingShift({ input, id, proposals: validation.proposals });
        return;
      }
      setFormError('This span overlaps another phase. Adjust the dates (gaps are fine).');
      return;
    }
    await persist(input, id);
  };

  const applyShiftAndSave = async () => {
    if (!pendingShift) return;
    setSaving(true);
    try {
      for (const proposal of pendingShift.proposals) {
        await updatePhase(proposal.phaseId, {
          [proposal.field]: proposal.value,
        } as Partial<TrainingPhaseInput>);
      }
      await persist(pendingShift.input, pendingShift.id);
    } catch (err) {
      setSaving(false);
      setFormError(err instanceof Error ? err.message : 'Failed to shift the adjacent phase.');
      setPendingShift(null);
    }
  };

  // ---- first-run auto-suggest ----
  const [suggestions, setSuggestions] = useState<SuggestedPhase[] | null>(null);
  const showSuggestOffer =
    !phasesLoading && phases.length === 0 && canSuggestPhases(phases.length, weighInsLb);

  const confirmSuggestions = async () => {
    if (!suggestions) return;
    setSaving(true);
    try {
      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i];
        // If the newest segment runs to (nearly) today, save it as the
        // active phase rather than one that ended yesterday.
        const isCurrent =
          i === suggestions.length - 1 && localDaysBetweenDays(s.endDay, today) <= 3;
        await addPhase({
          phaseType: s.phaseType,
          startDay: s.startDay,
          endDay: isCurrent ? null : s.endDay,
          targetRateLbsPerWeek: null,
          note: 'Auto-suggested from weight history',
        });
      }
      setSuggestions(null);
    } finally {
      setSaving(false);
    }
  };

  const fmtWeight = (lb: number | null | undefined, signed = false): string => {
    if (lb == null) return '—';
    const value = units === 'kg' ? lbsToKg(lb) : lb;
    const sign = signed && value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)} ${units}`;
  };

  const isLoading = phasesLoading || historyQuery.isLoading;

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Training Phases</h1>
          <p className="text-surface-400 text-sm">
            Bulk, cut, recomp, and maintenance spans — trends and advice never cross a phase
            boundary.
          </p>
        </div>
        <Link href="/dashboard/analytics" className="text-primary-400 text-sm shrink-0 hover:text-primary-300">
          Back to Body
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weight history</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="h-56 animate-pulse bg-surface-800/50 rounded-lg" />
          ) : (
            <>
              <PhaseHistoryChart
                weighIns={chartWeighIns}
                scanDays={scanDays}
                phases={sorted}
                unitLabel={units}
              />
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-surface-400">
                {PHASE_TYPES.map((type) => (
                  <span key={type} className="inline-flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: PHASE_STYLE[type].band, opacity: 0.6 }}
                    />
                    {PHASE_STYLE[type].label}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-surface-100" />
                  DEXA scan
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {showSuggestOffer && !suggestions && (
        <Card>
          <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-surface-100">No phases yet</p>
              <p className="text-xs text-surface-400">
                You have {'>'}90 days of weigh-ins — we can propose phase boundaries from the
                weight trend for you to review.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setSuggestions(suggestPhasesFromHistory(weighInsLb, scanDays))}
              data-testid="suggest-phases-button"
            >
              Suggest phases from my history
            </Button>
          </CardContent>
        </Card>
      )}

      {suggestions && (
        <Card data-testid="suggested-phases">
          <CardHeader>
            <CardTitle>Suggested phases</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-surface-400">
              A deterministic starting point from your smoothed weight trend (boundaries snapped
              to DEXA scans within 14 days). Nothing is saved until you confirm; you can edit
              every span afterwards.
            </p>
            {suggestions.length === 0 ? (
              <p className="text-sm text-surface-400">
                No sustained trend segments found — add phases manually instead.
              </p>
            ) : (
              suggestions.map((s, i) => {
                const style = PHASE_STYLE[s.phaseType];
                return (
                  <div
                    key={`${s.phaseType}-${s.startDay}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-800/60"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide text-[10px] ${style.badgeBg} ${style.text}`}
                      >
                        {style.label}
                      </span>
                      <span className="text-surface-300">
                        {fmtDay(s.startDay)} – {fmtDay(s.endDay)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-surface-500 hover:text-danger-400"
                      onClick={() =>
                        setSuggestions((prev) => (prev ? prev.filter((_, j) => j !== i) : prev))
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })
            )}
            <div className="flex gap-2 pt-1">
              {suggestions.length > 0 && (
                <Button size="sm" onClick={confirmSuggestions} disabled={saving}>
                  {saving ? 'Saving…' : `Save ${suggestions.length} phase${suggestions.length === 1 ? '' : 's'}`}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSuggestions(null)} disabled={saving}>
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-100">Phases</h2>
        <Button size="sm" onClick={openAdd} data-testid="add-phase-button">
          + Add phase
        </Button>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse bg-surface-800/50 rounded-lg" />
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-surface-400">
            No phases yet. Add one, or use the suggestion above to backfill your history.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Newest first: the active/most recent phase is what users manage. */}
          {[...sorted].reverse().map((phase) => {
            const style = PHASE_STYLE[phase.phaseType];
            const stats = computePhaseStats(phase, weighInsLb, history?.scans ?? [], today);
            const weeks = Math.floor(stats.durationDays / 7);
            return (
              <Card key={phase.id} data-testid="phase-card">
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide text-[10px] ${style.badgeBg} ${style.text} shrink-0`}
                      >
                        {style.label}
                      </span>
                      <span className="text-sm text-surface-300 truncate">
                        {fmtDay(phase.startDay)} – {phase.endDay ? fmtDay(phase.endDay) : 'now'}
                      </span>
                      {phase.endDay === null && (
                        <span className="text-[10px] uppercase tracking-wide text-primary-400 shrink-0">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(phase)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(phase.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-surface-400">
                    <span>
                      {weeks >= 1 ? `${weeks} wk` : `${stats.durationDays} d`}
                      {phase.targetRateLbsPerWeek != null &&
                        ` · target ${phase.targetRateLbsPerWeek > 0 ? '+' : ''}${phase.targetRateLbsPerWeek} lb/wk`}
                    </span>
                    <span>
                      {fmtWeight(stats.startWeightLb)} → {fmtWeight(stats.endWeightLb)}
                    </span>
                    <span>
                      Δ {fmtWeight(stats.deltaLb, true)}
                      {stats.avgRateLbPerWk != null && ` (${fmtWeight(stats.avgRateLbPerWk, true)}/wk)`}
                    </span>
                    {stats.leanDeltaLb != null && stats.fatDeltaLb != null ? (
                      <span>
                        Lean {fmtWeight(stats.leanDeltaLb, true)} · fat {fmtWeight(stats.fatDeltaLb, true)}
                      </span>
                    ) : (
                      <span className="text-surface-600">No bracketing DEXA scans</span>
                    )}
                  </div>
                  {phase.note && <p className="text-xs text-surface-500">{phase.note}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PhaseFormModal
        seed={seed}
        error={formError}
        saving={saving}
        onClose={() => setSeed(null)}
        onSave={handleSave}
      />

      {/* Boundary-shift confirmation (contiguous-phases case) */}
      <ConfirmModal
        isOpen={pendingShift !== null}
        onClose={() => setPendingShift(null)}
        onConfirm={applyShiftAndSave}
        title="Shift adjacent phase?"
        message={
          pendingShift
            ? `This span overlaps ${pendingShift.proposals.length === 1 ? 'an adjacent phase' : `${pendingShift.proposals.length} adjacent phases`}. Shift ${
                pendingShift.proposals.length === 1 ? 'its boundary' : 'their boundaries'
              } to keep the phases contiguous?`
            : ''
        }
        confirmText="Shift and save"
        isLoading={saving}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (deleteId) {
            await removePhase(deleteId);
            setDeleteId(null);
          }
        }}
        title="Delete phase?"
        message="The span is removed from charts and assessments. Weigh-ins and scans are untouched."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
