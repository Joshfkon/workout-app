'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { FoodSearchResult, FoodSearchResultWithServings } from '@/services/usdaService';
import { searchFoodsAction, getFoodDetailsAction } from '@/lib/actions/food-search';
import { lookupBarcode as lookupBarcodeOFF } from '@/services/openFoodFactsService';
import dynamic from 'next/dynamic';
import { ServingAmountEditor, type ServingAmountValue } from './ServingAmountEditor';
import { FoodEmojiAvatar } from './FoodEmoji';
import { foodEmoji } from '@/lib/nutrition/foodEmoji';
import {
  computeServing,
  weightBasedModel,
  packagedModel,
  perServingModel,
  customPerRefModel,
  servingOptionsModel,
  parseServingWeight,
  modelFromLoggedEntry,
  type FoodAmountModel,
} from '@/lib/nutrition/servingScaling';
import {
  foodKeyFor,
  getLastUsedServing,
  getRecentAmounts,
  recordLastUsedServing,
} from '@/lib/nutrition/lastUsedServing';
import {
  dedupeRecentFoods,
  filterRecentFoods,
  groupPriorMeals,
  limitPriorMealsByDays,
  dayLabel,
  MEALS_INITIAL_DAYS,
  MEALS_LOAD_MORE_DAYS,
  type RecentFood,
  type PriorMeal,
} from '@/lib/nutrition/recentFoods';

// P1-2 (perf): html5-qrcode is ~90KB gz and only needed when the Barcode tab
// is actually opened — load it on demand instead of in nutrition's first-load.
const BarcodeScanner = dynamic(
  () => import('./BarcodeScanner').then((m) => m.BarcodeScanner),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-10 text-sm text-surface-400">
        Loading camera…
      </div>
    ),
  }
);

// Label scanner pulls in tesseract.js — load only when the tab is opened.
const LabelScanner = dynamic(
  () => import('./LabelScanner').then((m) => m.LabelScanner),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-10 text-sm text-surface-400">
        Loading scanner…
      </div>
    ),
  }
);
import type { LabelScanPrefill } from './LabelScanner';
import { IconSearch, IconScan, IconTextScan2, IconPencil, IconX, IconToolsKitchen2, IconPlus, IconChevronRight, IconClock } from '@tabler/icons-react';
import type { MealType, CustomFood, FrequentFood, SystemFood, FoodLogEntry, MealNames, FoodSource } from '@/types/nutrition';

interface ScannedProduct {
  name: string;
  brand?: string;
  servingSize: string;
  servingQuantity: number; // grams per serving
  calories: number; // per serving
  protein: number;
  carbs: number;
  fat: number;
  imageUrl?: string;
  barcode: string;
}

export type AddFoodTab = 'search' | 'barcode' | 'label' | 'manual';

interface AddFoodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (food: {
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
    barcode?: string;
  }) => Promise<void>;
  defaultMealType: MealType;
  /** Tab to open on (Scan quick action opens 'barcode') */
  initialTab?: AddFoodTab;
  /** Called when a scanned barcode isn't found and the user wants to create a custom food */
  onCreateCustomFood?: (barcode: string) => void;
  /** Called with parsed nutrition-label fields for review in the create-food form */
  onLabelScanned?: (prefill: LabelScanPrefill) => void;
  customFoods?: CustomFood[];
  frequentFoods?: FrequentFood[];
  systemFoods?: SystemFood[];
  /**
   * Raw food_log rows (last ~90d, newest first) powering the Recent + Meals
   * views. Deduped/grouped in-component so all localDay labeling lives here.
   */
  recentEntries?: FoodLogEntry[];
  recentsLoading?: boolean;
  /** User meal-name overrides for the Meals browser labels. */
  mealNames?: MealNames | null;
  /** Currently-selected day (YYYY-MM-DD) — excluded from the Meals browser. */
  selectedDay?: string | null;
  /**
   * Instant re-log of a recent/prior-meal food WITHOUT closing the sheet (so the
   * user can grab several). The parent shows the undo toast + updates totals.
   */
  onQuickAdd?: (food: QuickAddFood) => Promise<void>;
  /** Batch variant for a meal's "Add all" — one combined undo. */
  onQuickAddMany?: (foods: QuickAddFood[]) => Promise<void>;
}

export interface QuickAddFood {
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
}

/** Sub-view of the Search tab shown before the user types a query. */
type SearchView = 'recent' | 'meals';

const CATEGORY_LABELS: Record<string, string> = {
  protein: 'Proteins',
  carbs: 'Carbs',
  fats: 'Fats',
  vegetables: 'Vegetables',
  fruits: 'Fruits',
  supplements: 'Supplements',
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium text-surface-500 uppercase tracking-wide mb-1.5">
      {children}
    </p>
  );
}

/** A round quick-add (+) affordance shared by Recent + Meals rows. */
function QuickAddButton({
  onClick,
  disabled,
  loading,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-500/15 text-primary-400 flex items-center justify-center hover:bg-primary-500/25 transition-colors disabled:opacity-40"
    >
      {loading ? (
        <span className="w-3.5 h-3.5 border-2 border-primary-400/40 border-t-primary-400 rounded-full animate-spin" />
      ) : (
        <IconPlus size={16} aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * One recent food: tap the body to open the detail/edit panel, tap + to
 * instant-add with the last-logged serving. Reused for the search-filtered
 * recents section too.
 */
function RecentFoodRow({
  recent,
  onSelect,
  onQuickAdd,
  adding,
  disabled,
}: {
  recent: RecentFood;
  onSelect: () => void;
  onQuickAdd: () => void;
  adding: boolean;
  disabled: boolean;
}) {
  const subtitle = [
    `${Math.round(recent.calories)} cal`,
    recent.serving_size || '1 serving',
  ].join(' · ');
  return (
    <div className="flex items-center gap-2 bg-surface-800/50 rounded-lg pr-2" data-testid="recent-food-row">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 p-2 text-left rounded-lg hover:bg-surface-700 transition-colors flex items-center gap-2"
      >
        <FoodEmojiAvatar name={recent.food_name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-surface-200 truncate">{recent.food_name}</span>
          <span className="text-xs text-surface-500 flex items-center gap-1.5">
            <span className="truncate">{subtitle}</span>
            <span className="text-surface-600" aria-hidden="true">·</span>
            <span className="flex-shrink-0 flex items-center gap-0.5 text-surface-500">
              <IconClock size={11} aria-hidden="true" />
              {dayLabel(recent.loggedAt)}
            </span>
          </span>
        </span>
      </button>
      <QuickAddButton
        onClick={onQuickAdd}
        disabled={disabled}
        loading={adding}
        label={`Quick-add ${recent.food_name}`}
      />
    </div>
  );
}

/** Tidy a USDA serving description into a unit noun (strip trailing "(…g)" and a
 * leading "1 " so "1 cup (160g)" → "cup" while "2 tbsp" is left intact). */
function cleanServingNoun(desc: string): string {
  const noParen = desc.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const noLeadingOne = noParen.replace(/^1\s+/, '').trim();
  return noLeadingOne || noParen || desc;
}

/** Normalise a selectable food (USDA / custom / system) into a scaling model. */
function buildUsdaModel(food: FoodSearchResult | FoodSearchResultWithServings): FoodAmountModel {
  const withServings = food as FoodSearchResultWithServings;
  if (Array.isArray(withServings.servings) && withServings.servings.length > 0) {
    return servingOptionsModel(
      withServings.servings.map((s) => ({
        noun: cleanServingNoun(s.description),
        grams: parseServingWeight(s.description).grams,
        macros: { calories: s.calories, protein: s.protein, carbs: s.carbs, fat: s.fat },
      }))
    );
  }
  return perServingModel(
    { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat },
    'serving',
    parseServingWeight(food.servingSize).grams
  );
}

function buildCustomModel(food: CustomFood): FoodAmountModel {
  if (food.is_per_weight && food.reference_amount && food.calories_per_ref != null) {
    return customPerRefModel(
      {
        calories: food.calories_per_ref || 0,
        protein: food.protein_per_ref || 0,
        carbs: food.carbs_per_ref || 0,
        fat: food.fat_per_ref || 0,
      },
      food.reference_amount,
      food.reference_unit || 'g'
    );
  }
  const grams = parseServingWeight(food.serving_size).grams;
  return perServingModel(
    {
      calories: food.calories || 0,
      protein: food.protein || 0,
      carbs: food.carbs || 0,
      fat: food.fat || 0,
    },
    food.serving_size ? cleanServingNoun(food.serving_size) : 'serving',
    grams
  );
}

export function AddFoodModal({
  isOpen,
  onClose,
  onAdd,
  defaultMealType,
  initialTab,
  onCreateCustomFood,
  onLabelScanned,
  customFoods = [],
  frequentFoods = [],
  systemFoods = [],
  recentEntries = [],
  recentsLoading = false,
  mealNames = null,
  selectedDay = null,
  onQuickAdd,
  onQuickAddMany,
}: AddFoodModalProps) {
  const [activeTab, setActiveTab] = useState<AddFoodTab>('search');
  const [searchView, setSearchView] = useState<SearchView>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [usdaResults, setUsdaResults] = useState<FoodSearchResult[]>([]);
  const [isSearchingUsda, setIsSearchingUsda] = useState(false);
  const [usdaError, setUsdaError] = useState('');
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | FoodSearchResultWithServings | null>(null);
  const [selectedCustomFood, setSelectedCustomFood] = useState<CustomFood | null>(null);
  const [selectedSystemFood, setSelectedSystemFood] = useState<SystemFood | null>(null);
  const [selectedRecent, setSelectedRecent] = useState<FoodLogEntry | null>(null);

  // Meals browser expand state + client-side "load more" window.
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set());
  const [mealsVisibleDays, setMealsVisibleDays] = useState(MEALS_INITIAL_DAYS);
  // Key of the row currently being quick-added (disables its + while in flight).
  const [quickAddingKey, setQuickAddingKey] = useState<string | null>(null);

  // Unified AMOUNT + UNIT state, shared by every food source and the barcode
  // result. The model below tells the editor which units/chips to offer.
  const [amountValue, setAmountValue] = useState<ServingAmountValue>({ amount: '100', unitId: 'g' });
  const [recentAmounts, setRecentAmounts] = useState<number[]>([]);
  const [mealType, setMealType] = useState<MealType>(defaultMealType);

  // Manual entry
  const [manualFood, setManualFood] = useState({
    food_name: '',
    amount: '1',
    unit: 'serving',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [barcodeError, setBarcodeError] = useState('');
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Scanned product state
  const [scannedProduct, setScannedProduct] = useState<ScannedProduct | null>(null);

  // Reset meal type + tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setMealType(defaultMealType);
      setActiveTab(initialTab ?? 'search');
      setSearchView('recent');
      setExpandedMeals(new Set());
      setMealsVisibleDays(MEALS_INITIAL_DAYS);
    }
  }, [isOpen, defaultMealType, initialTab]);

  // Debounce the unified search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // USDA search: only when the debounced query is at least 3 characters
  useEffect(() => {
    if (activeTab !== 'search' || debouncedQuery.length < 3) {
      setUsdaResults([]);
      setUsdaError('');
      setIsSearchingUsda(false);
      return;
    }
    let cancelled = false;
    setIsSearchingUsda(true);
    setUsdaError('');
    searchFoodsAction(debouncedQuery)
      .then((result) => {
        if (cancelled) return;
        if (result.error && result.foods.length === 0) {
          setUsdaError(result.error);
          setUsdaResults([]);
        } else {
          setUsdaResults(result.foods);
        }
      })
      .catch(() => {
        if (!cancelled) setUsdaError('Search failed. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setIsSearchingUsda(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, activeTab]);

  const matchesQuery = useMemo(() => {
    const query = debouncedQuery.toLowerCase();
    const queryNoSpaces = query.replace(/\s+/g, '');
    return (name: string) => {
      if (!query) return true;
      const lower = name.toLowerCase();
      // Match either with spaces or without (e.g., "Rx bar" matches "RXBAR")
      return lower.includes(query) || lower.replace(/\s+/g, '').includes(queryNoSpaces);
    };
  }, [debouncedQuery]);

  // "Your foods": frequent foods for this meal + custom foods
  const frequentFoodsForMeal = useMemo(() => {
    return frequentFoods
      .filter((f) => f.meal_type === mealType && matchesQuery(f.food_name))
      .sort((a, b) => b.times_logged - a.times_logged)
      .slice(0, 5);
  }, [frequentFoods, mealType, matchesQuery]);

  const filteredCustomFoods = useMemo(() => {
    const filtered = customFoods.filter((f) => matchesQuery(f.food_name));
    return debouncedQuery ? filtered.slice(0, 20) : filtered.slice(0, 8);
  }, [customFoods, matchesQuery, debouncedQuery]);

  // "Common foods": system foods
  const filteredSystemFoods = useMemo(() => {
    const filtered = systemFoods.filter((f) => matchesQuery(f.name));
    return debouncedQuery ? filtered.slice(0, 20) : filtered;
  }, [systemFoods, matchesQuery, debouncedQuery]);

  const groupedSystemFoods = useMemo(() => {
    const groups: Record<string, SystemFood[]> = {};
    for (const food of filteredSystemFoods) {
      if (!groups[food.category]) {
        groups[food.category] = [];
      }
      groups[food.category].push(food);
    }
    return groups;
  }, [filteredSystemFoods]);

  // Deduped recents + grouped prior meals, derived once from the raw log rows.
  const recentFoods = useMemo(() => dedupeRecentFoods(recentEntries), [recentEntries]);
  const filteredRecents = useMemo(
    () => filterRecentFoods(recentFoods, debouncedQuery),
    [recentFoods, debouncedQuery]
  );
  const priorMeals = useMemo(
    () => groupPriorMeals(recentEntries, { excludeDay: selectedDay, mealNames }),
    [recentEntries, selectedDay, mealNames]
  );
  const { visible: visibleMeals, hasMore: hasMoreMeals } = useMemo(
    () => limitPriorMealsByDays(priorMeals, mealsVisibleDays),
    [priorMeals, mealsVisibleDays]
  );

  // The currently active selection (search selection or scanned product),
  // normalised so a single detail panel + add handler serves every source.
  const activeSelection = useMemo(() => {
    if (selectedRecent) {
      const { model } = modelFromLoggedEntry(selectedRecent);
      return {
        model,
        foodKey: foodKeyFor({ foodId: selectedRecent.food_id, name: selectedRecent.food_name }),
        name: selectedRecent.food_name,
        subtitle: selectedRecent.serving_size || '1 serving',
        source: (selectedRecent.source ?? 'manual') as FoodSource,
        food_id: selectedRecent.food_id ?? undefined,
      };
    }
    if (scannedProduct) {
      return {
        model: packagedModel(
          {
            calories: scannedProduct.calories,
            protein: scannedProduct.protein,
            carbs: scannedProduct.carbs,
            fat: scannedProduct.fat,
          },
          scannedProduct.servingQuantity,
          'serving'
        ),
        foodKey: foodKeyFor({ barcode: scannedProduct.barcode, name: scannedProduct.name }),
        name: scannedProduct.name,
        subtitle: `Base: ${scannedProduct.servingSize}`,
        source: 'nutritionix' as const,
        barcode: scannedProduct.barcode,
      };
    }
    if (selectedFood) {
      return {
        model: buildUsdaModel(selectedFood),
        foodKey: foodKeyFor({ foodId: selectedFood.foodId, name: selectedFood.name }),
        name: selectedFood.name,
        subtitle: selectedFood.servingSize,
        source: 'usda' as const,
        food_id: selectedFood.foodId,
      };
    }
    if (selectedCustomFood) {
      return {
        model: buildCustomModel(selectedCustomFood),
        foodKey: foodKeyFor({ id: selectedCustomFood.id, name: selectedCustomFood.food_name }),
        name: selectedCustomFood.food_name,
        subtitle: selectedCustomFood.is_per_weight
          ? `Per ${selectedCustomFood.reference_amount}${selectedCustomFood.reference_unit || 'g'}`
          : selectedCustomFood.serving_size || '1 serving',
        source: 'custom' as const,
      };
    }
    if (selectedSystemFood) {
      return {
        model: weightBasedModel({
          calories: selectedSystemFood.calories_per_100g,
          protein: selectedSystemFood.protein_per_100g,
          carbs: selectedSystemFood.carbs_per_100g,
          fat: selectedSystemFood.fat_per_100g,
        }),
        foodKey: foodKeyFor({ id: selectedSystemFood.id, name: selectedSystemFood.name }),
        name: selectedSystemFood.name,
        subtitle: `${selectedSystemFood.calories_per_100g} cal per 100g`,
        source: 'manual' as const,
      };
    }
    return null;
  }, [scannedProduct, selectedFood, selectedCustomFood, selectedSystemFood, selectedRecent]);

  // Prefill the amount/unit from the last-used value for a food (falls back to
  // the model's default serving), and load the recent-amount quick-chips.
  const primeAmountForFood = (model: FoodAmountModel, foodKey: string) => {
    const lastUsed = getLastUsedServing(foodKey);
    const unitExists = lastUsed && model.units.some((u) => u.id === lastUsed.unitId);
    const unitId = unitExists ? lastUsed!.unitId : model.defaultUnitId;
    const amount = unitExists ? lastUsed!.amount : model.defaultAmount;
    setAmountValue({ amount: amount.toString(), unitId });
    setRecentAmounts(getRecentAmounts(foodKey, unitId, 2));
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setBarcodeError('');
    setNotFoundBarcode(null);
    setIsLookingUpBarcode(true);

    try {
      const result = await lookupBarcodeOFF(barcode);
      if (!result.found || !result.product) {
        setBarcodeError(result.error || 'Product not found.');
        setNotFoundBarcode(barcode);
      } else {
        const product: ScannedProduct = {
          name: result.product.name,
          brand: result.product.brand,
          servingSize: result.product.servingSize,
          servingQuantity: result.product.servingQuantity,
          calories: result.product.calories,
          protein: result.product.protein,
          carbs: result.product.carbs,
          fat: result.product.fat,
          imageUrl: result.product.imageUrl,
          barcode: result.product.barcode,
        };
        setScannedProduct(product);
        const model = packagedModel(
          { calories: product.calories, protein: product.protein, carbs: product.carbs, fat: product.fat },
          product.servingQuantity,
          'serving'
        );
        primeAmountForFood(model, foodKeyFor({ barcode: product.barcode, name: product.name }));
        // Stay on barcode tab to show serving selector
      }
    } catch {
      setBarcodeError('Failed to lookup barcode. Please try again.');
    } finally {
      setIsLookingUpBarcode(false);
    }
  };

  const handleSelectFood = async (food: FoodSearchResult) => {
    setSelectedFood(food);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
    setSelectedRecent(null);
    primeAmountForFood(buildUsdaModel(food), foodKeyFor({ foodId: food.foodId, name: food.name }));

    // If the food has a foodId, fetch detailed info with serving options
    const hasServings = 'servings' in food && Array.isArray((food as FoodSearchResultWithServings).servings);
    if (food.foodId && !hasServings) {
      setIsLoadingDetails(true);
      try {
        const result = await getFoodDetailsAction(food.foodId);
        if (result.food) {
          setSelectedFood(result.food);
          primeAmountForFood(buildUsdaModel(result.food), foodKeyFor({ foodId: result.food.foodId, name: result.food.name }));
        }
      } catch (err) {
        console.error('Error fetching food details:', err);
      } finally {
        setIsLoadingDetails(false);
      }
    }
  };

  const handleSelectCustomFood = (food: CustomFood) => {
    setSelectedCustomFood(food);
    setSelectedFood(null);
    setSelectedSystemFood(null);
    setSelectedRecent(null);
    primeAmountForFood(buildCustomModel(food), foodKeyFor({ id: food.id, name: food.food_name }));
  };

  const handleSelectSystemFood = (food: SystemFood) => {
    setSelectedSystemFood(food);
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedRecent(null);
    const model = weightBasedModel({
      calories: food.calories_per_100g,
      protein: food.protein_per_100g,
      carbs: food.carbs_per_100g,
      fat: food.fat_per_100g,
    });
    primeAmountForFood(model, foodKeyFor({ id: food.id, name: food.name }));
  };

  // Tap a recent's row body → open the shared detail panel primed with the
  // last-logged serving, so it can be adjusted before adding.
  const handleSelectRecent = (entry: FoodLogEntry) => {
    setSelectedRecent(entry);
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
    const { model, defaultAmount, defaultUnitId } = modelFromLoggedEntry(entry);
    const foodKey = foodKeyFor({ foodId: entry.food_id, name: entry.food_name });
    const lastUsed = getLastUsedServing(foodKey);
    const unitExists = lastUsed && model.units.some((u) => u.id === lastUsed.unitId);
    const unitId = unitExists ? lastUsed!.unitId : defaultUnitId;
    const amount = unitExists ? lastUsed!.amount : defaultAmount;
    setAmountValue({ amount: amount.toString(), unitId });
    setRecentAmounts(getRecentAmounts(foodKey, unitId, 2));
  };

  // Re-log a logged snapshot as-is into the currently selected meal, keeping the
  // same serving/quantity. Used by every quick-add (+) in Recent and Meals.
  const snapshotOf = (entry: FoodLogEntry): QuickAddFood => ({
    food_name: entry.food_name,
    serving_size: entry.serving_size || '1 serving',
    servings: entry.servings || 1,
    calories: entry.calories || 0,
    protein: entry.protein || 0,
    carbs: entry.carbs || 0,
    fat: entry.fat || 0,
    meal_type: mealType,
    source: entry.source ?? 'manual',
    food_id: entry.food_id ?? undefined,
  });

  // Instant quick-add — does NOT close the sheet, so several can be grabbed.
  const handleQuickAdd = async (entry: FoodLogEntry, rowKey: string) => {
    if (!onQuickAdd) return;
    setQuickAddingKey(rowKey);
    try {
      await onQuickAdd(snapshotOf(entry));
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setQuickAddingKey(null);
    }
  };

  // "Add all" for a prior meal — copies every item into the selected meal.
  const handleAddAllFromMeal = async (meal: PriorMeal) => {
    const foods = meal.entries.map(snapshotOf);
    if (foods.length === 0) return;
    setQuickAddingKey(`all:${meal.key}`);
    try {
      if (onQuickAddMany) {
        await onQuickAddMany(foods);
      } else if (onQuickAdd) {
        for (const food of foods) await onQuickAdd(food);
      }
    } catch {
      setError('Failed to add meal. Please try again.');
    } finally {
      setQuickAddingKey(null);
    }
  };

  const toggleMealExpanded = (key: string) => {
    setExpandedMeals((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Single add handler for every selectable / scanned food.
  const handleAddSelection = async () => {
    if (!activeSelection) return;

    const amountNum = parseFloat(amountValue.amount);
    if (!amountNum || amountNum <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const result = computeServing(activeSelection.model, amountValue.amount, amountValue.unitId);
      await onAdd({
        food_name: activeSelection.name,
        serving_size: result.servingSize,
        servings: result.servings,
        calories: result.macros.calories,
        protein: result.macros.protein,
        carbs: result.macros.carbs,
        fat: result.macros.fat,
        meal_type: mealType,
        source: activeSelection.source,
        food_id: activeSelection.food_id,
        barcode: activeSelection.barcode,
      });
      recordLastUsedServing(activeSelection.foodKey, amountNum, amountValue.unitId);
      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddManualFood = async () => {
    if (!manualFood.food_name || !manualFood.calories) {
      setError('Please enter at least food name and calories');
      return;
    }

    const calories = parseFloat(manualFood.calories);
    if (!calories || calories < 0) {
      setError('Please enter a valid calorie amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const amountNum = parseFloat(manualFood.amount) || 1;
      const unit = manualFood.unit.trim() || 'serving';
      await onAdd({
        food_name: manualFood.food_name,
        serving_size: `${amountNum} ${unit}`,
        servings: 1,
        calories: Math.round(calories),
        protein: parseFloat(manualFood.protein) || 0,
        carbs: parseFloat(manualFood.carbs) || 0,
        fat: parseFloat(manualFood.fat) || 0,
        meal_type: mealType,
        source: 'manual',
      });

      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddFrequentFood = async (food: FrequentFood) => {
    setIsSubmitting(true);
    setError('');

    try {
      await onAdd({
        food_name: food.food_name,
        serving_size: food.serving_size || '1 serving',
        servings: 1,
        calories: Math.round(food.avg_calories),
        protein: Math.round(food.avg_protein * 10) / 10,
        carbs: Math.round(food.avg_carbs * 10) / 10,
        fat: Math.round(food.avg_fat * 10) / 10,
        meal_type: mealType,
        source: 'manual',
      });

      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearSelection = () => {
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
    setSelectedRecent(null);
  };

  const resetAndClose = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setUsdaResults([]);
    setUsdaError('');
    clearSelection();
    setAmountValue({ amount: '100', unitId: 'g' });
    setRecentAmounts([]);
    setManualFood({
      food_name: '',
      amount: '1',
      unit: 'serving',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
    });
    setError('');
    setBarcodeError('');
    setNotFoundBarcode(null);
    setScannedProduct(null);
    onClose();
  };

  // Handle scan again
  const handleScanAgain = () => {
    setScannedProduct(null);
    setBarcodeError('');
    setNotFoundBarcode(null);
  };

  const hasSelection = !!(selectedFood || selectedCustomFood || selectedSystemFood || selectedRecent);
  const showUsdaSection = debouncedQuery.length >= 3;

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Add food"
      size="lg"
    >
      <div className="space-y-4">
        {/* Meal Type Selector */}
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1">
            Meal
          </label>
          <Select
            value={mealType}
            onChange={(e) => setMealType(e.target.value as MealType)}
            options={[
              { value: 'breakfast', label: 'Breakfast' },
              { value: 'lunch', label: 'Lunch' },
              { value: 'dinner', label: 'Dinner' },
              { value: 'snack', label: 'Snack' },
            ]}
          />
        </div>

        {/* Tabs — flex-1 so all four (incl. Manual) fit the modal width on
            phones instead of overflowing off-screen. */}
        <div className="flex border-b border-surface-800">
          {([
            { id: 'search' as AddFoodTab, label: 'Search', icon: IconSearch },
            { id: 'barcode' as AddFoodTab, label: 'Barcode', icon: IconScan },
            { id: 'label' as AddFoodTab, label: 'Label', icon: IconTextScan2 },
            { id: 'manual' as AddFoodTab, label: 'Manual', icon: IconPencil },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                clearSelection();
              }}
              className={`flex-1 min-w-0 px-1 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap flex items-center justify-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              <tab.icon size={15} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Unified Search Tab: your foods + common foods + USDA */}
        {activeTab === 'search' && (
          <div className="space-y-4">
            {!hasSelection && (
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your foods, common foods, and USDA..."
                className="w-full"
              />
            )}

            {/* Selected food detail — one panel, one editor, every source */}
            {hasSelection && activeSelection && (
              <div className="space-y-4 p-4 bg-surface-800 rounded-lg" data-testid="add-food-detail">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium text-surface-100">{activeSelection.name}</h3>
                    <p className="text-xs text-primary-400">{activeSelection.subtitle}</p>
                  </div>
                  <button
                    onClick={clearSelection}
                    className="text-surface-400 hover:text-surface-200 flex-shrink-0"
                    aria-label="Clear selection"
                  >
                    <IconX size={16} aria-hidden="true" />
                  </button>
                </div>

                {isLoadingDetails ? (
                  <p className="text-sm text-surface-400 py-2">Loading serving options...</p>
                ) : (
                  <>
                    <ServingAmountEditor
                      model={activeSelection.model}
                      value={amountValue}
                      onChange={setAmountValue}
                      recentAmounts={recentAmounts}
                      testIdPrefix="add-food"
                    />

                    <Button
                      onClick={handleAddSelection}
                      variant="primary"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? 'Adding...' : 'Add to log'}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Recent | Meals segmented control — the default views shown
                before the user commits to a full search. */}
            {!hasSelection && !debouncedQuery && (
              <div className="flex gap-1 p-1 bg-surface-800/60 rounded-lg" role="tablist" aria-label="Recent or meals">
                {(['recent', 'meals'] as SearchView[]).map((view) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={searchView === view}
                    onClick={() => setSearchView(view)}
                    data-testid={`add-food-view-${view}`}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      searchView === view
                        ? 'bg-surface-700 text-surface-100'
                        : 'text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    {view === 'recent' ? 'Recent' : 'Meals'}
                  </button>
                ))}
              </div>
            )}

            {/* Default view: MEALS (browse & pick from prior logged meals) */}
            {!hasSelection && !debouncedQuery && searchView === 'meals' && (
              <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="prior-meals-list">
                {recentsLoading && priorMeals.length === 0 ? (
                  <>
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-14 rounded-lg bg-surface-800/60 animate-pulse" />
                    ))}
                  </>
                ) : visibleMeals.length === 0 ? (
                  <div className="py-8 text-center" data-testid="prior-meals-empty">
                    <IconToolsKitchen2 size={28} className="mx-auto text-surface-600 mb-2" aria-hidden="true" />
                    <p className="text-sm text-surface-400">No prior meals yet</p>
                    <p className="text-xs text-surface-500 mt-1">
                      Meals you log will appear here so you can grab foods from them.
                    </p>
                  </div>
                ) : (
                  <>
                    {visibleMeals.map((meal) => {
                      const isExpanded = expandedMeals.has(meal.key);
                      return (
                        <div
                          key={meal.key}
                          className="bg-surface-800/50 rounded-lg overflow-hidden"
                          data-testid="prior-meal"
                        >
                          <div className="flex items-center gap-2 pr-2">
                            <button
                              type="button"
                              onClick={() => toggleMealExpanded(meal.key)}
                              aria-expanded={isExpanded}
                              className="flex-1 min-w-0 p-3 text-left flex items-center gap-2 hover:bg-surface-700 transition-colors"
                            >
                              <IconChevronRight
                                size={16}
                                aria-hidden="true"
                                className={`flex-shrink-0 text-surface-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-surface-200 truncate">
                                  {meal.dayLabel} · {meal.mealLabel}
                                </span>
                                <span className="block text-xs text-surface-500">
                                  {Math.round(meal.totalCalories)} cal · {meal.itemCount} item{meal.itemCount === 1 ? '' : 's'}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddAllFromMeal(meal)}
                              disabled={isSubmitting || quickAddingKey !== null}
                              className="flex-shrink-0 text-xs font-semibold text-primary-400 px-2 py-1 rounded-md hover:bg-primary-500/15 transition-colors disabled:opacity-40"
                              data-testid="prior-meal-add-all"
                            >
                              {quickAddingKey === `all:${meal.key}` ? 'Adding…' : 'Add all'}
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="px-2 pb-2 space-y-1">
                              {meal.entries.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-center gap-2 bg-surface-900/40 rounded-lg pr-2"
                                  data-testid="prior-meal-food"
                                >
                                  <div className="flex-1 min-w-0 p-2 flex items-center gap-2">
                                    <FoodEmojiAvatar name={entry.food_name} size="sm" />
                                    <div className="min-w-0">
                                      <p className="text-sm text-surface-200 truncate">{entry.food_name}</p>
                                      <p className="text-xs text-surface-500 truncate">
                                        {Math.round(entry.calories || 0)} cal · {entry.serving_size || '1 serving'}
                                      </p>
                                    </div>
                                  </div>
                                  <QuickAddButton
                                    onClick={() => handleQuickAdd(entry, `meal-item:${entry.id}`)}
                                    disabled={isSubmitting || quickAddingKey !== null}
                                    loading={quickAddingKey === `meal-item:${entry.id}`}
                                    label={`Add ${entry.food_name}`}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {hasMoreMeals && (
                      <button
                        type="button"
                        onClick={() => setMealsVisibleDays((d) => d + MEALS_LOAD_MORE_DAYS)}
                        className="w-full py-2 text-sm text-primary-400 hover:text-primary-300 transition-colors"
                        data-testid="prior-meals-load-more"
                      >
                        Load more
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* RECENT view (default) + full search results. Recents rank above
                the global DB results — matching Lose It: before a query the
                deduped recents list shows on top of the browse sections; once a
                query is typed, filtered recents rank above Your foods / Common /
                USDA. The Meals view (above) replaces this when selected. */}
            {!hasSelection && (debouncedQuery || searchView === 'recent') && (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {/* Recent — deduped recently-logged foods (full when no query,
                    filtered above the DB results while searching). */}
                <section data-testid="recent-foods-list">
                  <SectionLabel>Recent</SectionLabel>
                  {recentsLoading && recentFoods.length === 0 ? (
                    <div className="space-y-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-12 rounded-lg bg-surface-800/60 animate-pulse" />
                      ))}
                    </div>
                  ) : filteredRecents.length === 0 ? (
                    <p className="text-[13px] text-surface-500 py-1" data-testid="recent-foods-empty">
                      {debouncedQuery
                        ? 'No matches in recent foods'
                        : 'No recent foods yet — search or scan to log your first food.'}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {(debouncedQuery ? filteredRecents.slice(0, 8) : filteredRecents).map((recent) => (
                        <RecentFoodRow
                          key={recent.key}
                          recent={recent}
                          onSelect={() => handleSelectRecent(recent.entry)}
                          onQuickAdd={() => handleQuickAdd(recent.entry, recent.key)}
                          adding={quickAddingKey === recent.key}
                          disabled={isSubmitting || quickAddingKey !== null}
                        />
                      ))}
                    </div>
                  )}
                </section>
                {/* Your foods: frequent for this meal + custom foods */}
                <section>
                  <SectionLabel>Your foods</SectionLabel>
                  {frequentFoodsForMeal.length === 0 && filteredCustomFoods.length === 0 ? (
                    <p className="text-[13px] text-surface-500 py-1">
                      {debouncedQuery ? 'No matches in your foods' : `No ${MEAL_LABELS[mealType].toLowerCase()} favorites or custom foods yet`}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {frequentFoodsForMeal.map((food, idx) => (
                        <button
                          key={`freq-${idx}`}
                          onClick={() => handleAddFrequentFood(food)}
                          disabled={isSubmitting}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FoodEmojiAvatar name={food.food_name} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-surface-200 truncate">{food.food_name}</p>
                              <p className="text-xs text-surface-500">
                                {Math.round(food.avg_calories)} cal · logged {food.times_logged}x
                              </p>
                            </div>
                          </div>
                          <span className="text-primary-400 text-sm flex-shrink-0">+ Add</span>
                        </button>
                      ))}
                      {filteredCustomFoods.map((food) => (
                        <button
                          key={food.id}
                          onClick={() => handleSelectCustomFood(food)}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FoodEmojiAvatar name={food.food_name} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-surface-200 truncate">{food.food_name}</p>
                              <p className="text-xs text-surface-500">
                                {food.is_per_weight
                                  ? `${food.calories_per_ref} cal per ${food.reference_amount}${food.reference_unit || 'g'}`
                                  : `${food.calories} cal · ${food.serving_size}`}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs text-surface-500 flex-shrink-0">Custom</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {/* Common foods: system foods */}
                <section>
                  <SectionLabel>Common foods</SectionLabel>
                  {filteredSystemFoods.length === 0 ? (
                    <p className="text-[13px] text-surface-500 py-1">No matches in common foods</p>
                  ) : debouncedQuery ? (
                    <div className="space-y-1">
                      {filteredSystemFoods.map((food) => (
                        <button
                          key={food.id}
                          onClick={() => handleSelectSystemFood(food)}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <FoodEmojiAvatar name={food.name} size="sm" />
                            <span className="text-sm text-surface-200 truncate">{food.name}</span>
                          </span>
                          <span className="text-xs text-surface-500 flex-shrink-0">
                            {food.calories_per_100g} cal | {food.protein_per_100g}g P
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    Object.entries(groupedSystemFoods).map(([category, foods]) => (
                      <div key={category} className="mb-2">
                        <p className="text-[11px] text-surface-600 mb-1">
                          {CATEGORY_LABELS[category] || category}
                        </p>
                        <div className="space-y-1">
                          {foods.slice(0, 6).map((food) => (
                            <button
                              key={food.id}
                              onClick={() => handleSelectSystemFood(food)}
                              className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <FoodEmojiAvatar name={food.name} size="sm" />
                                <span className="text-sm text-surface-200 truncate">{food.name}</span>
                              </span>
                              <span className="text-xs text-surface-500 flex-shrink-0">
                                {food.calories_per_100g} cal | {food.protein_per_100g}g P
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </section>

                {/* USDA database */}
                <section>
                  <SectionLabel>USDA database</SectionLabel>
                  {!showUsdaSection ? (
                    <p className="text-[13px] text-surface-500 py-1">
                      Type at least 3 characters to search the USDA database
                    </p>
                  ) : isSearchingUsda ? (
                    <p className="text-[13px] text-surface-400 py-1">Searching USDA...</p>
                  ) : usdaError ? (
                    <p className="text-[13px] text-surface-500 py-1">{usdaError}</p>
                  ) : usdaResults.length === 0 ? (
                    <p className="text-[13px] text-surface-500 py-1">No USDA results</p>
                  ) : (
                    <div className="space-y-1">
                      {usdaResults.map((food, idx) => (
                        <button
                          key={food.foodId ?? idx}
                          onClick={() => handleSelectFood(food)}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FoodEmojiAvatar name={food.name} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm text-surface-200 truncate">{food.name}</p>
                              <p className="text-xs text-surface-500">{food.servingSize}</p>
                            </div>
                          </div>
                          <span className="text-xs text-surface-500 flex-shrink-0">
                            {food.calories} cal | {food.protein}g P
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}

        {/* Barcode Scanner Tab */}
        {activeTab === 'barcode' && (
          <div className="space-y-4">
            {barcodeError && (
              <div className="p-3 text-sm text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg space-y-2">
                <p>{barcodeError}</p>
                {notFoundBarcode && onCreateCustomFood && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const barcode = notFoundBarcode;
                      resetAndClose();
                      onCreateCustomFood(barcode);
                    }}
                  >
                    Create custom food for this barcode
                  </Button>
                )}
              </div>
            )}

            {isLookingUpBarcode ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-surface-400">Looking up product...</div>
              </div>
            ) : scannedProduct && activeSelection ? (
              // Scanned Product with the shared AMOUNT + UNIT editor
              <div className="space-y-4">
                <div className="bg-surface-800 rounded-lg p-4 space-y-4" data-testid="add-food-detail">
                  {/* Product Image and Name */}
                  <div className="flex items-start gap-4">
                    {scannedProduct.imageUrl ? (
                      <div className="relative w-20 h-20 rounded-lg bg-white overflow-hidden">
                        <Image
                          src={scannedProduct.imageUrl}
                          alt={scannedProduct.name}
                          fill
                          className="object-contain"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div
                        className="w-20 h-20 bg-surface-700 rounded-lg flex items-center justify-center text-3xl"
                        aria-hidden="true"
                      >
                        {foodEmoji(scannedProduct.name, scannedProduct.brand)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-surface-100 text-lg leading-tight">
                        {scannedProduct.name}
                      </h3>
                      {scannedProduct.brand && (
                        <p className="text-sm text-surface-400 mt-1">
                          {scannedProduct.brand}
                        </p>
                      )}
                      <p className="text-xs text-surface-500 mt-1">
                        Base: {scannedProduct.servingSize}
                      </p>
                    </div>
                  </div>

                  <ServingAmountEditor
                    model={activeSelection.model}
                    value={amountValue}
                    onChange={setAmountValue}
                    recentAmounts={recentAmounts}
                    testIdPrefix="add-food"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    onClick={handleScanAgain}
                    variant="secondary"
                    className="flex-1"
                  >
                    Scan again
                  </Button>
                  <Button
                    onClick={handleAddSelection}
                    variant="primary"
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    {isSubmitting ? 'Adding...' : 'Add food'}
                  </Button>
                </div>
              </div>
            ) : (
              <BarcodeScanner
                onScan={handleBarcodeScanned}
                onClose={() => setActiveTab('search')}
              />
            )}
          </div>
        )}

        {/* Scan Label Tab: photo → on-device OCR → create-food form review */}
        {activeTab === 'label' && (
          <LabelScanner
            onClose={() => setActiveTab('search')}
            onParsed={(prefill) => {
              if (onLabelScanned) {
                resetAndClose();
                onLabelScanned(prefill);
              }
            }}
          />
        )}

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Food name *
              </label>
              <Input
                value={manualFood.food_name}
                onChange={(e) => setManualFood({ ...manualFood, food_name: e.target.value })}
                placeholder="e.g., Grilled Chicken"
              />
            </div>

            {/* Amount + unit (matches the editor's layout for consistency) */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Amount
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={manualFood.amount}
                  onChange={(e) => setManualFood({ ...manualFood, amount: e.target.value })}
                  className="flex-1"
                  data-testid="manual-amount"
                />
                <Input
                  value={manualFood.unit}
                  onChange={(e) => setManualFood({ ...manualFood, unit: e.target.value })}
                  placeholder="serving, g, oz…"
                  className="flex-1"
                  data-testid="manual-unit"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Calories *
                </label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={manualFood.calories}
                  onChange={(e) => setManualFood({ ...manualFood, calories: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Protein (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={manualFood.protein}
                  onChange={(e) => setManualFood({ ...manualFood, protein: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Carbs (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={manualFood.carbs}
                  onChange={(e) => setManualFood({ ...manualFood, carbs: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Fat (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={manualFood.fat}
                  onChange={(e) => setManualFood({ ...manualFood, fat: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>

            <Button
              onClick={handleAddManualFood}
              variant="primary"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? 'Adding...' : 'Add to log'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
