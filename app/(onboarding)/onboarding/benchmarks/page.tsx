'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
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
          ? 'bg-primary-500/10 border-primary-500' 
          : 'bg-surface-900 border-surface-800 hover:border-surface-700'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-surface-100">{benchmark.name}</h3>
            {isRecommended && (
              <Badge variant="success" size="sm">Recommended</Badge>
            )}
            {isAlternative && (
              <Badge variant="warning" size="sm">Alternative</Badge>
            )}
          </div>
          <p className="text-sm text-surface-400">{benchmark.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-surface-500">
            <span className="capitalize">{benchmark.pattern.replace('_', ' ')}</span>
            <span>•</span>
            <span className="capitalize">{benchmark.equipment}</span>
            <span>•</span>
            <span>~17 min</span>
          </div>
        </div>
        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
          isSelected 
            ? 'bg-primary-500 border-primary-500' 
            : 'border-surface-600'
        }`}>
          {isSelected && (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([
    'bench_press', 'squat', 'deadlift', 'barbell_row'
  ]);
  
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
  
  const handleContinue = async () => {
    if (!sessionId || selectedBenchmarks.length === 0) return;
    
    setIsLoading(true);
    
    try {
      const supabase = createUntypedClient();
      
      // Update session with selected benchmarks
      await supabase
        .from('coaching_sessions')
        .update({ selected_benchmarks: selectedBenchmarks })
        .eq('id', sessionId);
      
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
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step <= 2 
                ? 'bg-primary-500 text-white' 
                : 'bg-surface-800 text-surface-500'
            }`}>
              {step < 2 ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : step}
            </div>
            {step < 4 && (
              <div className={`w-12 h-0.5 ${step < 2 ? 'bg-primary-500' : 'bg-surface-800'}`} />
            )}
          </div>
        ))}
      </div>
      
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Select Benchmark Lifts</h1>
        <p className="text-surface-400">
          Choose which lifts you&apos;d like to test. We&apos;ll use these to estimate your strength across all exercises.
        </p>
      </div>
      
      {/* Time estimate */}
      <Card className="bg-surface-800/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-surface-200">Estimated Time</p>
                <p className="text-sm text-surface-400">{selectedBenchmarks.length} lifts selected</p>
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{estimatedTime} min</p>
          </div>
        </CardContent>
      </Card>
      
      {/* Recommended lifts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-surface-200">Core Lifts</h2>
          <span className="text-sm text-surface-500">Recommended for complete profile</span>
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
          <h2 className="text-lg font-semibold text-surface-200">Optional Lifts</h2>
          <span className="text-sm text-surface-500">For more complete data</span>
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
          <h2 className="text-lg font-semibold text-surface-200">Alternatives</h2>
          <span className="text-sm text-surface-500">If you can&apos;t do barbell squats</span>
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
          disabled={selectedBenchmarks.length === 0 || isLoading}
          isLoading={isLoading}
        >
          Start Testing ({selectedBenchmarks.length} lifts)
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
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <BenchmarksContent />
    </Suspense>
  );
}

