'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { SegmentedControl, Chip } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { FoodSearchResult, FoodSearchResultWithServings } from '@/services/usdaService';
import { searchFoodsAction, getFoodDetailsAction } from '@/lib/actions/food-search';
import { friendlyUsdaError } from '@/lib/nutrition/usdaErrorMessage';
import { lookupBarcode as lookupBarcodeOFF } from '@/services/openFoodFactsService';
import { lookupBarcodeUsdaAction } from '@/lib/actions/nutrition';
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
  withHouseholdServing,
  withEverydayUnit,
  EVERYDAY_UNIT_ID,
  isHouseholdNoun,
  type FoodAmountModel,
} from '@/lib/nutrition/servingScaling';
import { householdServingForSystemFood } from '@/lib/nutrition/householdServings';
import {
  foodKeysFor,
  getLastUsedServingForKeys,
  getRecentAmounts,
  recordLastUsedServingForKeys,
} from '@/lib/nutrition/lastUsedServing';
import {
  defaultPortion,
  describeDefaultPortion,
  oneTapPortion,
  typicalPortionForSystemFood,
  type OneTapPortion,
  everydayUnitForSystemFood,
  type DefaultPortion,
  type TypicalPortion,
} from '@/lib/nutrition/portionDefaults';
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
import { formatPortion, frequentFoodPortion } from '@/lib/nutrition/frequentFoods';

// P1-2 (perf): html5-qrcode is ~90KB gz and only needed when the Barcode tab
// is actually opened — load it on demand instead of in nutrition's first-load.
const BarcodeScanner = dynamic(
  () => import('./BarcodeScanner').then((m) => m.BarcodeScanner),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-10 text-subhead text-ink-2">
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
      <div className="flex items-center justify-center py-10 text-subhead text-ink-2">
        Loading scanner…
      </div>
    ),
  }
);
import type { LabelScanPrefill } from './LabelScanner';
import { IconSearch, IconScan, IconTextScan2, IconPencil, IconX, IconToolsKitchen2, IconPlus, IconChevronRight, IconClock, IconSparkles, IconBookmark, IconCheck } from '@tabler/icons-react';
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
  /** Opens "Describe a meal" (AI) — shown as a shortcut in the sheet. */
  onOpenDescribe?: () => void;
  /** Opens saved meals — shown as a shortcut in the sheet. */
  onOpenSavedMeals?: () => void;
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
  /** Called when the user switches the meal in the sheet, so the page can follow it */
  onMealTypeChange?: (mealType: MealType) => void;
  /** Tab to open on (Scan quick action opens 'barcode') */
  initialTab?: AddFoodTab;
  /**
   * Put the cursor in the search box when the sheet opens on Search. The
   * Search quick action sets it: the user came to type, so one tap must be
   * enough (r20 panel, 6 of 6: "I had to try again before I could type").
   * "Log food" / "Add food" leave it off so the Recent list isn't hidden
   * behind the keyboard.
   */
  focusSearch?: boolean;
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
  /**
   * The user's weight preference. Imperial users see a gram default's ounce
   * equivalent ("113 g · about 4 oz, ..."); metric users a plain picture.
   */
  units?: 'lb' | 'kg';
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

/**
 * A food as it was logged once (a recent row or a frequent food's last
 * portion). Re-logging it, or opening it in the editor, starts from exactly
 * this portion.
 */
type LoggedPortion = Pick<
  FoodLogEntry,
  'food_name' | 'serving_size' | 'servings' | 'calories' | 'protein' | 'carbs' | 'fat' | 'source' | 'food_id'
>;

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
    <p className="text-caption font-medium text-ink-2 mb-1.5">
      {children}
    </p>
  );
}

/** Section label with a right-aligned note saying where + adds to. */
function QuickAddSectionLabel({ children, mealLabel }: { children: React.ReactNode; mealLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-1.5">
      <p className="text-caption font-medium text-ink-2">{children}</p>
      <p className="text-caption text-ink-3" data-testid="quick-add-target">+ adds to {mealLabel}</p>
    </div>
  );
}

/**
 * A round quick-add (+) affordance shared by Recent, Meals and search rows.
 * After a successful add it turns into a green check for a moment (`done`),
 * so the tap visibly landed even with the sheet still open.
 */
function QuickAddButton({
  onClick,
  disabled,
  loading,
  done,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  done?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-done={done ? 'true' : undefined}
      className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
        done ? 'bg-status-ok text-white' : 'bg-action/15 text-action hover:bg-action/25'
      }`}
    >
      {loading ? (
        <span className="w-3.5 h-3.5 border-2 border-action/40 border-t-action rounded-full animate-spin" />
      ) : done ? (
        <IconCheck size={18} stroke={3} aria-hidden="true" />
      ) : (
        <IconPlus size={16} aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * A searched food (common, your custom, or USDA): tap the body to choose an
 * amount, or + to add the portion shown in one tap (its last-used or typical
 * serving, see oneTapPortion). Without a real portion to default to, the row
 * shows its reference numbers and has no + (the editor asks how much).
 */
function SearchFoodRow({
  name,
  oneTap,
  fallbackSubtitle,
  fallbackNumbers,
  trailingTag,
  onSelect,
  onQuickAdd,
  adding,
  done,
  disabled,
  mealLabel,
  testId,
}: {
  name: string;
  oneTap: OneTapPortion | null;
  fallbackSubtitle: string;
  fallbackNumbers?: string;
  trailingTag?: string;
  onSelect: () => void;
  onQuickAdd?: () => void;
  adding: boolean;
  done: boolean;
  disabled: boolean;
  mealLabel: string;
  testId: string;
}) {
  const subtitle = oneTap
    ? `${oneTap.label} · ${Math.round(oneTap.macros.calories)} cal · ${Math.round(oneTap.macros.protein)}g P`
    : fallbackSubtitle;
  return (
    <div className="flex items-center gap-2 bg-fill/50 rounded-lg pr-2" data-testid={testId}>
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 p-2 text-left rounded-lg hover:bg-fill transition-colors flex items-center gap-2"
      >
        <FoodEmojiAvatar name={name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-subhead text-ink truncate">{name}</span>
          <span className="block text-caption text-ink-2 truncate" data-testid="search-row-portion">
            {subtitle}
          </span>
        </span>
        {!oneTap && fallbackNumbers && (
          <span className="text-caption text-ink-2 flex-shrink-0">{fallbackNumbers}</span>
        )}
        {trailingTag && <span className="text-caption text-ink-3 flex-shrink-0">{trailingTag}</span>}
      </button>
      {oneTap && onQuickAdd && (
        <QuickAddButton
          onClick={onQuickAdd}
          disabled={disabled}
          loading={adding}
          done={done}
          label={`Quick-add ${name}, ${oneTap.label}, to ${mealLabel}`}
        />
      )}
    </div>
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
  done = false,
  disabled,
  mealLabel,
}: {
  recent: RecentFood;
  onSelect: () => void;
  onQuickAdd: () => void;
  adding: boolean;
  done?: boolean;
  disabled: boolean;
  mealLabel: string;
}) {
  const portion = formatPortion(recent.serving_size);
  const subtitle = [portion, `${Math.round(recent.calories)} cal`].join(' · ');
  return (
    <div className="flex items-center gap-2 bg-fill/50 rounded-lg pr-2" data-testid="recent-food-row">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 p-2 text-left rounded-lg hover:bg-fill transition-colors flex items-center gap-2"
      >
        <FoodEmojiAvatar name={recent.food_name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-subhead font-medium text-ink truncate">{recent.food_name}</span>
          <span className="text-caption text-ink-2 flex items-center gap-1.5">
            <span className="truncate">{subtitle}</span>
            <span className="text-ink-3" aria-hidden="true">·</span>
            <span className="flex-shrink-0 flex items-center gap-0.5 text-ink-2">
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
        done={done}
        label={`Quick-add ${recent.food_name}, ${portion}, to ${mealLabel}`}
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

/** A scanned product per label serving, named by its household measure when it has one ("bar"). */
function buildScannedModel(product: ScannedProduct): FoodAmountModel {
  const noun = product.servingSize ? cleanServingNoun(product.servingSize) : '';
  return packagedModel(
    { calories: product.calories, protein: product.protein, carbs: product.carbs, fat: product.fat },
    product.servingQuantity,
    noun && isHouseholdNoun(noun) ? noun : 'serving'
  );
}

/**
 * System foods are per-100g; add the household unit people count in, if any
 * (it becomes the default). A weighed food with no household unit gets an
 * everyday measure ("palm-size portion") offered alongside grams instead.
 */
function buildSystemModel(food: SystemFood): FoodAmountModel {
  const household = householdServingForSystemFood(food.name);
  const model = withHouseholdServing(
    weightBasedModel({
      calories: food.calories_per_100g,
      protein: food.protein_per_100g,
      carbs: food.carbs_per_100g,
      fat: food.fat_per_100g,
    }),
    household
  );
  return household ? model : withEverydayUnit(model, everydayUnitForSystemFood(food));
}

/**
 * What a system food's numbers on a search row refer to: its household
 * serving when it has one ("1 large egg"), else honestly "100 g". Macros come
 * from the same model + computeServing the editor uses.
 */
function systemRowPortion(food: SystemFood): { label: string; calories: number; protein: number } {
  const model = buildSystemModel(food);
  const unit = model.units.find((u) => u.id === model.defaultUnitId) ?? model.units[0];
  const { macros } = computeServing(model, model.defaultAmount, model.defaultUnitId);
  const label = unit.kind === 'weight' ? `${model.defaultAmount} ${unit.noun}` : `1 ${unit.noun}`;
  return { label, calories: macros.calories, protein: macros.protein };
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
  onMealTypeChange,
  initialTab,
  focusSearch = false,
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
  onOpenDescribe,
  onOpenSavedMeals,
  units,
}: AddFoodModalProps) {
  const [activeTab, setActiveTab] = useState<AddFoodTab>('search');
  const [searchView, setSearchView] = useState<SearchView>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [usdaResults, setUsdaResults] = useState<FoodSearchResult[]>([]);
  const [isSearchingUsda, setIsSearchingUsda] = useState(false);
  const [usdaError, setUsdaError] = useState('');
  // Bumped by the USDA section's Retry button to re-run the same search.
  const [usdaRetryNonce, setUsdaRetryNonce] = useState(0);
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | FoodSearchResultWithServings | null>(null);
  const [selectedCustomFood, setSelectedCustomFood] = useState<CustomFood | null>(null);
  const [selectedSystemFood, setSelectedSystemFood] = useState<SystemFood | null>(null);
  const [selectedRecent, setSelectedRecent] = useState<LoggedPortion | null>(null);

  // Meals browser expand state + client-side "load more" window.
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set());
  const [mealsVisibleDays, setMealsVisibleDays] = useState(MEALS_INITIAL_DAYS);
  // Key of the row currently being quick-added (disables its + while in flight).
  const [quickAddingKey, setQuickAddingKey] = useState<string | null>(null);

  // Unified AMOUNT + UNIT state, shared by every food source and the barcode
  // result. The model below tells the editor which units/chips to offer.
  const [amountValue, setAmountValue] = useState<ServingAmountValue>({ amount: '100', unitId: 'g' });
  const [recentAmounts, setRecentAmounts] = useState<number[]>([]);
  // The starting portion and where it came from, so the editor can say so
  // ("113 g · about 4 oz, a typical cooked portion") until the user changes it.
  const [primedPortion, setPrimedPortion] = useState<
    { portion: DefaultPortion; typical: TypicalPortion | null } | null
  >(null);
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

  // Reset meal type + tab when modal opens. Only on the open transition:
  // picking a meal inside the sheet feeds back into defaultMealType, and that
  // must not throw the user back to the first tab or the Recent view.
  useEffect(() => {
    if (isOpen) {
      setMealType(defaultMealType);
      setActiveTab(initialTab ?? 'search');
      setSearchView('recent');
      setExpandedMeals(new Set());
      setMealsVisibleDays(MEALS_INITIAL_DAYS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  // The page's meal can still change while open (it follows the sheet's own
  // picker); keep the sheet's meal in step without resetting anything else.
  useEffect(() => {
    if (isOpen) setMealType(defaultMealType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMealType]);

  // Focus the search box: on open when asked (the Search quick action), and
  // whenever the Search tab is tapped. A request counter, not a boolean, so a
  // second request while already focused still runs. Keyed on the open
  // transition only: changing the meal inside the sheet must not refocus.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  useEffect(() => {
    if (isOpen && focusSearch && (initialTab ?? 'search') === 'search') {
      setSearchFocusRequest((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  useEffect(() => {
    if (searchFocusRequest === 0) return undefined;
    // After the sheet has painted (the input exists and is laid out).
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [searchFocusRequest]);

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
  }, [debouncedQuery, activeTab, usdaRetryNonce]);

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
        foodKeys: foodKeysFor({ foodId: selectedRecent.food_id, name: selectedRecent.food_name }),
        name: selectedRecent.food_name,
        subtitle: selectedRecent.serving_size || '1 serving',
        source: (selectedRecent.source ?? 'manual') as FoodSource,
        food_id: selectedRecent.food_id ?? undefined,
      };
    }
    if (scannedProduct) {
      return {
        model: buildScannedModel(scannedProduct),
        foodKeys: foodKeysFor({ barcode: scannedProduct.barcode, name: scannedProduct.name }),
        name: scannedProduct.name,
        subtitle: `Base: ${scannedProduct.servingSize}`,
        source: 'nutritionix' as const,
        barcode: scannedProduct.barcode,
      };
    }
    if (selectedFood) {
      return {
        model: buildUsdaModel(selectedFood),
        foodKeys: foodKeysFor({ foodId: selectedFood.foodId, name: selectedFood.name }),
        name: selectedFood.name,
        subtitle: selectedFood.servingSize,
        source: 'usda' as const,
        food_id: selectedFood.foodId,
      };
    }
    if (selectedCustomFood) {
      return {
        model: buildCustomModel(selectedCustomFood),
        foodKeys: foodKeysFor({ id: selectedCustomFood.id, name: selectedCustomFood.food_name }),
        name: selectedCustomFood.food_name,
        subtitle: selectedCustomFood.is_per_weight
          ? `Per ${selectedCustomFood.reference_amount}${selectedCustomFood.reference_unit || 'g'}`
          : selectedCustomFood.serving_size || '1 serving',
        source: 'custom' as const,
      };
    }
    if (selectedSystemFood) {
      return {
        model: buildSystemModel(selectedSystemFood),
        foodKeys: foodKeysFor({ id: selectedSystemFood.id, name: selectedSystemFood.name }),
        name: selectedSystemFood.name,
        subtitle: `${selectedSystemFood.calories_per_100g} cal per 100 g`,
        source: 'manual' as const,
      };
    }
    return null;
  }, [scannedProduct, selectedFood, selectedCustomFood, selectedSystemFood, selectedRecent]);

  // Prefill the amount/unit from the last-used value for a food (falls back to
  // the model's default serving), and load the recent-amount quick-chips.
  // The order (last portion → the food's serving → a typical portion → the
  // model) lives in lib/nutrition/portionDefaults.
  const primeAmountForFood = (
    model: FoodAmountModel,
    foodKeys: string[],
    opts: { typical?: TypicalPortion | null; fallback?: { amount: number; unitId: string } } = {}
  ) => {
    const lastUsed = getLastUsedServingForKeys(foodKeys);
    const portion = defaultPortion(model, {
      lastUsed,
      typicalGrams: opts.typical?.grams ?? null,
      fallback: opts.fallback,
    });
    setPrimedPortion({ portion, typical: opts.typical ?? null });
    setAmountValue({ amount: portion.amount.toString(), unitId: portion.unitId });
    setRecentAmounts(getRecentAmounts(foodKeys[0], portion.unitId, 2));
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setBarcodeError('');
    setNotFoundBarcode(null);
    setIsLookingUpBarcode(true);

    try {
      // USDA fallback goes through a server action so it uses the real API key.
      const result = await lookupBarcodeOFF(barcode, { usdaLookup: lookupBarcodeUsdaAction });
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
        primeAmountForFood(buildScannedModel(product), foodKeysFor({ barcode: product.barcode, name: product.name }));
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
    primeAmountForFood(buildUsdaModel(food), foodKeysFor({ foodId: food.foodId, name: food.name }));

    // If the food has a foodId, fetch detailed info with serving options
    const hasServings = 'servings' in food && Array.isArray((food as FoodSearchResultWithServings).servings);
    if (food.foodId && !hasServings) {
      setIsLoadingDetails(true);
      try {
        const result = await getFoodDetailsAction(food.foodId);
        if (result.food) {
          setSelectedFood(result.food);
          primeAmountForFood(buildUsdaModel(result.food), foodKeysFor({ foodId: result.food.foodId, name: result.food.name }));
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
    primeAmountForFood(buildCustomModel(food), foodKeysFor({ id: food.id, name: food.food_name }));
  };

  const handleSelectSystemFood = (food: SystemFood) => {
    setSelectedSystemFood(food);
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedRecent(null);
    primeAmountForFood(buildSystemModel(food), foodKeysFor({ id: food.id, name: food.name }), {
      typical: typicalPortionForSystemFood(food),
    });
  };

  // Tap a recent's row body → open the shared detail panel primed with the
  // last-logged serving, so it can be adjusted before adding.
  const handleSelectRecent = (entry: LoggedPortion) => {
    setSelectedRecent(entry);
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
    const { model, defaultAmount, defaultUnitId } = modelFromLoggedEntry(entry);
    primeAmountForFood(model, foodKeysFor({ foodId: entry.food_id, name: entry.food_name }), {
      fallback: { amount: defaultAmount, unitId: defaultUnitId },
    });
  };

  // Re-log a logged snapshot as-is into the currently selected meal, keeping the
  // same serving/quantity. Used by every quick-add (+) in Recent and Meals.
  const snapshotOf = (entry: LoggedPortion): QuickAddFood => ({
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

  // A row's + turns into a check for a moment after its add lands.
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
  }, []);
  const flashDone = (rowKey: string) => {
    setDoneKey(rowKey);
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    doneTimerRef.current = setTimeout(() => setDoneKey(null), 2000);
  };

  // Instant quick-add — does NOT close the sheet, so several can be grabbed.
  const handleQuickAdd = async (entry: LoggedPortion, rowKey: string) => {
    if (!onQuickAdd) return;
    setQuickAddingKey(rowKey);
    try {
      await onQuickAdd(snapshotOf(entry));
      flashDone(rowKey);
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setQuickAddingKey(null);
    }
  };

  // + on a searched food: its one-tap portion (last used, else its serving or
  // typical count), the same amount the editor would open on. Remembered as
  // the last-used amount, like an add from the editor.
  const handleOneTapAdd = async (
    food: { name: string; foodKeys: string[]; source: FoodSource; food_id?: string },
    oneTap: OneTapPortion,
    rowKey: string
  ) => {
    if (!onQuickAdd) return;
    setQuickAddingKey(rowKey);
    setError('');
    try {
      await onQuickAdd({
        food_name: food.name,
        serving_size: oneTap.servingSize,
        servings: oneTap.servings,
        calories: oneTap.macros.calories,
        protein: oneTap.macros.protein,
        carbs: oneTap.macros.carbs,
        fat: oneTap.macros.fat,
        meal_type: mealType,
        source: food.source as QuickAddFood['source'],
        food_id: food.food_id,
      });
      recordLastUsedServingForKeys(food.foodKeys, oneTap.portion.amount, oneTap.portion.unitId);
      flashDone(rowKey);
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setQuickAddingKey(null);
    }
  };

  /** Common food → its one-tap portion (or null: open the editor). */
  const systemOneTap = (food: SystemFood) => {
    const keys = foodKeysFor({ id: food.id, name: food.name });
    return {
      keys,
      oneTap: oneTapPortion(buildSystemModel(food), {
        lastUsed: getLastUsedServingForKeys(keys),
        typicalGrams: typicalPortionForSystemFood(food)?.grams ?? null,
      }),
    };
  };

  const renderSystemRow = (food: SystemFood) => {
    const { keys, oneTap } = systemOneTap(food);
    const rowKey = `sys:${food.id}`;
    const fallback = systemRowPortion(food);
    return (
      <SearchFoodRow
        key={food.id}
        name={food.name}
        oneTap={oneTap}
        fallbackSubtitle={`per ${fallback.label}`}
        fallbackNumbers={`${fallback.calories} cal | ${fallback.protein}g P`}
        onSelect={() => handleSelectSystemFood(food)}
        onQuickAdd={
          onQuickAdd && oneTap
            ? () => void handleOneTapAdd({ name: food.name, foodKeys: keys, source: 'manual' }, oneTap, rowKey)
            : undefined
        }
        adding={quickAddingKey === rowKey}
        done={doneKey === rowKey}
        disabled={isSubmitting || quickAddingKey !== null}
        mealLabel={mealLabel}
        testId="system-food-row"
      />
    );
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
      recordLastUsedServingForKeys(activeSelection.foodKeys, amountNum, amountValue.unitId);
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

  // A frequent food's last logged portion — what its + logs, and what the
  // editor opens on when the row body is tapped.
  const frequentAsLogged = (food: FrequentFood): LoggedPortion => {
    const portion = frequentFoodPortion(food);
    return {
      food_name: food.food_name,
      serving_size: portion.serving_size,
      servings: portion.servings,
      calories: portion.calories,
      protein: portion.protein,
      carbs: portion.carbs,
      fat: portion.fat,
      source: portion.source,
      food_id: portion.food_id,
    };
  };

  // + on a frequent food: one tap, the portion shown on the row. Stays open
  // (like Recent) when the parent supports quick-add; otherwise adds + closes.
  const handleAddFrequentFood = async (food: FrequentFood, rowKey: string) => {
    const logged = frequentAsLogged(food);
    if (onQuickAdd) {
      await handleQuickAdd(logged, rowKey);
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await onAdd(snapshotOf(logged));
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
  const mealLabel = mealNames?.[mealType]?.trim() || MEAL_LABELS[mealType];
  // No household serving to default to (only grams, or a bare "100 g"
  // option): say so, so a 100 g default never reads like a real portion.
  // An everyday measure ("palm-size portion") is a picture, not the food's
  // serving, so it doesn't count.
  const noStandardServing =
    !!activeSelection &&
    !activeSelection.model.units.some(
      (u) => u.kind === 'serving' && u.id !== EVERYDAY_UNIT_ID && isHouseholdNoun(u.noun)
    );
  const showUsdaSection = debouncedQuery.length >= 3;
  // Where the starting amount came from, shown only while it is still the
  // starting amount (an edited amount is the user's own).
  const portionSourceLine = (() => {
    if (!activeSelection || !primedPortion) return null;
    const { portion, typical } = primedPortion;
    if (amountValue.unitId !== portion.unitId || parseFloat(amountValue.amount) !== portion.amount) return null;
    if (!activeSelection.model.units.some((u) => u.id === portion.unitId)) return null;
    const { macros } = computeServing(activeSelection.model, portion.amount, portion.unitId);
    return describeDefaultPortion(portion, activeSelection.model, { units, typical, macros });
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Add food"
      size="lg"
    >
      <div className="space-y-4">
        {/* Target meal: said in words ("Adding to Dinner"), with the
            segmented control right under it as the way to change it. The
            control's own label is screen-reader only, so without this line
            the meal a food lands in was easy to miss. */}
        <div>
          <p className="text-subhead text-ink-2 mb-1.5" data-testid="add-food-target-meal">
            Adding to <span className="font-semibold text-ink">{mealLabel}</span>
          </p>
          <SegmentedControl
            label="Meal to add to"
            value={mealType}
            onChange={(v) => {
              setMealType(v as MealType);
              onMealTypeChange?.(v as MealType);
            }}
            options={(['breakfast', 'lunch', 'dinner', 'snack'] as MealType[]).map((m) => ({
              value: m,
              label: mealNames?.[m]?.trim() || MEAL_LABELS[m],
            }))}
          />
        </div>

        {/* Tabs — flex-1 so all four (incl. Manual) fit the modal width on
            phones instead of overflowing off-screen. */}
        <div className="flex rounded-[10px] bg-fill p-0.5" role="tablist" aria-label="Ways to add food">
          {([
            { id: 'search' as AddFoodTab, label: 'Search', icon: IconSearch },
            { id: 'barcode' as AddFoodTab, label: 'Scan', icon: IconScan },
            { id: 'label' as AddFoodTab, label: 'Label', icon: IconTextScan2 },
            { id: 'manual' as AddFoodTab, label: 'Manual', icon: IconPencil },
          ]).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                clearSelection();
                if (tab.id === 'search') setSearchFocusRequest((n) => n + 1);
              }}
              className={`flex-1 min-w-0 h-9 px-1 rounded-[8px] text-subhead text-ink whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors ${
                activeTab === tab.id ? 'bg-card font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.14)]' : 'font-medium'
              }`}
            >
              <tab.icon size={15} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'search' && !hasSelection && (onOpenDescribe || onOpenSavedMeals) && (
          <div className="flex gap-2" data-testid="add-food-shortcuts">
            {onOpenDescribe && (
              <Chip surface="fill" icon={<IconSparkles size={16} />} onClick={onOpenDescribe}>
                Describe it
              </Chip>
            )}
            {onOpenSavedMeals && (
              <Chip surface="fill" icon={<IconBookmark size={16} />} onClick={onOpenSavedMeals}>
                Saved meals
              </Chip>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 text-subhead text-status-bad bg-status-bad/10 border border-status-bad/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Unified Search Tab: your foods + common foods + USDA */}
        {activeTab === 'search' && (
          <div className="space-y-4">
            {!hasSelection && (
              <>
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search your foods, common foods, and USDA..."
                  aria-label="Search foods"
                  className="w-full"
                  leftIcon={<IconSearch size={16} aria-hidden="true" />}
                  rightIcon={
                    // Scan lives in the search bar too, where people look for it.
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('barcode');
                        clearSelection();
                      }}
                      aria-label="Scan a barcode"
                      data-testid="search-scan-barcode"
                      className="-mr-1 w-8 h-8 rounded-full flex items-center justify-center text-action hover:bg-action/15 transition-colors"
                    >
                      <IconScan size={18} aria-hidden="true" />
                    </button>
                  }
                />
                <p className="text-caption text-ink-2 -mt-2" data-testid="add-food-portion-hint">
                  Tap a food to choose how much before it&apos;s added. + adds the portion shown.
                </p>
              </>
            )}

            {/* Selected food detail — one panel, one editor, every source */}
            {hasSelection && activeSelection && (
              <div className="space-y-4 p-4 bg-fill rounded-lg" data-testid="add-food-detail">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium text-ink">{activeSelection.name}</h3>
                    <p className="text-caption text-action">{activeSelection.subtitle}</p>
                  </div>
                  <button
                    onClick={clearSelection}
                    className="text-ink-2 hover:text-ink flex-shrink-0"
                    aria-label="Clear selection"
                  >
                    <IconX size={16} aria-hidden="true" />
                  </button>
                </div>

                {isLoadingDetails ? (
                  <p className="text-subhead text-ink-2 py-2">Loading serving options...</p>
                ) : (
                  <>
                    <ServingAmountEditor
                      model={activeSelection.model}
                      value={amountValue}
                      onChange={setAmountValue}
                      recentAmounts={recentAmounts}
                      testIdPrefix="add-food"
                      weightUnits={units ?? null}
                    />

                    {portionSourceLine && (
                      <p className="text-caption text-ink-2" data-testid="add-food-portion-source">
                        Starting amount: {portionSourceLine}
                      </p>
                    )}

                    {noStandardServing && !portionSourceLine && (
                      <p className="text-caption text-ink-2" data-testid="add-food-no-serving">
                        No standard serving for this food. Set how much you ate.
                      </p>
                    )}

                    <Button
                      onClick={handleAddSelection}
                      variant="primary"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? 'Adding...' : `Add to ${mealLabel}`}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Recent | Meals segmented control — the default views shown
                before the user commits to a full search. */}
            {!hasSelection && !debouncedQuery && (
              <div className="flex gap-1 p-1 bg-fill/60 rounded-lg" role="tablist" aria-label="Recent or meals">
                {(['recent', 'meals'] as SearchView[]).map((view) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={searchView === view}
                    onClick={() => setSearchView(view)}
                    data-testid={`add-food-view-${view}`}
                    className={`flex-1 py-1.5 text-subhead font-medium rounded-md transition-colors ${
                      searchView === view
                        ? 'bg-fill text-ink'
                        : 'text-ink-2 hover:text-ink'
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
                {visibleMeals.length > 0 && (
                  <QuickAddSectionLabel mealLabel={mealLabel}>Earlier meals</QuickAddSectionLabel>
                )}
                {recentsLoading && priorMeals.length === 0 ? (
                  <>
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-14 rounded-lg bg-fill/60 animate-pulse" />
                    ))}
                  </>
                ) : visibleMeals.length === 0 ? (
                  <div className="py-8 text-center" data-testid="prior-meals-empty">
                    <IconToolsKitchen2 size={28} className="mx-auto text-ink-3 mb-2" aria-hidden="true" />
                    <p className="text-subhead text-ink-2">No prior meals yet</p>
                    <p className="text-caption text-ink-2 mt-1">
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
                          className="bg-fill/50 rounded-lg overflow-hidden"
                          data-testid="prior-meal"
                        >
                          <div className="flex items-center gap-2 pr-2">
                            <button
                              type="button"
                              onClick={() => toggleMealExpanded(meal.key)}
                              aria-expanded={isExpanded}
                              className="flex-1 min-w-0 p-3 text-left flex items-center gap-2 hover:bg-fill transition-colors"
                            >
                              <IconChevronRight
                                size={16}
                                aria-hidden="true"
                                className={`flex-shrink-0 text-ink-2 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              />
                              <span className="min-w-0">
                                <span className="block text-subhead font-medium text-ink truncate">
                                  {meal.dayLabel} · {meal.mealLabel}
                                </span>
                                <span className="block text-caption text-ink-2">
                                  {Math.round(meal.totalCalories)} cal · {meal.itemCount} item{meal.itemCount === 1 ? '' : 's'}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddAllFromMeal(meal)}
                              disabled={isSubmitting || quickAddingKey !== null}
                              className="flex-shrink-0 text-caption font-semibold text-action px-2 py-1 rounded-md hover:bg-action/15 transition-colors disabled:opacity-40"
                              data-testid="prior-meal-add-all"
                              aria-label={`Add all ${meal.itemCount} to ${mealLabel}`}
                            >
                              {quickAddingKey === `all:${meal.key}` ? 'Adding…' : 'Add all'}
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="px-2 pb-2 space-y-1">
                              {meal.entries.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-center gap-2 bg-card/40 rounded-lg pr-2"
                                  data-testid="prior-meal-food"
                                >
                                  <div className="flex-1 min-w-0 p-2 flex items-center gap-2">
                                    <FoodEmojiAvatar name={entry.food_name} size="sm" />
                                    <div className="min-w-0">
                                      <p className="text-subhead text-ink truncate">{entry.food_name}</p>
                                      <p className="text-caption text-ink-2 truncate">
                                        {formatPortion(entry.serving_size)} · {Math.round(entry.calories || 0)} cal
                                      </p>
                                    </div>
                                  </div>
                                  <QuickAddButton
                                    onClick={() => handleQuickAdd(entry, `meal-item:${entry.id}`)}
                                    disabled={isSubmitting || quickAddingKey !== null}
                                    loading={quickAddingKey === `meal-item:${entry.id}`}
                                    done={doneKey === `meal-item:${entry.id}`}
                                    label={`Add ${entry.food_name}, ${formatPortion(entry.serving_size)}, to ${mealLabel}`}
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
                        className="w-full py-2 text-subhead text-action transition-colors"
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
                  <QuickAddSectionLabel mealLabel={mealLabel}>Recent</QuickAddSectionLabel>
                  {recentsLoading && recentFoods.length === 0 ? (
                    <div className="space-y-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-12 rounded-lg bg-fill/60 animate-pulse" />
                      ))}
                    </div>
                  ) : filteredRecents.length === 0 ? (
                    <p className="text-subhead text-ink-2 py-1" data-testid="recent-foods-empty">
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
                          done={doneKey === recent.key}
                          disabled={isSubmitting || quickAddingKey !== null}
                          mealLabel={mealLabel}
                        />
                      ))}
                    </div>
                  )}
                </section>
                {/* Your foods: frequent for this meal + custom foods */}
                <section>
                  {frequentFoodsForMeal.length > 0 ? (
                    <QuickAddSectionLabel mealLabel={mealLabel}>Your foods</QuickAddSectionLabel>
                  ) : (
                    <SectionLabel>Your foods</SectionLabel>
                  )}
                  {frequentFoodsForMeal.length === 0 && filteredCustomFoods.length === 0 ? (
                    <p className="text-subhead text-ink-2 py-1">
                      {debouncedQuery ? 'No matches in your foods' : `No ${MEAL_LABELS[mealType].toLowerCase()} favorites or custom foods yet`}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {frequentFoodsForMeal.map((food) => {
                        const rowKey = `freq:${food.meal_type}:${food.food_name}`;
                        const portion = frequentFoodPortion(food);
                        const portionText = formatPortion(portion.serving_size);
                        return (
                          <div
                            key={rowKey}
                            className="flex items-center gap-2 bg-fill/50 rounded-lg pr-2"
                            data-testid="frequent-food-row"
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectRecent(frequentAsLogged(food))}
                              className="flex-1 min-w-0 p-2 text-left rounded-lg hover:bg-fill transition-colors flex items-center gap-2"
                            >
                              <FoodEmojiAvatar name={food.food_name} size="sm" />
                              <span className="min-w-0">
                                <span className="block text-subhead font-medium text-ink truncate">{food.food_name}</span>
                                <span className="block text-caption text-ink-2 truncate">
                                  {portionText} · {Math.round(portion.calories)} cal · logged {food.times_logged}x
                                </span>
                              </span>
                            </button>
                            <QuickAddButton
                              onClick={() => handleAddFrequentFood(food, rowKey)}
                              disabled={isSubmitting || quickAddingKey !== null}
                              loading={quickAddingKey === rowKey}
                              done={doneKey === rowKey}
                              label={`Quick-add ${food.food_name}, ${portionText}, to ${mealLabel}`}
                            />
                          </div>
                        );
                      })}
                      {filteredCustomFoods.map((food) => {
                        const keys = foodKeysFor({ id: food.id, name: food.food_name });
                        const oneTap = oneTapPortion(buildCustomModel(food), {
                          lastUsed: getLastUsedServingForKeys(keys),
                        });
                        const rowKey = `custom:${food.id}`;
                        return (
                          <SearchFoodRow
                            key={food.id}
                            name={food.food_name}
                            oneTap={oneTap}
                            fallbackSubtitle={
                              food.is_per_weight
                                ? `${food.calories_per_ref} cal per ${food.reference_amount}${food.reference_unit || 'g'}`
                                : `${food.calories} cal · ${food.serving_size}`
                            }
                            trailingTag="Custom"
                            onSelect={() => handleSelectCustomFood(food)}
                            onQuickAdd={
                              onQuickAdd && oneTap
                                ? () =>
                                    void handleOneTapAdd(
                                      { name: food.food_name, foodKeys: keys, source: 'custom' },
                                      oneTap,
                                      rowKey
                                    )
                                : undefined
                            }
                            adding={quickAddingKey === rowKey}
                            done={doneKey === rowKey}
                            disabled={isSubmitting || quickAddingKey !== null}
                            mealLabel={mealLabel}
                            testId="custom-food-row"
                          />
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Common foods: system foods */}
                <section>
                  {onQuickAdd ? (
                    <QuickAddSectionLabel mealLabel={mealLabel}>Common foods</QuickAddSectionLabel>
                  ) : (
                    <SectionLabel>Common foods</SectionLabel>
                  )}
                  {filteredSystemFoods.length === 0 ? (
                    <p className="text-subhead text-ink-2 py-1">No matches in common foods</p>
                  ) : debouncedQuery ? (
                    <div className="space-y-1">
                      {filteredSystemFoods.map(renderSystemRow)}
                    </div>
                  ) : (
                    Object.entries(groupedSystemFoods).map(([category, foods]) => (
                      <div key={category} className="mb-2">
                        <p className="text-caption text-ink-3 mb-1">
                          {CATEGORY_LABELS[category] || category}
                        </p>
                        <div className="space-y-1">
                          {foods.slice(0, 6).map(renderSystemRow)}
                        </div>
                      </div>
                    ))
                  )}
                </section>

                {/* USDA database */}
                <section>
                  <SectionLabel>USDA database</SectionLabel>
                  {!showUsdaSection ? (
                    <p className="text-subhead text-ink-2 py-1">
                      Type at least 3 characters to search the USDA database
                    </p>
                  ) : isSearchingUsda ? (
                    <p className="text-subhead text-ink-2 py-1">Searching USDA...</p>
                  ) : usdaError ? (
                    <div
                      className="flex items-center justify-between gap-3 py-1"
                      role="status"
                      data-testid="usda-search-error"
                    >
                      <p className="text-subhead text-ink-2 min-w-0">{friendlyUsdaError(usdaError)}</p>
                      <button
                        type="button"
                        onClick={() => setUsdaRetryNonce((n) => n + 1)}
                        className="flex-shrink-0 min-h-[36px] px-3 rounded-full bg-fill text-subhead font-medium text-ink hover:bg-fill/70 transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  ) : usdaResults.length === 0 ? (
                    <p className="text-subhead text-ink-2 py-1">No USDA results</p>
                  ) : (
                    <div className="space-y-1">
                      {usdaResults.map((food, idx) => {
                        const keys = foodKeysFor({ foodId: food.foodId, name: food.name });
                        // A USDA result carries only a generic serving until its
                        // details load, so + only for a food you've logged before.
                        const oneTap = oneTapPortion(buildUsdaModel(food), {
                          lastUsed: getLastUsedServingForKeys(keys),
                          requireLast: true,
                        });
                        const rowKey = `usda:${food.foodId ?? idx}`;
                        return (
                          <SearchFoodRow
                            key={food.foodId ?? idx}
                            name={food.name}
                            oneTap={oneTap}
                            fallbackSubtitle={food.servingSize}
                            fallbackNumbers={`${food.calories} cal | ${food.protein}g P`}
                            onSelect={() => void handleSelectFood(food)}
                            onQuickAdd={
                              onQuickAdd && oneTap
                                ? () =>
                                    void handleOneTapAdd(
                                      { name: food.name, foodKeys: keys, source: 'usda', food_id: food.foodId },
                                      oneTap,
                                      rowKey
                                    )
                                : undefined
                            }
                            adding={quickAddingKey === rowKey}
                            done={doneKey === rowKey}
                            disabled={isSubmitting || quickAddingKey !== null}
                            mealLabel={mealLabel}
                            testId="usda-food-row"
                          />
                        );
                      })}
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
              <div className="p-3 text-subhead text-status-warn bg-status-warn/10 border border-status-warn/20 rounded-lg space-y-2">
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
                <div className="text-ink-2">Looking up product...</div>
              </div>
            ) : scannedProduct && activeSelection ? (
              // Scanned Product with the shared AMOUNT + UNIT editor
              <div className="space-y-4">
                <div className="bg-fill rounded-lg p-4 space-y-4" data-testid="add-food-detail">
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
                        className="w-20 h-20 bg-fill rounded-lg flex items-center justify-center text-large-title"
                        aria-hidden="true"
                      >
                        {foodEmoji(scannedProduct.name, scannedProduct.brand)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-ink text-headline leading-tight">
                        {scannedProduct.name}
                      </h3>
                      {scannedProduct.brand && (
                        <p className="text-subhead text-ink-2 mt-1">
                          {scannedProduct.brand}
                        </p>
                      )}
                      <p className="text-caption text-ink-2 mt-1">
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
                    weightUnits={units ?? null}
                  />
                  {portionSourceLine && (
                    <p className="text-caption text-ink-2 mt-2" data-testid="add-food-portion-source">
                      Starting amount: {portionSourceLine}
                    </p>
                  )}
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
                    {isSubmitting ? 'Adding...' : `Add to ${mealLabel}`}
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
              <label className="block text-subhead font-medium text-ink mb-1">
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
              <label className="block text-subhead font-medium text-ink mb-1">
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
                <label className="block text-subhead font-medium text-ink mb-1">
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
                <label className="block text-subhead font-medium text-ink mb-1">
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
                <label className="block text-subhead font-medium text-ink mb-1">
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
                <label className="block text-subhead font-medium text-ink mb-1">
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
              {isSubmitting ? 'Adding...' : `Add to ${mealLabel}`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
