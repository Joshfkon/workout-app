'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge, Modal, ExplainedTerm } from '@/components/ui';
import { RPEExplainer, RPEQuickReference } from '@/components/onboarding/RPEExplainer';
import { ContextCard } from '@/components/onboarding/ContextCard';
import { useFirstTimeHint } from '@/hooks/useEducationPreferences';
import { createUntypedClient } from '@/lib/supabase/client';
import { 
  BENCHMARK_LIFTS, 
  CoachingSessionManager,
  type BenchmarkLift,
  type CalibrationResult,
  type BodyComposition,
  formatStrengthLevel,
  getStrengthLevelBadgeVariant,
  generatePercentileSegments
} from '@/services/coachingEngine';
import { kgToLbs, lbsToKg, roundToIncrement } from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';

function PercentileBar({ percentile, label }: { percentile: number; label: string }) {
  const segments = generatePercentileSegments(percentile);
  
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-surface-400">
        <span>{label}</span>
        <span>{percentile}th</span>
      </div>
      <div className="flex gap-0.5">
        {segments.map((seg, i) => (
          <div 
            key={i}
            className="h-2 flex-1 rounded-sm transition-colors"
            style={{ backgroundColor: seg.color }}
          />
        ))}
      </div>
    </div>
  );
}

function CalibrateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [units, setUnits] = useState<WeightUnit>('lb'); // Default to imperial
  const [session, setSession] = useState<{
    bodyComposition: BodyComposition;
    selectedBenchmarks: string[];
    sex: 'male' | 'female';
  } | null>(null);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedResults, setCompletedResults] = useState<CalibrationResult[]>([]);
  
  // Current lift input state (stored in display units)
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('5');
  const [rpe, setRpe] = useState('8');
  const [currentResult, setCurrentResult] = useState<CalibrationResult | null>(null);

  // Education state - show RPE tutorial before first test
  const { shouldShow: shouldShowRPETutorial, dismiss: dismissRPETutorial } = useFirstTimeHint('rpe-tutorial-calibration');
  const [showRPEModal, setShowRPEModal] = useState(false);

  // Show RPE tutorial on first load if not dismissed
  useEffect(() => {
    if (!isLoading && session && currentIndex === 0 && shouldShowRPETutorial) {
      setShowRPEModal(true);
    }
  }, [isLoading, session, currentIndex, shouldShowRPETutorial]);
  
  // Helper functions for unit conversion
  const displayWeight = (kg: number) => {
    const value = units === 'lb' ? kgToLbs(kg) : kg;
    return roundToIncrement(value, units === 'lb' ? 2.5 : 2.5);
  };
  
  const toKg = (displayValue: number) => {
    return units === 'lb' ? lbsToKg(displayValue) : displayValue;
  };
  
  const weightUnit = units === 'lb' ? 'lbs' : 'kg';
  
  // Fetch session data
  useEffect(() => {
    async function fetchSession() {
      if (!sessionId) {
        router.push('/onboarding');
        return;
      }
      
      const supabase = createUntypedClient();
      
      const { data: sessionData, error } = await supabase
        .from('coaching_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (error || !sessionData) {
        router.push('/onboarding');
        return;
      }
      
      // Get user's sex and preferences
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('sex')
        .eq('id', user?.id)
        .single();
      
      // Get user preferences for units
      const { data: prefsData } = await supabase
        .from('user_preferences')
        .select('units')
        .eq('user_id', user?.id)
        .single();
      
      if (prefsData?.units) {
        setUnits(prefsData.units as WeightUnit);
      }
      
      // Fetch any existing calibrated lifts for this session
      const { data: existingLifts } = await supabase
        .from('calibrated_lifts')
        .select('*')
        .eq('coaching_session_id', sessionId);
      
      setSession({
        bodyComposition: sessionData.body_composition as BodyComposition,
        selectedBenchmarks: sessionData.selected_benchmarks || [],
        sex: (userData?.sex as 'male' | 'female') || 'male'
      });
      
      if (existingLifts && existingLifts.length > 0) {
        const results: CalibrationResult[] = existingLifts.map((lift: {
          lift_name: string;
          benchmark_id: string;
          tested_weight_kg: number;
          tested_reps: number;
          tested_rpe: number | null;
          estimated_1rm: number;
          percentile_vs_general: number;
          percentile_vs_trained: number;
          percentile_vs_body_comp: number;
          strength_level: string;
        }) => ({
          lift: lift.lift_name,
          benchmarkId: lift.benchmark_id,
          testedWeight: lift.tested_weight_kg,
          testedReps: lift.tested_reps,
          testedRPE: lift.tested_rpe,
          estimated1RM: lift.estimated_1rm,
          percentileScore: {
            vsGeneralPopulation: lift.percentile_vs_general,
            vsTrainedPopulation: lift.percentile_vs_trained,
            vsBodyComposition: lift.percentile_vs_body_comp
          },
          strengthLevel: lift.strength_level
        }));
        setCompletedResults(results);
        setCurrentIndex(results.length);
      }
      
      setIsLoading(false);
    }
    
    fetchSession();
  }, [sessionId, router]);
  
  // Get current benchmark to test
  const orderedBenchmarks = session?.selectedBenchmarks
    .map(id => BENCHMARK_LIFTS.find(b => b.id === id))
    .filter(Boolean) as BenchmarkLift[] || [];
  
  const currentBenchmark = orderedBenchmarks[currentIndex];
  const isComplete = currentIndex >= orderedBenchmarks.length;
  
  // Get suggested start weight (returns value in display units)
  const getSuggestedWeight = () => {
    if (!currentBenchmark || !session) return 0;
    
    const bw = session.bodyComposition.totalWeightKg;
    const startingRatios: Record<string, number> = {
      'bench_press': 0.5,
      'squat': 0.7,
      'deadlift': 0.9,
      'overhead_press': 0.35,
      'barbell_row': 0.45,
      'leg_press': 1.3,
      'pullup': 0
    };
    
    const weightKg = bw * (startingRatios[currentBenchmark.id] || 0.5);
    return displayWeight(weightKg);
  };
  
  // Calculate result when inputs change
  useEffect(() => {
    if (!currentBenchmark || !session) {
      setCurrentResult(null);
      return;
    }
    
    const w = parseFloat(weight);
    const wKg = toKg(w); // Convert display units to kg for calculation
    const r = parseInt(reps);
    const rpeVal = parseFloat(rpe);
    
    if ((currentBenchmark.id !== 'pullup' && w > 0 && r > 0) || 
        (currentBenchmark.id === 'pullup' && r >= 0)) {
      const manager = new CoachingSessionManager();
      manager.setBodyComposition(
        session.bodyComposition.heightCm,
        session.bodyComposition.totalWeightKg,
        session.bodyComposition.bodyFatPercentage
      );
      
      const result = manager.recordBenchmarkResult(
        currentBenchmark.id,
        currentBenchmark.id === 'pullup' ? session.bodyComposition.totalWeightKg : wKg,
        r,
        rpeVal || undefined,
        session.sex
      );
      
      setCurrentResult(result);
    } else {
      setCurrentResult(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weight, reps, rpe, currentBenchmark, session, units]);
  
  // Save result and move to next
  const handleSaveAndNext = async () => {
    if (!currentResult || !sessionId || !session) return;
    
    setIsSaving(true);
    
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      // Save to database
      const { error } = await supabase
        .from('calibrated_lifts')
        .insert({
          user_id: user.id,
          coaching_session_id: sessionId,
          benchmark_id: currentResult.benchmarkId,
          lift_name: currentResult.lift,
          tested_weight_kg: currentResult.testedWeight,
          tested_reps: currentResult.testedReps,
          tested_rpe: currentResult.testedRPE,
          estimated_1rm: currentResult.estimated1RM,
          percentile_vs_general: currentResult.percentileScore.vsGeneralPopulation,
          percentile_vs_trained: currentResult.percentileScore.vsTrainedPopulation,
          percentile_vs_body_comp: currentResult.percentileScore.vsBodyComposition,
          strength_level: currentResult.strengthLevel
        });
      
      if (error) throw error;
      
      // Update local state
      setCompletedResults(prev => [...prev, currentResult]);
      setCurrentIndex(prev => prev + 1);
      setWeight('');
      setReps('5');
      setRpe('8');
      setCurrentResult(null);
    } catch (err) {
      console.error('Error saving result:', err);
    } finally {
      setIsSaving(false);
    }
  };
  
  // Finish and go to complete page
  const handleFinish = async () => {
    if (!sessionId) return;
    
    setIsSaving(true);
    
    try {
      const supabase = createUntypedClient();
      
      // Update session status
      await supabase
        .from('coaching_sessions')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', sessionId);
      
      router.push(`/onboarding/complete?session=${sessionId}`);
    } catch (err) {
      console.error('Error completing session:', err);
    } finally {
      setIsSaving(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  
  if (!session) return null;
  
  const handleRPETutorialComplete = () => {
    setShowRPEModal(false);
    dismissRPETutorial();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* RPE Tutorial Modal */}
      <Modal
        isOpen={showRPEModal}
        onClose={handleRPETutorialComplete}
        title="Understanding Effort Levels"
        size="lg"
        showCloseButton={false}
      >
        <RPEExplainer
          onComplete={handleRPETutorialComplete}
          onSkip={handleRPETutorialComplete}
          variant="inline"
        />
      </Modal>

      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step <= 3 
                ? 'bg-primary-500 text-white' 
                : 'bg-surface-800 text-surface-500'
            }`}>
              {step < 3 ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : step}
            </div>
            {step < 4 && (
              <div className={`w-12 h-0.5 ${step < 3 ? 'bg-primary-500' : 'bg-surface-800'}`} />
            )}
          </div>
        ))}
      </div>
      
      {/* Context card on first test */}
      {currentIndex === 0 && !isComplete && (
        <ContextCard
          cardKey="calibration"
          className="mb-4"
          defaultCollapsed={false}
          collapsible={true}
        />
      )}

      {/* Test progress */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-surface-200">
          {isComplete ? 'All Tests Complete!' : `Testing: ${currentBenchmark?.name}`}
        </h2>
        <span className="text-sm text-surface-400">
          {completedResults.length} / {orderedBenchmarks.length} complete
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="h-2 bg-surface-800 rounded-full overflow-hidden mb-8">
        <div 
          className="h-full bg-primary-500 transition-all duration-300"
          style={{ width: `${(completedResults.length / orderedBenchmarks.length) * 100}%` }}
        />
      </div>
      
      {isComplete ? (
        // Completion summary
        <div className="space-y-6">
          <Card className="bg-success-500/10 border-success-500/30">
            <CardContent className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Testing Complete!</h2>
              <p className="text-surface-400">
                You&apos;ve tested {completedResults.length} lifts. Let&apos;s see your strength profile.
              </p>
            </CardContent>
          </Card>
          
          {/* Quick results summary */}
          <div className="grid gap-3">
            {completedResults.map((result) => (
              <Card key={result.benchmarkId} className="bg-surface-900">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-surface-200">{result.lift}</p>
                      <p className="text-sm text-surface-500">
                        {displayWeight(result.testedWeight)} {weightUnit} × {result.testedReps} = {displayWeight(result.estimated1RM)} {weightUnit} E1RM
                      </p>
                    </div>
                    <Badge variant={getStrengthLevelBadgeVariant(result.strengthLevel)}>
                      {formatStrengthLevel(result.strengthLevel)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          <div className="flex justify-center pt-4">
            <Button 
              size="lg" 
              onClick={handleFinish}
              isLoading={isSaving}
            >
              View My Strength Profile
              <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Button>
          </div>
        </div>
      ) : currentBenchmark && (
        // Current test UI
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Instructions panel */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{currentBenchmark.name}</CardTitle>
                <Badge variant="info">{currentBenchmark.equipment}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-surface-400">{currentBenchmark.description}</p>
              
              {/* Testing protocol */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h4 className="font-medium text-surface-200 mb-2">Testing Protocol</h4>
                <p className="text-sm text-surface-400 whitespace-pre-line">
                  {currentBenchmark.testingProtocol.instructions}
                </p>
              </div>
              
              {/* Warmup protocol */}
              <div>
                <h4 className="font-medium text-surface-200 mb-2">Warmup Sets</h4>
                <p className="text-xs text-surface-500 mb-2">
                  Based on suggested working weight of ~{getSuggestedWeight()} {weightUnit}
                </p>
                <div className="space-y-2">
                  {currentBenchmark.testingProtocol.warmupProtocol.map((warmup, i) => {
                    const increment = units === 'lb' ? 5 : 2.5;
                    const warmupWeight = Math.round(getSuggestedWeight() * warmup.percentOfWorking / increment) * increment;
                    return (
                      <div key={i} className="flex items-center justify-between p-2 bg-surface-800 rounded text-sm">
                        <span className="text-surface-300">
                          Set {i + 1}: {warmupWeight > 0 ? `${warmupWeight} ${weightUnit}` : 'Bar only'} × {warmup.reps}
                        </span>
                        <span className="text-surface-500">Rest {warmup.rest}s</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Safety warnings */}
              {currentBenchmark.testingProtocol.safetyWarnings.length > 0 && (
                <div className="p-3 bg-warning-500/10 border border-warning-500/30 rounded-lg">
                  <h4 className="font-medium text-warning-400 mb-1">⚠️ Safety Notes</h4>
                  <ul className="text-sm text-surface-400 space-y-1">
                    {currentBenchmark.testingProtocol.safetyWarnings.map((warning, i) => (
                      <li key={i}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Input panel */}
          <Card>
            <CardHeader>
              <CardTitle>Record Your Result</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentBenchmark.id === 'pullup' ? (
                // Pull-up specific input
                <Input
                  label="Total Reps Completed"
                  type="number"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  placeholder="8"
                  min={0}
                  max={50}
                  hint="How many strict pull-ups could you do?"
                />
              ) : (
                // Standard weight/reps input
                <>
                  <Input
                    label={`Weight (${weightUnit})`}
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder={String(getSuggestedWeight())}
                    min={0}
                    step={units === 'lb' ? 5 : 2.5}
                    hint={`Suggested starting weight: ${getSuggestedWeight()} ${weightUnit}`}
                  />
                  
                  <Input
                    label="Reps Completed"
                    type="number"
                    value={reps}
                    onChange={(e) => setReps(e.target.value)}
                    placeholder="5"
                    min={1}
                    max={30}
                  />
                  
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      RPE (Rate of Perceived Exertion)
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                      {[6, 7, 8, 9, 10].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setRpe(String(val))}
                          className={`p-3 rounded-lg text-center transition-colors ${
                            rpe === String(val)
                              ? 'bg-primary-500 text-white'
                              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                          }`}
                        >
                          <span className="block text-lg font-bold">{val}</span>
                          <span className="text-xs">
                            {val === 6 && '4+ left'}
                            {val === 7 && '3 left'}
                            {val === 8 && '2 left'}
                            {val === 9 && '1 left'}
                            {val === 10 && 'Max'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              
              {/* Result preview */}
              {currentResult && (
                <div className="p-4 bg-surface-800/50 rounded-xl space-y-4 mt-6">
                  <div className="text-center">
                    <p className="text-sm text-surface-500">
                      <ExplainedTerm term="E1RM" />
                    </p>
                    <p className="text-4xl font-bold text-white">
                      {currentBenchmark.id === 'pullup'
                        ? `${currentResult.testedReps} reps`
                        : `${displayWeight(currentResult.estimated1RM)} ${weightUnit}`}
                    </p>
                    <Badge
                      variant={getStrengthLevelBadgeVariant(currentResult.strengthLevel)}
                      className="mt-2"
                    >
                      {formatStrengthLevel(currentResult.strengthLevel)}
                    </Badge>
                  </div>

                  {/* Percentile explanation */}
                  <div className="text-center text-xs text-surface-400 border-t border-surface-700 pt-3">
                    <ExplainedTerm term="PERCENTILE" /> rankings show how you compare to others
                  </div>

                  <div className="space-y-3">
                    <PercentileBar
                      percentile={currentResult.percentileScore.vsGeneralPopulation}
                      label="vs General Population"
                    />
                    <PercentileBar
                      percentile={currentResult.percentileScore.vsTrainedPopulation}
                      label="vs Trained Lifters"
                    />
                    <PercentileBar
                      percentile={currentResult.percentileScore.vsBodyComposition}
                      label="vs Similar Body Comp"
                    />
                  </div>

                  {/* Interpretation helper */}
                  <p className="text-xs text-surface-500 text-center pt-2">
                    {currentResult.percentileScore.vsTrainedPopulation >= 75
                      ? "Great! You're stronger than most trained lifters."
                      : currentResult.percentileScore.vsTrainedPopulation >= 50
                        ? "Solid foundation. You're in the middle of the pack."
                        : "Room to grow! This data helps us set realistic progression."}
                  </p>
                </div>
              )}
              
              <Button
                className="w-full mt-4"
                size="lg"
                onClick={handleSaveAndNext}
                disabled={!currentResult || isSaving}
                isLoading={isSaving}
              >
                {currentIndex < orderedBenchmarks.length - 1 ? (
                  <>
                    Save & Next Exercise
                    <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                ) : (
                  <>
                    Save & Finish
                    <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </>
                )}
              </Button>
              
              {/* Skip button */}
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setCurrentIndex(prev => prev + 1);
                  setWeight('');
                  setReps('5');
                  setRpe('8');
                  setCurrentResult(null);
                }}
              >
                Skip this exercise
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Navigation */}
      {!isComplete && (
        <div className="flex justify-between pt-4">
          <Button 
            variant="secondary"
            onClick={() => router.push(`/onboarding/benchmarks?session=${sessionId}`)}
          >
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            Back to Selection
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CalibratePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <CalibrateContent />
    </Suspense>
  );
}

