import {
  parseNutritionLabel,
  evaluateAtwater,
  atwaterWarningMessage,
  ATWATER_TOLERANCE,
} from '../labelParser';
import {
  CLEAN_LABEL,
  OCR_O0_SUBSTITUTION,
  MERGED_COLUMNS_LABEL,
  NO_ADDED_SUGARS_LABEL,
  METRIC_FIRST_LABEL,
  ATWATER_CONSISTENT_LABEL,
  ATWATER_PROTEIN_MISREAD_LABEL,
  MISSING_CORE_FIELD_LABEL,
  TRAILING_NINE_LABEL,
  UNSATURATED_FAT_LABEL,
} from './labelParser.fixtures';

describe('parseNutritionLabel', () => {
  describe('clean FDA label', () => {
    const result = parseNutritionLabel(CLEAN_LABEL);

    it('extracts every field', () => {
      expect(result.fields).toEqual({
        calories: 230,
        totalFatG: 8,
        saturatedFatG: 1,
        transFatG: 0,
        cholesterolMg: 0,
        sodiumMg: 160,
        totalCarbsG: 37,
        fiberG: 4,
        totalSugarsG: 12,
        addedSugarsG: 10,
        proteinG: 3,
        servingSizeText: '2/3 cup (55g)',
        servingGramWeight: 55,
        servingsPerContainer: 8,
      });
    });

    it('reads the calories value from the split next line', () => {
      expect(result.fields.calories).toBe(230);
    });

    it('ignores %DV numbers', () => {
      // e.g. "Total Fat 8g 10%" must be 8, never 10
      expect(result.fields.totalFatG).toBe(8);
      expect(result.fields.totalCarbsG).toBe(37);
    });

    it('is high confidence with no warnings', () => {
      expect(result.confidence).toBe('high');
      expect(result.hasCoreFields).toBe(true);
      expect(result.warnings).toEqual([]);
      // 4·3 + 4·37 + 9·8 = 232 vs 230 → consistent
      expect(result.atwater.withinTolerance).toBe(true);
    });
  });

  describe('O/0 and l/1 substitution noise', () => {
    const result = parseNutritionLabel(OCR_O0_SUBSTITUTION);

    it('recovers labels with digits swapped into words', () => {
      expect(result.fields.calories).toBe(230);
      expect(result.fields.totalFatG).toBe(8);
      expect(result.fields.sodiumMg).toBe(160);
      expect(result.fields.totalCarbsG).toBe(37);
      expect(result.fields.proteinG).toBe(3);
    });

    it('recovers values with letters swapped into numbers', () => {
      expect(result.fields.saturatedFatG).toBe(1); // "lg"
      expect(result.fields.transFatG).toBe(0); // "Og"
      expect(result.fields.cholesterolMg).toBe(0); // "Omg"
      expect(result.fields.servingGramWeight).toBe(240); // "(24Og)"
    });

    it('stays high confidence (Atwater holds)', () => {
      // 4·3 + 4·37 + 9·8 = 232 vs 230
      expect(result.confidence).toBe('high');
    });
  });

  describe('merged value/unit/%DV columns', () => {
    const result = parseNutritionLabel(MERGED_COLUMNS_LABEL);

    it('splits "TotalFat20g26%" into value 20, ignoring the DV', () => {
      expect(result.fields.totalFatG).toBe(20);
    });

    it('parses the rest of the merged panel', () => {
      expect(result.fields.calories).toBe(490);
      expect(result.fields.saturatedFatG).toBe(4.5);
      expect(result.fields.transFatG).toBe(0);
      expect(result.fields.cholesterolMg).toBe(55);
      expect(result.fields.sodiumMg).toBe(850);
      expect(result.fields.totalCarbsG).toBe(36);
      expect(result.fields.fiberG).toBe(3);
      expect(result.fields.totalSugarsG).toBe(5);
      expect(result.fields.proteinG).toBe(40);
      expect(result.fields.servingSizeText).toBe('1 Tray (340g)');
      expect(result.fields.servingGramWeight).toBe(340);
      expect(result.fields.servingsPerContainer).toBe(2);
    });

    it('is high confidence (4·40 + 4·36 + 9·20 = 484 ≈ 490)', () => {
      expect(result.confidence).toBe('high');
      expect(result.atwater.withinTolerance).toBe(true);
    });
  });

  describe('label without added sugars', () => {
    const result = parseNutritionLabel(NO_ADDED_SUGARS_LABEL);

    it('leaves missing non-core fields null without losing confidence', () => {
      expect(result.fields.addedSugarsG).toBeNull();
      expect(result.fields.transFatG).toBeNull();
      expect(result.fields.cholesterolMg).toBeNull();
      expect(result.hasCoreFields).toBe(true);
      // 4·9 + 4·22 + 9·6 = 178 vs 180
      expect(result.confidence).toBe('high');
    });

    it('still extracts the present fields', () => {
      expect(result.fields.calories).toBe(180);
      expect(result.fields.totalSugarsG).toBe(9);
      expect(result.fields.fiberG).toBe(3);
      expect(result.fields.servingSizeText).toBe('1 bar (40g)');
      expect(result.fields.servingGramWeight).toBe(40);
    });
  });

  describe('metric-first label', () => {
    const result = parseNutritionLabel(METRIC_FIRST_LABEL);

    it('parses a bare metric serving size', () => {
      expect(result.fields.servingSizeText).toBe('100 g');
      expect(result.fields.servingGramWeight).toBe(100);
    });

    it('handles trailing "Servings Per Container N" order and decimal commas', () => {
      expect(result.fields.servingsPerContainer).toBe(4);
      expect(result.fields.saturatedFatG).toBe(3.5); // "3,5g"
    });

    it('accepts "Fibre"/"Sugars" vocabulary', () => {
      expect(result.fields.fiberG).toBe(2);
      expect(result.fields.totalSugarsG).toBe(4);
    });

    it('is high confidence (4·17 + 4·21 + 9·11 = 251 ≈ 250)', () => {
      expect(result.confidence).toBe('high');
    });
  });

  describe('Atwater validation', () => {
    it('passes within tolerance: computed 484 vs printed 490', () => {
      const result = parseNutritionLabel(ATWATER_CONSISTENT_LABEL);
      expect(result.atwater.computedCalories).toBe(484);
      expect(result.atwater.parsedCalories).toBe(490);
      expect(result.atwater.withinTolerance).toBe(true);
      expect(result.atwater.suspectField).toBeNull();
      expect(result.confidence).toBe('high');
    });

    it('flags a protein misread as LOW confidence with protein as suspect', () => {
      const result = parseNutritionLabel(ATWATER_PROTEIN_MISREAD_LABEL);
      // protein OCR'd as 140 instead of 40 → computed 884 vs printed 490
      expect(result.fields.proteinG).toBe(140);
      expect(result.atwater.withinTolerance).toBe(false);
      expect(result.atwater.suspectField).toBe('protein');
      expect(result.confidence).toBe('low');
      expect(result.fieldConfidence.proteinG).toBe('low');
      expect(result.warnings.join(' ')).toMatch(/double-check protein/);
      expect(result.warnings.join(' ')).toMatch(/expected ~884/);
    });
  });

  describe('missing core fields', () => {
    const result = parseNutritionLabel(MISSING_CORE_FIELD_LABEL);

    it('forces LOW confidence and reports it', () => {
      expect(result.fields.totalFatG).toBeNull();
      expect(result.hasCoreFields).toBe(false);
      expect(result.confidence).toBe('low');
      expect(result.warnings.join(' ')).toMatch(/calories, protein, carbs, and fat/);
    });

    it('cannot evaluate Atwater without all core fields', () => {
      expect(result.atwater.withinTolerance).toBeNull();
    });
  });

  describe('unit-g read as trailing 9', () => {
    const result = parseNutritionLabel(TRAILING_NINE_LABEL);

    it('repairs "Total Fat 209" to 20g and downgrades the field', () => {
      expect(result.fields.totalFatG).toBe(20);
      expect(result.fieldConfidence.totalFatG).toBe('low');
      expect(result.confidence).toBe('low');
      expect(result.warnings.join(' ')).toMatch(/total fat/);
    });

    it('keeps the repaired value Atwater-consistent', () => {
      expect(result.atwater.withinTolerance).toBe(true);
    });
  });

  describe('unsaturated fat lines', () => {
    it('does not read poly/monounsaturated as saturated fat', () => {
      const result = parseNutritionLabel(UNSATURATED_FAT_LABEL);
      expect(result.fields.saturatedFatG).toBe(2);
      expect(result.fields.totalFatG).toBe(14);
    });
  });

  describe('degenerate input', () => {
    it('returns all-null fields and LOW confidence for empty input', () => {
      const result = parseNutritionLabel([]);
      expect(result.hasCoreFields).toBe(false);
      expect(result.confidence).toBe('low');
      expect(result.fields.calories).toBeNull();
    });

    it('handles non-label text without crashing', () => {
      const result = parseNutritionLabel(['The quick brown fox', 'jumps over 42 dogs']);
      expect(result.confidence).toBe('low');
      expect(result.hasCoreFields).toBe(false);
    });
  });
});

describe('evaluateAtwater (shared with the AI path)', () => {
  it('accepts a consistent result', () => {
    const check = evaluateAtwater({ calories: 490, proteinG: 40, totalCarbsG: 36, totalFatG: 20 });
    expect(check.computedCalories).toBe(484);
    expect(check.withinTolerance).toBe(true);
    expect(check.deviation).toBeLessThanOrEqual(ATWATER_TOLERANCE);
  });

  it('blames calories when no macro perturbation reconciles', () => {
    // Calories misread 490 → 90: no plausible single misread of P/C/F fixes it
    const check = evaluateAtwater({ calories: 90, proteinG: 40, totalCarbsG: 36, totalFatG: 20 });
    expect(check.withinTolerance).toBe(false);
    expect(check.suspectField).toBe('calories');
  });

  it('returns null tolerance when a core field is missing', () => {
    const check = evaluateAtwater({ calories: 200, proteinG: null, totalCarbsG: 20, totalFatG: 5 });
    expect(check.withinTolerance).toBeNull();
    expect(check.suspectField).toBeNull();
  });

  it('produces a user-facing warning naming the suspect', () => {
    const check = evaluateAtwater({ calories: 490, proteinG: 140, totalCarbsG: 36, totalFatG: 20 });
    expect(atwaterWarningMessage(check)).toBe(
      "Calories don't match the macros (expected ~884) — double-check protein."
    );
  });

  it('returns no warning when consistent', () => {
    const check = evaluateAtwater({ calories: 490, proteinG: 40, totalCarbsG: 36, totalFatG: 20 });
    expect(atwaterWarningMessage(check)).toBeNull();
  });
});
