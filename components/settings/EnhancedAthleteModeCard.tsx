'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Toggle, Button, Modal, ModalFooter } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import {
  getActiveMesocycle,
  persistEnhancedAthleteMode,
  regenerateRemainingWeeksForEnhancedMode,
  type ActiveMesocycleRow,
} from '@/lib/training/enhancedAthleteMode';

/**
 * Settings-screen caption. Kept accurate to the differentiated scaling
 * (volumeBands profile scaling) — the old "baselines increased by 40%" copy overstated
 * the floor and never mentioned the connective-tissue carve-out.
 */
const ENHANCED_MODE_CAPTION =
  'Volume ceiling raised ~35–40%, starting volumes ~10%. Joint-stress limits stay unchanged to protect connective tissue.';

interface EnhancedAthleteModeCardProps {
  /** Called after the flag (and any regeneration) has been persisted. */
  onChanged?: (enabled: boolean) => void;
}

/**
 * Enhanced Athlete Mode toggle. The flag is a physiological profile fact
 * persisted on users.enhanced_athlete_mode (no local-only state) and synced
 * to the adaptive-volume profile. Flipping it while a mesocycle is active
 * prompts: adjust the remaining weeks now, or apply at the next mesocycle.
 */
export function EnhancedAthleteModeCard({ onChanged }: EnhancedAthleteModeCardProps) {
  const [enabled, setEnabled] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending change awaiting the mid-meso decision (null = no modal).
  const [pendingChange, setPendingChange] = useState<{
    value: boolean;
    mesocycle: ActiveMesocycleRow;
  } | null>(null);
  const conservativeButtonRef = useRef<HTMLButtonElement>(null);
  const updateUser = useUserStore((state) => state.updateUser);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        setUserId(user.id);
        const { data } = await supabase
          .from('users')
          .select('enhanced_athlete_mode')
          .eq('id', user.id)
          .single();
        if (!cancelled) setEnabled(data?.enhanced_athlete_mode === true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Default focus lands on the conservative choice ("Apply at next mesocycle").
  useEffect(() => {
    if (pendingChange) conservativeButtonRef.current?.focus();
  }, [pendingChange]);

  const applyChange = useCallback(
    async (value: boolean, adjustRemaining: boolean, mesocycle?: ActiveMesocycleRow) => {
      if (!userId) return;
      setIsSaving(true);
      setError(null);
      try {
        const supabase = createUntypedClient();
        await persistEnhancedAthleteMode(supabase, userId, value);
        if (adjustRemaining && mesocycle) {
          await regenerateRemainingWeeksForEnhancedMode(supabase, userId, mesocycle, value);
        }
        setEnabled(value);
        updateUser({ enhancedAthleteMode: value });
        onChanged?.(value);
      } catch (err) {
        console.error('Failed to update Enhanced Athlete Mode:', err);
        setError('Failed to save. Please try again.');
      } finally {
        setIsSaving(false);
        setPendingChange(null);
      }
    },
    [userId, updateUser, onChanged]
  );

  const handleToggle = useCallback(
    async (value: boolean) => {
      if (!userId || isSaving) return;
      setError(null);
      const supabase = createUntypedClient();
      const activeMeso = await getActiveMesocycle(supabase, userId);
      if (activeMeso) {
        // Never silently rescale or silently defer — the user decides.
        setPendingChange({ value, mesocycle: activeMeso });
        return;
      }
      await applyChange(value, false);
    },
    [userId, isSaving, applyChange]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enhanced Athlete Mode</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-surface-300">
              PEDs significantly increase recovery capacity. HyperTrack raises your volume
              ceiling accordingly.
            </p>
            <p className="mt-1 text-xs text-surface-500">{ENHANCED_MODE_CAPTION}</p>
          </div>
          <Toggle
            checked={enabled}
            onChange={handleToggle}
            disabled={isLoading || isSaving || !userId}
          />
        </div>
        {error && <p className="mt-2 text-xs text-danger-400">{error}</p>}
      </CardContent>

      {/* Mid-mesocycle decision — flipping the toggle during an active meso */}
      <Modal
        isOpen={pendingChange !== null}
        onClose={() => setPendingChange(null)}
        title={pendingChange?.value ? 'Turn on Enhanced Athlete Mode?' : 'Turn off Enhanced Athlete Mode?'}
        size="md"
      >
        {pendingChange && (
          <div className="space-y-4">
            <p className="text-sm text-surface-300">
              A mesocycle ({pendingChange.mesocycle.name}, week {pendingChange.mesocycle.current_week} of{' '}
              {pendingChange.mesocycle.total_weeks}) is in progress. How should the change apply?
            </p>
            <div className="space-y-3 text-sm text-surface-400">
              <p>
                <span className="font-medium text-surface-200">Adjust remaining weeks</span> —
                regenerates the future weeks of the current mesocycle with the{' '}
                {pendingChange.value ? 'raised' : 'natural'} volume landmarks and progression rate.
                Completed weeks and logged workouts are untouched. If this week is already underway,
                changes start next week.
                {!pendingChange.value &&
                  ' Prescriptions above the natural volume ceiling are brought back down to it.'}
              </p>
              <p>
                <span className="font-medium text-surface-200">Apply at next mesocycle</span> —
                the current mesocycle runs unchanged; the setting takes effect when your next
                mesocycle is generated.
              </p>
            </div>
            <ModalFooter className="flex-col sm:flex-row items-stretch sm:items-center">
              <Button
                variant="secondary"
                onClick={() => applyChange(pendingChange.value, true, pendingChange.mesocycle)}
                isLoading={isSaving}
              >
                Adjust remaining weeks
              </Button>
              <Button
                ref={conservativeButtonRef}
                onClick={() => applyChange(pendingChange.value, false)}
                isLoading={isSaving}
              >
                Apply at next mesocycle
              </Button>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </Card>
  );
}
