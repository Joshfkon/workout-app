/**
 * Script to fetch exercise images from free-exercise-db and upload to Supabase Storage
 *
 * Usage:
 *   Download only:  npx ts-node scripts/fetch-exercise-videos.ts
 *   With upload:    NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx npx ts-node scripts/fetch-exercise-videos.ts
 *
 * Source: https://github.com/yuhonas/free-exercise-db (Public Domain)
 */

import * as fs from 'fs';
import * as path from 'path';

// Free exercise database (public domain, 800+ exercises)
const EXERCISE_DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

// Map our exercise names to free-exercise-db names
const EXERCISE_MAPPINGS: Record<string, string> = {
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

interface FreeExercise {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  images: string[];
  instructions: string[];
}

async function fetchExerciseDatabase(): Promise<FreeExercise[]> {
  console.log('📥 Fetching exercise database...');
  const response = await fetch(EXERCISE_DB_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch database: ${response.statusText}`);
  }
  return response.json();
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

async function uploadToSupabase(
  supabaseUrl: string,
  supabaseKey: string,
  filePath: string,
  storagePath: string
): Promise<string> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const fileBuffer = fs.readFileSync(filePath);

  const { error } = await supabase.storage
    .from('exercise-demos')
    .upload(storagePath, fileBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from('exercise-demos')
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

async function updateDatabase(
  supabaseUrl: string,
  supabaseKey: string,
  exerciseName: string,
  imageUrl: string
): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error } = await supabase
    .from('exercises')
    .update({ demo_gif_url: imageUrl })
    .eq('name', exerciseName);

  if (error) {
    throw new Error(`DB update failed: ${error.message}`);
  }
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const uploadMode = !!(supabaseUrl && supabaseKey);

  if (!uploadMode) {
    console.log('⚠️  No Supabase credentials found. Running in download-only mode.');
    console.log('   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to upload.\n');
  }

  // Create output directory
  const outputDir = path.join(process.cwd(), 'public', 'exercise-demos');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Fetch the exercise database
  const exercises = await fetchExerciseDatabase();
  console.log(`📚 Found ${exercises.length} exercises in database\n`);

  // Process each mapped exercise
  const results: { success: string[]; failed: string[] } = { success: [], failed: [] };

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
      const fileName = `${ourName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.jpg`;
      const localPath = path.join(outputDir, fileName);

      console.log(`📥 Downloading: ${ourName}...`);
      await downloadImage(imageUrl, localPath);

      if (uploadMode) {
        console.log(`📤 Uploading: ${fileName}...`);
        const publicUrl = await uploadToSupabase(
          supabaseUrl!,
          supabaseKey!,
          localPath,
          fileName
        );

        console.log(`💾 Updating database...`);
        await updateDatabase(supabaseUrl!, supabaseKey!, ourName, publicUrl);
        console.log(`✅ ${ourName}\n`);
      } else {
        console.log(`✅ Saved: ${localPath}\n`);
      }

      results.success.push(ourName);
    } catch (err) {
      console.error(`❌ Failed: ${ourName} - ${err}`);
      results.failed.push(ourName);
    }
  }

  // Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`✅ Success: ${results.success.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);

  if (!uploadMode && results.success.length > 0) {
    console.log(`\n📁 Images saved to: ${outputDir}`);
    console.log('\nTo use these images, either:');
    console.log('1. Reference them as /exercise-demos/[name].jpg in your app');
    console.log('2. Upload to Supabase Storage and update the database');
    console.log('\nSQL to update database with local paths:');
    console.log('UPDATE exercises SET demo_gif_url = \'/exercise-demos/barbell-bench-press.jpg\' WHERE name = \'Barbell Bench Press\';');
  }
}

main().catch(console.error);
