'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Slider, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { formatWeight } from '@/lib/utils';
import type { Goal, Experience, DexaScan } from '@/types/schema';
import {
  generateMesocycleRecommendation,
  generateWorkoutTemplates,
  recommendSplit,
  type MesocycleRecommendation,
  type WorkoutTemplate,
} from '@/services/mesocycleBuilder';

export default function NewMesocyclePage() {
  const router = useRouter();
  const { preferences, isLoading: prefsLoading } = useUserPreferences();
  
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // User profile data
  const [userGoal, setUserGoal] = useState<Goal>('maintenance');
  const [userExperience, setUserExperience] = useState<Experience>('intermediate');
  const [latestDexa, setLatestDexa] = useState<DexaScan | null>(null);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [useAiRecommendation, setUseAiRecommendation] = useState(true);
  
  // AI recommendations
  const [recommendation, setRecommendation] = useState<MesocycleRecommendation | null>(null);
  const [workoutTemplates, setWorkoutTemplates] = useState<WorkoutTemplate[]>([]);
  
  // Manual overrides
  const [splitType, setSplitType] = useState('Upper/Lower');
  const [totalWeeks, setTotalWeeks] = useState(6);

  // Load user data on mount
  useEffect(() => {
    async function loadUserData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Get user profile
        const { data: profile } = await supabase
          .from('users')
          .select('goal, experience, height_cm')
          .eq('id', user.id)
          .single();
        
        if (profile) {
          setUserGoal(profile.goal || 'maintenance');
          setUserExperience(profile.experience || 'intermediate');
          setHeightCm(profile.height_cm);
        }
        
        // Get latest DEXA scan
        const { data: scans } = await supabase
          .from('dexa_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scan_date', { ascending: false })
          .limit(1);
        
        if (scans && scans.length > 0) {
          setLatestDexa({
            id: scans[0].id,
            userId: scans[0].user_id,
            scanDate: scans[0].scan_date,
            weightKg: scans[0].weight_kg,
            leanMassKg: scans[0].lean_mass_kg,
            fatMassKg: scans[0].fat_mass_kg,
            bodyFatPercent: scans[0].body_fat_percent,
            boneMassKg: scans[0].bone_mass_kg,
            notes: scans[0].notes,
            createdAt: scans[0].created_at,
          });
        }
      }
    }
    
    loadUserData();
  }, []);

  // Generate recommendations when days change
  useEffect(() => {
    if (useAiRecommendation) {
      const rec = generateMesocycleRecommendation(
        { goal: userGoal, experience: userExperience, heightCm, latestDexa },
        daysPerWeek
      );
      setRecommendation(rec);
      setSplitType(rec.splitType);
      setTotalWeeks(rec.totalWeeks);
      
      // Generate workout templates
      const templates = generateWorkoutTemplates(
        rec.splitType,
        rec.volumePerMuscle,
        latestDexa?.leanMassKg || null,
        userExperience
      );
      setWorkoutTemplates(templates);
    }
  }, [daysPerWeek, userGoal, userExperience, heightCm, latestDexa, useAiRecommendation]);

  // Generate default name
  useEffect(() => {
    const goalNames = { bulk: 'Hypertrophy', cut: 'Cutting', maintenance: 'Training' };
    setName(`${goalNames[userGoal]} Block - ${splitType}`);
  }, [userGoal, splitType]);

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('You must be logged in');

      // Create mesocycle
      const { data: mesocycle, error: insertError } = await supabase
        .from('mesocycles')
        .insert({
          user_id: user.id,
          name,
          split_type: splitType,
          days_per_week: daysPerWeek,
          total_weeks: totalWeeks,
          deload_week: totalWeeks,
          current_week: 1,
          state: 'active',
          fatigue_score: 0,
        })
        .select()
        .single();

      if (insertError || !mesocycle) throw insertError || new Error('Failed to create mesocycle');

      router.push('/dashboard/mesocycle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mesocycle');
      setIsLoading(false);
    }
  };

  const splitOptions = [
    { value: 'PPL', label: 'Push/Pull/Legs' },
    { value: 'Upper/Lower', label: 'Upper/Lower' },
    { value: 'Full Body', label: 'Full Body' },
    { value: 'Bro Split', label: 'Bro Split (5-day)' },
  ];

  if (prefsLoading) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <p className="text-surface-400 text-center">Loading your profile...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Create Mesocycle</h1>
        <p className="text-surface-400 mt-1">
          AI-assisted training plan based on your profile
        </p>
      </div>

      {/* Progress steps */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex-1 h-1 rounded-full transition-colors ${
              s <= step ? 'bg-primary-500' : 'bg-surface-700'
            }`}
          />
        ))}
      </div>

      {/* Your Profile Summary */}
      {step === 1 && (
        <Card className="border-primary-500/30 bg-primary-500/5">
          <CardHeader>
            <CardTitle className="text-sm text-primary-400">Your Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-surface-500">Goal</p>
                <p className="font-medium text-surface-200 capitalize">{userGoal}</p>
              </div>
              <div>
                <p className="text-surface-500">Experience</p>
                <p className="font-medium text-surface-200 capitalize">{userExperience}</p>
              </div>
              {latestDexa && (
                <>
                  <div>
                    <p className="text-surface-500">Lean Mass</p>
                    <p className="font-medium text-surface-200">
                      {formatWeight(latestDexa.leanMassKg, preferences.units)}
                    </p>
                  </div>
                  <div>
                    <p className="text-surface-500">Body Fat</p>
                    <p className="font-medium text-surface-200">{latestDexa.bodyFatPercent}%</p>
                  </div>
                </>
              )}
            </div>
            {!latestDexa && (
              <p className="text-xs text-surface-500 mt-3">
                💡 Add a DEXA scan in Body Composition for personalized weight recommendations
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Schedule */}
      {step === 1 && (
        <Card variant="elevated">
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-surface-100">How often can you train?</h2>
              <p className="text-sm text-surface-400">We&apos;ll recommend the best split for your schedule</p>
            </div>

            <Slider
              label="Training Days per Week"
              min={2}
              max={6}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(parseInt(e.target.value))}
              valueFormatter={(v) => `${v} days`}
              marks={[
                { value: 2, label: '2' },
                { value: 3, label: '3' },
                { value: 4, label: '4' },
                { value: 5, label: '5' },
                { value: 6, label: '6' },
              ]}
            />

            {/* AI Recommendation */}
            {recommendation && (
              <div className="p-4 bg-surface-800/50 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className="font-medium text-surface-200">AI Recommendation</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="info">{recommendation.splitType}</Badge>
                  <span className="text-sm text-surface-400">{recommendation.splitReason}</span>
                </div>
              </div>
            )}

            {/* Toggle for AI vs Manual */}
            <label className="flex items-center justify-between p-3 bg-surface-800/30 rounded-lg cursor-pointer">
              <div>
                <p className="font-medium text-surface-200">Use AI recommendations</p>
                <p className="text-xs text-surface-500">Let us optimize your split and volume</p>
              </div>
              <button
                onClick={() => setUseAiRecommendation(!useAiRecommendation)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  useAiRecommendation ? 'bg-primary-500' : 'bg-surface-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    useAiRecommendation ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>

            <div className="pt-4 flex justify-end">
              <Button onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 2: Customize */}
      {step === 2 && (
        <Card variant="elevated">
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-surface-100">Customize Your Plan</h2>
              <p className="text-sm text-surface-400">Fine-tune the AI recommendations</p>
            </div>

            <Input
              label="Mesocycle Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Hypertrophy Block 1"
            />

            <Select
              label="Training Split"
              value={splitType}
              onChange={(e) => setSplitType(e.target.value)}
              options={splitOptions}
              hint={useAiRecommendation && recommendation ? `Recommended: ${recommendation.splitType}` : undefined}
            />

            <Slider
              label="Mesocycle Length"
              min={4}
              max={8}
              value={totalWeeks}
              onChange={(e) => setTotalWeeks(parseInt(e.target.value))}
              valueFormatter={(v) => `${v} weeks`}
              marks={[
                { value: 4, label: '4' },
                { value: 5, label: '5' },
                { value: 6, label: '6' },
                { value: 7, label: '7' },
                { value: 8, label: '8' },
              ]}
            />

            <div className="p-4 bg-surface-800/50 rounded-lg">
              <p className="text-sm text-surface-400">
                <span className="text-surface-300 font-medium">Week {totalWeeks}</span> will automatically be a deload week with 50% reduced volume.
              </p>
            </div>

            {/* AI Recommendations list */}
            {recommendation && recommendation.recommendations.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-surface-300">Coaching Tips</p>
                {recommendation.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-surface-400">
                    <svg className="w-4 h-4 text-primary-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {rec}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <Card variant="elevated">
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-surface-100">Review Your Plan</h2>
              <p className="text-sm text-surface-400">Everything looks good?</p>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Name</span>
                <span className="text-surface-200 font-medium">{name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Split</span>
                <span className="text-surface-200 font-medium">{splitType}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Frequency</span>
                <span className="text-surface-200 font-medium">{daysPerWeek} days/week</span>
              </div>
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Duration</span>
                <span className="text-surface-200 font-medium">{totalWeeks} weeks</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-surface-400">Deload</span>
                <span className="text-surface-200 font-medium">Week {totalWeeks}</span>
              </div>
            </div>

            {/* Weekly Volume Preview */}
            {recommendation && (
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <p className="text-sm font-medium text-surface-300 mb-3">Weekly Volume (sets)</p>
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  {Object.entries(recommendation.volumePerMuscle).slice(0, 10).map(([muscle, sets]) => (
                    <div key={muscle} className="p-2 bg-surface-900/50 rounded">
                      <p className="text-surface-500 capitalize truncate">{muscle}</p>
                      <p className="text-surface-200 font-mono font-medium">{sets}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workout Preview */}
            {workoutTemplates.length > 0 && (
              <div>
                <p className="text-sm font-medium text-surface-300 mb-3">Workout Structure</p>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {workoutTemplates.map((template, i) => (
                    <div key={i} className="shrink-0 p-3 bg-surface-800/50 rounded-lg min-w-[140px]">
                      <p className="font-medium text-surface-200 text-sm">{template.dayName}</p>
                      <p className="text-xs text-surface-500 mt-1">
                        {template.exercises.length} exercises
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {template.muscles.slice(0, 3).map(m => (
                          <Badge key={m} size="sm" variant="default" className="capitalize text-xs">
                            {m}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={handleSubmit} isLoading={isLoading}>
                Create Mesocycle
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
