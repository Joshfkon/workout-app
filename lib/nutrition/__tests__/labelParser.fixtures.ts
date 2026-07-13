/**
 * OCR-output fixtures for the nutrition label parser. Each fixture is the
 * line array an OCR pass would produce for a photographed FDA Nutrition
 * Facts panel — including realistic noise (character confusion, merged
 * columns, split lines).
 */

/** Clean, complete FDA panel (post-2016 layout, value split for Calories). */
export const CLEAN_LABEL = [
  'Nutrition Facts',
  '8 servings per container',
  'Serving size 2/3 cup (55g)',
  'Amount per serving',
  'Calories',
  '230',
  '% Daily Value*',
  'Total Fat 8g 10%',
  'Saturated Fat 1g 5%',
  'Trans Fat 0g',
  'Cholesterol 0mg 0%',
  'Sodium 160mg 7%',
  'Total Carbohydrate 37g 13%',
  'Dietary Fiber 4g 14%',
  'Total Sugars 12g',
  'Includes 10g Added Sugars 20%',
  'Protein 3g',
  'Vitamin D 2mcg 10%',
  'Calcium 260mg 20%',
  'Iron 8mg 45%',
  'Potassium 235mg 6%',
];

/** O/0 and l/1 confusions in both label words and numeric values. */
export const OCR_O0_SUBSTITUTION = [
  'Nutriti0n Facts',
  '4 servings per container',
  'Serving size 1 cup (24Og)',
  'Cal0ries 23O',
  'T0tal Fat 8g 1O%',
  'Saturated Fat lg',
  'Trans Fat Og',
  'Ch0lesterol Omg',
  'S0dium l6Omg 7%',
  'Total Carb0hydrate 37g 13%',
  'Dietary Fiber 4g',
  'T0tal Sugars 12g',
  'Pr0tein 3g',
];

/** Merged value/unit/%DV columns with no spaces — a common OCR failure. */
export const MERGED_COLUMNS_LABEL = [
  'Nutrition Facts',
  '2 servings per container',
  'Serving size 1 Tray (340g)',
  'Calories490',
  'TotalFat20g26%',
  'SaturatedFat4.5g23%',
  'TransFat0g',
  'Cholesterol55mg18%',
  'Sodium850mg37%',
  'TotalCarbohydrate36g13%',
  'DietaryFiber3g11%',
  'TotalSugars5g',
  'Protein40g',
];

/** Label without the added-sugars line (allowed — non-core fields are optional). */
export const NO_ADDED_SUGARS_LABEL = [
  'Nutrition Facts',
  'Serving size 1 bar (40g)',
  'Calories 180',
  'Total Fat 6g 8%',
  'Saturated Fat 2g 10%',
  'Sodium 105mg 5%',
  'Total Carbohydrate 22g 8%',
  'Dietary Fiber 3g 11%',
  'Total Sugars 9g',
  'Protein 9g',
];

/** Metric-first serving declaration (no household measure). */
export const METRIC_FIRST_LABEL = [
  'Nutrition Facts',
  'Serving size 100 g',
  'Servings Per Container 4',
  'Calories 250',
  'Total Fat 11g',
  'Saturated Fat 3,5g',
  'Cholesterol 45mg',
  'Sodium 380mg',
  'Total Carbohydrate 21g',
  'Fibre 2g',
  'Sugars 4g',
  'Protein 17g',
];

/**
 * Atwater-consistent label: 4·40 + 4·36 + 9·20 = 484 computed vs 490 printed
 * — within the 15% tolerance, so confidence stays HIGH.
 */
export const ATWATER_CONSISTENT_LABEL = [
  'Nutrition Facts',
  'Serving size 1 Tray (340g)',
  'Calories 490',
  'Total Fat 20g 26%',
  'Total Carbohydrate 36g 13%',
  'Protein 40g',
];

/**
 * Protein misread by OCR (40 → 140, a stray "1" from panel border/pipe):
 * computed 4·140 + 4·36 + 9·20 = 884 vs printed 490 → far outside tolerance.
 * A single-character correction of protein (140 → 40) reconciles the
 * identity, so protein is the suspect.
 */
export const ATWATER_PROTEIN_MISREAD_LABEL = [
  'Nutrition Facts',
  'Serving size 1 Tray (340g)',
  'Calories 490',
  'Total Fat 20g 26%',
  'Total Carbohydrate 36g 13%',
  'Protein 140g',
];

/** Unreadable core field: fat line lost entirely. */
export const MISSING_CORE_FIELD_LABEL = [
  'Nutrition Facts',
  'Serving size 1 cup (245g)',
  'Calories 150',
  'Sodium 105mg',
  'Total Carbohydrate 12g',
  'Protein 8g',
];

/** Unit "g" fused into the number ("20g" read as "209"). */
export const TRAILING_NINE_LABEL = [
  'Nutrition Facts',
  'Serving size 1 Tray (340g)',
  'Calories 490',
  'Total Fat 209',
  'Total Carbohydrate 36g',
  'Protein 40g',
];

/** Poly/monounsaturated lines must not be read as saturated fat. */
export const UNSATURATED_FAT_LABEL = [
  'Nutrition Facts',
  'Serving size 1 tbsp (14g)',
  'Calories 120',
  'Total Fat 14g 18%',
  'Saturated Fat 2g 10%',
  'Polyunsaturated Fat 4g',
  'Monounsaturated Fat 8g',
  'Total Carbohydrate 0g',
  'Protein 0g',
];
