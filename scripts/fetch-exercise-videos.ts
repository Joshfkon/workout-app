/**
 * Script to fetch exercise videos from MuscleWiki and upload to Supabase Storage
 *
 * Usage: npx ts-node scripts/fetch-exercise-videos.ts
 *
 * This script:
 * 1. Fetches exercise data from MuscleWiki API
 * 2. Downloads the video/GIF files
 * 3. Uploads them to Supabase Storage
 * 4. Updates the exercises table with the new URLs
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// MuscleWiki API endpoint (publicly available)
const MUSCLEWIKI_API = 'https://musclewiki.com/newapi/exercise/exercises/';

// Exercise name mappings (our DB name -> MuscleWiki search term)
const EXERCISE_MAPPINGS: Record<string, string> = {
  'Barbell Bench Press': 'Barbell Bench Press',
  'Dumbbell Bench Press': 'Dumbbell Bench Press',
  'Incline Dumbbell Press': 'Dumbbell Incline Bench Press',
  'Pull-Ups': 'Pull Up',
  'Lat Pulldown': 'Cable Lat Pulldown',
  'Barbell Row': 'Barbell Bent Over Row',
  'Deadlift': 'Barbell Deadlift',
  'Barbell Back Squat': 'Barbell Squat',
  'Leg Press': 'Sled Leg Press',
  'Romanian Deadlift': 'Barbell Romanian Deadlift',
  'Overhead Press': 'Barbell Overhead Press',
  'Lateral Raise': 'Dumbbell Lateral Raise',
  'Barbell Curl': 'Barbell Curl',
  'Tricep Pushdown': 'Cable Pushdown',
};

interface MuscleWikiExercise {
  id: number;
  name: string;
  video_url?: string;
  video_front_url?: string;
  video_side_url?: string;
  image_url?: string;
}

async function fetchMuscleWikiExercises(): Promise<MuscleWikiExercise[]> {
  console.log('Fetching exercises from MuscleWiki API...');

  const response = await fetch(MUSCLEWIKI_API);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }

  const data = await response.json();
  return data.results || data;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

async function uploadToSupabase(
  supabase: any,
  filePath: string,
  storagePath: string
): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const contentType = filePath.endsWith('.mp4') ? 'video/mp4' : 'image/gif';

  const { data, error } = await supabase.storage
    .from('exercise-demos')
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('exercise-demos')
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

async function main() {
  // Check for environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.log('\nTo use this script:');
    console.log('1. Set your environment variables');
    console.log('2. Run: npx ts-node scripts/fetch-exercise-videos.ts');
    console.log('\nAlternatively, manually download videos from:');
    console.log('https://musclewiki.com/exercises');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Create temp directory for downloads
  const tempDir = path.join(__dirname, '../temp-videos');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Fetch MuscleWiki exercises
    const muscleWikiExercises = await fetchMuscleWikiExercises();
    console.log(`Found ${muscleWikiExercises.length} exercises on MuscleWiki`);

    // Process each of our mapped exercises
    for (const [ourName, wikiName] of Object.entries(EXERCISE_MAPPINGS)) {
      const wikiExercise = muscleWikiExercises.find(
        (e) => e.name.toLowerCase() === wikiName.toLowerCase()
      );

      if (!wikiExercise) {
        console.log(`⚠️  Not found on MuscleWiki: ${ourName}`);
        continue;
      }

      const videoUrl = wikiExercise.video_front_url || wikiExercise.video_url;
      if (!videoUrl) {
        console.log(`⚠️  No video for: ${ourName}`);
        continue;
      }

      console.log(`📥 Downloading: ${ourName}...`);

      // Download the video
      const ext = videoUrl.endsWith('.gif') ? 'gif' : 'mp4';
      const fileName = `${ourName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${ext}`;
      const localPath = path.join(tempDir, fileName);

      await downloadFile(videoUrl, localPath);

      // Upload to Supabase
      console.log(`📤 Uploading: ${fileName}...`);
      const publicUrl = await uploadToSupabase(supabase, localPath, fileName);

      // Update database
      const { error: updateError } = await supabase
        .from('exercises')
        .update({ demo_gif_url: publicUrl })
        .eq('name', ourName);

      if (updateError) {
        console.error(`❌ Failed to update ${ourName}: ${updateError.message}`);
      } else {
        console.log(`✅ Updated: ${ourName}`);
      }

      // Clean up temp file
      fs.unlinkSync(localPath);
    }

    console.log('\n✨ Done! Exercise videos have been uploaded to Supabase Storage.');

  } finally {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir, { recursive: true });
    }
  }
}

main().catch(console.error);
