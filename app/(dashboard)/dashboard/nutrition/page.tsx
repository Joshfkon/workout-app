'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, LoadingAnimation, SwipeableRow } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';

// Dynamic imports for heavy modals - reduces initial bundle size
const AddFoodModal = dynamic(() => import('@/components/nutrition/AddFoodModal').then(m => ({ default: m.AddFoodModal })), { ssr: false });
const WeightLogModal = dynamic(() => import('@/components/nutrition/WeightLogModal').then(m => ({ default: m.WeightLogModal })), { ssr: false });
const WeightHistoryModal = dynamic(() => import('@/components/nutrition/WeightHistoryModal').then(m => ({ default: m.WeightHistoryModal })), { ssr: false });
const NutritionTargetsModal = dynamic(() => import('@/components/nutrition/NutritionTargetsModal').then(m => ({ default: m.NutritionTargetsModal })), { ssr: false });
const MacroCalculatorModal = dynamic(() => import('@/components/nutrition/MacroCalculatorModal').then(m => ({ default: m.MacroCalculatorModal })), { ssr: false });
const CreateCustomFoodModal = dynamic(() => import('@/components/nutrition/CreateCustomFoodModal').then(m => ({ default: m.CreateCustomFoodModal })), { ssr: false });
const EditFoodModal = dynamic(() => import('@/components/nutrition/EditFoodModal').then(m => ({ default: m.EditFoodModal })), { ssr: false });
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
import type { FoodSearchResult } from '@/services/usdaService';
import { recalculateMacrosForWeight } from '@/lib/actions/nutrition';
import { getAdaptiveTDEE, onWeightLoggedRecalculateTDEE, type TDEEData } from '@/lib/actions/tdee';
import { TDEEDashboard } from '@/components/nutrition/TDEEDashboard';
import { StepTracking } from '@/components/nutrition/StepTracking';
import { getLocalDateString, formatDate } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const DEFAULT_MEAL_CONFIG: { type: MealType; label: string; emoji: string }[] = [
  { type: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { type: 'lunch', label: 'Lunch', emoji: '☀️' },
  { type: 'dinner', label: 'Dinner', emoji: '🌙' },
  { type: 'snack', label: 'Snacks', emoji: '🍎' },
];

function getMealConfig(customNames?: MealNames | null) {
  return DEFAULT_MEAL_CONFIG.map(meal => ({
    ...meal,
    label: customNames?.[meal.type] || meal.label,
  }));
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

// Get a food icon based on the food name
function getFoodIcon(foodName: string): string {
  const name = foodName.toLowerCase();
  
  // Proteins
  if (name.includes('chicken') || name.includes('poultry')) return '🍗';
  if (name.includes('beef') || name.includes('steak')) return '🥩';
  if (name.includes('fish') || name.includes('salmon') || name.includes('tuna')) return '🐟';
  if (name.includes('egg')) return '🥚';
  if (name.includes('turkey')) return '🦃';
  if (name.includes('pork') || name.includes('bacon') || name.includes('ham')) return '🥓';
  if (name.includes('shrimp') || name.includes('prawn')) return '🦐';
  
  // Drinks
  if (name.includes('shake') || name.includes('smoothie') || name.includes('protein')) return '🥤';
  if (name.includes('milk')) return '🥛';
  if (name.includes('coffee')) return '☕';
  if (name.includes('tea')) return '🍵';
  if (name.includes('juice') || name.includes('drink')) return '🧃';
  if (name.includes('water')) return '💧';
  
  // Carbs & grains
  if (name.includes('rice')) return '🍚';
  if (name.includes('bread') || name.includes('toast')) return '🍞';
  if (name.includes('pasta') || name.includes('spaghetti') || name.includes('noodle')) return '🍝';
  if (name.includes('cereal') || name.includes('oat')) return '🥣';
  if (name.includes('pizza')) return '🍕';
  if (name.includes('sandwich') || name.includes('sub') || name.includes('wrap')) return '🥪';
  if (name.includes('burrito') || name.includes('taco')) return '🌯';
  if (name.includes('burger')) return '🍔';
  
  // Vegetables
  if (name.includes('salad') || name.includes('lettuce')) return '🥗';
  if (name.includes('broccoli')) return '🥦';
  if (name.includes('carrot')) return '🥕';
  if (name.includes('potato') || name.includes('fries')) return '🥔';
  if (name.includes('corn')) return '🌽';
  if (name.includes('tomato')) return '🍅';
  if (name.includes('avocado')) return '🥑';
  
  // Fruits
  if (name.includes('apple')) return '🍎';
  if (name.includes('banana')) return '🍌';
  if (name.includes('orange')) return '🍊';
  if (name.includes('strawberr') || name.includes('berry')) return '🍓';
  if (name.includes('grape')) return '🍇';
  if (name.includes('peach')) return '🍑';
  if (name.includes('watermelon') || name.includes('melon')) return '🍉';
  
  // Dairy
  if (name.includes('cheese')) return '🧀';
  if (name.includes('yogurt') || name.includes('greek')) return '🥛';
  if (name.includes('butter')) return '🧈';
  if (name.includes('ice cream')) return '🍦';
  
  // Snacks & treats
  if (name.includes('cookie') || name.includes('biscuit')) return '🍪';
  if (name.includes('chocolate') || name.includes('candy')) return '🍫';
  if (name.includes('cake') || name.includes('puff') || name.includes('pastry')) return '🧁';
  if (name.includes('donut') || name.includes('doughnut')) return '🍩';
  if (name.includes('bar') || name.includes('granola')) return '🍫';
  if (name.includes('chip') || name.includes('crisp')) return '🍟';
  if (name.includes('nut') || name.includes('almond') || name.includes('peanut')) return '🥜';
  if (name.includes('popcorn')) return '🍿';
  
  // Supplements
  if (name.includes('vitamin') || name.includes('supplement') || name.includes('creatine')) return '💊';
  if (name.includes('whey') || name.includes('casein')) return '🥤';
  
  // Default
  return '🍽️';
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

export default function NutritionPage() {
  // Defer date initialization to client to prevent hydration mismatches
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [foodEntries, setFoodEntries] = useState<FoodLogEntry[]>([]);
  const [weightEntries, setWeightEntries] = useState<WeightLogEntry[]>([]);
  const [nutritionTargets, setNutritionTargets] = useState<NutritionTargets | null>(null);
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([]);
  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [systemFoods, setSystemFoods] = useState<SystemFood[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
  const [isEnhanced, setIsEnhanced] = useState<boolean>(false);

  // Convert weight to preferred unit with validation
  const convertWeight = (weight: number, fromUnit: string | null | undefined): number => {
    // If unit is missing, try to infer from weight value
    if (!fromUnit) {
      if (weightUnit === 'lb' && weight > 300) {
        // Likely stored in kg, convert
        return weight * 2.20462;
      } else if (weightUnit === 'kg' && weight > 150) {
        // Likely stored in lb, convert
        return weight / 2.20462;
      }
      // Assume already in preferred unit
      return weight;
    }
    
    // Validate: detect mislabeled units
    // If unit says 'lb' but weight > 500, it's probably stored in kg (convert)
    // If unit says 'kg' but weight is in human range (150-200), it's probably mislabeled as kg but actually in lbs (don't convert, just use as-is)
    if (fromUnit === 'lb' && weight > 500) {
      // Probably stored in kg, convert
      return weight * 2.20462;
    } else if (fromUnit === 'kg' && weight >= 150 && weight <= 200) {
      // Common weights 150-200 are human weights in lbs, mislabeled as kg
      // The weight is already in lbs, just mislabeled - don't convert, use as-is
      return weight; // Already in lbs, just mislabeled
    } else if (fromUnit === 'kg' && weight > 250) {
      // Weight > 250 kg is probably in lbs, convert
      return weight / 2.20462;
    }
    
    // Normal conversion
    if (fromUnit === weightUnit) return weight;
    return fromUnit === 'kg' ? weight * 2.20462 : weight / 2.20462;
  };

  // Modal states
  const [showAddFood, setShowAddFood] = useState(false);
  const [selectedMealType, setSelectedMealType] = useState<MealType>('breakfast');
  const [showWeightLog, setShowWeightLog] = useState(false);
  const [showWeightHistory, setShowWeightHistory] = useState(false);
  const [editingWeight, setEditingWeight] = useState<WeightLogEntry | null>(null);
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [showMacroCalculator, setShowMacroCalculator] = useState(false);
  const [showCreateCustomFood, setShowCreateCustomFood] = useState(false);
  const [editingCustomFood, setEditingCustomFood] = useState<CustomFood | null>(null);
  const [showEditFood, setShowEditFood] = useState(false);
  const [editingFood, setEditingFood] = useState<FoodLogEntry | null>(null);
  
  // Notification for macro updates
  const [macroUpdateNotification, setMacroUpdateNotification] = useState<string | null>(null);

  const supabase = createUntypedClient();

  // Track when component is mounted on client
  useEffect(() => {
    setIsMounted(true);
    console.log('[Nutrition] Component mounted on client');
  }, []);

  // Initialize date on client side only (after mount)
  useEffect(() => {
    if (isMounted && selectedDate === null) {
      const initialDate = getLocalDateString();
      console.log('[Nutrition] Initializing date on client:', initialDate);
      setSelectedDate(initialDate);
    }
  }, [isMounted, selectedDate]);

  // Guard data loading until date is available
  useEffect(() => {
    if (selectedDate) {
      console.log('[Nutrition] Date available, loading data:', selectedDate);
      loadData();
    } else {
      console.log('[Nutrition] Date not yet initialized, waiting...');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  async function loadData() {
    // Guard: don't load data if date is not available
    if (!selectedDate) {
      console.warn('[Nutrition] loadData called but selectedDate is null');
      setIsLoading(false);
      return;
    }

    console.log('[Nutrition] Starting loadData for date:', selectedDate);
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('[Nutrition] No user found, aborting loadData');
        setIsLoading(false);
        return;
      }

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = getLocalDateString(thirtyDaysAgo);

      // Run all queries in parallel for faster loading
      const [
        foodResult,
        targetsResult,
        weightResult,
        customFoodsResult,
        frequentResult,
        systemFoodsResult,
        userResult,
        dexaResult,
        mesocycleResult,
        prefsResult,
        volumeProfileResult,
        proteinResult,
        trainingSetsResult,
      ] = await Promise.all([
        // Food log entries for selected date
        supabase
          .from('food_log')
          .select('*')
          .eq('user_id', user.id)
          .eq('logged_at', selectedDate)
          .order('created_at', { ascending: true }),
        // Nutrition targets - use maybeSingle() to handle missing targets
        supabase
          .from('nutrition_targets')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        // Weight entries (last 30 days)
        supabase
          .from('weight_log')
          .select('*')
          .eq('user_id', user.id)
          .gte('logged_at', getLocalDateString(thirtyDaysAgo))
          .order('logged_at', { ascending: false }),
        // Custom foods
        supabase
          .from('custom_foods')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        // Frequent foods (aggregated from food_log)
        supabase
          .from('food_log')
          .select('meal_type, food_name, serving_size, calories, protein, carbs, fat, servings')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),
        // System foods
        supabase
          .from('system_foods')
          .select('id, name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
          .eq('is_active', true)
          .order('name'),
        // User profile data - use maybeSingle() to handle missing data
        supabase
          .from('users')
          .select('height_cm, age, sex')
          .eq('id', user.id)
          .maybeSingle(),
        // DEXA scan data - use maybeSingle() to handle missing scans
        supabase
          .from('dexa_scans')
          .select('body_fat_percent, weight_kg')
          .eq('user_id', user.id)
          .order('scan_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Active mesocycle - use maybeSingle() to handle missing mesocycle
        supabase
          .from('mesocycles')
          .select('days_per_week')
          .eq('user_id', user.id)
          .eq('state', 'active')
          .maybeSingle(),
        // User preferences (for weight unit) - use maybeSingle() to handle missing preferences
        supabase
          .from('user_preferences')
          .select('weight_unit')
          .eq('user_id', user.id)
          .maybeSingle(),
        // User volume profile (for training age and enhanced status) - use maybeSingle()
        supabase
          .from('user_volume_profiles')
          .select('training_age, is_enhanced')
          .eq('user_id', user.id)
          .maybeSingle(),
        // Average daily protein (last 30 days)
        supabase
          .from('food_log')
          .select('protein, logged_at')
          .eq('user_id', user.id)
          .gte('logged_at', thirtyDaysAgoStr)
          .order('logged_at', { ascending: false }),
        // Weekly training sets (last 30 days)
        supabase
          .from('exercise_blocks')
          .select(`
            set_logs!inner (id, is_warmup),
            workout_sessions!inner (completed_at, state)
          `)
          .eq('workout_sessions.user_id', user.id)
          .eq('workout_sessions.state', 'completed')
          .gte('workout_sessions.completed_at', thirtyDaysAgo.toISOString()),
      ]);

      // Process results
      setFoodEntries(foodResult.data || []);
      setNutritionTargets(targetsResult.data);

      // Process weight entries
      const rawWeightEntries = weightResult.data || [];
      setWeightEntries(rawWeightEntries);
      setCustomFoods(customFoodsResult.data || []);

      // Set weight unit preference
      if (prefsResult.data?.weight_unit) {
        setWeightUnit(prefsResult.data.weight_unit as 'lb' | 'kg');
      }

      if (systemFoodsResult.data) {
        setSystemFoods(systemFoodsResult.data as SystemFood[]);
      }

      // Process frequent foods
      const frequentData = frequentResult.data;
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
              user_id: user.id,
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
      const weightData = weightResult.data;

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

      const userData = userResult.data;
      const userError = userResult.error;

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
      } else {
        setHeightCm(null);
      }

      const dexaData = dexaResult.data;
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
      const volumeProfileData = volumeProfileResult.data;
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
        setIsEnhanced(volumeProfileData.is_enhanced || false);
      }

      // Calculate average daily protein (last 30 days)
      const proteinData = proteinResult.data || [];
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
      const trainingData = trainingSetsResult.data || [];
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

      const mesocycleData = mesocycleResult.data;
      if (mesocycleData?.days_per_week) {
        profileData.workoutsPerWeek = mesocycleData.days_per_week;
      }

      setUserProfile(profileData);

      // Load adaptive TDEE data
      console.log('[Nutrition] Starting TDEE calculation...');
      try {
        const tdee = await getAdaptiveTDEE(targetsResult.data?.calories);
        console.log('[Nutrition] TDEE calculation completed:', {
          hasData: !!tdee,
          hasAdaptiveEstimate: !!tdee?.adaptiveEstimate,
          hasRegressionAnalysis: !!tdee?.regressionAnalysis,
          dataPoints: tdee?.regressionAnalysis?.dataPoints?.length || 0,
          isEnhanced: tdee?.isEnhanced || false,
        });
        setTdeeData(tdee);
      } catch (tdeeError) {
        console.error('[Nutrition] Error loading TDEE data:', tdeeError);
        setTdeeData(null); // Explicitly set to null on error
      }
    } catch (error) {
      console.error('Error loading nutrition data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddFood(food: {
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
  }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (!selectedDate) {
      console.error('Cannot add food: date not initialized');
      return;
    }

    const { error } = await supabase.from('food_log').insert({
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
    });

    if (error) {
      console.error('Error adding food:', error);
      throw error;
    }

    await loadData();
  }

  async function handleDeleteFood(id: string) {
    const { error } = await supabase.from('food_log').delete().eq('id', id);

    if (error) {
      console.error('Error deleting food:', error);
      return;
    }

    await loadData();
  }

  async function handleUpdateFood(id: string, updates: { 
    servings: number; 
    calories: number; 
    protein: number; 
    carbs: number; 
    fat: number; 
  }) {
    const { error } = await supabase
      .from('food_log')
      .update({
        servings: updates.servings,
        calories: updates.calories,
        protein: updates.protein,
        carbs: updates.carbs,
        fat: updates.fat,
      })
      .eq('id', id);

    if (error) {
      console.error('Error updating food:', error);
      throw error;
    }

    await loadData();
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
      const { error } = await supabase
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
        .eq('id', editingCustomFood.id);

      if (error) {
        console.error('Error updating custom food:', error);
        throw error;
      }
    } else {
      // Create new
      const { error } = await supabase.from('custom_foods').insert({
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
      });

      if (error) {
        console.error('Error creating custom food:', error);
        throw error;
      }
    }

    await loadData();
  }

  async function handleDeleteCustomFood(id: string) {
    if (!confirm('Delete this custom food?')) return;

    const { error } = await supabase.from('custom_foods').delete().eq('id', id);

    if (error) {
      console.error('Error deleting custom food:', error);
      return;
    }

    await loadData();
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
    
    const isLbs = prefs?.weight_unit === 'lb';
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
          `✅ Adaptive TDEE updated targets: ${tdeeResult.syncResult.newCalories} cal - ${tdeeResult.syncResult.message}`
        );
        setTimeout(() => setMacroUpdateNotification(null), 6000);
      } else if (tdeeResult.syncResult?.message && tdeeResult.estimate) {
        // Show progress message even if not synced
        setMacroUpdateNotification(
          `📊 ${tdeeResult.syncResult.message}`
        );
        setTimeout(() => setMacroUpdateNotification(null), 4000);
      } else {
        // Fallback to weight-based recalculation if TDEE not ready
        const result = await recalculateMacrosForWeight(weightKg);
        if (result.success && !result.skipped && result.newTargets) {
          setMacroUpdateNotification(
            `✅ Macros auto-updated: ${result.newTargets.calories} cal, ${result.newTargets.protein}g protein`
          );
          setTimeout(() => setMacroUpdateNotification(null), 5000);
        }
      }
    } catch (e) {
      console.error('Failed to recalculate TDEE/macros:', e);
    }

    await loadData();
  }

  async function handleUpdateWeight(weight: number, date: string, notes?: string) {
    if (!editingWeight) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('weight_log')
      .update({
        weight: weight,
        logged_at: date,
        notes: notes || null,
      })
      .eq('id', editingWeight.id);

    if (error) {
      console.error('Error updating weight:', error);
      throw error;
    }

    setEditingWeight(null);
    await loadData();
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

    await loadData();
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

    // Reload data to show updated targets
    await loadData();
  }

  function openAddFood(mealType: MealType) {
    setSelectedMealType(mealType);
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

  // Calculate daily totals
  const dailyTotals = foodEntries.reduce(
    (acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein || 0),
      carbs: acc.carbs + (entry.carbs || 0),
      fat: acc.fat + (entry.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  // Get meal config with custom names
  const mealConfig = getMealConfig(nutritionTargets?.meal_names);

  // Group entries by meal type
  const mealGroups = mealConfig.map((meal) => ({
    ...meal,
    entries: foodEntries.filter((e) => e.meal_type === meal.type),
  }));

  // Calculate 7-day weight average (with unit conversion)
  const last7Days = weightEntries.slice(0, 7);
  const sevenDayAverage =
    last7Days.length > 0
      ? last7Days.reduce((sum, e) => sum + convertWeight(e.weight, (e as any).unit || 'lb'), 0) / last7Days.length
      : null;

  // Prepare weight chart data (with unit conversion)
  // Sort by date ascending (oldest first) for proper graph display
  const weightChartData = [...weightEntries]
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime())
    .slice(-30) // Take last 30 entries (most recent)
    .map((entry) => {
      // Use logged_at directly as date string to avoid timezone issues
      const dateStr = entry.logged_at;
      const entryUnit = (entry as any).unit || 'lb';
      const convertedWeight = convertWeight(entry.weight, entryUnit);

      return {
        date: dateStr,
        displayDate: formatDate(dateStr, {
          month: 'short',
          day: 'numeric',
        }),
        weight: Number(convertedWeight.toFixed(1)),
      };
    });

  // Get recent foods for quick add
  const recentFoods: FoodSearchResult[] = Array.from(
    new Map(
      foodEntries
        .filter((e) => (e.source === 'fatsecret' || e.source === 'nutritionix' || e.source === 'usda') && e.food_id)
        .map((e) => [
          e.food_name,
          {
            name: e.food_name,
            servingSize: e.serving_size || '1 serving',
            servingQty: 1,
            calories: e.calories,
            protein: e.protein || 0,
            carbs: e.carbs || 0,
            fat: e.fat || 0,
            foodId: e.food_id!,
          },
        ])
    ).values()
  ).slice(0, 20);

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
  const todayDayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const dateDisplay = isToday
    ? `Today (${todayDayOfWeek})`
    : new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
  
  console.log('[Nutrition] Rendering with date:', selectedDate, 'isToday:', isToday);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex flex-col items-center justify-center py-20">
          <LoadingAnimation type="random" size="lg" />
          <p className="mt-4 text-surface-400">Loading nutrition data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6" suppressHydrationWarning>
      {/* Macro Update Notification */}
      {macroUpdateNotification && (
        <div className="bg-success-500/10 border border-success-500/20 rounded-lg p-3 flex items-center justify-between">
          <span className="text-success-300 text-sm">{macroUpdateNotification}</span>
          <button 
            onClick={() => setMacroUpdateNotification(null)}
            className="text-success-400 hover:text-success-300"
          >
            ✕
          </button>
        </div>
      )}
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-surface-100">Food Tracking</h1>
          <p className="text-surface-400 mt-1">Track your daily food intake and weight</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={showWeightLog ? undefined : () => setShowWeightLog(true)}>
            Log Weight
          </Button>
          <Button variant="secondary" onClick={() => setShowCreateCustomFood(true)}>
            + Custom Food
          </Button>
          <Button variant="primary" onClick={() => setShowMacroCalculator(true)}>
            🧮 Calculate Macros
          </Button>
          <Button variant="ghost" onClick={() => setShowTargetsModal(true)}>
            {nutritionTargets ? 'Edit' : 'Manual'}
          </Button>
        </div>
      </div>

      {/* Date Selector */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => changeDate(-1)}
          className="p-2 text-surface-400 hover:text-surface-100 transition-colors"
          aria-label="Previous day"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center min-w-[140px]">
          <span className="text-base font-medium text-surface-100" suppressHydrationWarning>
            {dateDisplay}
          </span>
          {!isToday && (
            <button
              onClick={goToToday}
              className="ml-2 text-xs text-primary-400 hover:text-primary-300"
            >
              Today
            </button>
          )}
        </div>
        <button
          onClick={() => changeDate(1)}
          disabled={isToday}
          className="p-2 text-surface-400 hover:text-surface-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next day"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Daily Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Calories */}
            <div>
              <div className="text-sm text-surface-400">Calories</div>
              <div className="text-2xl font-bold text-surface-100">
                {Math.round(dailyTotals.calories)}
                {nutritionTargets?.calories && (
                  <span className="text-base text-surface-400 font-normal">
                    {' '}/ {nutritionTargets.calories}
                  </span>
                )}
              </div>
              {nutritionTargets?.calories && (
                <div className="mt-2 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all"
                    style={{
                      width: `${Math.min((dailyTotals.calories / nutritionTargets.calories) * 100, 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Protein */}
            <div>
              <div className="text-sm text-surface-400">Protein</div>
              <div className="text-2xl font-bold text-surface-100">
                {Math.round(dailyTotals.protein)}g
                {nutritionTargets?.protein && (
                  <span className="text-base text-surface-400 font-normal">
                    {' '}/ {nutritionTargets.protein}g
                  </span>
                )}
              </div>
              {nutritionTargets?.protein && (
                <div className="mt-2 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-500 transition-all"
                    style={{
                      width: `${Math.min((dailyTotals.protein / nutritionTargets.protein) * 100, 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Carbs */}
            <div>
              <div className="text-sm text-surface-400">Carbs</div>
              <div className="text-2xl font-bold text-surface-100">
                {Math.round(dailyTotals.carbs)}g
                {nutritionTargets?.carbs && (
                  <span className="text-base text-surface-400 font-normal">
                    {' '}/ {nutritionTargets.carbs}g
                  </span>
                )}
              </div>
              {nutritionTargets?.carbs && (
                <div className="mt-2 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-warning-500 transition-all"
                    style={{
                      width: `${Math.min((dailyTotals.carbs / nutritionTargets.carbs) * 100, 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Fat */}
            <div>
              <div className="text-sm text-surface-400">Fat</div>
              <div className="text-2xl font-bold text-surface-100">
                {Math.round(dailyTotals.fat)}g
                {nutritionTargets?.fat && (
                  <span className="text-base text-surface-400 font-normal">
                    {' '}/ {nutritionTargets.fat}g
                  </span>
                )}
              </div>
              {nutritionTargets?.fat && (
                <div className="mt-2 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-danger-500 transition-all"
                    style={{
                      width: `${Math.min((dailyTotals.fat / nutritionTargets.fat) * 100, 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Remaining Calories & Meal Suggestions */}
          {nutritionTargets?.calories && (
            <div className="mt-4 p-4 bg-surface-800/50 rounded-lg">
              {(() => {
                const remaining = (nutritionTargets.calories || 0) - dailyTotals.calories;
                const mealsPerDay = nutritionTargets.meals_per_day || 3;
                
                // Calculate which meals have been logged (have entries)
                const mealsLogged = mealGroups.filter(m => m.entries.length > 0).length;
                const mealsRemaining = Math.max(0, mealsPerDay - mealsLogged);
                
                // Calculate suggested calories per remaining meal
                const suggestedPerMeal = mealsRemaining > 0 ? Math.round(remaining / mealsRemaining) : 0;
                
                // Find which meals are still empty (not snacks by default)
                const emptyMeals = mealGroups
                  .filter(m => m.entries.length === 0 && m.type !== 'snack')
                  .map(m => m.label);

                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-surface-400">Calories Remaining</div>
                        <div className={`text-2xl font-bold ${remaining >= 0 ? 'text-primary-400' : 'text-danger-400'}`}>
                          {Math.round(remaining)} cal
                        </div>
                      </div>
                      {remaining > 0 && mealsRemaining > 0 && (
                        <div className="text-right">
                          <div className="text-sm text-surface-400">
                            Suggested per meal ({mealsRemaining} left)
                          </div>
                          <div className="text-xl font-semibold text-accent-400">
                            ~{suggestedPerMeal} cal
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {remaining > 0 && emptyMeals.length > 0 && (
                      <p className="text-xs text-surface-500">
                        Meals to log: {emptyMeals.join(', ')}
                      </p>
                    )}
                    
                    {remaining < 0 && (
                      <p className="text-xs text-danger-400">
                        You&apos;ve exceeded your daily target by {Math.abs(Math.round(remaining))} calories
                      </p>
                    )}
                    
                    {remaining > 0 && remaining < 100 && (
                      <p className="text-xs text-success-400">
                        Almost there! Just {Math.round(remaining)} calories to go 🎯
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {!nutritionTargets && (
            <div className="p-4 bg-gradient-to-r from-primary-500/10 to-accent-500/10 border border-primary-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🎯</span>
                <div>
                  <h4 className="font-medium text-surface-100">Get Personalized Macro Targets</h4>
                  <p className="text-sm text-surface-300 mt-1">
                    Let us calculate your ideal calories and macros based on your body stats, 
                    activity level, and goals.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setShowMacroCalculator(true)}
                    >
                      🧮 Calculate My Macros
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowTargetsModal(true)}
                    >
                      Enter Manually
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meal Sections */}
      <div className="space-y-4">
        {mealGroups.map((meal) => (
          <Card key={meal.type}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <span>{meal.emoji}</span>
                  <span>{meal.label}</span>
                  {meal.entries.length > 0 && (
                    <Badge variant="info" className="ml-2">
                      {Math.round(
                        meal.entries.reduce((sum, e) => sum + (e.calories || 0), 0)
                      )}{' '}
                      cal
                    </Badge>
                  )}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openAddFood(meal.type)}
                >
                  + Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {meal.entries.length === 0 ? (
                <p className="text-center text-surface-400 py-4">No foods logged yet</p>
              ) : (
                <div className="space-y-1">
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
                        className="w-full flex items-center gap-3 p-3 hover:bg-surface-800/50 rounded-lg transition-colors group text-left active:bg-surface-700"
                      >
                        {/* Food Icon */}
                        <div className="text-2xl flex-shrink-0 w-10 h-10 flex items-center justify-center bg-surface-800 rounded-lg">
                          {getFoodIcon(entry.food_name)}
                        </div>
                        
                        {/* Food Name & Serving */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-surface-100 truncate">
                            {toTitleCase(entry.food_name)}
                          </div>
                          <div className="text-sm text-surface-500">
                            {entry.servings !== 1 && `${entry.servings} × `}
                            {entry.serving_size}
                          </div>
                        </div>
                        
                        {/* Calories & Macros */}
                        <div className="text-right flex-shrink-0">
                          <div className="font-semibold text-surface-100">
                            {Math.round(entry.calories)}
                          </div>
                          <div className="text-xs text-surface-500">
                            P:{Math.round(entry.protein || 0)} · C:{Math.round(entry.carbs || 0)} · F:{Math.round(entry.fat || 0)}
                          </div>
                        </div>
                        
                        {/* Swipe hint */}
                        <div className="text-surface-600 group-hover:text-primary-400 transition-colors flex-shrink-0">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </div>
                      </button>
                    </SwipeableRow>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Weight Trend */}
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
                    {convertWeight(weightEntries[0]?.weight || 0, (weightEntries[0] as any)?.unit || 'lb').toFixed(1)} {weightUnit}
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
          onRefresh={loadData}
          onSetTarget={() => setShowMacroCalculator(true)}
        />
      )}

      {/* Modals */}
      <AddFoodModal
        isOpen={showAddFood}
        onClose={() => setShowAddFood(false)}
        onAdd={handleAddFood}
        defaultMealType={selectedMealType}
        recentFoods={recentFoods}
        customFoods={customFoods}
        frequentFoods={frequentFoods}
        systemFoods={systemFoods}
      />

      <CreateCustomFoodModal
        isOpen={showCreateCustomFood}
        onClose={() => {
          setShowCreateCustomFood(false);
          setEditingCustomFood(null);
        }}
        onSave={handleSaveCustomFood}
        editingFood={editingCustomFood}
      />

      <WeightLogModal
        isOpen={showWeightLog}
        onClose={() => setShowWeightLog(false)}
        onSave={handleSaveWeight}
      />

      <WeightLogModal
        key={editingWeight?.id || 'new'}
        isOpen={!!editingWeight}
        onClose={() => setEditingWeight(null)}
        onSave={handleUpdateWeight}
        existingEntry={editingWeight || undefined}
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
