#!/usr/bin/env node
/**
 * Script to generate exercise mappings for MuscleWiki API
 * Extracts exercise names from SQL files and generates simplified search terms
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to simplify exercise names for MuscleWiki search
function generateSearchTerms(exerciseName) {
  const lower = exerciseName.toLowerCase();
  const terms = [];
  
  // Remove common prefixes/suffixes that MuscleWiki doesn't use
  let simplified = exerciseName
    .replace(/\(.*?\)/g, '') // Remove parentheses content like "(Chest Focus)"
    .replace(/\s+/g, ' ')
    .trim();
  
  // Generate base search term (remove equipment prefixes)
  const baseTerm = simplified
    .replace(/^(barbell|dumbbell|machine|cable|smith machine|incline|decline|seated|standing|lying|assisted)\s+/i, '')
    .replace(/\s+(barbell|dumbbell|machine|cable)$/i, '')
    .trim();
  
  // Add the simplified version
  if (baseTerm && baseTerm !== simplified) {
    terms.push(baseTerm.toLowerCase());
  }
  
  // Add the full name (lowercase)
  terms.push(simplified.toLowerCase());
  
  // Add common variations
  if (simplified.includes('Bench Press')) {
    terms.push('bench press');
  }
  if (simplified.includes('Dumbbell Press')) {
    terms.push('dumbbell press');
  }
  if (simplified.includes('Incline Press')) {
    terms.push('incline press');
  }
  if (simplified.includes('Pull-Up') || simplified.includes('Pull Up')) {
    terms.push('pull up', 'pullup');
  }
  if (simplified.includes('Squat')) {
    terms.push('squat');
  }
  if (simplified.includes('Deadlift')) {
    terms.push('deadlift');
  }
  if (simplified.includes('Row')) {
    terms.push('row');
  }
  if (simplified.includes('Curl')) {
    terms.push('curl');
  }
  if (simplified.includes('Extension')) {
    terms.push('extension');
  }
  if (simplified.includes('Raise')) {
    terms.push('raise');
  }
  if (simplified.includes('Press')) {
    terms.push('press');
  }
  
  // Remove duplicates and return
  return [...new Set(terms)];
}

// Extract exercise names from SQL files
function extractExercisesFromSQL() {
  const exercises = new Set();
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const seedFile = path.join(__dirname, '..', 'supabase', 'seed.sql');
  
  // Read seed file
  if (fs.existsSync(seedFile)) {
    const seedContent = fs.readFileSync(seedFile, 'utf8');
    const seedMatches = seedContent.matchAll(/\('([^']+)',\s*'[^']+',/g);
    for (const match of seedMatches) {
      exercises.add(match[1]);
    }
  }
  
  // Read migration files
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Match INSERT INTO exercises patterns
      const insertMatches = content.matchAll(/\('([^']+)',\s*'[^']+',/g);
      for (const match of insertMatches) {
        exercises.add(match[1]);
      }
      
      // Match UPDATE exercises SET ... WHERE name = patterns
      const updateMatches = content.matchAll(/WHERE name = '([^']+)'/g);
      for (const match of updateMatches) {
        exercises.add(match[1]);
      }
    }
  }
  
  return Array.from(exercises).sort();
}

// Generate mappings
const exercises = extractExercisesFromSQL();
const mappings = {};

for (const exercise of exercises) {
  const searchTerms = generateSearchTerms(exercise);
  if (searchTerms.length > 0) {
    mappings[exercise] = searchTerms;
  }
}

// Output as JavaScript object
console.log('// Auto-generated exercise mappings for MuscleWiki API');
console.log('// Generated from SQL migration files');
console.log('const EXERCISE_MAPPINGS = {');
for (const [exercise, terms] of Object.entries(mappings)) {
  const termsStr = terms.map(t => `'${t}'`).join(', ');
  console.log(`  '${exercise}': [${termsStr}],`);
}
console.log('};');
console.log('');
console.log(`// Total exercises: ${exercises.length}`);
console.log(`// Total mappings: ${Object.keys(mappings).length}`);

