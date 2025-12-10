'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Slider, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradePrompt } from '@/components/subscription';
import { formatWeight } from '@/lib/utils';
import type { Goal, Experience, DexaScan, Equipment, MuscleGroup, Rating, ExtendedUserProfile, FullProgramRecommendation, DexaRegionalData } from '@/types/schema';
import {
  generateMesocycleRecommendation,
  generateWorkoutTemplates,
  generateFullProgram,
  recommendSplit,
  calculateRecoveryFactors,
  type MesocycleRecommendation,
  type WorkoutTemplate,
} from '@/services/mesocycleBuilder';
import { analyzeRegionalComposition } from '@/services/regionalAnalysis';

export default function NewMesocyclePage() {
  const router = useRouter();
  const { preferences, isLoading: prefsLoading } = useUserPreferences();
  const { canAccess, isLoading: subLoading } = useSubscription();
  
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // User profile data
  const [userGoal, setUserGoal] = useState<Goal>('maintenance');
  const [userExperience, setUserExperience] = useState<Experience>('intermediate');
  const [latestDexa, setLatestDexa] = useState<DexaScan | null>(null);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  
  // Extended profile data
  const [userAge, setUserAge] = useState<number>(30);
  const [sleepQuality, setSleepQuality] = useState<Rating>(3);
  const [stressLevel, setStressLevel] = useState<Rating>(3);
  const [trainingAge, setTrainingAge] = useState<number>(1);
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight']);
  const [injuryHistory, setInjuryHistory] = useState<MuscleGroup[]>([]);
  
  // Form state
  const [name, setName] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(60);
  const [useAiRecommendation, setUseAiRecommendation] = useState(true);
  
  // AI recommendations
  const [recommendation, setRecommendation] = useState<MesocycleRecommendation | null>(null);
  const [workoutTemplates, setWorkoutTemplates] = useState<WorkoutTemplate[]>([]);
  const [fullProgram, setFullProgram] = useState<FullProgramRecommendation | null>(null);
  
  // Manual overrides
  const [splitType, setSplitType] = useState('Upper/Lower');
  const [totalWeeks, setTotalWeeks] = useState(6);

  // Calculate estimated exercises based on time
  const getExerciseEstimate = (minutes: number) => {
    // Rough estimate: 8-10 min per exercise (including rest)
    const minExercises = Math.floor(minutes / 10);
    const maxExercises = Math.floor(minutes / 7);
    return { min: Math.max(3, minExercises), max: Math.min(12, maxExercises) };
  };
  
  const exerciseEstimate = getExerciseEstimate(sessionDurationMinutes);

  // Optimal session duration based on training frequency
  const getOptimalSessionTime = (days: number): { min: number; optimal: number; max: number; reason: string } => {
    switch (days) {
      case 2:
        return { min: 60, optimal: 75, max: 90, reason: 'Full body 2x/week needs longer sessions to hit all muscle groups' };
      case 3:
        return { min: 50, optimal: 60, max: 75, reason: 'Full body or PPL works well with moderate session length' };
      case 4:
        return { min: 45, optimal: 55, max: 70, reason: 'Upper/Lower split allows focused training per session' };
      case 5:
        return { min: 40, optimal: 50, max: 65, reason: 'Higher frequency allows shorter, more focused sessions' };
      case 6:
        return { min: 35, optimal: 45, max: 60, reason: 'PPL 2x/week - keep sessions efficient to manage recovery' };
      default:
        return { min: 45, optimal: 60, max: 75, reason: 'Standard recommendation' };
    }
  };

  // Assess total weekly volume
  const assessWeeklyVolume = (days: number, minutesPerSession: number) => {
    const totalMinutes = days * minutesPerSession;
    const totalHours = totalMinutes / 60;
    
    // Optimal ranges for hypertrophy (natural lifters)
    const minEffective = 3; // hours/week
    const optimalMin = 4;
    const optimalMax = 6;
    const maxRecoverable = 8;
    
    let status: 'too_low' | 'low' | 'optimal' | 'high' | 'too_high';
    let message: string;
    let color: string;
    
    if (totalHours < minEffective) {
      status = 'too_low';
      message = `${totalHours.toFixed(1)} hrs/week may be insufficient for optimal hypertrophy. Consider adding time or days.`;
      color = 'text-danger-400';
    } else if (totalHours < optimalMin) {
      status = 'low';
      message = `${totalHours.toFixed(1)} hrs/week is on the lower end. You'll progress, but more volume could help.`;
      color = 'text-warning-400';
    } else if (totalHours <= optimalMax) {
      status = 'optimal';
      message = `${totalHours.toFixed(1)} hrs/week is in the optimal range for hypertrophy!`;
      color = 'text-success-400';
    } else if (totalHours <= maxRecoverable) {
      status = 'high';
      message = `${totalHours.toFixed(1)} hrs/week is high volume. Make sure nutrition and sleep support this.`;
      color = 'text-warning-400';
    } else {
      status = 'too_high';
      message = `${totalHours.toFixed(1)} hrs/week exceeds typical recovery capacity. Consider reducing.`;
      color = 'text-danger-400';
    }
    
    return { status, message, color, totalHours, optimalMin, optimalMax };
  };

  const optimalTime = getOptimalSessionTime(daysPerWeek);
  const volumeAssessment = assessWeeklyVolume(daysPerWeek, sessionDurationMinutes);

  // Load user data on mount
  useEffect(() => {
    async function loadUserData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Get user profile with extended fields
        const { data: profile } = await supabase
          .from('users')
          .select('goal, experience, height_cm, age, sleep_quality, stress_level, training_age, available_equipment, injury_history')
          .eq('id', user.id)
          .single();
        
        if (profile) {
          setUserGoal(profile.goal || 'maintenance');
          setUserExperience(profile.experience || 'intermediate');
          setHeightCm(profile.height_cm);
          if (profile.age) setUserAge(profile.age);
          if (profile.sleep_quality) setSleepQuality(profile.sleep_quality as Rating);
          if (profile.stress_level) setStressLevel(profile.stress_level as Rating);
          if (profile.training_age !== null && profile.training_age !== undefined) setTrainingAge(profile.training_age);
          if (profile.available_equipment && Array.isArray(profile.available_equipment)) {
            setAvailableEquipment(profile.available_equipment as Equipment[]);
          }
          if (profile.injury_history && Array.isArray(profile.injury_history)) {
            setInjuryHistory(profile.injury_history as MuscleGroup[]);
          }
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
            regionalData: scans[0].regional_data || null,
            notes: scans[0].notes,
            createdAt: scans[0].created_at,
          });
        }
      }
    }
    
    loadUserData();
  }, []);

  // Build extended profile for full program generation
  const extendedProfile: ExtendedUserProfile = {
    age: userAge,
    experience: userExperience,
    goal: userGoal,
    sleepQuality,
    stressLevel,
    availableEquipment,
    injuryHistory,
    trainingAge,
    heightCm,
    latestDexa,
  };

  // Calculate recovery factors for display
  const recoveryFactors = calculateRecoveryFactors(extendedProfile);

  // Generate recommendations when days change
  useEffect(() => {
    if (useAiRecommendation) {
      // Generate legacy recommendation for backwards compatibility
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
      
      // Analyze regional data for lagging areas (if available)
      let laggingAreas: string[] = [];
      if (latestDexa?.regionalData && latestDexa.leanMassKg) {
        const regionalAnalysis = analyzeRegionalComposition(
          latestDexa.regionalData as DexaRegionalData,
          latestDexa.leanMassKg
        );
        laggingAreas = regionalAnalysis.laggingAreas;
      }
      
      // Generate full program with extended profile and lagging areas
      const program = generateFullProgram(daysPerWeek, extendedProfile, sessionDurationMinutes, laggingAreas);
      setFullProgram(program);
    }
  }, [daysPerWeek, userGoal, userExperience, heightCm, latestDexa, useAiRecommendation, 
      userAge, sleepQuality, stressLevel, trainingAge, availableEquipment, injuryHistory, sessionDurationMinutes]);

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

  // Check subscription access (must be after all hooks)
  if (!subLoading && !canAccess('mesocycleBuilder')) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">AI Mesocycle Builder</h1>
          <p className="text-surface-400 mt-1">Create scientifically-optimized training programs</p>
        </div>
        <UpgradePrompt feature="mesocycleBuilder" />
      </div>
    );
  }

  if (prefsLoading || subLoading) {
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

      {/* Recovery Profile Summary */}
      {step === 1 && (
        <Card className="border-surface-700">
          <CardHeader>
            <CardTitle className="text-sm text-surface-400">Recovery Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-surface-500">Sleep</p>
                <p className="font-medium text-surface-200">
                  {sleepQuality}/5 {sleepQuality <= 2 ? '⚠️' : sleepQuality >= 4 ? '✓' : ''}
                </p>
              </div>
              <div>
                <p className="text-surface-500">Stress</p>
                <p className="font-medium text-surface-200">
                  {stressLevel}/5 {stressLevel >= 4 ? '⚠️' : stressLevel <= 2 ? '✓' : ''}
                </p>
              </div>
              <div>
                <p className="text-surface-500">Volume Modifier</p>
                <p className={`font-medium ${recoveryFactors.volumeMultiplier < 0.9 ? 'text-warning-400' : 'text-success-400'}`}>
                  {(recoveryFactors.volumeMultiplier * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-surface-500">Deload Every</p>
                <p className="font-medium text-surface-200">{recoveryFactors.deloadFrequencyWeeks} weeks</p>
              </div>
            </div>
            {recoveryFactors.warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {recoveryFactors.warnings.map((warning, i) => (
                  <p key={i} className="text-xs text-warning-400 flex items-start gap-2">
                    <span>⚠️</span>
                    <span>{warning}</span>
                  </p>
                ))}
              </div>
            )}
            <p className="text-xs text-surface-500 mt-3">
              Update your recovery profile in <a href="/dashboard/settings" className="text-primary-400 hover:underline">Settings</a>
            </p>
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

            <Slider
              label="Time per Session"
              min={30}
              max={120}
              step={15}
              value={sessionDurationMinutes}
              onChange={(e) => setSessionDurationMinutes(parseInt(e.target.value))}
              valueFormatter={(v) => `${v} min`}
              marks={[
                { value: 30, label: '30' },
                { value: 45, label: '45' },
                { value: 60, label: '60' },
                { value: 90, label: '90' },
                { value: 120, label: '120' },
              ]}
            />

            {/* Optimal session recommendation */}
            <div className="p-4 bg-surface-800/50 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-surface-300">Recommended for {daysPerWeek} days/week:</span>
                <span className="text-sm text-primary-400 font-medium">{optimalTime.optimal} min</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-surface-700 rounded-full overflow-hidden">
                  {/* Optimal zone indicator */}
                  <div 
                    className="h-full bg-gradient-to-r from-warning-500 via-success-500 to-warning-500"
                    style={{
                      marginLeft: `${((optimalTime.min - 30) / 90) * 100}%`,
                      width: `${((optimalTime.max - optimalTime.min) / 90) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs text-surface-500">
                <span>30 min</span>
                <span className="text-success-400">Optimal: {optimalTime.min}-{optimalTime.max} min</span>
                <span>120 min</span>
              </div>
              <p className="text-xs text-surface-400">{optimalTime.reason}</p>
              
              {/* Session time warning */}
              {sessionDurationMinutes < optimalTime.min && (
                <div className="flex items-start gap-2 p-2 bg-warning-500/10 rounded text-warning-400 text-xs">
                  <span>⚠️</span>
                  <span>Your session time ({sessionDurationMinutes} min) is below optimal. Consider {optimalTime.optimal} min for best results.</span>
                </div>
              )}
              {sessionDurationMinutes > optimalTime.max && (
                <div className="flex items-start gap-2 p-2 bg-warning-500/10 rounded text-warning-400 text-xs">
                  <span>⚠️</span>
                  <span>Long sessions ({sessionDurationMinutes} min) can impact recovery. Quality &gt; quantity!</span>
                </div>
              )}
            </div>

            {/* Weekly volume assessment */}
            <div className={`p-4 rounded-lg border ${
              volumeAssessment.status === 'optimal' 
                ? 'bg-success-500/10 border-success-500/20' 
                : volumeAssessment.status === 'too_low' || volumeAssessment.status === 'too_high'
                ? 'bg-danger-500/10 border-danger-500/20'
                : 'bg-warning-500/10 border-warning-500/20'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-surface-200">Weekly Training Volume</span>
                <span className={`text-lg font-bold ${volumeAssessment.color}`}>
                  {volumeAssessment.totalHours.toFixed(1)} hrs
                </span>
              </div>
              
              {/* Volume bar */}
              <div className="relative h-3 bg-surface-700 rounded-full overflow-hidden mb-2">
                {/* Optimal zone */}
                <div 
                  className="absolute h-full bg-success-500/30"
                  style={{
                    left: `${(volumeAssessment.optimalMin / 10) * 100}%`,
                    width: `${((volumeAssessment.optimalMax - volumeAssessment.optimalMin) / 10) * 100}%`,
                  }}
                />
                {/* Current position */}
                <div 
                  className={`absolute h-full w-1 ${
                    volumeAssessment.status === 'optimal' ? 'bg-success-400' : 'bg-warning-400'
                  }`}
                  style={{
                    left: `${Math.min((volumeAssessment.totalHours / 10) * 100, 100)}%`,
                  }}
                />
              </div>
              
              <div className="flex justify-between text-xs text-surface-500 mb-2">
                <span>0h</span>
                <span className="text-success-400/70">Optimal: {volumeAssessment.optimalMin}-{volumeAssessment.optimalMax}h</span>
                <span>10h</span>
              </div>
              
              <p className={`text-xs ${volumeAssessment.color}`}>
                {volumeAssessment.status === 'optimal' ? '✓ ' : ''}
                {volumeAssessment.message}
              </p>
            </div>

            {/* Exercise count estimate */}
            <div className="p-3 bg-surface-800/30 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="text-surface-400">
                  Estimated{' '}
                  <span className="text-surface-200 font-medium">{exerciseEstimate.min}-{exerciseEstimate.max} exercises</span>
                  {' '}per session
                </span>
              </div>
            </div>

            {/* AI Recommendation */}
            {fullProgram && (
              <div className="p-4 bg-surface-800/50 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className="font-medium text-surface-200">AI Recommendation</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="info">{fullProgram.split}</Badge>
                  <span className="text-sm text-surface-400">{recommendation?.splitReason}</span>
                </div>
                {fullProgram.programNotes.length > 0 && (
                  <div className="pt-2 border-t border-surface-700 space-y-1">
                    {fullProgram.programNotes.slice(0, 3).map((note, i) => (
                      <p key={i} className="text-xs text-surface-400">{note}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!fullProgram && recommendation && (
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
                <span className="text-surface-400">Session Length</span>
                <span className="text-surface-200 font-medium">{sessionDurationMinutes} min ({exerciseEstimate.min}-{exerciseEstimate.max} exercises)</span>
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
            
            {/* Weekly time commitment with status */}
            <div className={`p-3 rounded-lg border ${
              volumeAssessment.status === 'optimal' 
                ? 'bg-success-500/10 border-success-500/20' 
                : volumeAssessment.status === 'too_low' || volumeAssessment.status === 'too_high'
                ? 'bg-danger-500/10 border-danger-500/20'
                : 'bg-warning-500/10 border-warning-500/20'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-surface-300">Weekly Training Time</span>
                <span className={`text-lg font-bold ${volumeAssessment.color}`}>
                  {volumeAssessment.totalHours.toFixed(1)} hours
                </span>
              </div>
              <p className={`text-xs mt-1 ${volumeAssessment.color}`}>
                {volumeAssessment.status === 'optimal' && '✓ '}
                {volumeAssessment.message}
              </p>
            </div>

            {/* Science Behind Your Program - Collapsible */}
            <details className="group">
              <summary className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg cursor-pointer hover:bg-surface-800/70 transition-colors">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className="font-medium text-surface-200">Science Behind Your Program</span>
                </div>
                <svg className="w-5 h-5 text-surface-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              
              <div className="mt-4 space-y-4">
                {/* Split Selection Logic */}
                <div className="p-4 bg-surface-900/50 rounded-lg border border-surface-700">
                  <h4 className="font-medium text-surface-200 flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center text-xs text-primary-400">1</span>
                    Why {splitType}?
                  </h4>
                  <p className="text-sm text-surface-400 mb-3">
                    {daysPerWeek <= 3 
                      ? `With ${daysPerWeek} training days, each muscle needs to be hit in fewer sessions. ${splitType === 'Full Body' ? 'Full Body allows you to train each muscle 2-3x/week for optimal frequency.' : 'This split maximizes your limited days.'}`
                      : daysPerWeek === 4
                      ? `4 days is ideal for Upper/Lower splits, giving each muscle group 2x/week frequency with adequate recovery between sessions.`
                      : `With ${daysPerWeek} training days, PPL (Push/Pull/Legs) allows higher volume per muscle group while maintaining good frequency.`
                    }
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 bg-surface-800 rounded text-center">
                      <p className="text-surface-500">Frequency</p>
                      <p className="text-surface-200 font-medium">
                        {splitType === 'Full Body' ? '2-3x' : splitType === 'Upper/Lower' ? '2x' : '1-2x'}/week per muscle
                      </p>
                    </div>
                    <div className="p-2 bg-surface-800 rounded text-center">
                      <p className="text-surface-500">Recovery</p>
                      <p className="text-surface-200 font-medium">
                        {splitType === 'Full Body' ? '48h' : splitType === 'Upper/Lower' ? '72h' : '96-168h'} between
                      </p>
                    </div>
                    <div className="p-2 bg-surface-800 rounded text-center">
                      <p className="text-surface-500">Volume/Session</p>
                      <p className="text-surface-200 font-medium">
                        {splitType === 'Full Body' ? 'Moderate' : splitType === 'Upper/Lower' ? 'Moderate' : 'High'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rep Range Science */}
                <div className="p-4 bg-surface-900/50 rounded-lg border border-surface-700">
                  <h4 className="font-medium text-surface-200 flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center text-xs text-primary-400">2</span>
                    Rep Range Science
                  </h4>
                  <p className="text-sm text-surface-400 mb-3">
                    Rep ranges are optimized based on muscle fiber type dominance and exercise position in the workout.
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between p-2 bg-surface-800 rounded">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-danger-400"></span>
                        <span className="text-surface-300">Fast-twitch dominant</span>
                        <span className="text-surface-500">(Hamstrings, Triceps)</span>
                      </div>
                      <span className="font-mono text-surface-200">4-8 reps</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-surface-800 rounded">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-warning-400"></span>
                        <span className="text-surface-300">Mixed fiber type</span>
                        <span className="text-surface-500">(Chest, Back, Quads)</span>
                      </div>
                      <span className="font-mono text-surface-200">6-12 reps</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-surface-800 rounded">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-success-400"></span>
                        <span className="text-surface-300">Slow-twitch dominant</span>
                        <span className="text-surface-500">(Calves, Core, Delts)</span>
                      </div>
                      <span className="font-mono text-surface-200">10-20 reps</span>
                    </div>
                  </div>
                  <p className="text-xs text-surface-500 mt-3">
                    💡 Compounds start sessions (heavier, 6-10 reps). Isolations finish (lighter, 10-15 reps) to maximize performance when fresh.
                  </p>
                </div>

                {/* Volume Logic */}
                <div className="p-4 bg-surface-900/50 rounded-lg border border-surface-700">
                  <h4 className="font-medium text-surface-200 flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center text-xs text-primary-400">3</span>
                    Volume Recommendations
                  </h4>
                  <p className="text-sm text-surface-400 mb-3">
                    Weekly sets per muscle are based on research-backed landmarks adjusted for your experience and recovery capacity.
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div className="p-2 bg-surface-800 rounded text-center">
                      <p className="text-surface-500">MV (Minimum)</p>
                      <p className="text-surface-200 font-medium">~6 sets/week</p>
                      <p className="text-surface-600">Maintain gains</p>
                    </div>
                    <div className="p-2 bg-success-500/10 border border-success-500/20 rounded text-center">
                      <p className="text-success-400">MEV-MAV</p>
                      <p className="text-surface-200 font-medium">10-20 sets/week</p>
                      <p className="text-surface-600">Optimal growth</p>
                    </div>
                    <div className="p-2 bg-surface-800 rounded text-center">
                      <p className="text-surface-500">MRV (Maximum)</p>
                      <p className="text-surface-200 font-medium">20+ sets/week</p>
                      <p className="text-surface-600">Risk of overtraining</p>
                    </div>
                  </div>
                  <p className="text-xs text-surface-500">
                    Your volume is modified by: Recovery capacity ({(recoveryFactors.volumeMultiplier * 100).toFixed(0)}%) • Experience ({userExperience}) • Goal ({userGoal})
                  </p>
                </div>

                {/* Fatigue Management */}
                <div className="p-4 bg-surface-900/50 rounded-lg border border-surface-700">
                  <h4 className="font-medium text-surface-200 flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center text-xs text-primary-400">4</span>
                    Fatigue Management
                  </h4>
                  <p className="text-sm text-surface-400 mb-3">
                    We track both systemic fatigue (CNS, whole-body) and local fatigue (per muscle group) to prevent overtraining.
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="p-2 bg-surface-800 rounded">
                      <div className="flex justify-between mb-1">
                        <span className="text-surface-300">Systemic Fatigue Budget</span>
                        <span className="text-surface-200">100 points/week</span>
                      </div>
                      <p className="text-xs text-surface-500">Compounds: 8-12 pts • Isolations: 3-5 pts • Depleted = auto-deload</p>
                    </div>
                    <div className="p-2 bg-surface-800 rounded">
                      <div className="flex justify-between mb-1">
                        <span className="text-surface-300">Local Muscle Recovery</span>
                        <span className="text-surface-200">48-72 hours</span>
                      </div>
                      <p className="text-xs text-surface-500">We space exercises to allow full recovery before hitting the same muscle again</p>
                    </div>
                  </div>
                </div>

                {/* Periodization */}
                <div className="p-4 bg-surface-900/50 rounded-lg border border-surface-700">
                  <h4 className="font-medium text-surface-200 flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center text-xs text-primary-400">5</span>
                    Periodization Model
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <p className="text-surface-500">Model</p>
                      <p className="text-surface-200 capitalize">{fullProgram?.periodization.model.replace('_', ' ') || 'Linear'}</p>
                    </div>
                    <div>
                      <p className="text-surface-500">Deload Strategy</p>
                      <p className="text-surface-200 capitalize">{fullProgram?.periodization.deloadStrategy || 'Volume'}</p>
                    </div>
                  </div>
                  <div className="p-2 bg-surface-800 rounded text-xs">
                    <p className="text-surface-400">
                      <span className="text-surface-300 font-medium">Week 1-{totalWeeks - 1}:</span> Progressive overload (+sets or +weight each week)
                    </p>
                    <p className="text-surface-400 mt-1">
                      <span className="text-warning-400 font-medium">Week {totalWeeks} (Deload):</span> 50% volume, same intensity to dissipate fatigue
                    </p>
                  </div>
                </div>

                {/* Deload Triggers */}
                <div className="p-4 bg-surface-900/50 rounded-lg border border-surface-700">
                  <h4 className="font-medium text-surface-200 flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center text-xs text-primary-400">6</span>
                    Auto-Deload Triggers
                  </h4>
                  <p className="text-sm text-surface-400 mb-3">
                    Besides scheduled deloads, we&apos;ll suggest an early deload if any of these occur:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-surface-800 rounded flex items-center gap-2">
                      <span className="text-danger-400">📉</span>
                      <span className="text-surface-300">Performance drops 2+ sessions</span>
                    </div>
                    <div className="p-2 bg-surface-800 rounded flex items-center gap-2">
                      <span className="text-danger-400">😴</span>
                      <span className="text-surface-300">Sleep quality below 2/5</span>
                    </div>
                    <div className="p-2 bg-surface-800 rounded flex items-center gap-2">
                      <span className="text-danger-400">🔴</span>
                      <span className="text-surface-300">RPE consistently 9.5+</span>
                    </div>
                    <div className="p-2 bg-surface-800 rounded flex items-center gap-2">
                      <span className="text-danger-400">💔</span>
                      <span className="text-surface-300">Joint pain reported</span>
                    </div>
                  </div>
                </div>
              </div>
            </details>

            {/* Warnings */}
            {fullProgram && fullProgram.warnings.length > 0 && (
              <div className="p-4 bg-warning-500/10 border border-warning-500/20 rounded-lg space-y-2">
                <p className="text-sm font-medium text-warning-400">⚠️ Things to Consider</p>
                {fullProgram.warnings.map((warning, i) => (
                  <p key={i} className="text-xs text-warning-300">{warning}</p>
                ))}
              </div>
            )}

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
