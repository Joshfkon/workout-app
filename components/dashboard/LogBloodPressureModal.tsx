'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalFooter, Button, Input, Select } from '@/components/ui';
import { useBloodPressureLog } from '@/hooks/useBloodPressureLog';
import {
  validateBloodPressure,
  classifyBloodPressure,
  BLOOD_PRESSURE_CATEGORIES,
} from '@/services/bloodPressure';
import {
  BLOOD_PRESSURE_CONTEXTS,
  BLOOD_PRESSURE_CONTEXT_LABELS,
  type BloodPressureContext,
  type BloodPressureEntry,
} from '@/types/schema';

/**
 * LogBloodPressureModal — the daily entry sheet: two prominent systolic /
 * diastolic fields, optional pulse, an editable time (defaults to now), a
 * context selector and optional notes. Saving inserts a NEW reading (a second
 * reading today is added, never overwritten) and calls onSaved so the host
 * refreshes summaries immediately.
 */

interface LogBloodPressureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (entry: BloodPressureEntry) => void;
}

/** <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const CONTEXT_OPTIONS = [
  { value: '', label: 'No context' },
  ...BLOOD_PRESSURE_CONTEXTS.map((c) => ({
    value: c,
    label: BLOOD_PRESSURE_CONTEXT_LABELS[c],
  })),
];

export function LogBloodPressureModal({
  isOpen,
  onClose,
  onSaved,
}: LogBloodPressureModalProps) {
  const { logReading } = useBloodPressureLog();

  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [measuredAt, setMeasuredAt] = useState(() => toLocalDatetimeInput(new Date()));
  const [context, setContext] = useState<'' | BloodPressureContext>('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Only surface field errors once the user has tried to save.
  const [showErrors, setShowErrors] = useState(false);

  const systolicRef = useRef<HTMLInputElement>(null);

  // Reset + refocus each time the sheet opens (time re-defaults to "now").
  useEffect(() => {
    if (!isOpen) return;
    setSystolic('');
    setDiastolic('');
    setPulse('');
    setMeasuredAt(toLocalDatetimeInput(new Date()));
    setContext('');
    setNotes('');
    setSaveError(null);
    setShowErrors(false);
    const t = setTimeout(() => systolicRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  const sys = systolic === '' ? null : Number(systolic);
  const dia = diastolic === '' ? null : Number(diastolic);
  const pul = pulse === '' ? null : Number(pulse);

  const validation = useMemo(
    () => validateBloodPressure({ systolic: sys, diastolic: dia, pulse: pul }),
    [sys, dia, pul]
  );

  // Live category preview + crisis banner once both numbers look sane.
  const preview =
    sys != null &&
    dia != null &&
    !validation.errors.systolic &&
    !validation.errors.diastolic
      ? classifyBloodPressure(sys, dia)
      : null;

  const handleSave = async () => {
    setShowErrors(true);
    if (!validation.valid) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const saved = await logReading({
        systolic: sys as number,
        diastolic: dia as number,
        pulse: pul,
        context: context === '' ? null : context,
        notes: notes.trim() || null,
        // datetime-local has no timezone; interpret it as local time.
        measuredAt: new Date(measuredAt).toISOString(),
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save reading.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log blood pressure" size="md">
      <div className="space-y-4" onKeyDown={handleKeyDown}>
        {/* Two prominent systolic / diastolic fields */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Input
              ref={systolicRef}
              label="Systolic"
              type="number"
              inputMode="numeric"
              placeholder="120"
              value={systolic}
              onChange={(e) => setSystolic(e.target.value)}
              error={showErrors ? validation.errors.systolic : undefined}
              hint="Top number (mmHg)"
              min={70}
              max={250}
            />
          </div>
          <div className="pb-3 text-2xl font-semibold text-surface-500 select-none">
            /
          </div>
          <div className="flex-1">
            <Input
              label="Diastolic"
              type="number"
              inputMode="numeric"
              placeholder="80"
              value={diastolic}
              onChange={(e) => setDiastolic(e.target.value)}
              error={showErrors ? validation.errors.diastolic : undefined}
              hint="Bottom number (mmHg)"
              min={40}
              max={150}
            />
          </div>
        </div>

        {/* Live category / crisis guidance */}
        {preview && (
          <div
            className={`rounded-lg border px-3 py-2.5 text-sm ${TONE_BANNER[preview.tone]}`}
            role={preview.id === 'crisis' ? 'alert' : undefined}
            data-testid="bp-category-preview"
          >
            <p className="font-medium">{preview.label}</p>
            <p className="text-xs mt-0.5 opacity-90">{preview.advice}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Pulse (optional)"
            type="number"
            inputMode="numeric"
            placeholder="—"
            value={pulse}
            onChange={(e) => setPulse(e.target.value)}
            error={showErrors ? validation.errors.pulse : undefined}
            hint="bpm"
            min={30}
            max={220}
          />
          <Select
            label="Context (optional)"
            options={CONTEXT_OPTIONS}
            value={context}
            onChange={(e) => setContext(e.target.value as '' | BloodPressureContext)}
          />
        </div>

        <Input
          label="Time"
          type="datetime-local"
          value={measuredAt}
          onChange={(e) => setMeasuredAt(e.target.value)}
        />

        <div>
          <label
            htmlFor="bp-notes"
            className="block text-sm font-medium text-surface-200 mb-1.5"
          >
            Notes (optional)
          </label>
          <textarea
            id="bp-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. after coffee, felt fine"
            className="w-full rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5 text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-none"
          />
        </div>

        {saveError && (
          <p className="text-sm text-danger-400" role="alert">
            {saveError}
          </p>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save reading'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** Banner classes per category tone (borrowed from the app's token scale). */
const TONE_BANNER: Record<BloodPressureCategory_Tone, string> = {
  success: 'bg-success-500/10 border-success-500/30 text-success-300',
  primary: 'bg-primary-500/10 border-primary-500/30 text-primary-300',
  warning: 'bg-warning-500/10 border-warning-500/30 text-warning-300',
  danger: 'bg-danger-500/10 border-danger-500/30 text-danger-300',
};

type BloodPressureCategory_Tone =
  (typeof BLOOD_PRESSURE_CATEGORIES)[keyof typeof BLOOD_PRESSURE_CATEGORIES]['tone'];
