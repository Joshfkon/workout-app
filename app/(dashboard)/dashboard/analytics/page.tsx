'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { FFMIGauge } from '@/components/analytics/FFMIGauge';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import type { DexaScan, Goal, Experience, FFMIResult, ProgressPhoto, MuscleGroup } from '@/types/schema';
import {
  calculateFFMI,
  analyzeBodyCompTrend,
  generateCoachingRecommendations,
  getFFMILabel,
  getTrendIndicator,
} from '@/services/bodyCompEngine';
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
import { kgToLbs, roundToIncrement, formatWeight, formatDuration } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
  Legend,
} from 'recharts';

// Tab types
type TabType = 'body-composition' | 'strength' | 'volume';

interface UserProfile {
  heightCm: number | null;
  goal: Goal;
  experience: Experience;
  targetBodyFatPercent: number | null;
}

interface WorkoutSummary {
  id: string;
  date: string;
  duration: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  sessionRpe: number | null;
}

interface MuscleVolumeData {
  muscle: string;
  sets: number;
  workouts: number;
}

interface ExercisePerformance {
  exerciseId: string;
  exerciseName: string;
  bestWeight: number;
  bestReps: number;
  estimatedE1RM: number;
  totalSets: number;
}

interface AnalyticsData {
  totalWorkouts: number;
  totalSets: number;
  totalVolume: number;
  avgWorkoutDuration: number;
  avgSessionRpe: number;
  recentWorkouts: WorkoutSummary[];
  weeklyMuscleVolume: MuscleVolumeData[];
  topExercises: ExercisePerformance[];
  currentStreak: number;
}

// Helper function for percentile bars
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

// Calculate estimated 1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + reps / 30);
  return weight * (36 / (37 - reps));
}

export default function AnalyticsPage() {
  const router = useRouter();
  const { preferences } = useUserPreferences();
  const [activeTab, setActiveTab] = useState<TabType>('body-composition');
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('30d');

  // Body composition state
  const [scans, setScans] = useState<DexaScan[]>([]);
  const [progressPhotos, setProgressPhotos] = useState<ProgressPhoto[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  // Strength state
  const [strengthProfile, setStrengthProfile] = useState<StrengthProfile | null>(null);
  const [sex, setSex] = useState<'male' | 'female'>('male');

  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);

  // Unit display helpers
  const units = preferences?.units || 'lb';
  const displayWeight = (kg: number) => {
    const value = units === 'lb' ? kgToLbs(kg) : kg;
    return roundToIncrement(value, 2.5);
  };
  const weightUnit = units === 'lb' ? 'lbs' : 'kg';

  // Load photo URLs
  useEffect(() => {
    async function loadPhotoUrls() {
      if (progressPhotos.length === 0) return;
      
      const supabase = createUntypedClient();
      const urls: Record<string, string> = {};
      
      for (const photo of progressPhotos) {
        if (!photo.photoUrl) continue;
        
        const { data } = await supabase.storage
          .from('progress-photos')
          .createSignedUrl(photo.photoUrl, 3600);
        
        if (data?.signedUrl) {
          urls[photo.id] = data.signedUrl;
        }
      }
      
      setPhotoUrls(urls);
    }
    
    loadPhotoUrls();
  }, [progressPhotos]);

  // Fetch all data
  useEffect(() => {
    async function fetchData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      try {
        // Fetch user profile
        const { data: profile } = await supabase
          .from('users')
          .select('height_cm, goal, experience, target_body_fat_percent, sex')
          .eq('id', user.id)
          .single();

        if (profile) {
          setUserProfile({
            heightCm: profile.height_cm,
            goal: profile.goal || 'maintenance',
            experience: profile.experience || 'intermediate',
            targetBodyFatPercent: profile.target_body_fat_percent,
          });
          setSex(profile.sex || 'male');
        }

        // Fetch DEXA scans
        const { data: scanData } = await supabase
          .from('dexa_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scan_date', { ascending: false });

        if (scanData) {
          const transformedScans: DexaScan[] = scanData.map((scan: any) => ({
            id: scan.id,
            userId: scan.user_id,
            scanDate: scan.scan_date,
            weightKg: scan.weight_kg,
            leanMassKg: scan.lean_mass_kg,
            fatMassKg: scan.fat_mass_kg,
            bodyFatPercent: scan.body_fat_percent,
            boneMassKg: scan.bone_mass_kg,
            regionalData: scan.regional_data,
            notes: scan.notes,
            createdAt: scan.created_at,
          }));
          setScans(transformedScans);
        }

        // Fetch progress photos
        const { data: photoData } = await supabase
          .from('progress_photos')
          .select('*')
          .eq('user_id', user.id)
          .order('photo_date', { ascending: false })
          .limit(8);

        if (photoData) {
          const transformedPhotos: ProgressPhoto[] = photoData.map((photo: any) => ({
            id: photo.id,
            userId: photo.user_id,
            photoDate: photo.photo_date,
            photoUrl: photo.photo_url,
            weightKg: photo.weight_kg,
            bodyFatPercent: photo.body_fat_percent,
            notes: photo.notes,
            createdAt: photo.created_at,
          }));
          setProgressPhotos(transformedPhotos);
        }

        // Fetch strength profile from coaching sessions
        const { data: sessionsData } = await supabase
          .from('coaching_sessions')
          .select('*, calibrated_lifts:calibrated_lifts(*)')
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1);

        if (sessionsData && sessionsData.length > 0) {
          const session = sessionsData[0];
          if (session.strength_profile) {
            setStrengthProfile(session.strength_profile as StrengthProfile);
          } else if (session.calibrated_lifts?.length > 0) {
            const bodyComp = session.body_composition as BodyComposition;
            const calibratedLifts: CalibrationResult[] = session.calibrated_lifts.map((lift: any) => ({
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

            const generatedProfile = manager.generateStrengthProfile(profile?.sex || 'male');
            if (generatedProfile) {
              setStrengthProfile(generatedProfile);
            }
          }
        }

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch analytics data:', error);
        setIsLoading(false);
      }
    }

    fetchData();
  }, [router]);

  // Fetch workout analytics data
  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const now = new Date();
        let startDate: Date | null = null;
        if (timeRange === '7d') {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (timeRange === '30d') {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        let query = supabase
          .from('workout_sessions')
          .select(`
            id,
            started_at,
            completed_at,
            session_rpe,
            exercise_blocks!inner (
              id,
              exercises!inner (
                id,
                name,
                primary_muscle
              ),
              set_logs!inner (
                id,
                weight_kg,
                reps,
                is_warmup,
                logged_at
              )
            )
          `)
          .eq('user_id', user.id)
          .eq('state', 'completed')
          .order('completed_at', { ascending: false });

        if (startDate) {
          query = query.gte('completed_at', startDate.toISOString());
        }

        const { data: workoutSessions, error } = await query;

        if (error || !workoutSessions || workoutSessions.length === 0) {
          setAnalytics(null);
          return;
        }

        let totalSets = 0;
        let totalVolume = 0;
        let totalRpeSum = 0;
        let rpeCount = 0;
        const durations: number[] = [];
        const muscleVolumeMap = new Map<string, { sets: number; workouts: Set<string> }>();
        const exercisePerformanceMap = new Map<string, ExercisePerformance>();

        workoutSessions.forEach((session: any) => {
          if (session.started_at && session.completed_at) {
            const duration = Math.floor(
              (new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000
            );
            durations.push(duration);
          }

          if (session.session_rpe) {
            totalRpeSum += session.session_rpe;
            rpeCount++;
          }

          if (session.exercise_blocks) {
            session.exercise_blocks.forEach((block: any) => {
              if (!block.exercises || !block.set_logs) return;

              const muscle = block.exercises.primary_muscle;
              const exerciseId = block.exercises.id;
              const exerciseName = block.exercises.name;

              const workingSets = block.set_logs.filter((s: any) => !s.is_warmup);

              if (!muscleVolumeMap.has(muscle)) {
                muscleVolumeMap.set(muscle, { sets: 0, workouts: new Set() });
              }
              const muscleData = muscleVolumeMap.get(muscle)!;
              muscleData.sets += workingSets.length;
              muscleData.workouts.add(session.id);

              workingSets.forEach((set: any) => {
                totalSets++;
                totalVolume += set.weight_kg * set.reps;

                const e1rm = calculateE1RM(set.weight_kg, set.reps);

                if (!exercisePerformanceMap.has(exerciseId)) {
                  exercisePerformanceMap.set(exerciseId, {
                    exerciseId,
                    exerciseName,
                    bestWeight: set.weight_kg,
                    bestReps: set.reps,
                    estimatedE1RM: e1rm,
                    totalSets: 0,
                  });
                }

                const exData = exercisePerformanceMap.get(exerciseId)!;
                exData.totalSets++;
                if (e1rm > exData.estimatedE1RM) {
                  exData.estimatedE1RM = e1rm;
                  exData.bestWeight = set.weight_kg;
                  exData.bestReps = set.reps;
                }
              });
            });
          }
        });

        const totalWorkouts = workoutSessions.length;
        const avgWorkoutDuration = durations.length > 0
          ? Math.floor(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0;
        const avgSessionRpe = rpeCount > 0
          ? Math.round((totalRpeSum / rpeCount) * 10) / 10
          : 0;

        const recentWorkouts: WorkoutSummary[] = workoutSessions.slice(0, 5).map((session: any) => {
          let sessionSets = 0;
          let sessionReps = 0;
          let sessionVolume = 0;

          if (session.exercise_blocks) {
            session.exercise_blocks.forEach((block: any) => {
              if (block.set_logs) {
                block.set_logs.forEach((set: any) => {
                  if (!set.is_warmup) {
                    sessionSets++;
                    sessionReps += set.reps;
                    sessionVolume += set.weight_kg * set.reps;
                  }
                });
              }
            });
          }

          const duration = session.started_at && session.completed_at
            ? Math.floor((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000)
            : 0;

          return {
            id: session.id,
            date: session.completed_at,
            duration,
            totalSets: sessionSets,
            totalReps: sessionReps,
            totalVolume: sessionVolume,
            sessionRpe: session.session_rpe,
          };
        });

        const weeklyMuscleVolume: MuscleVolumeData[] = Array.from(muscleVolumeMap.entries())
          .map(([muscle, data]) => ({
            muscle,
            sets: data.sets,
            workouts: data.workouts.size,
          }))
          .sort((a, b) => b.sets - a.sets);

        const topExercises = Array.from(exercisePerformanceMap.values())
          .sort((a, b) => b.estimatedE1RM - a.estimatedE1RM)
          .slice(0, 8);

        // Calculate streak
        let currentStreak = 0;
        if (workoutSessions.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const lastWorkoutDate = new Date(workoutSessions[0].completed_at);
          lastWorkoutDate.setHours(0, 0, 0, 0);

          const daysSinceLastWorkout = Math.floor((today.getTime() - lastWorkoutDate.getTime()) / (24 * 60 * 60 * 1000));

          if (daysSinceLastWorkout <= 2) {
            currentStreak = 1;

            for (let i = 1; i < workoutSessions.length; i++) {
              const prevDate = new Date(workoutSessions[i - 1].completed_at);
              const currDate = new Date(workoutSessions[i].completed_at);
              prevDate.setHours(0, 0, 0, 0);
              currDate.setHours(0, 0, 0, 0);

              const gap = Math.floor((prevDate.getTime() - currDate.getTime()) / (24 * 60 * 60 * 1000));

              if (gap <= 3) {
                currentStreak++;
              } else {
                break;
              }
            }
          }
        }

        setAnalytics({
          totalWorkouts,
          totalSets,
          totalVolume,
          avgWorkoutDuration,
          avgSessionRpe,
          recentWorkouts,
          weeklyMuscleVolume,
          topExercises,
          currentStreak,
        });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      }
    }

    fetchAnalytics();
  }, [timeRange]);

  // Calculated values
  const latestScan = scans[0];
  const ffmiResult = latestScan && userProfile?.heightCm
    ? calculateFFMI(latestScan.leanMassKg, userProfile.heightCm)
    : null;
  const trend = userProfile?.heightCm
    ? analyzeBodyCompTrend(scans, userProfile.heightCm)
    : null;
  const recommendations = userProfile?.heightCm
    ? generateCoachingRecommendations(scans, userProfile.heightCm, userProfile.goal, userProfile.experience)
    : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const tabs = [
    { id: 'body-composition' as TabType, label: 'Body Composition', icon: '📊' },
    { id: 'strength' as TabType, label: 'Strength', icon: '💪' },
    { id: 'volume' as TabType, label: 'Volume & Trends', icon: '📈' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-surface-400">Track your body composition, strength, and training progress</p>
        </div>
        <div className="flex gap-2">
          {/* Time range selector */}
          <div className="flex gap-1 bg-surface-800 p-1 rounded-lg">
            {(['7d', '30d', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  timeRange === range
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {range === '7d' ? '7d' : range === '30d' ? '30d' : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-surface-800/50 p-1 rounded-xl">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-surface-700 text-white shadow-sm'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
            }`}
          >
            <span>{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'body-composition' && (
        <div className="space-y-6">
          {/* Quick Stats */}
          {latestScan && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {ffmiResult && (
                <Card className="col-span-1">
                  <CardContent className="pt-4 flex justify-center">
                    <FFMIGauge ffmiResult={ffmiResult} size="sm" />
                  </CardContent>
                </Card>
              )}

              <Card className="p-4">
                <p className="text-xs text-surface-500 uppercase tracking-wider">Body Fat</p>
                <p className="text-2xl font-bold text-surface-100 mt-1">{latestScan.bodyFatPercent}%</p>
                {trend && (
                  <p className={`text-xs mt-1 ${getTrendIndicator(trend.bodyFatChangeRate).color}`}>
                    {getTrendIndicator(trend.bodyFatChangeRate).icon} {Math.abs(trend.bodyFatChangeRate).toFixed(1)}%/mo
                  </p>
                )}
              </Card>

              <Card className="p-4">
                <p className="text-xs text-surface-500 uppercase tracking-wider">Lean Mass</p>
                <p className="text-2xl font-bold text-surface-100 mt-1">
                  {formatWeight(latestScan.leanMassKg, units)}
                </p>
                {trend && (
                  <p className={`text-xs mt-1 ${getTrendIndicator(trend.leanMassChangeRate).color}`}>
                    {getTrendIndicator(trend.leanMassChangeRate).icon} {Math.abs(trend.leanMassChangeRate).toFixed(2)} {weightUnit}/mo
                  </p>
                )}
              </Card>

              <Card className="p-4">
                <p className="text-xs text-surface-500 uppercase tracking-wider">Fat Mass</p>
                <p className="text-2xl font-bold text-surface-100 mt-1">
                  {formatWeight(latestScan.fatMassKg, units)}
                </p>
                {trend && (
                  <p className={`text-xs mt-1 ${getTrendIndicator(-trend.fatMassChangeRate).color}`}>
                    {getTrendIndicator(-trend.fatMassChangeRate).icon} {Math.abs(trend.fatMassChangeRate).toFixed(2)} {weightUnit}/mo
                  </p>
                )}
              </Card>
            </div>
          )}

          {/* Progress Photos */}
          {progressPhotos.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent Progress Photos</CardTitle>
                  <Link href="/dashboard/body-composition">
                    <Button variant="ghost" size="sm">View All →</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  {progressPhotos.slice(0, 4).map((photo) => {
                    const photoUrl = photoUrls[photo.id];
                    return (
                      <div key={photo.id} className="aspect-square rounded-lg overflow-hidden bg-surface-800">
                        {photoUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={photoUrl}
                            alt={`Progress ${new Date(photo.photoDate).toLocaleDateString()}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Body Comp Trends Chart */}
          {scans.length >= 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Body Composition Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={[...scans].reverse().map(scan => ({
                      date: new Date(scan.scanDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                      leanMass: scan.leanMassKg,
                      fatMass: scan.fatMassKg,
                    }))}>
                      <defs>
                        <linearGradient id="leanGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1f2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px',
                          color: '#f3f4f6'
                        }}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="leanMass" name="Lean Mass" stroke="#22c55e" fill="url(#leanGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="fatMass" name="Fat Mass" stroke="#f59e0b" fill="url(#fatGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.slice(0, 3).map((rec, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-lg border ${
                        rec.type === 'warning'
                          ? 'bg-warning-500/10 border-warning-500/20'
                          : rec.type === 'achievement'
                          ? 'bg-success-500/10 border-success-500/20'
                          : 'bg-primary-500/10 border-primary-500/20'
                      }`}
                    >
                      <h4 className="font-medium text-surface-200 text-sm">{rec.title}</h4>
                      <p className="text-xs text-surface-400 mt-1">{rec.message}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No data state */}
          {scans.length === 0 && (
            <Card className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-surface-200">No body composition data yet</h2>
              <p className="text-surface-500 mt-2 max-w-md mx-auto">
                Add your first DEXA scan to start tracking your body composition.
              </p>
              <Link href="/dashboard/body-composition/add">
                <Button className="mt-6">Add DEXA Scan</Button>
              </Link>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'strength' && (
        <div className="space-y-6">
          {strengthProfile ? (
            <>
              {/* Overall Score */}
              <Card className="bg-gradient-to-br from-primary-500/10 to-accent-500/10 border-primary-500/30">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row items-center gap-6">
                    <div className="relative">
                      <svg className="w-32 h-32" viewBox="0 0 100 100">
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
                          stroke="url(#scoreGradient)"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${strengthProfile.overallScore * 2.83} 283`}
                          transform="rotate(-90 50 50)"
                        />
                        <defs>
                          <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#8b5cf6" />
                            <stop offset="100%" stopColor="#d946ef" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold text-white">{strengthProfile.overallScore}</span>
                        <span className="text-xs text-surface-400">/ 100</span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-sm text-surface-400">Overall Strength Level</p>
                        <p className={`text-2xl font-bold capitalize ${getStrengthLevelColor(strengthProfile.strengthLevel)}`}>
                          {formatStrengthLevel(strengthProfile.strengthLevel)}
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-2 bg-surface-900/50 rounded-lg">
                          <p className="text-xs text-surface-500">Balance</p>
                          <p className="text-lg font-bold text-white">{strengthProfile.balanceScore}%</p>
                        </div>
                        <div className="p-2 bg-surface-900/50 rounded-lg">
                          <p className="text-xs text-surface-500">FFMI</p>
                          <p className="text-lg font-bold text-white">{strengthProfile.bodyComposition.ffmi.toFixed(1)}</p>
                        </div>
                        <div className="p-2 bg-surface-900/50 rounded-lg">
                          <p className="text-xs text-surface-500">Lean Mass</p>
                          <p className="text-lg font-bold text-white">{displayWeight(strengthProfile.bodyComposition.leanMassKg)} {weightUnit}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Calibrated Lifts */}
              <Card>
                <CardHeader>
                  <CardTitle>Calibrated Lifts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {strengthProfile.calibratedLifts.map((lift) => (
                      <div key={lift.benchmarkId} className="p-4 bg-surface-800/50 rounded-xl">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="font-medium text-surface-200">{lift.lift}</h4>
                            <p className="text-sm text-surface-500">
                              E1RM: {displayWeight(lift.estimated1RM)} {weightUnit}
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

              {/* Imbalances */}
              {strengthProfile.imbalances.length > 0 && (
                <Card className="border-warning-500/30">
                  <CardHeader>
                    <CardTitle>⚠️ Detected Imbalances</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {strengthProfile.imbalances.map((imbalance, i) => (
                        <div
                          key={i}
                          className={`p-3 rounded-lg ${
                            imbalance.severity === 'significant'
                              ? 'bg-danger-500/10 border border-danger-500/30'
                              : 'bg-warning-500/10 border border-warning-500/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-surface-200">{imbalance.description}</p>
                              <p className="text-xs text-surface-400 mt-1">{imbalance.recommendation}</p>
                            </div>
                            <Badge size="sm" variant={imbalance.severity === 'significant' ? 'danger' : 'warning'}>
                              {imbalance.severity}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-surface-200">Calibrate Your Strength</h2>
              <p className="text-surface-500 mt-2 max-w-md mx-auto">
                Test your key lifts to get percentile rankings, identify imbalances, and receive personalized weight recommendations.
              </p>
              <Button className="mt-6" onClick={() => router.push('/onboarding')}>
                Start Strength Test
              </Button>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'volume' && (
        <div className="space-y-6">
          {analytics && analytics.totalWorkouts > 0 ? (
            <>
              {/* Quick Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <Card className="p-4">
                  <p className="text-xs text-surface-500 uppercase tracking-wider">Workouts</p>
                  <p className="text-2xl font-bold text-primary-400 mt-1">{analytics.totalWorkouts}</p>
                  {analytics.currentStreak > 1 && (
                    <p className="text-xs text-success-400 mt-1">🔥 {analytics.currentStreak} streak</p>
                  )}
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-surface-500 uppercase tracking-wider">Total Sets</p>
                  <p className="text-2xl font-bold text-primary-400 mt-1">{analytics.totalSets}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-surface-500 uppercase tracking-wider">Volume</p>
                  <p className="text-2xl font-bold text-primary-400 mt-1">
                    {formatWeight(analytics.totalVolume / 1000, units, 0)}k
                  </p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-surface-500 uppercase tracking-wider">Avg Duration</p>
                  <p className="text-2xl font-bold text-primary-400 mt-1">
                    {formatDuration(analytics.avgWorkoutDuration)}
                  </p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-surface-500 uppercase tracking-wider">Avg RPE</p>
                  <p className="text-2xl font-bold text-primary-400 mt-1">
                    {analytics.avgSessionRpe > 0 ? analytics.avgSessionRpe : '-'}
                  </p>
                </Card>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                {/* Volume by Muscle */}
                <Card>
                  <CardHeader>
                    <CardTitle>Volume by Muscle Group</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {analytics.weeklyMuscleVolume.slice(0, 8).map((muscle) => {
                        const maxSets = Math.max(...analytics.weeklyMuscleVolume.map(m => m.sets));
                        const percentage = maxSets > 0 ? (muscle.sets / maxSets) * 100 : 0;

                        return (
                          <div key={muscle.muscle}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-surface-200 capitalize">{muscle.muscle}</span>
                              <span className="text-sm text-surface-400">{muscle.sets} sets</span>
                            </div>
                            <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-500"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Top Exercises */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Exercises (Est. 1RM)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {analytics.topExercises.map((exercise, idx) => (
                        <div key={exercise.exerciseId} className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            idx < 3 ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-800 text-surface-500'
                          }`}>
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-surface-200 truncate">{exercise.exerciseName}</p>
                            <p className="text-xs text-surface-500">
                              Best: {formatWeight(exercise.bestWeight, units)} × {exercise.bestReps}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-primary-400">
                              {formatWeight(exercise.estimatedE1RM, units)}
                            </p>
                            <p className="text-xs text-surface-500">{exercise.totalSets} sets</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Workouts */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Recent Workouts</CardTitle>
                    <Link href="/dashboard/history">
                      <Button variant="ghost" size="sm">View All →</Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {analytics.recentWorkouts.map((workout) => (
                      <Link key={workout.id} href={`/dashboard/workout/${workout.id}`}>
                        <div className="p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-surface-200">
                                {new Date(workout.date).toLocaleDateString('en-US', {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </p>
                              <p className="text-xs text-surface-500">
                                {workout.totalSets} sets · {formatWeight(workout.totalVolume, units)} total
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {workout.sessionRpe && (
                                <Badge variant={workout.sessionRpe >= 8 ? 'danger' : 'warning'}>
                                  RPE {workout.sessionRpe}
                                </Badge>
                              )}
                              <span className="text-xs text-surface-500">{formatDuration(workout.duration)}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-surface-200">No workout data yet</h2>
              <p className="text-surface-500 mt-2 max-w-md mx-auto">
                Complete some workouts to see your volume and training trends.
              </p>
              <Link href="/dashboard/workout/new">
                <Button className="mt-6">Start a Workout</Button>
              </Link>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

