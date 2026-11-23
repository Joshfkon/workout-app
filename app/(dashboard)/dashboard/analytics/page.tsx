'use client';

import { IconActivityHeartbeat, IconAlertTriangle, IconBarbell, IconChartBar } from '@tabler/icons-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useQuery, useQueryClient, useIsRestoring } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, FullPageLoading, ErrorRetry, PageHeader, LoadingState, Sheet, ListGroup, ListRow, InfoTooltip } from '@/components/ui';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { resolveAuthState } from '@/lib/supabase/authState';
import { useMusclePriorities } from '@/components/settings/MusclePrioritySettings';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import type { DexaScan, Goal, Experience, FFMIResult, ProgressPhoto, MuscleGroup, StandardMuscleGroup } from '@/types/schema';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import {
  selectCanonicalFfmi,
  generateCoachingRecommendations,
} from '@/services/bodyCompEngine';
import { useBodyCompTrend } from '@/hooks/useBodyCompTrend';
import { useTrainingPhases } from '@/hooks/useTrainingPhases';
import { assessProgress } from '@/services/phaseAssessment';
import { PhaseVerdictCard } from '@/components/body/PhaseVerdictCard';
import { PhaseBanner } from '@/components/body/PhaseBanner';
import { localDay } from '@/lib/date/localDay';
import { getDisplayWeight } from '@/lib/weightUtils';
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
import { kgToLbs, inputWeightToKg, roundToIncrement, getLocalDateString, muscleDisplayName, cmToIn, inToCm } from '@/lib/utils';
import { e1rmValueFromRpe } from '@/services/shared/e1rm';
import {
  computeWaistTrend,
  latestWaistTrendIn,
  computePartitionAnchor,
  resolvePartition,
  type ResolvedPartition,
} from '@/services/waistTrend';
// All charts now render from extracted components (BodyHubTrends,
// WellnessTrendsCard, ProportionsTargetsCard) — no inline Recharts here.
import type { Mesocycle, BodyCompositionTarget, ExercisePerformanceSnapshot } from '@/types/schema';
import type { EnhancedProportionsAnalysis } from '@/services/bodyProportionsAnalytics';
import { analyzeEnhancedProportions } from '@/services/bodyProportionsAnalytics';
import { analyzeAllExercises, type PlateauDetectionResult, type PlateauGoal } from '@/services/plateauDetector';
import { PlateauAlertList } from '@/components/analytics/PlateauAlert';
import { getMuscleGroupProgression } from '@/services/progressionInsights';
import { MuscleProgressionCard } from '@/components/analytics/MuscleProgressionCard';
import { CalibrateStrengthPrompt, calibratePromptMode } from '@/components/analytics/CalibrateStrengthPrompt';
import { ProportionsTargetsCard } from '@/components/analytics/ProportionsTargetsCard';
import { WellnessTrendsCard } from '@/components/analytics/WellnessTrendsCard';
import { BodyHubTrends } from '@/components/body/BodyHubTrends';
import { BodyHubNudges } from '@/components/body/BodyHubNudges';
import { BodyAddMoreData } from '@/components/body/BodyAddMoreData';
import { MeasurementTrendCard } from '@/components/body/MeasurementTrendCard';
import type { BodyLogSegment } from '@/components/body/LogBodyDataSheet';
import { LiftTrendsCard } from '@/components/analytics/LiftTrendsCard';
import { ProgressPhotosHero } from '@/components/analytics/ProgressPhotosHero';
import { ComparePhotos } from '@/components/progress-photos/ComparePhotos';
import { TimelapseModal } from '@/components/progress-photos/TimelapseModal';
import { AddPhotoModal } from '@/components/progress-photos/AddPhotoModal';
import { useLiftTrends } from '@/hooks/useLiftTrends';
import { useBodyOrFoodLogged } from '@/hooks/useBodyOrFoodLogged';
import {
  hasRecentLifting,
  orderProgressTabs,
  parseProgressTabParam,
  resolveActiveProgressTab,
  resolveDefaultProgressTab,
  type ProgressTab,
} from './progressTabs';
import { buildProgressSummary } from './progressSummary';
import { now as clockNow } from '@/lib/clock';
import { ONBOARDING_BENCHMARKS_ENTRY } from '@/lib/onboarding/trackingFocus';
import { listOutbox } from '@/lib/offline/setOutbox';
import {
  rangeStartLocalDay,
  pendingCompletionsFromOutbox,
  pendingSetsFromOutbox,
  mergeLocalPendingWorkouts,
  type RawWorkoutSession,
} from '@/services/volumeTrendsData';
// Dynamic imports for heavy chart components - only loaded when needed
const LogBodyDataSheet = dynamic(
  () => import('@/components/body/LogBodyDataSheet').then(m => m.LogBodyDataSheet),
  { ssr: false }
);

// Body composition chart
const BodyCompChart = dynamic(
  () => import('@/components/analytics/BodyCompCharts').then(m => m.BodyCompChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-fill rounded" /> }
);

// Wellness charts
const HydrationChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.HydrationChart),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse bg-fill rounded" /> }
);
const CardioChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.CardioChart),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse bg-fill rounded" /> }
);
const SleepHoursChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.SleepHoursChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const SleepQualityChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.SleepQualityChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const EnergyChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.EnergyChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const MoodChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.MoodChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const FocusChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.FocusChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const LibidoChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.LibidoChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const StressChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.StressChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const SorenessChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.SorenessChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);
const HungerChart = dynamic(
  () => import('@/components/analytics/WellnessCharts').then(m => m.HungerChart),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse bg-fill rounded" /> }
);

// Daily tracking cards relocated from the home dashboard (Phase 3.3).
// Self-fetching client components — loaded on demand for the Wellness tab.
const ActivityCard = dynamic(
  () => import('@/components/dashboard/ActivityCard').then(m => m.ActivityCard),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-fill rounded-xl" /> }
);
const HydrationTracker = dynamic(
  () => import('@/components/dashboard/HydrationTracker').then(m => m.HydrationTracker),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-fill rounded-xl" /> }
);
const BodyTargets = dynamic(
  () => import('@/components/dashboard/BodyTargets').then(m => m.BodyTargets),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-fill rounded-xl" /> }
);
const BloodPressureCard = dynamic(
  () => import('@/components/dashboard/BloodPressureCard').then(m => m.BloodPressureCard),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-fill rounded-xl" /> }
);

// Tab types. Down to three: Goals dissolved into Body (targets editor +
// projections) and the Training tab was removed — its workout totals, volume
// vs targets, and recent-workout content all live on the Train page.
// Valid ?tab= values and the default-tab rule live in ./progressTabs, so any
// surface (home tiles, notifications, weekly summary) can deep-link a tab,
// e.g. /dashboard/analytics?tab=strength&section=lift-trends.
type TabType = ProgressTab;

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

// Helper function for percentile bars
function PercentileBar({ percentile, label, showValue = true }: { percentile: number; label: string; showValue?: boolean }) {
  const segments = generatePercentileSegments(percentile);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-caption text-ink-2">
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

/**
 * Read every row of a query, newest first, in PostgREST-sized pages.
 *
 * A plain select is capped by the API's max-rows (1000 by default) with no
 * error, so a long range silently lost rows — and with ascending order it
 * lost the newest ones. `buildPage` must order DESCENDING (with a unique
 * tiebreak if the sort column isn't unique) and apply `.range(from, to)`.
 * Returns null when the first page fails (callers treat that as "leave the
 * chart as it is"); the page cap bounds a pathological history, and because
 * the order is newest-first anything cut is the oldest data.
 */
const WELLNESS_PAGE_SIZE = 1000;
const WELLNESS_MAX_PAGES = 10;
async function fetchAllRowsNewestFirst(
  buildPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>
): Promise<any[] | null> {
  const all: any[] = [];
  for (let page = 0; page < WELLNESS_MAX_PAGES; page++) {
    const from = page * WELLNESS_PAGE_SIZE;
    const { data, error } = await buildPage(from, from + WELLNESS_PAGE_SIZE - 1);
    if (error || !data) return page === 0 ? null : all;
    all.push(...data);
    if (data.length < WELLNESS_PAGE_SIZE) break;
  }
  return all;
}

function AnalyticsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { preferences } = useUserPreferences();
  // Tab precedence (./progressTabs): a tab the user tapped, then the ?tab=
  // deep link, then the data-driven default, then Strength.
  const explicitTab = parseProgressTabParam(searchParams.get('tab'));
  const [pickedTab, setPickedTab] = useState<TabType | null>(null);
  const sectionParam = searchParams.get('section');
  const [showPlateauIdeas, setShowPlateauIdeas] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Follow URL changes (back/forward, in-app deep links to another tab): a
  // new URL drops the tapped tab so the param (or, with no param, the
  // default) applies — a base-route navigation (e.g. the Progress nav item)
  // must reset a previously deep-linked tab.
  useEffect(() => {
    setPickedTab(null);
  }, [searchParams]);

  const handleTabChange = (tab: TabType) => {
    // Local state only — deliberately NO URL write. Changing the ?tab= search
    // param remounts page.tsx (the App Router keys the page segment by its
    // search params; history.replaceState sync included), and a remount
    // re-runs every fetch on the page. Deep links IN (?tab=...) keep working
    // via the searchParams read above; the param just doesn't track
    // subsequent taps.
    setPickedTab(tab);
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
  // Progress photos modals (for the hero on Body tab)
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isTimelapseOpen, setIsTimelapseOpen] = useState(false);
  const [isAddPhotoOpen, setIsAddPhotoOpen] = useState(false);

  // DEXA-anchored body comp trend — the single source for both the trend
  // chart (BodyHubTrends) and the FFMI gauge, so they can never disagree.
  const {
    trend: bodyCompTrend,
    weightHistory: bodyWeightHistory,
    waistHistory: bodyWaistHistory,
    isLoading: isBodyTrendLoading,
  } = useBodyCompTrend(bodyRefreshKey);

  // Training phases (bulk/cut/recomp/maintenance spans) — drive the verdict
  // card, the phase banner, and the trend chart's background bands.
  const { phases: trainingPhases, current: currentPhase } = useTrainingPhases();

  // Goals tab state
  const [activeMesocycle, setActiveMesocycle] = useState<Mesocycle | null>(null);
  const [activeTarget, setActiveTarget] = useState<BodyCompositionTarget | null>(null);
  // The goals editor card shows once a goal exists, when the user asks for
  // it ("Edit goals" / "Set body goals"), or on a ?section=body-targets deep
  // link (the Composition Map's "Set a target"). An empty goals card is not
  // rendered by default — it was setup noise on the Body tab.
  const [goalsEditorOpened, setGoalsEditorOpened] = useState(false);
  const [goalsScrollRequest, setGoalsScrollRequest] = useState(0);
  const showGoalsEditor =
    goalsEditorOpened || activeTarget != null || sectionParam === 'body-targets';
  const openGoalsEditor = () => {
    setGoalsEditorOpened(true);
    setGoalsScrollRequest((n) => n + 1);
  };
  useEffect(() => {
    if (goalsScrollRequest === 0) return;
    document
      .getElementById('body-targets')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [goalsScrollRequest]);
  const [weightHistory, setWeightHistory] = useState<Array<{ date: string; weightKg: number }>>([]);
  const [currentMeasurements, setCurrentMeasurements] = useState<Record<string, number>>({});
  // Observed-vs-assumed lean/fat partition for the projection, from the waist
  // trend when there is enough data (else the fixed assumption).
  const [partition, setPartition] = useState<ResolvedPartition | undefined>(undefined);
  const [proportionsAnalysis, setProportionsAnalysis] = useState<EnhancedProportionsAnalysis | null>(null);

  // Strength state
  const [strengthProfile, setStrengthProfile] = useState<StrengthProfile | null>(null);
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [userId, setUserId] = useState<string | null>(null);
  // Per-lift trend breakdown behind the home "Lifts" tile (shared function +
  // identical query window, so the tile aggregate and this detail agree).
  // Shared React Query cache with the single-lift screen (hooks/useLiftTrends).
  const liftTrendsQuery = useLiftTrends();
  const liftTrendsSummary = liftTrendsQuery.data ?? null;

  // Data-driven default tab. Both signals are persisted React Query reads,
  // so a revisit decides on first paint from cache; nothing blocks render —
  // until they resolve the page shows Strength (the fallback). Once decided
  // the default is locked for this mount so a background refetch never
  // flips the tab under the user.
  const bodyOrFoodLogged = useBodyOrFoodLogged().data;
  const dataDefaultTab = resolveDefaultProgressTab({
    hasRecentLifting: hasRecentLifting(liftTrendsQuery.data),
    hasBodyOrFoodData:
      bodyWeightHistory.length > 0 ? true : bodyOrFoodLogged ?? undefined,
  });
  const [lockedDefaultTab, setLockedDefaultTab] = useState<TabType | null>(null);
  useEffect(() => {
    if (lockedDefaultTab === null && dataDefaultTab !== null) {
      setLockedDefaultTab(dataDefaultTab);
    }
  }, [lockedDefaultTab, dataDefaultTab]);
  const activeTab = resolveActiveProgressTab({
    pickedTab,
    explicitTab,
    dataDefaultTab: lockedDefaultTab ?? dataDefaultTab,
  });

  // Per-time-range result cache (P1-2) — lives for the page's lifetime.
  const analyticsRangeCacheRef = useRef(
    new Map<string, { plateauAlerts: Array<{ exerciseId: string; exerciseName: string; result: PlateauDetectionResult }>; progressionRaw: ProgressionRawData | null }>()
  );
  const [plateauAlerts, setPlateauAlerts] = useState<Array<{ exerciseId: string; exerciseName: string; result: PlateauDetectionResult }>>([]);
  // Raw inputs for the muscle-group progression card. Classification happens
  // in a render-side memo so it re-runs when the user profile (experience)
  // finishes loading, without refetching workout data.
  const [progressionRaw, setProgressionRaw] = useState<ProgressionRawData | null>(null);

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
  const displayWeightString = (kg: number) => {
    const value = displayWeight(kg);
    return units === 'lb' ? `${value.toFixed(1)} lbs` : `${value.toFixed(1)} kg`;
  };
  const weightUnit = units === 'lb' ? 'lbs' : 'kg';

  // Load photo URLs
  useEffect(() => {
    async function loadPhotoUrls() {
      if (progressPhotos.length === 0) return;
      
      const supabase = createUntypedClient();
      const urls: Record<string, string> = {};

      // One batched request instead of a sequential round trip per photo.
      const withPath = progressPhotos.filter((photo) => !!photo.photoUrl);
      if (withPath.length === 0) return;
      const { data } = await supabase.storage
        .from('progress-photos')
        .createSignedUrls(withPath.map((photo) => photo.photoUrl), 3600);

      const signedByPath = new Map<string, string>();
      for (const entry of (data ?? []) as { path?: string | null; signedUrl?: string | null }[]) {
        if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
      }
      for (const photo of withPath) {
        const signed = signedByPath.get(photo.photoUrl as string);
        if (signed) urls[photo.id] = signed;
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
          .maybeSingle(),
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
      // A failed read must fail the query (→ the retryable error state below),
      // never be cached — and persisted — as "no DEXA scans / no photos".
      // The coaching-session read stays best-effort: it only feeds the
      // optional calibration card.
      for (const result of [profileResult, scanResult, photoResult]) {
        if (result.error) throw result.error;
      }
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

  // Deep-link scroll target (?section=lift-trends / muscle-progression):
  // retried as each section's data lands (they arrive from separate fetches)
  // so a cold load still ends up anchored on the right card.
  useEffect(() => {
    if (!sectionParam || isLoading) return;
    const el = document.getElementById(sectionParam);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sectionParam, activeTab, isLoading, liftTrendsSummary, progressionRaw]);

  // Fetch goals tab data (mesocycle, targets, weight history, measurements).
  // Keyed on bodyRefreshKey so a save from the unified log sheet (the header
  // "Log measurements" button, weight, DEXA) refreshes currentMeasurements /
  // proportionsAnalysis / weightHistory — the sheet is the primary entry path
  // now that the inline measurements card is gone.
  useEffect(() => {
    async function fetchGoalsData() {
      if (!userId) return;

      const supabase = createUntypedClient();

      try {
        // Fetch active mesocycle, active body composition target, weight history, and measurements in parallel
        const [mesocycleResult, targetResult, weighInsResult, measurementsResult, waistHistoryResult] = await Promise.all([
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
          // Weight history for the projection. The table is `weight_log`
          // (columns logged_at, weight, unit) — the SAME source Home's weight
          // trend and the Body-tab chart read. The prior query hit a
          // nonexistent `weigh_ins`/`weight_kg`, silently returned null, and
          // the projection always showed "Add more weigh-ins".
          supabase
            .from('weight_log')
            .select('logged_at, weight, unit')
            .eq('user_id', userId)
            .gte('logged_at', getLocalDateString(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)))
            .order('logged_at', { ascending: true }),
          // Recent body measurements. Entries are sparse per-row (a waist-only
          // log leaves every other column NULL), so fetch a batch and coalesce
          // the latest non-null value per site below — a single latest row
          // would blank out "How you compare" whenever the newest entry only
          // logged one site.
          supabase
            .from('body_measurements')
            .select('*')
            .eq('user_id', userId)
            .order('logged_at', { ascending: false })
            .limit(30),
          // Waist history (cm) for the EWMA trend → proportions denoise +
          // partition anchor. 90 days covers the trailing window with margin.
          supabase
            .from('body_measurements')
            .select('logged_at, waist')
            .eq('user_id', userId)
            .not('waist', 'is', null)
            .gte('logged_at', getLocalDateString(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)))
            .order('logged_at', { ascending: true }),
        ]);

        // Waist EWMA trend (inches internally; the 1.5" outlier guard lives in
        // the service). Drives BOTH the proportions denoise and the partition
        // anchor below.
        const waistRows = (waistHistoryResult.data ?? []) as Array<{ logged_at: string; waist: number | null }>;
        const waistTrendPoints = computeWaistTrend(
          waistRows
            .filter((r) => r.waist != null)
            .map((r) => ({ date: r.logged_at, waistIn: cmToIn(Number(r.waist)) }))
        );
        const trendWaistIn = latestWaistTrendIn(waistTrendPoints);
        const trendWaistCm = trendWaistIn != null ? inToCm(trendWaistIn) : null;

        // Partition anchor: waist trend vs weight trend (lb) over the window.
        const weightLbEntries = ((weighInsResult.data ?? []) as Array<{ logged_at: string; weight: number; unit: 'lb' | 'kg' | null }>).map(
          (w) => ({ date: w.logged_at, weightLb: kgToLbs(inputWeightToKg(w.weight, w.unit ?? 'lb')) })
        );
        const anchor = computePartitionAnchor({
          waist: waistRows
            .filter((r) => r.waist != null)
            .map((r) => ({ date: r.logged_at, waistIn: cmToIn(Number(r.waist)) })),
          weight: weightLbEntries,
        });
        // Fixed fallback = 40% of a gain is lean (the base gain assumption in
        // lib/body-composition/p-ratio predictWeightGainComposition).
        setPartition(resolvePartition(anchor, 0.4));

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
            scheduleMode: meso.schedule_mode || null,
            preferredWorkoutDays: meso.preferred_workout_days || null,
            trainingIntervalDays: meso.training_interval_days ?? null,
            sessionsPerDay: meso.sessions_per_day ?? null,
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

        // Process weight history. Weight is stored in the logged unit — convert
        // to kg (inputWeightToKg), the same conversion useBodyCompTrend uses.
        if (weighInsResult.data && weighInsResult.data.length > 0) {
          setWeightHistory(
            weighInsResult.data.map((w: { logged_at: string; weight: number; unit: 'lb' | 'kg' | null }) => ({
              date: w.logged_at,
              weightKg: inputWeightToKg(w.weight, w.unit ?? 'lb'),
            }))
          );
        }

        // Process measurements and calculate proportions
        if (measurementsResult.data && measurementsResult.data.length > 0) {
          // Coalesce: rows come newest-first, and each row only carries the
          // sites logged that day. Take the most recent non-null value per
          // site so a waist-only entry doesn't hide the chest/arms/etc.
          // logged in earlier entries.
          const rows = measurementsResult.data as Array<Record<string, unknown>>;
          const latestNonNull = (column: string): number | undefined => {
            for (const row of rows) {
              const v = row[column];
              if (typeof v === 'number' && Number.isFinite(v)) return v;
            }
            return undefined;
          };
          const measurements: Record<string, number> = {};

          const coalesced: Array<[string, string]> = [
            ['neck', 'neck'],
            ['shoulders', 'shoulders'],
            ['chest', 'chest'],
            ['upperBack', 'upper_back'],
            ['lowerBack', 'lower_back'],
            ['leftBicep', 'left_bicep'],
            ['rightBicep', 'right_bicep'],
            ['leftForearm', 'left_forearm'],
            ['rightForearm', 'right_forearm'],
            ['hips', 'hips'],
            ['leftThigh', 'left_thigh'],
            ['rightThigh', 'right_thigh'],
            ['leftCalf', 'left_calf'],
            ['rightCalf', 'right_calf'],
          ];
          for (const [key, column] of coalesced) {
            const value = latestNonNull(column);
            if (value != null) measurements[key] = value;
          }
          // Proportions read the waist EWMA TREND (denoised), not the last raw
          // entry — daily waist is noisy and a stale single reading skews the
          // shoulder-to-waist ratio. Falls back to the latest raw value when
          // there is no trend yet.
          const rawWaist = latestNonNull('waist');
          if (trendWaistCm != null) measurements.waist = Math.round(trendWaistCm * 10) / 10;
          else if (rawWaist != null) measurements.waist = rawWaist;

          setCurrentMeasurements(measurements);

          // Calculate proportions analysis if we have height. Partial sets
          // are fine — benchmarks/ratios each skip sites that are missing —
          // so any logged site is enough to show something.
          if (userProfile?.heightCm && Object.keys(measurements).length > 0) {
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
  }, [userId, userProfile?.heightCm, bodyRefreshKey]);

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
        // The three reads are independent — run them together. Each is paged
        // newest-first (see fetchAllRowsNewestFirst): a single ascending
        // select was silently capped at 1000 rows, so on the 6m / 1y / all
        // ranges the NEWEST days were the ones dropped.
        const [hydrationLogs, cardioLogs, checkIns] = await Promise.all([
          fetchAllRowsNewestFirst((from, to) =>
            supabase
              .from('hydration_log')
              .select('logged_at, amount_ml')
              .eq('user_id', userId)
              .gte('logged_at', startDateStr)
              // No `id` tiebreak here: hydration_log has no migration in the
              // repo, so its key column can't be assumed.
              .order('logged_at', { ascending: false })
              .range(from, to)
          ),
          fetchAllRowsNewestFirst((from, to) =>
            supabase
              .from('cardio_log')
              .select('logged_at, minutes, modality')
              .eq('user_id', userId)
              .gte('logged_at', startDateStr)
              .order('logged_at', { ascending: false })
              .order('id', { ascending: false })
              .range(from, to)
          ),
          fetchAllRowsNewestFirst((from, to) =>
            supabase
              .from('daily_check_ins')
              .select('date, sleep_hours, sleep_quality, energy_level, mood_rating, focus_rating, libido_rating, stress_level, soreness_level, hunger_level')
              .eq('user_id', userId)
              .gte('date', startDateStr)
              .order('date', { ascending: false })
              .range(from, to)
          ),
        ]);
        if (cancelled) return;

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

        if (checkIns) {
          // Charts read oldest → newest.
          const transformed = [...checkIns].reverse().map((ci: any) => ({
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

    let cancelled = false;
    fetchWellnessData();
    return () => { cancelled = true; };
  }, [userId, timeRange]);

  // Fetch workout data for the Strength tab's plateau alerts and
  // muscle-progression card. (The Training tab this fetch also fed was
  // removed — its totals/volume/recent-workout views live on the Train page.)
  // P1-2 (perf): results are cached per time range for the page's lifetime —
  // flipping 7d -> 30d -> 7d no longer refetches the whole nested query tree.
  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const cached = analyticsRangeCacheRef.current.get(timeRange);
        if (cached) {
          setPlateauAlerts(cached.plateauAlerts);
          setProgressionRaw(cached.progressionRaw);
          return;
        }

        const supabase = createUntypedClient();
        // Same auth semantics as the main query: only a confirmed signed-out
        // state bails (the main query's effect redirects to /login); a
        // transient verify failure must not be cached as emptiness.
        const auth = await resolveAuthState(supabase);
        if (auth.status !== 'authenticated') return;
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
                    primary_muscle,
                    exercise_type
                  ),
                  set_logs (
                    id,
                    weight_kg,
                    reps,
                    rpe,
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
          // A failed fetch must never be cached as "no data" — bail and let
          // the next mount/range change retry.
          console.error('Failed to fetch analytics:', error ?? pendingError);
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
          setPlateauAlerts([]);
          setProgressionRaw(null);
          analyticsRangeCacheRef.current.set(timeRange, {
            plateauAlerts: [],
            progressionRaw: null,
          });
          return;
        }

        // Per-session snapshots per exercise (for plateau detection), plus
        // each exercise's name and primary muscle (for the progression card).
        const snapshotMap = new Map<string, ExercisePerformanceSnapshot[]>();
        const exerciseNameMap = new Map<string, string>();
        const muscleByExercise = new Map<string, string>();

        workoutSessions.forEach((session: any) => {
          if (session.exercise_blocks) {
            session.exercise_blocks.forEach((block: any) => {
              if (!block.exercises || !block.set_logs) return;

              const muscle = block.exercises.primary_muscle;
              const exerciseId = block.exercises.id;
              const exerciseName = block.exercises.name;

              const workingSets = block.set_logs.filter((s: any) => !s.is_warmup);
              if (muscle) muscleByExercise.set(exerciseId, muscle);

              // Duration exercises carry seconds in reps: no e1RM snapshot, no
              // plateau trend — a stable hold ceiling is not a plateau.
              if (block.exercises.exercise_type === 'duration_based') return;

              // Build a per-session snapshot for this exercise (top set by E1RM)
              // so the plateau detector can analyze E1RM trends over time.
              if (workingSets.length > 0) {
                const sessionDate = getLocalDateString(new Date(session.completed_at));
                let topE1RM = 0;
                let topWeight = 0;
                let topReps = 0;
                workingSets.forEach((set: any) => {
                  const e1rm = e1rmValueFromRpe(set.weight_kg, set.reps, set.rpe);
                  if (e1rm > topE1RM) {
                    topE1RM = e1rm;
                    topWeight = set.weight_kg;
                    topReps = set.reps;
                  }
                });

                exerciseNameMap.set(exerciseId, exerciseName);
                // No estimable set (canonical estimator: >15 effective reps
                // has no e1RM) -> no snapshot; never trend a 0.
                if (topE1RM <= 0) return;
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
                  // topSetRpe is display metadata only; the e1RM above already
                  // consumed the set's logged RPE via the canonical estimator.
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
        const progressionRawResult: ProgressionRawData = {
          snapshotsByExercise: snapshotMap,
          muscleByExercise,
          exerciseNames: exerciseNameMap,
          goal: (goalRow?.goal as PlateauGoal | null) ?? undefined,
        };
        setProgressionRaw(progressionRawResult);

        analyticsRangeCacheRef.current.set(timeRange, {
          plateauAlerts: detectedPlateauAlerts,
          progressionRaw: progressionRawResult,
        });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      }
    }

    fetchAnalytics();
  }, [timeRange]);

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
      // Lifts straddling the current program with too few sessions since it
      // roll up as "calibrating" (no rate) instead of feeding a real-looking
      // %/wk — the same gate liftTrends uses.
      programStartDate: activeMesocycle?.startedAt ?? null,
    });
  }, [progressionRaw, userProfile?.experience, activeMesocycle?.startedAt]);

  // Calculated values
  const latestScan = scans[0];
  // THE canonical FFMI for every surface (Home tile, this Body stat strip +
  // gauge, the Strength card). selectCanonicalFfmi prefers the last point of
  // the DEXA-anchored trend (same series the Body Composition Trend chart
  // plots) and falls back to the latest scan through the same computeFFMI
  // while the trend loads — so the number can never differ between surfaces.
  const latestTrendPoint = bodyCompTrend.length > 0
    ? bodyCompTrend[bodyCompTrend.length - 1]
    : null;
  const ffmiResult = selectCanonicalFfmi({
    trendLastPoint: latestTrendPoint
      ? { leanMassKg: latestTrendPoint.leanMassKg, boneMassKg: latestTrendPoint.boneMassKg }
      : null,
    latestScan: latestScan ?? null,
    heightCm: userProfile?.heightCm,
  });
  // Phase-boundary dates (bulk/cut start) let the recommender suppress
  // composition advice inside the water-weight window — reuse the active
  // target's creation date as the current phase's start.
  const phaseChangeDates = activeTarget?.createdAt
    ? [activeTarget.createdAt.slice(0, 10)]
    : [];

  // Rules-based phase assessment (the Body tab verdict card). Weigh-ins are
  // normalized to lb for the engine; the phase span itself scopes every
  // trend inside assessProgress.
  const assessment = useMemo(
    () =>
      assessProgress({
        phase: currentPhase,
        today: localDay(),
        weighIns: bodyWeightHistory.map((entry) => ({
          date: entry.date.slice(0, 10),
          weightLb: getDisplayWeight(entry.weight, entry.unit, 'lb'),
        })),
        scans,
        waist: bodyWaistHistory,
      }),
    [currentPhase, bodyWeightHistory, scans, bodyWaistHistory]
  );

  // Topics the verdict card already covers (in-phase composition + rate
  // trends). When a real verdict is showing, the same story must not repeat
  // in the Recommendations card below it.
  const verdictCoversTrends =
    assessment.status === 'on_track' ||
    assessment.status === 'attention' ||
    assessment.status === 'off_track';
  const VERDICT_COVERED_TITLES = new Set([
    'Fat Gain Too Fast',
    'Lean Mass Trending Down During Bulk',
    'Muscle Gain Below Expected',
    'Muscle Loss Detected',
    'Successful Recomp',
  ]);
  const allRecommendations = userProfile?.heightCm
    ? generateCoachingRecommendations(
        scans,
        userProfile.heightCm,
        userProfile.goal,
        userProfile.experience,
        {
          weightUnit: units,
          phaseChangeDates,
          activePhase: currentPhase
            ? {
                phaseType: currentPhase.phaseType,
                startDay: currentPhase.startDay,
                endDay: currentPhase.endDay,
              }
            : null,
        }
      )
    : [];
  const recommendations = verdictCoversTrends
    ? allRecommendations.filter((rec) => !VERDICT_COVERED_TITLES.has(rec.title))
    : allRecommendations;

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
    return <div data-testid="analytics-full-loading"><FullPageLoading text="Loading your analytics..." title="Progress" /></div>;
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
      // Advice framing prefers the active training_phases span; users.goal
      // is only the fallback when no span exists (same rule as the
      // recommendations engine's activePhase option).
      phase={currentPhase?.phaseType ?? userProfile?.goal ?? null}
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
      phaseStartDate={currentPhase?.startDay ?? activeTarget?.createdAt ?? null}
      sex={sex}
      experience={userProfile?.experience ?? null}
      onSetTarget={handleSetSuggestedTarget}
      initialMetric={
        sectionParam === BODY_COMP_TREND_SECTION_ID && bodyCompLayout.showCompositionMap
          ? 'map'
          : undefined
      }
      onLogWeight={() => setLogSegment('weight')}
      phaseSpans={trainingPhases.map((p) => ({
        phaseType: p.phaseType,
        startDay: p.startDay,
        endDay: p.endDay,
      }))}
    />
  );

  const TAB_LABELS: Record<TabType, string> = {
    strength: 'Strength',
    'body-composition': 'Body',
    wellness: 'Wellness',
  };
  // A non-lifter (food / weigh-in only) gets Body first, Strength last.
  const tabs = orderProgressTabs(hasRecentLifting(liftTrendsQuery.data)).map((id) => ({
    id: id as TabType,
    label: TAB_LABELS[id],
  }));

  // "Am I progressing?" in one or two plain sentences, above the tabs, so
  // weight and strength are answered together. Only restates the weight
  // chart's 30-day change and the Strength tab's trend counts; waits for
  // the weigh-ins so it doesn't appear half-written.
  const progressSummary = isBodyTrendLoading
    ? null
    : buildProgressSummary({
        weighIns: bodyWeightHistory,
        liftTrends: liftTrendsSummary,
        units: units === 'kg' ? 'kg' : 'lb',
        now: clockNow(),
      });

  // The global time-range selector genuinely scopes only the Wellness data
  // (hydration/cardio/check-in series). On Body and Strength it was a dead
  // control, so it renders only where it applies.
  const rangeAppliesToTab = activeTab === 'wellness';

  const timeRangeSelector = (
    <div className="flex gap-0.5 bg-fill p-0.5 rounded-[10px] flex-wrap" data-testid="analytics-range-selector">
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
          className={`h-7 px-2.5 text-caption rounded-[8px] transition-colors ${
            timeRange === range.value ? 'bg-card text-ink font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.14)]' : 'text-ink-2'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in" data-testid="analytics-content">
      {/* Header. The page title now matches the "Progress" nav label. The
          range selector renders here only on tabs it actually scopes
          (Training / Wellness); Body and Strength carry no dead control. */}
      <PageHeader
        title="Progress"
        actions={rangeAppliesToTab ? <div className="flex gap-2">{timeRangeSelector}</div> : undefined}
      />

      {progressSummary && (
        <div className="rounded-card bg-card p-4 shadow-card" data-testid="progress-summary">
          <p className="text-caption text-ink-2">Are you progressing?</p>
          {progressSummary.weight && (
            <p className="mt-0.5 text-body text-ink" data-testid="progress-summary-weight">{progressSummary.weight}</p>
          )}
          {progressSummary.strength && (
            <p className="mt-0.5 text-body text-ink" data-testid="progress-summary-strength">{progressSummary.strength}</p>
          )}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex rounded-[10px] bg-fill p-0.5" role="tablist" aria-label="Progress sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`analytics-tab-${tab.id}`}
            onClick={() => handleTabChange(tab.id)}
            className={`flex-1 h-9 rounded-[8px] text-subhead text-ink transition-colors ${
              activeTab === tab.id ? 'bg-card font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.14)]' : 'font-medium'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'body-composition' && (
        <div className="space-y-6">
          {/* Body hub front door: Log + Edit goals. Goal-setting moved here
              from the dissolved Goals tab, behind this header action. */}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-headline font-semibold text-ink">Body</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={openGoalsEditor}
              >
                Edit goals
              </Button>
              {/* Measurement entry lives behind this button (the unified log
                  sheet's measurements segment) — the old inline
                  BodyMeasurements compare/entry card was retired. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogSegment('measurements')}
              >
                Log measurements
              </Button>
              <Button size="sm" onClick={() => setLogSegment('weight')}>
                + Log
              </Button>
            </div>
          </div>

          {/* Chart first: the weight trend and its numbers lead the tab —
              that's what people open Body for. With ≥2 body scans the same
              module also carries the composition trend + Composition Map.
              Setup prompts (goal phase, body scan, goals) live in the compact
              "Add more data" list further down, never above the chart. */}
          {bodyTrendModule}

          {/* Phase verdict + banner only once a phase exists — with none,
              the set-one prompt is a row in "Add more data". Tapping either
              opens the phase editor. */}
          {currentPhase && (
            <>
              <PhaseVerdictCard assessment={assessment} href="/dashboard/phases" />
              <PhaseBanner phase={currentPhase} href="/dashboard/phases" />
            </>
          )}

          {/* Recommendations. Correctly signed, unit-aware, evidence-cited
              (deload-advisor style), and suppressed inside the phase-boundary
              water window. */}
          {/* With no body scan the only tip is "add your first DEXA scan",
              which the "Add more data" list below already offers — don't
              push it at someone who has never had one. */}
          {scans.length > 0 && recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tips for you</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-sep">
                  {recommendations.slice(0, 3).map((rec, index) => (
                    <div key={index} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                      <span
                        className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          rec.type === 'warning' ? 'bg-status-warn' : rec.type === 'achievement' ? 'bg-status-ok' : 'bg-action'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                      <h4 className="text-body font-semibold text-ink">{rec.title}</h4>
                      <p className="text-subhead text-ink-2 mt-0.5">{rec.message}</p>
                      {rec.evidence && (
                        <p className="text-caption text-ink-2 mt-1 flex items-start gap-1">
                          <IconChartBar size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                          <span>{rec.evidence}</span>
                        </p>
                      )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Staleness + body-scan-due nudges */}
          <BodyHubNudges
            onLog={(segment) => setLogSegment(segment)}
            refreshKey={bodyRefreshKey}
          />

          {/* Per-site tape trends. Entry happens via the header's
              "Log measurements" button (unified sheet); corrections/deletes
              happen inline in the card's per-entry editor. */}
          <MeasurementTrendCard
            tapeUnit={units === 'lb' ? 'in' : 'cm'}
            refreshKey={bodyRefreshKey}
            onDataChanged={() => setBodyRefreshKey((k) => k + 1)}
          />

          {/* Proportions & targets — How You Compare + FFMI ceiling + weight
              projection, consolidated ONCE (moved in from the dissolved Goals
              tab). Weight projection reads the same weigh-ins as Home. */}
          <ProportionsTargetsCard
            benchmarks={proportionsAnalysis?.benchmarkComparisons ?? []}
            activeTarget={activeTarget}
            activeMesocycle={activeMesocycle}
            currentFfmi={ffmiResult?.ffmi ?? null}
            experience={userProfile?.experience ?? null}
            heightCm={userProfile?.heightCm ?? null}
            displayUnit={units === 'kg' ? 'cm' : 'in'}
            weightUnit={units === 'kg' ? 'kg' : 'lb'}
            weightHistory={weightHistory}
          />

          {/* Progress Photos Hero */}
          <ProgressPhotosHero
            photos={progressPhotos}
            photoUrls={photoUrls}
            units={units}
            weightUnit={weightUnit}
            displayWeight={displayWeightString}
            onCompare={() => setIsCompareOpen(true)}
            onTimelapse={() => setIsTimelapseOpen(true)}
            onAddPhoto={() => setIsAddPhotoOpen(true)}
          />

          <BodyAddMoreData
            needsPhase={!currentPhase}
            phaseHref="/dashboard/phases"
            scanCount={scans.length}
            onLogScan={() => setLogSegment('dexa')}
            needsGoals={!activeTarget && !showGoalsEditor}
            onSetGoals={openGoalsEditor}
          />

          {/* The target EDITOR (weight / BF% / FFMI — what the Composition
              Map's goal vector reads). id-anchored so the header "Edit goals"
              action and the map's "Set a target" prompt both deep-link here.
              Muscle-priority config is no longer on this tab — it's
              program-generation settings, reachable in Settings. Hidden while
              no goal is set (an empty goals card above real data was noise);
              "Edit goals" / the Add-more-data row open it. */}
          {userId && showGoalsEditor && (
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
        </div>
      )}

      {activeTab === 'strength' && (
        <div className="space-y-6">
          {/* Per-lift trend breakdown (the home "Lifts" tile's detail view).
              First so ?section=lift-trends deep links land above the fold. */}
          {liftTrendsSummary && (
            <LiftTrendsCard
              summary={liftTrendsSummary}
              units={units === 'lb' ? 'lb' : 'kg'}
              attentionNames={plateauAlerts.map((a) => a.exerciseName)}
              onSeeIdeas={() => setShowPlateauIdeas(true)}
            />
          )}
          {/* Plateau alerts (with their ideas) open from the summary's "See
              ideas"; without a lift-trend summary they stay inline. */}
          {plateauAlerts.length > 0 && !liftTrendsSummary && (
            <PlateauAlertList alerts={plateauAlerts} units={units === 'lb' ? 'lb' : 'kg'} />
          )}
          <Sheet
            isOpen={showPlateauIdeas && plateauAlerts.length > 0}
            onClose={() => setShowPlateauIdeas(false)}
            title="Lifts that need attention"
            size="lg"
            grouped
          >
            <PlateauAlertList alerts={plateauAlerts} units={units === 'lb' ? 'lb' : 'kg'} />
          </Sheet>
          {/* Progression pace per muscle group vs the expected rate for the
              user's experience level (services/progressionInsights) */}
          {muscleProgression.length > 0 && (
            <MuscleProgressionCard
              groups={muscleProgression}
              exerciseNames={progressionRaw?.exerciseNames}
              goal={progressionRaw?.goal}
            />
          )}

          {/* Weekly sets per muscle (the volume page) — one row. */}
          <ListGroup>
            <ListRow
              title="Sets per week"
              subtitle="Weekly sets per muscle vs its recommended range"
              href="/dashboard/volume"
            />
          </ListGroup>

          {strengthProfile ? (
            <>
              {/* Overall Score — rendered exactly ONCE (was duplicated). */}
              <Card data-testid="strength-score-card">
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
                          className="text-ink-3"
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
                        <span className="text-large-title font-bold text-ink">{strengthProfile.overallScore}</span>
                        <span className="text-caption text-ink-2">/ 100</span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-subhead text-ink-2">Overall strength level</p>
                        <p className={`text-title font-bold capitalize ${getStrengthLevelColor(strengthProfile.strengthLevel)}`}>
                          {formatStrengthLevel(strengthProfile.strengthLevel)}
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-2 bg-card/50 rounded-lg">
                          <p className="text-caption text-ink-2">Balance</p>
                          <p className="text-headline font-bold text-ink">{strengthProfile.balanceScore}%</p>
                        </div>
                        <div className="p-2 bg-card/50 rounded-lg">
                          <p className="text-caption text-ink-2 inline-flex items-center gap-0.5">
                            Muscle (FFMI) <InfoTooltip term="FFMI" size="sm" />
                          </p>
                          {/* Canonical FFMI (selectCanonicalFfmi) — NOT the
                              stale, normalized-in-one-field value frozen on
                              the calibration session. Falls back to the frozen
                              value only when no scan/height exists. */}
                          <p className="text-headline font-bold text-ink" data-testid="strength-ffmi-stat">
                            {(ffmiResult?.ffmi ?? strengthProfile.bodyComposition.ffmi).toFixed(1)}
                          </p>
                        </div>
                        <div className="p-2 bg-card/50 rounded-lg">
                          <p className="text-caption text-ink-2">Lean mass</p>
                          <p className="text-headline font-bold text-ink">{displayWeight(strengthProfile.bodyComposition.leanMassKg)} {weightUnit}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Calibrated Lifts */}
              <Card>
                <CardHeader>
                  <CardTitle>Calibrated lifts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {strengthProfile.calibratedLifts.map((lift) => (
                      <div key={lift.benchmarkId} className="p-4 bg-fill/50 rounded-xl">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="font-medium text-ink">{lift.lift}</h4>
                            <p className="text-subhead text-ink-2">
                              Est. max: {displayWeight(lift.estimated1RM)} {weightUnit}
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
                <Card className="border-status-warn/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <IconAlertTriangle size={18} className="text-status-warn" aria-hidden="true" />
                      Detected imbalances
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {strengthProfile.imbalances.map((imbalance, i) => (
                        <div
                          key={i}
                          className={`p-3 rounded-lg ${
                            imbalance.severity === 'significant'
                              ? 'bg-status-bad/10 border border-status-bad/30'
                              : 'bg-status-warn/10 border border-status-warn/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-subhead font-medium text-ink">{imbalance.description}</p>
                              <p className="text-caption text-ink-2 mt-1">{imbalance.recommendation}</p>
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
            // Full card only when there's little or no strength data; with
            // lift history it's one optional row (percentile rankings).
            <CalibrateStrengthPrompt
              mode={calibratePromptMode({
                liftTrends: liftTrendsSummary,
                liftTrendsLoaded: liftTrendsQuery.isFetched || !!liftTrendsQuery.data,
                muscleProgressionCount: muscleProgression.length,
              })}
              onStart={() => router.push(ONBOARDING_BENCHMARKS_ENTRY)}
            />
          )}
        </div>
      )}

      {/* Wellness Tab. Muscle recovery lives on the Train page (its Recovery
          section) — no duplicate card here. */}
      {activeTab === 'wellness' && (
        <div className="space-y-6">
          {/* ONE Wellness Trends card: a single chart with metric chips
              (sleep / soreness / energy / mood up front, the rest under
              "More"), plus a 2-col sparkline summary grid. Metrics with no
              data in range never render as empty full-height cards — they
              appear only under "More" with an inline log affordance.
              Inverted-scale metrics plot on a normal axis with a
              "lower is better" footnote. Replaces the nine stacked charts. */}
          <WellnessTrendsCard
            checkInData={checkInData}
            hydrationData={hydrationData}
            cardioData={cardioData}
            hydrationUnit={units === 'kg' ? 'ml' : 'oz'}
            rangeLabel={getTimeRangeLabel(timeRange)}
          />

          {/* ONE "Today" card consolidating steps/activity (HealthKit-aware),
              a SINGLE hydration tracker (one unit honoring the user's pref),
              and blood pressure. Cardio logging moved to the Train page. */}
          {userId && (
            <div className="space-y-3" data-testid="wellness-today">
              <h2 className="text-body font-medium text-ink">Today</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <ActivityCard userId={userId} />
                <HydrationTracker userId={userId} unit={units === 'kg' ? 'ml' : 'oz'} />
                <BloodPressureCard />
              </div>
            </div>
          )}
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

      {/* Progress photos modals (accessible from Body tab hero) */}
      {userId && (
        <AddPhotoModal
          isOpen={isAddPhotoOpen}
          onClose={() => setIsAddPhotoOpen(false)}
          userId={userId}
          units={units}
          weightUnit={weightUnit}
          ghostUrl={progressPhotos[0] ? photoUrls[progressPhotos[0].id] : undefined}
          onAdded={() => {
            setIsAddPhotoOpen(false);
            // Refresh both the analytics query (for this page's photo list)
            // and mark the body hub for refresh
            void queryClient.invalidateQueries({ queryKey: ['analytics'] });
            setBodyRefreshKey((k) => k + 1);
          }}
        />
      )}
      <ComparePhotos
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        photos={progressPhotos}
        photoUrls={photoUrls}
        units={units}
      />
      <TimelapseModal
        isOpen={isTimelapseOpen}
        onClose={() => setIsTimelapseOpen(false)}
        photos={progressPhotos}
        photoUrls={photoUrls}
        units={units}
      />
    </div>
  );
}

// useSearchParams (deep-linkable ?tab=/&section=) requires a Suspense
// boundary for the static prerender pass — the fallback matches the page's
// own loading state so nothing visibly changes.
export default function AnalyticsPage() {
  useDocumentTitle('Progress');
  return (
    <Suspense fallback={<FullPageLoading text="Loading your analytics..." title="Progress" />}>
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
          <CardTitle>Muscle group priorities</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingState label="Loading priorities..." size="sm" />
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
    1: 'High priority',
    2: 'Focus',
    3: 'Normal',
    4: 'Maintenance',
    5: 'Low priority',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Muscle group priorities</span>
          <Link href="/dashboard/settings">
            <Button variant="ghost" size="sm">Edit in settings</Button>
          </Link>
        </CardTitle>
        <p className="text-subhead text-ink-2 mt-1">
          These priorities influence volume allocation in program generation
        </p>
      </CardHeader>
      <CardContent>
        {!hasCustomPriorities ? (
          <div className="text-center py-4">
            <p className="text-ink-2 text-subhead mb-2">No custom priorities set</p>
            <p className="text-caption text-ink-2 mb-3">
              All muscle groups are set to normal priority (3). Set custom priorities in Settings to influence program generation.
            </p>
            <Link href="/dashboard/settings">
              <Button variant="outline" size="sm">Go to settings</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {highPriority.length > 0 && (
            <div>
              <h4 className="text-caption font-medium text-ink-2 mb-2">
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
              <h4 className="text-caption font-medium text-ink-2 mb-2">
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
              <h4 className="text-caption font-medium text-ink-2 mb-2">
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
            <div className="pt-3 border-t border-sep">
              <h4 className="text-caption font-medium text-ink-2 mb-2">Notes</h4>
              <div className="space-y-1">
                {priorities
                  .filter(p => p.reason)
                  .map((p) => (
                    <div key={p.muscleGroup} className="text-caption text-ink-2">
                      <span className="font-medium text-ink">{getMuscleDisplayName(p.muscleGroup)}:</span>{' '}
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

