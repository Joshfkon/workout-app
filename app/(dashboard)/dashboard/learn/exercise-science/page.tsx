'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

export default function ExerciseScienceArticle() {
  useDocumentTitle('Exercise Science');
  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Back Navigation */}
      <Link
        href="/dashboard/learn"
        className="inline-flex items-center gap-2 text-ink-2 hover:text-ink mb-8 transition-colors"
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
          <span className="px-3 py-1 bg-action/10 text-action rounded-full text-xs font-medium">
            Training Science
          </span>
        </div>
        <h1 className="text-3xl font-bold text-ink mb-3">Exercise Selection Science</h1>
        <p className="text-lg text-ink-2">
          Why we rate exercises S/A/B/C and how to pick the most effective movements for muscle growth.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-ink-2">
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">
            Why Some Exercises Build More Muscle
          </h2>
          <p className="mb-4">
            Not all exercises are created equal. We rate every exercise using criteria from
            peer-reviewed hypertrophy research:
          </p>
        </section>

        {/* Stretch Under Load */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">Stretch Under Load</h2>
          <p className="mb-4">
            Does the muscle get stretched while under tension? This triggers more muscle growth.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4 bg-status-ok/10 border-status-ok/20">
              <p className="font-medium text-status-ok mb-2">High Stretch</p>
              <ul className="text-sm text-ink-2 space-y-1">
                <li>• Incline dumbbell curl</li>
                <li>• Romanian deadlift</li>
                <li>• Cable fly (stretched position)</li>
                <li>• Overhead tricep extension</li>
              </ul>
            </Card>
            <Card className="p-4 bg-fill/50">
              <p className="font-medium text-ink-2 mb-2">Low Stretch</p>
              <ul className="text-sm text-ink-3 space-y-1">
                <li>• Concentration curl (peak)</li>
                <li>• Leg press (top position)</li>
                <li>• Pec deck (contracted)</li>
              </ul>
            </Card>
          </div>
        </section>

        {/* Resistance Profile */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">Resistance Profile</h2>
          <p className="mb-4">
            Is the exercise challenging throughout the full range, or only at certain points?
          </p>
          <Card className="p-5 bg-fill/50 mb-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-ink-2">Cables & well-designed machines</span>
                <span className="text-status-ok text-sm">Excellent</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-2">Free weights (most angles)</span>
                <span className="text-status-warn text-sm">Good</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-2">Bodyweight at disadvantaged angles</span>
                <span className="text-ink-3 text-sm">Variable</span>
              </div>
            </div>
          </Card>
        </section>

        {/* Progression Ease */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">Progression Ease</h2>
          <p className="mb-4">How easy is it to add weight over time?</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="text-status-ok">Easy:</span>
              <span className="text-ink-2">Machines (small increments), barbells</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-status-warn">Medium:</span>
              <span className="text-ink-2">Dumbbells (5lb jumps can be big)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-status-bad">Hard:</span>
              <span className="text-ink-2">Bodyweight exercises</span>
            </li>
          </ul>
        </section>

        {/* The Tiers */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">Our Tier System</h2>
          <div className="space-y-3">
            <Card className="bg-yellow-500/10 p-4 border-yellow-500/20">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⭐</span>
                <div>
                  <p className="font-bold text-yellow-400">S-Tier</p>
                  <p className="text-sm text-ink-2">
                    Maximum stimulus, favorable fatigue, great progression
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-action/10 to-transparent border-action/20">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🅰️</span>
                <div>
                  <p className="font-bold text-action">A-Tier</p>
                  <p className="text-sm text-ink-2">
                    Excellent exercises with minor drawbacks
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-sep/30 to-transparent border-sep">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🅱️</span>
                <div>
                  <p className="font-bold text-ink-2">B-Tier</p>
                  <p className="text-sm text-ink-2">
                    Good exercises, useful for variety
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-fill/30 to-transparent border-sep">
              <div className="flex items-center gap-3">
                <span className="text-2xl">©️</span>
                <div>
                  <p className="font-bold text-ink-2">C-Tier</p>
                  <p className="text-sm text-ink-3">
                    Suboptimal but still usable
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="bg-action/10 p-6 text-center border-action/20">
            <h3 className="text-lg font-bold text-ink mb-2">Explore Our Exercise Database</h3>
            <p className="text-sm text-ink-2 mb-4">
              See ratings for 500+ exercises with detailed hypertrophy scores.
            </p>
            <Link href="/dashboard/exercises">
              <button className="px-6 py-2 bg-action hover:bg-action text-on-action font-semibold rounded-lg transition-colors">
                View Exercises
              </button>
            </Link>
          </Card>
        </section>
      </article>
    </div>
  );
}
