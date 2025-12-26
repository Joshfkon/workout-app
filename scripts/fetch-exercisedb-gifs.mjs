#!/usr/bin/env node
/**
 * Script to fetch exercise GIFs from ExerciseDB API
 *
 * Usage: node scripts/fetch-exercisedb-gifs.mjs
 *
 * Source: https://github.com/ExerciseDB/exercisedb-api
 * ExerciseDB provides animated GIFs for exercises
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ExerciseDB API endpoint (public, no auth required)
const EXERCISEDB_API_URL = 'https://exercisedb.p.rapidapi.com';

// Map our exercise names to ExerciseDB search terms
const EXERCISE_MAPPINGS = {
  // Chest
  'Barbell Bench Press': ['bench press', 'barbell bench press'],
  'Dumbbell Bench Press': ['dumbbell bench press', 'dumbbell press'],
  'Incline Dumbbell Press': ['incline dumbbell press', 'incline press'],
  'Cable Fly': ['cable fly', 'cable crossover', 'pec fly'],
  'Dips (Chest Focus)': ['dips', 'chest dips'],
  
  // Back
  'Barbell Row': ['barbell row', 'bent over row'],
  'Dumbbell Row': ['dumbbell row', 'one arm row'],
  'Lat Pulldown': ['lat pulldown', 'lat pull down'],
  'Pull-Ups': ['pull up', 'pullup', 'chin up'],
  'Cable Row': ['cable row', 'seated row'],
  'Deadlift': ['deadlift', 'conventional deadlift'],
  
  // Shoulders
  'Overhead Press': ['overhead press', 'military press', 'shoulder press'],
  'Lateral Raise': ['lateral raise', 'side raise'],
  'Rear Delt Fly': ['rear delt fly', 'rear delt raise'],
  
  // Legs
  'Barbell Back Squat': ['squat', 'barbell squat', 'back squat'],
  'Leg Press': ['leg press'],
  'Romanian Deadlift': ['romanian deadlift', 'rdl'],
  'Lying Leg Curl': ['lying leg curl', 'leg curl'],
  'Leg Extension': ['leg extension', 'quad extension'],
  'Dumbbell Lunges': ['dumbbell lunge', 'lunge'],
  'Calf Raise': ['calf raise', 'standing calf raise'],
  
  // Arms
  'Barbell Curl': ['barbell curl', 'bb curl'],
  'Dumbbell Curl': ['dumbbell curl', 'bicep curl'],
  'Hammer Curl': ['hammer curl'],
  'Tricep Pushdown': ['tricep pushdown', 'tricep extension'],
  'Skull Crushers': ['skull crusher', 'lying tricep extension'],
};

async function searchExerciseDB(exerciseName) {
  const searchTerms = EXERCISE_MAPPINGS[exerciseName] || [exerciseName.toLowerCase()];
  
  for (const term of searchTerms) {
    try {
      // ExerciseDB uses RapidAPI but has a free tier
      // For now, let's try direct access or use their GitHub data
      const response = await fetch(`https://exercisedb.p.rapidapi.com/exercises/name/${encodeURIComponent(term)}`, {
        headers: {
          'X-RapidAPI-Key': 'YOUR_API_KEY', // Would need API key
          'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data) && data.length > 0) {
          return data[0];
        }
      }
    } catch (err) {
      continue;
    }
  }
  
  return null;
}

async function downloadGif(gifUrl, outputPath) {
  const response = await fetch(gifUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${gifUrl}: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

async function main() {
  console.log('⚠️  ExerciseDB API requires a RapidAPI key.');
  console.log('Alternative: Use the free-exercise-db script which downloads static images.');
  console.log('Or manually download GIFs from MuscleWiki website.\n');
  
  console.log('For now, you can:');
  console.log('1. Use static images: node scripts/fetch-exercise-videos.mjs');
  console.log('2. Get RapidAPI key for ExerciseDB and update this script');
  console.log('3. Manually download GIFs from https://musclewiki.com\n');
}

main().catch(console.error);

