'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useQuery, useQueryClient, useIsRestoring } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, FullPageLoading, ErrorRetry } from '@/components/ui';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { resolveAuthState } from '@/lib/supabase/authState';
import { BodyMeasurements } from '@/components/dashboard/BodyMeasurements';
import { useMusclePriorities } from '@/components/settings/MusclePrioritySettings';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import type { DexaScan, Goal, Experience, FFMIResult, ProgressPhoto, MuscleGroup, StandardMuscleGroup } from '@/types/schema';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import {
  computeFFMI,
  leanMassIncludesBone,
  analyzeBodyCompTrend,
  generateCoachingRecommendations,
  getFFMILabel,
  getTrendIndicator,
} from '@/services/bodyCompEngine';
import { useBodyCompTrend } from '@/hooks/useBodyCompTrend';
import {
  getBodyCompLayout,
  BODY_COMP_TREND_SECTION_ID,
} from '@/services/compositionSpace';
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
import { kgToLbs, roundToIncrement, formatWeight, formatWorkoutDuration, resolveWorkoutDurationSeconds, estimateE1RM, getLocalDateString } from '@/lib/utils';
// Recharts components still used inline - these will be gradually migrated
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
import type { Mesocycle, BodyCompositionTarget, ExercisePerformanceSnapshot } from '@/types/schema';
import type { EnhancedProportionsAnalysis } from '@/services/bodyProportionsAnalytics';
import { analyzeEnhancedProportions } from '@/services/bodyProportionsAnalytics';
import { analyzeAllExercises, type PlateauDetectionResult, type PlateauGoal } from '@/services/plateauDetector';
import { PlateauAlertList } from '@/components/analytics/PlateauAlert';
import { getMuscleGroupProgression } from '@/services/progressionInsights';
import { MuscleProgressionCard } from '@/components/analytics/MuscleProgressionCard';
import { BodyHubTrends } from '@/components/body/BodyHubTrends';
import { BodyHubNudges } from '@/components/body/BodyHubNudges';
import { MeasurementTrendCard } from '@/components/body/MeasurementTrendCard';
import type { BodyLogSegment } from '@/components/body/LogBodyDataSheet';
import { LiftTrendsCard } from '@/components/analytics/LiftTrendsCard';
import {
  computeLiftTrends,
  LIFT_TREND_WINDOW_DAYS,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { listOutbox } from '@/lib/offline/setOutbox';
import {
  rangeStartLocalDay,
  pendingCompletionsFromOutbox,
  pendingSetsFromOutbox,
  mergeLocalPendingWorkouts,
  type RawWorkoutSession,
} from '@/services/volumeTrendsData';
// Dynamic imports for heavy chart components - only loaded when needed
const FFMIGauge = dynamic(() => import('@/components/analytics/FFMIGauge').then(m => m.FFMIGauge), { ssr: false });
const GoalsTab = dynamic(() => import('@/components/analytics/GoalsTab').then(m => m.GoalsTab), { ssr: false });
const LogBodyDataSheet = dynamic(
  () => import('@/components/body/LogBodyDataSheet').then(m => m.LogBodyDataSheet),
  { ssr: false }
);

// Body composition chart
const BodyCompChart = dynamic(
  () => import('@/components/analytics/BodyCompCharts').then(m => m.BodyCompChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-surface-700 rounded" /> }
);

// Wellness charts
const HydrationChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.HydrationChart),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse bg-surface-700 rounded" /> }
);
const CardioChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.CardioChart),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse bg-surface-700 rounded" /> }
);
const SleepHoursChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.SleepHoursChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const SleepQualityChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.SleepQualityChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const EnergyChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.EnergyChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const MoodChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.MoodChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const FocusChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.FocusChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const LibidoChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.LibidoChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const StressChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.StressChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const SorenessChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.SorenessChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);
const HungerChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.HungerChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-surface-700 rounded" /> }
);

// Daily tracking cards relocated from the home dashboard (Phase 3.3).
// Self-fetching client components — loaded on demand for the Wellness tab.
const ActivityCard = dynamic(
  () => import('@/components/dashboard/ActivityCard').then(m => m.ActivityCard),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-surface-700 rounded-xl" /> }
);
const HydrationTracker = dynamic(
  () => import('@/components/dashboard/HydrationTracker').then(m => m.HydrationTracker),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-surface-700 rounded-xl" /> }
);
const CardioTracker = dynamic(
  () => import('@/components/dashboard/CardioTracker').then(m => m.CardioTracker),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-surface-700 rounded-xl" /> }
);
const BodyTargets = dynamic(
  () => import('@/components/dashboard/BodyTargets').then(m => m.BodyTargets),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-surface-700 rounded-xl" /> }
);
const MuscleRecoveryCard = dynamic(
  () => import('@/components/dashboard/MuscleRecoveryCard').then(m => m.MuscleRecoveryCard),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-surface-700 rounded-xl" /> }
);

// Tab types
type TabType = 'body-composition' | 'goals' | 'strength' | 'volume' | 'wellness';

// Valid ?tab= values — tab targeting is a route parameter so any surface
// (home tiles, notifications, weekly summary) can deep-link a specific tab,
// e.g. /dashboard/analytics?tab=strength&section=lift-trends.
const TAB_IDS: readonly TabType[] = ['body-composition', 'goals', 'strength', 'volume', 'wellness'];

function parseTabParam(value: string | null): TabType | null {
  // 'body' is the friendly alias the Home Weight tile links to (the tab is
  // labelled "Body" — it's the Body data hub).
  if (value === 'body') return 'body-composition';
  return value && (TAB_IDS as readonly string[]).includes(value) ? (value as TabType) : null;
}

/** Get display name for a muscle group */
function getMuscleDisplayName(muscle: string): string {
  return STANDARD_MUSCLE_DISPLAY_NAMES[muscle as StandardMuscleGroup]
    ?? muscle.charAt(0).toUpperCase() + muscle.slice(1).replace(/_/g, ' ');
}

interface UserProfile {
  heightCm: number | null;
  goal: Goal;
  experience: Experience;
  targetBodyFatPercent: number | null;
  targetWeightKg: number | null;
}

/** Raw inputs for the muscle-group progression card (services/progressionInsights) */
interface ProgressionRawData {
  snapshotsByExercise: Map<string, ExercisePerformanceSnapshot[]>;
  muscleByExercise: Map<string, string>;
  exerciseNames: Map<string, string>;
  goal?: PlateauGoal;
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
  exercises: Array<{
    id: string;
    name: string;
    sets: number;
    bestE1RM: number;
  }>;
}

interface ExercisePerformance {
  exerciseId: string;
  exerciseName: string;
  primaryMuscle: string;
  bestWeight: number;
  bestReps: number;
  estimatedE1RM: number;
  totalSets: number;
}

// Strength standards relative to bodyweight (intermediate male, approximate)
// ONLY for free-weight compound movements with reliable powerlifting/research data
// Machine exercises are excluded - leverage varies by manufacturer
// Isolation exercises are excluded - no competitive standards exist
const STRENGTH_STANDARDS: Record<string, number> = {
  // Barbell compound movements (most reliable data)
  'Barbell Back Squat': 1.5,
  'Back Squat': 1.5,
  'Squat': 1.5,
  'Front Squat': 1.2,
  'Conventional Deadlift': 1.75,
  'Deadlift': 1.75,
  'Sumo Deadlift': 1.75,
  'Romanian Deadlift': 1.2,
  'RDL': 1.2,
  'Barbell Bench Press': 1.25,
  'Bench Press': 1.25,
  'Flat Bench Press': 1.25,
  'Incline Barbell Press': 1.0,
  'Incline Bench Press': 1.0,
  'Decline Bench Press': 1.3,
  'Standing Overhead Press': 0.75,
  'Overhead Press': 0.75,
  'Military Press': 0.75,
  'Barbell Row': 1.0,
  'Bent Over Row': 1.0,
  'Pendlay Row': 1.0,
  'Hip Thrust': 1.5,
  'Barbell Hip Thrust': 1.5,
  // Dumbbell compound movements (fairly reliable)
  'Dumbbell Bench Press': 0.35, // Per arm
  'Dumbbell Incline Press': 0.3, // Per arm
  'Dumbbell Shoulder Press': 0.25, // Per arm
  'Dumbbell Row': 0.4, // Per arm
  // Weighted bodyweight movements
  'Pull-up': 0.3, // Added weight as % of BW
  'Chin-up': 0.35,
  'Dip': 0.4,
  'Weighted Pull-up': 0.3,
  'Weighted Dip': 0.4,
};

// Exercises that should NOT show relative strength (machines, cables, isolation)
// These have unreliable standards due to equipment variation or lack of data
function hasReliableStandard(exerciseName: string): boolean {
  const name = exerciseName.toLowerCase();
  
  // Exclude machines - leverage varies by manufacturer
  if (name.includes('machine') || name.includes('smith') || 
      name.includes('cable') || name.includes('pec deck') ||
      name.includes('lat pulldown') || name.includes('pulldown') ||
      name.includes('leg press') || name.includes('hack squat') ||
      name.includes('leg extension') || name.includes('leg curl') ||
      name.includes('chest press') || name.includes('shoulder press machine') ||
      name.includes('iso-lateral') || name.includes('hammer strength') ||
      name.includes('cybex') || name.includes('nautilus') ||
      name.includes('seated row') || name.includes('t-bar')) {
    return false;
  }
  
  // Exclude isolation movements - no competitive standards
  if (name.includes('curl') && !name.includes('deadlift') || // Bicep curls, but not RDL
      name.includes('extension') || name.includes('pushdown') ||
      name.includes('fly') || name.includes('flye') ||
      name.includes('raise') || name.includes('lateral') ||
      name.includes('rear delt') || name.includes('face pull') ||
      name.includes('shrug') || name.includes('calf') ||
      name.includes('crunch') || name.includes('ab ')) {
    return false;
  }
  
  // Check if it's in our standards list
  return Object.keys(STRENGTH_STANDARDS).some(
    standard => name.includes(standard.toLowerCase()) || standard.toLowerCase().includes(name)
  );
}

// Optimal weekly sets by experience level
const OPTIMAL_WEEKLY_VOLUME: Record<string, Record<string, number>> = {
  novice: {
    chest: 10, back: 10, shoulders: 8, biceps: 6, triceps: 6,
    quads: 10, hamstrings: 8, glutes: 8, calves: 8, abs: 6,
    adductors: 6, forearms: 4, traps: 6,
  },
  intermediate: {
    chest: 14, back: 16, shoulders: 12, biceps: 10, triceps: 10,
    quads: 14, hamstrings: 12, glutes: 12, calves: 12, abs: 10,
    adductors: 8, forearms: 6, traps: 8,
  },
  advanced: {
    chest: 20, back: 22, shoulders: 16, biceps: 14, triceps: 14,
    quads: 20, hamstrings: 16, glutes: 16, calves: 16, abs: 14,
    adductors: 10, forearms: 8, traps: 10,
  },
};

// Get weeks multiplier for time range
function getWeeksInRange(range: '7d' | '30d' | '60d' | '6m' | '1y' | 'all'): number {
  switch (range) {
    case '7d': return 1;
    case '30d': return 4;
    case '60d': return 8;
    case '6m': return 26;
    case '1y': return 52;
    case 'all': return 52; // Default to 1 year for "all" comparison
    default: return 4;
  }
}

// Get time range label
function getTimeRangeLabel(range: '7d' | '30d' | '60d' | '6m' | '1y' | 'all'): string {
  switch (range) {
    case '7d': return 'this week';
    case '30d': return 'this month';
    case '60d': return '2 months';
    case '6m': return '6 months';
    case '1y': return '1 year';
    case 'all': return 'all time';
    default: return 'this period';
  }
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

// Sentinel returned by the main query when there's genuinely no session, so
// the effect can redirect to /login. Kept distinct from a thrown error (a
// transient verify failure), which drives the retryable error state instead.
const AUTH_REQUIRED = { authRequired: true } as const;

function AnalyticsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { preferences } = useUserPreferences();
  const [activeTab, setActiveTab] = useState<TabType>(
    () => parseTabParam(searchParams.get('tab')) ?? 'body-composition'
  );
  const sectionParam = searchParams.get('section');
  const [isLoading, setIsLoading] = useState(true);

  // Follow URL changes (back/forward, in-app deep links to another tab).
  // No/invalid param means the default tab — a base-route navigation (e.g.
  // the Progress nav item) must reset a previously deep-linked tab.
  useEffect(() => {
    setActiveTab(parseTabParam(searchParams.get('tab')) ?? 'body-composition');
  }, [searchParams]);

  const handleTabChange = (tab: TabType) => {
    // Local state only — deliberately NO URL write. Changing the ?tab= search
    // param remounts page.tsx (the App Router keys the page segment by its
    // search params; history.replaceState sync included), and this page still
    // loads via fetch-in-useEffect, so a remount meant a full refetch behind
    // a multi-second loading screen on every tab tap. Deep links IN
    // (?tab=...) keep working via the searchParams read/effect above; the
    // param just doesn't track subsequent taps.
    setActiveTab(tab);
  };
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '60d' | '6m' | '1y' | 'all'>('30d');

  // Body composition state
  const [scans, setScans] = useState<DexaScan[]>([]);
  const [progressPhotos, setProgressPhotos] = useState<ProgressPhoto[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  // Body hub: unified log sheet + refresh signal for the hub widgets
  const [logSegment, setLogSegment] = useState<BodyLogSegment | null>(null);
  const [bodyRefreshKey, setBodyRefreshKey] = useState(0);

  // DEXA-anchored body comp trend — the single source for both the trend
  // chart (BodyHubTrends) and the FFMI gauge, so they can never disagree.
  const {
    trend: bodyCompTrend,
    weightHistory: bodyWeightHistory,
    isLoading: isBodyTrendLoading,
  } = useBodyCompTrend(bodyRefreshKey);

  // Goals tab state
  const [activeMesocycle, setActiveMesocycle] = useState<Mesocycle | null>(null);
  const [activeTarget, setActiveTarget] = useState<BodyCompositionTarget | null>(null);
  const [weightHistory, setWeightHistory] = useState<Array<{ date: string; weightKg: number }>>([]);
  const [currentMeasurements, setCurrentMeasurements] = useState<Record<string, number>>({});
  const [proportionsAnalysis, setProportionsAnalysis] = useState<EnhancedProportionsAnalysis | null>(null);

  // Strength state
  const [strengthProfile, setStrengthProfile] = useState<StrengthProfile | null>(null);
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [userId, setUserId] = useState<string | null>(null);
  // Per-lift trend breakdown behind the home "Lifts" tile (shared function +
  // identical query window, so the tile aggregate and this detail agree).
  const [liftTrendsSummary, setLiftTrendsSummary] = useState<LiftTrendsSummary | null>(null);

  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  // Volume-tab fetch lifecycle. The empty state renders ONLY on a successful
  // fetch that truly found zero workouts in range — a failed fetch gets an
  // error+retry state instead of masquerading as "No workout data yet".
  const [analyticsStatus, setAnalyticsStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [analyticsRetryNonce, setAnalyticsRetryNonce] = useState(0);
  // Per-time-range result cache (P1-2) — lives for the page's lifetime.
  const analyticsRangeCacheRef = useRef(
    new Map<string, { analytics: AnalyticsData; plateauAlerts: Array<{ exerciseId: string; exerciseName: string; result: PlateauDetectionResult }>; progressionRaw: ProgressionRawData | null }>()
  );
  const [plateauAlerts, setPlateauAlerts] = useState<Array<{ exerciseId: string; exerciseName: string; result: PlateauDetectionResult }>>([]);
  // Raw inputs for the muscle-group progression card. Classification happens
  // in a render-side memo so it re-runs when the user profile (experience)
  // finishes loading, without refetching workout data.
  const [progressionRaw, setProgressionRaw] = useState<ProgressionRawData | null>(null);
  const [strengthViewMode, setStrengthViewMode] = useState<'absolute' | 'relative'>('absolute');
  const [expandedMuscles, setExpandedMuscles] = useState<Set<string>>(new Set());

  // Wellness state
  const [hydrationData, setHydrationData] = useState<Array<{ date: string; totalMl: number }>>([]);
  const [cardioData, setCardioData] = useState<Array<{ date: string; totalMinutes: number; modality: string }>>([]);
  const [checkInData, setCheckInData] = useState<Array<{
    date: string;
    sleepHours: number | null;
    sleepQuality: number | null;
    energyLevel: number | null;
    moodRating: number | null;
    focusRating: number | null;
    libidoRating: number | null;
    stressLevel: number | null;
    sorenessLevel: number | null;
    hungerLevel: number | null;
  }>>([]);

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
  // Analytics data is immutable-in-practice (DEXA history, completed-session
  // lift trends, progress photos). Cache it so returning to Analytics renders
  // instantly instead of re-blocking on the full-screen loader; a DEXA change
  // invalidates the query. queryFn returns the raw bundle; the effect below
  // processes it into the existing local state (downstream reads unchanged).
  const mainQuery = useQuery({
    queryKey: ['analytics', 'main'],
    queryFn: async () => {
      const supabase = createUntypedClient();
      // Distinguish a genuinely signed-out user (→ /login) from a transient
      // failure to verify the session (→ throw, so React Query surfaces a
      // retryable error state). A verify blip must never look like a logout.
      const auth = await resolveAuthState(supabase);
      if (auth.status === 'unauthenticated') return AUTH_REQUIRED;
      if (auth.status === 'error') {
        throw auth.error instanceof Error
          ? auth.error
          : new Error('Could not verify your session');
      }
      const user = { id: auth.userId };
      const [profileResult, scanResult, photoResult, sessionsResult] = await Promise.all([
        supabase
          .from('users')
          .select('height_cm, goal, experience, target_body_fat_percent, target_weight_kg, sex')
          .eq('id', user.id)
          .single(),
        supabase
          .from('dexa_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scan_date', { ascending: false }),
        supabase
          .from('progress_photos')
          .select('*')
          .eq('user_id', user.id)
          .order('photo_date', { ascending: false })
          .limit(8),
        supabase
          .from('coaching_sessions')
          .select('*, calibrated_lifts:calibrated_lifts(*)')
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1),
      ]);
      return {
        userId: user.id,
        profile: profileResult.data,
        scanData: scanResult.data,
        photoData: photoResult.data,
        sessionsData: sessionsResult.data,
      };
    },
    staleTime: 1000 * 60 * 5,
    gcTime: IMMUTABLE_GC_TIME,
  });
  const isRestoring = useIsRestoring();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!mainQuery.data) return;
    if ('authRequired' in mainQuery.data) {
      router.push('/login');
      return;
    }

    const { userId: uid, profile, scanData, photoData, sessionsData } = mainQuery.data;

    setUserId(uid);

    try {
        // Process user profile
        if (profile) {
          setUserProfile({
            heightCm: profile.height_cm,
            goal: profile.goal || 'maintenance',
            experience: profile.experience || 'intermediate',
            targetBodyFatPercent: profile.target_body_fat_percent,
            targetWeightKg: profile.target_weight_kg,
          });
          setSex(profile.sex || 'male');
        }

        // Process DEXA scans
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

        // Process progress photos
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

        // Process strength profile from coaching sessions
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
        console.error('Failed to process analytics data:', error);
        setIsLoading(false);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainQuery.data]);

  // Fetch lift-trend data for the Strength tab. Deliberately the SAME query
  // shape, window (LIFT_TREND_WINDOW_DAYS), and pure function as the home
  // "Lifts" glance tile (lib/actions/dashboard.ts fetchLiftTrends), so the
  // tile's "N rising of M" and this detail list can never disagree.
  useEffect(() => {
    async function fetchLiftTrendData() {
      if (!userId) return;

      const supabase = createUntypedClient();
      const since = new Date();
      since.setDate(since.getDate() - LIFT_TREND_WINDOW_DAYS);

      try {
        const [{ data: sessions }, { data: goalRow }, { data: activeMesos }] = await Promise.all([
          supabase
            .from('workout_sessions')
            .select(`id, completed_at,
              exercise_blocks (exercises (id, name), set_logs (weight_kg, reps, is_warmup))`)
            .eq('user_id', userId)
            .eq('state', 'completed')
            .gte('completed_at', since.toISOString())
            .order('completed_at', { ascending: true }),
          supabase.from('users').select('goal').eq('id', userId).single(),
          supabase
            .from('mesocycles')
            .select('start_date')
            .eq('user_id', userId)
            .or('is_active.eq.true,state.eq.active')
            .order('created_at', { ascending: false })
            .limit(1),
        ]);

        setLiftTrendsSummary(
          computeLiftTrends(
            (sessions as any) || [],
            (goalRow?.goal as PlateauGoal | null) ?? undefined,
            new Date(),
            { programStartDate: activeMesos?.[0]?.start_date ?? null }
          )
        );
      } catch (error) {
        console.error('Failed to fetch lift trend data:', error);
      }
    }

    fetchLiftTrendData();
  }, [userId]);

  // Deep-link scroll target (?section=lift-trends / muscle-progression):
  // retried as each section's data lands (they arrive from separate fetches)
  // so a cold load still ends up anchored on the right card.
  useEffect(() => {
    if (!sectionParam || isLoading) return;
    const el = document.getElementById(sectionParam);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sectionParam, activeTab, isLoading, liftTrendsSummary, progressionRaw]);

  // Fetch goals tab data (mesocycle, targets, weight history, measurements)
  useEffect(() => {
    async function fetchGoalsData() {
      if (!userId) return;

      const supabase = createUntypedClient();

      try {
        // Fetch active mesocycle, active body composition target, weight history, and measurements in parallel
        const [mesocycleResult, targetResult, weighInsResult, measurementsResult] = await Promise.all([
          // Active mesocycle
          supabase
            .from('mesocycles')
            .select('*')
            .eq('user_id', userId)
            .eq('state', 'active')
            .order('started_at', { ascending: false })
            .limit(1),
          // Active body composition target
          supabase
            .from('body_composition_targets')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1),
          // Weight history from weigh-ins (last 90 days for projection)
          supabase
            .from('weigh_ins')
            .select('logged_at, weight_kg')
            .eq('user_id', userId)
            .gte('logged_at', getLocalDateString(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)))
            .order('logged_at', { ascending: true }),
          // Latest body measurements
          supabase
            .from('body_measurements')
            .select('*')
            .eq('user_id', userId)
            .order('logged_at', { ascending: false })
            .limit(1),
        ]);

        // Process mesocycle
        if (mesocycleResult.data && mesocycleResult.data.length > 0) {
          const meso = mesocycleResult.data[0];
          setActiveMesocycle({
            id: meso.id,
            userId: meso.user_id,
            name: meso.name,
            state: meso.state,
            totalWeeks: meso.total_weeks,
            currentWeek: meso.current_week,
            deloadWeek: meso.deload_week,
            daysPerWeek: meso.days_per_week,
            splitType: meso.split_type,
            fatigueScore: meso.fatigue_score || 0,
            preferredWorkoutDays: meso.preferred_workout_days || null,
            sessionDurationMinutes: meso.session_duration_minutes || null,
            createdAt: meso.created_at,
            startedAt: meso.started_at,
            completedAt: meso.completed_at,
          });
        }

        // Process body composition target
        if (targetResult.data && targetResult.data.length > 0) {
          const target = targetResult.data[0];
          setActiveTarget({
            id: target.id,
            userId: target.user_id,
            targetWeightKg: target.target_weight_kg,
            targetBodyFatPercent: target.target_body_fat_percent,
            targetFfmi: target.target_ffmi,
            measurementTargets: {
              neck: target.neck,
              shoulders: target.shoulders,
              chest: target.chest,
              upper_back: target.upper_back,
              lower_back: target.lower_back,
              left_bicep: target.left_bicep,
              right_bicep: target.right_bicep,
              left_forearm: target.left_forearm,
              right_forearm: target.right_forearm,
              waist: target.waist,
              hips: target.hips,
              left_thigh: target.left_thigh,
              right_thigh: target.right_thigh,
              left_calf: target.left_calf,
              right_calf: target.right_calf,
            },
            mesocycleId: target.mesocycle_id,
            targetDate: target.target_date,
            name: target.name,
            notes: target.notes,
            isActive: target.is_active,
            createdAt: target.created_at,
            updatedAt: target.updated_at,
          });
        }

        // Process weight history
        if (weighInsResult.data && weighInsResult.data.length > 0) {
          setWeightHistory(
            weighInsResult.data.map((w: { logged_at: string; weight_kg: number }) => ({
              date: w.logged_at,
              weightKg: w.weight_kg,
            }))
          );
        }

        // Process measurements and calculate proportions
        if (measurementsResult.data && measurementsResult.data.length > 0) {
          const m = measurementsResult.data[0];
          const measurements: Record<string, number> = {};

          if (m.neck) measurements.neck = m.neck;
          if (m.shoulders) measurements.shoulders = m.shoulders;
          if (m.chest) measurements.chest = m.chest;
          if (m.upper_back) measurements.upperBack = m.upper_back;
          if (m.lower_back) measurements.lowerBack = m.lower_back;
          if (m.left_bicep) measurements.leftBicep = m.left_bicep;
          if (m.right_bicep) measurements.rightBicep = m.right_bicep;
          if (m.left_forearm) measurements.leftForearm = m.left_forearm;
          if (m.right_forearm) measurements.rightForearm = m.right_forearm;
          if (m.waist) measurements.waist = m.waist;
          if (m.hips) measurements.hips = m.hips;
          if (m.left_thigh) measurements.leftThigh = m.left_thigh;
          if (m.right_thigh) measurements.rightThigh = m.right_thigh;
          if (m.left_calf) measurements.leftCalf = m.left_calf;
          if (m.right_calf) measurements.rightCalf = m.right_calf;

          setCurrentMeasurements(measurements);

          // Calculate proportions analysis if we have height
          if (userProfile?.heightCm && Object.keys(measurements).length > 3) {
            try {
              const analysis = analyzeEnhancedProportions(
                {
                  neck: measurements.neck,
                  shoulders: measurements.shoulders,
                  chest: measurements.chest,
                  upper_back: measurements.upperBack,
                  waist: measurements.waist,
                  hips: measurements.hips,
                  left_bicep: measurements.leftBicep,
                  right_bicep: measurements.rightBicep,
                  left_forearm: measurements.leftForearm,
                  right_forearm: measurements.rightForearm,
                  left_thigh: measurements.leftThigh,
                  right_thigh: measurements.rightThigh,
                  left_calf: measurements.leftCalf,
                  right_calf: measurements.rightCalf,
                },
                userProfile.heightCm,
                [] // No existing asymmetries from previous analysis
              );
              setProportionsAnalysis(analysis);
            } catch (err) {
              console.error('Failed to analyze proportions:', err);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch goals data:', error);
      }
    }

    fetchGoalsData();
  }, [userId, userProfile?.heightCm]);

  // Fetch wellness data (hydration and daily check-ins)
  useEffect(() => {
    async function fetchWellnessData() {
      if (!userId) return;

      const supabase = createUntypedClient();
      
      // Calculate date range based on timeRange
      const now = new Date();
      let startDate: Date;
      switch (timeRange) {
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '60d':
          startDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
          break;
        case '6m':
          startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          break;
        case '1y':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(0); // All time
      }

      const startDateStr = getLocalDateString(startDate);

      try {
        // Fetch hydration data
        const { data: hydrationLogs } = await supabase
          .from('hydration_log')
          .select('logged_at, amount_ml')
          .eq('user_id', userId)
          .gte('logged_at', startDateStr)
          .order('logged_at', { ascending: true });

        if (hydrationLogs) {
          // Group by date and sum amounts
          const grouped = hydrationLogs.reduce((acc: Record<string, number>, entry: any) => {
            const date = entry.logged_at;
            acc[date] = (acc[date] || 0) + (entry.amount_ml || 0);
            return acc;
          }, {});

          const hydrationArray = Object.entries(grouped).map(([date, totalMl]) => ({
            date,
            totalMl: totalMl as number,
          })).sort((a, b) => a.date.localeCompare(b.date));

          setHydrationData(hydrationArray);
        }

        // Fetch cardio data
        const { data: cardioLogs } = await supabase
          .from('cardio_log')
          .select('logged_at, minutes, modality')
          .eq('user_id', userId)
          .gte('logged_at', startDateStr)
          .order('logged_at', { ascending: true });

        if (cardioLogs) {
          // Group by date and sum minutes, also track modality breakdown
          type CardioGroupData = { totalMinutes: number; modalities: Record<string, number> };
          const grouped: Record<string, CardioGroupData> = cardioLogs.reduce((acc: Record<string, CardioGroupData>, entry: any) => {
            const date = entry.logged_at;
            if (!acc[date]) {
              acc[date] = { totalMinutes: 0, modalities: {} };
            }
            acc[date].totalMinutes += entry.minutes || 0;
            const mod = entry.modality || 'other';
            acc[date].modalities[mod] = (acc[date].modalities[mod] || 0) + (entry.minutes || 0);
            return acc;
          }, {});

          const cardioArray = Object.entries(grouped).map(([date, data]) => {
            // Get the most common modality for that day
            const topModality = Object.entries(data.modalities).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
            return {
              date,
              totalMinutes: data.totalMinutes,
              modality: topModality,
            };
          }).sort((a, b) => a.date.localeCompare(b.date));

          setCardioData(cardioArray);
        }

        // Fetch daily check-in data
        const { data: checkIns } = await supabase
          .from('daily_check_ins')
          .select('date, sleep_hours, sleep_quality, energy_level, mood_rating, focus_rating, libido_rating, stress_level, soreness_level, hunger_level')
          .eq('user_id', userId)
          .gte('date', startDateStr)
          .order('date', { ascending: true });

        if (checkIns) {
          const transformed = checkIns.map((ci: any) => ({
            date: ci.date,
            sleepHours: ci.sleep_hours,
            sleepQuality: ci.sleep_quality,
            energyLevel: ci.energy_level,
            moodRating: ci.mood_rating,
            focusRating: ci.focus_rating,
            libidoRating: ci.libido_rating,
            stressLevel: ci.stress_level,
            sorenessLevel: ci.soreness_level,
            hungerLevel: ci.hunger_level,
          }));
          setCheckInData(transformed);
        }
      } catch (error) {
        console.error('Failed to fetch wellness data:', error);
      }
    }

    fetchWellnessData();
  }, [userId, timeRange]);

  // Fetch workout analytics data.
  // P1-2 (perf): results are cached per time range for the page's lifetime —
  // flipping 7d -> 30d -> 7d no longer refetches the whole nested query tree.
  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const cached = analyticsRangeCacheRef.current.get(timeRange);
        if (cached) {
          setAnalytics(cached.analytics);
          setPlateauAlerts(cached.plateauAlerts);
          setProgressionRaw(cached.progressionRaw);
          setAnalyticsStatus('ready');
          return;
        }

        setAnalyticsStatus('loading');
        const supabase = createUntypedClient();
        // Same auth semantics as the main query: only a confirmed signed-out
        // state bails (the main query's effect redirects to /login); a
        // transient verify failure is a retryable error, never faux-emptiness.
        const auth = await resolveAuthState(supabase);
        if (auth.status === 'unauthenticated') return;
        if (auth.status === 'error') {
          setAnalyticsStatus('error');
          return;
        }
        const user = { id: auth.userId };

        // Range lower bound at local midnight so a range means whole local
        // calendar days — never a rolling UTC-instant window (this bug class
        // has shipped twice; see services/volumeTrendsData).
        const startDate = rangeStartLocalDay(timeRange);

        let query = supabase
          .from('workout_sessions')
          .select(`
            id,
            started_at,
            completed_at,
            duration_seconds,
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

        // Diet goal for plateau detection (fetched here, not from userProfile
        // state, so the per-range cache can't be seeded before the profile
        // query resolves and keep stale goal-less results).
        const goalPromise = supabase
          .from('users')
          .select('goal')
          .eq('id', user.id)
          .single();

        // Locally-finished workouts whose completion patch (and possibly set
        // rows) are still queued in the offline outbox: the server row is
        // still `in_progress`, so the state='completed' query above can't see
        // them. Unsynced must not mean invisible — the finish screen, Home
        // card, and history all already show these.
        const outboxEntries = await listOutbox().catch(() => []);
        const pendingCompletions = pendingCompletionsFromOutbox(outboxEntries);
        const pendingSetsByBlock = pendingSetsFromOutbox(outboxEntries);

        // Left joins here (unlike the main query): blocks whose sets are all
        // still queued locally must come back so the queued sets can be
        // merged in.
        const pendingPromise = pendingCompletions.size > 0
          ? supabase
              .from('workout_sessions')
              .select(`
                id,
                started_at,
                completed_at,
                duration_seconds,
                session_rpe,
                exercise_blocks (
                  id,
                  exercises (
                    id,
                    name,
                    primary_muscle
                  ),
                  set_logs (
                    id,
                    weight_kg,
                    reps,
                    is_warmup,
                    logged_at
                  )
                )
              `)
              .eq('user_id', user.id)
              .in('id', Array.from(pendingCompletions.keys()))
          : Promise.resolve({ data: [] as RawWorkoutSession[], error: null });

        const [{ data: serverSessions, error }, { data: goalRow }, { data: pendingData, error: pendingError }] =
          await Promise.all([query, goalPromise, pendingPromise]);

        if (error || pendingError) {
          // A failed fetch is an error state with retry — NEVER rendered as
          // "no workout data".
          console.error('Failed to fetch analytics:', error ?? pendingError);
          setAnalyticsStatus('error');
          return;
        }

        const workoutSessions = mergeLocalPendingWorkouts({
          serverSessions: (serverSessions ?? []) as RawWorkoutSession[],
          pendingSessions: (pendingData ?? []) as RawWorkoutSession[],
          pendingCompletions,
          pendingSetsByBlock,
          rangeStart: startDate,
        });

        if (workoutSessions.length === 0) {
          // Genuinely zero workouts in range (server AND local outbox agree).
          setAnalytics(null);
          setPlateauAlerts([]);
          setProgressionRaw(null);
          setAnalyticsStatus('ready');
          return;
        }

        let totalSets = 0;
        let totalVolume = 0;
        let totalRpeSum = 0;
        let rpeCount = 0;
        const durations: number[] = [];
        const muscleVolumeMap = new Map<string, { sets: number; workouts: Set<string>; exercises: Map<string, { id: string; name: string; sets: number; bestE1RM: number }> }>();
        const exercisePerformanceMap = new Map<string, ExercisePerformance>();
        // Per-session snapshots per exercise, for plateau detection
        const snapshotMap = new Map<string, ExercisePerformanceSnapshot[]>();
        const exerciseNameMap = new Map<string, string>();

        workoutSessions.forEach((session: any) => {
          if (session.duration_seconds != null || (session.started_at && session.completed_at)) {
            durations.push(
              resolveWorkoutDurationSeconds(
                session.duration_seconds,
                session.started_at,
                session.completed_at
              )
            );
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
                muscleVolumeMap.set(muscle, { sets: 0, workouts: new Set(), exercises: new Map() });
              }
              const muscleData = muscleVolumeMap.get(muscle)!;
              muscleData.sets += workingSets.length;
              muscleData.workouts.add(session.id);

              // Track exercises within each muscle group
              if (!muscleData.exercises.has(exerciseId)) {
                muscleData.exercises.set(exerciseId, { id: exerciseId, name: exerciseName, sets: 0, bestE1RM: 0 });
              }
              const exInMuscle = muscleData.exercises.get(exerciseId)!;
              exInMuscle.sets += workingSets.length;

              workingSets.forEach((set: any) => {
                totalSets++;
                totalVolume += set.weight_kg * set.reps;

                const e1rm = estimateE1RM(set.weight_kg, set.reps);
                
                // Update best E1RM for this exercise in muscle group
                if (e1rm > exInMuscle.bestE1RM) {
                  exInMuscle.bestE1RM = e1rm;
                }

                if (!exercisePerformanceMap.has(exerciseId)) {
                  exercisePerformanceMap.set(exerciseId, {
                    exerciseId,
                    exerciseName,
                    primaryMuscle: muscle,
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

              // Build a per-session snapshot for this exercise (top set by E1RM)
              // so the plateau detector can analyze E1RM trends over time.
              if (workingSets.length > 0) {
                const sessionDate = getLocalDateString(new Date(session.completed_at));
                let topE1RM = 0;
                let topWeight = 0;
                let topReps = 0;
                workingSets.forEach((set: any) => {
                  const e1rm = estimateE1RM(set.weight_kg, set.reps);
                  if (e1rm > topE1RM) {
                    topE1RM = e1rm;
                    topWeight = set.weight_kg;
                    topReps = set.reps;
                  }
                });

                exerciseNameMap.set(exerciseId, exerciseName);
                if (!snapshotMap.has(exerciseId)) {
                  snapshotMap.set(exerciseId, []);
                }
                snapshotMap.get(exerciseId)!.push({
                  id: `${session.id}-${exerciseId}`,
                  userId: user.id,
                  exerciseId,
                  sessionDate,
                  topSetWeightKg: topWeight,
                  topSetReps: topReps,
                  // RPE is not selected in this query; default to 10 (E1RM already
                  // reflects logged performance, and the detector mainly trends E1RM).
                  topSetRpe: 10,
                  totalWorkingSets: workingSets.length,
                  estimatedE1RM: topE1RM,
                });
              }
            });
          }
        });

        // Run plateau detection over per-exercise session snapshots.
        // Today's date skips exercises not trained recently (long ranges like
        // '1y'/'all' include long-abandoned lifts); the goal sets expectations
        // (gains on a bulk vs. holding strength on a cut).
        const plateauResults = analyzeAllExercises(
          snapshotMap,
          new Date(),
          (goalRow?.goal as PlateauGoal | null) ?? undefined
        );
        const detectedPlateauAlerts: Array<{ exerciseId: string; exerciseName: string; result: PlateauDetectionResult }> = [];
        plateauResults.forEach((result, exerciseId) => {
          if (result.isPlateaued) {
            detectedPlateauAlerts.push({
              exerciseId,
              exerciseName: exerciseNameMap.get(exerciseId) ?? 'Exercise',
              result,
            });
          }
        });
        detectedPlateauAlerts.sort((a, b) => b.result.weeksSinceProgress - a.result.weeksSinceProgress);
        setPlateauAlerts(detectedPlateauAlerts);

        // Raw inputs for the muscle-group progression card: per-exercise
        // session snapshots plus each exercise's primary muscle.
        const muscleByExercise = new Map<string, string>();
        exercisePerformanceMap.forEach((data, exId) => {
          if (data.primaryMuscle) muscleByExercise.set(exId, data.primaryMuscle);
        });
        const progressionRawResult: ProgressionRawData = {
          snapshotsByExercise: snapshotMap,
          muscleByExercise,
          exerciseNames: exerciseNameMap,
          goal: (goalRow?.goal as PlateauGoal | null) ?? undefined,
        };
        setProgressionRaw(progressionRawResult);

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

          const duration = resolveWorkoutDurationSeconds(
            session.duration_seconds,
            session.started_at,
            session.completed_at
          );

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
            exercises: Array.from(data.exercises.values())
              .sort((a, b) => b.sets - a.sets),
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

          // merge guarantees completed_at is non-null on every returned session
          const lastWorkoutDate = new Date(workoutSessions[0].completed_at!);
          lastWorkoutDate.setHours(0, 0, 0, 0);

          const daysSinceLastWorkout = Math.floor((today.getTime() - lastWorkoutDate.getTime()) / (24 * 60 * 60 * 1000));

          if (daysSinceLastWorkout <= 2) {
            currentStreak = 1;

            for (let i = 1; i < workoutSessions.length; i++) {
              const prevDate = new Date(workoutSessions[i - 1].completed_at!);
              const currDate = new Date(workoutSessions[i].completed_at!);
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

        const analyticsResult = {
          totalWorkouts,
          totalSets,
          totalVolume,
          avgWorkoutDuration,
          avgSessionRpe,
          recentWorkouts,
          weeklyMuscleVolume,
          topExercises,
          currentStreak,
        };
        setAnalytics(analyticsResult);
        setAnalyticsStatus('ready');
        analyticsRangeCacheRef.current.set(timeRange, {
          analytics: analyticsResult,
          plateauAlerts: detectedPlateauAlerts,
          progressionRaw: progressionRawResult,
        });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
        setAnalyticsStatus('error');
      }
    }

    fetchAnalytics();
  }, [timeRange, analyticsRetryNonce]);

  // Muscle-group progression classification (services/progressionInsights).
  // Recomputes when the profile loads so pace is judged against the right
  // experience level; workout data itself comes from the cached fetch above.
  const muscleProgression = useMemo(() => {
    if (!progressionRaw) return [];
    return getMuscleGroupProgression({
      snapshotsByExercise: progressionRaw.snapshotsByExercise,
      muscleByExercise: progressionRaw.muscleByExercise,
      experience: userProfile?.experience ?? 'intermediate',
      referenceDate: new Date(),
      goal: progressionRaw.goal,
    });
  }, [progressionRaw, userProfile?.experience]);

  // Calculated values
  const latestScan = scans[0];
  // FFMI comes from the LAST POINT of the anchored trend (the same series the
  // Body Composition Trend chart plots) via the shared computeFFMI — not from
  // the raw latest scan, which goes stale as weigh-ins accumulate after it.
  // While the trend is still loading, fall back to the latest scan through
  // the same function (lean + bone) so the value definition never changes.
  const latestTrendPoint = bodyCompTrend.length > 0
    ? bodyCompTrend[bodyCompTrend.length - 1]
    : null;
  const ffmiResult = userProfile?.heightCm
    ? latestTrendPoint
      ? computeFFMI(latestTrendPoint.leanMassKg, latestTrendPoint.boneMassKg, userProfile.heightCm)
      : latestScan
        ? computeFFMI(
            latestScan.leanMassKg,
            // Calculated-entry scans store lean = weight − fat (bone already
            // inside) — adding BMC would double-count it.
            leanMassIncludesBone(latestScan) ? null : latestScan.boneMassKg,
            userProfile.heightCm
          )
        : null
    : null;
  const trend = userProfile?.heightCm
    ? analyzeBodyCompTrend(scans, userProfile.heightCm)
    : null;
  const recommendations = userProfile?.heightCm
    ? generateCoachingRecommendations(scans, userProfile.heightCm, userProfile.goal, userProfile.experience)
    : [];

  // A transient failure to load/verify the session (network, 5xx, failed
  // client init) — React Query has already retried and surfaced the error.
  // Keep the user here with a Retry instead of bouncing them to /login: the
  // session token is untouched, only the check failed.
  if (mainQuery.isError) {
    return (
      <ErrorRetry
        fullPage
        title="Couldn't load your analytics"
        message="We had trouble reaching the server. You're still signed in — check your connection and try again."
        onRetry={() => { void mainQuery.refetch(); }}
        isRetrying={mainQuery.isFetching}
      />
    );
  }

  // Full-screen loader only on first-ever load with an empty cache. A revisit
  // (warm cache) or reload (IndexedDB restore) has the bundle available and
  // renders immediately.
  if (isLoading && !mainQuery.data && !isRestoring) {
    return <div data-testid="analytics-full-loading"><FullPageLoading text="Loading your analytics..." type="heartbeat" /></div>;
  }

  // After the unified sheet saves: refresh the hub widgets, and for a DEXA
  // save also refresh this page's own scan-driven sections (quick stats,
  // FFMI, recommendations) without re-running the whole page fetch.
  const handleBodyDataSaved = async (detail: { kind: BodyLogSegment }) => {
    setBodyRefreshKey((k) => k + 1);
    if (detail.kind !== 'dexa' || !userId) return;
    const supabase = createUntypedClient();
    const { data } = await supabase
      .from('dexa_scans')
      .select('*')
      .eq('user_id', userId)
      .order('scan_date', { ascending: false });
    if (data) {
      setScans(
        data.map((scan: any) => ({
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
        }))
      );
    }
    // Keep the cached analytics bundle fresh so a later revisit reflects the
    // new DEXA scan instead of the stale persisted copy.
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'main'] });
  };

  // One-tap "Set as target" from the map's suggested milestone: persist as
  // the active composition target (the table's trigger deactivates others)
  // and reflect it locally so the goal vector appears without a refetch.
  const handleSetSuggestedTarget = async (suggested: {
    targetFfmi: number;
    targetBodyFatPercent: number;
  }) => {
    if (!userId) return;
    const supabase = createUntypedClient();
    const { data, error } = await supabase
      .from('body_composition_targets')
      .insert({
        user_id: userId,
        name: 'Next milestone',
        target_ffmi: suggested.targetFfmi,
        target_body_fat_percent: suggested.targetBodyFatPercent,
        is_active: true,
      })
      .select()
      .single();
    if (error || !data) {
      console.error('Failed to set suggested target:', error);
      return;
    }
    setActiveTarget({
      id: data.id,
      userId: data.user_id,
      targetWeightKg: data.target_weight_kg,
      targetBodyFatPercent: data.target_body_fat_percent,
      targetFfmi: data.target_ffmi,
      measurementTargets: {},
      mesocycleId: data.mesocycle_id,
      targetDate: data.target_date,
      name: data.name,
      notes: data.notes,
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  };

  // Prominence gating for the Body tab + Home card (0/1 scans keep the
  // existing layout with a subtle prompt; ≥2 promote the trend module).
  const bodyCompLayout = getBodyCompLayout(scans.length);

  // Weight trend + DEXA-anchored BF%/lean-mass/FFMI trend + Composition Map.
  // Extracted so the prominence logic can move it above/below the nudges
  // without duplicating props. The map's goal vector reads the active
  // composition target; its start defaults to the first scan of the current
  // phase (target creation date) with an all-time toggle.
  const bodyTrendModule = (
    <BodyHubTrends
      units={units}
      heightCm={userProfile?.heightCm ?? null}
      trend={bodyCompTrend}
      weightHistory={bodyWeightHistory}
      isLoading={isBodyTrendLoading}
      phase={userProfile?.goal ?? null}
      target={
        activeTarget
          ? {
              targetWeightKg: activeTarget.targetWeightKg ?? null,
              targetBodyFatPercent: activeTarget.targetBodyFatPercent ?? null,
              targetFfmi: activeTarget.targetFfmi ?? null,
            }
          : userProfile?.targetBodyFatPercent
            ? {
                // Fallback: profile-level targets (users table). A named
                // composition target wins when one is active.
                targetWeightKg: userProfile.targetWeightKg ?? null,
                targetBodyFatPercent: userProfile.targetBodyFatPercent,
                targetFfmi: null,
              }
            : null
      }
      phaseStartDate={activeTarget?.createdAt ?? null}
      sex={sex}
      experience={userProfile?.experience ?? null}
      onSetTarget={handleSetSuggestedTarget}
      initialMetric={
        sectionParam === BODY_COMP_TREND_SECTION_ID && bodyCompLayout.showCompositionMap
          ? 'map'
          : undefined
      }
    />
  );

  const tabs = [
    { id: 'body-composition' as TabType, label: 'Body', icon: '📊' },
    { id: 'goals' as TabType, label: 'Goals', icon: '🎯' },
    { id: 'strength' as TabType, label: 'Strength', icon: '💪' },
    { id: 'volume' as TabType, label: 'Volume & Trends', icon: '📈' },
    { id: 'wellness' as TabType, label: 'Wellness', icon: '💚' },
  ];

  return (
    <div className="space-y-6 animate-fade-in" data-testid="analytics-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Analytics</h1>
          <p className="text-surface-400">Track your body composition, strength, and training progress</p>
        </div>
        <div className="flex gap-2">
          {/* Time range selector */}
          <div className="flex gap-1 bg-surface-800 p-1 rounded-lg flex-wrap">
            {([
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d' },
              { value: '60d', label: '60d' },
              { value: '6m', label: '6mo' },
              { value: '1y', label: '1yr' },
              { value: 'all', label: 'All' },
            ] as const).map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  timeRange === range.value
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {range.label}
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
            onClick={() => handleTabChange(tab.id)}
            className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 px-1 sm:px-4 py-2 sm:py-2.5 min-h-[52px] rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-surface-700 text-surface-100 shadow-sm'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
            }`}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {/* P1-7: labels always visible — icon-only tabs hid five sections' worth of features */}
            <span className="text-[10px] leading-tight sm:text-sm text-center">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'body-composition' && (
        <div className="space-y-6">
          {/* Body hub front door: one Log button for weight / tape / DEXA */}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-surface-100">Body</h2>
            <Button size="sm" onClick={() => setLogSegment('weight')}>
              + Log
            </Button>
          </div>

          {/* Prominence (getBodyCompLayout): with ≥2 DEXA scans the trend
              module (incl. the Composition Map) leads the tab; below that
              the existing order stands plus a subtle log-a-scan prompt. */}
          {bodyCompLayout.trendFirst && bodyTrendModule}

          {/* Staleness + DEXA-due nudges */}
          <BodyHubNudges
            onLog={(segment) => setLogSegment(segment)}
            refreshKey={bodyRefreshKey}
          />

          {!bodyCompLayout.trendFirst && bodyTrendModule}

          {bodyCompLayout.showScanPrompt && (
            <p className="text-xs text-surface-500 text-center">
              {scans.length === 0
                ? 'Log a DEXA scan to unlock composition trends and the Composition Map.'
                : 'One more DEXA scan unlocks the Composition Map and scan-to-scan analysis.'}{' '}
              <button
                type="button"
                onClick={() => setLogSegment('dexa')}
                className="text-primary-400 hover:text-primary-300 font-medium"
              >
                Log scan
              </button>
            </p>
          )}

          {/* Per-site tape trends */}
          <MeasurementTrendCard
            tapeUnit={units === 'lb' ? 'in' : 'cm'}
            refreshKey={bodyRefreshKey}
          />

          {/* Muscle Priorities Display - Show at top of body comp tab */}
          {userId ? (
            <MusclePrioritiesDisplay userId={userId} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Muscle Group Priorities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-4 text-surface-400 text-sm">Loading user data...</div>
              </CardContent>
            </Card>
          )}

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
                      date: new Date(scan.scanDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
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

          {/* Body Measurements */}
          {userId && (
            <BodyMeasurements 
              userId={userId} 
              unit={units === 'lb' ? 'in' : 'cm'}
              heightCm={userProfile?.heightCm || undefined}
              showImbalanceAnalysis={true}
            />
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

      {activeTab === 'goals' && (
        <div className="space-y-6">
          {/* The target EDITOR (weight / BF% / FFMI — what the Composition
              Map's goal vector reads). Lives here on Goals, id-anchored so
              the map's "Set a target" prompt deep-links straight to it. */}
          {userId && (
            <div id="body-targets" className="scroll-mt-4">
              <BodyTargets
                userId={userId}
                unit={units === 'lb' ? 'in' : 'cm'}
                weightUnit={units}
                currentWeightKg={latestScan?.weightKg}
                currentBodyFatPercent={latestScan?.bodyFatPercent}
                currentFfmi={ffmiResult?.ffmi}
                currentMeasurements={currentMeasurements}
              />
            </div>
          )}
          <GoalsTab
            activeMesocycle={activeMesocycle}
            activeTarget={activeTarget}
            currentBodyComp={{
              weightKg: latestScan?.weightKg ?? null,
              bodyFatPercent: latestScan?.bodyFatPercent ?? null,
              ffmi: ffmiResult?.ffmi ?? null,
              leanMassKg: latestScan?.leanMassKg ?? null,
            }}
            currentMeasurements={currentMeasurements}
            weightHistory={weightHistory}
            proportionsAnalysis={proportionsAnalysis}
            heightCm={userProfile?.heightCm ?? null}
            displayUnit={units === 'kg' ? 'cm' : 'in'}
            weightUnit={units === 'kg' ? 'kg' : 'lb'}
            onEditGoals={() =>
              // The editor is on this same tab — scroll to it instead of the
              // old /dashboard/body-composition?tab=targets route, which
              // redirects to Analytics and drops the param (dead end).
              document
                .getElementById('body-targets')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            onCreateMesocycle={() => router.push('/dashboard/mesocycle/new')}
          />
        </div>
      )}

      {activeTab === 'strength' && (
        <div className="space-y-6">
          {/* Per-lift trend breakdown (the home "Lifts" tile's detail view).
              First so ?section=lift-trends deep links land above the fold. */}
          {liftTrendsSummary && (
            <LiftTrendsCard summary={liftTrendsSummary} units={units === 'lb' ? 'lb' : 'kg'} />
          )}
          {/* Plateau alerts derived from per-exercise E1RM trends. Hidden when none. */}
          {plateauAlerts.length > 0 && (
            <PlateauAlertList alerts={plateauAlerts} />
          )}
          {/* Progression pace per muscle group vs the expected rate for the
              user's experience level (services/progressionInsights) */}
          {muscleProgression.length > 0 && (
            <MuscleProgressionCard
              groups={muscleProgression}
              exerciseNames={progressionRaw?.exerciseNames}
              goal={progressionRaw?.goal}
            />
          )}
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
                        <span className="text-3xl font-bold text-surface-100">{strengthProfile.overallScore}</span>
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
                          <p className="text-lg font-bold text-surface-100">{strengthProfile.balanceScore}%</p>
                        </div>
                        <div className="p-2 bg-surface-900/50 rounded-lg">
                          <p className="text-xs text-surface-500">FFMI</p>
                          <p className="text-lg font-bold text-surface-100">{strengthProfile.bodyComposition.ffmi.toFixed(1)}</p>
                        </div>
                        <div className="p-2 bg-surface-900/50 rounded-lg">
                          <p className="text-xs text-surface-500">Lean Mass</p>
                          <p className="text-lg font-bold text-surface-100">{displayWeight(strengthProfile.bodyComposition.leanMassKg)} {weightUnit}</p>
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
          {analyticsStatus === 'error' ? (
            // A failed fetch must never render as authoritative emptiness —
            // stale/absent data gets an explicit retry, not "No workout data".
            <Card>
              <ErrorRetry
                title="Couldn't load volume data"
                message="Your workouts are safe — we just couldn't load them right now. Check your connection and try again."
                onRetry={() => setAnalyticsRetryNonce((n) => n + 1)}
                isRetrying={false}
              />
            </Card>
          ) : analyticsStatus === 'loading' && !analytics ? (
            // First load only — a range switch keeps the previous range's data
            // on screen until the new result lands (cached-first doctrine).
            <div className="space-y-6" data-testid="volume-tab-loading">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-20 animate-pulse bg-surface-800 rounded-xl" />
                ))}
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="h-64 animate-pulse bg-surface-800 rounded-xl" />
                <div className="h-64 animate-pulse bg-surface-800 rounded-xl" />
              </div>
            </div>
          ) : analytics && analytics.totalWorkouts > 0 ? (
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
                    {(() => {
                      const vol = units === 'lb' ? kgToLbs(analytics.totalVolume) : analytics.totalVolume;
                      const unitLabel = units === 'lb' ? 'lbs' : 'kg';
                      return vol >= 1000 ? `${(vol / 1000).toFixed(1)}k ${unitLabel}` : `${Math.round(vol)} ${unitLabel}`;
                    })()}
                  </p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-surface-500 uppercase tracking-wider">Avg Duration</p>
                  <p className="text-2xl font-bold text-primary-400 mt-1">
                    {formatWorkoutDuration(analytics.avgWorkoutDuration)}
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
                    <div className="flex items-center justify-between">
                      <CardTitle>Volume by Muscle Group</CardTitle>
                      <span className="text-xs text-surface-500">Click to expand</span>
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      Showing {getTimeRangeLabel(timeRange)} • Target = optimal sets for this period
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {analytics.weeklyMuscleVolume.slice(0, 10).map((muscle) => {
                        const maxSets = Math.max(...analytics.weeklyMuscleVolume.map(m => m.sets));
                        const percentage = maxSets > 0 ? (muscle.sets / maxSets) * 100 : 0;
                        const weeklyOptimal = OPTIMAL_WEEKLY_VOLUME[userProfile?.experience || 'intermediate'][muscle.muscle] || 12;
                        const weeksMultiplier = getWeeksInRange(timeRange);
                        const optimalSets = Math.round(weeklyOptimal * weeksMultiplier);
                        const volumeStatus = muscle.sets >= optimalSets ? 'optimal' : muscle.sets >= optimalSets * 0.7 ? 'good' : 'low';
                        const isExpanded = expandedMuscles.has(muscle.muscle);

                        return (
                          <div key={muscle.muscle}>
                            <button
                              onClick={() => {
                                const newExpanded = new Set(expandedMuscles);
                                if (isExpanded) {
                                  newExpanded.delete(muscle.muscle);
                                } else {
                                  newExpanded.add(muscle.muscle);
                                }
                                setExpandedMuscles(newExpanded);
                              }}
                              className="w-full text-left cursor-pointer"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <svg 
                                    className={`w-4 h-4 text-surface-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  <span className="text-sm font-medium text-surface-200 capitalize">{muscle.muscle}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                                    volumeStatus === 'optimal' ? 'bg-success-500/20 text-success-400' :
                                    volumeStatus === 'good' ? 'bg-warning-500/20 text-warning-400' :
                                    'bg-surface-700 text-surface-400'
                                  }`}>
                                    {muscle.sets}/{optimalSets}
                                  </span>
                                  <span className="text-sm text-surface-400">{muscle.sets} sets</span>
                                </div>
                              </div>
                              <div className="h-2 bg-surface-800 rounded-full overflow-hidden relative pointer-events-none">
                                {/* Optimal target marker */}
                                <div
                                  className="absolute top-0 bottom-0 w-0.5 bg-success-500/50"
                                  style={{ left: `${Math.min((optimalSets / maxSets) * 100, 100)}%` }}
                                />
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    volumeStatus === 'optimal' ? 'bg-gradient-to-r from-success-500 to-success-400' :
                                    volumeStatus === 'good' ? 'bg-gradient-to-r from-warning-500 to-warning-400' :
                                    'bg-gradient-to-r from-primary-500 to-accent-500'
                                  }`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </button>
                            
                            {/* Expanded exercise details */}
                            {isExpanded && muscle.exercises.length > 0 && (
                              <div className="mt-2 ml-6 pl-3 border-l-2 border-surface-700 space-y-2">
                                {muscle.exercises.map((ex) => (
                                  <Link
                                    key={ex.id}
                                    href={`/dashboard/history?exercise=${ex.id}`}
                                    className="flex items-center justify-between py-1 hover:bg-surface-800/50 rounded px-2 -mx-2 transition-colors"
                                  >
                                    <span className="text-xs text-surface-300">{ex.name}</span>
                                    <div className="flex items-center gap-3 text-xs">
                                      <span className="text-surface-500">{ex.sets} sets</span>
                                      <span className="text-primary-400 font-medium">
                                        {formatWeight(ex.bestE1RM, units)} E1RM
                                      </span>
                                    </div>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Top Exercises */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Top Exercises</CardTitle>
                      <div className="flex gap-1 p-0.5 bg-surface-800 rounded-lg">
                        <button
                          onClick={() => setStrengthViewMode('absolute')}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            strengthViewMode === 'absolute' 
                              ? 'bg-primary-500 text-white' 
                              : 'text-surface-400 hover:text-surface-200'
                          }`}
                        >
                          By E1RM
                        </button>
                        <button
                          onClick={() => setStrengthViewMode('relative')}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            strengthViewMode === 'relative' 
                              ? 'bg-primary-500 text-white' 
                              : 'text-surface-400 hover:text-surface-200'
                          }`}
                        >
                          By Relative
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      {strengthViewMode === 'absolute' 
                        ? 'Ranked by estimated 1RM' 
                        : 'Ranked by relative strength (compounds with reliable data first)'}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {(() => {
                        const userWeight = latestScan?.weightKg || 80; // Default to 80kg if no scan
                        
                        // Helper to get standard - only for exercises with reliable data
                        const getStandard = (name: string): number | null => {
                          // Check exact matches first
                          if (STRENGTH_STANDARDS[name]) return STRENGTH_STANDARDS[name];
                          // Check partial matches
                          const lowerName = name.toLowerCase();
                          for (const [key, value] of Object.entries(STRENGTH_STANDARDS)) {
                            if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
                              return value;
                            }
                          }
                          return null;
                        };

                        // Filter and sort based on view mode
                        let sortedExercises = [...analytics.topExercises];
                        
                        if (strengthViewMode === 'relative') {
                          // Only show exercises with reliable standards in relative mode
                          sortedExercises = sortedExercises.filter(ex => {
                            const standard = getStandard(ex.exerciseName);
                            return standard !== null && hasReliableStandard(ex.exerciseName);
                          });
                        }
                        
                        sortedExercises = sortedExercises.sort((a, b) => {
                          if (strengthViewMode === 'absolute') {
                            return b.estimatedE1RM - a.estimatedE1RM;
                          }
                          // Relative strength
                          const standardA = getStandard(a.exerciseName) || 1;
                          const standardB = getStandard(b.exerciseName) || 1;
                          const relativeA = a.estimatedE1RM / (userWeight * standardA);
                          const relativeB = b.estimatedE1RM / (userWeight * standardB);
                          return relativeB - relativeA;
                        }).slice(0, 10);

                        return sortedExercises.map((exercise, idx) => {
                          const standard = getStandard(exercise.exerciseName);
                          const showGauge = standard !== null && hasReliableStandard(exercise.exerciseName);
                          const expectedE1RM = standard ? userWeight * standard : 0;
                          const relativeStrength = standard ? (exercise.estimatedE1RM / expectedE1RM) * 100 : 0;
                          
                          // Strength level thresholds (% of intermediate standard)
                          const getStrengthLevel = (pct: number) => {
                            if (pct >= 125) return { label: 'Elite', color: 'text-purple-400', bgColor: 'bg-purple-500' };
                            if (pct >= 100) return { label: 'Advanced', color: 'text-success-400', bgColor: 'bg-success-500' };
                            if (pct >= 75) return { label: 'Intermediate', color: 'text-primary-400', bgColor: 'bg-primary-500' };
                            if (pct >= 50) return { label: 'Novice', color: 'text-warning-400', bgColor: 'bg-warning-500' };
                            return { label: 'Beginner', color: 'text-surface-400', bgColor: 'bg-surface-500' };
                          };
                          
                          const strengthLevel = getStrengthLevel(relativeStrength);
                          const gaugeWidth = Math.min(relativeStrength, 150);
                          
                          return (
                            <Link
                              key={exercise.exerciseId}
                              href={`/dashboard/history?exercise=${exercise.exerciseId}`}
                              className="block p-3 -mx-2 rounded-lg hover:bg-surface-800/50 transition-colors cursor-pointer border border-transparent hover:border-surface-700"
                            >
                              <div className="flex items-start gap-3">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                  idx < 3 ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-800 text-surface-500'
                                }`}>
                                  {idx + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-sm font-medium text-surface-200 truncate">{exercise.exerciseName}</p>
                                    <p className="text-sm font-bold text-primary-400 ml-2">
                                      {formatWeight(exercise.estimatedE1RM, units)}
                                    </p>
                                  </div>
                                  
                                  {/* Relative Strength Gauge - only shown for exercises with reliable data */}
                                  {showGauge && (
                                    <div className="mt-2">
                                      <div className="flex items-center justify-between text-xs mb-1">
                                        <span className={strengthLevel.color}>{strengthLevel.label}</span>
                                        <span className="text-surface-500">
                                          {Math.round(relativeStrength)}% of standard
                                        </span>
                                      </div>
                                      <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden relative">
                                        {/* Tier markers */}
                                        <div className="absolute top-0 bottom-0 left-[33%] w-px bg-surface-600" title="Novice" />
                                        <div className="absolute top-0 bottom-0 left-[50%] w-px bg-surface-600" title="Intermediate" />
                                        <div className="absolute top-0 bottom-0 left-[66%] w-px bg-surface-600" title="Advanced" />
                                        <div className="absolute top-0 bottom-0 left-[83%] w-px bg-surface-600" title="Elite" />
                                        
                                        {/* Progress bar */}
                                        <div
                                          className={`h-full rounded-full transition-all duration-500 ${strengthLevel.bgColor}`}
                                          style={{ width: `${(gaugeWidth / 150) * 100}%` }}
                                        />
                                      </div>
                                      <div className="flex justify-between text-[10px] text-surface-600 mt-0.5">
                                        <span>Beginner</span>
                                        <span>Elite</span>
                                      </div>
                                    </div>
                                  )}
                                  
                                  <div className="flex items-center gap-3 mt-2 text-xs text-surface-500">
                                    <span>Best: {formatWeight(exercise.bestWeight, units)} × {exercise.bestReps}</span>
                                    <span>•</span>
                                    <span>{exercise.totalSets} sets</span>
                                  </div>
                                </div>
                              </div>
                            </Link>
                          );
                        });
                      })()}
                      
                      {/* Show message if no exercises with reliable standards in relative mode */}
                      {strengthViewMode === 'relative' && (() => {
                        const getStandardCheck = (name: string): number | null => {
                          if (STRENGTH_STANDARDS[name]) return STRENGTH_STANDARDS[name];
                          const lowerName = name.toLowerCase();
                          for (const [key, value] of Object.entries(STRENGTH_STANDARDS)) {
                            if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
                              return value;
                            }
                          }
                          return null;
                        };
                        const hasReliable = analytics.topExercises.some(ex => 
                          getStandardCheck(ex.exerciseName) !== null && hasReliableStandard(ex.exerciseName)
                        );
                        if (!hasReliable) {
                          return (
                            <div className="p-4 bg-surface-800/50 rounded-lg text-center">
                              <p className="text-sm text-surface-400">
                                No free-weight compound exercises found in this period.
                              </p>
                              <p className="text-xs text-surface-500 mt-1">
                                Relative strength standards only apply to barbell/dumbbell compounds like Squat, Bench, Deadlift, etc.
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()}
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
                              <span className="text-xs text-surface-500">{formatWorkoutDuration(workout.duration)}</span>
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

      {/* Wellness Tab */}
      {activeTab === 'wellness' && (
        <div className="space-y-6">
          {/* Daily tracking — relocated from the home dashboard (Phase 3.3) */}
          {userId && (
            <div className="space-y-3">
              <h2 className="text-[15px] font-medium text-surface-100">Daily tracking</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <MuscleRecoveryCard />
                <ActivityCard userId={userId} />
                <HydrationTracker userId={userId} unit={units === 'kg' ? 'ml' : 'oz'} />
                <Card>
                  <CardHeader>
                    <CardTitle>Cardio Log</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardioTracker userId={userId} />
                  </CardContent>
                </Card>
                {/* BodyTargets (the goal editor) moved to the Goals tab —
                    it was unfindable here under Wellness daily tracking. */}
              </div>
            </div>
          )}

          {/* Hydration Graph */}
          <Card>
            <CardHeader>
              <CardTitle>Hydration</CardTitle>
              <p className="text-xs text-surface-500 mt-1">Daily water intake (ml)</p>
            </CardHeader>
            <CardContent>
              {hydrationData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={hydrationData}>
                    <defs>
                      <linearGradient id="hydrationGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="date"
                      stroke="#9ca3af"
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return `${date.getMonth() + 1}/${date.getDate()}`;
                      }}
                    />
                    <YAxis
                      stroke="#9ca3af"
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                      label={{ value: 'ml', angle: -90, position: 'insideLeft', fill: '#9ca3af' }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      labelFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      }}
                      formatter={(value: number) => [`${value.toFixed(0)} ml`, 'Water Intake']}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalMl"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#hydrationGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12">
                  <p className="text-surface-400">No hydration data for this period</p>
                  <p className="text-sm text-surface-500 mt-1">Start logging your water intake to see trends</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cardio Graph */}
          <Card>
            <CardHeader>
              <CardTitle>Cardio</CardTitle>
              <p className="text-xs text-surface-500 mt-1">Daily cardio minutes</p>
            </CardHeader>
            <CardContent>
              {cardioData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={cardioData}>
                    <defs>
                      <linearGradient id="cardioGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="date"
                      stroke="#9ca3af"
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return `${date.getMonth() + 1}/${date.getDate()}`;
                      }}
                    />
                    <YAxis
                      stroke="#9ca3af"
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                      label={{ value: 'minutes', angle: -90, position: 'insideLeft', fill: '#9ca3af' }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      labelFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      }}
                      formatter={(value: number, payload: any) => {
                        const modality = payload?.modality || 'unknown';
                        return [`${value} min (${modality.replace('_', ' ')})`, 'Cardio'];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalMinutes"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#cardioGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12">
                  <p className="text-surface-400">No cardio data for this period</p>
                  <p className="text-sm text-surface-500 mt-1">Start logging your cardio sessions to see trends</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily Check-In Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sleep Hours */}
            <Card>
              <CardHeader>
                <CardTitle>Sleep Hours</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Hours of sleep per night</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.sleepHours !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.sleepHours !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[0, 12]}
                        label={{ value: 'hours', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value.toFixed(1)} hours`, 'Sleep']}
                      />
                      <ReferenceLine y={7} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Target', position: 'right', fill: '#10b981' }} />
                      <Line type="monotone" dataKey="sleepHours" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No sleep data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sleep Quality */}
            <Card>
              <CardHeader>
                <CardTitle>Sleep Quality</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.sleepQuality !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.sleepQuality !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Quality']}
                      />
                      <Line type="monotone" dataKey="sleepQuality" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No sleep quality data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Energy Level */}
            <Card>
              <CardHeader>
                <CardTitle>Energy Level</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.energyLevel !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.energyLevel !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Energy']}
                      />
                      <Line type="monotone" dataKey="energyLevel" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No energy data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Mood Rating */}
            <Card>
              <CardHeader>
                <CardTitle>Mood</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.moodRating !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.moodRating !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Mood']}
                      />
                      <Line type="monotone" dataKey="moodRating" stroke="#ec4899" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No mood data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Focus Rating */}
            <Card>
              <CardHeader>
                <CardTitle>Focus</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.focusRating !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.focusRating !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Focus']}
                      />
                      <Line type="monotone" dataKey="focusRating" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No focus data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Libido Rating */}
            <Card>
              <CardHeader>
                <CardTitle>Libido</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.libidoRating !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.libidoRating !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Libido']}
                      />
                      <Line type="monotone" dataKey="libidoRating" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No libido data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stress Level */}
            <Card>
              <CardHeader>
                <CardTitle>Stress Level</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5, lower is better)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.stressLevel !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.stressLevel !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        reversed
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Stress']}
                      />
                      <Line type="monotone" dataKey="stressLevel" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No stress data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Soreness Level */}
            <Card>
              <CardHeader>
                <CardTitle>Muscle Soreness</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5, lower is better)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.sorenessLevel !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.sorenessLevel !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        reversed
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Soreness']}
                      />
                      <Line type="monotone" dataKey="sorenessLevel" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No soreness data</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Hunger Level */}
            <Card>
              <CardHeader>
                <CardTitle>Hunger Level</CardTitle>
                <p className="text-xs text-surface-500 mt-1">Rating (1-5, lower is better)</p>
              </CardHeader>
              <CardContent>
                {checkInData.filter(d => d.hungerLevel !== null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={checkInData.filter(d => d.hungerLevel !== null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={[1, 5]}
                        reversed
                        label={{ value: 'rating', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                        formatter={(value: number) => [`${value}/5`, 'Hunger']}
                      />
                      <Line type="monotone" dataKey="hungerLevel" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-surface-500">No hunger data</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Unified "Log body data" sheet (weight / measurements / DEXA) —
          the same sheet the Home Weight tile opens */}
      {logSegment && (
        <LogBodyDataSheet
          isOpen
          onClose={() => setLogSegment(null)}
          initialSegment={logSegment}
          preferredUnit={units}
          onSaved={handleBodyDataSaved}
        />
      )}
    </div>
  );
}

// useSearchParams (deep-linkable ?tab=/&section=) requires a Suspense
// boundary for the static prerender pass — the fallback matches the page's
// own loading state so nothing visibly changes.
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<FullPageLoading text="Loading your analytics..." type="heartbeat" />}>
      <AnalyticsPageContent />
    </Suspense>
  );
}

// Muscle Priorities Display Component (read-only for analytics)
function MusclePrioritiesDisplay({ userId }: { userId: string }) {
  const { priorities, isLoading } = useMusclePriorities(userId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Muscle Group Priorities</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-surface-400 text-sm">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  // Group priorities by level
  const highPriority = priorities.filter(p => p.priority <= 2);
  const normalPriority = priorities.filter(p => p.priority === 3);
  const lowPriority = priorities.filter(p => p.priority >= 4);

  // Check if user has set custom priorities (not all default priority 3)
  const hasCustomPriorities = priorities.length > 0 && !priorities.every(p => p.priority === 3);

  const PRIORITY_LABELS: Record<number, string> = {
    1: 'High Priority',
    2: 'Focus',
    3: 'Normal',
    4: 'Maintenance',
    5: 'Low Priority',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Muscle Group Priorities</span>
          <Link href="/dashboard/settings">
            <Button variant="ghost" size="sm">Edit in Settings</Button>
          </Link>
        </CardTitle>
        <p className="text-sm text-surface-400 mt-1">
          These priorities influence volume allocation in program generation
        </p>
      </CardHeader>
      <CardContent>
        {!hasCustomPriorities ? (
          <div className="text-center py-4">
            <p className="text-surface-400 text-sm mb-2">No custom priorities set</p>
            <p className="text-xs text-surface-500 mb-3">
              All muscle groups are set to normal priority (3). Set custom priorities in Settings to influence program generation.
            </p>
            <Link href="/dashboard/settings">
              <Button variant="outline" size="sm">Go to Settings</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {highPriority.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-surface-400 mb-2 uppercase tracking-wide">
                High Priority ({highPriority.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {highPriority.map((p) => (
                  <Badge
                    key={p.muscleGroup}
                    variant="info"
                    size="sm"
                  >
                    {getMuscleDisplayName(p.muscleGroup)} ({PRIORITY_LABELS[p.priority]})
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {normalPriority.length > 0 && normalPriority.length < priorities.length && (
            <div>
              <h4 className="text-xs font-medium text-surface-400 mb-2 uppercase tracking-wide">
                Normal Priority ({normalPriority.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {normalPriority.map((p) => (
                  <Badge
                    key={p.muscleGroup}
                    variant="default"
                    size="sm"
                  >
                    {getMuscleDisplayName(p.muscleGroup)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {lowPriority.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-surface-400 mb-2 uppercase tracking-wide">
                Low Priority ({lowPriority.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {lowPriority.map((p) => (
                  <Badge
                    key={p.muscleGroup}
                    variant="outline"
                    size="sm"
                  >
                    {getMuscleDisplayName(p.muscleGroup)} ({PRIORITY_LABELS[p.priority]})
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {priorities.some(p => p.reason) && (
            <div className="pt-3 border-t border-surface-800">
              <h4 className="text-xs font-medium text-surface-400 mb-2">Notes</h4>
              <div className="space-y-1">
                {priorities
                  .filter(p => p.reason)
                  .map((p) => (
                    <div key={p.muscleGroup} className="text-xs text-surface-400">
                      <span className="font-medium text-surface-300">{getMuscleDisplayName(p.muscleGroup)}:</span>{' '}
                      {p.reason}
                    </div>
                  ))}
              </div>
            </div>
          )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

