'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge, ExplainedTerm } from '@/components/ui';
import { InlineHint } from '@/components/ui/FirstTimeHint';
import { createUntypedClient } from '@/lib/supabase/client';
import { usePWA } from '@/hooks/usePWA';
import { 
  CoachingSessionManager,
  type StrengthProfile,
  type BodyComposition,
  type CalibrationResult,
  formatStrengthLevel,
  getStrengthLevelBadgeVariant,
  getStrengthLevelColor,
  generatePercentileSegments,
  analyzeStrengthBalance
} from '@/services/coachingEngine';
import { kgToLbs, roundToIncrement } from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';

function PercentileBar({ percentile, label, showValue = true }: { percentile: number; label: string; showValue?: boolean }) {
  const segments = generatePercentileSegments(percentile);
  
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-surface-400">
        <span>{label}</span>
        {showValue && <span className="font-medium">{percentile}th</span>}
      </div>
      <div className="flex gap-0.5">
        {segments.map((seg, i) => (
          <div 
            key={i}
            className="h-2 flex-1 rounded-sm transition-colors"
            style={{ backgroundColor: seg.color }}
          />
        ))}
      </div>
    </div>
  );
}

function CompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const { shouldShowInOnboarding } = usePWA();

  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<StrengthProfile | null>(null);
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [units, setUnits] = useState<WeightUnit>('lb');
  
  // Helper functions for unit conversion
  const displayWeight = (kg: number) => {
    const value = units === 'lb' ? kgToLbs(kg) : kg;
    return roundToIncrement(value, units === 'lb' ? 2.5 : 2.5);
  };
  
  const weightUnit = units === 'lb' ? 'lbs' : 'kg';
  
  useEffect(() => {
    async function fetchProfile() {
      if (!sessionId) {
        router.push('/onboarding');
        return;
      }
      
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      
      // Get session data
      const { data: sessionData } = await supabase
        .from('coaching_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (!sessionData) {
        router.push('/onboarding');
        return;
      }
      
      // Get user sex
      const { data: userData } = await supabase
        .from('users')
        .select('sex')
        .eq('id', user.id)
        .single();
      
      const userSex = (userData?.sex as 'male' | 'female') || 'male';
      setSex(userSex);
      
      // Get user preferences for units
      const { data: prefsData } = await supabase
        .from('user_preferences')
        .select('units')
        .eq('user_id', user.id)
        .single();
      
      if (prefsData?.units) {
        setUnits(prefsData.units as WeightUnit);
      }
      
      // Get calibrated lifts
      const { data: liftsData } = await supabase
        .from('calibrated_lifts')
        .select('*')
        .eq('coaching_session_id', sessionId);
      
      if (!liftsData || liftsData.length === 0) {
        router.push(`/onboarding/calibrate?session=${sessionId}`);
        return;
      }
      
      // Build profile
      const bodyComp = sessionData.body_composition as BodyComposition;
      const calibratedLifts: CalibrationResult[] = liftsData.map((lift: {
        lift_name: string;
        benchmark_id: string;
        tested_weight_kg: number;
        tested_reps: number;
        tested_rpe: number | null;
        estimated_1rm: number;
        percentile_vs_general: number;
        percentile_vs_trained: number;
        percentile_vs_body_comp: number;
        strength_level: string;
      }) => ({
        lift: lift.lift_name,
        benchmarkId: lift.benchmark_id,
        testedWeight: lift.tested_weight_kg,
        testedReps: lift.tested_reps,
        testedRPE: lift.tested_rpe,
        estimated1RM: lift.estimated_1rm,
        percentileScore: {
          vsGeneralPopulation: lift.percentile_vs_general,
          vsTrainedPopulation: lift.percentile_vs_trained,
          vsBodyComposition: lift.percentile_vs_body_comp
        },
        strengthLevel: lift.strength_level
      }));
      
      // Calculate overall profile
      const manager = new CoachingSessionManager();
      manager.loadSession({
        bodyComposition: bodyComp,
        completedBenchmarks: calibratedLifts
      });
      
      const generatedProfile = manager.generateStrengthProfile(userSex);
      
      if (generatedProfile) {
        setProfile(generatedProfile);
        
        // Save profile to session
        await supabase
          .from('coaching_sessions')
          .update({ strength_profile: generatedProfile })
          .eq('id', sessionId);
      }
      
      setIsLoading(false);
    }
    
    fetchProfile();
  }, [sessionId, router]);
  
  const handleFinish = async () => {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // Mark onboarding as complete
      await supabase
        .from('users')
        .update({ onboarding_completed: true })
        .eq('id', user.id);
    }

    // Check if we should show the install prompt
    if (shouldShowInOnboarding()) {
      router.push(`/onboarding/install?session=${sessionId}`);
    } else {
      router.push('/dashboard');
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  
  if (!profile) return null;
  
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator - complete */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="flex items-center">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-primary-500 text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            {step < 4 && (
              <div className="w-12 h-0.5 bg-primary-500" />
            )}
          </div>
        ))}
      </div>
      
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Your Strength Profile</h1>
        <p className="text-surface-400">
          Based on your calibration tests, here&apos;s your personalized profile. This data powers smart recommendations across the app.
        </p>
      </div>

      {/* Profile interpretation hint */}
      <InlineHint id="profile-interpretation-hint">
        <strong>What these numbers mean:</strong> Your overall score combines strength, balance between muscle groups, and body composition. We use this to recommend weights, detect imbalances, and track your progress over time.
      </InlineHint>
      
      {/* Overall score card */}
      <Card className="bg-gradient-to-br from-primary-500/10 to-accent-500/10 border-primary-500/30">
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            {/* Score circle */}
            <div className="relative">
              <svg className="w-40 h-40" viewBox="0 0 100 100">
                {/* Background circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-surface-800"
                />
                {/* Progress circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="url(#gradient)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${profile.overallScore * 2.83} 283`}
                  transform="rotate(-90 50 50)"
                />
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#d946ef" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold text-white">{profile.overallScore}</span>
                <span className="text-sm text-surface-400">/ 100</span>
              </div>
            </div>
            
            {/* Stats */}
            <div className="flex-1 space-y-4">
              <div>
                <p className="text-sm text-surface-400">Strength Level</p>
                <p className={`text-3xl font-bold capitalize ${getStrengthLevelColor(profile.strengthLevel)}`}>
                  {formatStrengthLevel(profile.strengthLevel)}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-surface-900/50 rounded-lg">
                  <p className="text-xs text-surface-500">Balance Score</p>
                  <p className="text-2xl font-bold text-white">{profile.balanceScore}%</p>
                </div>
                <div className="p-3 bg-surface-900/50 rounded-lg">
                  <p className="text-xs text-surface-500">
                    <ExplainedTerm term="FFMI" />
                  </p>
                  <p className="text-2xl font-bold text-white">{profile.bodyComposition.ffmi.toFixed(1)}</p>
                </div>
              </div>

              {/* Score interpretation */}
              <div className="mt-4 p-3 bg-surface-900/30 rounded-lg border border-surface-700">
                <p className="text-sm text-surface-300">
                  {profile.overallScore >= 80
                    ? "Excellent! You have a well-developed strength foundation with good balance."
                    : profile.overallScore >= 60
                      ? "Good progress! You have solid strength with some areas to develop."
                      : profile.overallScore >= 40
                        ? "Solid starting point! Your profile shows clear opportunities for growth."
                        : "Great baseline! Everyone starts somewhere, and we'll help you progress systematically."}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Individual lift results */}
      <Card>
        <CardHeader>
          <CardTitle>Calibrated Lifts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {profile.calibratedLifts.map((lift) => (
              <div key={lift.benchmarkId} className="p-4 bg-surface-800/50 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-medium text-surface-200">{lift.lift}</h4>
                    <p className="text-sm text-surface-500">
                      {lift.benchmarkId === 'pullup' 
                        ? `${lift.testedReps} reps`
                        : `${displayWeight(lift.testedWeight)} ${weightUnit} × ${lift.testedReps} = ${displayWeight(lift.estimated1RM)} ${weightUnit} E1RM`}
                    </p>
                  </div>
                  <Badge variant={getStrengthLevelBadgeVariant(lift.strengthLevel)}>
                    {formatStrengthLevel(lift.strengthLevel)}
                  </Badge>
                </div>
                
                <div className="space-y-2">
                  <PercentileBar 
                    percentile={lift.percentileScore.vsTrainedPopulation}
                    label="vs Trained Lifters"
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Imbalances */}
      {profile.imbalances.length > 0 && (
        <Card className="border-warning-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>⚠️</span>
              Imbalances Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {profile.imbalances.map((imbalance, i) => (
                <div 
                  key={i}
                  className={`p-4 rounded-lg ${
                    imbalance.severity === 'significant' 
                      ? 'bg-danger-500/10 border border-danger-500/30'
                      : imbalance.severity === 'moderate'
                      ? 'bg-warning-500/10 border border-warning-500/30'
                      : 'bg-surface-800/50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-surface-200">{imbalance.description}</p>
                      <p className="text-sm text-surface-400 mt-1">{imbalance.recommendation}</p>
                    </div>
                    <Badge variant={
                      imbalance.severity === 'significant' ? 'danger' :
                      imbalance.severity === 'moderate' ? 'warning' : 'default'
                    }>
                      {imbalance.severity}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Personalized Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {profile.recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-surface-800/50 rounded-lg">
                <div className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-400 text-sm font-medium">{i + 1}</span>
                </div>
                <p className="text-surface-300">{rec}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* What's next */}
      <Card className="bg-surface-800/50">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-white mb-2">You&apos;re All Set! 🎉</h3>
          <p className="text-surface-400 mb-4">
            Your calibration data is now powering personalized recommendations across the entire app. 
            Here&apos;s what you can do now:
          </p>
          
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <div className="p-3 bg-surface-900/50 rounded-lg border border-surface-700">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🏋️</span>
                <span className="font-medium text-surface-200">Create Mesocycle</span>
              </div>
              <p className="text-xs text-surface-500">AI-generated training blocks with S-tier exercises</p>
            </div>
            
            <div className="p-3 bg-surface-900/50 rounded-lg border border-surface-700">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🍎</span>
                <span className="font-medium text-surface-200">Track Nutrition</span>
              </div>
              <p className="text-xs text-surface-500">Log meals, set macro targets, scan barcodes</p>
            </div>
            
            <div className="p-3 bg-surface-900/50 rounded-lg border border-surface-700">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🤖</span>
                <span className="font-medium text-surface-200">AI Coaching</span>
              </div>
              <p className="text-xs text-surface-500">Get personalized advice before every workout</p>
            </div>
            
            <div className="p-3 bg-surface-900/50 rounded-lg border border-surface-700">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">📊</span>
                <span className="font-medium text-surface-200">Track Progress</span>
              </div>
              <p className="text-xs text-surface-500">Body comp, strength gains, volume trends</p>
            </div>
          </div>
          
          <ul className="space-y-2 text-sm text-surface-400">
            <li className="flex items-center gap-2">
              <svg className="w-5 h-5 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Personalized weight recommendations for all exercises
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-5 h-5 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Smart macro targets based on your body composition
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-5 h-5 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Fatigue management and auto-deload detection
            </li>
          </ul>
        </CardContent>
      </Card>
      
      {/* Finish button */}
      <div className="flex justify-center pt-4">
        <Button 
          size="lg" 
          onClick={handleFinish}
        >
          Go to Dashboard
          <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

export default function CompletePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <CompleteContent />
    </Suspense>
  );
}

