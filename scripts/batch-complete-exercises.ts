/**
 * Batch AI Exercise Completion Script
 * 
 * Runs AI completion on all existing exercises that are missing metadata.
 * This will fill in missing fields like form cues, hypertrophy scores, etc.
 * 
 * Usage:
 *   npx tsx scripts/batch-complete-exercises.ts
 * 
 * Or run in Node.js:
 *   node --loader ts-node/esm scripts/batch-complete-exercises.ts
 */

import { createClient } from '@/lib/supabase/server';
import { completeExerciseWithAI } from '@/lib/actions/exercise-completion';
import { getExercises } from '@/services/exerciseService';
import type { BasicExerciseInput } from '@/lib/exercises/types';

interface ExerciseUpdate {
  id: string;
  name: string;
  primary_muscle: string;
  equipment?: string;
  equipment_required?: string[];
  [key: string]: any;
}

async function batchCompleteExercises() {
  console.log('🚀 Starting batch AI exercise completion...\n');

  try {
    // Get all exercises
    const exercises = await getExercises(false); // Exclude custom exercises
    console.log(`📋 Found ${exercises.length} exercises to process\n`);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('Not authenticated. Please ensure you are logged in.');
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Process exercises in batches to avoid rate limits
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

    for (let i = 0; i < exercises.length; i += BATCH_SIZE) {
      const batch = exercises.slice(i, i + BATCH_SIZE);
      
      console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} exercises)...`);

      for (const exercise of batch) {
        try {
          processed++;
          
          // Check if exercise already has complete metadata
          const hasFormCues = exercise.formCues && exercise.formCues.length > 0;
          const hasHypertrophyScore = exercise.hypertrophyScore?.tier;
          
          if (hasFormCues && hasHypertrophyScore) {
            console.log(`  ⏭️  Skipping "${exercise.name}" - already has complete metadata`);
            skipped++;
            continue;
          }

          console.log(`  🤖 Processing "${exercise.name}"...`);

          // Prepare input for AI completion
          const input: BasicExerciseInput = {
            name: exercise.name,
            primaryMuscle: exercise.primaryMuscle,
            equipment: exercise.equipment || 'barbell',
            description: exercise.notes,
          };

          // Call AI completion
          const result = await completeExerciseWithAI(input);

          if (!result.success || !result.data) {
            console.log(`  ❌ Failed to complete "${exercise.name}": ${result.error || 'Unknown error'}`);
            errors++;
            continue;
          }

          const completed = result.data;

          // Update exercise in database
          const updateData: Partial<ExerciseUpdate> = {};

          // Only update fields that are missing or empty
          if (!hasFormCues && completed.formCues && completed.formCues.length > 0) {
            updateData.form_cues = completed.formCues;
          }

          if (!hasHypertrophyScore && completed.hypertrophyScore) {
            updateData.hypertrophy_tier = completed.hypertrophyScore.tier;
            updateData.stretch_under_load = completed.hypertrophyScore.stretchUnderLoad;
            updateData.resistance_profile = completed.hypertrophyScore.resistanceProfile;
            updateData.progression_ease = completed.hypertrophyScore.progressionEase;
          }

          // Update other missing fields
          if (!exercise.secondaryMuscles?.length && completed.secondaryMuscles?.length) {
            updateData.secondary_muscles = completed.secondaryMuscles;
          }

          if (!exercise.stabilizers?.length && completed.stabilizers?.length) {
            updateData.stabilizers = completed.stabilizers;
          }

          if (!exercise.spinalLoading && completed.spinalLoading) {
            updateData.spinal_loading = completed.spinalLoading;
          }

          if (completed.contraindications?.length) {
            updateData.contraindications = completed.contraindications;
          }

          if (completed.commonMistakes?.length) {
            updateData.common_mistakes = completed.commonMistakes;
          }

          if (completed.setupNote) {
            updateData.setup_note = completed.setupNote;
          }

          // Only update if we have fields to update
          if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabase
              .from('exercises')
              .update(updateData)
              .eq('id', exercise.id);

            if (updateError) {
              console.log(`  ❌ Failed to update "${exercise.name}": ${updateError.message}`);
              errors++;
            } else {
              console.log(`  ✅ Updated "${exercise.name}" with ${Object.keys(updateData).length} fields`);
              updated++;
            }
          } else {
            console.log(`  ⏭️  No updates needed for "${exercise.name}"`);
            skipped++;
          }

          // Small delay between exercises to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (err: any) {
          console.log(`  ❌ Error processing "${exercise.name}": ${err.message}`);
          errors++;
        }
      }

      // Delay between batches
      if (i + BATCH_SIZE < exercises.length) {
        console.log(`\n⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Batch Completion Summary:');
    console.log(`   Total exercises: ${exercises.length}`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);
    console.log('='.repeat(50));

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
batchCompleteExercises()
  .then(() => {
    console.log('\n✅ Batch completion finished!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

