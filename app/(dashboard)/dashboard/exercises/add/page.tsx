'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS, MOVEMENT_PATTERNS } from '@/types/schema';

export default function AddExercisePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [primaryMuscle, setPrimaryMuscle] = useState('');
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>([]);
  const [mechanic, setMechanic] = useState<'compound' | 'isolation'>('isolation');
  const [hypertrophyTier, setHypertrophyTier] = useState<'S' | 'A' | 'B' | 'C' | 'D'>('B');
  const [minReps, setMinReps] = useState('8');
  const [maxReps, setMaxReps] = useState('12');
  const [defaultRir, setDefaultRir] = useState('2');
  const [minIncrement, setMinIncrement] = useState('2.5');
  const [movementPattern, setMovementPattern] = useState('');
  const [equipment, setEquipment] = useState('');
  const [formCues, setFormCues] = useState('');
  const [setupNote, setSetupNote] = useState('');

  const toggleSecondaryMuscle = (muscle: string) => {
    if (muscle === primaryMuscle) return; // Can't be both primary and secondary
    setSecondaryMuscles(prev => 
      prev.includes(muscle) 
        ? prev.filter(m => m !== muscle)
        : [...prev, muscle]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      if (!name.trim()) throw new Error('Exercise name is required');
      if (!primaryMuscle) throw new Error('Primary muscle is required');

      const supabase = createUntypedClient();
      
      // Parse form cues into array
      const cuesArray = formCues
        .split('\n')
        .map(cue => cue.trim())
        .filter(cue => cue.length > 0);

      // Parse equipment into array
      const equipmentArray = equipment
        .split(',')
        .map(eq => eq.trim().toLowerCase())
        .filter(eq => eq.length > 0);

      const { error: insertError } = await supabase.from('exercises').insert({
        name: name.trim(),
        primary_muscle: primaryMuscle,
        secondary_muscles: secondaryMuscles,
        mechanic,
        default_rep_range: [parseInt(minReps), parseInt(maxReps)],
        default_rir: parseInt(defaultRir),
        min_weight_increment_kg: parseFloat(minIncrement),
        movement_pattern: movementPattern || null,
        equipment_required: equipmentArray.length > 0 ? equipmentArray : [],
        form_cues: cuesArray,
        common_mistakes: [],
        setup_note: setupNote || null,
        hypertrophy_tier: hypertrophyTier,
      });

      if (insertError) {
        if (insertError.code === '23505') {
          throw new Error('An exercise with this name already exists');
        }
        throw insertError;
      }

      router.push('/dashboard/exercises');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add exercise');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Add Custom Exercise</h1>
        <p className="text-surface-400 mt-1">Create an exercise for your gym&apos;s equipment</p>
      </div>

      {error && (
        <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <Input
              label="Exercise Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Life Fitness Chest Press"
              required
            />

            <Select
              label="Primary Muscle"
              value={primaryMuscle}
              onChange={(e) => {
                setPrimaryMuscle(e.target.value);
                // Remove from secondary if it was selected there
                setSecondaryMuscles(prev => prev.filter(m => m !== e.target.value));
              }}
              options={[
                { value: '', label: 'Select primary muscle...' },
                ...MUSCLE_GROUPS.map(m => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))
              ]}
              required
            />

            {/* Secondary Muscles */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">
                Secondary Muscles (optional)
              </label>
              <div className="flex flex-wrap gap-2">
                {MUSCLE_GROUPS.filter(m => m !== primaryMuscle).map(muscle => (
                  <button
                    key={muscle}
                    type="button"
                    onClick={() => toggleSecondaryMuscle(muscle)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                      secondaryMuscles.includes(muscle)
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>
            </div>

            {/* Mechanic Type */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">
                Exercise Type
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMechanic('compound')}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 text-center transition-colors ${
                    mechanic === 'compound'
                      ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                      : 'border-surface-700 text-surface-400 hover:border-surface-600'
                  }`}
                >
                  <div className="font-medium">Compound</div>
                  <div className="text-xs opacity-75 mt-1">Multi-joint movement</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMechanic('isolation')}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 text-center transition-colors ${
                    mechanic === 'isolation'
                      ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                      : 'border-surface-700 text-surface-400 hover:border-surface-600'
                  }`}
                >
                  <div className="font-medium">Isolation</div>
                  <div className="text-xs opacity-75 mt-1">Single-joint movement</div>
                </button>
              </div>
            </div>

            {/* Hypertrophy Tier */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">
                Hypertrophy Effectiveness
              </label>
              <p className="text-xs text-surface-500 mb-3">
                How effective is this exercise for muscle growth? S-tier = best, D-tier = least effective.
              </p>
              <div className="flex gap-2">
                {(['S', 'A', 'B', 'C', 'D'] as const).map((tier) => {
                  const tierColors = {
                    S: 'border-yellow-500 bg-yellow-500/20 text-yellow-400',
                    A: 'border-emerald-500 bg-emerald-500/20 text-emerald-400',
                    B: 'border-blue-500 bg-blue-500/20 text-blue-400',
                    C: 'border-orange-500 bg-orange-500/20 text-orange-400',
                    D: 'border-surface-500 bg-surface-500/20 text-surface-400',
                  };
                  const tierDescriptions = {
                    S: 'Elite - Best in class',
                    A: 'Excellent',
                    B: 'Good',
                    C: 'Moderate',
                    D: 'Limited',
                  };
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setHypertrophyTier(tier)}
                      className={`flex-1 py-3 px-2 rounded-lg border-2 text-center transition-all ${
                        hypertrophyTier === tier
                          ? tierColors[tier]
                          : 'border-surface-700 text-surface-500 hover:border-surface-600'
                      }`}
                    >
                      <div className="text-lg font-bold">{tier}</div>
                      <div className="text-[10px] opacity-75 mt-0.5 leading-tight">{tierDescriptions[tier]}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Rep Range */}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Min Reps"
                type="number"
                min="1"
                max="100"
                value={minReps}
                onChange={(e) => setMinReps(e.target.value)}
              />
              <Input
                label="Max Reps"
                type="number"
                min="1"
                max="100"
                value={maxReps}
                onChange={(e) => setMaxReps(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Default RIR"
                type="number"
                min="0"
                max="5"
                value={defaultRir}
                onChange={(e) => setDefaultRir(e.target.value)}
                hint="Reps in reserve"
              />
              <Input
                label="Min Increment (kg)"
                type="number"
                step="0.5"
                min="0"
                value={minIncrement}
                onChange={(e) => setMinIncrement(e.target.value)}
                hint="Smallest weight jump"
              />
            </div>

            {/* Equipment */}
            <Input
              label="Equipment Required"
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              placeholder="e.g., cable machine, rope attachment"
              hint="Comma-separated list"
            />

            {/* Movement Pattern */}
            <Select
              label="Movement Pattern (optional)"
              value={movementPattern}
              onChange={(e) => setMovementPattern(e.target.value)}
              options={[
                { value: '', label: 'Select pattern...' },
                ...MOVEMENT_PATTERNS.map(p => ({ 
                  value: p, 
                  label: p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                }))
              ]}
            />

            {/* Form Cues */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5">
                Form Cues (optional)
              </label>
              <textarea
                value={formCues}
                onChange={(e) => setFormCues(e.target.value)}
                placeholder="Enter one cue per line..."
                rows={4}
                className="w-full px-4 py-2.5 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
              <p className="text-xs text-surface-500 mt-1">One tip per line</p>
            </div>

            {/* Setup Note */}
            <Input
              label="Setup Note (optional)"
              value={setupNote}
              onChange={(e) => setSetupNote(e.target.value)}
              placeholder="e.g., Adjust seat height to align handles with mid-chest"
            />

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
                Add Exercise
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

