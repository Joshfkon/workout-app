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

// Map our exercise names to MuscleWiki search terms
// Priority: simpler, more generic terms first (MuscleWiki uses simpler naming)
const EXERCISE_MAPPINGS = {
  // Chest
  'Barbell Bench Press': ['bench press', 'barbell bench press'],
  'Dumbbell Bench Press': ['dumbbell press', 'dumbbell bench press'],
  'Incline Barbell Press': ['incline press', 'incline bench press'],
  'Incline Dumbbell Press': ['incline press', 'incline dumbbell press'],
  'Cable Fly': ['cable fly', 'pec fly', 'cable crossover'],
  'Dips (Chest Focus)': ['dips', 'chest dips'],
  'Machine Chest Press': ['chest press', 'machine chest press', 'pec deck'],
  'Pec Deck': ['pec deck', 'pec fly'],
  'Smith Machine Bench Press': ['bench press', 'smith machine bench press'],
  'Smith Machine Incline Press': ['incline press', 'smith machine incline press'],
  'Decline Barbell Press': ['decline press', 'decline bench press'],
  'Seated Cable Fly': ['cable fly', 'seated cable fly'],
  
  // Back
  'Barbell Row': ['barbell row', 'bent over row', 'row'],
  'Dumbbell Row': ['dumbbell row', 'one arm row', 'row'],
  'Lat Pulldown': ['lat pulldown', 'pulldown'],
  'Pull-Ups': ['pull up', 'pullup', 'chin up'],
  'Pull-Up': ['pull up', 'pullup', 'chin up'],
  'Cable Row': ['cable row', 'seated row', 'row'],
  'Deadlift': ['deadlift'],
  'Chest Supported Row': ['chest supported row', 'row'],
  'Seated Machine Row': ['seated row', 'machine row', 'row'],
  'Assisted Pull-Up Machine': ['assisted pull up', 'assisted pullup'],
  'Assisted Pull-Up': ['assisted pull up', 'assisted pullup'],
  'Straight Arm Pulldown': ['straight arm pulldown', 'pulldown'],
  'Close Grip Lat Pulldown': ['close grip pulldown', 'lat pulldown'],
  'Back Extension': ['back extension', 'hyperextension'],
  'Meadows Row': ['meadows row', 'landmine row', 'row'],
  'Romanian Deadlift': ['romanian deadlift', 'rdl', 'deadlift'],
  'Stiff Leg Deadlift': ['stiff leg deadlift', 'deadlift'],
  'Sumo Deadlift': ['sumo deadlift', 'deadlift'],
  
  // Shoulders
  'Overhead Press': ['overhead press', 'shoulder press', 'military press'],
  'Standing Overhead Press': ['overhead press', 'shoulder press'],
  'Lateral Raise': ['lateral raise', 'side raise'],
  'Rear Delt Fly': ['rear delt fly', 'rear delt raise'],
  'Dumbbell Shoulder Press': ['shoulder press', 'dumbbell press'],
  'Face Pull': ['face pull'],
  'Rear Delt Machine': ['rear delt machine', 'rear delt fly'],
  'Machine Lateral Raise': ['lateral raise', 'machine lateral raise'],
  'Smith Machine Shoulder Press': ['shoulder press', 'smith machine shoulder press'],
  'Upright Row': ['upright row', 'row'],
  'Cable Upright Row': ['upright row', 'cable upright row', 'row'],
  'Front Raise': ['front raise'],
  'Behind-the-Back Cable Lateral Raise': ['lateral raise', 'rear lateral raise'],
  'Cable Y-Raise': ['y raise', 'cable y raise'],
  'Reverse Cable Crossover': ['reverse cable crossover', 'rear delt fly'],
  'Cable Cross Body Lateral Raise': ['lateral raise', 'cross body raise'],
  'Barbell Shrug': ['shrug', 'barbell shrug'],
  'Reverse Fly': ['reverse fly', 'rear delt fly'],
  
  // Legs - Quads
  'Barbell Back Squat': ['squat', 'back squat'],
  'Leg Press': ['leg press'],
  'Leg Extension': ['leg extension'],
  'Dumbbell Lunges': ['lunge', 'dumbbell lunge'],
  'Walking Lunges': ['lunge', 'walking lunge'],
  'Bulgarian Split Squat': ['bulgarian split squat', 'split squat', 'squat'],
  'Hack Squat': ['hack squat', 'squat'],
  'Goblet Squat': ['goblet squat', 'squat'],
  'Smith Machine Squat': ['squat', 'smith machine squat'],
  'Pendulum Squat': ['pendulum squat', 'squat'],
  'Sissy Squat': ['sissy squat', 'squat'],
  'Reverse Lunge': ['lunge', 'reverse lunge'],
  'Step Up': ['step up'],
  'Incline Leg Press': ['leg press', 'incline leg press'],
  
  // Legs - Hamstrings
  'Lying Leg Curl': ['leg curl', 'lying leg curl'],
  'Seated Leg Curl': ['leg curl', 'seated leg curl'],
  'Single Leg RDL': ['single leg rdl', 'romanian deadlift'],
  'Nordic Curl': ['nordic curl', 'nordic hamstring curl'],
  
  // Glutes
  'Cable Pull Through': ['pull through', 'cable pull through'],
  'Glute Bridge': ['glute bridge', 'hip bridge'],
  'Hip Thrust': ['hip thrust', 'barbell hip thrust'],
  'Glute Drive Machine': ['hip thrust', 'glute drive machine'],
  'Hip Abduction Machine': ['hip abduction', 'abductor machine'],
  'Hip Adduction Machine': ['hip adduction', 'adductor machine'],
  'Single Leg Hip Thrust': ['hip thrust', 'single leg hip thrust'],
  
  // Calves
  'Calf Raise': ['calf raise'],
  'Standing Calf Raise': ['calf raise', 'standing calf raise'],
  'Seated Calf Raise': ['calf raise', 'seated calf raise'],
  'Leg Press Calf Raise': ['calf raise', 'leg press calf raise'],
  'Smith Machine Calf Raise': ['calf raise', 'smith machine calf raise'],
  'Donkey Calf Raise': ['calf raise', 'donkey calf raise'],
  'Calf Press Machine': ['calf raise', 'calf press'],
  
  // Arms - Biceps
  'Barbell Curl': ['barbell curl', 'curl'],
  'Dumbbell Curl': ['dumbbell curl', 'bicep curl', 'curl'],
  'Hammer Curl': ['hammer curl', 'curl'],
  'Cable Curl': ['cable curl', 'curl'],
  'Cable Bicep Curl': ['cable curl', 'bicep curl', 'curl'],
  'Incline Dumbbell Curl': ['incline curl', 'dumbbell curl', 'curl'],
  'Preacher Curl': ['preacher curl', 'curl'],
  'Machine Bicep Curl': ['bicep curl', 'machine curl', 'curl'],
  'Concentration Curl': ['concentration curl', 'curl'],
  'EZ Bar Curl': ['ez bar curl', 'curl'],
  'Bayesian Cable Curl': ['cable curl', 'bayesian curl', 'curl'],
  '45° Preacher Curl': ['preacher curl', 'curl'],
  
  // Arms - Triceps
  'Tricep Pushdown': ['tricep pushdown', 'tricep extension'],
  'Skull Crusher': ['skull crusher', 'lying tricep extension'],
  'Close Grip Bench Press': ['barbell close grip bench press', 'close grip bench press', 'close grip press'],
  'Close-Grip Bench Press': ['barbell close grip bench press', 'close grip bench press', 'close grip press'],
  'Bench Press - Close Grip (Barbell)': ['barbell close grip bench press', 'close grip bench press', 'close grip press'],
  'Dips (Tricep Focus)': ['dips', 'tricep dips'],
  'Dip': ['dips'],
  'Overhead Tricep Extension': ['overhead tricep extension', 'tricep extension'],
  'Machine Tricep Extension': ['tricep extension', 'machine tricep extension'],
  'Rope Tricep Pushdown': ['tricep pushdown', 'rope pushdown'],
  'Assisted Dip Machine': ['dips', 'assisted dips'],
  'Dumbbell Kickback': ['tricep kickback', 'dumbbell kickback'],
  'Cable Overhead Tricep Extension': ['overhead tricep extension', 'tricep extension'],
  'Cable Tricep Pushdown': ['tricep pushdown', 'cable pushdown'],
  'Katana Tricep Extension': ['tricep extension', 'katana extension'],
  
  // Abs
  'Cable Crunch': ['cable crunch', 'crunch'],
  'Hanging Leg Raise': ['hanging leg raise', 'leg raise'],
  'Ab Wheel Rollout': ['ab wheel', 'ab wheel rollout'],
  'Plank': ['plank'],
  'Machine Ab Crunch': ['ab crunch', 'crunch'],
  'Decline Crunch': ['crunch', 'decline crunch'],
  'Captain\'s Chair Leg Raise': ['leg raise', 'captains chair'],
  'Pallof Press': ['pallof press'],
  'Dead Bug': ['dead bug'],
  'Russian Twist': ['russian twist'],
  'Cable Woodchop': ['woodchop', 'cable woodchop'],
  'Hammer Strength Ab Crunch': ['ab crunch', 'crunch'],
  
  // Functional
  'Farmer\'s Carry': ['farmers carry', 'farmer walk'],
  'Suitcase Carry': ['suitcase carry'],
  'Good Morning': ['good morning'],
  
  // Push-ups
  'Push-Up': ['push up', 'pushup'],
};

// Helper to generate simplified search terms for exercises not in mappings
function generateSimplifiedSearchTerms(exerciseName) {
  const terms = [];
  const lower = exerciseName.toLowerCase();
  
  // Handle patterns like "Bench Press - Close Grip (Barbell)" or "Exercise - Modifier (Equipment)"
  let simplified = exerciseName
    .replace(/\(.*?\)/g, '') // Remove parentheses like "(Barbell)" or "(Chest Focus)"
    .replace(/\s*-\s*/g, ' ') // Replace dashes with spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  // Extract equipment from parentheses if present
  const equipmentMatch = exerciseName.match(/\(([^)]+)\)/);
  const equipment = equipmentMatch ? equipmentMatch[1].toLowerCase() : null;
  
  // Try to reorder to match MuscleWiki pattern: Equipment + Modifier + Exercise
  // Pattern detection: "Close Grip Bench Press" -> "Barbell Close Grip Bench Press"
  // Or "Bench Press - Close Grip (Barbell)" -> "Barbell Close Grip Bench Press"
  
  // Common exercise base names
  const exerciseBases = ['bench press', 'squat', 'deadlift', 'row', 'press', 'curl', 'extension', 'raise', 'lunge', 'pulldown', 'fly'];
  const modifiers = ['close grip', 'wide grip', 'incline', 'decline', 'seated', 'standing', 'lying', 'reverse', 'single leg', 'bulgarian'];
  
  // Check if we have a modifier + exercise pattern
  for (const modifier of modifiers) {
    for (const base of exerciseBases) {
      if (simplified.toLowerCase().includes(modifier) && simplified.toLowerCase().includes(base)) {
        // Found pattern like "Close Grip Bench Press"
        // Try to construct MuscleWiki format: Equipment + Modifier + Exercise
        if (equipment) {
          terms.push(`${equipment} ${modifier} ${base}`);
        }
        // Also try with common equipment if not specified
        if (base.includes('bench press') || base.includes('press') || base.includes('row')) {
          terms.push(`barbell ${modifier} ${base}`);
          terms.push(`dumbbell ${modifier} ${base}`);
        }
        // Add the simplified version
        terms.push(`${modifier} ${base}`);
        break;
      }
    }
  }
  
  // Remove equipment prefixes for simpler search
  simplified = simplified
    .replace(/^(barbell|dumbbell|machine|cable|smith machine|incline|decline|seated|standing|lying|assisted)\s+/i, '')
    .trim();
  
  if (simplified && simplified.toLowerCase() !== lower) {
    terms.push(simplified.toLowerCase());
  }
  
  // Add the full name
  terms.push(lower);
  
  // Add common base terms
  if (simplified.includes('Press')) terms.push('press');
  if (simplified.includes('Squat')) terms.push('squat');
  if (simplified.includes('Deadlift')) terms.push('deadlift');
  if (simplified.includes('Row')) terms.push('row');
  if (simplified.includes('Curl')) terms.push('curl');
  if (simplified.includes('Extension')) terms.push('extension');
  if (simplified.includes('Raise')) terms.push('raise');
  if (simplified.includes('Lunge')) terms.push('lunge');
  if (simplified.includes('Pull')) terms.push('pull');
  
  return [...new Set(terms)];
}

// Calculate similarity between two exercise names (0-1, higher is more similar)
function calculateSimilarity(name1, name2) {
  const n1 = name1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const n2 = name2.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  
  // Exact match
  if (n1 === n2) return 1.0;
  
  // Check if one contains the other (high similarity)
  if (n1.includes(n2) || n2.includes(n1)) {
    const shorter = n1.length < n2.length ? n1 : n2;
    const longer = n1.length >= n2.length ? n1 : n2;
    return shorter.length / longer.length;
  }
  
  // Count matching words
  const words1 = new Set(n1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(n2.split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }
  
  // Require at least 2 matching words for decent similarity
  if (matches < 2) return 0;
  
  // Calculate Jaccard similarity
  const union = new Set([...words1, ...words2]);
  return matches / union.size;
}

// Validate that a matched exercise is actually similar to what we're looking for
function isValidMatch(ourExerciseName, matchedExerciseName) {
  const similarity = calculateSimilarity(ourExerciseName, matchedExerciseName);
  
  // Require at least 0.4 similarity (40% word overlap) for a valid match
  if (similarity < 0.4) {
    return false;
  }
  
  // Additional checks: ensure key words match
  const ourLower = ourExerciseName.toLowerCase();
  const matchedLower = matchedExerciseName.toLowerCase();
  
  // Extract key movement words
  const keyWords = ['bench', 'squat', 'deadlift', 'row', 'press', 'curl', 'extension', 'raise', 'lunge', 'pulldown', 'fly', 'dip'];
  const ourKeyWords = keyWords.filter(w => ourLower.includes(w));
  const matchedKeyWords = keyWords.filter(w => matchedLower.includes(w));
  
  // If we have key words, at least one should match
  if (ourKeyWords.length > 0 && matchedKeyWords.length > 0) {
    const hasCommonKeyWord = ourKeyWords.some(w => matchedKeyWords.includes(w));
    if (!hasCommonKeyWord) {
      return false;
    }
  }
  
  // Check for conflicting key words (e.g., "bench press" shouldn't match "overhead press")
  const conflictingPairs = [
    ['bench', 'overhead'],
    ['bench', 'shoulder'],
    ['bicep', 'tricep'],
    ['curl', 'extension'],
    ['squat', 'deadlift'],
    ['row', 'pulldown'], // These are related but different enough
  ];
  
  for (const [word1, word2] of conflictingPairs) {
    const hasWord1 = ourLower.includes(word1) && matchedLower.includes(word2);
    const hasWord2 = ourLower.includes(word2) && matchedLower.includes(word1);
    if (hasWord1 || hasWord2) {
      // Unless both exercises have the same modifier (e.g., "close grip bench" vs "close grip overhead")
      const ourModifiers = ['close grip', 'wide grip', 'incline', 'decline'];
      const hasSharedModifier = ourModifiers.some(m => ourLower.includes(m) && matchedLower.includes(m));
      if (!hasSharedModifier) {
        return false;
      }
    }
  }
  
  return true;
}

async function searchMuscleWiki(exerciseName) {
  const searchTerms = EXERCISE_MAPPINGS[exerciseName] || generateSimplifiedSearchTerms(exerciseName);
  
  // Track best match across all search terms
  let bestMatch = null;
  let bestSimilarity = 0;
  let bestTerm = null;
  
  for (const term of searchTerms) {
    try {
      // Use the /search endpoint for better relevance matching
      const searchUrl = `${MUSCLEWIKI_API_URL}/search?q=${encodeURIComponent(term)}&limit=5`;
      const searchResponse = await fetch(searchUrl, {
        headers: {
          'X-RapidAPI-Key': API_KEY,
          'X-RapidAPI-Host': API_HOST
        }
      });
      
      if (!searchResponse.ok) {
        // Only exit on auth errors for the first exercise, otherwise just log and continue
        if (searchResponse.status === 401 || searchResponse.status === 403) {
          const errorText = await searchResponse.text().catch(() => 'Unable to read error');
          console.error(`❌ Authentication failed (${searchResponse.status}). Check your API key and subscription.`);
          console.error(`Response: ${errorText.substring(0, 200)}`);
          // Don't exit immediately - might be a temporary issue, try next term
          if (term === searchTerms[0] && searchTerms.length === 1) {
            process.exit(1);
          }
          continue;
        }
        console.log(`   ⚠️  Search returned ${searchResponse.status}, trying next term...`);
        continue;
      }
      
      const exercisesData = await searchResponse.json();
      
      // Handle different response formats
      let exercises = [];
      if (Array.isArray(exercisesData)) {
        exercises = exercisesData;
      } else if (exercisesData.results && Array.isArray(exercisesData.results)) {
        exercises = exercisesData.results;
      } else if (exercisesData.data && Array.isArray(exercisesData.data)) {
        exercises = exercisesData.data;
      }
      
      if (exercises.length === 0) {
        continue;
      }
      
      // Check each result for validity and similarity
      for (const result of exercises) {
        if (!result.name || !result.id) continue;
        
        // Validate the match
        if (!isValidMatch(exerciseName, result.name)) {
          continue;
        }
        
        const similarity = calculateSimilarity(exerciseName, result.name);
        
        // If this is a very good match (high similarity), use it immediately
        if (similarity >= 0.7) {
          // Get detailed exercise info by ID
          const detailResponse = await fetch(`${MUSCLEWIKI_API_URL}/exercises/${result.id}?gender=male`, {
            headers: {
              'X-RapidAPI-Key': API_KEY,
              'X-RapidAPI-Host': API_HOST
            }
          });
          
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            console.log(`   ✓ Matched: "${result.name}" (similarity: ${(similarity * 100).toFixed(0)}%, term: "${term}")`);
            return detailData;
          }
        }
        
        // Track best match so far
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = result;
          bestTerm = term;
        }
      }
    } catch (err) {
      continue;
    }
  }
  
  // If we found a reasonable match, use it (but require higher threshold)
  if (bestMatch && bestSimilarity >= 0.5) {
    const detailResponse = await fetch(`${MUSCLEWIKI_API_URL}/exercises/${bestMatch.id}?gender=male`, {
      headers: {
        'X-RapidAPI-Key': API_KEY,
        'X-RapidAPI-Host': API_HOST
      }
    });
    
    if (detailResponse.ok) {
      const detailData = await detailResponse.json();
      console.log(`   ⚠️  Best match: "${bestMatch.name}" (similarity: ${(bestSimilarity * 100).toFixed(0)}%, term: "${bestTerm}")`);
      return detailData;
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
      // Escape single quotes in exercise names for SQL (double them)
      const escapedName = exerciseName.replace(/'/g, "''");
      sql += `UPDATE exercises SET demo_gif_url = '/exercise-demos/${fileName}' WHERE name = '${escapedName}';\n`;
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
