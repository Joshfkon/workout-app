'use client';

/**
 * Unified "Log body data" sheet — the single front door for all body-
 * composition data. Opened by the Home Weight tile's "+ log" and the Body
 * hub's Log button. Three segments:
 *
 *   Weight (default)  single field + date, optimized for a 3-second daily
 *                     entry (autofocused, Enter saves) — same speed and
 *                     write path (weight_log) as the old weight modal.
 *   Measurements      per-site tape entry (the ratio analytics' site list),
 *                     previous values prefilled as placeholders, any site
 *                     skippable; stored in cm, entered in the app unit.
 *   DEXA              full scan entry: totals + facility/machine/notes.
 *                     Regional breakdown links to the dedicated form.
 *
 * Saving calls the shared lib/body/bodyLog helpers and reports back via
 * onSaved so hosts can refresh their local state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { SegmentedControl } from '@/components/workout/SegmentedControl';
import {
  MEASUREMENT_FIELDS,
  type Measurements,
} from '@/components/dashboard/BodyMeasurements';
import {
  saveWeightLogEntry,
  saveBodyMeasurements,
  saveDexaScan,
} from '@/lib/body/bodyLog';
import { cmToIn, inToCm, getLocalDateString, inputWeightToKg } from '@/lib/utils';

export type BodyLogSegment = 'weight' | 'measurements' | 'dexa';

export interface BodyLogSavedDetail {
  kind: BodyLogSegment;
  date: string;
  /** Weight segment only: the entry, in the display unit it was typed in. */
  weight?: number;
  unit?: 'lb' | 'kg';
}

interface LogBodyDataSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Which segment opens first (default 'weight'). */
  initialSegment?: BodyLogSegment;
  /** App-wide weight unit; drives the tape unit too (lb → in, kg → cm). */
  preferredUnit: 'lb' | 'kg';
  /**
   * Prefill for the weight field, in the display unit (e.g. the most recent
   * weigh-in, so a daily entry is a one-or-two-digit edit). Ignored once the
   * user has typed.
   */
  initialWeight?: number | null;
  /** Called after a successful save so the host can refresh. */
  onSaved?: (detail: BodyLogSavedDetail) => void;
}

const SEGMENTS: { value: BodyLogSegment; label: string }[] = [
  { value: 'weight', label: 'Weight' },
  { value: 'measurements', label: 'Measurements' },
  { value: 'dexa', label: 'DEXA' },
];

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-[15px] placeholder:text-surface-500 focus:outline-none focus:border-primary-500';
const labelClass = 'block text-[11px] font-medium text-surface-400 mb-1';
const saveButtonClass =
  'w-full py-2.5 rounded-lg bg-primary-500 text-white text-[13px] font-medium hover:bg-primary-600 transition-colors disabled:opacity-60';

export function LogBodyDataSheet({
  isOpen,
  onClose,
  initialSegment = 'weight',
  preferredUnit,
  initialWeight = null,
  onSaved,
}: LogBodyDataSheetProps) {
  const supabase = createUntypedClient();
  const [segment, setSegment] = useState<BodyLogSegment>(initialSegment);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tapeUnit: 'in' | 'cm' = preferredUnit === 'lb' ? 'in' : 'cm';

  // ---------------- Weight ----------------
  const [weightValue, setWeightValue] = useState(
    initialWeight != null && initialWeight > 0 ? initialWeight.toFixed(1) : ''
  );
  const [weightDate, setWeightDate] = useState(getLocalDateString());
  const weightInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && segment === 'weight') {
      // Autofocus + select for the 3-second daily entry: with the last
      // weigh-in prefilled, typing replaces it outright and a small
      // correction is a one-digit edit.
      const t = setTimeout(() => {
        weightInputRef.current?.focus();
        weightInputRef.current?.select();
      }, 150);
      return () => clearTimeout(t);
    }
  }, [isOpen, segment]);

  // ---------------- Measurements ----------------
  const [measureDate, setMeasureDate] = useState(getLocalDateString());
  /** Entered values in the DISPLAY unit, keyed by site. */
  const [measureValues, setMeasureValues] = useState<Record<string, string>>({});
  /** Previous entry (cm) for placeholders. */
  const [previousMeasurements, setPreviousMeasurements] = useState<Measurements | null>(null);
  const [previousLoggedAt, setPreviousLoggedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    async function fetchPrevious() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('body_measurements')
        .select('*')
        .eq('user_id', user.id)
        .order('logged_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setPreviousLoggedAt((data as { logged_at: string }).logged_at);
        setPreviousMeasurements(data as Measurements);
      }
    }
    fetchPrevious();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const placeholderFor = (key: keyof Measurements): string => {
    const prevCm = previousMeasurements?.[key];
    if (prevCm == null) return '—';
    const display = tapeUnit === 'in' ? cmToIn(Number(prevCm)) : Number(prevCm);
    return display.toFixed(1);
  };

  const measurementGroups = useMemo(() => {
    const groups = new Map<string, typeof MEASUREMENT_FIELDS>();
    MEASUREMENT_FIELDS.forEach((field) => {
      const list = groups.get(field.group) ?? [];
      list.push(field);
      groups.set(field.group, list);
    });
    return Array.from(groups.entries());
  }, []);

  // ---------------- DEXA ----------------
  const [scanDate, setScanDate] = useState(getLocalDateString());
  const [bfPercent, setBfPercent] = useState('');
  const [fatMass, setFatMass] = useState('');
  const [leanMass, setLeanMass] = useState('');
  const [scanWeight, setScanWeight] = useState('');
  const [boneMass, setBoneMass] = useState('');
  const [boneDensity, setBoneDensity] = useState('');
  const [facility, setFacility] = useState('');
  const [machine, setMachine] = useState('');
  const [dexaNotes, setDexaNotes] = useState('');

  /** Suggested total weight from the entered masses (display unit). */
  const suggestedScanWeight = useMemo(() => {
    const fat = parseFloat(fatMass);
    const lean = parseFloat(leanMass);
    if (!isFinite(fat) || !isFinite(lean)) return null;
    const bone = parseFloat(boneMass);
    const total = fat + lean + (isFinite(bone) ? bone : 0);
    return total > 0 ? total : null;
  }, [fatMass, leanMass, boneMass]);

  const resetAndClose = () => {
    setError(null);
    onClose();
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      if (segment === 'weight') {
        const weight = parseFloat(weightValue);
        if (!isFinite(weight) || weight <= 0 || weight >= 1500) {
          throw new Error('Enter a valid weight.');
        }
        await saveWeightLogEntry(supabase, user.id, {
          weight,
          unit: preferredUnit,
          date: weightDate,
        });
        onSaved?.({ kind: 'weight', date: weightDate, weight, unit: preferredUnit });
      } else if (segment === 'measurements') {
        const valuesCm: Record<string, number> = {};
        for (const [key, raw] of Object.entries(measureValues)) {
          const value = parseFloat(raw);
          if (!isFinite(value) || value <= 0) continue;
          valuesCm[key] = Math.round((tapeUnit === 'in' ? inToCm(value) : value) * 10) / 10;
        }
        if (Object.keys(valuesCm).length === 0) {
          throw new Error('Enter at least one measurement.');
        }
        await saveBodyMeasurements(supabase, user.id, measureDate, valuesCm);
        setMeasureValues({});
        onSaved?.({ kind: 'measurements', date: measureDate });
      } else {
        const bf = parseFloat(bfPercent);
        const fatDisplay = parseFloat(fatMass);
        const leanDisplay = parseFloat(leanMass);
        if (!isFinite(bf) || bf <= 0 || bf >= 100) throw new Error('Enter a valid body fat %.');
        if (!isFinite(fatDisplay) || fatDisplay <= 0) throw new Error('Enter fat mass.');
        if (!isFinite(leanDisplay) || leanDisplay <= 0) throw new Error('Enter lean mass.');
        const weightDisplay = parseFloat(scanWeight) || suggestedScanWeight;
        if (!weightDisplay || weightDisplay <= 0) throw new Error('Enter total weight.');

        const toKg = (v: number) => inputWeightToKg(v, preferredUnit);
        const boneDisplay = parseFloat(boneMass);
        await saveDexaScan(supabase, user.id, {
          scanDate,
          weightKg: toKg(weightDisplay),
          leanMassKg: toKg(leanDisplay),
          fatMassKg: toKg(fatDisplay),
          bodyFatPercent: bf,
          boneMassKg: isFinite(boneDisplay) && boneDisplay > 0 ? toKg(boneDisplay) : null,
          boneDensityGCm2: parseFloat(boneDensity) > 0 ? parseFloat(boneDensity) : null,
          facility: facility.trim() || null,
          machine: machine.trim() || null,
          notes: dexaNotes.trim() || null,
        });
        onSaved?.({ kind: 'dexa', date: scanDate });
      }
      resetAndClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save. Please try again.';
      setError(
        /duplicate|23505/i.test(message)
          ? 'A scan already exists for this date — pick a different date.'
          : message
      );
    } finally {
      setIsSaving(false);
    }
  };

  const massUnitLabel = preferredUnit;

  return (
    <BottomSheet isOpen={isOpen} onClose={resetAndClose} title="Log body data">
      <div className="space-y-4">
        <SegmentedControl
          options={SEGMENTS}
          value={segment}
          onChange={(value) => {
            setSegment(value as BodyLogSegment);
            setError(null);
          }}
          className="w-full [&>button]:flex-1"
        />

        {error && (
          <div className="p-2.5 rounded-lg bg-danger-500/10 border border-danger-500/20 text-danger-400 text-xs">
            {error}
          </div>
        )}

        {segment === 'weight' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelClass} htmlFor="body-log-weight">
                  Weight ({preferredUnit})
                </label>
                <input
                  id="body-log-weight"
                  ref={weightInputRef}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={weightValue}
                  onChange={(e) => setWeightValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                  }}
                  placeholder="0.0"
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label className={labelClass} htmlFor="body-log-weight-date">
                  Date
                </label>
                <input
                  id="body-log-weight-date"
                  type="date"
                  value={weightDate}
                  max={getLocalDateString()}
                  onChange={(e) => setWeightDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <button onClick={handleSave} disabled={isSaving} className={saveButtonClass}>
              {isSaving ? 'Saving...' : 'Save weight'}
            </button>
          </div>
        )}

        {segment === 'measurements' && (
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-2">
              <div className="flex-1">
                <label className={labelClass} htmlFor="body-log-measure-date">
                  Date
                </label>
                <input
                  id="body-log-measure-date"
                  type="date"
                  value={measureDate}
                  max={getLocalDateString()}
                  onChange={(e) => setMeasureDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <p className="text-[11px] text-surface-500 pb-2.5">
                {previousLoggedAt
                  ? `Previous: ${new Date(`${previousLoggedAt}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : 'First entry'}
                {' · '}
                {tapeUnit}
              </p>
            </div>

            <div className="max-h-[45vh] overflow-y-auto space-y-3 pr-1">
              {measurementGroups.map(([group, fields]) => (
                <div key={group}>
                  <p className="text-[11px] font-semibold tracking-wide uppercase text-surface-500 mb-1.5">
                    {group}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {fields.map((field) => (
                      <div key={field.key}>
                        <label className={labelClass} htmlFor={`body-log-${field.key}`}>
                          {field.label}
                        </label>
                        <input
                          id={`body-log-${field.key}`}
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          value={measureValues[field.key] ?? ''}
                          onChange={(e) =>
                            setMeasureValues((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          placeholder={placeholderFor(field.key)}
                          className={inputClass}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-surface-500">
              Skip any site — only filled fields are saved.
            </p>
            <button onClick={handleSave} disabled={isSaving} className={saveButtonClass}>
              {isSaving ? 'Saving...' : 'Save measurements'}
            </button>
          </div>
        )}

        {segment === 'dexa' && (
          <div className="space-y-3">
            <div className="max-h-[45vh] overflow-y-auto space-y-3 pr-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass} htmlFor="body-log-scan-date">
                    Scan date
                  </label>
                  <input
                    id="body-log-scan-date"
                    type="date"
                    value={scanDate}
                    max={getLocalDateString()}
                    onChange={(e) => setScanDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-bf">
                    Body fat %
                  </label>
                  <input
                    id="body-log-bf"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={bfPercent}
                    onChange={(e) => setBfPercent(e.target.value)}
                    placeholder="0.0"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-fat">
                    Fat mass ({massUnitLabel})
                  </label>
                  <input
                    id="body-log-fat"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={fatMass}
                    onChange={(e) => setFatMass(e.target.value)}
                    placeholder="0.0"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-lean">
                    Lean mass ({massUnitLabel})
                  </label>
                  <input
                    id="body-log-lean"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={leanMass}
                    onChange={(e) => setLeanMass(e.target.value)}
                    placeholder="0.0"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-scan-weight">
                    Total weight ({massUnitLabel})
                  </label>
                  <input
                    id="body-log-scan-weight"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={scanWeight}
                    onChange={(e) => setScanWeight(e.target.value)}
                    placeholder={suggestedScanWeight ? suggestedScanWeight.toFixed(1) : '0.0'}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-bone">
                    Bone mass ({massUnitLabel}, optional)
                  </label>
                  <input
                    id="body-log-bone"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={boneMass}
                    onChange={(e) => setBoneMass(e.target.value)}
                    placeholder="—"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-bmd">
                    Bone density (g/cm², optional)
                  </label>
                  <input
                    id="body-log-bmd"
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    value={boneDensity}
                    onChange={(e) => setBoneDensity(e.target.value)}
                    placeholder="—"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-facility">
                    Facility
                  </label>
                  <input
                    id="body-log-facility"
                    type="text"
                    value={facility}
                    onChange={(e) => setFacility(e.target.value)}
                    placeholder="e.g. BodySpec"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="body-log-machine">
                    Machine (optional)
                  </label>
                  <input
                    id="body-log-machine"
                    type="text"
                    value={machine}
                    onChange={(e) => setMachine(e.target.value)}
                    placeholder="e.g. GE Lunar"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="body-log-dexa-notes">
                  Notes
                </label>
                <textarea
                  id="body-log-dexa-notes"
                  value={dexaNotes}
                  onChange={(e) => setDexaNotes(e.target.value)}
                  rows={2}
                  placeholder="Fasted, morning, etc."
                  className={inputClass}
                />
              </div>
            </div>

            <p className="text-[11px] text-surface-500">
              Regional breakdown (arms/legs/trunk, android/gynoid, VAT)?{' '}
              <Link
                href="/dashboard/body-composition/add"
                className="text-primary-400 hover:text-primary-300"
              >
                Use the full scan form
              </Link>
              .
            </p>
            <button onClick={handleSave} disabled={isSaving} className={saveButtonClass}>
              {isSaving ? 'Saving...' : 'Save DEXA scan'}
            </button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
