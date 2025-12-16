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

export default function ImportExportPage() {
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
        // First get all workout sessions for this user
        const { data: sessions } = await supabase
          .from('workout_sessions')
          .select('id')
          .eq('user_id', user.id);
        
        if (sessions && sessions.length > 0) {
          const sessionIds = sessions.map((s: { id: string }) => s.id);
          
          // Delete set_logs for these sessions (via exercise_blocks)
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
          
          // Delete exercise_blocks
          await supabase
            .from('exercise_blocks')
            .delete()
            .in('workout_session_id', sessionIds);
          
          // Delete workout_sessions
          await supabase
            .from('workout_sessions')
            .delete()
            .eq('user_id', user.id);
          
          setDeleteResult({ success: true, count: sessions.length });
        } else {
          setDeleteResult({ success: true, count: 0 });
        }
      } else if (type === 'nutrition') {
        // Delete all nutrition logs
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
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];
        
        // Cache exercise lookups to avoid repeated DB queries
        const exerciseCache: Map<string, string> = new Map();

        for (let i = 0; i < workouts.length; i++) {
          const workout = workouts[i];
          setImportProgress({
            current: i + 1,
            total: workouts.length,
            currentItem: `${workout.workoutName} (${workout.date})`,
          });
          
          // Small delay to ensure smooth progress updates and prevent overwhelming the database
          if (i > 0 && i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          
          try {
            // Parse date (Strong uses various formats)
            const workoutDate = parseDate(workout.date);
            if (!workoutDate) {
              skipped++;
              continue;
            }

            // Create workout session
            const { data: session, error: sessionError } = await supabase
              .from('workout_sessions')
              .insert({
                user_id: user.id,
                planned_date: workoutDate,
                state: 'completed',
                started_at: workoutDate,
                completed_at: workoutDate,
                session_notes: workout.notes,
                completion_percent: 100,
              })
              .select()
              .single();

            if (sessionError || !session) {
              errors.push(`Failed to import workout from ${workout.date}`);
              continue;
            }

            // Import exercises
            let order = 1;
            const allSetLogs: Array<{
              exercise_block_id: string;
              weight_kg: number;
              reps: number;
              rpe?: number;
              is_warmup: boolean;
              logged_at: string;
            }> = [];

            for (const exercise of workout.exercises) {
              // Skip exercises with no sets
              if (!exercise.sets || exercise.sets.length === 0) continue;
              
              const exerciseNameLower = exercise.name.toLowerCase().trim();
              let exerciseId = exerciseCache.get(exerciseNameLower);
              
              if (!exerciseId) {
                // Find or create exercise in database
                const { data: existingExercise } = await supabase
                  .from('exercises')
                  .select('id')
                  .ilike('name', exercise.name)
                  .single();

                if (existingExercise) {
                  exerciseId = existingExercise.id;
                } else {
                  // Create new exercise
                  const { data: newExercise, error: exError } = await supabase
                    .from('exercises')
                    .insert({
                      name: exercise.name,
                      primary_muscle: inferMuscleFromName(exercise.name),
                      mechanic: inferMechanicFromName(exercise.name),
                      difficulty: 'intermediate',
                      is_custom: true,
                      created_by: user.id,
                    })
                    .select()
                    .single();
                  
                  if (exError) {
                    console.error('Failed to create exercise:', exercise.name, exError);
                  }
                  if (newExercise) {
                    exerciseId = newExercise.id;
                  }
                }
                
                // Cache the result
                if (exerciseId) {
                  exerciseCache.set(exerciseNameLower, exerciseId);
                }
              }

              if (exerciseId) {
                // Create exercise block
                const { data: block, error: blockError } = await supabase
                  .from('exercise_blocks')
                  .insert({
                    workout_session_id: session.id,
                    exercise_id: exerciseId,
                    order: order++,
                    target_sets: exercise.sets.length,
                    target_rep_range: [8, 12],
                    target_rir: 2,
                  })
                  .select()
                  .single();

                if (blockError) {
                  console.error('Failed to create exercise block:', blockError);
                }

                if (block) {
                  // Batch set logs for this exercise
                  for (const set of exercise.sets) {
                    const weightKg = set.weightUnit === 'lb' ? set.weight / 2.20462 : set.weight;
                    allSetLogs.push({
                      exercise_block_id: block.id,
                      weight_kg: weightKg,
                      reps: set.reps,
                      rpe: set.rpe,
                      is_warmup: false,
                      logged_at: workoutDate,
                    });
                  }
                }
              }
            }

            // Batch insert all set logs for this workout (much faster!)
            if (allSetLogs.length > 0) {
              const { error: setError } = await supabase
                .from('set_logs')
                .insert(allSetLogs);
              
              if (setError) {
                console.error('Failed to insert set logs:', setError);
              }
            }

            imported++;
          } catch (err) {
            skipped++;
          }
        }

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
          
          // Small delay to ensure smooth progress updates and prevent overwhelming the database
          if (i > 0 && i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          
          try {
            const logDate = parseDate(entry.date);
            if (!logDate) {
              skipped++;
              continue;
            }

            // Create food log entry
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
                meal_type: 'snack', // Default
                logged_at: logDate,
                source: 'loseit_import',
              });

            if (error) {
              skipped++;
            } else {
              imported++;
            }
          } catch (err) {
            skipped++;
          }
        }

        setResult({ success: true, imported, skipped, errors });
      }
    } catch (error) {
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
        // Fetch workout data
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
        // Fetch nutrition data
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Import & Export</h1>
        <p className="text-surface-400 mt-1">Transfer your data to and from other fitness apps</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-surface-800 pb-2">
        <button
          onClick={() => { setActiveTab('import'); setPreviewData(null); setResult(null); }}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'import'
              ? 'bg-surface-800 text-primary-400 border-b-2 border-primary-500'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          📥 Import
        </button>
        <button
          onClick={() => { setActiveTab('export'); setPreviewData(null); setResult(null); }}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'export'
              ? 'bg-surface-800 text-primary-400 border-b-2 border-primary-500'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          📤 Export
        </button>
      </div>

      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* Import Source Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Select Import Source</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-4">
                <button
                  onClick={() => { setImportSource('strong'); setPreviewData(null); setResult(null); }}
                  className={`p-6 rounded-xl border-2 transition-all text-left ${
                    importSource === 'strong'
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                  }`}
                >
                  <div className="text-3xl mb-2">💪</div>
                  <h3 className="text-lg font-bold text-surface-100">Strong App</h3>
                  <p className="text-sm text-surface-400 mt-1">Import workout history from Strong</p>
                  <p className="text-xs text-surface-500 mt-2">Supported: CSV export</p>
                </button>

                <button
                  onClick={() => { setImportSource('loseit'); setPreviewData(null); setResult(null); }}
                  className={`p-6 rounded-xl border-2 transition-all text-left ${
                    importSource === 'loseit'
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                  }`}
                >
                  <div className="text-3xl mb-2">🍎</div>
                  <h3 className="text-lg font-bold text-surface-100">LoseIt</h3>
                  <p className="text-sm text-surface-400 mt-1">Import food logs from LoseIt</p>
                  <p className="text-xs text-surface-500 mt-2">Supported: CSV export</p>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Import Instructions */}
          {importSource && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {importSource === 'strong' ? 'Import from Strong' : 'Import from LoseIt'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-surface-800/50 rounded-lg">
                  <h4 className="font-medium text-surface-200 mb-2">How to export from {importSource === 'strong' ? 'Strong' : 'LoseIt'}:</h4>
                  {importSource === 'strong' ? (
                    <ol className="text-sm text-surface-400 space-y-1 list-decimal list-inside">
                      <li>Open Strong app → Settings → Export Data</li>
                      <li>Choose &quot;CSV&quot; format</li>
                      <li>Save the file to your device</li>
                      <li>Upload the CSV file below</li>
                    </ol>
                  ) : (
                    <ol className="text-sm text-surface-400 space-y-1 list-decimal list-inside">
                      <li>Log into LoseIt on the web (loseit.com)</li>
                      <li>Go to Settings → My Account → Export Data</li>
                      <li>Download the CSV file</li>
                      <li>Upload the CSV file below</li>
                    </ol>
                  )}
                </div>

                <div className="border-2 border-dashed border-surface-700 rounded-lg p-8 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <div className="text-4xl mb-3">📄</div>
                  <p className="text-surface-300 mb-2">Drop your CSV file here or</p>
                  <Button onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
                    {isProcessing ? 'Processing...' : 'Select File'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Preview */}
          {previewData && previewData.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Preview ({previewData.length} items)</CardTitle>
                  <Badge variant="warning">Ready to Import</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {importSource === 'strong' ? (
                    (previewData as ParsedStrongWorkout[]).slice(0, 10).map((workout, idx) => (
                      <div key={idx} className="p-3 bg-surface-800/50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-surface-200">{workout.workoutName}</p>
                            <p className="text-sm text-surface-500">{workout.date} • {workout.exercises.length} exercises</p>
                          </div>
                          <Badge variant="default">{workout.exercises.reduce((sum, e) => sum + e.sets.length, 0)} sets</Badge>
                        </div>
                      </div>
                    ))
                  ) : (
                    (previewData as ParsedLoseItEntry[]).slice(0, 10).map((entry, idx) => (
                      <div key={idx} className="p-3 bg-surface-800/50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-surface-200">{entry.name}</p>
                            <p className="text-sm text-surface-500">{entry.date}</p>
                          </div>
                          <Badge variant="default">{entry.calories} cal</Badge>
                        </div>
                      </div>
                    ))
                  )}
                  {previewData.length > 10 && (
                    <p className="text-center text-sm text-surface-500 py-2">
                      ...and {previewData.length - 10} more
                    </p>
                  )}
                </div>

                {/* Progress Bar */}
                {importProgress && (
                  <div className="mt-4 p-4 bg-surface-800 rounded-lg border border-surface-700">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-surface-300">Importing...</span>
                      <span className="text-surface-400">
                        {importProgress.current} / {importProgress.total}
                      </span>
                    </div>
                    <div className="w-full bg-surface-700 rounded-full h-3 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-primary-500 to-primary-400 h-full rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-surface-500 mt-2 truncate">
                      📝 {importProgress.currentItem}
                    </p>
                  </div>
                )}

                {!importProgress && (
                  <div className="flex gap-3 mt-4">
                    <Button onClick={handleImport} isLoading={isProcessing} className="flex-1">
                      Import {previewData.length} Items
                    </Button>
                    <Button variant="ghost" onClick={() => setPreviewData(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Result */}
          {result && (
            <Card className={result.success ? 'border-success-500/30' : 'border-danger-500/30'}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`text-3xl ${result.success ? '' : ''}`}>
                    {result.success ? '✅' : '❌'}
                  </div>
                  <div>
                    <h3 className={`font-bold ${result.success ? 'text-success-400' : 'text-danger-400'}`}>
                      {result.success ? 'Import Complete!' : 'Import Failed'}
                    </h3>
                    <p className="text-sm text-surface-400">
                      {result.imported} imported, {result.skipped} skipped
                    </p>
                  </div>
                </div>
                {result.errors.length > 0 && (
                  <div className="p-3 bg-danger-500/10 rounded-lg">
                    <p className="text-sm text-danger-400">{result.errors.join(', ')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'export' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Export Your Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-surface-400 mb-6">
                Download your workout and nutrition data in formats compatible with other apps.
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="p-6 bg-surface-800/50 rounded-xl border border-surface-700">
                  <div className="text-3xl mb-2">💪</div>
                  <h3 className="text-lg font-bold text-surface-100">Workout Data</h3>
                  <p className="text-sm text-surface-400 mt-1 mb-4">
                    Export your workout history in Strong-compatible format
                  </p>
                  <Button onClick={() => handleExport('strong')} isLoading={isProcessing} className="w-full">
                    Download CSV
                  </Button>
                </div>

                <div className="p-6 bg-surface-800/50 rounded-xl border border-surface-700">
                  <div className="text-3xl mb-2">🍎</div>
                  <h3 className="text-lg font-bold text-surface-100">Nutrition Data</h3>
                  <p className="text-sm text-surface-400 mt-1 mb-4">
                    Export your food logs in LoseIt-compatible format
                  </p>
                  <Button onClick={() => handleExport('loseit')} isLoading={isProcessing} className="w-full">
                    Download CSV
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Backup Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Data Backup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-surface-400 mb-4">
                Your data is securely stored in our database. However, we recommend periodic backups
                for your peace of mind.
              </p>
              <div className="p-4 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                <p className="text-sm text-primary-400">
                  💡 Tip: Export your data monthly to keep a local backup of your training history.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-danger-500/30">
            <CardHeader>
              <CardTitle className="text-danger-400">⚠️ Danger Zone</CardTitle>
              <p className="text-sm text-surface-400 mt-1">
                Permanently delete all your data. This cannot be undone!
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {deleteResult && (
                <div className={`p-4 rounded-lg ${
                  deleteResult.success 
                    ? 'bg-success-500/10 border border-success-500/20 text-success-400'
                    : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
                }`}>
                  {deleteResult.success 
                    ? `✅ Successfully deleted ${deleteResult.count} items`
                    : '❌ Failed to delete data. Please try again.'}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <Button 
                  variant="outline" 
                  className="border-danger-500/50 text-danger-400 hover:bg-danger-500/10"
                  onClick={() => { setDeleteType('workouts'); setShowDeleteConfirm(true); }}
                  disabled={isDeleting}
                >
                  🗑️ Delete All Workout History
                </Button>
                <Button 
                  variant="outline"
                  className="border-danger-500/50 text-danger-400 hover:bg-danger-500/10"
                  onClick={() => { setDeleteType('nutrition'); setShowDeleteConfirm(true); }}
                  disabled={isDeleting}
                >
                  🗑️ Delete All Nutrition Logs
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 max-w-md mx-4 shadow-xl">
            <div className="text-center">
              <div className="text-4xl mb-4">⚠️</div>
              <h3 className="text-xl font-bold text-surface-100 mb-2">
                Delete All {deleteType === 'workouts' ? 'Workout History' : 'Nutrition Logs'}?
              </h3>
              <p className="text-surface-400 mb-6">
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
    </div>
  );
}

// Helper functions
function parseDate(dateStr: string): string | null {
  // Try various date formats
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /^(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
    /^(\d{2})-(\d{2})-(\d{4})/, // MM-DD-YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, // M/D/YY or M/D/YYYY
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

  // Try direct parse
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
  
  if (name.includes('bench') || name.includes('chest') || name.includes('fly') || name.includes('push')) {
    return 'chest';
  }
  if (name.includes('row') || name.includes('lat') || name.includes('pull')) {
    return 'back';
  }
  if (name.includes('squat') || name.includes('leg press') || name.includes('extension') || name.includes('quad')) {
    return 'quads';
  }
  if (name.includes('deadlift') || name.includes('curl') && name.includes('leg') || name.includes('hamstring')) {
    return 'hamstrings';
  }
  if (name.includes('shoulder') || name.includes('press') || name.includes('lateral') || name.includes('delt')) {
    return 'shoulders';
  }
  if (name.includes('bicep') || name.includes('curl') && !name.includes('leg')) {
    return 'biceps';
  }
  if (name.includes('tricep') || name.includes('pushdown') || name.includes('extension') && !name.includes('leg')) {
    return 'triceps';
  }
  if (name.includes('calf') || name.includes('raise') && name.includes('calf')) {
    return 'calves';
  }
  if (name.includes('glute') || name.includes('hip thrust')) {
    return 'glutes';
  }
  
  return 'chest'; // Default
}

function inferMechanicFromName(exerciseName: string): string {
  const name = exerciseName.toLowerCase();
  
  const compounds = ['squat', 'deadlift', 'bench', 'press', 'row', 'pull-up', 'pullup', 'chin-up', 'dip'];
  if (compounds.some(c => name.includes(c))) {
    return 'compound';
  }
  
  return 'isolation';
}

