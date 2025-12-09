'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { calculateLeanMass, calculateFatMass } from '@/services/bodyCompEngine';

export default function AddDexaScanPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [scanDate, setScanDate] = useState(new Date().toISOString().split('T')[0]);
  const [weightKg, setWeightKg] = useState('');
  const [bodyFatPercent, setBodyFatPercent] = useState('');
  const [leanMassKg, setLeanMassKg] = useState('');
  const [fatMassKg, setFatMassKg] = useState('');
  const [boneMassKg, setBoneMassKg] = useState('');
  const [notes, setNotes] = useState('');
  const [inputMode, setInputMode] = useState<'calculated' | 'manual'>('calculated');

  // Auto-calculate lean/fat mass when weight and body fat are entered
  const handleWeightOrBfChange = (newWeight: string, newBf: string) => {
    setWeightKg(newWeight);
    setBodyFatPercent(newBf);
    
    if (inputMode === 'calculated') {
      const weight = parseFloat(newWeight);
      const bf = parseFloat(newBf);
      
      if (!isNaN(weight) && !isNaN(bf) && bf >= 0 && bf <= 100) {
        const lean = calculateLeanMass(weight, bf);
        const fat = calculateFatMass(weight, bf);
        setLeanMassKg(lean.toFixed(2));
        setFatMassKg(fat.toFixed(2));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be logged in');

      const weight = parseFloat(weightKg);
      const bf = parseFloat(bodyFatPercent);
      const lean = parseFloat(leanMassKg);
      const fat = parseFloat(fatMassKg);
      const bone = boneMassKg ? parseFloat(boneMassKg) : null;

      if (isNaN(weight) || isNaN(bf) || isNaN(lean) || isNaN(fat)) {
        throw new Error('Please fill in all required fields with valid numbers');
      }

      if (bf < 0 || bf > 100) {
        throw new Error('Body fat percentage must be between 0 and 100');
      }

      const { error: insertError } = await supabase.from('dexa_scans').insert({
        user_id: user.id,
        scan_date: scanDate,
        weight_kg: weight,
        lean_mass_kg: lean,
        fat_mass_kg: fat,
        body_fat_percent: bf,
        bone_mass_kg: bone,
        notes: notes || null,
      });

      if (insertError) throw insertError;

      router.push('/dashboard/body-composition');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scan');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Add DEXA Scan</h1>
        <p className="text-surface-400 mt-1">Record your body composition data</p>
      </div>

      {error && (
        <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Date */}
            <Input
              label="Scan Date"
              type="date"
              value={scanDate}
              onChange={(e) => setScanDate(e.target.value)}
              required
            />

            {/* Input Mode Toggle */}
            <div className="flex gap-2 p-1 bg-surface-800 rounded-lg">
              <button
                type="button"
                onClick={() => setInputMode('calculated')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  inputMode === 'calculated'
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Auto-Calculate
              </button>
              <button
                type="button"
                onClick={() => setInputMode('manual')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  inputMode === 'manual'
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Manual Entry
              </button>
            </div>

            {inputMode === 'calculated' ? (
              <>
                <p className="text-xs text-surface-500">
                  Enter your total weight and body fat %, and lean/fat mass will be calculated automatically.
                </p>
                
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Total Weight (kg)"
                    type="number"
                    step="0.1"
                    value={weightKg}
                    onChange={(e) => handleWeightOrBfChange(e.target.value, bodyFatPercent)}
                    placeholder="e.g., 80.5"
                    required
                  />
                  <Input
                    label="Body Fat %"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={bodyFatPercent}
                    onChange={(e) => handleWeightOrBfChange(weightKg, e.target.value)}
                    placeholder="e.g., 15.0"
                    required
                  />
                </div>

                {leanMassKg && fatMassKg && (
                  <div className="grid grid-cols-2 gap-4 p-4 bg-surface-800/50 rounded-lg">
                    <div>
                      <p className="text-xs text-surface-500">Calculated Lean Mass</p>
                      <p className="text-lg font-mono text-surface-200">{leanMassKg} kg</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Calculated Fat Mass</p>
                      <p className="text-lg font-mono text-surface-200">{fatMassKg} kg</p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-surface-500">
                  Enter all values directly from your DEXA scan report.
                </p>
                
                <Input
                  label="Total Weight (kg)"
                  type="number"
                  step="0.1"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  placeholder="e.g., 80.5"
                  required
                />

                <Input
                  label="Body Fat %"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={bodyFatPercent}
                  onChange={(e) => setBodyFatPercent(e.target.value)}
                  placeholder="e.g., 15.0"
                  required
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Lean Mass (kg)"
                    type="number"
                    step="0.01"
                    value={leanMassKg}
                    onChange={(e) => setLeanMassKg(e.target.value)}
                    placeholder="e.g., 65.50"
                    required
                  />
                  <Input
                    label="Fat Mass (kg)"
                    type="number"
                    step="0.01"
                    value={fatMassKg}
                    onChange={(e) => setFatMassKg(e.target.value)}
                    placeholder="e.g., 12.10"
                    required
                  />
                </div>
              </>
            )}

            {/* Optional: Bone Mass */}
            <Input
              label="Bone Mass (kg) - Optional"
              type="number"
              step="0.01"
              value={boneMassKg}
              onChange={(e) => setBoneMassKg(e.target.value)}
              placeholder="e.g., 2.95"
              hint="Bone mineral content if provided by your scan"
            />

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this scan..."
                rows={3}
                className="w-full px-4 py-2.5 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={isSubmitting}
                className="flex-1"
              >
                Save Scan
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">About DEXA Scans</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-surface-400">
            DEXA (Dual-Energy X-ray Absorptiometry) is considered the gold standard for body composition 
            measurement. For best tracking, try to get scans under similar conditions (same time of day, 
            hydration status, etc.).
          </p>
          <p className="text-sm text-surface-500 mt-3">
            <strong>Tip:</strong> Getting scans every 8-12 weeks provides enough time to see meaningful 
            changes while not being too frequent.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

