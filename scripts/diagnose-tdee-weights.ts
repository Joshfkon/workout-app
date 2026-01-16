/**
 * Diagnostic script to check weight data for TDEE calculation issues
 *
 * Run with: npx ts-node --transpile-only scripts/diagnose-tdee-weights.ts
 */

// Inline the NEW fixed validation logic
const KG_TO_LBS = 2.20462;

interface ValidatedWeight {
  weight: number;
  unit: 'lb' | 'kg';
  wasCorrected: boolean;
  originalWeight: number;
  originalUnit: 'lb' | 'kg' | null;
}

function validateWeightEntry(
  weight: number,
  unit: 'lb' | 'kg' | null
): ValidatedWeight {
  let correctedWeight = weight;
  let correctedUnit: 'lb' | 'kg' = unit || 'lb';
  let wasCorrected = false;

  if (!unit) {
    correctedUnit = 'lb';
  }

  // NEW FIXED LOGIC: Trust stored units, only correct extreme values
  if (correctedUnit === 'lb') {
    if (weight > 500) {
      correctedWeight = weight * KG_TO_LBS;
      wasCorrected = true;
    }
  }

  if (correctedUnit === 'kg') {
    if (weight > 300) {
      correctedUnit = 'lb';
      wasCorrected = true;
    }
  }

  return {
    weight: correctedWeight,
    unit: correctedUnit,
    wasCorrected,
    originalWeight: weight,
    originalUnit: unit,
  };
}

// Simulated weight data (replace with actual DB query in production)
// This shows what the OLD buggy code would have done vs the NEW fixed code
const sampleWeightEntries = [
  // Scenario 1: User stores weight in kg (European user)
  { weight: 77.6, unit: 'kg' as const, date: '2024-01-15' },
  { weight: 77.8, unit: 'kg' as const, date: '2024-01-16' },
  { weight: 77.5, unit: 'kg' as const, date: '2024-01-17' },

  // Scenario 2: User stores weight in lbs (US user)
  { weight: 171.1, unit: 'lb' as const, date: '2024-01-15' },
  { weight: 170.8, unit: 'lb' as const, date: '2024-01-16' },
  { weight: 171.3, unit: 'lb' as const, date: '2024-01-17' },

  // Scenario 3: Null unit (legacy data)
  { weight: 175, unit: null, date: '2024-01-15' },

  // Scenario 4: Light person (edge case that OLD code would break)
  { weight: 70, unit: 'lb' as const, date: '2024-01-15' },

  // Scenario 5: Heavy person in kg
  { weight: 120, unit: 'kg' as const, date: '2024-01-15' },
];

console.log('=== TDEE Weight Data Diagnostic ===\n');

console.log('Testing weight validation with FIXED code:\n');

for (const entry of sampleWeightEntries) {
  const result = validateWeightEntry(entry.weight, entry.unit);

  // Convert to lbs for TDEE (this is what the TDEE code does)
  const weightInLbs = result.unit === 'kg'
    ? result.weight * 2.20462
    : result.weight;

  console.log(`Date: ${entry.date}`);
  console.log(`  Raw: ${entry.weight} ${entry.unit || '(null)'}`);
  console.log(`  Validated: ${result.weight} ${result.unit}`);
  console.log(`  TDEE uses: ${weightInLbs.toFixed(1)} lbs`);
  if (result.wasCorrected) {
    console.log(`  ⚠️  CORRECTED from ${result.originalWeight} ${result.originalUnit}`);
  }
  console.log('');
}

// Show what the OLD buggy code would have done
console.log('\n=== Comparison: OLD vs NEW behavior ===\n');

interface OldBuggyResult {
  weight: number;
  unit: 'lb' | 'kg';
  wasCorrected: boolean;
}

function oldBuggyValidation(weight: number, unit: 'lb' | 'kg' | null): OldBuggyResult {
  let correctedWeight = weight;
  let correctedUnit: 'lb' | 'kg' = unit || 'lb';
  let wasCorrected = false;

  if (correctedUnit === 'lb') {
    // OLD BUG: 30-85 lbs treated as kg
    if (weight >= 30 && weight <= 85) {
      correctedWeight = weight * 2.20462;
      wasCorrected = true;
    }
  }

  if (correctedUnit === 'kg') {
    // OLD BUG: 30-200 kg relabeled as lb WITHOUT converting
    if (weight >= 30 && weight <= 200) {
      correctedUnit = 'lb';
      wasCorrected = true;
    }
  }

  return { weight: correctedWeight, unit: correctedUnit, wasCorrected };
}

const criticalCases = [
  { weight: 77.6, unit: 'kg' as const, description: 'Typical kg user (77.6 kg = 171 lbs)' },
  { weight: 70, unit: 'lb' as const, description: 'Light person (70 lbs)' },
  { weight: 150, unit: 'kg' as const, description: 'Heavy kg user (150 kg = 330 lbs)' },
];

for (const entry of criticalCases) {
  const oldResult = oldBuggyValidation(entry.weight, entry.unit);
  const newResult = validateWeightEntry(entry.weight, entry.unit);

  const oldLbs = oldResult.unit === 'kg' ? oldResult.weight * 2.20462 : oldResult.weight;
  const newLbs = newResult.unit === 'kg' ? newResult.weight * 2.20462 : newResult.weight;

  console.log(`${entry.description}:`);
  console.log(`  Input: ${entry.weight} ${entry.unit}`);
  console.log(`  OLD code → ${oldLbs.toFixed(1)} lbs ${oldResult.wasCorrected ? '(WRONGLY CORRECTED)' : ''}`);
  console.log(`  NEW code → ${newLbs.toFixed(1)} lbs ${newResult.wasCorrected ? '(corrected)' : '(trusted)'}`);

  if (Math.abs(oldLbs - newLbs) > 1) {
    const diff = oldLbs - newLbs;
    console.log(`  ❌ DIFFERENCE: ${diff > 0 ? '+' : ''}${diff.toFixed(1)} lbs (${((diff/newLbs)*100).toFixed(0)}% error!)`);
  } else {
    console.log(`  ✅ Results match`);
  }
  console.log('');
}

console.log('\n=== Impact on TDEE Regression ===\n');
console.log('If weight data was stored as kg but processed with OLD buggy code:');
console.log('');
console.log('Example user: 77.6 kg actual weight (171 lbs)');
console.log('  - OLD code treats as: 77.6 lbs (55% too low!)');
console.log('  - Burn rate appears higher because same calories move a "lighter" person more');
console.log('  - Regression model gets confused because weight values are inconsistent');
console.log('  - Result: Low R² correlation (like the 3% you saw)');
console.log('');
console.log('After fix:');
console.log('  - 77.6 kg correctly becomes 171.1 lbs');
console.log('  - Weight changes make sense relative to calories');
console.log('  - Regression should converge properly');
