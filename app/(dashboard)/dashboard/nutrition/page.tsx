'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient, useIsRestoring } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Card, CardHeader, CardTitle, CardContent, Button, LoadingAnimation, SwipeableRow, ToastContainer, useToasts } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';

// Dynamic imports for heavy modals - reduces initial bundle size
const AddFoodModal = dynamic(() => import('@/components/nutrition/AddFoodModal').then(m => ({ default: m.AddFoodModal })), { ssr: false });
const WeightLogModal = dynamic(() => import('@/components/nutrition/WeightLogModal').then(m => ({ default: m.WeightLogModal })), { ssr: false });
const WeightHistoryModal = dynamic(() => import('@/components/nutrition/WeightHistoryModal').then(m => ({ default: m.WeightHistoryModal })), { ssr: false });
const NutritionTargetsModal = dynamic(() => import('@/components/nutrition/NutritionTargetsModal').then(m => ({ default: m.NutritionTargetsModal })), { ssr: false });
const MacroCalculatorModal = dynamic(() => import('@/components/nutrition/MacroCalculatorModal').then(m => ({ default: m.MacroCalculatorModal })), { ssr: false });
const CreateCustomFoodModal = dynamic(() => import('@/components/nutrition/CreateCustomFoodModal').then(m => ({ default: m.CreateCustomFoodModal })), { ssr: false });
const EditFoodModal = dynamic(() => import('@/components/nutrition/EditFoodModal').then(m => ({ default: m.EditFoodModal })), { ssr: false });
const NutritionTrendGraph = dynamic(() => import('@/components/nutrition/NutritionTrendGraph').then(m => ({ default: m.NutritionTrendGraph })), { ssr: false });
const DescribeMealModal = dynamic(() => import('@/components/nutrition/DescribeMealModal').then(m => ({ default: m.DescribeMealModal })), { ssr: false });
const SavedMealsModal = dynamic(() => import('@/components/nutrition/SavedMealsModal').then(m => ({ default: m.SavedMealsModal })), { ssr: false });
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
import { MacroSummaryCard } from '@/components/nutrition/MacroSummaryCard';
import { StickyMacroBar } from '@/components/nutrition/StickyMacroBar';
import { NutritionQuickActions } from '@/components/nutrition/NutritionQuickActions';
import { useDailyNutritionSummary } from '@/hooks/useDailyNutritionSummary';
import {
  useNutritionDay,
  useNutritionGlobal,
  nutritionDayKey,
  fetchFoodLog,
  NUTRITION_GLOBAL_KEY,
  type NutritionGlobalBundle,
} from '@/hooks/useNutritionData';
import { recalculateMacrosForWeight } from '@/lib/actions/nutrition';
import { getAdaptiveTDEE, onWeightLoggedRecalculateTDEE, resetAndRecalculateTDEE, type TDEEData } from '@/lib/actions/tdee';
import { TDEEDashboard } from '@/components/nutrition/TDEEDashboard';
import { StepTracking } from '@/components/nutrition/StepTracking';
import { getLocalDateString, formatDate } from '@/lib/utils';
import { getDisplayWeight, prepareWeightForStorage } from '@/lib/weightUtils';
import { computeWeightRate } from '@/app/(dashboard)/dashboard/_lib/weightRate';
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
  IconChevronLeft,
  IconChevronRight,
  IconSettings,
  IconCopy,
  IconBookmarkPlus,
  IconDots,
  IconX,
  IconToolsKitchen2,
  IconScale,
  IconChartLine,
} from '@tabler/icons-react';

type NutritionTab = 'log' | 'weight' | 'insights';

// Valid ?tab= values — deep-linkable so the home Weight tile (and anything
// else) can land directly on a section, e.g. /dashboard/nutrition?tab=weight.
function parseNutritionTabParam(value: string | null): NutritionTab | null {
  return value === 'log' || value === 'weight' || value === 'insights' ? value : null;
}

const NUTRITION_TABS: { key: NutritionTab; label: string; icon: typeof IconScale }[] = [
  { key: 'log', label: 'Food Log', icon: IconToolsKitchen2 },
  { key: 'weight', label: 'Weight', icon: IconScale },
  { key: 'insights', label: 'Insights', icon: IconChartLine },
];

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
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
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

/** Skeleton for the macro summary numbers while a never-fetched day loads. */
function MacroNumbersSkeleton() {
  return (
    <div
      className="rounded-2xl border border-surface-800 bg-surface-900 p-4 animate-pulse"
      aria-hidden="true"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="h-6 w-24 rounded bg-surface-800" />
        <div className="h-4 w-16 rounded bg-surface-800" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 text-center">
            <div className="mx-auto h-7 w-12 rounded bg-surface-800" />
            <div className="mx-auto h-3 w-10 rounded bg-surface-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for a single meal section while a never-fetched day loads. */
function MealSectionSkeleton() {
  return (
    <div className="rounded-2xl border border-surface-800 bg-surface-900 p-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 w-28 rounded bg-surface-800" />
        <div className="h-3 w-16 rounded bg-surface-800" />
      </div>
    </div>
  );
}

function NutritionPageContent() {
  // Defer date initialization to client to prevent hydration mismatches
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
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

  // Modal states
  const [showAddFood, setShowAddFood] = useState(false);
  const [addFoodTab, setAddFoodTab] = useState<AddFoodTab>('search');
  const [selectedMealType, setSelectedMealType] = useState<MealType>('breakfast');
  const [showDescribeMeal, setShowDescribeMeal] = useState(false);
  const [showSavedMeals, setShowSavedMeals] = useState(false);
  const [showWeightLog, setShowWeightLog] = useState(false);
  const [showWeightHistory, setShowWeightHistory] = useState(false);
  const [editingWeight, setEditingWeight] = useState<WeightLogEntry | null>(null);
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [showMacroCalculator, setShowMacroCalculator] = useState(false);
  const [showCreateCustomFood, setShowCreateCustomFood] = useState(false);
  const [customFoodBarcode, setCustomFoodBarcode] = useState<string | undefined>(undefined);
  const [editingCustomFood, setEditingCustomFood] = useState<CustomFood | null>(null);
  const [showEditFood, setShowEditFood] = useState(false);
  const [editingFood, setEditingFood] = useState<FoodLogEntry | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [openMealMenu, setOpenMealMenu] = useState<MealType | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<NutritionTab>(
    () => parseNutritionTabParam(searchParams.get('tab')) ?? 'log'
  );

  // Follow URL changes (back/forward, deep links from the home Weight tile).
  // No/invalid param means the default tab — a base-route navigation (e.g.
  // the Eat nav item) must reset a previously deep-linked tab.
  useEffect(() => {
    setActiveTab(parseNutritionTabParam(searchParams.get('tab')) ?? 'log');
  }, [searchParams]);

  const handleTabChange = (tab: NutritionTab) => {
    setActiveTab(tab);
    // Keep the URL linkable without stacking history entries per tap.
    router.replace(tab === 'log' ? pathname : `${pathname}?tab=${tab}`, { scroll: false });
  };

  // Notification for macro updates
  const [macroUpdateNotification, setMacroUpdateNotification] = useState<string | null>(null);

  const { toasts, dismissToast, showSuccess, addToast } = useToasts();

  // Lazy one-time load of the system food library (only needed once a food modal opens)
  const systemFoodsLoadedRef = useRef(false);

  // Hero macro card wrapper — the sticky bar shows once this scrolls out of view
  const heroCardRef = useRef<HTMLDivElement>(null);

  const supabase = createUntypedClient();

  // Track when component is mounted on client
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Initialize date on client side only (after mount)
  useEffect(() => {
    if (isMounted && selectedDate === null) {
      setSelectedDate(getLocalDateString());
    }
  }, [isMounted, selectedDate]);

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

  // True while React Query rehydrates its cache from IndexedDB on a cold reload.
  // During this window queries are paused (no data yet) but the cache is warm —
  // so we must NOT show the full-screen heart; skeletons cover the gap instead.
  const isRestoring = useIsRestoring();

  const foodEntries = dayQuery.data ?? [];
  const yesterdayEntries = yesterdayQuery.data ?? [];

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
      queryClient.setQueryData<FoodLogEntry[]>(nutritionDayKey(selectedDate), (prev = []) =>
        typeof updater === 'function' ? updater(prev) : updater
      );
    },
    [queryClient, selectedDate]
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

    // Process frequent foods
    const frequentData = bundle.frequentRaw;
    if (frequentData && frequentData.length > 0) {
      const frequencyMap = new Map<string, FrequentFood>();

      for (const entry of frequentData) {
        if (!entry.food_name) continue;
        const key = `${entry.meal_type}:${entry.food_name}`;
        const existing = frequencyMap.get(key);
        const servingsNum = entry.servings || 1;

        if (existing) {
          const totalLogs = existing.times_logged + 1;
          existing.avg_calories = (existing.avg_calories * existing.times_logged + (entry.calories || 0) / servingsNum) / totalLogs;
          existing.avg_protein = (existing.avg_protein * existing.times_logged + (entry.protein || 0) / servingsNum) / totalLogs;
          existing.avg_carbs = (existing.avg_carbs * existing.times_logged + (entry.carbs || 0) / servingsNum) / totalLogs;
          existing.avg_fat = (existing.avg_fat * existing.times_logged + (entry.fat || 0) / servingsNum) / totalLogs;
          existing.times_logged = totalLogs;
        } else {
          frequencyMap.set(key, {
            user_id: bundle.userId,
            meal_type: entry.meal_type as MealType,
            food_name: entry.food_name,
            serving_size: entry.serving_size,
            avg_calories: (entry.calories || 0) / servingsNum,
            avg_protein: (entry.protein || 0) / servingsNum,
            avg_carbs: (entry.carbs || 0) / servingsNum,
            avg_fat: (entry.fat || 0) / servingsNum,
            times_logged: 1,
            last_logged: new Date().toISOString(),
          });
        }
      }

      setFrequentFoods(Array.from(frequencyMap.values()));
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');
    if (!selectedDate) throw new Error('Date not initialized');

    const { data, error } = await supabase.from('food_log').insert({
      user_id: user.id,
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
   * Apply freshly inserted rows to local state instead of refetching the
   * whole 13-query loadData() tree. Keeps today's list, daily totals, and
   * the frequent-food chips in sync after a save.
   */
  function applyInsertedEntries(rows: FoodLogEntry[]) {
    if (rows.length === 0) return;
    mutateFoodEntries((prev) => [...prev, ...rows]);
    setFrequentFoods((prev) => {
      const map = new Map(prev.map((f) => [`${f.meal_type}:${f.food_name}`, { ...f }]));
      for (const row of rows) {
        if (!row.food_name) continue;
        const key = `${row.meal_type}:${row.food_name}`;
        const servingsNum = row.servings || 1;
        const existing = map.get(key);
        if (existing) {
          const totalLogs = existing.times_logged + 1;
          existing.avg_calories = (existing.avg_calories * existing.times_logged + (row.calories || 0) / servingsNum) / totalLogs;
          existing.avg_protein = (existing.avg_protein * existing.times_logged + (row.protein || 0) / servingsNum) / totalLogs;
          existing.avg_carbs = (existing.avg_carbs * existing.times_logged + (row.carbs || 0) / servingsNum) / totalLogs;
          existing.avg_fat = (existing.avg_fat * existing.times_logged + (row.fat || 0) / servingsNum) / totalLogs;
          existing.times_logged = totalLogs;
          existing.last_logged = new Date().toISOString();
        } else {
          map.set(key, {
            user_id: row.user_id,
            meal_type: row.meal_type as MealType,
            food_name: row.food_name,
            serving_size: row.serving_size,
            avg_calories: (row.calories || 0) / servingsNum,
            avg_protein: (row.protein || 0) / servingsNum,
            avg_carbs: (row.carbs || 0) / servingsNum,
            avg_fat: (row.fat || 0) / servingsNum,
            times_logged: 1,
            last_logged: new Date().toISOString(),
          });
        }
      }
      return Array.from(map.values());
    });
  }

  /**
   * Refresh only the data a weight or target change can affect (weight list,
   * nutrition targets, adaptive TDEE) — 2 queries + 1 server action instead
   * of the full loadData() tree.
   */
  async function refreshWeightAndTargets() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [weightResult, targetsResult] = await Promise.all([
      supabase
        .from('weight_log')
        .select('*')
        .eq('user_id', user.id)
        .gte('logged_at', getLocalDateString(thirtyDaysAgo))
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
      const tdee = await getAdaptiveTDEE(targetsResult.data?.calories);
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
        // Calculate per-serving nutrition (divide by servings if > 1)
        const perServingCalories = Math.round(food.calories / food.servings);
        const perServingProtein = Math.round((food.protein / food.servings) * 10) / 10;
        const perServingCarbs = Math.round((food.carbs / food.servings) * 10) / 10;
        const perServingFat = Math.round((food.fat / food.servings) * 10) / 10;

        const { data: customFood, error: customError } = await supabase.from('custom_foods').insert({
          user_id: user.id,
          food_name: food.food_name,
          serving_size: food.serving_size,
          calories: perServingCalories,
          protein: perServingProtein,
          carbs: perServingCarbs,
          fat: perServingFat,
          barcode: food.barcode,
        }).select().single();

        if (!customError && customFood) {
          setCustomFoods((prev) => [customFood as CustomFood, ...prev]);
          showSuccess('Saved to your foods');
        }
      }
    }
  }

  /** Describe flow: log all AI-parsed items to the chosen meal in parallel */
  async function handleLogParsedItems(items: ParsedMealItem[], mealType: MealType) {
    const inserted = await Promise.all(
      items.map((item) =>
        insertFoodEntry({
          food_name: item.name,
          serving_size: item.quantity || '1 serving',
          servings: 1,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          meal_type: mealType,
          source: 'manual',
        })
      )
    );
    applyInsertedEntries(inserted);
  }

  /** Saved meals: one tap logs every item to the time-appropriate meal */
  async function handleLogSavedMeal(meal: SavedMeal) {
    const targetMeal = getMealTypeForNow();
    const inserted = await Promise.all(
      meal.items.map((item) =>
        insertFoodEntry({
          food_name: item.name,
          serving_size: item.serving_size || '1 serving',
          servings: item.servings || 1,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          meal_type: targetMeal,
          source: 'manual',
        })
      )
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

    const inserted = await Promise.all(
      entries.map((entry) =>
        insertFoodEntry({
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
        })
      )
    );
    applyInsertedEntries(inserted);
  }

  /** Frequent chip: one tap logs to the time-appropriate meal */
  async function handleQuickLogFrequent(food: FrequentFood) {
    await handleAddFood({
      food_name: food.food_name,
      serving_size: food.serving_size || '1 serving',
      servings: 1,
      calories: Math.round(food.avg_calories),
      protein: Math.round(food.avg_protein * 10) / 10,
      carbs: Math.round(food.avg_carbs * 10) / 10,
      fat: Math.round(food.avg_fat * 10) / 10,
      meal_type: getMealTypeForNow(),
      source: 'manual',
    });
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
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    perServing?: { calories: number; protein: number; carbs: number; fat: number };
  }) {
    const { perServing, ...logUpdates } = updates;

    const { error } = await supabase
      .from('food_log')
      .update({
        servings: logUpdates.servings,
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
    mutateFoodEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...logUpdates } : e)));

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

    // Get user's unit preference to convert to kg for macro calculation
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('weight_unit')
      .eq('user_id', user.id)
      .single();

    // Default to 'lb' if no preference is set (most common unit)
    const userUnit = (prefs?.weight_unit as 'lb' | 'kg' | null) || 'lb';
    const isLbs = userUnit === 'lb';
    const weightKg = isLbs ? weight * 0.453592 : weight;

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
      const tdeeResult = await onWeightLoggedRecalculateTDEE();
      if (tdeeResult.syncResult?.synced && tdeeResult.syncResult.newCalories) {
        setMacroUpdateNotification(
          `Adaptive TDEE updated targets: ${tdeeResult.syncResult.newCalories} cal - ${tdeeResult.syncResult.message}`
        );
        setTimeout(() => setMacroUpdateNotification(null), 6000);
      } else if (tdeeResult.syncResult?.message && tdeeResult.estimate) {
        // Show progress message even if not synced
        setMacroUpdateNotification(tdeeResult.syncResult.message);
        setTimeout(() => setMacroUpdateNotification(null), 4000);
      } else {
        // Fallback to weight-based recalculation if TDEE not ready
        const result = await recalculateMacrosForWeight(weightKg);
        if (result.success && !result.skipped && result.newTargets) {
          setMacroUpdateNotification(
            `Macros auto-updated: ${result.newTargets.calories} cal, ${result.newTargets.protein}g protein`
          );
          setTimeout(() => setMacroUpdateNotification(null), 5000);
        }
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

  function openAddFood(mealType: MealType, tab: AddFoodTab = 'search') {
    void ensureSystemFoodsLoaded();
    setSelectedMealType(mealType);
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

  function goToToday() {
    setSelectedDate(getLocalDateString());
  }

  // Daily totals + remaining/hit/over verdicts — single source of truth
  // shared by the hero MacroSummaryCard and the sticky bar
  const dailySummary = useDailyNutritionSummary(foodEntries, nutritionTargets);
  const dailyTotals = dailySummary.totals;

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
  const remainingCalories = nutritionTargets?.calories
    ? Math.round(nutritionTargets.calories - dailyTotals.calories)
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
  const last7Days = weightEntries.slice(0, 7);
  const sevenDayAverage =
    last7Days.length > 0
      ? last7Days.reduce((sum, e) => {
          const validatedWeight = getDisplayWeight(e.weight, (e as any).unit as 'lb' | 'kg' | null, weightUnit);
          return sum + validatedWeight;
        }, 0) / last7Days.length
      : null;

  // Weekly trend rate vs the goal-implied target — the SAME shared helper the
  // home "Weight" glance tile uses, so the "+3.8 lb/wk · target +0.5" the
  // user tapped is the number this tab shows.
  const weightTrendRate = computeWeightRate(
    weightEntries.map((e) => ({
      date: e.logged_at,
      weight: e.weight,
      unit: ((e as any).unit as string | null) || weightUnit,
    })),
    weightUnit,
    currentPhase ?? 'maintenance'
  );
  const weightRateOnTrack =
    !weightTrendRate || weightTrendRate.target === null || weightTrendRate.target === 0
      ? true
      : Math.sign(weightTrendRate.perWeek) === Math.sign(weightTrendRate.target);
  const signedRate = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

  // Prepare weight chart data (with unit validation and conversion)
  // Sort by date ascending (oldest first) for proper graph display
  const weightChartData = [...weightEntries]
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime())
    .slice(-30) // Take last 30 entries (most recent)
    .map((entry) => {
      // Use logged_at directly as date string to avoid timezone issues
      const dateStr = entry.logged_at;
      const validatedWeight = getDisplayWeight(entry.weight, (entry as any).unit as 'lb' | 'kg' | null, weightUnit);

      return {
        date: dateStr,
        displayDate: formatDate(dateStr, {
          month: 'short',
          day: 'numeric',
        }),
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
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-surface-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Client: show loading until mounted and date is set
  if (!isMounted || !selectedDate) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-surface-400">Loading...</p>
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

  // Has the user weighed in today? Drives the Weight-tab reminder dot and CTAs.
  const todayWeightEntry = weightEntries.find((entry) => entry.logged_at === todayDateString);
  const hasLoggedWeightToday = !!todayWeightEntry;
  const todayWeightDisplay = todayWeightEntry
    ? getDisplayWeight(todayWeightEntry.weight, (todayWeightEntry as any).unit as 'lb' | 'kg' | null, weightUnit).toFixed(1)
    : null;

  // Full-screen heart is reserved for first-ever load with an empty persisted
  // cache. Date switches (keepPreviousData) and warm reloads (IndexedDB) never
  // reach this — they render chrome + skeletons or cached data instead.
  if (isColdStart) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6" data-testid="nutrition-full-loading">
        <div className="flex flex-col items-center justify-center py-20">
          <LoadingAnimation type="random" size="lg" />
          <p className="mt-4 text-surface-400">Loading nutrition data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4" suppressHydrationWarning>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Macro Update Notification */}
      {macroUpdateNotification && (
        <div className="bg-success-500/10 border border-success-500/20 rounded-lg p-3 flex items-center justify-between">
          <span className="text-success-300 text-sm">{macroUpdateNotification}</span>
          <button
            onClick={() => setMacroUpdateNotification(null)}
            className="text-success-400 hover:text-success-300"
            aria-label="Dismiss notification"
          >
            <IconX size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Header: title left, date nav + settings right */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[17px] font-medium text-surface-100">Nutrition</h1>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => changeDate(-1)}
            className="p-2 text-surface-400 hover:text-surface-100 transition-colors"
            aria-label="Previous day"
          >
            <IconChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            onClick={goToToday}
            disabled={isToday}
            className="min-w-[84px] text-center text-[13px] font-medium text-surface-100 disabled:cursor-default"
            title={isToday ? undefined : 'Back to today'}
            suppressHydrationWarning
          >
            {dateDisplay}
          </button>
          <button
            onClick={() => changeDate(1)}
            disabled={isToday}
            className="p-2 text-surface-400 hover:text-surface-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next day"
          >
            <IconChevronRight size={18} aria-hidden="true" />
          </button>

          {/* Settings menu: macro setup + weight + custom foods */}
          <div className="relative">
            <button
              onClick={() => setShowSettingsMenu((open) => !open)}
              className="p-2 text-surface-400 hover:text-surface-100 rounded-lg hover:bg-surface-800 transition-colors"
              aria-label="Nutrition options"
            >
              <IconSettings size={18} aria-hidden="true" />
            </button>
            {showSettingsMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowSettingsMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-52 rounded-xl border border-surface-800 bg-surface-900 py-1 shadow-xl">
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
                      className="w-full px-3 py-2 text-left text-[13px] text-surface-200 hover:bg-surface-800 transition-colors"
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

      {/* Section tabs: Food Log / Weight / Insights */}
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-surface-800 bg-surface-900 p-1">
        {NUTRITION_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`relative flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-surface-800 text-surface-100'
                : 'text-surface-400 hover:text-surface-200'
            }`}
            aria-pressed={activeTab === tab.key}
          >
            <tab.icon size={15} aria-hidden="true" />
            {tab.label}
            {tab.key === 'weight' && !hasLoggedWeightToday && (
              <span
                className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-amber-400"
                aria-hidden="true"
                title="No weigh-in logged today"
              />
            )}
          </button>
        ))}
      </div>

      {/* ---- Food Log tab ---- */}
      {/* Tabs hide via CSS (not unmount) so graphs/steps keep their state across switches */}
      <div className={activeTab === 'log' ? 'space-y-4' : 'hidden'}>

      {/* One-tap weigh-in reminder (today only, until logged) */}
      {isToday && !hasLoggedWeightToday && (
        <button
          onClick={() => setShowWeightLog(true)}
          className="w-full flex items-center justify-between rounded-xl border border-surface-800 bg-surface-900 px-4 py-3 hover:bg-surface-800 transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <IconScale size={18} className="text-primary-400" aria-hidden="true" />
            <span className="text-[13px] text-surface-200">Log today&apos;s weight</span>
          </span>
          <span className="text-[12px] font-semibold text-primary-400">Log</span>
        </button>
      )}

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
            targets={nutritionTargets}
            mealsRemaining={mealsRemaining}
            onCalculateMacros={() => setShowMacroCalculator(true)}
            onEnterManually={() => setShowTargetsModal(true)}
          />
        )}
      </div>

      {/* Quick actions: Describe / Scan / Search / Meals */}
      <NutritionQuickActions
        onDescribe={() => setShowDescribeMeal(true)}
        onScan={() => openAddFood(timeMealType, 'barcode')}
        onSearch={() => openAddFood(timeMealType, 'search')}
        onMeals={() => setShowSavedMeals(true)}
      />

      {/* Frequent-food chips: one tap logs to the time-appropriate meal */}
      {frequentChips.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {frequentChips.map((food) => (
            <button
              key={food.food_name}
              onClick={() => handleQuickLogFrequent(food)}
              className="flex-shrink-0 rounded-full border border-surface-800 bg-surface-900 px-2.5 py-1 text-[11px] text-surface-300 hover:bg-surface-800 transition-colors"
            >
              + {toTitleCase(food.food_name)}
            </button>
          ))}
        </div>
      )}

      {/* Meal sections */}
      <div className="space-y-3">
        {isDaySwitching
          ? mealConfig.map((meal) => <MealSectionSkeleton key={meal.type} />)
          : mealGroups.map((meal) => {
          const mealCalories = Math.round(meal.entries.reduce((sum, e) => sum + (e.calories || 0), 0));
          const mealProtein = Math.round(meal.entries.reduce((sum, e) => sum + (e.protein || 0), 0));
          const mealCarbs = Math.round(meal.entries.reduce((sum, e) => sum + (e.carbs || 0), 0));
          const mealFat = Math.round(meal.entries.reduce((sum, e) => sum + (e.fat || 0), 0));
          const yesterdayHasEntries = yesterdayEntries.some((e) => e.meal_type === meal.type);
          const hasEntries = meal.entries.length > 0;
          const hasMenuActions = hasEntries || yesterdayHasEntries;

          return (
            <div key={meal.type} className="rounded-2xl border border-surface-800 bg-surface-900 p-4">
              {/* Header: "{Meal}: {kcal} cals" + macro breakdown + overflow menu */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-surface-100 truncate">
                    {meal.label}
                    {hasEntries && (
                      <span>: {mealCalories.toLocaleString()} cals</span>
                    )}
                  </h3>
                  <p className="text-[12px] text-surface-500 mt-0.5">
                    {hasEntries
                      ? `${mealFat}g fat · ${mealCarbs}g carbs · ${mealProtein}g protein`
                      : perMealAvailable > 0
                        ? `~${perMealAvailable.toLocaleString()} calories available`
                        : 'Nothing logged yet'}
                  </p>
                </div>
                {hasMenuActions && (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setOpenMealMenu(openMealMenu === meal.type ? null : meal.type)}
                      className="p-1.5 rounded-lg text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
                      aria-label={`${meal.label} options`}
                    >
                      <IconDots size={18} aria-hidden="true" />
                    </button>
                    {openMealMenu === meal.type && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setOpenMealMenu(null)} />
                        <div className="absolute right-0 top-full mt-1 z-40 w-52 rounded-xl border border-surface-800 bg-surface-900 py-1 shadow-xl">
                          {hasEntries && (
                            <button
                              onClick={() => {
                                setOpenMealMenu(null);
                                void handleSaveMealAsSaved(meal);
                              }}
                              className="w-full px-3 py-2 flex items-center gap-2 text-left text-[13px] text-surface-200 hover:bg-surface-800 transition-colors"
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
                              className="w-full px-3 py-2 flex items-center gap-2 text-left text-[13px] text-surface-200 hover:bg-surface-800 transition-colors"
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
                        className="w-full flex items-center justify-between gap-4 py-2 px-1 rounded-lg hover:bg-surface-800/50 active:bg-surface-800 transition-colors text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-[14px] text-surface-100 truncate">
                            {toTitleCase(entry.food_name)}
                          </div>
                          <div className="text-[12px] text-surface-500 truncate">
                            {entry.servings !== 1 ? `${entry.servings} × ` : ''}{entry.serving_size}
                          </div>
                        </div>
                        <span className="text-[15px] text-surface-300 flex-shrink-0 tabular-nums">
                          {Math.round(entry.calories).toLocaleString()}
                        </span>
                      </button>
                    </SwipeableRow>
                  ))}
                </div>
              )}

              {/* Add Food pill */}
              <div className={`flex justify-end ${hasEntries ? 'mt-2' : 'mt-3'}`}>
                <button
                  onClick={() => openAddFood(meal.type)}
                  className="rounded-full bg-primary-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-primary-500 active:bg-primary-700 transition-colors"
                >
                  Add Food
                </button>
              </div>
            </div>
          );
        })}
      </div>

      </div>
      {/* ---- end Food Log tab ---- */}

      {/* ---- Weight tab ---- */}
      <div className={activeTab === 'weight' ? 'space-y-4' : 'hidden'}>

      {/* Log / update today's weight CTA */}
      <button
        onClick={() => setShowWeightLog(true)}
        className="w-full flex items-center justify-between gap-3 rounded-2xl border border-primary-500/40 bg-primary-500/10 p-4 hover:bg-primary-500/20 transition-colors"
      >
        <span className="flex items-center gap-3 min-w-0">
          <IconScale size={22} className="text-primary-400 flex-shrink-0" aria-hidden="true" />
          <span className="text-left min-w-0">
            <span className="block text-[15px] font-semibold text-surface-100">
              {hasLoggedWeightToday ? "Update today's weight" : "Log today's weight"}
            </span>
            <span className="block text-[12px] text-surface-400 truncate">
              {hasLoggedWeightToday
                ? `Logged today: ${todayWeightDisplay} ${weightUnit}`
                : 'Daily weigh-ins keep your adaptive TDEE accurate'}
            </span>
          </span>
        </span>
        <span className="flex-shrink-0 rounded-full bg-primary-600 px-4 py-1.5 text-[13px] font-semibold text-white">
          {hasLoggedWeightToday ? 'Update' : 'Log'}
        </span>
      </button>

      {/* Weight Trend */}
      {weightEntries.length === 0 && (
        <div className="rounded-2xl border border-surface-800 bg-surface-900 p-6 text-center">
          <p className="text-[13px] text-surface-400">
            No weight entries yet. Log your first weigh-in to start tracking your trend.
          </p>
        </div>
      )}
      {weightEntries.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Weight Trend</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWeightHistory(true)}
              >
                View History
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div>
                  <div className="text-sm text-surface-400">Current Weight</div>
                  <div className="text-2xl font-bold text-surface-100">
                    {weightEntries[0] ? getDisplayWeight(weightEntries[0].weight, (weightEntries[0] as any)?.unit as 'lb' | 'kg' | null, weightUnit).toFixed(1) : '0.0'} {weightUnit}
                  </div>
                  <div className="text-xs text-surface-500">
                    {new Date(weightEntries[0]?.logged_at).toLocaleDateString()}
                  </div>
                </div>
                {sevenDayAverage && (
                  <div>
                    <div className="text-sm text-surface-400">7-Day Average</div>
                    <div className="text-xl font-semibold text-surface-100">
                      {sevenDayAverage.toFixed(1)} {weightUnit}
                    </div>
                  </div>
                )}
                {weightTrendRate && (
                  <div>
                    <div className="text-sm text-surface-400">Trend</div>
                    <div
                      className={`text-xl font-semibold ${
                        weightRateOnTrack ? 'text-success-400' : 'text-warning-400'
                      }`}
                    >
                      {signedRate(weightTrendRate.perWeek)} {weightUnit}/wk
                    </div>
                    {weightTrendRate.target !== null && (
                      <div className="text-xs text-surface-500">
                        target {signedRate(weightTrendRate.target)} {weightUnit}/wk (
                        {currentPhase === 'bulk' ? 'bulk' : 'cut'})
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                {weightChartData.length > 0 && (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={weightChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                      <XAxis
                        dataKey="displayDate"
                        stroke="#888"
                        style={{ fontSize: '12px' }}
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
      {/* ---- end Weight tab ---- */}

      {/* ---- Insights tab ---- */}
      <div className={activeTab === 'insights' ? 'space-y-4' : 'hidden'}>

      {/* Nutrition Trends Graph */}
      <NutritionTrendGraph targets={nutritionTargets} />

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
        />
      )}

      </div>
      {/* ---- end Insights tab ---- */}

      {/* Modals */}
      <AddFoodModal
        isOpen={showAddFood}
        onClose={() => setShowAddFood(false)}
        onAdd={handleAddFood}
        defaultMealType={selectedMealType}
        initialTab={addFoodTab}
        onCreateCustomFood={(barcode) => {
          setShowAddFood(false);
          setCustomFoodBarcode(barcode);
          setShowCreateCustomFood(true);
        }}
        customFoods={customFoods}
        frequentFoods={frequentFoods}
        systemFoods={systemFoods}
      />

      <DescribeMealModal
        isOpen={showDescribeMeal}
        onClose={() => setShowDescribeMeal(false)}
        defaultMealType={timeMealType}
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
        }}
        onSave={handleSaveCustomFood}
        editingFood={editingCustomFood}
        initialBarcode={customFoodBarcode}
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
        onSave={handleSaveTargets}
        existingTargets={nutritionTargets || undefined}
      />

      <MacroCalculatorModal
        isOpen={showMacroCalculator}
        onClose={() => setShowMacroCalculator(false)}
        onApply={handleSaveTargets}
        existingTargets={nutritionTargets ? {
          calories: nutritionTargets.calories || undefined,
          protein: nutritionTargets.protein || undefined,
          carbs: nutritionTargets.carbs || undefined,
          fat: nutritionTargets.fat || undefined,
        } : undefined}
        userStats={userProfile}
        workoutsPerWeek={userProfile.workoutsPerWeek || 4}
        currentPhase={currentPhase ?? undefined}
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

// useSearchParams (deep-linkable ?tab=weight from the home Weight tile)
// requires a Suspense boundary for the static prerender pass — the fallback
// matches the page's own loading state so nothing visibly changes.
export default function NutritionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center py-20">
          <LoadingAnimation type="random" size="lg" />
        </div>
      }
    >
      <NutritionPageContent />
    </Suspense>
  );
}
