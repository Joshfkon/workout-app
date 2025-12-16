/**
 * Import/Export Service
 * 
 * Handles importing and exporting data from/to other fitness apps:
 * - Strong App (workout tracking)
 * - LoseIt (food/nutrition tracking)
 */

// ============================================
// TYPES
// ============================================

export interface StrongWorkoutRow {
  Date: string;
  'Workout Name': string;
  'Exercise Name': string;
  'Set Order': string;
  Weight: string;
  'Weight Unit': string;
  Reps: string;
  RPE: string;
  Distance: string;
  'Distance Unit': string;
  Seconds: string;
  Notes: string;
  'Workout Notes': string;
  'Workout Duration': string;
}

export interface LoseItFoodRow {
  Date: string;
  Name: string;
  Type: string;
  Quantity: string;
  Units: string;
  Calories: string;
  Fat: string;
  Protein: string;
  Carbohydrates: string;
  'Saturated Fat': string;
  Sugars: string;
  Fiber: string;
  Cholesterol: string;
  Sodium: string;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ParsedStrongWorkout {
  date: string;
  workoutName: string;
  exercises: {
    name: string;
    sets: {
      weight: number;
      weightUnit: 'kg' | 'lb';
      reps: number;
      rpe?: number;
      notes?: string;
    }[];
  }[];
  duration?: number;
  notes?: string;
}

export interface ParsedLoseItEntry {
  date: string;
  name: string;
  type: 'food' | 'exercise';
  quantity: number;
  units: string;
  calories: number;
  fat: number;
  protein: number;
  carbs: number;
}

// ============================================
// CSV PARSING HELPERS
// ============================================

function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Parse header - handle quoted fields
  const header = parseCSVLine(lines[0]);
  
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === header.length) {
      const row: Record<string, string> = {};
      header.forEach((col, idx) => {
        row[col] = values[idx];
      });
      rows.push(row);
    }
  }
  
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

// ============================================
// STRONG APP IMPORT
// ============================================

export function parseStrongCSV(csvText: string): ParsedStrongWorkout[] {
  const rows = parseCSV(csvText) as unknown as StrongWorkoutRow[];
  const workouts: Map<string, ParsedStrongWorkout> = new Map();
  
  for (const row of rows) {
    const dateKey = `${row.Date}_${row['Workout Name']}`;
    
    if (!workouts.has(dateKey)) {
      workouts.set(dateKey, {
        date: row.Date,
        workoutName: row['Workout Name'] || 'Imported Workout',
        exercises: [],
        duration: row['Workout Duration'] ? parseDuration(row['Workout Duration']) : undefined,
        notes: row['Workout Notes'] || undefined,
      });
    }
    
    const workout = workouts.get(dateKey)!;
    
    // Find or create exercise
    let exercise = workout.exercises.find(e => e.name === row['Exercise Name']);
    if (!exercise) {
      exercise = { name: row['Exercise Name'], sets: [] };
      workout.exercises.push(exercise);
    }
    
    // Add set
    const weight = parseFloat(row.Weight) || 0;
    const weightUnit = (row['Weight Unit']?.toLowerCase() === 'lbs' ? 'lb' : 'kg') as 'kg' | 'lb';
    const reps = parseInt(row.Reps) || 0;
    const rpe = row.RPE ? parseFloat(row.RPE) : undefined;
    
    exercise.sets.push({
      weight,
      weightUnit,
      reps,
      rpe,
      notes: row.Notes || undefined,
    });
  }
  
  return Array.from(workouts.values());
}

function parseDuration(durationStr: string): number {
  // Parse duration like "1h 30m" or "45m" or "1:30:00"
  if (durationStr.includes(':')) {
    const parts = durationStr.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }
  
  let seconds = 0;
  const hourMatch = durationStr.match(/(\d+)\s*h/);
  const minMatch = durationStr.match(/(\d+)\s*m/);
  const secMatch = durationStr.match(/(\d+)\s*s/);
  
  if (hourMatch) seconds += parseInt(hourMatch[1]) * 3600;
  if (minMatch) seconds += parseInt(minMatch[1]) * 60;
  if (secMatch) seconds += parseInt(secMatch[1]);
  
  return seconds;
}

// ============================================
// LOSEIT IMPORT
// ============================================

export function parseLoseItCSV(csvText: string): ParsedLoseItEntry[] {
  const rows = parseCSV(csvText) as unknown as LoseItFoodRow[];
  const entries: ParsedLoseItEntry[] = [];
  
  for (const row of rows) {
    // Skip exercise entries, only import food
    if (row.Type?.toLowerCase() === 'exercise') continue;
    
    entries.push({
      date: row.Date,
      name: row.Name,
      type: 'food',
      quantity: parseFloat(row.Quantity) || 1,
      units: row.Units || 'serving',
      calories: parseFloat(row.Calories) || 0,
      fat: parseFloat(row.Fat) || 0,
      protein: parseFloat(row.Protein) || 0,
      carbs: parseFloat(row.Carbohydrates) || 0,
    });
  }
  
  return entries;
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

export interface WorkoutExportData {
  date: string;
  workoutName: string;
  exercises: {
    name: string;
    sets: {
      weight: number;
      reps: number;
      rpe?: number;
    }[];
  }[];
}

export interface NutritionExportData {
  date: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  quantity?: number;
  units?: string;
}

export function exportToStrongCSV(workouts: WorkoutExportData[], weightUnit: 'kg' | 'lb' = 'lb'): string {
  const headers = ['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight', 'Weight Unit', 'Reps', 'RPE', 'Distance', 'Distance Unit', 'Seconds', 'Notes', 'Workout Notes', 'Workout Duration'];
  
  const rows: string[] = [headers.join(',')];
  
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      exercise.sets.forEach((set, idx) => {
        const weight = weightUnit === 'lb' ? set.weight * 2.20462 : set.weight;
        rows.push([
          workout.date,
          `"${workout.workoutName}"`,
          `"${exercise.name}"`,
          String(idx + 1),
          weight.toFixed(1),
          weightUnit === 'lb' ? 'lbs' : 'kgs',
          String(set.reps),
          set.rpe ? String(set.rpe) : '',
          '',
          '',
          '',
          '',
          '',
          '',
        ].join(','));
      });
    }
  }
  
  return rows.join('\n');
}

export function exportToLoseItCSV(entries: NutritionExportData[]): string {
  const headers = ['Date', 'Name', 'Type', 'Quantity', 'Units', 'Calories', 'Fat', 'Protein', 'Carbohydrates', 'Saturated Fat', 'Sugars', 'Fiber', 'Cholesterol', 'Sodium'];
  
  const rows: string[] = [headers.join(',')];
  
  for (const entry of entries) {
    rows.push([
      entry.date,
      `"${entry.name}"`,
      'Food',
      String(entry.quantity || 1),
      entry.units || 'serving',
      String(Math.round(entry.calories)),
      String(entry.fat.toFixed(1)),
      String(entry.protein.toFixed(1)),
      String(entry.carbs.toFixed(1)),
      '',
      '',
      '',
      '',
      '',
    ].join(','));
  }
  
  return rows.join('\n');
}

// Generic CSV export for our own format
export function exportToGenericCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const rows: string[] = [headers.join(',')];
  
  for (const row of data) {
    const values = headers.map(h => {
      const val = row[h];
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return String(val ?? '');
    });
    rows.push(values.join(','));
  }
  
  return rows.join('\n');
}

