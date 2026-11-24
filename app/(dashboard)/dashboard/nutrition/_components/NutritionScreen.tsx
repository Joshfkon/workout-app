'use client';

import { mealFromAddParam } from '@/lib/nutrition/addFoodLink';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useHydrated } from '@/hooks/useHydrated';
import { useTrackingFocus } from '@/hooks/useTrackingFocus';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient, useIsRestoring } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Modal } from '@/components/ui/Modal';
import { Card, CardHeader, CardTitle, CardContent, Button, PageSkeleton, SwipeableRow, ToastContainer, useToasts, EmptyState, ListGroup, ListRow } from '@/components/ui';
import { Button as StyledButton } from '@/components/ui/Button';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';

// Dynamic imports for heavy modals - reduces initial bundle size
const AddFoodModal = dynamic(() => import('@/components/nutrition/AddFoodModal').then(m => ({ default: m.AddFoodModal })), { ssr: false });
const WeightLogModal = dynamic(() => import('@/components/nutrition/WeightLogModal').then(m => ({ default: m.WeightLogModal })), { ssr: false });
const WeightHistoryModal = dynamic(() => import('@/components/nutrition/WeightHistoryModal').then(m => ({ default: m.WeightHistoryModal })), { ssr: false });
const NutritionTargetsModal = dynamic(() => import('@/components/nutrition/NutritionTargetsModal').then(m => ({ default: m.NutritionTargetsModal })), { ssr: false });
const MacroCalculatorModal = dynamic(() => import('@/components/nutrition/MacroCalculatorModal').then(m => ({ default: m.MacroCalculatorModal })), { ssr: false });
const CreateCustomFoodModal = dynamic(() => import('@/components/nutrition/CreateCustomFoodModal').then(m => ({ default: m.CreateCustomFoodModal })), { ssr: false });
const EditFoodModal = dynamic(() => import('@/components/nutrition/EditFoodModal').then(m => ({ default: m.EditFoodModal })), { ssr: false });
const NutritionTrendGraph = dynamic(() => import('@/components/nutrition/NutritionTrendGraph').then(m => ({ default: m.NutritionTrendGraph })), { ssr: false });
const ActivitySettingsScreen = dynamic(() => import('@/components/wearables/ActivitySettingsScreen').then(m => ({ default: m.ActivitySettingsScreen })), { ssr: false });
const DescribeMealModal = dynamic(() => import('@/components/nutrition/DescribeMealModal').then(m => ({ default: m.DescribeMealModal })), { ssr: false });
const SavedMealsModal = dynamic(() => import('@/components/nutrition/SavedMealsModal').then(m => ({ default: m.SavedMealsModal })), { ssr: false });
const NutritionCalendarSheet = dynamic(() => import('@/components/nutrition/NutritionCalendarSheet').then(m => ({ default: m.NutritionCalendarSheet })), { ssr: false });
import type {
  FoodLogEntry,
  WeightLogEntry,
  NutritionTargets,
  CustomFood,
  MealType,
  FrequentFood,
  SystemFood,
  MealNames,
} from '@/types/nutrition';
import type { ParsedMealItem } from '@/lib/actions/nutrition-ai';
import type { SavedMeal, SavedMealItem } from '@/components/nutrition/SavedMealsModal';
import type { AddFoodTab } from '@/components/nutrition/AddFoodModal';
import type { LabelScanPrefill } from '@/components/nutrition/LabelScanner';
import { MacroSummaryCard } from '@/components/nutrition/MacroSummaryCard';
import { FoodEmojiAvatar } from '@/components/nutrition/FoodEmoji';
import { StickyMacroBar } from '@/components/nutrition/StickyMacroBar';
import { NutritionQuickActions } from '@/components/nutrition/NutritionQuickActions';
import { QuickAddChips } from '@/components/nutrition/QuickAddChips';
import { TargetBasisDisclosure } from '@/components/nutrition/TargetBasisDisclosure';
import { describeTargetBasis } from '@/lib/nutrition/targetBasis';
import { ShareNutritionText } from '@/components/nutrition/ShareNutritionText';
import { useDailyNutritionSummary } from '@/hooks/useDailyNutritionSummary';
import { useStepCalorieAdjustment } from '@/hooks/useStepCalorieAdjustment';
import { applyAdjustmentToMacros } from '@/lib/nutrition/step-calorie-adjustment';
import { updateNutritionWidget } from '@/lib/integrations/liveActivity';
import { DEFAULT_EATING_WINDOW, type EatingWindow } from '@/services/intakePacing';
import {
  useNutritionDay,
  useNutritionGlobal,
  nutritionDayKey,
  fetchFoodLog,
  NUTRITION_GLOBAL_KEY,
  type NutritionGlobalBundle,
} from '@/hooks/useNutritionData';
import { useRecentFoods, RECENT_FOODS_KEY } from '@/hooks/useRecentFoods';
import { nutritionMonthKey } from '@/hooks/useNutritionMonth';
import { LOG_HOME_QUERY_KEY, type LogHomeData } from '@/hooks/useLogPageData';
import { setMacroAutoUpdateEnabled } from '@/lib/actions/nutrition';
import { customFoodFieldsFromScan } from '@/lib/nutrition/scannedCustomFood';
import {
  addLoggedRowsToFrequentFoods,
  buildFrequentFoods,
  frequentFoodPortion,
  quickAddMessage,
  addedToMealMessage,
  quickAddConfirmation,
  mealTypeForHour,
} from '@/lib/nutrition/frequentFoods';
import { now as clockNow } from '@/lib/clock';
import type { QuickAddConfirmation } from '@/components/nutrition/QuickAddChips';
import { addLocalDays } from '@/lib/date/localDay';
import { getAdaptiveTDEE, onWeightLoggedRecalculateTDEE, resetAndRecalculateTDEE, type TDEEData } from '@/lib/actions/tdee';
import { TDEEDashboard } from '@/components/nutrition/TDEEDashboard';
import { computeScanPairPRatios } from '@/services/compositionSpace';
import { StepTracking } from '@/components/nutrition/StepTracking';
import {
  getLocalDateString,
  formatDate,
  formatChartTickDate,
  dateTickStep,
  showDateTick,
} from '@/lib/utils';
import { getDisplayWeight, prepareWeightForStorage } from '@/lib/weightUtils';
import { computeWeightRate } from '@/app/(dashboard)/dashboard/_lib/weightRate';
import NutritionLoading from '../loading';
import { MealReminderPrompt } from '@/components/nutrition/MealReminderPrompt';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  IconBookmarkPlus,
  IconCheck,
  IconChartLine,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconPlus,
  IconScale,
  IconSettings,
  IconShoe,
  IconX,
} from '@tabler/icons-react';

/**
 * Which screen this instance renders: the Eat log (/dashboard/nutrition) or
 * Weight & trends (/dashboard/nutrition/trends). They are separate routes
 * that share this component because the trends half reads the same weight,
 * TDEE and target state the log does; React Query keeps that state warm
 * across the push, so neither screen waits on the other.
 */
export type NutritionView = 'log' | 'trends';

export const NUTRITION_TRENDS_HREF = '/dashboard/nutrition/trends';

/** localStorage key: Weight & trends' "More: energy burn & steps" is open. */
const TRENDS_MORE_KEY = 'ht:trendsMoreOpen:v1';

/** Legacy ?tab=weight / ?tab=insights links now live at the trends route. */
export function isLegacyTrendsTab(value: string | null): boolean {
  return value === 'weight' || value === 'insights';
}

// Set when Eat pushes the trends screen, so its Back pops that entry instead
// of stacking a new Eat on top. A cold open of /trends (deep link, reload)
// has nothing to pop, so Back navigates to Eat instead.
let pushedFromEat = false;

const DEFAULT_MEAL_CONFIG: { type: MealType; label: string }[] = [
  { type: 'breakfast', label: 'Breakfast' },
  { type: 'lunch', label: 'Lunch' },
  { type: 'dinner', label: 'Dinner' },
  { type: 'snack', label: 'Snacks' },
];

function getMealConfig(customNames?: MealNames | null) {
  return DEFAULT_MEAL_CONFIG.map(meal => ({
    ...meal,
    label: customNames?.[meal.type] || meal.label,
  }));
}

/** Time-of-day default meal (Describe / frequent chips / saved meals) */
function getMealTypeForNow(): MealType {
  return mealTypeForHour(clockNow().getHours());
}

// Convert food names to proper title case (fix ALL CAPS from USDA/databases)
function toTitleCase(str: string): string {
  if (!str) return '';
  // If it's mostly uppercase, convert to title case
  const upperCount = (str.match(/[A-Z]/g) || []).length;
  const letterCount = (str.match(/[a-zA-Z]/g) || []).length;
  const isUpperCase = letterCount > 0 && upperCount / letterCount > 0.7;

  if (isUpperCase) {
    return str
      .toLowerCase()
      .split(' ')
      .map(word => {
        // Keep certain words lowercase
        if (['with', 'and', 'or', 'the', 'a', 'an', 'of', 'in', 'on'].includes(word) && word !== str.toLowerCase().split(' ')[0]) {
          return word;
        }
        // Keep brand abbreviations like "NF" uppercase
        if (word.length <= 2 && word === word.toUpperCase()) {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }
  return str;
}

// User profile data for macro calculator
interface UserProfileData {
  weightLbs?: number;
  heightInches?: number;
  age?: number;
  sex?: 'male' | 'female';
  bodyFatPercent?: number;
  workoutsPerWeek?: number;
}

// Shape shared by every food_log insert on this page
interface FoodLogInsert {
  food_name: string;
  serving_size: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  meal_type: MealType;
  source?: 'usda' | 'fatsecret' | 'nutritionix' | 'custom' | 'manual';
  food_id?: string;
  nutritionix_id?: string;
}

const WEIGHT_CHART_RANGE_DAYS = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
} as const;
type WeightChartRange = keyof typeof WEIGHT_CHART_RANGE_DAYS;

/** Skeleton for the macro summary numbers while a never-fetched day loads. */
function MacroNumbersSkeleton() {
  return (
    <div
      className="rounded-card bg-card p-4 animate-pulse shadow-card"
      aria-hidden="true"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="h-6 w-24 rounded bg-fill" />
        <div className="h-4 w-16 rounded bg-fill" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 text-center">
            <div className="mx-auto h-7 w-12 rounded bg-fill" />
            <div className="mx-auto h-3 w-10 rounded bg-fill" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for a single meal section while a never-fetched day loads. */
function MealSectionSkeleton() {
  return (
    <div className="rounded-card bg-card p-4 animate-pulse shadow-card">
      <div className="flex items-center justify-between">
        <div className="h-4 w-28 rounded bg-fill" />
        <div className="h-3 w-16 rounded bg-fill" />
      </div>
    </div>
  );
}

function NutritionPageContent({ view }: { view: NutritionView }) {
  // Defer date initialization to client to prevent hydration mismatches
  // Lazily initialized on the client so a REMOUNT never flashes the
  // full-screen loader: changing the ?tab= search param remounts page.tsx
  // (the App Router keys the page segment by its search params — true for
  // history.replaceState sync and router.replace alike), and with these
  // starting null/false the first frames rendered the isColdStart branch
  // even with a warm cache.
  // On a full page load the server DOES render this page, though, so the
  // render gate must be false while hydrating (matching the server's loading
  // HTML) and true on any later client mount: useHydrated. Gating the body on
  // it also covers selectedDate, which is set on the client's first render
  // but only rendered once hydrated.
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getLocalDateString()
  );
  const isMounted = useHydrated();
  const [weightEntries, setWeightEntries] = useState<WeightLogEntry[]>([]);
  const [nutritionTargets, setNutritionTargets] = useState<NutritionTargets | null>(null);
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([]);
  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [systemFoods, setSystemFoods] = useState<SystemFood[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfileData>({});
  const [tdeeData, setTdeeData] = useState<TDEEData | null>(null);
  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('lb');
  const [avgDailyProteinGrams, setAvgDailyProteinGrams] = useState<number | undefined>(undefined);
  const [avgWeeklyTrainingSets, setAvgWeeklyTrainingSets] = useState<number | undefined>(undefined);
  const [userAge, setUserAge] = useState<number | undefined>(undefined);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [latestDexaScan, setLatestDexaScan] = useState<{
    body_fat_percent: number;
    weight_kg: number;
    lean_mass_kg: number;
    fat_mass_kg: number;
  } | null>(null);
  const [trainingAge, setTrainingAge] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [currentPhase, setCurrentPhase] = useState<'bulk' | 'cut' | 'maintenance' | null>(null);
  const [mesoWeek, setMesoWeek] = useState<number | null>(null);

  // Modal states
  const [showAddFood, setShowAddFood] = useState(false);
  const [addFoodTab, setAddFoodTab] = useState<AddFoodTab>('search');
  const [selectedMealType, setSelectedMealType] = useState<MealType>(getMealTypeForNow);
  // The meal the user last chose (opening a meal card, or switching the meal
  // in the Add food sheet). Quick-log chips follow it; until the user picks
  // one, they follow the time of day. null = no explicit choice yet.
  const [quickMeal, setQuickMeal] = useState<MealType | null>(null);
  // Weight & trends: the metabolism details disclosure. Closed by default;
  // remembered per viewer (a convenience: storage may be unavailable).
  const [trendsMoreOpen, setTrendsMoreOpenState] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TRENDS_MORE_KEY) === '1') setTrendsMoreOpenState(true);
    } catch {
      /* storage unavailable: stay closed */
    }
  }, []);
  const setTrendsMoreOpen = (open: boolean) => {
    setTrendsMoreOpenState(open);
    try {
      window.localStorage.setItem(TRENDS_MORE_KEY, open ? '1' : '0');
    } catch {
      /* storage unavailable: not remembered */
    }
  };
  const [showDescribeMeal, setShowDescribeMeal] = useState(false);
  // Meal type a reminder deep-linked into Describe for (?describe=lunch).
  const [describeMealType, setDescribeMealType] = useState<MealType | null>(null);
  const [showSavedMeals, setShowSavedMeals] = useState(false);
  const [showWeightLog, setShowWeightLog] = useState(false);
  const [showWeightHistory, setShowWeightHistory] = useState(false);
  const [weightChartRange, setWeightChartRange] = useState<WeightChartRange>('30d');
  const [editingWeight, setEditingWeight] = useState<WeightLogEntry | null>(null);
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [showMacroCalculator, setShowMacroCalculator] = useState(false);
  const [showCreateCustomFood, setShowCreateCustomFood] = useState(false);
  const [customFoodBarcode, setCustomFoodBarcode] = useState<string | undefined>(undefined);
  const [labelScanPrefill, setLabelScanPrefill] = useState<LabelScanPrefill | null>(null);
  const [editingCustomFood, setEditingCustomFood] = useState<CustomFood | null>(null);
  const [showEditFood, setShowEditFood] = useState(false);
  const [editingFood, setEditingFood] = useState<FoodLogEntry | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [openMealMenu, setOpenMealMenu] = useState<MealType | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isTrends = view === 'trends';

  // Old deep links (?tab=weight / ?tab=insights) land on the trends route.
  useEffect(() => {
    if (!isTrends && isLegacyTrendsTab(searchParams.get('tab'))) {
      router.replace(NUTRITION_TRENDS_HREF);
    }
  }, [isTrends, router, searchParams]);

  // A meal reminder opens straight into Describe for that meal: a rough
  // estimate in one sentence beats a blank. Strip the param so a reload
  // doesn't reopen it.
  useEffect(() => {
    const meal = searchParams.get('describe');
    if (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner' || meal === 'snack') {
      setDescribeMealType(meal);
      setShowDescribeMeal(true);
      window.history.replaceState(null, '', pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // "Log food" elsewhere in the app (Home) opens the SAME Add food sheet,
  // with its recents and saved meals: ?add=breakfast|lunch|dinner|snack, or
  // ?add=now for the meal that fits the time of day.
  useEffect(() => {
    const meal = mealFromAddParam(searchParams.get('add'), getMealTypeForNow());
    if (!meal) return;
    openAddFood(meal);
    window.history.replaceState(null, '', pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openTrends = () => {
    pushedFromEat = true;
    router.push(NUTRITION_TRENDS_HREF);
  };

  const backToEat = () => {
    if (pushedFromEat) {
      pushedFromEat = false;
      router.back();
    } else {
      router.push('/dashboard/nutrition');
    }
  };

  // Notification for macro updates
  const [macroUpdateNotification, setMacroUpdateNotification] = useState<string | null>(null);

  const { toasts, dismissToast, showSuccess, addToast } = useToasts();
  // Food-only users (hooks/useTrackingFocus) get no FFMI in the projections.
  const { foodOnly } = useTrackingFocus();

  // Rows a quick-add just created: briefly tinted + slid in inside their meal
  // (alongside the Undo toast), so a one-tap add is unmistakable.
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(() => new Set());
  const justAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagJustAdded = useCallback((rows: FoodLogEntry[]) => {
    if (rows.length === 0) return;
    setJustAddedIds(new Set(rows.map((r) => r.id)));
    if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
    justAddedTimerRef.current = setTimeout(() => setJustAddedIds(new Set()), 2400);
    // Bring the new row into view once it has rendered (no-op if visible).
    requestAnimationFrame(() => {
      const id = rows[0].id;
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-food-entry-id]')).find(
        (node) => node.dataset.foodEntryId === id
      );
      el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);
  useEffect(() => () => {
    if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
  }, []);

  // Lazy one-time load of the system food library (only needed once a food modal opens)
  const systemFoodsLoadedRef = useRef(false);

  // Hero macro card wrapper — the sticky bar shows once this scrolls out of view
  const heroCardRef = useRef<HTMLDivElement>(null);

  const supabase = createUntypedClient();

  // Initialize date on client side only (after mount)
  useEffect(() => {
    if (isMounted && selectedDate === null) {
      setSelectedDate(getLocalDateString());
    }
  }, [isMounted, selectedDate]);

  // Follow the calendar across midnight. The app can sit on this tab
  // overnight (a resumed PWA / native shell never remounts), and without this
  // "today" stayed yesterday — breakfast was logged to the previous day. Only
  // a user who was viewing today is moved; a deliberately chosen past day is
  // left alone.
  const knownTodayRef = useRef<string | null>(
    typeof window === 'undefined' ? null : getLocalDateString()
  );
  useEffect(() => {
    const syncToday = () => {
      if (document.visibilityState !== 'visible') return;
      const currentDay = getLocalDateString();
      const previousDay = knownTodayRef.current;
      if (previousDay === currentDay) return;
      knownTodayRef.current = currentDay;
      setSelectedDate((selected) =>
        selected === null || selected === previousDay ? currentDay : selected
      );
    };
    document.addEventListener('visibilitychange', syncToday);
    window.addEventListener('focus', syncToday);
    return () => {
      document.removeEventListener('visibilitychange', syncToday);
      window.removeEventListener('focus', syncToday);
    };
  }, []);

  const queryClient = useQueryClient();

  // Yesterday relative to the selected date — powers "Copy yesterday" and
  // doubles as the day-1 prefetch.
  const yesterdayKey = useMemo(() => {
    if (!selectedDate) return null;
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return getLocalDateString(d);
  }, [selectedDate]);

  // Per-day food log is cached-first with keepPreviousData, so switching days
  // never unmounts the page to a full-screen spinner. The date-independent
  // user context (targets, weight, profile, TDEE, …) is a separate query,
  // cached once and reused across date switches AND route revisits.
  const dayQuery = useNutritionDay(selectedDate);
  const yesterdayQuery = useNutritionDay(yesterdayKey);
  const globalQuery = useNutritionGlobal(isMounted);

  // Recents/Meals query (add-food flow). Gated behind the first open of the
  // add-food sheet — it reads a wider 90-day slice than the per-day query, so
  // we don't pay for it on every Eat page mount.
  const [recentsEnabled, setRecentsEnabled] = useState(false);
  const recentFoodsQuery = useRecentFoods(recentsEnabled);

  // True while React Query rehydrates its cache from IndexedDB on a cold reload.
  // During this window queries are paused (no data yet) but the cache is warm —
  // so we must NOT show the full-screen heart; skeletons cover the gap instead.
  const isRestoring = useIsRestoring();

  const foodEntries = dayQuery.data ?? [];
  // While a never-fetched yesterday loads, keepPreviousData holds the PREVIOUS
  // day's "yesterday" rows. Treat that as empty so "Copy from yesterday" never
  // copies the wrong day's entries (it hides until the real prior day resolves;
  // day-1 is prefetched, so this window is rare).
  const yesterdayEntries = yesterdayQuery.isPlaceholderData ? [] : (yesterdayQuery.data ?? []);

  // keepPreviousData hands us the PREVIOUS day's rows while a never-fetched day
  // loads (isPlaceholderData). Show skeletons for the numbers rather than a
  // different day's data. Already-cached days resolve with
  // isPlaceholderData=false → instant, no skeleton, no flash. Also skeleton
  // while the persisted cache is still rehydrating.
  const isDaySwitching = dayQuery.isPlaceholderData || (isRestoring && !dayQuery.data);

  // The ONLY state allowed to show the full-screen heart: first-ever load with
  // an empty persisted cache. Also covers the pre-mount / pre-date-init frames
  // where the body can't render (it dereferences selectedDate). A warm reload
  // rehydrates globalQuery.data from IndexedDB, so this stays false during
  // restoration (isRestoring) and after (status 'success') — no spinner.
  // `status === 'pending'` (not isLoading) because a disabled query reports
  // isLoading=false.
  const isColdStart =
    !isMounted ||
    !selectedDate ||
    (!isRestoring && !globalQuery.data && globalQuery.status === 'pending');

  // Optimistic writer for the selected day's cache. Drop-in replacement for the
  // old setFoodEntries(setState) used by every mutation/undo path.
  const mutateFoodEntries = useCallback(
    (updater: FoodLogEntry[] | ((prev: FoodLogEntry[]) => FoodLogEntry[])) => {
      if (!selectedDate) return;
      const nextEntries = queryClient.setQueryData<FoodLogEntry[]>(
        nutritionDayKey(selectedDate),
        (prev = []) => (typeof updater === 'function' ? updater(prev) : updater)
      );
      // The calendar's month aggregate now disagrees with the day cache. Mark
      // it stale so the next sheet open refetches — matters for PAST months,
      // whose immutable-in-practice staleTime would otherwise hide the edit.
      void queryClient.invalidateQueries({
        queryKey: nutritionMonthKey(selectedDate.slice(0, 7)),
        refetchType: 'none',
      });
      // Cross-surface: the Home ('/dashboard/log') "Today so far" card reads
      // today's totals from a SEPARATE query (['log','home']) that this write
      // doesn't touch. Only today's edits affect Home (it only ever shows
      // today's totals).
      if (selectedDate === getLocalDateString()) {
        // Patch the Home cache's totals optimistically from the same food-entry
        // rows we just wrote, THEN invalidate for reconciliation. Invalidation
        // alone only marks the query stale: React Query keeps serving the old
        // cached todaySoFar synchronously while it refetches (and would keep it
        // if that refetch fails — e.g. offline), so the card could still flash
        // pre-log totals on return. Patching first means Home paints the
        // correct numbers immediately from cache; the follow-up refetch just
        // reconciles against the server. Guarded to a same-day cached payload —
        // a stale-date payload's todaySoFar isn't rendered by LogPage anyway
        // (it guards on date === today), and the invalidate refreshes it.
        if (nextEntries) {
          const sumOf = (key: 'calories' | 'protein' | 'carbs' | 'fat') =>
            Math.round(nextEntries.reduce((sum, r) => sum + (r[key] || 0), 0));
          queryClient.setQueryData<LogHomeData | null>(LOG_HOME_QUERY_KEY, (prev) => {
            if (!prev || prev.date !== selectedDate) return prev;
            return {
              ...prev,
              todaySoFar: {
                ...prev.todaySoFar,
                calories: sumOf('calories'),
                protein: sumOf('protein'),
                carbs: sumOf('carbs'),
                fat: sumOf('fat'),
              },
            };
          });
        }
        void queryClient.invalidateQueries({ queryKey: LOG_HOME_QUERY_KEY });
      }
    },
    [queryClient, selectedDate]
  );

  // Optimistic writer for the recents/meals cache, so the add-food sheet's
  // Recent list reflects a quick-add without waiting for a refetch.
  const mutateRecentFoodsCache = useCallback(
    (updater: FoodLogEntry[] | ((prev: FoodLogEntry[]) => FoodLogEntry[])) => {
      queryClient.setQueryData<FoodLogEntry[]>(RECENT_FOODS_KEY, (prev = []) =>
        typeof updater === 'function' ? updater(prev) : updater
      );
    },
    [queryClient]
  );

  // Prefetch the NEXT day so forward navigation is instant too (day-1 is
  // already fetched by yesterdayQuery). Predictable navigation → warm cache.
  useEffect(() => {
    if (!selectedDate) return;
    const next = new Date(selectedDate + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    const nextKey = getLocalDateString(next);
    void queryClient.prefetchQuery({
      queryKey: nutritionDayKey(nextKey),
      queryFn: () => fetchFoodLog(nextKey),
    });
  }, [selectedDate, queryClient]);

  // Fan the cached global bundle back out into the existing local state so
  // every downstream mutation and derived read stays untouched. Runs once per
  // load and again on background revalidation.
  // Realized p-ratio between consecutive DEXA scan pairs — the learned
  // partitioning signal the TDEE projections blend in (selectUsablePRatioPairs
  // inside TDEEDashboard picks the direction-matched subset per prediction).
  // `dexaScans` is undefined on persisted caches written before the field
  // existed; treat as no history until the background refetch lands.
  const scanPairPRatios = useMemo(() => {
    const scans = globalQuery.data?.dexaScans ?? [];
    if (!heightCm || scans.length < 2) return [];
    return computeScanPairPRatios(
      scans
        .filter((s) => s.lean_mass_kg != null && s.fat_mass_kg != null)
        .map((s) => ({
          date: s.scan_date,
          leanMassKg: Number(s.lean_mass_kg),
          fatMassKg: Number(s.fat_mass_kg),
          weightKg: s.weight_kg != null ? Number(s.weight_kg) : null,
          boneMassKg: s.bone_mass_kg != null ? Number(s.bone_mass_kg) : null,
          bodyFatPercent: s.body_fat_percent != null ? Number(s.body_fat_percent) : null,
        })),
      heightCm
    );
  }, [globalQuery.data?.dexaScans, heightCm]);

  useEffect(() => {
    if (globalQuery.data) processGlobal(globalQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalQuery.data]);

  function processGlobal(bundle: NutritionGlobalBundle) {
    setNutritionTargets(bundle.targets);

    // Process weight entries
    const rawWeightEntries = bundle.weight || [];
    setWeightEntries(rawWeightEntries);
    setCustomFoods(bundle.customFoods || []);

    // Set weight unit preference
    if (bundle.prefs?.weight_unit) {
      setWeightUnit(bundle.prefs.weight_unit as 'lb' | 'kg');
    }

    // Process frequent foods (each keeps its last logged portion for one-tap adds)
    const frequentData = bundle.frequentRaw;
    if (frequentData && frequentData.length > 0) {
      setFrequentFoods(buildFrequentFoods(frequentData, bundle.userId, new Date().toISOString()));
    }

    // Build user profile data
    const profileData: UserProfileData = {};
    const weightData = bundle.weight;

    if (weightData && weightData.length > 0) {
      // Convert weight to lbs for macro calculator
      const weightEntry = weightData[0] as any;
      const weightValue = weightEntry.weight || weightEntry.raw_weight || 0;
      const weightEntryUnit = weightEntry.unit || weightEntry.raw_unit || weightUnit;

      // Convert to lbs if needed
      if (weightEntryUnit === 'kg') {
        profileData.weightLbs = weightValue * 2.20462;
      } else {
        profileData.weightLbs = weightValue;
      }
    }

    const userData = bundle.user;
    const userError = bundle.userError;

    if (userError) {
      setHeightCm(null);
    } else if (userData) {
      if (userData.height_cm != null && userData.height_cm !== undefined && userData.height_cm !== '') {
        const heightValue = typeof userData.height_cm === 'string' ? parseFloat(userData.height_cm) : Number(userData.height_cm);
        if (!isNaN(heightValue) && heightValue > 0) {
          profileData.heightInches = Math.round(heightValue / 2.54);
          setHeightCm(heightValue);
        } else {
          setHeightCm(null);
        }
      } else {
        setHeightCm(null);
      }
      if (userData.age) {
        profileData.age = userData.age;
        setUserAge(userData.age);
      }
      if (userData.sex) {
        profileData.sex = userData.sex as 'male' | 'female';
      }
      if (userData.goal) {
        // Legacy 'maintain'/'recomp' values collapse to 'maintenance'
        const g = userData.goal as string;
        setCurrentPhase(g === 'bulk' || g === 'cut' ? g : 'maintenance');
      }
    } else {
      setHeightCm(null);
    }

    const dexaData = bundle.dexa;
    if (dexaData) {
      if (dexaData.body_fat_percent) {
        profileData.bodyFatPercent = dexaData.body_fat_percent;
      }
      if (dexaData.weight_kg && !profileData.weightLbs) {
        profileData.weightLbs = Math.round(dexaData.weight_kg * 2.20462);
      }
      // Store full DEXA scan data for P-ratio calculation
      if (dexaData.body_fat_percent && dexaData.weight_kg) {
        const fatMassKg = dexaData.weight_kg * (dexaData.body_fat_percent / 100);
        const leanMassKg = dexaData.weight_kg - fatMassKg;
        setLatestDexaScan({
          body_fat_percent: dexaData.body_fat_percent,
          weight_kg: dexaData.weight_kg,
          lean_mass_kg: leanMassKg,
          fat_mass_kg: fatMassKg,
        });
      }
    } else {
      setLatestDexaScan(null);
    }

    // Process volume profile for training age and enhanced status
    const volumeProfileData = bundle.volumeProfile;
    if (volumeProfileData) {
      // Map 'novice' to 'beginner' for TDEEDashboard compatibility
      const dbTrainingAge = volumeProfileData.training_age as 'novice' | 'intermediate' | 'advanced' | null;
      if (dbTrainingAge === 'novice') {
        setTrainingAge('beginner');
      } else if (dbTrainingAge === 'intermediate' || dbTrainingAge === 'advanced') {
        setTrainingAge(dbTrainingAge);
      } else {
        setTrainingAge('intermediate');
      }
    }

    // Calculate average daily protein (last 30 days)
    const proteinData = bundle.proteinRaw || [];
    if (proteinData.length > 0) {
      // Group by date and sum protein per day
      const proteinByDate = new Map<string, number>();
      proteinData.forEach((entry: { protein?: number; logged_at: string }) => {
        const date = entry.logged_at;
        const protein = entry.protein || 0;
        proteinByDate.set(date, (proteinByDate.get(date) || 0) + protein);
      });

      // Calculate average
      const totalProtein = Array.from(proteinByDate.values()).reduce((a, b) => a + b, 0);
      const avgProtein = totalProtein / proteinByDate.size;
      setAvgDailyProteinGrams(avgProtein);
    } else {
      setAvgDailyProteinGrams(undefined);
    }

    // Calculate average weekly training sets (last 30 days)
    const trainingData = bundle.trainingSetsRaw || [];
    if (trainingData.length > 0) {
      // Count working sets (non-warmup)
      let totalWorkingSets = 0;
      trainingData.forEach((block: any) => {
        if (block.set_logs && Array.isArray(block.set_logs)) {
          const workingSets = block.set_logs.filter((set: any) => !set.is_warmup);
          totalWorkingSets += workingSets.length;
        }
      });

      // Average over 30 days = ~4.3 weeks
      const avgWeeklySets = (totalWorkingSets / 30) * 7;
      setAvgWeeklyTrainingSets(Math.round(avgWeeklySets));
    } else {
      setAvgWeeklyTrainingSets(undefined);
    }

    const mesocycleData = bundle.mesocycle;
    if (mesocycleData?.days_per_week) {
      profileData.workoutsPerWeek = mesocycleData.days_per_week;
    }
    setMesoWeek(
      typeof mesocycleData?.current_week === 'number' ? mesocycleData.current_week : null
    );

    setUserProfile(profileData);

    // Adaptive TDEE was computed with the global bundle (server action).
    setTdeeData(bundle.tdee);
  }

  /**
   * The single food_log insert path for this page. Every logging flow
   * (add-food modal, describe, saved meals, frequent chips, copy yesterday)
   * goes through here.
   */
  async function insertFoodEntry(food: FoodLogInsert): Promise<FoodLogEntry> {
    // Local session read — getUser() hits the network and reads a blip as
    // "logged out"; RLS still verifies the token on the insert itself.
    const userId = await getLocalUserId(supabase);
    if (!userId) throw new Error('Not signed in');
    if (!selectedDate) throw new Error('Date not initialized');

    const { data, error } = await supabase.from('food_log').insert({
      user_id: userId,
      logged_at: selectedDate,
      meal_type: food.meal_type,
      food_name: food.food_name,
      serving_size: food.serving_size,
      servings: food.servings,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      source: food.source || 'manual',
      food_id: food.food_id,
      nutritionix_id: food.nutritionix_id,
    }).select().single();

    if (error) {
      console.error('Error adding food:', error);
      throw error;
    }
    return data as FoodLogEntry;
  }

  /**
   * Insert several entries as ONE multi-row statement, so a batch ("Add all",
   * saved meal, copy yesterday, parsed items) is all-or-nothing. Separate
   * inserts under Promise.all could half-succeed: the rows that landed stayed
   * invisible (state was never updated) and a retry duplicated them.
   */
  async function insertFoodEntries(foods: FoodLogInsert[]): Promise<FoodLogEntry[]> {
    if (foods.length === 0) return [];
    const userId = await getLocalUserId(supabase);
    if (!userId) throw new Error('Not signed in');
    if (!selectedDate) throw new Error('Date not initialized');

    const { data, error } = await supabase.from('food_log').insert(
      foods.map((food) => ({
        user_id: userId,
        logged_at: selectedDate,
        meal_type: food.meal_type,
        food_name: food.food_name,
        serving_size: food.serving_size,
        servings: food.servings,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        source: food.source || 'manual',
        food_id: food.food_id,
        nutritionix_id: food.nutritionix_id,
      }))
    ).select();

    if (error) {
      console.error('Error adding foods:', error);
      throw error;
    }
    return (data ?? []) as FoodLogEntry[];
  }

  /**
   * Apply freshly inserted rows to local state instead of refetching the
   * whole 13-query loadData() tree. Keeps today's list, daily totals, and
   * the frequent-food chips in sync after a save.
   */
  function applyInsertedEntries(rows: FoodLogEntry[]) {
    if (rows.length === 0) return;
    mutateFoodEntries((prev) => [...prev, ...rows]);
    setFrequentFoods((prev) => addLoggedRowsToFrequentFoods(prev, rows, new Date().toISOString()));
  }

  /**
   * Refresh only the data a weight or target change can affect (weight list,
   * nutrition targets, adaptive TDEE) — 2 queries + 1 server action instead
   * of the full loadData() tree.
   */
  async function refreshWeightAndTargets() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 90 days to match fetchNutritionGlobal — the Weight tab's 90d chart
    // range and its range-scoped trend need the full window.
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [weightResult, targetsResult] = await Promise.all([
      supabase
        .from('weight_log')
        .select('*')
        .eq('user_id', user.id)
        .gte('logged_at', getLocalDateString(ninetyDaysAgo))
        .order('logged_at', { ascending: false }),
      supabase
        .from('nutrition_targets')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    if (weightResult.data) setWeightEntries(weightResult.data);
    if (!targetsResult.error) setNutritionTargets(targetsResult.data);

    try {
      const tdee = await getAdaptiveTDEE(targetsResult.data?.calories, undefined, getLocalDateString());
      setTdeeData(tdee);
    } catch (tdeeError) {
      console.error('[Nutrition] Error refreshing TDEE data:', tdeeError);
    }

    // Keep the cached global bundle consistent so a later remount/revalidation
    // doesn't repopulate stale weight/targets into local state.
    void queryClient.invalidateQueries({ queryKey: NUTRITION_GLOBAL_KEY });
  }

  /** Load the system food library once, on first food-modal open */
  async function ensureSystemFoodsLoaded() {
    if (systemFoodsLoadedRef.current) return;
    systemFoodsLoadedRef.current = true;

    const { data, error } = await supabase
      .from('system_foods')
      .select('id, name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Error loading system foods:', error);
      systemFoodsLoadedRef.current = false;
      return;
    }
    setSystemFoods((data as SystemFood[]) || []);
  }

  async function handleAddFood(food: FoodLogInsert & { barcode?: string }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (!selectedDate) {
      console.error('Cannot add food: date not initialized');
      return;
    }

    const inserted = await insertFoodEntry(food);
    applyInsertedEntries([inserted]);
    mutateRecentFoodsCache((prev) => [inserted, ...prev]);
    flagJustAdded([inserted]);
    // Same confirmation as the one-tap adds, plus where the day now stands:
    // "Added to Dinner · 1,640 / 2,400 kcal · 120 / 180 g protein".
    // dailyTotals is this render's (pre-insert) day, so add the new row.
    addToast(
      'success',
      addedToMealMessage(
        mealLabelFor(food.meal_type),
        {
          calories: dailyTotals.calories + (inserted.calories || 0),
          protein: dailyTotals.protein + (inserted.protein || 0),
        },
        { calories: effectiveTargets?.calories ?? null, protein: effectiveTargets?.protein ?? null }
      ),
      5000,
      { label: 'Undo', onClick: () => { void undoQuickAdd([inserted]); } }
    );

    // Save scanned barcode products to custom_foods for future search
    if (food.barcode) {
      // Check if this barcode already exists in custom_foods
      const { data: existingFood } = await supabase
        .from('custom_foods')
        .select('id')
        .eq('user_id', user.id)
        .eq('barcode', food.barcode)
        .maybeSingle();

      if (!existingFood) {
        // Store ONE base serving: the macros and the serving text are both
        // divided by the servings logged, so they describe the same amount
        // (food.serving_size is the whole logged portion, e.g. "2 serving (60g)").
        const base = customFoodFieldsFromScan(food);

        const { data: customFood, error: customError } = await supabase.from('custom_foods').insert({
          user_id: user.id,
          food_name: food.food_name,
          serving_size: base.serving_size,
          calories: base.calories,
          protein: base.protein,
          carbs: base.carbs,
          fat: base.fat,
          barcode: food.barcode,
        }).select().single();

        if (!customError && customFood) {
          setCustomFoods((prev) => [customFood as CustomFood, ...prev]);
          showSuccess('Saved to your foods');
        }
      }
    }
  }

  /**
   * Quick-add from the Recent / Meals views: re-log a snapshot into the
   * selected day WITHOUT closing the sheet, with an undo toast. Keeps the
   * per-day and recents caches consistent optimistically.
   */
  async function handleQuickAddFood(food: FoodLogInsert) {
    const inserted = await insertFoodEntry(food);
    applyInsertedEntries([inserted]);
    mutateRecentFoodsCache((prev) => [inserted, ...prev]);
    flagJustAdded([inserted]);
    addToast('success', quickAddMessage(toTitleCase(food.food_name), food.serving_size, mealLabelFor(food.meal_type)), 5000, {
      label: 'Undo',
      onClick: () => { void undoQuickAdd([inserted]); },
    });
  }

  /** "Add all" from a prior meal — one insert per item, one combined undo. */
  async function handleQuickAddManyFoods(foods: FoodLogInsert[]) {
    if (foods.length === 0) return;
    const inserted = await insertFoodEntries(foods);
    applyInsertedEntries(inserted);
    mutateRecentFoodsCache((prev) => [...inserted, ...prev]);
    flagJustAdded(inserted);
    addToast('success', `Added ${inserted.length} item${inserted.length === 1 ? '' : 's'} to ${mealLabelFor(foods[0].meal_type)}`, 6000, {
      label: 'Undo',
      onClick: () => { void undoQuickAdd(inserted); },
    });
  }

  /** The user's name for a meal slot ("Lunch", or their custom name). */
  function mealLabelFor(mealType: MealType): string {
    return getMealConfig(nutritionTargets?.meal_names).find((m) => m.type === mealType)?.label ?? mealType;
  }

  /** Undo a quick-add: delete the inserted rows and roll back both caches. */
  async function undoQuickAdd(rows: FoodLogEntry[]) {
    const ids = rows.map((r) => r.id);
    const { error } = await supabase.from('food_log').delete().in('id', ids);
    if (error) {
      console.error('Error undoing quick-add:', error);
      return;
    }
    mutateFoodEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
    mutateRecentFoodsCache((prev) => prev.filter((e) => !ids.includes(e.id)));
  }

  /** Describe flow: log all AI-parsed items to the chosen meal in parallel */
  async function handleLogParsedItems(items: ParsedMealItem[], mealType: MealType) {
    const inserted = await insertFoodEntries(
      items.map((item) => ({
        food_name: item.name,
        serving_size: item.quantity || '1 serving',
        servings: 1,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        meal_type: mealType,
        source: 'manual',
      }))
    );
    applyInsertedEntries(inserted);
  }

  /** Saved meals: one tap logs every item to the time-appropriate meal */
  async function handleLogSavedMeal(meal: SavedMeal) {
    const targetMeal = getMealTypeForNow();
    const inserted = await insertFoodEntries(
      meal.items.map((item) => ({
        food_name: item.name,
        serving_size: item.serving_size || '1 serving',
        servings: item.servings || 1,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        meal_type: targetMeal,
        source: 'manual',
      }))
    );
    applyInsertedEntries(inserted);

    const { error } = await supabase
      .from('saved_meals')
      .update({ times_logged: meal.times_logged + 1, updated_at: new Date().toISOString() })
      .eq('id', meal.id);
    if (error) {
      console.error('Error incrementing saved meal count:', error);
    }
  }

  /** Snapshot a meal's current entries into saved_meals */
  async function handleSaveMealAsSaved(meal: { type: MealType; label: string; entries: FoodLogEntry[] }) {
    if (meal.entries.length === 0 || !selectedDate) return;

    const defaultName = `${meal.label} · ${formatDate(selectedDate, { month: 'short', day: 'numeric' })}`;
    const name = window.prompt('Save meal as', defaultName);
    if (!name || !name.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const items: SavedMealItem[] = meal.entries.map((entry) => ({
      name: entry.food_name,
      serving_size: entry.serving_size || '1 serving',
      servings: entry.servings || 1,
      calories: entry.calories || 0,
      protein: entry.protein || 0,
      carbs: entry.carbs || 0,
      fat: entry.fat || 0,
    }));

    const { error } = await supabase.from('saved_meals').upsert(
      {
        user_id: user.id,
        name: name.trim(),
        items,
        total_calories: items.reduce((sum, item) => sum + item.calories, 0),
        total_protein: items.reduce((sum, item) => sum + item.protein, 0),
        total_carbs: items.reduce((sum, item) => sum + item.carbs, 0),
        total_fat: items.reduce((sum, item) => sum + item.fat, 0),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,name' }
    );

    if (error) {
      console.error('Error saving meal:', error);
      return;
    }

    showSuccess('Meal saved');
  }

  /** Copy yesterday's entries for a meal type into today */
  async function handleCopyYesterday(mealType: MealType) {
    const entries = yesterdayEntries.filter((entry) => entry.meal_type === mealType);
    if (entries.length === 0) return;

    const inserted = await insertFoodEntries(
      entries.map((entry) => ({
        food_name: entry.food_name,
        serving_size: entry.serving_size || '1 serving',
        servings: entry.servings || 1,
        calories: entry.calories || 0,
        protein: entry.protein || 0,
        carbs: entry.carbs || 0,
        fat: entry.fat || 0,
        meal_type: mealType,
        source: entry.source || 'manual',
        food_id: entry.food_id || undefined,
      }))
    );
    applyInsertedEntries(inserted);
  }

  /**
   * Frequent chip: one tap logs to the meal shown above the chips (the
   * user's last chosen meal, else the time-appropriate one), with an undo
   * toast naming that meal so it's never a silent guess.
   */
  async function handleQuickLogFrequent(
    food: FrequentFood,
    mealType: MealType,
    mealLabel: string
  ): Promise<QuickAddConfirmation> {
    // Re-log the last portion exactly as logged, so the chip's label
    // ("Oatmeal · 1 cup") is what lands in the log.
    const portion = frequentFoodPortion(food);
    const inserted = await insertFoodEntry({
      food_name: food.food_name,
      serving_size: portion.serving_size,
      servings: portion.servings,
      calories: portion.calories,
      protein: portion.protein,
      carbs: portion.carbs,
      fat: portion.fat,
      meal_type: mealType,
      source: portion.source ?? 'manual',
      food_id: portion.food_id ?? undefined,
    });
    applyInsertedEntries([inserted]);
    mutateRecentFoodsCache((prev) => [inserted, ...prev]);
    flagJustAdded([inserted]);
    // Confirmed inline under the chips (what, how much, which meal, where the
    // day now stands), not by a toast that would sit over the meal cards.
    // dailyTotals is this render's (pre-insert) day, so add the new row.
    return {
      ...quickAddConfirmation(
        toTitleCase(food.food_name),
        portion.serving_size,
        mealLabel,
        {
          calories: dailyTotals.calories + (inserted.calories || 0),
          protein: dailyTotals.protein + (inserted.protein || 0),
        },
        { calories: effectiveTargets?.calories ?? null, protein: effectiveTargets?.protein ?? null }
      ),
      onUndo: () => undoQuickAdd([inserted]),
    };
  }

  async function handleDeleteFood(id: string) {
    const entry = foodEntries.find((e) => e.id === id);
    const { error } = await supabase.from('food_log').delete().eq('id', id);

    if (error) {
      console.error('Error deleting food:', error);
      return;
    }

    mutateFoodEntries((prev) => prev.filter((e) => e.id !== id));

    if (entry) {
      addToast('info', `Removed ${toTitleCase(entry.food_name)}`, 6000, {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              const restored = await insertFoodEntry({
                food_name: entry.food_name,
                serving_size: entry.serving_size || '1 serving',
                servings: entry.servings || 1,
                calories: entry.calories || 0,
                protein: entry.protein || 0,
                carbs: entry.carbs || 0,
                fat: entry.fat || 0,
                meal_type: entry.meal_type,
                source: entry.source || 'manual',
                food_id: entry.food_id || undefined,
              });
              mutateFoodEntries((prev) => [...prev, restored]);
            } catch (restoreError) {
              console.error('Error restoring food:', restoreError);
            }
          })();
        },
      });
    }
  }

  async function handleUpdateFood(id: string, updates: {
    servings: number;
    servingSize: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    perServing?: { calories: number; protein: number; carbs: number; fat: number };
  }) {
    const { perServing, servingSize, ...logUpdates } = updates;

    const { error } = await supabase
      .from('food_log')
      .update({
        servings: logUpdates.servings,
        // Persist serving_size alongside servings/totals so a re-edit recovers
        // the same grams-per-serving instead of dividing a stale gram total by
        // the new servings count (the source of the food-record corruption).
        serving_size: servingSize,
        calories: logUpdates.calories,
        protein: logUpdates.protein,
        carbs: logUpdates.carbs,
        fat: logUpdates.fat,
      })
      .eq('id', id);

    if (error) {
      console.error('Error updating food:', error);
      throw error;
    }

    const entry = foodEntries.find((e) => e.id === id);
    mutateFoodEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...logUpdates, serving_size: servingSize } : e))
    );

    // The user hand-corrected per-serving nutrition (e.g. a barcode lookup
    // that returned calories but zero macros). Propagate the fix to the
    // matching custom_foods record so future scans/logs use the corrected
    // values. Best-effort: the log entry itself is already updated.
    if (perServing && entry) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: matches } = await supabase
          .from('custom_foods')
          .select('id')
          .eq('user_id', user.id)
          .eq('food_name', entry.food_name);

        if (matches && matches.length > 0) {
          const ids = matches.map((m: { id: string }) => m.id);
          const { error: customError } = await supabase
            .from('custom_foods')
            .update({
              calories: perServing.calories,
              protein: perServing.protein,
              carbs: perServing.carbs,
              fat: perServing.fat,
            })
            .in('id', ids);

          if (!customError) {
            setCustomFoods((prev) =>
              prev.map((f) => (ids.includes(f.id) ? { ...f, ...perServing } : f))
            );
          }
        }
      } catch (customError) {
        console.error('Error updating custom food nutrition:', customError);
      }
    }
  }

  function openEditFood(entry: FoodLogEntry) {
    setEditingFood(entry);
    setShowEditFood(true);
  }

  async function handleSaveCustomFood(food: Omit<CustomFood, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (editingCustomFood) {
      // Update existing
      const { data: updated, error } = await supabase
        .from('custom_foods')
        .update({
          food_name: food.food_name,
          serving_size: food.serving_size,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          is_per_weight: food.is_per_weight,
          reference_amount: food.reference_amount,
          reference_unit: food.reference_unit,
          calories_per_ref: food.calories_per_ref,
          protein_per_ref: food.protein_per_ref,
          carbs_per_ref: food.carbs_per_ref,
          fat_per_ref: food.fat_per_ref,
          barcode: food.barcode,
        })
        .eq('id', editingCustomFood.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating custom food:', error);
        throw error;
      }
      setCustomFoods((prev) => prev.map((f) => (f.id === editingCustomFood.id ? (updated as CustomFood) : f)));
    } else {
      // Create new
      const { data: created, error } = await supabase.from('custom_foods').insert({
        user_id: user.id,
        food_name: food.food_name,
        serving_size: food.serving_size,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        is_per_weight: food.is_per_weight,
        reference_amount: food.reference_amount,
        reference_unit: food.reference_unit,
        calories_per_ref: food.calories_per_ref,
        protein_per_ref: food.protein_per_ref,
        carbs_per_ref: food.carbs_per_ref,
        fat_per_ref: food.fat_per_ref,
        barcode: food.barcode,
      }).select().single();

      if (error) {
        console.error('Error creating custom food:', error);
        throw error;
      }
      setCustomFoods((prev) => [created as CustomFood, ...prev]);
    }
  }

  async function handleSaveWeight(weight: number, date: string, notes?: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // The modal collects the weight in the user's preferred unit
    // (users.preferences.units, loaded into `weightUnit`), so that is the unit
    // it must be stored with.
    const isLbs = weightUnit === 'lb';

    // First try to update existing entry for today
    const { data: existing, error: selectError } = await supabase
      .from('weight_log')
      .select('id')
      .eq('user_id', user.id)
      .eq('logged_at', date)
      .maybeSingle();

    if (selectError) {
      console.error('Error checking existing weight:', selectError);
    }

    let error;
    if (existing) {
      // Update existing entry - try with unit first, fall back without
      let result = await supabase.from('weight_log').update({
        weight: weight,
        unit: isLbs ? 'lb' : 'kg',
        notes: notes,
      }).eq('id', existing.id);

      // If unit column doesn't exist, try without it
      if (result.error?.message?.includes('column "unit"')) {
        result = await supabase.from('weight_log').update({
          weight: weight,
          notes: notes,
        }).eq('id', existing.id);
      }
      error = result.error;
    } else {
      // Insert new entry - try with unit first, fall back without
      let result = await supabase.from('weight_log').insert({
        user_id: user.id,
        logged_at: date,
        weight: weight,
        unit: isLbs ? 'lb' : 'kg',
        notes: notes,
      });

      // If unit column doesn't exist, try without it
      if (result.error?.message?.includes('column "unit"')) {
        result = await supabase.from('weight_log').insert({
          user_id: user.id,
          logged_at: date,
          weight: weight,
          notes: notes,
        });
      }
      error = result.error;
    }

    if (error) {
      console.error('Error saving weight:', error);
      throw error;
    }

    // Auto-recalculate TDEE and sync with targets
    try {
      // Pass the client's local day: the action runs in the server's time
      // zone, where "today" can still be yesterday and exclude this weigh-in.
      const tdeeResult = await onWeightLoggedRecalculateTDEE(getLocalDateString());
      if (tdeeResult.syncResult?.synced && tdeeResult.syncResult.newCalories) {
        setMacroUpdateNotification(
          `Targets updated from your measured daily burn: ${tdeeResult.syncResult.newCalories} cal - ${tdeeResult.syncResult.message}`
        );
        setTimeout(() => setMacroUpdateNotification(null), 6000);
      } else if (tdeeResult.syncResult?.message && tdeeResult.estimate) {
        // Show progress message even if not synced
        setMacroUpdateNotification(tdeeResult.syncResult.message);
        setTimeout(() => setMacroUpdateNotification(null), 4000);
      }
    } catch (e) {
      console.error('Failed to recalculate TDEE/macros:', e);
    }

    await refreshWeightAndTargets();
  }

  async function handleUpdateWeight(weight: number, date: string, notes?: string) {
    if (!editingWeight) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Prepare weight for storage - convert from user's input unit to storage format
    // We store weights in the user's preferred unit (weightUnit) for consistency
    const storageWeight = prepareWeightForStorage(weight, weightUnit, weightUnit);

    const { error } = await supabase
      .from('weight_log')
      .update({
        weight: storageWeight.weight,
        unit: storageWeight.unit,
        logged_at: date,
        notes: notes || null,
      })
      .eq('id', editingWeight.id);

    if (error) {
      console.error('Error updating weight:', error);
      throw error;
    }

    setEditingWeight(null);
    await refreshWeightAndTargets();
  }

  async function handleDeleteWeight(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('weight_log')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting weight:', error);
      throw error;
    }

    setWeightEntries((prev) => prev.filter((e) => e.id !== id));
    await refreshWeightAndTargets();
  }

  async function handleSaveTargets(targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meals_per_day?: number;
    meal_names?: MealNames;
    cardio_prescription?: any;
  }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Try to update existing record first
    const { data: existing } = await supabase
      .from('nutrition_targets')
      .select('id')
      .eq('user_id', user.id)
      .single();

    let error;
    if (existing) {
      // Update existing
      const result = await supabase
        .from('nutrition_targets')
        .update({
          calories: targets.calories,
          protein: targets.protein,
          carbs: targets.carbs,
          fat: targets.fat,
          meals_per_day: targets.meals_per_day || 3,
          meal_names: targets.meal_names || null,
          cardio_prescription: targets.cardio_prescription || null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
      error = result.error;
    } else {
      // Insert new
      const result = await supabase.from('nutrition_targets').insert({
        user_id: user.id,
        calories: targets.calories,
        protein: targets.protein,
        carbs: targets.carbs,
        fat: targets.fat,
        meals_per_day: targets.meals_per_day || 3,
        meal_names: targets.meal_names || null,
        cardio_prescription: targets.cardio_prescription || null,
      });
      error = result.error;
    }

    if (error) {
      console.error('Error saving targets:', error);
      throw error;
    }

    // Refresh targets + TDEE without reloading the whole page tree
    await refreshWeightAndTargets();
  }

  /**
   * Targets typed in by hand (NutritionTargetsModal). Saving them also turns
   * off automatic target updates, so the adaptive TDEE sync never replaces
   * numbers the user chose; applying the macro calculator turns them back on.
   */
  async function handleSaveManualTargets(targets: Parameters<typeof handleSaveTargets>[0]) {
    await handleSaveTargets(targets);
    try {
      const result = await setMacroAutoUpdateEnabled(false);
      if (!result.success) {
        console.error('Failed to disable automatic target updates:', result.error);
      }
    } catch (e) {
      console.error('Failed to disable automatic target updates:', e);
    }
    void queryClient.invalidateQueries({ queryKey: NUTRITION_GLOBAL_KEY });
  }

  function openAddFood(mealType: MealType, tab: AddFoodTab = 'search') {
    void ensureSystemFoodsLoaded();
    setRecentsEnabled(true); // latch on the recents/meals query
    setSelectedMealType(mealType);
    setQuickMeal(mealType);
    setAddFoodTab(tab);
    setShowAddFood(true);
  }

  function changeDate(delta: number) {
    if (!selectedDate) return; // Guard: don't change date if not initialized
    // Use T00:00:00 to force local timezone interpretation (not UTC)
    const date = new Date(selectedDate + 'T00:00:00');
    date.setDate(date.getDate() + delta);
    setSelectedDate(getLocalDateString(date));
  }


  // Daily totals + remaining/hit/over verdicts — single source of truth
  // shared by the hero MacroSummaryCard and the sticky bar
  // Step-adjusted target (opt-in, Activity settings → "Step-adjusted"). Only
  // the deviation from the user's own step average moves it — see
  // lib/nutrition/step-calorie-adjustment.ts. The stored target stays the
  // source of truth for editing; this is the day's effective target.
  const stepAdjustment = useStepCalorieAdjustment(selectedDate, nutritionTargets?.calories);
  const [showActivitySettings, setShowActivitySettings] = useState(false);
  const effectiveTargets = useMemo<NutritionTargets | null>(
    () =>
      nutritionTargets && stepAdjustment?.adjustment
        ? applyAdjustmentToMacros(nutritionTargets, stepAdjustment.adjustment)
        : nutritionTargets,
    [nutritionTargets, stepAdjustment?.adjustment]
  );
  // "How this is set": the inputs behind the stored (base) calorie target.
  // Only values that reproduce it — see lib/nutrition/targetBasis.
  const macroSettings = globalQuery.data?.macroSettings;
  const targetBasis = useMemo(() => {
    if (macroSettings === undefined) return null; // not loaded / older cache
    const latestLbs = userProfile.weightLbs;
    const adaptive = tdeeData?.adaptiveEstimate;
    return describeTargetBasis({
      targets: nutritionTargets,
      settings: macroSettings,
      weightKg: latestLbs ? latestLbs / 2.20462 : null,
      bodyFatPercent: userProfile.bodyFatPercent ?? null,
      measuredBurnKcal: adaptive?.confidence === 'stable' ? adaptive.estimatedTDEE : null,
      measuredWeightKg: tdeeData?.currentWeight ? tdeeData.currentWeight / 2.20462 : null,
      units: weightUnit,
    });
  }, [macroSettings, nutritionTargets, userProfile.weightLbs, userProfile.bodyFatPercent, tdeeData, weightUnit]);
  const dailySummary = useDailyNutritionSummary(foodEntries, effectiveTargets);
  const dailyTotals = dailySummary.totals;

  // iOS "Calories & protein" widget (no-op elsewhere). Only today's real
  // rows count: not a past day, nor keepPreviousData's placeholder.
  useEffect(() => {
    const calories = effectiveTargets?.calories;
    const protein = effectiveTargets?.protein;
    if (calories == null || protein == null || selectedDate !== getLocalDateString()) return;
    if (!dayQuery.isSuccess || dayQuery.isPlaceholderData) return;
    void updateNutritionWidget({
      caloriesLeft: calories - dailyTotals.calories,
      caloriesTarget: calories,
      proteinLeft: protein - dailyTotals.protein,
      proteinTarget: protein,
      path: '/dashboard/nutrition',
    });
  }, [effectiveTargets?.calories, effectiveTargets?.protein, selectedDate, dayQuery.isSuccess, dayQuery.isPlaceholderData, dailyTotals.calories, dailyTotals.protein]);

  // Eating window drives the nutrition share's intraday pacing. Read from the
  // nutrition_targets row (07:00–21:00 default when unset/unmigrated); the
  // columns aren't on the NutritionTargets type yet, hence the cast.
  const eatingWindow = useMemo<EatingWindow>(() => {
    const start = (nutritionTargets as { eating_window_start_min?: number | null } | null)
      ?.eating_window_start_min;
    const end = (nutritionTargets as { eating_window_end_min?: number | null } | null)
      ?.eating_window_end_min;
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      return { startMinutes: start, endMinutes: end };
    }
    return DEFAULT_EATING_WINDOW;
  }, [nutritionTargets]);

  // Get meal config with custom names
  const mealConfig = getMealConfig(nutritionTargets?.meal_names);

  // Group entries by meal type
  const mealGroups = mealConfig.map((meal) => ({
    ...meal,
    entries: foodEntries.filter((e) => e.meal_type === meal.type),
  }));

  // Existing remaining-per-meal math (feeds MacroSummaryCard)
  const mealsPerDay = nutritionTargets?.meals_per_day || 3;
  const mealsLogged = mealGroups.filter((m) => m.entries.length > 0).length;
  const mealsRemaining = Math.max(0, mealsPerDay - mealsLogged);

  // "~X calories available" hint on empty meal cards. Split the remaining
  // daily budget across the meal cards that are still empty (not meals_per_day,
  // which can leave an empty card showing nothing once that target is reached).
  const remainingCalories = effectiveTargets?.calories
    ? Math.round(effectiveTargets.calories - dailyTotals.calories)
    : 0;
  const emptyMealCount = mealGroups.filter((m) => m.entries.length === 0).length;
  const perMealAvailable =
    remainingCalories > 0 && emptyMealCount > 0
      ? Math.round(remainingCalories / emptyMealCount)
      : 0;

  // Top frequent foods across meals for the one-tap chips row
  const chipMap = new Map<string, { food: FrequentFood; count: number }>();
  for (const food of frequentFoods) {
    const existing = chipMap.get(food.food_name);
    if (existing) {
      existing.count += food.times_logged;
    } else {
      chipMap.set(food.food_name, { food, count: food.times_logged });
    }
  }
  const frequentChips = Array.from(chipMap.values())
    .filter((chip) => chip.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((chip) => chip.food);

  // Use unified weight utility - all weight operations now use lib/weightUtils.ts

  // Calculate 7-day weight average (with unit validation and conversion)
  // The last 7 CALENDAR days (today and the 6 before), not the last 7 entries:
  // with sparse weigh-ins the latter silently spans weeks.
  const sevenDayWindowStart = addLocalDays(getLocalDateString(), -6);
  const last7Days = weightEntries.filter(
    (e) => typeof e.logged_at === 'string' && e.logged_at.slice(0, 10) >= sevenDayWindowStart
  );
  const sevenDayAverage =
    last7Days.length > 0
      ? last7Days.reduce((sum, e) => {
          const validatedWeight = getDisplayWeight(e.weight, (e as any).unit as 'lb' | 'kg' | null, weightUnit);
          return sum + validatedWeight;
        }, 0) / last7Days.length
      : null;

  // Weekly trend rate vs the goal-implied target — the SAME shared helper the
  // home "Weight" glance tile uses, so the "+3.8 lb/wk · target +0.5" the
  // user tapped is the number this tab shows. The regression window follows
  // the chart's 7d/14d/30d/90d toggle so the rate describes what's plotted.
  const weightTrendRate = computeWeightRate(
    weightEntries.map((e) => ({
      date: e.logged_at,
      weight: e.weight,
      unit: ((e as any).unit as string | null) || weightUnit,
    })),
    weightUnit,
    currentPhase ?? 'maintenance',
    WEIGHT_CHART_RANGE_DAYS[weightChartRange]
  );
  const weightRateOnTrack =
    !weightTrendRate || weightTrendRate.target === null || weightTrendRate.target === 0
      ? true
      : Math.sign(weightTrendRate.perWeek) === Math.sign(weightTrendRate.target);
  const signedRate = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
  // The burn the "Your metabolism" card shows (interval estimate first), so
  // the trends explanation and the card quote the same number.
  const trendsBurnKcal =
    tdeeData?.intervalEstimate?.estimatedTDEE ?? tdeeData?.bestEstimate?.estimatedTDEE ?? null;

  // Prepare weight chart data (with unit validation and conversion)
  // Sort by date ascending (oldest first) for proper graph display
  const weightChartCutoff = new Date();
  weightChartCutoff.setDate(weightChartCutoff.getDate() - WEIGHT_CHART_RANGE_DAYS[weightChartRange]);
  const weightChartEntries = [...weightEntries]
    .filter((entry) => new Date(entry.logged_at) >= weightChartCutoff)
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime());
  // Include the year in tick labels only when the range crosses a year boundary.
  const weightChartSpansYear =
    weightChartEntries.length > 0 &&
    new Date(weightChartEntries[0].logged_at).getFullYear() !==
      new Date(weightChartEntries[weightChartEntries.length - 1].logged_at).getFullYear();
  const weightChartData = weightChartEntries.map((entry) => {
    // Use logged_at directly as date string to avoid timezone issues
    const dateStr = entry.logged_at;
    const validatedWeight = getDisplayWeight(entry.weight, (entry as any).unit as 'lb' | 'kg' | null, weightUnit);

    return {
      date: dateStr,
      displayDate: formatChartTickDate(dateStr, weightChartSpansYear),
      weight: Number(validatedWeight.toFixed(1)),
    };
  });

  // Handle null date in rendering
  // CRITICAL: Server and client must render identical HTML to prevent hydration errors
  // Return null on server, loading state only after client mount
  if (typeof window === 'undefined') {
    // Server: return minimal placeholder that matches client's first render
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-action border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-ink-2">Loading...</p>
        </div>
      </div>
    );
  }

  // Client: show loading until mounted and date is set
  if (!isMounted || !selectedDate) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-action border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-ink-2">Loading...</p>
        </div>
      </div>
    );
  }

  // Calculate date display - now safe because we're only here after mount and date is set
  const todayDateString = getLocalDateString();
  const isToday = selectedDate === todayDateString;
  const dateDisplay = isToday
    ? 'Today'
    : new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
  const timeMealType = getMealTypeForNow();
  const timeMealLabel = mealConfig.find((meal) => meal.type === timeMealType)?.label || 'Snacks';
  const chipMealType = quickMeal ?? timeMealType;
  const chipMealLabel = mealConfig.find((meal) => meal.type === chipMealType)?.label || 'Snacks';

  // Has the user weighed in today? Drives the Weight-tab reminder dot and CTAs.
  const todayWeightEntry = weightEntries.find((entry) => entry.logged_at === todayDateString);
  const hasLoggedWeightToday = !!todayWeightEntry;
  const todayWeightDisplay = todayWeightEntry
    ? getDisplayWeight(todayWeightEntry.weight, (todayWeightEntry as any).unit as 'lb' | 'kg' | null, weightUnit).toFixed(1)
    : null;

  // The cold-start state is reserved for first-ever load with an empty persisted
  // cache. Date switches (keepPreviousData) and warm reloads (IndexedDB) never
  // reach this — they render chrome + skeletons or cached data instead.
  if (isColdStart) {
    return (
      <div className="max-w-7xl mx-auto" data-testid="nutrition-full-loading">
        {isTrends ? <PageSkeleton title="Weight & trends" /> : <NutritionLoading />}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4" suppressHydrationWarning>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Macro Update Notification */}
      {macroUpdateNotification && (
        <div className="bg-status-ok-tint rounded-card px-4 py-3 flex items-center justify-between">
          <span className="text-status-ok text-subhead">{macroUpdateNotification}</span>
          <button
            onClick={() => setMacroUpdateNotification(null)}
            className="text-status-ok hover:text-status-ok"
            aria-label="Dismiss notification"
          >
            <IconX size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Weight & trends is a pushed screen: back bar instead of the Eat header */}
      {isTrends && (
        <div className="flex items-center gap-1" data-testid="trends-nav">
          <button
            type="button"
            onClick={backToEat}
            className="-ml-2 flex min-h-[44px] items-center gap-0.5 pr-2 text-body text-action"
          >
            <IconChevronLeft size={22} aria-hidden="true" />
            Eat
          </button>
          <h1 className="flex-1 text-center text-headline text-ink pr-14">Weight &amp; trends</h1>
        </div>
      )}

      {/* Header: title left, date nav + settings right */}
      <div className={isTrends ? 'hidden' : 'flex items-center justify-between gap-2'}>
        <h1 className="text-large-title text-ink">Eat</h1>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => changeDate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-ink shadow-card"
            aria-label="Previous day"
          >
            <IconChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            onClick={() => setShowCalendar(true)}
            className="h-9 min-w-[72px] rounded-full bg-card px-3.5 text-center text-body font-semibold text-ink shadow-card"
            title="Open calendar"
            aria-label={`${dateDisplay} — open calendar`}
            suppressHydrationWarning
          >
            {dateDisplay}
          </button>
          <button
            onClick={() => changeDate(1)}
            disabled={isToday}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-ink shadow-card disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next day"
          >
            <IconChevronRight size={18} aria-hidden="true" />
          </button>

          {/* Share the day's macros as Wordle-style text (today, once targets exist) */}
          {isToday && dailySummary.hasTargets && (
            <ShareNutritionText
              totals={dailyTotals}
              targets={{
                calories: effectiveTargets?.calories ?? null,
                protein: effectiveTargets?.protein ?? null,
                carbs: effectiveTargets?.carbs ?? null,
                fat: effectiveTargets?.fat ?? null,
              }}
              phase={currentPhase}
              phaseWeek={mesoWeek}
              mealsLogged={mealsLogged}
              eatingWindow={eatingWindow}
            />
          )}

          {/* Settings menu: macro setup + weight + custom foods */}
          <div className="relative">
            <button
              onClick={() => setShowSettingsMenu((open) => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-ink-2 shadow-card hover:text-ink"
              aria-label="Nutrition options"
            >
              <IconSettings size={18} aria-hidden="true" />
            </button>
            {showSettingsMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowSettingsMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-56 overflow-hidden rounded-card bg-card py-1 shadow-float">
                  {[
                    { label: 'Calculate macros', action: () => setShowMacroCalculator(true) },
                    { label: nutritionTargets ? 'Edit targets' : 'Enter targets manually', action: () => setShowTargetsModal(true) },
                    { label: 'Log weight', action: () => setShowWeightLog(true) },
                    { label: 'Add custom food', action: () => setShowCreateCustomFood(true) },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        setShowSettingsMenu(false);
                        item.action();
                      }}
                      className="w-full min-h-[44px] px-3.5 text-left text-body text-ink hover:bg-fill transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---- Food Log tab ---- */}
      {/* Tabs hide via CSS (not unmount) so graphs/steps keep their state across switches */}
      {!isTrends && (
      <div className="space-y-4">

      {/* Condensed remaining-macros bar, slides in under the app header once
          the hero card scrolls away (overlays the meal list — no layout shift) */}
      <StickyMacroBar summary={dailySummary} watchRef={heroCardRef} />

      {/* Macro summary (replaces the 4-box grid + remaining-calories section).
          keepPreviousData shows the prior day while a never-fetched day loads;
          skeleton the numbers rather than flash another day's totals. */}
      <div ref={heroCardRef} data-testid="nutrition-macro-summary">
        {isDaySwitching ? (
          <MacroNumbersSkeleton />
        ) : (
          <MacroSummaryCard
            totals={dailyTotals}
            targets={effectiveTargets}
            mealsRemaining={mealsRemaining}
            onCalculateMacros={() => setShowMacroCalculator(true)}
            onEnterManually={() => setShowTargetsModal(true)}
          />
        )}
        {!isDaySwitching && stepAdjustment && (
          <p
            className="mt-2 px-1 text-subhead text-ink-2 tabular-nums"
            data-testid="step-adjustment-reason"
          >
            <IconShoe size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />
            {stepAdjustment.adjustment !== 0
              ? `Target ${stepAdjustment.adjustedCalories.toLocaleString()} kcal (base ${stepAdjustment.baseCalories.toLocaleString()}). ${stepAdjustment.reason}. `
              : `${stepAdjustment.reason}. `}
            <button
              type="button"
              onClick={() => setShowActivitySettings(true)}
              className="font-semibold text-action"
              data-testid="step-adjustment-settings-link"
            >
              Change
            </button>
          </p>
        )}
        {!isDaySwitching && !stepAdjustment && dailySummary.hasTargets && (
          <p className="mt-2 px-1 text-subhead">
            <button
              type="button"
              onClick={() => setShowActivitySettings(true)}
              className="text-ink-2 hover:text-action"
              data-testid="step-adjustment-settings-link"
            >
              <IconShoe size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />
              Adjust your target for daily steps
            </button>
          </p>
        )}
        {!isDaySwitching && targetBasis && dailySummary.hasTargets && (
          <TargetBasisDisclosure
            basis={targetBasis}
            onChangeTargets={() =>
              targetBasis.source === 'manual' ? setShowTargetsModal(true) : setShowMacroCalculator(true)
            }
          />
        )}
      </div>

      {/* Quick actions: Describe / Scan / Search / Meals */}
      <MealReminderPrompt />

      <NutritionQuickActions
        onDescribe={() => setShowDescribeMeal(true)}
        onScan={() => openAddFood(chipMealType, 'barcode')}
        onSearch={() => openAddFood(chipMealType, 'search')}
        onMeals={() => setShowSavedMeals(true)}
      />

      {/* Recent-food chips: one tap logs the last-logged portion to the meal
          named above them; a line under the row confirms what was added, to
          which meal, with the day's total and Undo, and the meal card lights up. */}
      <QuickAddChips
        foods={frequentChips}
        mealType={chipMealType}
        mealLabel={chipMealLabel}
        meals={mealConfig}
        onMealChange={setQuickMeal}
        onAdd={(food) => handleQuickLogFrequent(food, chipMealType, chipMealLabel)}
        mealIsTimeDefault={quickMeal === null}
        formatName={toTitleCase}
      />

      {/* Meal sections */}
      <div className="space-y-3">
        {isDaySwitching
          ? mealConfig.map((meal) => <MealSectionSkeleton key={meal.type} />)
          : (isToday
              ? [...mealGroups].sort((a, b) => Number(b.type === timeMealType) - Number(a.type === timeMealType))
              : mealGroups
            ).map((meal) => {
          const mealCalories = Math.round(meal.entries.reduce((sum, e) => sum + (e.calories || 0), 0));
          const mealProtein = Math.round(meal.entries.reduce((sum, e) => sum + (e.protein || 0), 0));
          const mealCarbs = Math.round(meal.entries.reduce((sum, e) => sum + (e.carbs || 0), 0));
          const mealFat = Math.round(meal.entries.reduce((sum, e) => sum + (e.fat || 0), 0));
          const yesterdayHasEntries = yesterdayEntries.some((e) => e.meal_type === meal.type);
          const hasEntries = meal.entries.length > 0;
          const hasMenuActions = hasEntries || yesterdayHasEntries;
          // A quick add just landed here: outline the card and say so in its
          // header, next to the count that just changed.
          const mealJustAdded = meal.entries.some((e) => justAddedIds.has(e.id));

          return (
            <div
              key={meal.type}
              data-meal-section={meal.type}
              data-just-added={mealJustAdded ? 'true' : undefined}
              className={`rounded-card bg-card p-4 shadow-card transition-shadow ${
                mealJustAdded ? 'ring-2 ring-status-ok/60' : ''
              }`}
            >
              {/* Header: "{Meal}: {kcal} cals" + macro breakdown + overflow menu */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-headline text-ink truncate">
                    {meal.label}
                    {hasEntries && (
                      <span className="text-subhead font-normal text-ink-2 tabular-nums"> · {mealCalories.toLocaleString()} kcal</span>
                    )}
                    {mealJustAdded && (
                      <span className="ml-1.5 text-subhead font-medium text-status-ok" data-testid="meal-just-added">
                        <IconCheck size={14} className="inline -mt-0.5" aria-hidden="true" /> Added
                      </span>
                    )}
                  </h3>
                  <p className="text-subhead text-ink-2 mt-0.5 tabular-nums">
                    {hasEntries
                      ? `${mealFat}g fat · ${mealCarbs}g carbs · ${mealProtein}g protein`
                      : perMealAvailable > 0
                        ? // Today's calories left, split across the meals not logged yet
                          // — say it's a budget, or an unlogged meal reads like a
                          // placeholder total (panel, polish lens).
                          `Nothing logged yet · room for ~${perMealAvailable.toLocaleString()} kcal`
                        : 'Nothing logged yet'}
                  </p>
                </div>
                {hasMenuActions && (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setOpenMealMenu(openMealMenu === meal.type ? null : meal.type)}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-fill hover:text-ink"
                      aria-label={`${meal.label} options`}
                    >
                      <IconDots size={18} aria-hidden="true" />
                    </button>
                    {openMealMenu === meal.type && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setOpenMealMenu(null)} />
                        <div className="absolute right-0 top-full mt-1 z-40 w-56 overflow-hidden rounded-card bg-card py-1 shadow-float">
                          {hasEntries && (
                            <button
                              onClick={() => {
                                setOpenMealMenu(null);
                                void handleSaveMealAsSaved(meal);
                              }}
                              className="w-full min-h-[44px] px-3.5 flex items-center gap-2 text-left text-body text-ink hover:bg-fill transition-colors"
                            >
                              <IconBookmarkPlus size={15} aria-hidden="true" />
                              Save as meal
                            </button>
                          )}
                          {yesterdayHasEntries && (
                            <button
                              onClick={() => {
                                setOpenMealMenu(null);
                                void handleCopyYesterday(meal.type);
                              }}
                              className="w-full min-h-[44px] px-3.5 flex items-center gap-2 text-left text-body text-ink hover:bg-fill transition-colors"
                            >
                              <IconCopy size={15} aria-hidden="true" />
                              Copy from yesterday
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Entry rows: name over serving, calories right; swipe-to-delete + tap-to-edit */}
              {hasEntries && (
                <div className="mt-2">
                  {meal.entries.map((entry) => (
                    <SwipeableRow
                      key={entry.id}
                      onDelete={() => handleDeleteFood(entry.id)}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openEditFood(entry);
                        }}
                        data-food-entry-id={entry.id}
                        data-just-added={justAddedIds.has(entry.id) ? 'true' : undefined}
                        className={`w-full flex items-center justify-between gap-4 py-2 px-1 rounded-input active:bg-fill transition-colors text-left ${
                          justAddedIds.has(entry.id) ? 'motion-safe:animate-row-added motion-reduce:bg-status-ok/15' : ''
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <FoodEmojiAvatar name={entry.food_name} />
                          <div className="min-w-0">
                            <div className="text-body text-ink truncate">
                              {toTitleCase(entry.food_name)}
                            </div>
                            <div className="text-subhead text-ink-2 truncate">
                              {entry.servings !== 1 ? `${entry.servings} × ` : ''}{entry.serving_size}
                            </div>
                          </div>
                        </div>
                        <span className="text-body text-ink flex-shrink-0 tabular-nums">
                          {Math.round(entry.calories).toLocaleString()}
                        </span>
                      </button>
                    </SwipeableRow>
                  ))}
                </div>
              )}

              {/* Add Food pill */}
              <div className={`flex justify-end ${hasEntries ? 'mt-2' : 'mt-3'}`}>
                <StyledButton
                  onClick={() => openAddFood(meal.type)}
                  variant="secondary"
                  size="sm"
                  aria-label={`Add food to ${meal.label}`}
                >
                  <IconPlus size={16} aria-hidden="true" />
                  Add food
                </StyledButton>
              </div>
            </div>
          );
        })}
      </div>

      {/* Weight & trends: the old Weight and Insights tabs, one tap away */}
      <ListGroup>
        <ListRow
          title="Weight & trends"
          subtitle={
            isToday && !hasLoggedWeightToday ? (
              <span className="text-status-warn">No weigh-in yet today</span>
            ) : todayWeightDisplay ? (
              `Today ${todayWeightDisplay} ${weightUnit} · energy burn, trends`
            ) : (
              'Weight, energy burn, nutrition trends'
            )
          }
          onClick={openTrends}
          trailing={
            <span className="flex items-center gap-1">
              {isToday && !hasLoggedWeightToday && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowWeightLog(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowWeightLog(true);
                    }
                  }}
                  className="px-2 py-1 text-body font-semibold text-action"
                  data-testid="log-weight-inline"
                >
                  Log
                </span>
              )}
              <IconChevronRight size={16} className="text-ink-3" aria-hidden="true" />
            </span>
          }
        />
      </ListGroup>

      </div>
      )}
      {/* ---- end Food Log tab ---- */}

      {/* ---- Weight tab ---- */}
      {isTrends && (
      <div className="space-y-4">

      {/* Log / update today's weight CTA */}
      <button
        onClick={() => setShowWeightLog(true)}
        className="w-full flex items-center justify-between gap-3 rounded-2xl border border-action/40 bg-action/10 p-4 hover:bg-action/20 transition-colors"
      >
        <span className="flex items-center gap-3 min-w-0">
          <IconScale size={22} className="text-action flex-shrink-0" aria-hidden="true" />
          <span className="text-left min-w-0">
            <span className="block text-body font-semibold text-ink">
              {hasLoggedWeightToday ? "Update today's weight" : "Log today's weight"}
            </span>
            <span className="block text-caption text-ink-2 truncate">
              {hasLoggedWeightToday
                ? `Logged today: ${todayWeightDisplay} ${weightUnit}`
                : 'Weigh in a few times a week to track your trend and keep your estimated daily burn accurate'}
            </span>
          </span>
        </span>
        <StyledButton
          variant="primary"
          size="sm"
          className="rounded-full px-4 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setShowWeightLog(true);
          }}
        >
          {hasLoggedWeightToday ? 'Update' : 'Log'}
        </StyledButton>
      </button>

      {/* Weight Trend */}
      {weightEntries.length === 0 && (
        <EmptyState
          icon={<IconScale size={28} aria-hidden="true" />}
          title="Start tracking your weight"
          description="Log weigh-ins a few times a week to track your trend and keep your estimated daily burn accurate. Consistent data helps us calculate your true maintenance calories."
          action={
            <Button variant="primary" onClick={() => setShowWeightLog(true)}>
              Log Your First Weigh-In
            </Button>
          }
        />
      )}
      {weightEntries.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Weight trend</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWeightHistory(true)}
              >
                View history
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div>
                  <div className="text-subhead text-ink-2">Current weight</div>
                  <div className="text-title font-bold text-ink">
                    {weightEntries[0] ? getDisplayWeight(weightEntries[0].weight, (weightEntries[0] as any)?.unit as 'lb' | 'kg' | null, weightUnit).toFixed(1) : '0.0'} {weightUnit}
                  </div>
                  <div className="text-caption text-ink-2">
                    {new Date(weightEntries[0]?.logged_at).toLocaleDateString()}
                  </div>
                </div>
                {sevenDayAverage && (
                  <div>
                    <div className="text-subhead text-ink-2">7-Day Average</div>
                    <div className="text-headline font-semibold text-ink">
                      {sevenDayAverage.toFixed(1)} {weightUnit}
                    </div>
                  </div>
                )}
                {weightTrendRate && (
                  <div>
                    <div className="text-subhead text-ink-2">Trend ({weightChartRange})</div>
                    <div
                      className={`text-headline font-semibold ${
                        weightRateOnTrack ? 'text-status-ok' : 'text-status-warn'
                      }`}
                    >
                      {signedRate(weightTrendRate.perWeek)} {weightUnit}/wk
                    </div>
                    {weightTrendRate.target !== null && (
                      <div className="text-caption text-ink-2">
                        target {signedRate(weightTrendRate.target)} {weightUnit}/wk (
                        {currentPhase === 'bulk' ? 'bulk' : 'cut'})
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <div className="flex justify-end mb-2">
                  <div className="flex gap-1 bg-fill rounded-lg p-0.5">
                    {(Object.keys(WEIGHT_CHART_RANGE_DAYS) as WeightChartRange[]).map((range) => (
                      <button
                        key={range}
                        onClick={() => setWeightChartRange(range)}
                        className={`px-2 py-1 text-caption rounded-md transition-colors ${
                          weightChartRange === range
                            ? 'bg-action text-on-action'
                            : 'text-ink-2 hover:text-ink'
                        }`}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>
                {weightChartData.length === 0 && (
                  <div className="flex h-[200px] items-center justify-center">
                    <p className="text-subhead text-ink-2">No weight data for this period</p>
                  </div>
                )}
                {weightChartData.length > 0 && (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={weightChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                      <XAxis
                        dataKey="displayDate"
                        stroke="#888"
                        style={{ fontSize: '11px' }}
                        interval={0}
                        minTickGap={0}
                        tickFormatter={(value: string, index: number) =>
                          showDateTick(
                            index,
                            weightChartData.length,
                            dateTickStep(WEIGHT_CHART_RANGE_DAYS[weightChartRange])
                          )
                            ? value
                            : ''
                        }
                        angle={-35}
                        textAnchor="end"
                        height={44}
                        tickMargin={6}
                      />
                      <YAxis
                        stroke="#888"
                        style={{ fontSize: '12px' }}
                        domain={['dataMin - 2', 'dataMax + 2']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1a1a1a',
                          border: '1px solid #333',
                          borderRadius: '8px',
                        }}
                        labelFormatter={(value) => {
                          // Find the entry for this date to show the actual logged date
                          const entry = weightChartData.find((d) => d.displayDate === value);
                          return entry ? formatDate(entry.date) : value;
                        }}
                        formatter={(value: number) => [
                          `${value.toFixed(1)} ${weightUnit}`,
                          'Weight',
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="weight"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ fill: '#3b82f6', r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      </div>
      )}
      {/* ---- end Weight tab ---- */}

      {/* ---- Insights tab ---- */}
      {isTrends && (
      <div className="space-y-4">

      {/* Nutrition Trends Graph, with what "under goal" means and how logged
          intake vs estimated burn compares with the weight trend above. */}
      <NutritionTrendGraph
        targets={nutritionTargets}
        estimatedBurnKcal={trendsBurnKcal}
        burnSettling={tdeeData?.intervalEstimate ? tdeeData.intervalEstimate.confidence !== 'stable' : true}
        observedWeightPerWeek={weightTrendRate?.perWeek ?? null}
        weightUnit={weightUnit}
      />

      {/* Metabolism details (burn estimate, how it's worked out, steps) sit
          behind one disclosure: the page leads with weight and rate.
          Panel finding (r19): "cluttered with metabolism details I didn't need". */}
      <button
        type="button"
        onClick={() => setTrendsMoreOpen(!trendsMoreOpen)}
        aria-expanded={trendsMoreOpen}
        aria-controls="trends-more"
        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-card p-4 text-left shadow-card hover:bg-fill transition-colors"
        data-testid="trends-more-toggle"
      >
        <span className="min-w-0">
          <span className="block text-body font-semibold text-ink">More: energy burn &amp; steps</span>
          <span className="block text-caption text-ink-2">
            {trendsBurnKcal
              ? `Estimated burn ~${Math.round(trendsBurnKcal).toLocaleString('en-US')} kcal a day, how it's worked out, and steps`
              : "How your daily burn is worked out, and steps"}
          </span>
        </span>
        <IconChevronRight
          size={20}
          aria-hidden="true"
          className={`flex-shrink-0 text-ink-3 transition-transform ${trendsMoreOpen ? 'rotate-90' : ''}`}
        />
      </button>

      {trendsMoreOpen && (
      <div id="trends-more" className="space-y-4" data-testid="trends-more">
      {/* Step Tracking */}
      {(() => {
        // Calculate userWeightKg from current weight or weight entries
        let userWeightKg = 80; // Default fallback
        if (tdeeData?.currentWeight) {
          // Convert from lbs to kg
          userWeightKg = tdeeData.currentWeight / 2.20462;
        } else if (weightEntries && weightEntries.length > 0) {
          const latestWeight = weightEntries[0];
          const weightValue = latestWeight.weight || 0;
          const entryUnit = latestWeight.unit || weightUnit || 'lb';
          userWeightKg = entryUnit === 'kg' ? weightValue : weightValue * 0.453592;
        }
        return (
          <StepTracking
            date={selectedDate}
            userWeightKg={userWeightKg}
          />
        );
      })()}

      {/* Adaptive TDEE Dashboard */}
      {tdeeData && (
        <TDEEDashboard
          estimate={tdeeData.adaptiveEstimate}
          formulaEstimate={tdeeData.formulaEstimate}
          intervalEstimate={tdeeData.intervalEstimate}
          predictions={tdeeData.predictions}
          dataQuality={tdeeData.dataQuality}
          currentWeight={tdeeData.currentWeight}
          heightCm={heightCm}
          bodyFatPercent={userProfile.bodyFatPercent || null}
          avgDailyProteinGrams={avgDailyProteinGrams}
          avgWeeklyTrainingSets={avgWeeklyTrainingSets}
          trainingAge={trainingAge}
          isEnhanced={tdeeData.isEnhanced}
          biologicalSex={userProfile.sex || 'male'}
          chronologicalAge={userAge}
          latestDexaScan={latestDexaScan}
          scanPairPRatios={scanPairPRatios}
          regressionAnalysis={tdeeData.regressionAnalysis}
          targetCalories={nutritionTargets?.calories}
          onRefresh={() => {
            void queryClient.invalidateQueries({ queryKey: NUTRITION_GLOBAL_KEY });
            if (selectedDate) {
              void queryClient.invalidateQueries({ queryKey: nutritionDayKey(selectedDate) });
            }
          }}
          onSetTarget={() => setShowMacroCalculator(true)}
          onReset={resetAndRecalculateTDEE}
          weightUnit={weightUnit}
          showFfmi={!foodOnly}
        />
      )}
      </div>
      )}

      </div>
      )}
      {/* ---- end Insights tab ---- */}

      {/* Modals */}
      <Modal
        isOpen={showActivitySettings}
        onClose={() => setShowActivitySettings(false)}
        title="Activity settings"
        size="lg"
      >
        {showActivitySettings && <ActivitySettingsScreen />}
      </Modal>
      <NutritionCalendarSheet
        isOpen={showCalendar}
        onClose={() => setShowCalendar(false)}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        calorieTarget={nutritionTargets?.calories ?? null}
        currentPhase={currentPhase ?? 'maintenance'}
        todayCalories={
          isToday && foodEntries.length > 0 && !dayQuery.isPlaceholderData
            ? dailyTotals.calories
            : undefined
        }
        eatingWindow={eatingWindow}
      />

      <AddFoodModal
        isOpen={showAddFood}
        onClose={() => setShowAddFood(false)}
        onAdd={handleAddFood}
        units={weightUnit}
        defaultMealType={selectedMealType}
        onMealTypeChange={(m) => { setSelectedMealType(m); setQuickMeal(m); }}
        initialTab={addFoodTab}
        onOpenDescribe={() => {
          setShowAddFood(false);
          setDescribeMealType(selectedMealType);
          setShowDescribeMeal(true);
        }}
        onOpenSavedMeals={() => {
          setShowAddFood(false);
          setShowSavedMeals(true);
        }}
        onCreateCustomFood={(barcode) => {
          setShowAddFood(false);
          setCustomFoodBarcode(barcode);
          setShowCreateCustomFood(true);
        }}
        onLabelScanned={(prefill) => {
          setShowAddFood(false);
          setLabelScanPrefill(prefill);
          setShowCreateCustomFood(true);
        }}
        customFoods={customFoods}
        frequentFoods={frequentFoods}
        systemFoods={systemFoods}
        recentEntries={recentFoodsQuery.data ?? []}
        recentsLoading={recentFoodsQuery.isLoading}
        mealNames={nutritionTargets?.meal_names ?? null}
        selectedDay={selectedDate}
        onQuickAdd={handleQuickAddFood}
        onQuickAddMany={handleQuickAddManyFoods}
      />

      <DescribeMealModal
        isOpen={showDescribeMeal}
        onClose={() => {
          setShowDescribeMeal(false);
          setDescribeMealType(null);
        }}
        defaultMealType={describeMealType ?? chipMealType}
        onLogItems={handleLogParsedItems}
      />

      <SavedMealsModal
        isOpen={showSavedMeals}
        onClose={() => setShowSavedMeals(false)}
        targetMealLabel={timeMealLabel}
        onLog={handleLogSavedMeal}
      />

      <CreateCustomFoodModal
        isOpen={showCreateCustomFood}
        onClose={() => {
          setShowCreateCustomFood(false);
          setEditingCustomFood(null);
          setCustomFoodBarcode(undefined);
          setLabelScanPrefill(null);
        }}
        onSave={handleSaveCustomFood}
        editingFood={editingCustomFood}
        initialBarcode={customFoodBarcode}
        initialScan={labelScanPrefill}
      />

      <WeightLogModal
        isOpen={showWeightLog}
        onClose={() => setShowWeightLog(false)}
        onSave={handleSaveWeight}
        preferredUnit={weightUnit}
      />

      <WeightLogModal
        key={editingWeight?.id || 'new'}
        isOpen={!!editingWeight}
        onClose={() => setEditingWeight(null)}
        onSave={handleUpdateWeight}
        existingEntry={editingWeight || undefined}
        preferredUnit={weightUnit}
      />

      <WeightHistoryModal
        isOpen={showWeightHistory}
        onClose={() => setShowWeightHistory(false)}
        entries={weightEntries}
        preferredUnit={weightUnit}
        onEdit={(entry) => {
          setShowWeightHistory(false);
          setEditingWeight(entry);
        }}
        onDelete={handleDeleteWeight}
      />

      <NutritionTargetsModal
        isOpen={showTargetsModal}
        onClose={() => setShowTargetsModal(false)}
        onSave={handleSaveManualTargets}
        existingTargets={nutritionTargets || undefined}
        sex={userProfile.sex ?? null}
      />

      <MacroCalculatorModal
        isOpen={showMacroCalculator}
        onClose={() => {
          setShowMacroCalculator(false);
          // The calculator saves macro_settings after the targets; refetch so
          // "How this is set" reads the new inputs.
          void queryClient.invalidateQueries({ queryKey: NUTRITION_GLOBAL_KEY });
        }}
        onApply={handleSaveTargets}
        existingTargets={nutritionTargets ? {
          calories: nutritionTargets.calories || undefined,
          protein: nutritionTargets.protein || undefined,
          carbs: nutritionTargets.carbs || undefined,
          fat: nutritionTargets.fat || undefined,
        } : undefined}
        userStats={userProfile}
        workoutsPerWeek={userProfile.workoutsPerWeek || undefined}
        currentPhase={currentPhase ?? undefined}
        weightUnit={weightUnit}
      />

      <EditFoodModal
        isOpen={showEditFood}
        onClose={() => {
          setShowEditFood(false);
          setEditingFood(null);
        }}
        onSave={handleUpdateFood}
        onDelete={handleDeleteFood}
        entry={editingFood}
      />
    </div>
  );
}

// useSearchParams (the describe= reminder param, legacy ?tab= redirects)
// requires a Suspense boundary for the static prerender pass — the fallback
// matches the screen's own loading state so nothing visibly changes.
export function NutritionScreen({ view }: { view: NutritionView }) {
  const isTrends = view === 'trends';
  useDocumentTitle(isTrends ? 'Weight & trends' : 'Nutrition');
  return (
    <Suspense fallback={<PageSkeleton title={isTrends ? 'Weight & trends' : 'Eat'} />}>
      <NutritionPageContent view={view} />
    </Suspense>
  );
}
