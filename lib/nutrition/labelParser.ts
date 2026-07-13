/**
 * Pure nutrition-label parser: turns OCR line output from a photo of an FDA
 * Nutrition Facts panel into structured fields with per-field confidence.
 *
 * Design notes:
 * - PURE module: no camera, OCR, or network imports. The scanner feeds it OCR
 *   lines; tests feed it fixtures.
 * - FDA panels are standardized (serving info → Calories → fats → cholesterol
 *   → sodium → carbs → fiber → sugars → added sugars → protein), so parsing
 *   anchors on the known label vocabulary rather than positional guessing.
 * - OCR noise is tolerated in two distinct contexts:
 *   - label words: digits that OCR swaps for letters (0/O, 1/l, 5/S…) are
 *     mapped to letters before keyword matching ("Pr0tein" → "protein");
 *   - numeric values: letters that OCR swaps for digits (O→0, l→1) are mapped
 *     back inside number tokens, and a trailing "9" that is really a merged
 *     unit "g" is repaired when the raw value is implausible ("209" → 20 g).
 * - % Daily Value columns are ignored (a number directly followed by "%" is
 *   never taken as a field value).
 * - The Atwater identity (4·protein + 4·carbs + 9·fat ≈ calories) validates
 *   the core fields; on mismatch the parser flags the field whose plausible
 *   OCR misread best reconciles the identity.
 */

export type MacroKey = 'calories' | 'protein' | 'carbs' | 'fat';

export interface ParsedNutritionFields {
  calories: number | null;
  totalFatG: number | null;
  saturatedFatG: number | null;
  transFatG: number | null;
  cholesterolMg: number | null;
  sodiumMg: number | null;
  totalCarbsG: number | null;
  fiberG: number | null;
  totalSugarsG: number | null;
  addedSugarsG: number | null;
  proteinG: number | null;
  /** Label serving text, e.g. "1 Tray (340g)" */
  servingSizeText: string | null;
  /** Gram weight parsed out of the serving text, e.g. 340 */
  servingGramWeight: number | null;
  servingsPerContainer: number | null;
}

export type NumericLabelField = Exclude<keyof ParsedNutritionFields, 'servingSizeText'>;

export type ConfidenceLevel = 'high' | 'low';

export interface AtwaterCheck {
  /** 4·protein + 4·carbs + 9·fat, when all three macros parsed */
  computedCalories: number | null;
  parsedCalories: number | null;
  /** |computed − parsed| / parsed */
  deviation: number | null;
  /** null when core fields are missing so the identity can't be evaluated */
  withinTolerance: boolean | null;
  /** The core field whose perturbation best reconciles the identity */
  suspectField: MacroKey | null;
}

export interface ParseNutritionLabelResult {
  fields: ParsedNutritionFields;
  confidence: ConfidenceLevel;
  fieldConfidence: Partial<Record<NumericLabelField, ConfidenceLevel>>;
  warnings: string[];
  atwater: AtwaterCheck;
  /** True when calories, protein, carbs, and fat were all parsed */
  hasCoreFields: boolean;
}

/** Atwater tolerance: flag when computed and labeled calories differ >15%. */
export const ATWATER_TOLERANCE = 0.15;

const MACRO_LABELS: Record<MacroKey, string> = {
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fat: 'fat',
};

// Plausible per-serving ranges. Values beyond these are OCR misreads (or a
// label we shouldn't trust) — used both for rejection and for the trailing-9
// unit repair.
const FIELD_MAX: Record<string, number> = {
  calories: 1500,
  totalFatG: 150,
  saturatedFatG: 100,
  transFatG: 20,
  cholesterolMg: 1500,
  sodiumMg: 8000,
  totalCarbsG: 300,
  fiberG: 100,
  totalSugarsG: 250,
  addedSugarsG: 250,
  proteinG: 150,
  servingsPerContainer: 100,
  servingGramWeight: 2000,
};

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/** Digit → letter map for keyword matching ("Pr0tein", "Tota1 Fat"). */
const DIGIT_TO_LETTER: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
};

interface NormalizedLine {
  raw: string;
  /** Lowercased letters-only stream with digits mapped to lookalike letters */
  letters: string;
  /** letters[i] came from raw[posMap[i]] */
  posMap: number[];
}

function normalizeLine(raw: string): NormalizedLine {
  let letters = '';
  const posMap: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i].toLowerCase();
    if (ch >= 'a' && ch <= 'z') {
      letters += ch;
      posMap.push(i);
    } else if (DIGIT_TO_LETTER[ch]) {
      letters += DIGIT_TO_LETTER[ch];
      posMap.push(i);
    }
    // everything else (spaces, punctuation, %) is dropped from the stream
  }
  return { raw, letters, posMap };
}

/** Map letter lookalikes back to digits inside a numeric token. */
function tokenToNumber(token: string): number | null {
  const cleaned = token
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    // single decimal comma → dot (European-style "0,5")
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^0-9.]/g, '');
  if (!cleaned || cleaned === '.') return null;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Measure extraction
// ---------------------------------------------------------------------------

interface Measure {
  value: number;
  /** True when the trailing-9-as-unit repair was applied (low confidence) */
  repaired: boolean;
}

/**
 * Extract the first plausible "value [unit]" from a raw text segment,
 * ignoring % Daily Value numbers and tolerating O/0, l/1 and unit-g/9
 * confusions.
 */
function extractMeasure(
  segment: string,
  opts: { unit: 'g' | 'mg' | 'none'; max: number }
): Measure | null {
  // Numeric tokens possibly polluted with letter lookalikes.
  const tokenRe = /[0-9OolI|]+(?:[.,][0-9OolI|]+)?/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(segment)) !== null) {
    const token = match[0];
    const after = segment.slice(match.index + token.length);
    // A number directly followed by % is a Daily Value — never a field value.
    if (/^\s*%/.test(after)) continue;
    // Skip tokens that are part of a fraction like "2/3 cup" (serving text).
    if (/^\s*\//.test(after) || /\/\s*$/.test(segment.slice(0, match.index))) continue;

    const explicitUnit = /^\s*(mcg|mg|g)\b/i.exec(after)?.[1]?.toLowerCase() ?? null;

    // Tokens without a true digit are only trusted when a unit is directly
    // attached ("Og" → 0 g, "lg" → 1 g) — otherwise stray o/l/I letters from
    // ordinary words would parse as numbers.
    const hasDigit = /[0-9]/.test(token);
    let value = hasDigit || explicitUnit ? tokenToNumber(token) : null;
    if (value === null) continue;

    let repaired = false;

    if (opts.unit === 'mg' && explicitUnit === 'g') {
      // Label says grams where mg expected (rare, e.g. "0g cholesterol")
      value *= 1000;
    } else if (opts.unit === 'g' && explicitUnit === 'mg') {
      value /= 1000;
    }

    // Unit-as-digit repair: "Total Fat 209" is "20g" when 209 is implausible.
    if (
      opts.unit === 'g' &&
      !explicitUnit &&
      value > opts.max &&
      /9$/.test(token.replace(/[^0-9OolI|]/g, ''))
    ) {
      const stripped = tokenToNumber(token.slice(0, -1).replace(/[.,]$/, ''));
      if (stripped !== null && stripped <= opts.max) {
        value = stripped;
        repaired = true;
      }
    }

    if (value > opts.max) {
      // Implausible even after repair — treat as unreadable rather than wrong.
      return null;
    }
    return { value, repaired };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field vocabulary
// ---------------------------------------------------------------------------

interface FieldDef {
  field: NumericLabelField | 'servingSize';
  /** Keywords in normalized letters form, most specific first */
  keywords: string[];
  unit: 'g' | 'mg' | 'none';
  /** Value may precede the keyword (e.g. "Includes 10g Added Sugars") */
  valueMayPrecede?: boolean;
}

// Order matters twice: more specific keywords must be consumed before generic
// ones ("added sugars" before "sugars"), and FDA panel order helps resolve
// stray matches deterministically.
const FIELD_DEFS: FieldDef[] = [
  { field: 'servingsPerContainer', keywords: ['servingspercontainer', 'servingpercontainer'], unit: 'none', valueMayPrecede: true },
  { field: 'servingSize', keywords: ['servingsize', 'servsize'], unit: 'none' },
  { field: 'saturatedFatG', keywords: ['saturatedfat', 'satfat', 'saturated'], unit: 'g' },
  { field: 'transFatG', keywords: ['transfat'], unit: 'g' },
  { field: 'totalFatG', keywords: ['totalfat'], unit: 'g' },
  { field: 'cholesterolMg', keywords: ['cholesterol', 'cholest'], unit: 'mg' },
  { field: 'sodiumMg', keywords: ['sodium'], unit: 'mg' },
  { field: 'totalCarbsG', keywords: ['totalcarbohydrate', 'totalcarb', 'carbohydrate'], unit: 'g' },
  { field: 'fiberG', keywords: ['dietaryfiber', 'dietaryfibre', 'fiber', 'fibre'], unit: 'g' },
  { field: 'addedSugarsG', keywords: ['addedsugars', 'addedsugar'], unit: 'g', valueMayPrecede: true },
  { field: 'totalSugarsG', keywords: ['totalsugars', 'totalsugar', 'sugars', 'sugar'], unit: 'g' },
  { field: 'proteinG', keywords: ['protein'], unit: 'g' },
  { field: 'calories', keywords: ['calories'], unit: 'none' },
];

interface KeywordHit {
  def: FieldDef;
  /** Index into `letters` where the keyword starts / ends */
  start: number;
  end: number;
}

/** Find all non-overlapping keyword hits in a line, most specific first. */
function findKeywordHits(line: NormalizedLine): KeywordHit[] {
  const hits: KeywordHit[] = [];
  const consumed: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) =>
    consumed.some(([cs, ce]) => s < ce && e > cs);

  for (const def of FIELD_DEFS) {
    for (const keyword of def.keywords) {
      let from = 0;
      while (from <= line.letters.length - keyword.length) {
        const idx = line.letters.indexOf(keyword, from);
        if (idx === -1) break;
        const end = idx + keyword.length;
        if (!overlaps(idx, end)) {
          // "Calories from fat" (pre-2016 labels) is not the calories field.
          if (def.field === 'calories' && line.letters.startsWith('fromfat', end)) {
            from = end;
            continue;
          }
          // "Polyunsaturated"/"Monounsaturated" must not hit saturated fat.
          if (def.field === 'saturatedFatG' && line.letters.slice(Math.max(0, idx - 2), idx) === 'un') {
            from = end;
            continue;
          }
          hits.push({ def, start: idx, end });
          consumed.push([idx, end]);
        }
        from = end;
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Raw-string segment between a keyword hit and the next hit (or line end). */
function rawSegmentAfter(line: NormalizedLine, hit: KeywordHit, nextHit?: KeywordHit): string {
  const startRaw = line.posMap[hit.end - 1] + 1;
  const endRaw = nextHit ? line.posMap[nextHit.start] : line.raw.length;
  return line.raw.slice(startRaw, endRaw);
}

/** Raw-string segment before a keyword hit (start of line or previous hit). */
function rawSegmentBefore(line: NormalizedLine, hit: KeywordHit, prevHit?: KeywordHit): string {
  const startRaw = prevHit ? line.posMap[prevHit.end - 1] + 1 : 0;
  const endRaw = line.posMap[hit.start];
  return line.raw.slice(startRaw, endRaw);
}

// ---------------------------------------------------------------------------
// Serving size helpers
// ---------------------------------------------------------------------------

function parseServingSize(segment: string): { text: string | null; grams: number | null } {
  let text = segment.replace(/^[\s:.\-–]+/, '').trim();
  if (!text) return { text: null, grams: null };
  text = text.slice(0, 60).trim();

  // Prefer the parenthesized weight — "1 Tray (340g)" — falling back to a
  // bare "NNN g" for metric-first labels.
  let grams: number | null = null;
  const paren = /\(([^)]*)\)/.exec(text);
  const source = paren ? paren[1] : text;
  const weightMatch = /([0-9OolI|]+(?:[.,][0-9OolI|]+)?)\s*g(?![a-z])/i.exec(source);
  if (weightMatch) {
    const value = tokenToNumber(weightMatch[1]);
    if (value !== null && value > 0 && value <= FIELD_MAX.servingGramWeight) {
      grams = value;
    }
  }
  return { text, grams };
}

// ---------------------------------------------------------------------------
// Atwater validation
// ---------------------------------------------------------------------------

interface CoreMacros {
  calories: number | null;
  proteinG: number | null;
  totalCarbsG: number | null;
  totalFatG: number | null;
}

function atwaterCalories(proteinG: number, carbsG: number, fatG: number): number {
  return 4 * proteinG + 4 * carbsG + 9 * fatG;
}

function atwaterDeviation(calories: number, proteinG: number, carbsG: number, fatG: number): number {
  const computed = atwaterCalories(proteinG, carbsG, fatG);
  // Guard tiny denominators (a "5 calorie" label would otherwise flag noise).
  return Math.abs(computed - calories) / Math.max(calories, 20);
}

/**
 * OCR-plausible perturbations of a numeric value: single digit deleted,
 * substituted, or inserted. Used to find which core field, when corrected by
 * one such misread, reconciles the Atwater identity.
 */
function ocrPerturbations(value: number): number[] {
  const s = String(Math.round(value));
  const results = new Set<number>();
  for (let i = 0; i < s.length; i++) {
    // deletion
    if (s.length > 1) {
      const del = s.slice(0, i) + s.slice(i + 1);
      results.add(parseInt(del, 10));
    }
    // substitution
    for (let d = 0; d <= 9; d++) {
      const sub = s.slice(0, i) + String(d) + s.slice(i + 1);
      results.add(parseInt(sub, 10));
    }
  }
  // insertion
  for (let i = 0; i <= s.length; i++) {
    for (let d = 0; d <= 9; d++) {
      const ins = s.slice(0, i) + String(d) + s.slice(i);
      results.add(parseInt(ins, 10));
    }
  }
  results.delete(Math.round(value));
  return Array.from(results).filter((v) => Number.isFinite(v) && v >= 0);
}

/**
 * Run the Atwater identity over the core fields. Exported so the AI-fallback
 * path can validate its result with the exact same rule as the OCR path.
 */
export function evaluateAtwater(core: CoreMacros): AtwaterCheck {
  const { calories, proteinG, totalCarbsG, totalFatG } = core;
  if (calories === null || proteinG === null || totalCarbsG === null || totalFatG === null) {
    return {
      computedCalories:
        proteinG !== null && totalCarbsG !== null && totalFatG !== null
          ? Math.round(atwaterCalories(proteinG, totalCarbsG, totalFatG))
          : null,
      parsedCalories: calories,
      deviation: null,
      withinTolerance: null,
      suspectField: null,
    };
  }

  const computed = atwaterCalories(proteinG, totalCarbsG, totalFatG);
  const deviation = atwaterDeviation(calories, proteinG, totalCarbsG, totalFatG);
  const within = deviation <= ATWATER_TOLERANCE;

  let suspectField: MacroKey | null = null;
  if (!within) {
    // For each macro, test whether some single OCR misread of it reconciles
    // the identity; the macro with the best reconciliation is the likely
    // culprit (evaluation order breaks exact ties deterministically).
    // Calories is only blamed when no macro can reconcile — a single digit
    // edit can bend calories to match almost any computed value, so testing
    // it alongside the macros would let it steal the blame.
    const macroCandidates: Array<{ field: MacroKey; parsed: number; max: number }> = [
      { field: 'protein', parsed: proteinG, max: FIELD_MAX.proteinG },
      { field: 'carbs', parsed: totalCarbsG, max: FIELD_MAX.totalCarbsG },
      { field: 'fat', parsed: totalFatG, max: FIELD_MAX.totalFatG },
    ];
    let bestDeviation = Infinity;
    for (const candidate of macroCandidates) {
      for (const perturbed of ocrPerturbations(candidate.parsed)) {
        if (perturbed > candidate.max) continue;
        const dev =
          candidate.field === 'protein'
            ? atwaterDeviation(calories, perturbed, totalCarbsG, totalFatG)
            : candidate.field === 'carbs'
              ? atwaterDeviation(calories, proteinG, perturbed, totalFatG)
              : atwaterDeviation(calories, proteinG, totalCarbsG, perturbed);
        if (dev <= ATWATER_TOLERANCE && dev < bestDeviation) {
          bestDeviation = dev;
          suspectField = candidate.field;
        }
      }
    }
    if (!suspectField) {
      for (const perturbed of ocrPerturbations(calories)) {
        if (perturbed > FIELD_MAX.calories) continue;
        if (atwaterDeviation(perturbed, proteinG, totalCarbsG, totalFatG) <= ATWATER_TOLERANCE) {
          suspectField = 'calories';
          break;
        }
      }
    }
  }

  return {
    computedCalories: Math.round(computed),
    parsedCalories: calories,
    deviation,
    withinTolerance: within,
    suspectField,
  };
}

/** User-facing warning for a failed Atwater check (shared by OCR + AI paths). */
export function atwaterWarningMessage(atwater: AtwaterCheck): string | null {
  if (atwater.withinTolerance !== false || atwater.computedCalories === null) return null;
  const suspect = atwater.suspectField ? MACRO_LABELS[atwater.suspectField] : null;
  return suspect
    ? `Calories don't match the macros (expected ~${atwater.computedCalories}) — double-check ${suspect}.`
    : `Calories don't match the macros (expected ~${atwater.computedCalories}) — double-check the values.`;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

const EMPTY_FIELDS: ParsedNutritionFields = {
  calories: null,
  totalFatG: null,
  saturatedFatG: null,
  transFatG: null,
  cholesterolMg: null,
  sodiumMg: null,
  totalCarbsG: null,
  fiberG: null,
  totalSugarsG: null,
  addedSugarsG: null,
  proteinG: null,
  servingSizeText: null,
  servingGramWeight: null,
  servingsPerContainer: null,
};

/** True if a line is (noisy) numbers/units only — a value split onto its own
 * line by OCR, e.g. the big "230" under "Calories". */
function isBareValueLine(line: NormalizedLine): boolean {
  if (!/[0-9]/.test(line.raw)) return false;
  if (findKeywordHits(line).length > 0) return false;
  return /^[\s0-9OolI|.,%()/\-–]*(?:mcg|mg|g|kcal|cal)?[\s0-9OolI|.,%()/\-–]*$/i.test(line.raw);
}

export function parseNutritionLabel(ocrLines: string[]): ParseNutritionLabelResult {
  const fields: ParsedNutritionFields = { ...EMPTY_FIELDS };
  const fieldConfidence: ParseNutritionLabelResult['fieldConfidence'] = {};
  const warnings: string[] = [];

  const lines = ocrLines.map((l) => l.trim()).filter(Boolean).map(normalizeLine);

  const assign = (field: NumericLabelField, measure: Measure) => {
    if (fields[field] !== null) return; // first hit wins (FDA order: top of panel first)
    fields[field] = measure.value;
    fieldConfidence[field] = measure.repaired ? 'low' : 'high';
    if (measure.repaired) {
      warnings.push(`Repaired a likely misread in ${FIELD_LABELS[field]} — double-check it.`);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hits = findKeywordHits(line);

    for (let h = 0; h < hits.length; h++) {
      const hit = hits[h];
      const nextHit = hits[h + 1];
      const prevHit = hits[h - 1];
      const def = hit.def;

      if (def.field === 'servingSize') {
        if (fields.servingSizeText === null) {
          const segment = rawSegmentAfter(line, hit, nextHit);
          const { text, grams } = parseServingSize(segment);
          fields.servingSizeText = text;
          fields.servingGramWeight = grams;
        }
        continue;
      }

      const field = def.field;
      const max = FIELD_MAX[field] ?? Infinity;

      // Value after the keyword (the standard layout)…
      let measure = extractMeasure(rawSegmentAfter(line, hit, nextHit), { unit: def.unit, max });

      // …or before it ("Includes 10g Added Sugars", "8 servings per container").
      if (!measure && def.valueMayPrecede) {
        measure = extractMeasure(rawSegmentBefore(line, hit, prevHit), { unit: def.unit, max });
      }

      // …or on the next line (OCR split, e.g. the large-type calories value).
      if (!measure && !nextHit) {
        const next = lines[i + 1];
        if (next && isBareValueLine(next)) {
          measure = extractMeasure(next.raw, { unit: def.unit, max });
        }
      }

      if (measure) assign(field, measure);
    }
  }

  // -------------------------------------------------------------------------
  // Cross-field sanity + Atwater validation
  // -------------------------------------------------------------------------

  if (
    fields.fiberG !== null &&
    fields.totalSugarsG !== null &&
    fields.totalCarbsG !== null &&
    fields.fiberG + fields.totalSugarsG > fields.totalCarbsG + 1
  ) {
    warnings.push('Fiber + sugars exceed total carbs — one of them may be misread.');
    fieldConfidence.totalCarbsG = 'low';
  }

  const atwater = evaluateAtwater(fields);
  if (atwater.withinTolerance === false) {
    const message = atwaterWarningMessage(atwater);
    if (message) warnings.push(message);
    if (atwater.suspectField) {
      const suspectFieldKey: NumericLabelField =
        atwater.suspectField === 'calories'
          ? 'calories'
          : atwater.suspectField === 'protein'
            ? 'proteinG'
            : atwater.suspectField === 'carbs'
              ? 'totalCarbsG'
              : 'totalFatG';
      fieldConfidence[suspectFieldKey] = 'low';
    }
  }

  const hasCoreFields =
    fields.calories !== null &&
    fields.proteinG !== null &&
    fields.totalCarbsG !== null &&
    fields.totalFatG !== null;

  if (!hasCoreFields) {
    warnings.push("Couldn't read all of calories, protein, carbs, and fat from the label.");
  }

  const coreLow = (['calories', 'proteinG', 'totalCarbsG', 'totalFatG'] as const).some(
    (f) => fieldConfidence[f] === 'low'
  );

  const confidence: ConfidenceLevel =
    hasCoreFields && atwater.withinTolerance !== false && !coreLow ? 'high' : 'low';

  return { fields, confidence, fieldConfidence, warnings, atwater, hasCoreFields };
}

/** Human-readable names for warnings + form annotations. */
export const FIELD_LABELS: Record<NumericLabelField, string> = {
  calories: 'calories',
  totalFatG: 'total fat',
  saturatedFatG: 'saturated fat',
  transFatG: 'trans fat',
  cholesterolMg: 'cholesterol',
  sodiumMg: 'sodium',
  totalCarbsG: 'total carbs',
  fiberG: 'fiber',
  totalSugarsG: 'total sugars',
  addedSugarsG: 'added sugars',
  proteinG: 'protein',
  servingGramWeight: 'serving weight',
  servingsPerContainer: 'servings per container',
};
