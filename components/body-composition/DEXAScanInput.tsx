'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select } from '@/components/ui';
import { saveDEXAScan } from '@/lib/actions/body-composition';
import type { DEXAScanInput as DEXAScanInputType, ScanConditions } from '@/src/lib/body-composition';
import { cn } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { kgToLbs, lbsToKg } from '@/lib/utils';

interface DEXAScanInputProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function DEXAScanInput({ onSuccess, onCancel }: DEXAScanInputProps) {
  const router = useRouter();
  const { preferences } = useUserPreferences();
  const units = preferences?.units || 'lb';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [scanDate, setScanDate] = useState(new Date().toISOString().split('T')[0]);
  const [provider, setProvider] = useState('');
  const [totalWeight, setTotalWeight] = useState('');
  const [bodyFatPercent, setBodyFatPercent] = useState('');

  // Optional direct mass entry
  const [showDirectEntry, setShowDirectEntry] = useState(false);
  const [fatMass, setFatMass] = useState('');
  const [leanMass, setLeanMass] = useState('');
  const [boneMass, setBoneMass] = useState('');

  // Conditions
  const [timeOfDay, setTimeOfDay] = useState<ScanConditions['timeOfDay']>('morning_fasted');
  const [hydrationStatus, setHydrationStatus] = useState<ScanConditions['hydrationStatus']>('normal');
  const [recentWorkout, setRecentWorkout] = useState(false);
  const [sameProvider, setSameProvider] = useState(true);

  // Notes
  const [notes, setNotes] = useState('');

  // Convert weight based on units
  const convertToKg = (value: string): number => {
    const num = parseFloat(value);
    if (isNaN(num)) return 0;
    return units === 'lb' ? lbsToKg(num) : num;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const totalWeightKg = convertToKg(totalWeight);
      const bodyFatPct = parseFloat(bodyFatPercent);

      if (!totalWeightKg || !bodyFatPct) {
        throw new Error('Please enter your total weight and body fat percentage');
      }

      if (bodyFatPct < 3 || bodyFatPct > 60) {
        throw new Error('Body fat percentage should be between 3% and 60%');
      }

      const input: DEXAScanInputType = {
        scanDate: new Date(scanDate),
        provider: provider || undefined,
        totalWeight: totalWeightKg,
        bodyFatPercent: bodyFatPct,
        fatMass: fatMass ? convertToKg(fatMass) : undefined,
        leanMass: leanMass ? convertToKg(leanMass) : undefined,
        boneMass: boneMass ? convertToKg(boneMass) : undefined,
        conditions: {
          timeOfDay,
          hydrationStatus,
          recentWorkout,
          sameProviderAsPrevious: sameProvider,
        },
        notes: notes || undefined,
      };

      const result = await saveDEXAScan(input);

      if (!result) {
        throw new Error('Failed to save scan. Please try again.');
      }

      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/dashboard/body-composition');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const weightUnit = units === 'lb' ? 'lbs' : 'kg';

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle>Log DEXA Scan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date & Provider */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Scan Date"
              type="date"
              value={scanDate}
              onChange={(e) => setScanDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
            />
            <Select
              label="Provider (optional)"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              options={[
                { value: '', label: 'Select provider...' },
                { value: 'DexaFit', label: 'DexaFit' },
                { value: 'BodySpec', label: 'BodySpec' },
                { value: 'Hospital', label: 'Hospital/Medical' },
                { value: 'Other', label: 'Other' },
              ]}
            />
          </div>

          <div className="border-t border-surface-800 pt-6">
            <h3 className="text-sm font-medium text-surface-200 mb-4">
              From Your Scan Report
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label={`Total Body Weight (${weightUnit})`}
                type="number"
                step="0.1"
                value={totalWeight}
                onChange={(e) => setTotalWeight(e.target.value)}
                placeholder={units === 'lb' ? '176.6' : '80.1'}
              />
              <Input
                label="Body Fat Percentage (%)"
                type="number"
                step="0.1"
                value={bodyFatPercent}
                onChange={(e) => setBodyFatPercent(e.target.value)}
                placeholder="18.2"
              />
            </div>
          </div>

          {/* Optional Direct Entry */}
          <div className="border-t border-surface-800 pt-6">
            <button
              type="button"
              onClick={() => setShowDirectEntry(!showDirectEntry)}
              className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
            >
              <svg
                className={cn('w-4 h-4 transition-transform', showDirectEntry && 'rotate-90')}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Or enter masses directly
            </button>

            {showDirectEntry && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label={`Fat Mass (${weightUnit})`}
                  type="number"
                  step="0.1"
                  value={fatMass}
                  onChange={(e) => setFatMass(e.target.value)}
                  hint="Optional"
                />
                <Input
                  label={`Lean Mass (${weightUnit})`}
                  type="number"
                  step="0.1"
                  value={leanMass}
                  onChange={(e) => setLeanMass(e.target.value)}
                  hint="Optional"
                />
                <Input
                  label={`Bone Mass (${weightUnit})`}
                  type="number"
                  step="0.1"
                  value={boneMass}
                  onChange={(e) => setBoneMass(e.target.value)}
                  hint="Optional"
                />
              </div>
            )}
          </div>

          {/* Scan Conditions */}
          <div className="border-t border-surface-800 pt-6">
            <h3 className="text-sm font-medium text-surface-200 mb-1">Scan Conditions</h3>
            <p className="text-xs text-surface-500 mb-4">
              This helps us estimate measurement accuracy
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Time of Day"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value as ScanConditions['timeOfDay'])}
                options={[
                  { value: 'morning_fasted', label: 'Morning, fasted' },
                  { value: 'morning_fed', label: 'Morning, fed' },
                  { value: 'afternoon', label: 'Afternoon' },
                  { value: 'evening', label: 'Evening' },
                ]}
              />
              <Select
                label="Hydration Status"
                value={hydrationStatus}
                onChange={(e) => setHydrationStatus(e.target.value as ScanConditions['hydrationStatus'])}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'dehydrated', label: 'Dehydrated' },
                  { value: 'overhydrated', label: 'Overhydrated' },
                  { value: 'unknown', label: "Don't know" },
                ]}
              />
            </div>

            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recentWorkout}
                  onChange={(e) => setRecentWorkout(e.target.checked)}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                />
                <span className="text-sm text-surface-300">
                  Worked out within 24 hours of scan
                </span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sameProvider}
                  onChange={(e) => setSameProvider(e.target.checked)}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                />
                <span className="text-sm text-surface-300">
                  Same provider as previous scan
                </span>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div className="border-t border-surface-800 pt-6">
            <label className="block text-sm font-medium text-surface-200 mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., End of cut, feeling flat"
              className="w-full rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5 text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 resize-none"
              rows={3}
            />
          </div>

          {/* Confidence Preview */}
          {totalWeight && bodyFatPercent && (
            <div className="border-t border-surface-800 pt-6">
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs uppercase tracking-wider text-surface-500">
                    Scan Confidence
                  </span>
                  <span
                    className={cn(
                      'px-2 py-0.5 text-xs rounded-full',
                      timeOfDay === 'morning_fasted' && hydrationStatus === 'normal' && !recentWorkout
                        ? 'bg-success-500/20 text-success-400'
                        : timeOfDay === 'morning_fasted' || hydrationStatus === 'normal'
                        ? 'bg-warning-500/20 text-warning-400'
                        : 'bg-surface-700 text-surface-400'
                    )}
                  >
                    {timeOfDay === 'morning_fasted' && hydrationStatus === 'normal' && !recentWorkout
                      ? 'High'
                      : timeOfDay === 'morning_fasted' || hydrationStatus === 'normal'
                      ? 'Medium'
                      : 'Low'}
                  </span>
                </div>
                <p className="text-xs text-surface-400">
                  {timeOfDay === 'morning_fasted' && hydrationStatus === 'normal' && !recentWorkout
                    ? 'Excellent conditions for an accurate scan.'
                    : timeOfDay !== 'morning_fasted'
                    ? 'Morning fasted scans are most consistent.'
                    : hydrationStatus !== 'normal'
                    ? 'Hydration affects DEXA readings. Normal hydration gives the most accurate results.'
                    : recentWorkout
                    ? 'Recent workouts cause fluid shifts that can affect readings.'
                    : 'Consider improving scan conditions for better accuracy.'}
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg">
              <p className="text-sm text-danger-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Saving...' : 'Save Scan'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
