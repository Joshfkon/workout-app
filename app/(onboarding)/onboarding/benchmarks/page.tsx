'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { ContextCard } from '@/components/onboarding/ContextCard';
import { createUntypedClient } from '@/lib/supabase/client';
import { completeOnboarding, updateOnboardingStep } from '@/lib/onboarding/onboardingProgress';
import { BENCHMARK_LIFTS, type BenchmarkLift } from '@/services/coachingEngine';

function BenchmarkCard({ 
  benchmark, 
  isSelected, 
  onToggle,
  isRecommended,
  isAlternative
}: { 
  benchmark: BenchmarkLift; 
  isSelected: boolean; 
  onToggle: () => void;
  isRecommended?: boolean;
  isAlternative?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
        isSelected 
          ? 'bg-action/10 border-action' 
          : 'bg-card border-sep hover:border-sep'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-ink">{benchmark.name}</h3>
            {isRecommended && (
              <Badge variant="success" size="sm">Recommended</Badge>
            )}
            {isAlternative && (
              <Badge variant="warning" size="sm">Alternative</Badge>
            )}
          </div>
          <p className="text-body text-ink-2">{benchmark.description}</p>
          <div className="flex items-center gap-3 mt-2 text-caption text-ink-3">
            <span className="capitalize">{benchmark.pattern.replace('_', ' ')}</span>
            <span>•</span>
            <span className="capitalize">{benchmark.equipment}</span>
            <span>•</span>
            <span>~17 min</span>
          </div>
        </div>
        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
          isSelected 
            ? 'bg-action border-action' 
            : 'border-sep'
        }`}>
          {isSelected && (
            <svg className="w-4 h-4 text-on-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>
    </button>
  );
}

function BenchmarksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  // Nothing preselected: testing is optional, and a preselected set made the
  // page open on "about 68 minutes". Recommended lifts carry a badge instead.
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([]);
  
  const recommendedIds = ['bench_press', 'squat', 'deadlift', 'barbell_row'];
  const optionalIds = ['overhead_press', 'pullup'];
  const alternativeIds = ['leg_press'];
  
  const toggleBenchmark = (id: string) => {
    setSelectedBenchmarks(prev => 
      prev.includes(id) 
        ? prev.filter(b => b !== id)
        : [...prev, id]
    );
  };
  
  const estimatedTime = selectedBenchmarks.length * 17;

  // Skipping is a finished setup, not an abandoned one — otherwise the
  // "Complete your setup" card nags on every screen.
  // One tap: no confirm, and the button goes busy at once so a slow network
  // doesn't read as "nothing happened, tap again".
  const skipTesting = async () => {
    if (isSkipping) return;
    setIsSkipping(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await completeOnboarding(supabase, user.id);
    } catch {
      // Best-effort: the worst case is the setup card showing once.
    }
    router.push('/dashboard');
  };
  
  const handleContinue = async () => {
    if (!sessionId || selectedBenchmarks.length === 0) return;
    
    setIsLoading(true);
    
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      // Update session with selected benchmarks
      await supabase
        .from('coaching_sessions')
        .update({ selected_benchmarks: selectedBenchmarks })
        .eq('id', sessionId);
      
      // Track progress
      if (user) {
        await updateOnboardingStep(supabase, user.id, 'benchmarks');
      }
      
      // Navigate to calibration
      router.push(`/onboarding/calibrate?session=${sessionId}`);
    } catch (err) {
      console.error('Error updating session:', err);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Redirect if no session
  useEffect(() => {
    if (!sessionId) {
      router.push('/onboarding');
    }
  }, [sessionId, router]);
  
  if (!sessionId) return null;
  
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
              step <= 2 
                ? 'bg-action text-on-action' 
                : 'bg-fill text-ink-3'
            }`}>
              {step < 2 ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : step}
            </div>
            {step < 4 && (
              <div className={`w-12 h-0.5 ${step < 2 ? 'bg-action' : 'bg-fill'}`} />
            )}
          </div>
        ))}
      </div>
      
      <div className="text-center mb-6">
        <h1 className="text-large-title font-bold text-ink mb-2">Test your strength? (optional)</h1>
        <p className="text-ink-2" data-testid="benchmarks-purpose">
          These tests only set the starting weights we suggest in workouts. Skip them and
          suggestions start from estimates that sharpen as you log sets.
        </p>
      </div>

      {/* Skipping comes first: testing takes about an hour at a gym, and many
          people sign up elsewhere or don't lift barbells at all. */}
      <div className="rounded-card bg-card p-4 space-y-3 shadow-card">
        <Button
          className="w-full"
          size="lg"
          onClick={skipTesting}
          isLoading={isSkipping}
          disabled={isLoading}
          data-testid="skip-benchmarks"
        >
          Skip and start using the app
        </Button>
        <p className="text-caption text-ink-3 text-center">
          Most people skip this. Not lifting? Nothing here affects food tracking. You can test any
          time later from Analytics.
        </p>
      </div>

      <h2 className="text-headline font-semibold text-ink pt-2">Or pick lifts to test now</h2>

      {/* Context card explaining why we test strength */}
      <ContextCard
        cardKey="benchmarkSelection"
        className="mb-6"
        defaultCollapsed={true}
        collapsible={true}
      />

      {/* Recommended lifts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-headline font-semibold text-ink">Core lifts</h2>
          <span className="text-body text-ink-3">Most useful</span>
        </div>
        <div className="grid gap-3">
          {BENCHMARK_LIFTS.filter(b => recommendedIds.includes(b.id)).map(benchmark => (
            <BenchmarkCard
              key={benchmark.id}
              benchmark={benchmark}
              isSelected={selectedBenchmarks.includes(benchmark.id)}
              onToggle={() => toggleBenchmark(benchmark.id)}
              isRecommended
            />
          ))}
        </div>
      </div>
      
      {/* Optional lifts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-headline font-semibold text-ink">Optional lifts</h2>
          <span className="text-body text-ink-3">Extra</span>
        </div>
        <div className="grid gap-3">
          {BENCHMARK_LIFTS.filter(b => optionalIds.includes(b.id)).map(benchmark => (
            <BenchmarkCard
              key={benchmark.id}
              benchmark={benchmark}
              isSelected={selectedBenchmarks.includes(benchmark.id)}
              onToggle={() => toggleBenchmark(benchmark.id)}
            />
          ))}
        </div>
      </div>
      
      {/* Alternative lifts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-headline font-semibold text-ink">Alternatives</h2>
          <span className="text-body text-ink-3">If you can&apos;t do barbell squats</span>
        </div>
        <div className="grid gap-3">
          {BENCHMARK_LIFTS.filter(b => alternativeIds.includes(b.id)).map(benchmark => (
            <BenchmarkCard
              key={benchmark.id}
              benchmark={benchmark}
              isSelected={selectedBenchmarks.includes(benchmark.id)}
              onToggle={() => toggleBenchmark(benchmark.id)}
              isAlternative
            />
          ))}
        </div>
      </div>
      
      {/* Time estimate: only once lifts are picked, so the page doesn't open
          on an hour-long number for something optional. It sits by the Start
          button so it appearing doesn't shift the list being tapped. */}
      {selectedBenchmarks.length > 0 && (
        <Card className="bg-fill/50" data-testid="benchmark-time-estimate">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-action/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-ink">Estimated time</p>
                  <p className="text-body text-ink-2">
                    {selectedBenchmarks.length} {selectedBenchmarks.length === 1 ? 'lift' : 'lifts'} selected
                  </p>
                </div>
              </div>
              <p className="text-title font-bold text-ink">{estimatedTime} min</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button 
          variant="secondary"
          onClick={() => router.push('/onboarding')}
        >
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Back
        </Button>
        
        <Button 
          size="lg" 
          onClick={handleContinue} 
          disabled={selectedBenchmarks.length === 0 || isLoading || isSkipping}
          isLoading={isLoading}
        >
          {selectedBenchmarks.length === 0
            ? 'Pick lifts to test'
            : `Start Testing (${selectedBenchmarks.length} ${selectedBenchmarks.length === 1 ? 'lift' : 'lifts'})`}
          <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
      </div>

    </div>
  );
}

export default function BenchmarksPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-action border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <BenchmarksContent />
    </Suspense>
  );
}

