'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

export default function WearableIntegrationArticle() {
  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Back Navigation */}
      <Link
        href="/dashboard/learn"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-200 mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Learn & Science
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-4xl">⌚</span>
          <span className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-medium">
            Wearable Integration
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">
          Activity-Adjusted TDEE
        </h1>
        <p className="text-lg text-surface-400">
          How we use your Apple Watch, Fitbit, or other wearable data for day-by-day accuracy.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-surface-300">
        {/* The Problem */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            The Problem with &quot;Average&quot; TDEE
          </h2>
          <p className="mb-4">
            Your basic TDEE model gives you an average daily burn. But you don&apos;t live an
            average day every day.
          </p>
          <Card className="p-4 bg-surface-800/50 mb-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-surface-400">Monday: Leg day + 15,000 steps</span>
                <span className="font-mono text-success-400">~2,800 cal</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-400">Tuesday: Rest day + 4,000 steps</span>
                <span className="font-mono text-warning-400">~2,100 cal</span>
              </div>
              <div className="pt-2 border-t border-surface-700">
                <span className="text-surface-500 text-sm">
                  That&apos;s a <strong className="text-surface-200">700 calorie swing</strong> between days.
                </span>
              </div>
            </div>
          </Card>
          <p>
            If you eat the same amount both days, you&apos;re in a big deficit Monday and barely any
            deficit Tuesday. Your weekly average might be on target, but your daily experience
            varies wildly.
          </p>
        </section>

        {/* How We Incorporate Activity */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            How We Incorporate Activity Data
          </h2>
          <p className="mb-4">
            When you connect your Apple Watch, Fitbit, or other wearable, we pull in your daily
            step count. Combined with your logged workouts from the app, we can estimate your
            actual burn for each specific day.
          </p>
          <Card className="p-5 bg-primary-500/10 border-primary-500/20 mb-6">
            <p className="font-semibold text-primary-300 mb-3">The enhanced model:</p>
            <div className="font-mono text-sm space-y-2">
              <p className="text-surface-200">Daily TDEE = Base Metabolism + Step Burn + Workout Burn</p>
              <div className="text-xs text-surface-400 space-y-1 pl-4 mt-3">
                <p><strong className="text-surface-300">Base Metabolism</strong> = Your resting burn (what we already calculate)</p>
                <p><strong className="text-surface-300">Step Burn</strong> = Calories from walking/daily movement</p>
                <p><strong className="text-surface-300">Workout Burn</strong> = Calories from your logged resistance training</p>
              </div>
            </div>
          </Card>
        </section>

        {/* Why We Use Our Workout Estimates */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Why We Use OUR Workout Estimates
          </h2>
          <Card className="p-4 bg-warning-500/10 border-warning-500/20 mb-4">
            <p className="text-warning-300 font-medium mb-2">Watch out!</p>
            <p className="text-sm text-surface-400">
              Your Apple Watch might say you burned 600 calories during your 45-minute lifting
              session. It&apos;s probably wrong—heart rate-based estimates for resistance training
              are notoriously inaccurate, often <strong className="text-surface-200">2-3x too high</strong>.
            </p>
          </Card>
          <p className="mb-4">
            We use conservative estimates based on research:
          </p>
          <ul className="list-disc list-inside space-y-2 text-surface-400 ml-4">
            <li>
              <strong className="text-surface-300">Workout duration</strong> - longer = more burn
            </li>
            <li>
              <strong className="text-surface-300">Rest periods</strong> - shorter rest = higher intensity
            </li>
            <li>
              <strong className="text-surface-300">Muscle groups</strong> - legs burn more than arms
            </li>
            <li>
              <strong className="text-surface-300">Your body weight</strong> - heavier = more calories
            </li>
          </ul>
          <p className="mt-4 text-sm text-surface-500">
            This gives a more realistic 150-250 calories for a typical 45-60 minute lifting session,
            rather than the inflated 500+ your watch might report.
          </p>
        </section>

        {/* Avoiding Double-Counting */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Avoiding Double-Counting
          </h2>
          <p className="mb-4">
            If you walked to the gym and your watch counted 2,000 steps during your workout, we
            shouldn&apos;t count those steps AND the workout calories.
          </p>
          <Card className="p-5 bg-surface-800/50 mb-4">
            <p className="text-sm text-surface-400 mb-3">How we handle it:</p>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="text-primary-400">1.</span>
                <span>Track hourly step breakdowns from your wearable</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary-400">2.</span>
                <span>Identify steps that occurred during your logged workout time</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary-400">3.</span>
                <span>Deduct those steps from your step calorie total</span>
              </div>
            </div>
          </Card>
          <p className="text-sm text-surface-500">
            You get credit for the workout OR the steps during that time, not both.
          </p>
        </section>

        {/* Dynamic Calorie Targets */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Dynamic Calorie Targets (Optional)
          </h2>
          <p className="mb-4">You can choose how to handle activity variations:</p>
          <div className="space-y-4">
            <Card className="p-4 bg-surface-800/30">
              <p className="font-medium text-surface-200 mb-1">Fixed Target</p>
              <p className="text-sm text-surface-500">
                Eat the same every day. Simple, but some days you&apos;ll be in a bigger deficit
                than others.
              </p>
            </Card>
            <Card className="p-4 bg-success-500/10 border-success-500/20">
              <p className="font-medium text-success-300 mb-1">Activity-Adjusted</p>
              <p className="text-sm text-surface-400">
                Eat more on active days, less on rest days. Keeps your deficit more consistent
                and may help with energy levels.
              </p>
            </Card>
            <Card className="p-4 bg-surface-800/30">
              <p className="font-medium text-surface-200 mb-1">Deficit-Locked</p>
              <p className="text-sm text-surface-500">
                Automatically adjust to maintain your exact target deficit (e.g., always 500 cal
                below burn).
              </p>
            </Card>
          </div>
        </section>

        {/* Calibration Over Time */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Calibration Over Time
          </h2>
          <p className="mb-4">
            Different devices count steps differently. A Fitbit might count 10% more steps than
            an Apple Watch for the same walk.
          </p>
          <Card className="p-5 bg-purple-500/10 border-purple-500/20 mb-4">
            <p className="font-medium text-purple-300 mb-3">We learn YOUR device&apos;s calibration:</p>
            <div className="space-y-2 text-sm text-surface-400">
              <p>
                By comparing predicted weight changes to actual, we can detect if your steps burn
                more or fewer calories than expected.
              </p>
              <p className="mt-2">
                If high-step days consistently lead to more weight loss than predicted, we
                increase your calibration factor automatically.
              </p>
            </div>
          </Card>
          <p className="text-sm text-surface-500">
            After 2-3 weeks with a connected device, your step-calorie estimates become
            personalized to you and your specific wearable.
          </p>
        </section>

        {/* Supported Devices */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Supported Devices
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4 text-center">
              <span className="text-3xl">⌚</span>
              <p className="font-medium text-surface-200 mt-2">Apple Watch</p>
              <p className="text-xs text-surface-500">via HealthKit</p>
            </Card>
            <Card className="p-4 text-center">
              <span className="text-3xl">💪</span>
              <p className="font-medium text-surface-200 mt-2">Fitbit</p>
              <p className="text-xs text-surface-500">via OAuth</p>
            </Card>
            <Card className="p-4 text-center">
              <span className="text-3xl">📊</span>
              <p className="font-medium text-surface-200 mt-2">Google Fit</p>
              <p className="text-xs text-surface-500">Android devices</p>
            </Card>
            <Card className="p-4 text-center">
              <span className="text-3xl">🏃</span>
              <p className="font-medium text-surface-200 mt-2">Garmin</p>
              <p className="text-xs text-surface-500">Coming soon</p>
            </Card>
          </div>
        </section>

        {/* The Math */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            The Math (For Nerds)
          </h2>
          <Card className="p-5 bg-surface-800/50">
            <p className="text-sm text-surface-400 mb-4">
              We use gradient descent to learn optimal parameters:
            </p>
            <div className="font-mono text-sm space-y-2 p-4 bg-surface-900 rounded-lg mb-4">
              <p className="text-surface-300">Daily TDEE = α × weight + β × netSteps + γ × workoutCals</p>
              <p className="text-surface-500 text-xs mt-2">Where:</p>
              <p className="text-surface-500 text-xs">α ≈ 13-16 cal/lb (base metabolism)</p>
              <p className="text-surface-500 text-xs">β ≈ 0.03-0.05 cal/step</p>
              <p className="text-surface-500 text-xs">γ ≈ 0.8-1.2 (workout multiplier)</p>
            </div>
            <p className="text-sm text-surface-500">
              These parameters are learned from your actual weight and calorie data, personalized
              to your metabolism and activity patterns.
            </p>
          </Card>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-blue-500/10 to-primary-500/10 border-blue-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">
              Ready to Connect Your Wearable?
            </h3>
            <p className="text-sm text-surface-400 mb-4">
              Start getting day-by-day calorie targets based on your actual activity level.
            </p>
            <Link href="/dashboard/settings/wearables">
              <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
                Connect Device
              </button>
            </Link>
          </Card>
        </section>
      </article>

      {/* Related Articles */}
      <div className="mt-12 pt-8 border-t border-surface-800">
        <h3 className="text-lg font-semibold text-surface-100 mb-4">Related Articles</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/dashboard/learn/adaptive-tdee">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔥</span>
                <div>
                  <p className="font-medium text-surface-200">Adaptive TDEE</p>
                  <p className="text-xs text-surface-500">How we calculate your base metabolism</p>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/dashboard/science">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <p className="font-medium text-surface-200">All Science Principles</p>
                  <p className="text-xs text-surface-500">12+ research-backed algorithms</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
