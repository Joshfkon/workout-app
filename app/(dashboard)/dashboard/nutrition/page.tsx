'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { AddFoodModal } from '@/components/nutrition/AddFoodModal';
import { WeightLogModal } from '@/components/nutrition/WeightLogModal';
import { NutritionTargetsModal } from '@/components/nutrition/NutritionTargetsModal';
import { MacroCalculatorModal } from '@/components/nutrition/MacroCalculatorModal';
import type {
  FoodLogEntry,
  WeightLogEntry,
  NutritionTargets,
  CustomFood,
  MealType,
} from '@/types/nutrition';
import type { FoodSearchResult } from '@/services/usdaService';
import { recalculateMacrosForWeight } from '@/lib/actions/nutrition';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const MEAL_TYPES: { type: MealType; label: string; emoji: string }[] = [
  { type: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { type: 'lunch', label: 'Lunch', emoji: '☀️' },
  { type: 'dinner', label: 'Dinner', emoji: '🌙' },
  { type: 'snack', label: 'Snacks', emoji: '🍎' },
];

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
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [foodEntries, setFoodEntries] = useState<FoodLogEntry[]>([]);
  const [weightEntries, setWeightEntries] = useState<WeightLogEntry[]>([]);
  const [nutritionTargets, setNutritionTargets] = useState<NutritionTargets | null>(null);
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfileData>({});

  // Modal states
  const [showAddFood, setShowAddFood] = useState(false);
  const [selectedMealType, setSelectedMealType] = useState<MealType>('breakfast');
  const [showWeightLog, setShowWeightLog] = useState(false);
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [showMacroCalculator, setShowMacroCalculator] = useState(false);
  
  // Notification for macro updates
  const [macroUpdateNotification, setMacroUpdateNotification] = useState<string | null>(null);

  const supabase = createUntypedClient();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  async function loadData() {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Load food log entries for selected date
      const { data: foodData } = await supabase
        .from('food_log')
        .select('*')
        .eq('user_id', user.id)
        .eq('logged_at', selectedDate)
        .order('created_at', { ascending: true });

      setFoodEntries(foodData || []);

      // Load nutrition targets
      const { data: targetsData } = await supabase
        .from('nutrition_targets')
        .select('*')
        .eq('user_id', user.id)
        .single();

      setNutritionTargets(targetsData);

      // Load recent weight entries (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data: weightData } = await supabase
        .from('weight_log')
        .select('*')
        .eq('user_id', user.id)
        .gte('logged_at', thirtyDaysAgo.toISOString().split('T')[0])
        .order('logged_at', { ascending: false });

      setWeightEntries(weightData || []);

      // Load custom foods
      const { data: customFoodsData } = await supabase
        .from('custom_foods')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      setCustomFoods(customFoodsData || []);

      // Load user profile data for macro calculator
      const profileData: UserProfileData = {};

      // Get weight from most recent weight log or DEXA scan
      if (weightData && weightData.length > 0) {
        profileData.weightLbs = weightData[0].weight;
      }

      // Get user's basic info
      const { data: userData } = await supabase
        .from('users')
        .select('height_cm, date_of_birth, sex')
        .eq('id', user.id)
        .single();

      if (userData) {
        if (userData.height_cm) {
          profileData.heightInches = Math.round(userData.height_cm / 2.54);
        }
        if (userData.date_of_birth) {
          const birthDate = new Date(userData.date_of_birth);
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
          profileData.age = age;
        }
        if (userData.sex) {
          profileData.sex = userData.sex as 'male' | 'female';
        }
      }

      // Try to get body fat from DEXA scans
      const { data: dexaData } = await supabase
        .from('dexa_scans')
        .select('body_fat_percent, weight_kg')
        .eq('user_id', user.id)
        .order('scan_date', { ascending: false })
        .limit(1)
        .single();

      if (dexaData) {
        if (dexaData.body_fat_percent) {
          profileData.bodyFatPercent = dexaData.body_fat_percent;
        }
        if (dexaData.weight_kg && !profileData.weightLbs) {
          profileData.weightLbs = Math.round(dexaData.weight_kg * 2.20462);
        }
      }

      // Get workouts per week from active mesocycle
      const { data: mesocycleData } = await supabase
        .from('mesocycles')
        .select('days_per_week')
        .eq('user_id', user.id)
        .eq('state', 'active')
        .single();

      if (mesocycleData?.days_per_week) {
        profileData.workoutsPerWeek = mesocycleData.days_per_week;
      }

      setUserProfile(profileData);
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
    if (!confirm('Delete this food entry?')) return;

    const { error } = await supabase.from('food_log').delete().eq('id', id);

    if (error) {
      console.error('Error deleting food:', error);
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

    // Auto-recalculate macros based on new weight
    try {
      const result = await recalculateMacrosForWeight(weightKg);
      if (result.success && !result.skipped && result.newTargets) {
        setMacroUpdateNotification(
          `✅ Macros auto-updated: ${result.newTargets.calories} cal, ${result.newTargets.protein}g protein`
        );
        // Clear notification after 5 seconds
        setTimeout(() => setMacroUpdateNotification(null), 5000);
      }
    } catch (e) {
      console.error('Failed to auto-recalculate macros:', e);
    }

    await loadData();
  }

  async function handleSaveTargets(targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
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
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + delta);
    setSelectedDate(date.toISOString().split('T')[0]);
  }

  function goToToday() {
    setSelectedDate(new Date().toISOString().split('T')[0]);
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

  // Group entries by meal type
  const mealGroups = MEAL_TYPES.map((meal) => ({
    ...meal,
    entries: foodEntries.filter((e) => e.meal_type === meal.type),
  }));

  // Calculate 7-day weight average
  const last7Days = weightEntries.slice(0, 7);
  const sevenDayAverage =
    last7Days.length > 0
      ? last7Days.reduce((sum, e) => sum + e.weight, 0) / last7Days.length
      : null;

  // Prepare weight chart data
  const weightChartData = weightEntries
    .slice(0, 30)
    .reverse()
    .map((entry) => ({
      date: new Date(entry.logged_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      weight: entry.weight,
    }));

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

  const isToday = selectedDate === new Date().toISOString().split('T')[0];
  const dateDisplay = isToday
    ? 'Today'
    : new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex items-center justify-center py-20">
          <div className="text-surface-400">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
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
          <h1 className="text-3xl font-bold text-surface-100">Nutrition Tracking</h1>
          <p className="text-surface-400 mt-1">Track your daily food intake and weight</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={showWeightLog ? undefined : () => setShowWeightLog(true)}>
            Log Weight
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
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => changeDate(-1)}
            >
              ← Previous
            </Button>
            <div className="text-center">
              <div className="text-lg font-semibold text-surface-100">{dateDisplay}</div>
              <div className="text-sm text-surface-400">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric' })}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => changeDate(1)}
              disabled={isToday}
            >
              Next →
            </Button>
          </div>
          {!isToday && (
            <div className="mt-3 text-center">
              <button
                onClick={goToToday}
                className="text-sm text-primary-400 hover:text-primary-300"
              >
                Jump to Today
              </button>
            </div>
          )}
        </CardContent>
      </Card>

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
                <div className="space-y-2">
                  {meal.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-surface-100">{entry.food_name}</div>
                        <div className="text-sm text-surface-400">
                          {entry.servings > 1 && `${entry.servings}x `}
                          {entry.serving_size}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-medium text-surface-100">
                            {Math.round(entry.calories)} cal
                          </div>
                          <div className="text-sm text-surface-400">
                            P: {Math.round(entry.protein || 0)}g · C: {Math.round(entry.carbs || 0)}g · F:{' '}
                            {Math.round(entry.fat || 0)}g
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteFood(entry.id)}
                          className="text-surface-400 hover:text-danger-400 transition-colors"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
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
            <CardTitle>Weight Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div>
                  <div className="text-sm text-surface-400">Current Weight</div>
                  <div className="text-2xl font-bold text-surface-100">
                    {weightEntries[0]?.weight.toFixed(1)} lbs
                  </div>
                  <div className="text-xs text-surface-500">
                    {new Date(weightEntries[0]?.logged_at).toLocaleDateString()}
                  </div>
                </div>
                {sevenDayAverage && (
                  <div>
                    <div className="text-sm text-surface-400">7-Day Average</div>
                    <div className="text-xl font-semibold text-surface-100">
                      {sevenDayAverage.toFixed(1)} lbs
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
                        dataKey="date"
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

      {/* Modals */}
      <AddFoodModal
        isOpen={showAddFood}
        onClose={() => setShowAddFood(false)}
        onAdd={handleAddFood}
        defaultMealType={selectedMealType}
        recentFoods={recentFoods}
        customFoods={customFoods}
      />

      <WeightLogModal
        isOpen={showWeightLog}
        onClose={() => setShowWeightLog(false)}
        onSave={handleSaveWeight}
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
    </div>
  );
}
