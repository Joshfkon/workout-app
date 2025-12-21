'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

export default function ExerciseScienceArticle() {
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
          <span className="text-4xl">📊</span>
          <span className="px-3 py-1 bg-purple-500/10 text-purple-400 rounded-full text-xs font-medium">
            Training Science
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">Exercise Selection Science</h1>
        <p className="text-lg text-surface-400">
          Why we rate exercises S/A/B/C and how to pick the most effective movements for muscle growth.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-surface-300">
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Why Some Exercises Build More Muscle
          </h2>
          <p className="mb-4">
            Not all exercises are created equal. We rate every exercise using criteria from
            peer-reviewed hypertrophy research:
          </p>
        </section>

        {/* Stretch Under Load */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Stretch Under Load</h2>
          <p className="mb-4">
            Does the muscle get stretched while under tension? This triggers more muscle growth.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4 bg-success-500/10 border-success-500/20">
              <p className="font-medium text-success-300 mb-2">High Stretch</p>
              <ul className="text-sm text-surface-400 space-y-1">
                <li>• Incline dumbbell curl</li>
                <li>• Romanian deadlift</li>
                <li>• Cable fly (stretched position)</li>
                <li>• Overhead tricep extension</li>
              </ul>
            </Card>
            <Card className="p-4 bg-surface-800/50">
              <p className="font-medium text-surface-300 mb-2">Low Stretch</p>
              <ul className="text-sm text-surface-500 space-y-1">
                <li>• Concentration curl (peak)</li>
                <li>• Leg press (top position)</li>
                <li>• Pec deck (contracted)</li>
              </ul>
            </Card>
          </div>
        </section>

        {/* Resistance Profile */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Resistance Profile</h2>
          <p className="mb-4">
            Is the exercise challenging throughout the full range, or only at certain points?
          </p>
          <Card className="p-5 bg-surface-800/50 mb-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-surface-300">Cables & well-designed machines</span>
                <span className="text-success-400 text-sm">Excellent</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-300">Free weights (most angles)</span>
                <span className="text-warning-400 text-sm">Good</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-300">Bodyweight at disadvantaged angles</span>
                <span className="text-surface-500 text-sm">Variable</span>
              </div>
            </div>
          </Card>
        </section>

        {/* Progression Ease */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Progression Ease</h2>
          <p className="mb-4">How easy is it to add weight over time?</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="text-success-400">Easy:</span>
              <span className="text-surface-400">Machines (small increments), barbells</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-warning-400">Medium:</span>
              <span className="text-surface-400">Dumbbells (5lb jumps can be big)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-danger-400">Hard:</span>
              <span className="text-surface-400">Bodyweight exercises</span>
            </li>
          </ul>
        </section>

        {/* The Tiers */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Our Tier System</h2>
          <div className="space-y-3">
            <Card className="p-4 bg-gradient-to-r from-yellow-500/10 to-transparent border-yellow-500/20">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⭐</span>
                <div>
                  <p className="font-bold text-yellow-400">S-Tier</p>
                  <p className="text-sm text-surface-400">
                    Maximum stimulus, favorable fatigue, great progression
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-gradient-to-r from-primary-500/10 to-transparent border-primary-500/20">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🅰️</span>
                <div>
                  <p className="font-bold text-primary-400">A-Tier</p>
                  <p className="text-sm text-surface-400">
                    Excellent exercises with minor drawbacks
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-gradient-to-r from-surface-700/30 to-transparent border-surface-700">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🅱️</span>
                <div>
                  <p className="font-bold text-surface-300">B-Tier</p>
                  <p className="text-sm text-surface-400">
                    Good exercises, useful for variety
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-gradient-to-r from-surface-800/30 to-transparent border-surface-800">
              <div className="flex items-center gap-3">
                <span className="text-2xl">©️</span>
                <div>
                  <p className="font-bold text-surface-400">C-Tier</p>
                  <p className="text-sm text-surface-500">
                    Suboptimal but still usable
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-purple-500/10 to-primary-500/10 border-purple-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Explore Our Exercise Database</h3>
            <p className="text-sm text-surface-400 mb-4">
              See ratings for 500+ exercises with detailed hypertrophy scores.
            </p>
            <Link href="/dashboard/exercises">
              <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
                View Exercises
              </button>
            </Link>
          </Card>
        </section>
      </article>
    </div>
  );
}
