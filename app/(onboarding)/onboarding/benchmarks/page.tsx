'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { ContextCard } from '@/components/onboarding/ContextCard';
import { createUntypedClient } from '@/lib/supabase/client';
import { completeOnboarding, updateOnboardingStep } from '@/lib/onboarding/onboardingProgress';
import { BENCHMARK_LIFTS, type BenchmarkLift } from '@/services/coachingEngine';
import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps';

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

/** The status line once Skip is tapped (either button). */
const SKIPPED_STATUS =
  'Skipped. Your first workouts will find your starting weights. Opening your dashboard…';

function BenchmarksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  const [isLoading, setIsLoading] = useState(false);
  // Which Skip was tapped: the one at the top or the one by Start Testing.
  const [isSkipping, setIsSkipping] = useState<false | 'top' | 'bottom'>(false);
  const liftsRef = useRef<HTMLHeadingElement>(null);
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
  const skipTesting = async (how: 'top' | 'bottom' = 'top') => {
    if (isSkipping) return;
    setIsSkipping(how);
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
    if (!sessionId || selectedBenchmarks.length === 0 || isLoading || isSkipping) return;

    // Busy at once (spinner + "Starting…"), and it stays busy through the
    // route change instead of re-enabling under the user's finger.
    setIsLoading(true);
    let navigating = false;

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
      navigating = true;
    } catch (err) {
      console.error('Error updating session:', err);
    } finally {
      if (!navigating) setIsLoading(false);
    }
  };

  // Warm the dashboard route so Skip lands without a dead pause.
  useEffect(() => {
    router.prefetch?.('/dashboard');
  }, [router]);

  // Redirect if no session
  useEffect(() => {
    if (!sessionId) {
      router.push('/onboarding');
    }
  }, [sessionId, router]);

  if (!sessionId) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <OnboardingSteps current="strength" />

      <div className="text-center space-y-2">
        <span
          className="inline-block rounded-full bg-fill px-3 py-1 text-subhead font-semibold text-ink-2"
          data-testid="benchmarks-optional-badge"
        >
          Optional
        </span>
        <h1 className="text-large-title font-bold text-ink">Test your strength?</h1>
      </div>

      {/* The why and the skip cost FIRST, one short line each, then the skip
          buttons (UX panel round 21: five of six still missed why it's asked,
          that skipping is fine for beginners, and what skipping costs). */}
      <div className="space-y-2">
        <p className="text-headline font-normal text-ink" data-testid="benchmarks-why">
          <span className="font-semibold">Why:</span> it starts your weight suggestions at your real
          strength, and the lifts you test show on Progress from day one as your starting strength.
        </p>
        <p className="text-headline font-normal text-ink" data-testid="benchmarks-one-line">
          <span className="font-semibold">If you skip:</span> that&apos;s fine, especially if
          you&apos;re new. Your first suggestions start from estimates and may be off for your first
          1–2 workouts.
        </p>
      </div>

      {/* Skip is THE primary button, full width, first (UX round 23: "only
          a small 'Skip for now' link gets you past it", "I had to hunt for
          the skip option"). Round 22's filled button read "I'm new to
          lifting — skip", so an experienced lifter saw only a dim second
          button and the header's small link. One Skip, for everyone, as
          big as Continue; testing is the second choice. */}
      <div className="space-y-2">
        <Button
          className="w-full active:scale-[0.98]"
          size="lg"
          onClick={() => skipTesting('top')}
          isLoading={isSkipping === 'top'}
          aria-busy={isSkipping === 'top'}
          disabled={isLoading || (isSkipping !== false && isSkipping !== 'top')}
          data-testid="skip-benchmarks"
        >
          {isSkipping === 'top' ? 'Opening the app…' : 'Skip the test — go to the app'}
        </Button>
        <Button
          variant="secondary"
          className="w-full active:scale-[0.98]"
          size="lg"
          disabled={isLoading || isSkipping !== false}
          onClick={() => liftsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          data-testid="benchmarks-show-lifts"
        >
          Test my strength (~1 hour at a gym)
        </Button>
        {/* Said out loud and on screen the moment Skip is tapped. */}
        <p role="status" aria-live="polite" className="text-subhead text-ink-2 text-center min-h-[1.125rem]">
          {isSkipping ? SKIPPED_STATUS : ''}
        </p>
      </div>

      {/* The details, for anyone deciding whether to test. */}
      <div
        className="rounded-card bg-card p-4 shadow-card space-y-3 text-body text-ink-2"
        data-testid="benchmarks-purpose"
      >
        <p>
          A test is a few warm-up sets and one hard set of a lift at a gym, then you log the weight
          and reps.
        </p>
        <div>
          <p className="font-medium text-ink">What a test does:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Sets the starting weights we suggest in your workouts.</li>
            <li>Shows each tested lift&apos;s estimated max on Progress, as your starting strength.</li>
            <li>Turns on your strength percentiles.</li>
          </ul>
          <p className="mt-1 text-subhead">
            Your strength trend line itself builds from the workouts you log, tested or not.
          </p>
        </div>
        <div data-testid="benchmarks-skip-cost">
          <p className="font-medium text-ink">If you skip:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Weight suggestions start from estimates (your experience and body weight) and adjust
              after your first 1–2 sessions.
            </li>
            <li>Strength percentiles stay off until you test.</li>
            <li>Your workout history and progress charts work the same.</li>
            <li>Everything else works the same. Not lifting? Nothing here affects food tracking.</li>
          </ul>
        </div>
        {/* Panel (round 19): a lifter back from a shoulder injury worried
            the step expected him to test it. Above every lift card. */}
        <p className="font-medium text-ink" data-testid="benchmarks-injury-note">
          Injured or sore somewhere? Don&apos;t test a lift that loads it. Testing isn&apos;t needed,
          and it isn&apos;t worth the risk.
        </p>
        <p className="text-subhead text-ink-2">You can test any time later from Progress.</p>
      </div>

      <h2 ref={liftsRef} className="text-headline font-semibold text-ink pt-2 scroll-mt-20" data-testid="benchmarks-lifts-heading">
        Pick lifts to test now
      </h2>

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

      {/* Time estimate: only once lifts are picked, and only as one total (no
          per-lift minutes on the cards), so the page doesn't open on a time
          ask for something optional. It sits by the Start button so it
          appearing doesn't shift the list being tapped. */}
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
                  <p className="font-medium text-ink">Time at the gym</p>
                  <p className="text-body text-ink-2">
                    {selectedBenchmarks.length} {selectedBenchmarks.length === 1 ? 'lift' : 'lifts'} selected
                  </p>
                </div>
              </div>
              <p className="text-title font-bold text-ink">~{estimatedTime} min</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation: Start and Skip stacked, both full width, so the way
          past this step is as big at the bottom as at the top. With no
          lift picked, Skip is the filled one. */}
      <div className="space-y-2 pt-4">
        <Button
          size="lg"
          onClick={handleContinue}
          disabled={selectedBenchmarks.length === 0 || isLoading || isSkipping !== false}
          isLoading={isLoading}
          aria-busy={isLoading}
          className="w-full active:scale-[0.98]"
          data-testid="start-benchmarks"
        >
          {isLoading
            ? 'Starting…'
            : selectedBenchmarks.length === 0
              ? 'Pick lifts to test'
              : `Start Testing (${selectedBenchmarks.length} ${selectedBenchmarks.length === 1 ? 'lift' : 'lifts'})`}
          <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
        <Button
          variant={selectedBenchmarks.length === 0 ? 'primary' : 'secondary'}
          size="lg"
          className="w-full active:scale-[0.98]"
          onClick={() => skipTesting('bottom')}
          isLoading={isSkipping === 'bottom'}
          aria-busy={isSkipping === 'bottom'}
          disabled={isLoading || (isSkipping !== false && isSkipping !== 'bottom')}
          data-testid="skip-benchmarks-bottom"
        >
          {isSkipping === 'bottom' ? 'Opening the app…' : 'Skip the test — go to the app'}
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => router.push('/onboarding')}
          disabled={isLoading || isSkipping !== false}
        >
          Back
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

