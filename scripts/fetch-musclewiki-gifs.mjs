#!/usr/bin/env node
/**
 * Script to fetch exercise GIFs from MuscleWiki API
 *
 * Usage: node scripts/fetch-musclewiki-gifs.mjs
 *
 * Source: https://api.musclewiki.com (MuscleWiki API)
 * MuscleWiki provides animated GIFs for exercises
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MuscleWiki API endpoint
const MUSCLEWIKI_API_URL = 'https://api.musclewiki.com';

// Map our exercise names to MuscleWiki search terms
// MuscleWiki uses fuzzy search, so we provide common names
const EXERCISE_MAPPINGS = {
  // Chest
  'Barbell Bench Press': ['barbell bench press', 'bench press', 'chest press'],
  'Dumbbell Bench Press': ['dumbbell bench press', 'db bench press'],
  'Incline Dumbbell Press': ['incline dumbbell press', 'incline press'],
  'Cable Fly': ['cable fly', 'cable crossover', 'pec fly'],
  'Dips (Chest Focus)': ['dips', 'chest dips', 'dip'],
  
  // Back
  'Barbell Row': ['barbell row', 'bent over row', 'row'],
  'Dumbbell Row': ['dumbbell row', 'one arm row', 'db row'],
  'Lat Pulldown': ['lat pulldown', 'lat pull down', 'pulldown'],
  'Pull-Ups': ['pull up', 'pullup', 'chin up'],
  'Cable Row': ['cable row', 'seated row', 'row machine'],
  'Deadlift': ['deadlift', 'conventional deadlift'],
  
  // Shoulders
  'Overhead Press': ['overhead press', 'ohp', 'military press', 'shoulder press'],
  'Lateral Raise': ['lateral raise', 'side raise', 'side lateral raise'],
  'Rear Delt Fly': ['rear delt fly', 'rear delt raise', 'rear fly'],
  
  // Legs
  'Barbell Back Squat': ['squat', 'barbell squat', 'back squat'],
  'Leg Press': ['leg press'],
  'Romanian Deadlift': ['romanian deadlift', 'rdl', 'stiff leg deadlift'],
  'Lying Leg Curl': ['lying leg curl', 'leg curl'],
  'Leg Extension': ['leg extension', 'quad extension'],
  'Dumbbell Lunges': ['dumbbell lunge', 'lunge', 'db lunge'],
  'Calf Raise': ['calf raise', 'standing calf raise'],
  
  // Arms
  'Barbell Curl': ['barbell curl', 'bb curl'],
  'Dumbbell Curl': ['dumbbell curl', 'db curl', 'bicep curl'],
  'Hammer Curl': ['hammer curl'],
  'Tricep Pushdown': ['tricep pushdown', 'tricep extension', 'pushdown'],
  'Skull Crushers': ['skull crusher', 'lying tricep extension', 'tricep extension'],
};

async function searchMuscleWiki(exerciseName) {
  // Try each search term until we find a match
  const searchTerms = EXERCISE_MAPPINGS[exerciseName] || [exerciseName.toLowerCase()];
  
  for (const term of searchTerms) {
    try {
      const response = await fetch(`${MUSCLEWIKI_API_URL}/exercises?name=${encodeURIComponent(term)}`);
      if (!response.ok) {
        continue;
      }
      
      const data = await response.json();
      
      // MuscleWiki returns an array of exercises
      if (data && Array.isArray(data) && data.length > 0) {
        // Find the best match (exact name match preferred)
        const exactMatch = data.find(ex => 
          ex.name?.toLowerCase() === term.toLowerCase() ||
          ex.name?.toLowerCase().includes(term.toLowerCase())
        );
        
        return exactMatch || data[0];
      }
    } catch (err) {
      // Continue to next search term
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
  // Create output directory
  const outputDir = path.join(path.dirname(__dirname), 'public', 'exercise-demos');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('🎬 Fetching exercise GIFs from MuscleWiki API...\n');

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

      // MuscleWiki API structure may vary - check common fields
      const gifUrl = exercise.gif || exercise.animation || exercise.image || exercise.gifUrl;
      
      if (!gifUrl) {
        console.log(`⚠️  No GIF URL found for: ${ourName} (found exercise: ${exercise.name || 'unknown'})`);
        results.failed.push(ourName);
        continue;
      }

      const fileName = `${ourName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.gif`;
      const localPath = path.join(outputDir, fileName);

      console.log(`📥 Downloading: ${ourName}...`);
      await downloadGif(gifUrl, localPath);
      console.log(`✅ Saved: ${fileName}\n`);

      results.success.push(ourName);
    } catch (err) {
      console.error(`❌ Failed: ${ourName} - ${err.message}\n`);
      results.failed.push(ourName);
    }
  }

  // Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`✅ Success: ${results.success.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);
  console.log(`\n📁 GIFs saved to: ${outputDir}`);

  // Generate SQL for updating database
  if (results.success.length > 0) {
    const sqlFile = path.join(outputDir, 'update-urls.sql');
    let sql = '-- SQL to update database with MuscleWiki GIFs\n';
    sql += '-- Run this in Supabase SQL Editor after downloading GIFs\n\n';
    
    for (const exerciseName of results.success) {
      const fileName = `${exerciseName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.gif`;
      sql += `UPDATE exercises SET demo_gif_url = '/exercise-demos/${fileName}' WHERE name = '${exerciseName}';\n`;
    }
    
    fs.writeFileSync(sqlFile, sql);
    console.log(`\n📝 SQL file generated: ${sqlFile}`);
  }
}

main().catch(console.error);

