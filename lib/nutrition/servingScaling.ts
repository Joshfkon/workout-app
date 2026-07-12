/**
 * Serving scaling — the single source of truth for the editable AMOUNT + UNIT
 * control used at add time (search / barcode / manual tabs) and at edit time.
 *
 * Every food, whatever its source, is normalised into a {@link FoodAmountModel}:
 * a small list of units the food can be measured in, each carrying the macros
 * for exactly one of that unit. Total macros are always `perUnit * amount`, so
 * the live preview and the eventual log entry are computed by the same pure
 * function ({@link computeServing}) — the component never scales macros itself.
 *
 * Weights are handled in grams internally; oz is a display unit converted with
 * {@link OZ_TO_G}. This util centralises the oz↔g constant and the
 * serving-size string parsing that used to be duplicated across AddFoodModal,
 * EditFoodModal and QuickFoodLogger.
 */

export const OZ_TO_G = 28.3495;

export interface UnitMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A unit a food can be logged in. Total macros = `perUnit * amount`. */
export interface ServingUnitDef {
  /** Stable id, unique within a model (e.g. 'g', 'oz', 'serving', 'srv-0'). */
  id: string;
  /** 'weight' units (g/oz) get numeric quick-chips; 'serving' units get ×-chips. */
  kind: 'weight' | 'serving';
  /** Dropdown label, e.g. "grams", "oz", "bottle (397g)". */
  label: string;
  /** Noun used when building the stored serving_size string ("g", "bottle"). */
  noun: string;
  /** Grams for one of this unit, or null when the food carries no gram data. */
  gramsPerUnit: number | null;
  /** Macros for exactly one of this unit. */
  perUnit: UnitMacros;
}

export interface FoodAmountModel {
  units: ServingUnitDef[];
  /** Unit selected by default when nothing was last used. */
  defaultUnitId: string;
  /** Amount prefilled by default when nothing was last used. */
  defaultAmount: number;
  /**
   * When true the entry is logged with `servings: 1` and the whole portion
   * encoded in serving_size + pre-scaled macros (weight-based foods:
   * per-100g / per-reference). When false the `servings` column carries the
   * equivalent serving count so frequent-food averaging stays per-serving.
   */
  weightAnchored: boolean;
  /** Grams that make up one nominal serving, when known (for weight↔serving). */
  perServingGrams: number | null;
  /** Quick-chip anchors (grams for weight-anchored, ×multiples otherwise). */
  quickChips: number[];
}

export interface ComputedServing {
  macros: UnitMacros;
  /** Human-readable + round-trippable serving_size, e.g. "150g", "0.5 bottle (198g)". */
  servingSize: string;
  /** Value for the food_log.servings column (see FoodAmountModel.weightAnchored). */
  servings: number;
  /** Resolved grams for the portion, when derivable. */
  grams: number | null;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round to 2 decimals — used for any converted amount ever shown to the user. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function scaleMacros(perUnit: UnitMacros, amount: number): UnitMacros {
  return {
    calories: Math.round(perUnit.calories * amount),
    protein: round1(perUnit.protein * amount),
    carbs: round1(perUnit.carbs * amount),
    fat: round1(perUnit.fat * amount),
  };
}

/** Trim trailing zeros so "150.0" renders as "150" but "0.5" stays "0.5". */
export function trimNum(n: number): string {
  return Number(n.toFixed(2)).toString();
}

export function getUnit(model: FoodAmountModel, unitId: string): ServingUnitDef {
  return model.units.find((u) => u.id === unitId) ?? model.units[0];
}

/**
 * The one function that turns (model, amount, unit) into everything needed to
 * both preview and persist a portion. Used by the shared editor for the live
 * macro preview and by every add/save handler for the actual log write.
 */
export function computeServing(
  model: FoodAmountModel,
  amountInput: string | number,
  unitId: string
): ComputedServing {
  const unit = getUnit(model, unitId);
  const amount =
    typeof amountInput === 'number'
      ? amountInput
      : parseFloat(amountInput) || 0;

  const macros = scaleMacros(unit.perUnit, amount);
  const grams = unit.gramsPerUnit != null ? unit.gramsPerUnit * amount : null;

  // servings column semantics — preserve the historical per-source behaviour.
  let servings: number;
  if (model.weightAnchored) {
    servings = 1;
  } else if (unit.kind === 'serving') {
    servings = amount;
  } else if (model.perServingGrams && grams != null) {
    servings = grams / model.perServingGrams;
  } else {
    servings = amount;
  }

  // serving_size string — must stay parseable by parseServingWeight().
  let servingSize: string;
  if (unit.kind === 'weight') {
    servingSize = `${trimNum(amount)}${unit.noun}`;
  } else if (grams != null) {
    servingSize = `${trimNum(amount)} ${unit.noun} (${Math.round(grams)}g)`;
  } else {
    servingSize = `${trimNum(amount)} ${unit.noun}`;
  }

  return { macros, servingSize, servings, grams };
}

/**
 * Extract grams from a stored serving_size string such as
 * "1 portion (85.048 g)", "100g" or "3 oz". Centralised here so add/edit and
 * QuickFoodLogger share one parser.
 */
export function parseServingWeight(
  servingSize: string | null | undefined
): { grams: number | null; unit: 'g' | 'oz' | '' } {
  if (!servingSize) return { grams: null, unit: '' };

  const gramMatch = servingSize.match(/\(?([\d.]+)\s*g(?:rams?)?\)?/i);
  if (gramMatch) {
    return { grams: parseFloat(gramMatch[1]), unit: 'g' };
  }

  const ozMatch = servingSize.match(/\(?([\d.]+)\s*oz(?:ounces?)?\)?/i);
  if (ozMatch) {
    return { grams: parseFloat(ozMatch[1]) * OZ_TO_G, unit: 'oz' };
  }

  return { grams: null, unit: '' };
}

// ---------------------------------------------------------------------------
// Model builders — one per food source. Each returns a FoodAmountModel the
// shared editor can drive without knowing where the food came from.
// ---------------------------------------------------------------------------

/** Gram quick-chips shown when a weight unit is selected. */
export const DEFAULT_WEIGHT_CHIPS = [50, 100, 150, 200];
/** ×-multiple quick-chips shown when a serving unit is selected. */
export const DEFAULT_SERVING_CHIPS = [0.5, 1, 1.5, 2];

function gramsAndOzUnits(perGram: UnitMacros): ServingUnitDef[] {
  return [
    {
      id: 'g',
      kind: 'weight',
      label: 'grams',
      noun: 'g',
      gramsPerUnit: 1,
      perUnit: perGram,
    },
    {
      id: 'oz',
      kind: 'weight',
      label: 'oz',
      noun: 'oz',
      gramsPerUnit: OZ_TO_G,
      perUnit: {
        calories: perGram.calories * OZ_TO_G,
        protein: perGram.protein * OZ_TO_G,
        carbs: perGram.carbs * OZ_TO_G,
        fat: perGram.fat * OZ_TO_G,
      },
    },
  ];
}

/** Weight-based food defined per 100g (system foods). */
export function weightBasedModel(per100g: UnitMacros, defaultGrams = 100): FoodAmountModel {
  const perGram: UnitMacros = {
    calories: per100g.calories / 100,
    protein: per100g.protein / 100,
    carbs: per100g.carbs / 100,
    fat: per100g.fat / 100,
  };
  return {
    units: gramsAndOzUnits(perGram),
    defaultUnitId: 'g',
    defaultAmount: defaultGrams,
    weightAnchored: true,
    perServingGrams: null,
    quickChips: DEFAULT_WEIGHT_CHIPS,
  };
}

/** Custom food defined per an arbitrary reference amount (e.g. per 28g). */
export function customPerRefModel(
  perRef: UnitMacros,
  referenceAmount: number,
  referenceUnit: 'g' | 'oz'
): FoodAmountModel {
  const refGrams = referenceUnit === 'oz' ? referenceAmount * OZ_TO_G : referenceAmount;
  const perGram: UnitMacros = {
    calories: perRef.calories / refGrams,
    protein: perRef.protein / refGrams,
    carbs: perRef.carbs / refGrams,
    fat: perRef.fat / refGrams,
  };
  return {
    units: gramsAndOzUnits(perGram),
    defaultUnitId: referenceUnit,
    defaultAmount: referenceUnit === 'oz' ? referenceAmount : refGrams,
    weightAnchored: true,
    perServingGrams: null,
    quickChips: DEFAULT_WEIGHT_CHIPS,
  };
}

/**
 * Packaged food defined per serving of a known gram weight (barcode results,
 * custom per-serving foods with a gram serving). Offers the named serving unit
 * plus grams/oz so "0.5 bottle" and "198g" resolve to the same macros.
 */
export function packagedModel(
  perServing: UnitMacros,
  servingGrams: number,
  servingNoun = 'serving'
): FoodAmountModel {
  const perGram: UnitMacros = {
    calories: perServing.calories / servingGrams,
    protein: perServing.protein / servingGrams,
    carbs: perServing.carbs / servingGrams,
    fat: perServing.fat / servingGrams,
  };
  const servingUnit: ServingUnitDef = {
    id: 'serving',
    kind: 'serving',
    // Plain noun in the dropdown; the gram weight is surfaced as helper text
    // below the field (see ServingAmountEditor) rather than crammed next to the
    // number input, where "(85g)" invited users to type a gram amount.
    label: servingNoun,
    noun: servingNoun,
    gramsPerUnit: servingGrams,
    perUnit: perServing,
  };
  return {
    units: [servingUnit, ...gramsAndOzUnits(perGram)],
    defaultUnitId: 'serving',
    defaultAmount: 1,
    weightAnchored: false,
    perServingGrams: servingGrams,
    quickChips: DEFAULT_SERVING_CHIPS,
  };
}

/**
 * Food defined per named serving with no gram data (USDA per-serving results,
 * custom per-serving foods). Only the serving unit is offered; if the serving
 * description encodes grams a weight option is added so the user can re-weigh.
 */
export function perServingModel(
  perServing: UnitMacros,
  servingNoun = 'serving',
  servingGrams: number | null = null
): FoodAmountModel {
  if (servingGrams && servingGrams > 0) {
    return packagedModel(perServing, servingGrams, servingNoun);
  }
  const servingUnit: ServingUnitDef = {
    id: 'serving',
    kind: 'serving',
    label: servingNoun,
    noun: servingNoun,
    gramsPerUnit: null,
    perUnit: perServing,
  };
  return {
    units: [servingUnit],
    defaultUnitId: 'serving',
    defaultAmount: 1,
    weightAnchored: false,
    perServingGrams: null,
    quickChips: DEFAULT_SERVING_CHIPS,
  };
}

export interface ServingOption {
  noun: string;
  grams: number | null;
  macros: UnitMacros;
}

/**
 * Food offering several named servings (USDA results, which may expose
 * "1 cup (160g)", "100 g", "1 tbsp"). Each option becomes a serving unit; if
 * any option carries grams a g/oz weight option is derived from the first such
 * option so the user can log by weight too.
 */
export function servingOptionsModel(options: ServingOption[]): FoodAmountModel {
  const servingUnits: ServingUnitDef[] = options.map((opt, i) => ({
    id: `srv-${i}`,
    kind: 'serving',
    label: opt.grams != null ? `${opt.noun} (${Math.round(opt.grams)}g)` : opt.noun,
    noun: opt.noun,
    gramsPerUnit: opt.grams,
    perUnit: opt.macros,
  }));

  const gramOption = options.find((o) => o.grams != null && o.grams > 0);
  let units = servingUnits;
  let perServingGrams: number | null = options[0]?.grams ?? null;
  if (gramOption && gramOption.grams) {
    const perGram: UnitMacros = {
      calories: gramOption.macros.calories / gramOption.grams,
      protein: gramOption.macros.protein / gramOption.grams,
      carbs: gramOption.macros.carbs / gramOption.grams,
      fat: gramOption.macros.fat / gramOption.grams,
    };
    units = [...servingUnits, ...gramsAndOzUnits(perGram)];
    if (perServingGrams == null) perServingGrams = gramOption.grams;
  }

  return {
    units,
    defaultUnitId: servingUnits[0]?.id ?? 'srv-0',
    defaultAmount: 1,
    weightAnchored: false,
    perServingGrams,
    quickChips: DEFAULT_SERVING_CHIPS,
  };
}

/**
 * Build a model from an already-logged entry for the edit sheet: the
 * per-serving base is the logged totals divided by logged servings, and a
 * weight option is offered when the serving_size string carries grams.
 */
export function modelFromLoggedEntry(entry: {
  serving_size: string | null;
  servings: number;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}): { model: FoodAmountModel; defaultUnitId: string; defaultAmount: number } {
  const servings = entry.servings || 1;
  const perServing: UnitMacros = {
    calories: (entry.calories || 0) / servings,
    protein: (entry.protein || 0) / servings,
    carbs: (entry.carbs || 0) / servings,
    fat: (entry.fat || 0) / servings,
  };
  const { grams } = parseServingWeight(entry.serving_size);
  // grams parsed from serving_size reflect the whole logged portion; divide by
  // logged servings to get grams-per-serving.
  const perServingGrams = grams != null && grams > 0 ? grams / servings : null;
  const model = perServingModel(perServing, 'serving', perServingGrams);
  return { model, defaultUnitId: 'serving', defaultAmount: servings };
}

/**
 * Recover the {amount, unit} the user actually entered from a logged entry, so
 * the edit sheet reopens showing "180 g" rather than a serving fraction like
 * "2.1176470588235294". A pure-weight serving_size ("180g", "6oz") re-opens in
 * that weight unit; anything else re-opens in servings (the leading count in
 * "N serving (Xg)" equals the servings column). Converted amounts round to 2dp.
 */
export function initialAmountForEntry(
  servingSize: string | null | undefined,
  servings: number
): { amount: string; unitId: string } {
  const s = (servingSize ?? '').trim();
  const weightMatch = s.match(/^([\d.]+)\s*(g|oz)$/i);
  if (weightMatch) {
    return {
      amount: trimNum(parseFloat(weightMatch[1])),
      unitId: weightMatch[2].toLowerCase(),
    };
  }
  return { amount: String(round2(servings || 1)), unitId: 'serving' };
}
