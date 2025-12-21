'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

export default function ProgressiveOverloadArticle() {
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
          <span className="text-4xl">📈</span>
          <span className="px-3 py-1 bg-primary-500/10 text-primary-400 rounded-full text-xs font-medium">
            Training Science
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">Progressive Overload Explained</h1>
        <p className="text-lg text-surface-400">
          The fundamental principle of muscle growth and how HyperTracker automates your progression.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-surface-300">
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">The Core Principle</h2>
          <Card className="p-5 bg-primary-500/10 border-primary-500/20 mb-4">
            <p className="text-lg text-primary-300">
              To grow, you must progressively demand more of your body.
            </p>
          </Card>
          <p className="mb-4">The body adapts to stress. If you do the same workout forever, you stop growing. Progressive overload means systematically increasing the challenge over time.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Ways to Progress</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4">
              <p className="font-medium text-surface-200 mb-2">🏋️ More Weight</p>
              <p className="text-sm text-surface-400">Add 2.5-5 lbs when you hit your rep target</p>
            </Card>
            <Card className="p-4">
              <p className="font-medium text-surface-200 mb-2">🔢 More Reps</p>
              <p className="text-sm text-surface-400">Add 1-2 reps per set before increasing weight</p>
            </Card>
            <Card className="p-4">
              <p className="font-medium text-surface-200 mb-2">📊 More Sets</p>
              <p className="text-sm text-surface-400">Add volume over the mesocycle</p>
            </Card>
            <Card className="p-4">
              <p className="font-medium text-surface-200 mb-2">🎯 Better Technique</p>
              <p className="text-sm text-surface-400">Improved muscle tension per rep</p>
            </Card>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">How We Track It</h2>
          <ul className="space-y-3 text-surface-400">
            <li className="flex items-start gap-2">
              <span className="text-primary-400">•</span>
              <span>E1RM tracking shows your strength progress over time</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary-400">•</span>
              <span>Weekly volume tracking ensures you&apos;re doing enough work</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary-400">•</span>
              <span>Plateau detection alerts you when progress stalls</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary-400">•</span>
              <span>Weight suggestions help you know when to increase</span>
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-primary-500/10 to-purple-500/10 border-primary-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Start a New Mesocycle</h3>
            <p className="text-sm text-surface-400 mb-4">
              Our AI builds progression right into your program.
            </p>
            <Link href="/dashboard/mesocycle/new">
              <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
                Create Mesocycle
              </button>
            </Link>
          </Card>
        </section>
      </article>
    </div>
  );
}
