#!/usr/bin/env node
/**
 * Script to fetch exercise images from free-exercise-db
 *
 * Usage: node scripts/fetch-exercise-videos.mjs
 *
 * Source: https://github.com/yuhonas/free-exercise-db (Public Domain)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Free exercise database (public domain, 800+ exercises)
const EXERCISE_DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

// Map our exercise names to free-exercise-db names
const EXERCISE_MAPPINGS = {
  // Chest
  'Barbell Bench Press': 'Barbell Bench Press - Medium Grip',
  'Dumbbell Bench Press': 'Dumbbell Bench Press',
  'Incline Dumbbell Press': 'Incline Dumbbell Press',
  'Cable Fly': 'Cable Crossover',
  'Dips (Chest Focus)': 'Dips - Chest Version',
  'Machine Chest Press': 'Machine Bench Press',

  // Back
  'Barbell Row': 'Bent Over Barbell Row',
  'Dumbbell Row': 'One-Arm Dumbbell Row',
  'Lat Pulldown': 'Wide-Grip Lat Pulldown',
  'Pull-Ups': 'Pullups',
  'Cable Row': 'Seated Cable Rows',
  'Deadlift': 'Barbell Deadlift',

  // Shoulders
  'Overhead Press': 'Standing Military Press',
  'Lateral Raise': 'Side Lateral Raise',
  'Rear Delt Fly': 'Seated Bent-Over Rear Delt Raise',
  'Face Pull': 'Face Pull',

  // Legs
  'Barbell Back Squat': 'Barbell Squat',
  'Leg Press': 'Leg Press',
  'Romanian Deadlift': 'Romanian Deadlift',
  'Lying Leg Curl': 'Lying Leg Curls',
  'Leg Extension': 'Leg Extensions',
  'Dumbbell Lunges': 'Dumbbell Lunges',
  'Calf Raise': 'Standing Calf Raises',

  // Arms
  'Barbell Curl': 'Barbell Curl',
  'Dumbbell Curl': 'Dumbbell Bicep Curl',
  'Hammer Curl': 'Hammer Curls',
  'Tricep Pushdown': 'Triceps Pushdown',
  'Skull Crushers': 'Lying Triceps Press',
  'Close-Grip Bench Press': 'Close-Grip Barbell Bench Press',
};

async function fetchExerciseDatabase() {
  console.log('📥 Fetching exercise database...');
  const response = await fetch(EXERCISE_DB_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch database: ${response.statusText}`);
  }
  return response.json();
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

async function main() {
  // Create output directory
  const outputDir = path.join(path.dirname(__dirname), 'public', 'exercise-demos');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Fetch the exercise database
  const exercises = await fetchExerciseDatabase();
  console.log(`📚 Found ${exercises.length} exercises in database\n`);

  // Process each mapped exercise
  const results = { success: [], failed: [] };

  for (const [ourName, dbName] of Object.entries(EXERCISE_MAPPINGS)) {
    const exercise = exercises.find(
      (e) => e.name.toLowerCase() === dbName.toLowerCase()
    );

    if (!exercise) {
      console.log(`⚠️  Not found: "${ourName}" (looked for "${dbName}")`);
      results.failed.push(ourName);
      continue;
    }

    if (!exercise.images || exercise.images.length === 0) {
      console.log(`⚠️  No images for: ${ourName}`);
      results.failed.push(ourName);
      continue;
    }

    try {
      // Download the first image (starting position)
      const imagePath = exercise.images[0];
      const imageUrl = `${IMAGE_BASE_URL}${imagePath}`;
      
      // Preserve original file extension from source (could be .gif, .jpg, .png, etc.)
      const originalExt = path.extname(imagePath) || '.jpg';
      const fileName = `${ourName.toLowerCase().replace(/[^a-z0-9]/g, '-')}${originalExt}`;
      const localPath = path.join(outputDir, fileName);

      console.log(`📥 Downloading: ${ourName}...`);
      await downloadImage(imageUrl, localPath);
      console.log(`✅ Saved: ${fileName} (format: ${originalExt})`);

      results.success.push(ourName);
    } catch (err) {
      console.error(`❌ Failed: ${ourName} - ${err.message}`);
      results.failed.push(ourName);
    }
  }

  // Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`✅ Success: ${results.success.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);
  console.log(`\n📁 Images saved to: ${outputDir}`);

  // Generate SQL for updating database
  if (results.success.length > 0) {
    const sqlPath = path.join(outputDir, 'update-urls.sql');
    let sql = '-- Update exercises with local image paths\n';
    for (const name of results.success) {
      const fileName = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.jpg`;
      sql += `UPDATE exercises SET demo_gif_url = '/exercise-demos/${fileName}' WHERE name = '${name}';\n`;
    }
    fs.writeFileSync(sqlPath, sql);
    console.log(`\n📝 SQL file generated: ${sqlPath}`);
  }
}

main().catch(console.error);
