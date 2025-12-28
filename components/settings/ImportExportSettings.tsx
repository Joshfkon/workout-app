'use client';

import { useState, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  parseStrongCSV,
  parseLoseItCSV,
  exportToStrongCSV,
  exportToLoseItCSV,
  type ParsedStrongWorkout,
  type ParsedLoseItEntry,
  type ImportResult,
} from '@/services/importExport';

type ImportSource = 'strong' | 'loseit' | null;

export function ImportExportSettings() {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');
  const [importSource, setImportSource] = useState<ImportSource>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [previewData, setPreviewData] = useState<ParsedStrongWorkout[] | ParsedLoseItEntry[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Progress tracking
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    currentItem: string;
  } | null>(null);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteType, setDeleteType] = useState<'workouts' | 'nutrition' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; count: number } | null>(null);

  // Fix categories state
  const [isFixingCategories, setIsFixingCategories] = useState(false);
  const [fixResult, setFixResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importSource) return;

    setIsProcessing(true);
    setResult(null);

    try {
      const text = await file.text();

      if (importSource === 'strong') {
        const parsed = parseStrongCSV(text);
        setPreviewData(parsed);
      } else if (importSource === 'loseit') {
        const parsed = parseLoseItCSV(text);
        setPreviewData(parsed);
      }
    } catch (error) {
      setResult({
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['Failed to parse file. Make sure it\'s a valid CSV export.'],
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteAll = async (type: 'workouts' | 'nutrition') => {
    setIsDeleting(true);
    setDeleteResult(null);

    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setIsDeleting(false);
      return;
    }

    try {
      if (type === 'workouts') {
        const { data: sessions } = await supabase
          .from('workout_sessions')
          .select('id')
          .eq('user_id', user.id);

        if (sessions && sessions.length > 0) {
          const sessionIds = sessions.map((s: { id: string }) => s.id);

          const { data: blocks } = await supabase
            .from('exercise_blocks')
            .select('id')
            .in('workout_session_id', sessionIds);

          if (blocks && blocks.length > 0) {
            const blockIds = blocks.map((b: { id: string }) => b.id);
            await supabase
              .from('set_logs')
              .delete()
              .in('exercise_block_id', blockIds);
          }

          await supabase
            .from('exercise_blocks')
            .delete()
            .in('workout_session_id', sessionIds);

          await supabase
            .from('workout_sessions')
            .delete()
            .eq('user_id', user.id);

          setDeleteResult({ success: true, count: sessions.length });
        } else {
          setDeleteResult({ success: true, count: 0 });
        }
      } else if (type === 'nutrition') {
        const { data: logs } = await supabase
          .from('nutrition_logs')
          .select('id')
          .eq('user_id', user.id);

        await supabase
          .from('nutrition_logs')
          .delete()
          .eq('user_id', user.id);

        setDeleteResult({ success: true, count: logs?.length || 0 });
      }
    } catch (error) {
      console.error('Delete error:', error);
      setDeleteResult({ success: false, count: 0 });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteType(null);
    }
  };

  const handleFixExerciseCategories = async () => {
    setIsFixingCategories(true);
    setFixResult(null);

    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setFixResult({ success: false, message: 'Not logged in' });
      setIsFixingCategories(false);
      return;
    }

    try {
      const { data: exercises, error: fetchError } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle')
        .eq('is_custom', true)
        .eq('created_by', user.id);

      if (fetchError) throw fetchError;

      if (!exercises || exercises.length === 0) {
        setFixResult({ success: true, message: 'No custom exercises found to fix.' });
        setIsFixingCategories(false);
        return;
      }

      let fixedCount = 0;
      const updates: { id: string; name: string; oldMuscle: string; newMuscle: string }[] = [];

      for (const exercise of exercises) {
        const inferredMuscle = inferMuscleFromName(exercise.name);
        if (inferredMuscle !== exercise.primary_muscle) {
          updates.push({
            id: exercise.id,
            name: exercise.name,
            oldMuscle: exercise.primary_muscle,
            newMuscle: inferredMuscle,
          });
        }
      }

      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('exercises')
          .update({ primary_muscle: update.newMuscle })
          .eq('id', update.id);

        if (!updateError) {
          fixedCount++;
        }
      }

      setFixResult({
        success: true,
        message: `Fixed ${fixedCount} of ${exercises.length} exercises. ${exercises.length - updates.length} were already correct.`
      });
    } catch (error) {
      console.error('Fix categories error:', error);
      setFixResult({ success: false, message: 'Failed to fix exercise categories. Please try again.' });
    } finally {
      setIsFixingCategories(false);
    }
  };

  const handleImport = async () => {
    if (!previewData || !importSource) return;

    setIsProcessing(true);
    setImportProgress({ current: 0, total: previewData.length, currentItem: 'Starting...' });

    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setResult({ success: false, imported: 0, skipped: 0, errors: ['Not logged in'] });
      setIsProcessing(false);
      setImportProgress(null);
      return;
    }

    try {
      if (importSource === 'strong') {
        const workouts = previewData as ParsedStrongWorkout[];
        const errors: string[] = [];

        setImportProgress({ current: 0, total: 5, currentItem: 'Step 1/5: Loading existing exercises...' });

        const exerciseCache: Map<string, string> = new Map();
        const { data: allExercises } = await supabase
          .from('exercises')
          .select('id, name');

        if (allExercises) {
          for (const ex of allExercises as Array<{ id: string; name: string }>) {
            exerciseCache.set(ex.name.toLowerCase().trim(), ex.id);
          }
        }

        setImportProgress({ current: 1, total: 5, currentItem: 'Step 2/5: Creating new exercises...' });

        const uniqueExerciseNames = new Set<string>();
        for (const workout of workouts) {
          for (const exercise of workout.exercises) {
            const nameLower = exercise.name.toLowerCase().trim();
            if (!exerciseCache.has(nameLower)) {
              uniqueExerciseNames.add(exercise.name);
            }
          }
        }

        if (uniqueExerciseNames.size > 0) {
          for (const name of Array.from(uniqueExerciseNames)) {
            try {
              const { data: newEx, error: exError } = await supabase
                .from('exercises')
                .insert({
                  name,
                  primary_muscle: inferMuscleFromName(name),
                  mechanic: inferMechanicFromName(name),
                  movement_pattern: inferMovementPattern(name),
                  is_custom: true,
                  created_by: user.id,
                })
                .select('id, name')
                .single();

              if (exError) {
                const { data: existing } = await supabase
                  .from('exercises')
                  .select('id, name')
                  .ilike('name', name)
                  .single();
                if (existing) {
                  exerciseCache.set(existing.name.toLowerCase().trim(), existing.id);
                }
              } else if (newEx) {
                exerciseCache.set(newEx.name.toLowerCase().trim(), newEx.id);
              }
            } catch {
              // Exercise creation failed, will be skipped
            }
          }
        }

        setImportProgress({ current: 2, total: 5, currentItem: 'Step 3/5: Creating workout sessions...' });

        const validWorkouts: Array<{ workout: ParsedStrongWorkout; date: string }> = [];
        for (const workout of workouts) {
          const workoutDate = parseDate(workout.date);
          if (workoutDate) {
            validWorkouts.push({ workout, date: workoutDate });
          }
        }

        const BATCH_SIZE = 100;
        const sessionMap: Map<string, string> = new Map();

        for (let i = 0; i < validWorkouts.length; i += BATCH_SIZE) {
          const batch = validWorkouts.slice(i, i + BATCH_SIZE);
          const sessionsToInsert = batch.map(({ workout, date }) => ({
            user_id: user.id,
            planned_date: date,
            state: 'completed',
            started_at: date,
            completed_at: date,
            session_notes: workout.notes || null,
            completion_percent: 100,
          }));

          const { data: sessions } = await supabase
            .from('workout_sessions')
            .insert(sessionsToInsert)
            .select('id');

          if (sessions) {
            sessions.forEach((session: { id: string }, idx: number) => {
              const key = `${batch[idx].workout.date}_${batch[idx].workout.workoutName}`;
              sessionMap.set(key, session.id);
            });
          }
        }

        setImportProgress({ current: 3, total: 5, currentItem: 'Step 4/5: Creating exercise blocks...' });

        const allBlocks: Array<{
          workout_session_id: string;
          exercise_id: string;
          order: number;
          target_sets: number;
          target_rep_range: number[];
          target_rir: number;
          _workout_key: string;
          _exercise_name: string;
          _valid_sets: Array<{ weight: number; weightUnit: 'kg' | 'lb'; reps: number; rpe?: number; isWarmup?: boolean }>;
        }> = [];

        for (const { workout } of validWorkouts) {
          const key = `${workout.date}_${workout.workoutName}`;
          const sessionId = sessionMap.get(key);
          if (!sessionId) continue;

          let order = 1;
          for (const exercise of workout.exercises) {
            if (!exercise.sets) continue;

            const validSets = exercise.sets.filter(s => s.reps && s.reps >= 1);
            if (validSets.length === 0) continue;

            const exerciseId = exerciseCache.get(exercise.name.toLowerCase().trim());
            if (!exerciseId) continue;

            allBlocks.push({
              workout_session_id: sessionId,
              exercise_id: exerciseId,
              order: order++,
              target_sets: validSets.length,
              target_rep_range: [8, 12],
              target_rir: 2,
              _workout_key: key,
              _exercise_name: exercise.name,
              _valid_sets: validSets,
            });
          }
        }

        const blockMap: Map<string, string> = new Map();

        for (let i = 0; i < allBlocks.length; i += BATCH_SIZE) {
          const batch = allBlocks.slice(i, i + BATCH_SIZE);
          const blocksToInsert = batch.map(({ _workout_key, _exercise_name, _valid_sets, ...block }) => block);

          const { data: blocks } = await supabase
            .from('exercise_blocks')
            .insert(blocksToInsert)
            .select('id');

          if (blocks) {
            blocks.forEach((block: { id: string }, idx: number) => {
              const original = batch[idx];
              blockMap.set(`${original.workout_session_id}_${original._exercise_name.toLowerCase()}`, block.id);
            });
          }
        }

        setImportProgress({ current: 4, total: 5, currentItem: 'Step 5/5: Creating set logs...' });

        const allSetLogs: Array<{
          exercise_block_id: string;
          set_number: number;
          weight_kg: number;
          reps: number;
          rpe: number;
          is_warmup: boolean;
          logged_at: string;
        }> = [];

        for (const block of allBlocks) {
          const blockId = blockMap.get(`${block.workout_session_id}_${block._exercise_name.toLowerCase()}`);
          if (!blockId) continue;

          const datePart = block._workout_key.split('_')[0];
          const parsedDate = new Date(datePart);
          const date = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();

          let setNumber = 1;
          for (const set of block._valid_sets) {
            if (!set.reps || set.reps < 1) continue;

            const weightKg = set.weightUnit === 'lb' ? set.weight / 2.20462 : set.weight;
            const rpeValue = set.rpe && set.rpe >= 1 && set.rpe <= 10 ? set.rpe : 7;
            allSetLogs.push({
              exercise_block_id: blockId,
              set_number: setNumber++,
              weight_kg: Math.max(0, weightKg || 0),
              reps: set.reps,
              rpe: rpeValue,
              is_warmup: set.isWarmup || false,
              logged_at: date,
            });
          }
        }

        for (let i = 0; i < allSetLogs.length; i += BATCH_SIZE) {
          const batch = allSetLogs.slice(i, i + BATCH_SIZE);
          await supabase.from('set_logs').insert(batch);
        }

        setImportProgress({ current: 5, total: 5, currentItem: 'Complete!' });

        const imported = sessionMap.size;
        const skipped = workouts.length - imported;
        setResult({ success: true, imported, skipped, errors });
      } else if (importSource === 'loseit') {
        const entries = previewData as ParsedLoseItEntry[];
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          setImportProgress({
            current: i + 1,
            total: entries.length,
            currentItem: entry.name,
          });

          if (i > 0 && i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          try {
            const logDate = parseDate(entry.date);
            if (!logDate) {
              skipped++;
              continue;
            }

            const { error } = await supabase
              .from('food_log')
              .insert({
                user_id: user.id,
                food_name: entry.name,
                calories: entry.calories,
                protein: entry.protein,
                carbs: entry.carbs,
                fat: entry.fat,
                serving_size: entry.quantity,
                serving_unit: entry.units,
                meal_type: 'snack',
                logged_at: logDate,
                source: 'loseit_import',
              });

            if (error) {
              skipped++;
            } else {
              imported++;
            }
          } catch {
            skipped++;
          }
        }

        setResult({ success: true, imported, skipped, errors });
      }
    } catch {
      setResult({
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['Import failed. Please try again.'],
      });
    } finally {
      setIsProcessing(false);
      setImportProgress(null);
      setPreviewData(null);
    }
  };

  const handleExport = async (format: 'strong' | 'loseit') => {
    setIsProcessing(true);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        alert('Not logged in');
        return;
      }

      if (format === 'strong') {
        const { data: sessions } = await supabase
          .from('workout_sessions')
          .select(`
            id,
            planned_date,
            completed_at,
            session_notes,
            exercise_blocks (
              id,
              exercises (
                name
              ),
              set_logs (
                weight_kg,
                reps,
                rpe
              )
            )
          `)
          .eq('user_id', user.id)
          .eq('state', 'completed')
          .order('completed_at', { ascending: false });

        if (sessions) {
          const workouts = sessions.map((s: any) => ({
            date: s.completed_at?.split('T')[0] || s.planned_date,
            workoutName: 'HyperTrack Workout',
            exercises: (s.exercise_blocks || []).map((b: any) => ({
              name: b.exercises?.name || 'Unknown',
              sets: (b.set_logs || []).map((log: any) => ({
                weight: log.weight_kg,
                reps: log.reps,
                rpe: log.rpe,
              })),
            })),
          }));

          const csv = exportToStrongCSV(workouts);
          downloadFile(csv, 'hypertrack-workouts.csv', 'text/csv');
        }
      } else if (format === 'loseit') {
        const { data: logs } = await supabase
          .from('food_log')
          .select('*')
          .eq('user_id', user.id)
          .order('logged_at', { ascending: false });

        if (logs) {
          const entries = logs.map((l: any) => ({
            date: l.logged_at?.split('T')[0] || new Date().toISOString().split('T')[0],
            name: l.food_name,
            calories: l.calories,
            protein: l.protein,
            carbs: l.carbs,
            fat: l.fat,
            quantity: l.serving_size,
            units: l.serving_unit,
          }));

          const csv = exportToLoseItCSV(entries);
          downloadFile(csv, 'hypertrack-nutrition.csv', 'text/csv');
        }
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Import & Export
          </CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Transfer your data to and from other fitness apps
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Tab Navigation */}
          <div className="flex gap-2 border-b border-surface-700 pb-2">
            <button
              onClick={() => { setActiveTab('import'); setPreviewData(null); setResult(null); }}
              className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
                activeTab === 'import'
                  ? 'bg-surface-800 text-primary-400 border-b-2 border-primary-500'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Import
            </button>
            <button
              onClick={() => { setActiveTab('export'); setPreviewData(null); setResult(null); }}
              className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
                activeTab === 'export'
                  ? 'bg-surface-800 text-primary-400 border-b-2 border-primary-500'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Export
            </button>
          </div>

          {activeTab === 'import' && (
            <div className="space-y-4">
              {/* Import Source Selection */}
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  onClick={() => { setImportSource('strong'); setPreviewData(null); setResult(null); }}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    importSource === 'strong'
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                  }`}
                >
                  <div className="text-2xl mb-1">💪</div>
                  <h3 className="font-bold text-surface-100">Strong App</h3>
                  <p className="text-xs text-surface-400">Import workout history</p>
                </button>

                <button
                  onClick={() => { setImportSource('loseit'); setPreviewData(null); setResult(null); }}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    importSource === 'loseit'
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                  }`}
                >
                  <div className="text-2xl mb-1">🍎</div>
                  <h3 className="font-bold text-surface-100">LoseIt</h3>
                  <p className="text-xs text-surface-400">Import food logs</p>
                </button>
              </div>

              {/* Import Instructions */}
              {importSource && (
                <div className="space-y-3">
                  <div className="p-3 bg-surface-800/50 rounded-lg">
                    <h4 className="font-medium text-surface-200 text-sm mb-2">How to export from {importSource === 'strong' ? 'Strong' : 'LoseIt'}:</h4>
                    {importSource === 'strong' ? (
                      <ol className="text-xs text-surface-400 space-y-1 list-decimal list-inside">
                        <li>Open Strong app → Settings → Export Data</li>
                        <li>Choose &quot;CSV&quot; format</li>
                        <li>Save and upload the file below</li>
                      </ol>
                    ) : (
                      <ol className="text-xs text-surface-400 space-y-1 list-decimal list-inside">
                        <li>Log into LoseIt on the web (loseit.com)</li>
                        <li>Go to Settings → My Account → Export Data</li>
                        <li>Download and upload the CSV below</li>
                      </ol>
                    )}
                  </div>

                  <div className="border-2 border-dashed border-surface-700 rounded-lg p-6 text-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="text-3xl mb-2">📄</div>
                    <p className="text-surface-300 text-sm mb-2">Drop your CSV file here or</p>
                    <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
                      {isProcessing ? 'Processing...' : 'Select File'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Preview */}
              {previewData && previewData.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-surface-200">Preview ({previewData.length} items)</span>
                    <Badge variant="warning">Ready to Import</Badge>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {importSource === 'strong' ? (
                      (previewData as ParsedStrongWorkout[]).slice(0, 5).map((workout, idx) => (
                        <div key={idx} className="p-2 bg-surface-800/50 rounded-lg text-sm">
                          <p className="font-medium text-surface-200">{workout.workoutName}</p>
                          <p className="text-xs text-surface-500">{workout.date} • {workout.exercises.length} exercises</p>
                        </div>
                      ))
                    ) : (
                      (previewData as ParsedLoseItEntry[]).slice(0, 5).map((entry, idx) => (
                        <div key={idx} className="p-2 bg-surface-800/50 rounded-lg text-sm">
                          <p className="font-medium text-surface-200">{entry.name}</p>
                          <p className="text-xs text-surface-500">{entry.date} • {entry.calories} cal</p>
                        </div>
                      ))
                    )}
                    {previewData.length > 5 && (
                      <p className="text-center text-xs text-surface-500 py-1">
                        ...and {previewData.length - 5} more
                      </p>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {importProgress && (
                    <div className="p-3 bg-surface-800 rounded-lg border border-surface-700">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-surface-300">Importing...</span>
                        <span className="text-surface-400">{importProgress.current} / {importProgress.total}</span>
                      </div>
                      <div className="w-full bg-surface-700 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-primary-500 to-primary-400 h-full rounded-full transition-all duration-300"
                          style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-surface-500 mt-1 truncate">{importProgress.currentItem}</p>
                    </div>
                  )}

                  {!importProgress && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleImport} isLoading={isProcessing} className="flex-1">
                        Import {previewData.length} Items
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPreviewData(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Result */}
              {result && (
                <div className={`p-3 rounded-lg ${result.success ? 'bg-success-500/10 border border-success-500/20' : 'bg-danger-500/10 border border-danger-500/20'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{result.success ? '✅' : '❌'}</span>
                    <div>
                      <p className={`font-medium text-sm ${result.success ? 'text-success-400' : 'text-danger-400'}`}>
                        {result.success ? 'Import Complete!' : 'Import Failed'}
                      </p>
                      <p className="text-xs text-surface-400">
                        {result.imported} imported, {result.skipped} skipped
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'export' && (
            <div className="space-y-4">
              <p className="text-sm text-surface-400">
                Download your data in formats compatible with other apps.
              </p>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-4 bg-surface-800/50 rounded-xl border border-surface-700">
                  <div className="text-2xl mb-1">💪</div>
                  <h3 className="font-bold text-surface-100">Workout Data</h3>
                  <p className="text-xs text-surface-400 mb-3">Strong-compatible format</p>
                  <Button size="sm" onClick={() => handleExport('strong')} isLoading={isProcessing} className="w-full">
                    Download CSV
                  </Button>
                </div>

                <div className="p-4 bg-surface-800/50 rounded-xl border border-surface-700">
                  <div className="text-2xl mb-1">🍎</div>
                  <h3 className="font-bold text-surface-100">Nutrition Data</h3>
                  <p className="text-xs text-surface-400 mb-3">LoseIt-compatible format</p>
                  <Button size="sm" onClick={() => handleExport('loseit')} isLoading={isProcessing} className="w-full">
                    Download CSV
                  </Button>
                </div>
              </div>

              <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                <p className="text-xs text-primary-400">
                  💡 Tip: Export your data monthly to keep a local backup of your training history.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Maintenance */}
      <Card className="border-surface-700">
        <CardHeader>
          <CardTitle className="text-sm">Data Maintenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fixResult && (
            <div className={`p-3 rounded-lg text-sm ${
              fixResult.success
                ? 'bg-success-500/10 border border-success-500/20 text-success-400'
                : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
            }`}>
              {fixResult.message}
            </div>
          )}

          <div className="p-3 bg-surface-800 rounded-lg">
            <h4 className="font-medium text-surface-200 text-sm mb-1">Fix Exercise Categories</h4>
            <p className="text-xs text-surface-400 mb-2">
              Re-categorize custom exercises that may have wrong muscle assignments.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFixExerciseCategories}
              disabled={isFixingCategories}
            >
              {isFixingCategories ? 'Fixing...' : 'Fix Categories'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-danger-500/30">
        <CardHeader>
          <CardTitle className="text-danger-400 text-sm">Danger Zone</CardTitle>
          <p className="text-xs text-surface-400">
            Permanently delete all your data. This cannot be undone!
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {deleteResult && (
            <div className={`p-3 rounded-lg text-sm ${
              deleteResult.success
                ? 'bg-success-500/10 border border-success-500/20 text-success-400'
                : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
            }`}>
              {deleteResult.success
                ? `Successfully deleted ${deleteResult.count} items`
                : 'Failed to delete data. Please try again.'}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-danger-500/50 text-danger-400 hover:bg-danger-500/10"
              onClick={() => { setDeleteType('workouts'); setShowDeleteConfirm(true); }}
              disabled={isDeleting}
            >
              Delete All Workouts
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-danger-500/50 text-danger-400 hover:bg-danger-500/10"
              onClick={() => { setDeleteType('nutrition'); setShowDeleteConfirm(true); }}
              disabled={isDeleting}
            >
              Delete All Nutrition
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 max-w-md mx-4 shadow-xl">
            <div className="text-center">
              <div className="text-4xl mb-4">⚠️</div>
              <h3 className="text-xl font-bold text-surface-100 mb-2">
                Delete All {deleteType === 'workouts' ? 'Workout History' : 'Nutrition Logs'}?
              </h3>
              <p className="text-surface-400 mb-6 text-sm">
                This will permanently delete <strong>all</strong> your {deleteType === 'workouts' ? 'workouts, exercises, and sets' : 'food logs'}.
                This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-center">
                <Button
                  variant="ghost"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteType(null); }}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-danger-500 hover:bg-danger-600 text-white"
                  onClick={() => deleteType && handleDeleteAll(deleteType)}
                  isLoading={isDeleting}
                >
                  Yes, Delete Everything
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Helper functions
function parseDate(dateStr: string): string | null {
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})/,
    /^(\d{2})\/(\d{2})\/(\d{4})/,
    /^(\d{2})-(\d{2})-(\d{4})/,
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,
  ];

  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch {
        continue;
      }
    }
  }

  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    return null;
  }

  return null;
}

function inferMuscleFromName(exerciseName: string): string {
  const name = exerciseName.toLowerCase();

  if (name.includes('crunch') || name.includes('ab ') || name.includes('abdominal') ||
      name.includes('sit-up') || name.includes('situp') || name.includes('plank') ||
      name.includes('pallof') || name.includes('palloff') ||
      name.includes('side bend') || name.includes('oblique') ||
      name.includes('woodchop') || name.includes('wood chop') ||
      name.includes('dead bug') || name.includes('hollow') ||
      name.includes('90/90') || name.includes('90 90') ||
      (name.includes('leg raise') && !name.includes('calf')) ||
      (name.includes('leg lift') && !name.includes('calf'))) {
    return 'abs';
  }

  if (name.includes('push-up') || name.includes('pushup') || name.includes('push up') ||
      name.includes('chest dip') || name.includes('dip') && name.includes('chest') ||
      name.includes('bench press') || name.includes('chest press') || name.includes('chest fly') ||
      name.includes('pec deck') || name.includes('pec fly') || name.includes('cable fly') ||
      name.includes('dumbbell fly') || name.includes('incline press') || name.includes('decline press') ||
      name.includes('floor press') ||
      (name.includes('fly') && (name.includes('chest') || name.includes('pec') || name.includes('cable')))) {
    return 'chest';
  }

  if (name.includes('arnold') ||
      name.includes('shoulder') || name.includes('lateral raise') || name.includes('front raise') ||
      name.includes('side raise') || name.includes('delt') || name.includes('military') ||
      name.includes('overhead press') || name.includes('ohp') ||
      name.includes('upright row') || name.includes('face pull') ||
      name.includes('reverse fly') || name.includes('rear delt')) {
    return 'shoulders';
  }

  if (name.includes('bicep') || name.includes('hammer curl') || name.includes('preacher') ||
      name.includes('concentration') || name.includes('ez curl') || name.includes('ez bar curl') ||
      (name.includes('curl') && !name.includes('leg') && !name.includes('ham') &&
       !name.includes('wrist') && !name.includes('reverse'))) {
    return 'biceps';
  }

  if (name.includes('tricep') || name.includes('skullcrusher') || name.includes('skull crusher') ||
      name.includes('pushdown') || name.includes('push down') ||
      (name.includes('dip') && !name.includes('chest')) ||
      name.includes('kickback') && !name.includes('glute') ||
      (name.includes('extension') && !name.includes('leg') && !name.includes('back') &&
       !name.includes('calf') && !name.includes('hip'))) {
    return 'triceps';
  }

  if (name.includes('shrug') || (name.includes('trap') && !name.includes('deadlift'))) {
    return 'traps';
  }

  if (name.includes('calf') || name.includes('calves') ||
      (name.includes('raise') && (name.includes('calf') || name.includes('heel')))) {
    return 'calves';
  }

  if (name.includes('row') && !name.includes('upright') ||
      name.includes('lat pull') || name.includes('pulldown') || name.includes('pull down') ||
      name.includes('pull-up') || name.includes('pullup') || name.includes('pull up') ||
      name.includes('chin-up') || name.includes('chinup') || name.includes('chin up') ||
      name.includes('back extension') || name.includes('hyper') ||
      name.includes('iso-lateral') || name.includes('iso lateral')) {
    return 'back';
  }

  if (name.includes('adductor') || name.includes('adduction')) {
    return 'adductors';
  }
  if (name.includes('abductor') || name.includes('abduction')) {
    return 'glutes';
  }

  if (name.includes('glute') || name.includes('hip thrust') ||
      (name.includes('kickback') && name.includes('glute'))) {
    return 'glutes';
  }

  if (name.includes('hamstring') || name.includes('leg curl') || name.includes('lying curl') ||
      (name.includes('seated curl') && name.includes('leg')) || name.includes('rdl') ||
      name.includes('romanian') || name.includes('stiff leg') ||
      name.includes('good morning')) {
    return 'hamstrings';
  }

  if (name.includes('squat') || name.includes('leg press') || name.includes('leg extension') ||
      name.includes('quad') || name.includes('lunge') || name.includes('hack') ||
      name.includes('step up') || name.includes('step-up') ||
      name.includes('split squat') || name.includes('sissy')) {
    return 'quads';
  }

  if (name.includes('forearm') || name.includes('wrist curl') || name.includes('grip') ||
      name.includes('reverse curl')) {
    return 'forearms';
  }

  if (name.includes('deadlift') || name.includes('trap bar')) {
    return 'hamstrings';
  }

  return 'back';
}

function inferMechanicFromName(exerciseName: string): string {
  const name = exerciseName.toLowerCase();

  const compounds = ['squat', 'deadlift', 'bench', 'press', 'row', 'pull-up', 'pullup', 'chin-up', 'dip'];
  if (compounds.some(c => name.includes(c))) {
    return 'compound';
  }

  return 'isolation';
}

function inferMovementPattern(exerciseName: string): string {
  const name = exerciseName.toLowerCase();

  if (name.includes('bench') || name.includes('push') || name.includes('fly') || name.includes('press') && name.includes('chest')) {
    return 'horizontal_push';
  }
  if (name.includes('row') || name.includes('pull') && !name.includes('down')) {
    return 'horizontal_pull';
  }
  if (name.includes('overhead') || name.includes('shoulder press') || name.includes('military')) {
    return 'vertical_push';
  }
  if (name.includes('pulldown') || name.includes('pull-up') || name.includes('pullup') || name.includes('chin')) {
    return 'vertical_pull';
  }
  if (name.includes('squat') || name.includes('leg press') || name.includes('lunge')) {
    return 'squat';
  }
  if (name.includes('deadlift') || name.includes('rdl') || name.includes('hip thrust')) {
    return 'hinge';
  }
  if (name.includes('curl') && !name.includes('leg')) {
    return 'curl';
  }
  if (name.includes('extension') || name.includes('pushdown') || name.includes('tricep')) {
    return 'extension';
  }
  if (name.includes('lateral') || name.includes('raise') || name.includes('fly')) {
    return 'isolation';
  }

  return 'compound';
}
