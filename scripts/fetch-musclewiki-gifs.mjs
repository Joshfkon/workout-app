#!/usr/bin/env node
/**
 * Script to fetch exercise GIFs from MuscleWiki API via RapidAPI
 *
 * Usage: 
 *   RAPIDAPI_KEY=your-key node scripts/fetch-musclewiki-gifs.mjs
 *   OR
 *   node scripts/fetch-musclewiki-gifs.mjs your-api-key
 *
 * Source: https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb
 * Requires RapidAPI key (free tier available)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get API key from environment variable or command line argument
const API_KEY = process.env.RAPIDAPI_KEY || process.argv[2];

if (!API_KEY) {
  console.error('❌ Error: RapidAPI key required!');
  console.error('');
  console.error('Usage:');
  console.error('  RAPIDAPI_KEY=your-key node scripts/fetch-musclewiki-gifs.mjs');
  console.error('  OR');
  console.error('  node scripts/fetch-musclewiki-gifs.mjs your-api-key');
  console.error('');
  console.error('Get your free API key at: https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb');
  process.exit(1);
}

// MuscleWiki API endpoint (via RapidAPI)
const MUSCLEWIKI_API_URL = 'https://musclewiki-api.p.rapidapi.com';
const API_HOST = 'musclewiki-api.p.rapidapi.com';

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

async function searchMuscleWiki(exerciseName) {
  const searchTerms = EXERCISE_MAPPINGS[exerciseName] || [exerciseName.toLowerCase()];
  
  for (const term of searchTerms) {
    try {
      // Use the /search endpoint for better relevance matching
      const searchResponse = await fetch(`${MUSCLEWIKI_API_URL}/search?q=${encodeURIComponent(term)}&limit=5`, {
        headers: {
          'X-RapidAPI-Key': API_KEY,
          'X-RapidAPI-Host': API_HOST
        }
      });
      
      if (!searchResponse.ok) {
        if (searchResponse.status === 401 || searchResponse.status === 403) {
          console.error(`❌ Authentication failed. Check your API key.`);
          process.exit(1);
        }
        continue;
      }
      
      const exercises = await searchResponse.json();
      
      if (!Array.isArray(exercises) || exercises.length === 0) {
        continue;
      }
      
      // Search endpoint returns results sorted by relevance
      // Find exact match first, then use first result (already sorted by relevance)
      const exactMatch = exercises.find(ex => 
        ex.name?.toLowerCase() === term.toLowerCase() ||
        ex.name?.toLowerCase() === exerciseName.toLowerCase()
      );
      
      const exercise = exactMatch || exercises[0];
      
      // Search endpoint already returns full exercise details with videos
      return exercise;
    } catch (err) {
      // Continue to next search term
      continue;
    }
  }
  
  return null;
}

async function downloadVideo(videoUrl, outputPath, apiKey) {
  const response = await fetch(videoUrl, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': API_HOST
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${videoUrl}: ${response.statusText}`);
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

  console.log('🎬 Fetching exercise videos from MuscleWiki API (via RapidAPI)...\n');

  const results = { success: [], failed: [] };

  for (const [ourName, searchTerms] of Object.entries(EXERCISE_MAPPINGS)) {
    try {
      console.log(`🔍 Searching for: ${ourName}...`);
      
      const exercise = await searchMuscleWiki(ourName);
      
      if (!exercise) {
        console.log(`⚠️  Not found: ${ourName}`);
        results.failed.push(ourName);
        continue;
      }

      // MuscleWiki API structure: exercises have a 'videos' array with video URLs
      // Download the MP4 video files (not just images)
      let videoUrl = null;
      
      if (exercise.videos && Array.isArray(exercise.videos) && exercise.videos.length > 0) {
        // Prefer front view, male if available, otherwise take first
        const frontView = exercise.videos.find(v => v.angle === 'front' && v.gender === 'male') ||
                         exercise.videos.find(v => v.angle === 'front') ||
                         exercise.videos[0];
        
        videoUrl = frontView?.url;
      }
      
      if (!videoUrl) {
        console.log(`⚠️  No video URL found for: ${ourName} (found exercise: ${exercise.name || 'unknown'})`);
        console.log(`   Available fields: ${Object.keys(exercise).join(', ')}`);
        if (exercise.videos) {
          console.log(`   Videos array length: ${exercise.videos.length}`);
          console.log(`   First video:`, JSON.stringify(exercise.videos[0], null, 2));
        }
        results.failed.push(ourName);
        continue;
      }

      // Save as .mp4 (these are video files)
      const fileName = `${ourName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.mp4`;
      const localPath = path.join(outputDir, fileName);

      console.log(`📥 Downloading video: ${ourName}...`);
      console.log(`   URL: ${videoUrl}`);
      await downloadVideo(videoUrl, localPath, API_KEY);
      console.log(`✅ Saved: ${fileName}\n`);

      results.success.push(ourName);
      
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      console.error(`❌ Failed: ${ourName} - ${err.message}\n`);
      results.failed.push(ourName);
    }
  }

  // Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`✅ Success: ${results.success.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);
  console.log(`\n📁 Videos saved to: ${outputDir}`);

  // Generate SQL for updating database
  if (results.success.length > 0) {
    const sqlFile = path.join(outputDir, 'update-urls-musclewiki.sql');
    let sql = '-- SQL to update database with MuscleWiki videos\n';
    sql += '-- Run this in Supabase SQL Editor after downloading videos\n';
    sql += '-- Note: These are MP4 video files - update frontend to use <video> tags\n\n';
    
    for (const exerciseName of results.success) {
      const fileName = `${exerciseName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.mp4`;
      sql += `UPDATE exercises SET demo_gif_url = '/exercise-demos/${fileName}' WHERE name = '${exerciseName}';\n`;
    }
    
    fs.writeFileSync(sqlFile, sql);
    console.log(`\n📝 SQL file generated: ${sqlFile}`);
  }
  
  if (results.failed.length > 0) {
    console.log(`\n⚠️  Failed exercises: ${results.failed.join(', ')}`);
    console.log('   These may need manual search or different search terms.');
  }
}

main().catch(console.error);
