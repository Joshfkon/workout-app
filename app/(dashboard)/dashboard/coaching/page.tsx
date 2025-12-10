'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradePrompt } from '@/components/subscription';
import { 
  type StrengthProfile,
  type CalibrationResult,
  type BodyComposition,
  CoachingSessionManager,
  formatStrengthLevel,
  getStrengthLevelBadgeVariant,
  getStrengthLevelColor,
  generatePercentileSegments
} from '@/services/coachingEngine';

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

interface CoachingSessionSummary {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  lift_count: number;
}

export default function CoachingPage() {
  const router = useRouter();
  const { canAccess, isLoading: subLoading } = useSubscription();
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<StrengthProfile | null>(null);
  const [sessions, setSessions] = useState<CoachingSessionSummary[]>([]);
  const [sex, setSex] = useState<'male' | 'female'>('male');
  
  useEffect(() => {
    async function fetchData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push('/login');
        return;
      }
      
      // Get user sex
      const { data: userData } = await supabase
        .from('users')
        .select('sex')
        .eq('id', user.id)
        .single();
      
      setSex((userData?.sex as 'male' | 'female') || 'male');
      
      // Get all coaching sessions
      const { data: sessionsData } = await supabase
        .from('coaching_sessions')
        .select('id, status, created_at, completed_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      // Get most recent completed session with lifts
      const completedSessions = sessionsData?.filter((s: { status: string }) => s.status === 'completed') || [];
      
      if (completedSessions.length > 0) {
        const latestSession = completedSessions[0];
        
        // Get the strength profile from session
        const { data: sessionWithProfile } = await supabase
          .from('coaching_sessions')
          .select('*, calibrated_lifts:calibrated_lifts(*)')
          .eq('id', latestSession.id)
          .single();
        
        if (sessionWithProfile?.strength_profile) {
          setProfile(sessionWithProfile.strength_profile as StrengthProfile);
        } else if (sessionWithProfile?.calibrated_lifts?.length > 0) {
          // Rebuild profile from lifts if needed
          const bodyComp = sessionWithProfile.body_composition as BodyComposition;
          const calibratedLifts: CalibrationResult[] = sessionWithProfile.calibrated_lifts.map((lift: {
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
          
          const manager = new CoachingSessionManager();
          manager.loadSession({
            bodyComposition: bodyComp,
            completedBenchmarks: calibratedLifts
          });
          
          const generatedProfile = manager.generateStrengthProfile(sex);
          if (generatedProfile) {
            setProfile(generatedProfile);
          }
        }
      }
      
      // Get lift counts for sessions
      if (sessionsData) {
        const sessionsWithCounts = await Promise.all(
          sessionsData.map(async (s: { id: string; status: string; created_at: string; completed_at: string | null }) => {
            const { count } = await supabase
              .from('calibrated_lifts')
              .select('*', { count: 'exact', head: true })
              .eq('coaching_session_id', s.id);
            
            return {
              ...s,
              lift_count: count || 0
            };
          })
        );
        setSessions(sessionsWithCounts);
      }
      
      setIsLoading(false);
    }
    
    fetchData();
  }, [router, sex]);
  
  const handleStartCalibration = () => {
    router.push('/onboarding');
  };
  
  // Check subscription access - coaching requires Elite tier (must be after hooks)
  if (!subLoading && !canAccess('coachingCalibration')) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Coaching & Calibration</h1>
          <p className="text-surface-400 mt-1">Get personalized strength assessments and identify imbalances</p>
        </div>
        <UpgradePrompt feature="coachingCalibration" requiredTier="elite" />
      </div>
    );
  }
  
  if (isLoading || subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Strength Coaching</h1>
          <p className="text-surface-400">Track your strength calibration and percentile rankings</p>
        </div>
        <Button onClick={handleStartCalibration}>
          {profile ? 'Re-Calibrate' : 'Start Calibration'}
        </Button>
      </div>
      
      {profile ? (
        <>
          {/* Overall score card */}
          <Card className="bg-gradient-to-br from-primary-500/10 to-accent-500/10 border-primary-500/30">
            <CardContent className="p-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                {/* Score circle */}
                <div className="relative">
                  <svg className="w-40 h-40" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      className="text-surface-800"
                    />
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
                    <p className="text-sm text-surface-400">Overall Strength Level</p>
                    <p className={`text-3xl font-bold capitalize ${getStrengthLevelColor(profile.strengthLevel)}`}>
                      {formatStrengthLevel(profile.strengthLevel)}
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 bg-surface-900/50 rounded-lg">
                      <p className="text-xs text-surface-500">Balance</p>
                      <p className="text-2xl font-bold text-white">{profile.balanceScore}%</p>
                    </div>
                    <div className="p-3 bg-surface-900/50 rounded-lg">
                      <p className="text-xs text-surface-500">FFMI</p>
                      <p className="text-2xl font-bold text-white">{profile.bodyComposition.ffmi.toFixed(1)}</p>
                    </div>
                    <div className="p-3 bg-surface-900/50 rounded-lg">
                      <p className="text-xs text-surface-500">Lean Mass</p>
                      <p className="text-2xl font-bold text-white">{profile.bodyComposition.leanMassKg.toFixed(1)}kg</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Calibrated lifts */}
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
                              : `E1RM: ${lift.estimated1RM.toFixed(1)}kg`}
                          </p>
                        </div>
                        <Badge variant={getStrengthLevelBadgeVariant(lift.strengthLevel)}>
                          {formatStrengthLevel(lift.strengthLevel)}
                        </Badge>
                      </div>
                      <PercentileBar 
                        percentile={lift.percentileScore.vsTrainedPopulation}
                        label="vs Trained Lifters"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            
            {/* Right column */}
            <div className="space-y-6">
              {/* Imbalances */}
              {profile.imbalances.length > 0 && (
                <Card className="border-warning-500/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span>⚠️</span>
                      Detected Imbalances
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
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-surface-200 text-sm">{imbalance.description}</p>
                              <p className="text-xs text-surface-400 mt-1">{imbalance.recommendation}</p>
                            </div>
                            <Badge size="sm" variant={
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
                  <CardTitle>Recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {profile.recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-surface-800/50 rounded-lg">
                        <div className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-400 text-xs font-medium">{i + 1}</span>
                        </div>
                        <p className="text-sm text-surface-300">{rec}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          
          {/* Calibration history */}
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Calibration History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div 
                      key={session.id}
                      className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-surface-200">
                          {new Date(session.created_at).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                        <p className="text-sm text-surface-500">
                          {session.lift_count} lifts tested
                        </p>
                      </div>
                      <Badge variant={session.status === 'completed' ? 'success' : 'warning'}>
                        {session.status === 'completed' ? 'Complete' : 'In Progress'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        // No profile yet - show onboarding prompt
        <Card className="bg-surface-800/50">
          <CardContent className="p-12 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Calibrate Your Strength</h2>
            <p className="text-surface-400 mb-6 max-w-md mx-auto">
              Test your key lifts to get personalized weight recommendations, percentile rankings, 
              and identify any strength imbalances. Takes about 15-30 minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={handleStartCalibration}>
                Start Strength Calibration
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Button>
            </div>
            
            <div className="mt-8 grid sm:grid-cols-3 gap-4 text-left">
              <div className="p-4 bg-surface-900/50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 flex items-center justify-center mb-2">
                  <span className="text-lg">📊</span>
                </div>
                <h3 className="font-medium text-surface-200 mb-1">Percentile Rankings</h3>
                <p className="text-sm text-surface-500">See how you compare to general population and trained lifters</p>
              </div>
              <div className="p-4 bg-surface-900/50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 flex items-center justify-center mb-2">
                  <span className="text-lg">⚖️</span>
                </div>
                <h3 className="font-medium text-surface-200 mb-1">Balance Analysis</h3>
                <p className="text-sm text-surface-500">Identify push/pull, upper/lower, and anterior/posterior imbalances</p>
              </div>
              <div className="p-4 bg-surface-900/50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 flex items-center justify-center mb-2">
                  <span className="text-lg">🎯</span>
                </div>
                <h3 className="font-medium text-surface-200 mb-1">Smart Recommendations</h3>
                <p className="text-sm text-surface-500">Get accurate weight suggestions for all exercises</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

