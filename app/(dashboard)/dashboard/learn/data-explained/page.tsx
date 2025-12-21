'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

const metrics = [
  {
    name: 'E1RM (Estimated 1RM)',
    description: 'Your estimated one-rep max, calculated from your best sets using the Epley formula.',
    formula: 'Weight × (1 + Reps/30)',
    usage: 'Tracks strength progress over time without needing to actually max out.',
  },
  {
    name: 'Weekly Volume',
    description: 'Total hard sets per muscle group per week.',
    formula: 'Count of sets within 0-3 RIR',
    usage: 'Ensures you\'re in the productive 10-20 sets/week range for most muscles.',
  },
  {
    name: 'Fatigue Budget',
    description: 'Running total of exercise "costs" to prevent overtraining.',
    formula: 'Compounds: 8-12 pts, Isolations: 3-5 pts',
    usage: 'Triggers deloads when approaching your weekly limit.',
  },
  {
    name: 'FFMI',
    description: 'Fat-Free Mass Index - how muscular you are relative to height.',
    formula: 'Lean Mass (kg) / Height (m)² + 6.1 × (1.8 - Height)',
    usage: 'Natural limit typically 24-26. Helps set realistic goals.',
  },
  {
    name: 'RPE / RIR',
    description: 'Rate of Perceived Exertion / Reps in Reserve.',
    formula: 'RPE 10 = 0 RIR = failure',
    usage: 'Autoregulates intensity based on daily performance.',
  },
  {
    name: 'MEV / MAV / MRV',
    description: 'Volume landmarks from Renaissance Periodization.',
    formula: 'MEV < MAV < MRV',
    usage: 'Minimum, Maximum Adaptive, and Maximum Recoverable Volume.',
  },
];

export default function DataExplainedArticle() {
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
          <span className="text-4xl">🧮</span>
          <span className="px-3 py-1 bg-accent-500/10 text-accent-400 rounded-full text-xs font-medium">
            Guide
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">Understanding Your Data</h1>
        <p className="text-lg text-surface-400">
          A comprehensive guide to every metric we track and what the numbers mean.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-6 text-surface-300">
        {metrics.map((metric, idx) => (
          <Card key={idx} className="p-5">
            <h3 className="font-bold text-surface-100 text-lg mb-2">{metric.name}</h3>
            <p className="text-surface-400 text-sm mb-3">{metric.description}</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 bg-surface-800/50 rounded-lg">
                <p className="text-xs text-surface-500 mb-1">Formula</p>
                <p className="text-sm font-mono text-surface-300">{metric.formula}</p>
              </div>
              <div className="p-3 bg-surface-800/50 rounded-lg">
                <p className="text-xs text-surface-500 mb-1">How We Use It</p>
                <p className="text-sm text-surface-300">{metric.usage}</p>
              </div>
            </div>
          </Card>
        ))}

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-accent-500/10 to-primary-500/10 border-accent-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">View Your Analytics</h3>
            <p className="text-sm text-surface-400 mb-4">
              See all your metrics in action on your dashboard.
            </p>
            <Link href="/dashboard/analytics">
              <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
                Go to Analytics
              </button>
            </Link>
          </Card>
        </section>
      </article>
    </div>
  );
}
