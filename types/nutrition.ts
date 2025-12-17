/**
 * Nutrition Tracking Types
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type FoodSource = 'usda' | 'fatsecret' | 'nutritionix' | 'custom' | 'manual';

export interface FoodLogEntry {
  id: string;
  user_id: string;
  logged_at: string; // ISO date string (YYYY-MM-DD)
  meal_type: MealType;
  food_name: string;
  serving_size: string | null;
  servings: number;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  source: FoodSource | null;
  food_id: string | null; // FatSecret food_id
  nutritionix_id: string | null; // Legacy Nutritionix ID
  created_at: string;
}

export interface CustomFood {
  id: string;
  user_id: string;
  food_name: string;
  serving_size: string | null;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  // Per-weight tracking (optional) - enter nutrition for a reference amount
  is_per_weight?: boolean;
  reference_amount?: number | null; // e.g., 28 (grams) or 1 (oz)
  reference_unit?: 'g' | 'oz' | null; // grams or ounces
  calories_per_ref?: number | null;
  protein_per_ref?: number | null;
  carbs_per_ref?: number | null;
  fat_per_ref?: number | null;
  // Barcode scanning
  barcode?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FrequentFood {
  user_id: string;
  meal_type: MealType;
  food_name: string;
  serving_size: string | null;
  avg_calories: number;
  avg_protein: number;
  avg_carbs: number;
  avg_fat: number;
  times_logged: number;
  last_logged: string;
}

export interface SystemFood {
  id: string;
  name: string;
  category: 'protein' | 'carbs' | 'fats' | 'vegetables' | 'fruits' | 'supplements';
  subcategory: string | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
}

export interface WeightLogEntry {
  id: string;
  user_id: string;
  logged_at: string; // ISO date string (YYYY-MM-DD)
  weight: number; // in lbs
  notes: string | null;
  created_at: string;
}

export interface NutritionTargets {
  id: string;
  user_id: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  created_at: string;
  updated_at: string;
}

// UI/Form Types
export interface DailyNutritionSummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  entries: FoodLogEntry[];
  targetCalories: number | null;
  targetProtein: number | null;
  targetCarbs: number | null;
  targetFat: number | null;
}

export interface MealSection {
  mealType: MealType;
  entries: FoodLogEntry[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
}

export interface AddFoodFormData {
  food_name: string;
  serving_size: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  meal_type: MealType;
  source?: FoodSource;
  food_id?: string; // FatSecret food_id
  nutritionix_id?: string; // Legacy Nutritionix ID
}

export interface WeightTrend {
  entries: WeightLogEntry[];
  currentWeight: number | null;
  sevenDayAverage: number | null;
  trend: 'increasing' | 'decreasing' | 'stable' | null;
}

// Form validation
export interface NutritionFormErrors {
  food_name?: string;
  serving_size?: string;
  servings?: string;
  calories?: string;
  protein?: string;
  carbs?: string;
  fat?: string;
}
