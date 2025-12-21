'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

const metricsTracked = [
  {
    icon: '\uD83D\uDCC8',
    title: 'Progression Rate',
    description: 'Are you getting stronger week-over-week?',
    detail:
      'If yes, you\'re recovering. If you\'re stalling or regressing, you may be exceeding your recovery capacity.',
  },
  {
    icon: '\uD83D\uDCAA',
    title: 'RIR Drift',
    description: 'Same weight feeling harder over time?',
    detail:
      'If the same weight at the same reps feels significantly harder by week 3 than week 1, fatigue is accumulating faster than you\'re recovering.',
  },
  {
    icon: '\uD83C\uDFAF',
    title: 'Form Quality',
    description: 'Is technique degrading?',
    detail:
      'Your set feedback captures form quality. If you\'re progressively grinding out uglier reps, that\'s fatigue manifesting.',
  },
  {
    icon: '\u2764\uFE0F',
    title: 'Recovery Scores',
    description: 'Does low recovery predict bad sessions?',
    detail:
      'Your daily check-in recovery ratings correlate with performance. Strong correlation with consistently low recovery = volume may be too high.',
  },
];

const phases = [
  {
    number: 1,
    title: 'Establish Baseline',
    description: 'Train with evidence-based starting volumes for 3-4 weeks. We collect data.',
  },
  {
    number: 2,
    title: 'Analyze Outcomes',
    description:
      'At the end of the mesocycle, we analyze progression, RIR drift, form quality, and recovery correlation.',
  },
  {
    number: 3,
    title: 'Adjust',
    description:
      'We determine if volume was too high, optimal, or too low for each muscle group. Then suggest specific adjustments.',
  },
  {
    number: 4,
    title: 'Refine',
    description:
      'Over multiple mesocycles, your personalized volume tolerance emerges. After 3-4 cycles, we have high confidence in YOUR optimal ranges.',
  },
];

export default function AdaptiveVolumeArticle() {
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
          <span className="text-4xl">{'\uD83D\uDCCA'}</span>
          <span className="px-3 py-1 bg-purple-500/10 text-purple-400 rounded-full text-xs font-medium">
            Training Science
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">
          How We Learn Your Recovery Capacity
        </h1>
        <p className="text-lg text-surface-400">
          Personalized volume recommendations based on YOUR data, not population averages.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-surface-300">
        {/* The Volume Problem */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">The Volume Problem</h2>
          <p className="mb-4">Every fitness influencer has an opinion on how many sets you should do:</p>
          <ul className="list-disc list-inside space-y-2 text-surface-400 ml-4 mb-4">
            <li>&quot;10-20 sets per muscle per week&quot;</li>
            <li>&quot;Do more until you stop progressing&quot;</li>
            <li>&quot;Less is more - just train harder&quot;</li>
          </ul>
          <Card className="p-4 bg-warning-500/10 border-warning-500/20">
            <p className="text-warning-300 font-medium mb-2">The problem?</p>
            <p className="text-sm text-surface-400">
              Individual variation is massive. Research shows a <strong className="text-surface-200">3x difference</strong> between
              low and high responders. One person&apos;s optimal is another person&apos;s overtraining.
            </p>
          </Card>
        </section>

        {/* Why Generic Recommendations Fail */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Why Generic Recommendations Fail</h2>
          <p className="mb-4 text-surface-400">
            Standard volume recommendations come from research averages. But you&apos;re not average - you&apos;re you.
          </p>
          <Card className="p-4">
            <h4 className="font-semibold text-surface-200 mb-3">Factors that affect YOUR recovery:</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span>{'\uD83E\uDDEC'}</span>
                <span className="text-surface-400">Genetics - Some people recover faster</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{'\uD83C\uDFC5'}</span>
                <span className="text-surface-400">Training age - Beginners need less</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{'\uD83D\uDE13'}</span>
                <span className="text-surface-400">Life stress - Work, sleep, relationships</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{'\uD83C\uDF57'}</span>
                <span className="text-surface-400">Nutrition - Protein, calories</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{'\u23F3'}</span>
                <span className="text-surface-400">Age - Recovery slows over time</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{'\uD83D\uDC8A'}</span>
                <span className="text-surface-400">PED use - Significantly higher capacity</span>
              </div>
            </div>
          </Card>
          <p className="text-sm text-surface-500 mt-4">
            A study might find &quot;16 sets/week is optimal for quad growth&quot; - but that&apos;s the average.
            Some subjects grew best at 12 sets, others at 22.
          </p>
        </section>

        {/* Our Approach */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Our Approach: Let Your Body Tell Us</h2>
          <p className="mb-6 text-surface-400">
            Instead of guessing, we track what actually happens when you train at different volumes.
          </p>

          <h3 className="text-lg font-semibold text-surface-100 mb-4">What We Monitor</h3>
          <div className="space-y-4">
            {metricsTracked.map((metric, idx) => (
              <Card key={idx} className="p-4">
                <div className="flex items-start gap-4">
                  <div className="text-2xl shrink-0">{metric.icon}</div>
                  <div>
                    <h4 className="font-semibold text-surface-100">{metric.title}</h4>
                    <p className="text-sm text-surface-500 mb-2">{metric.description}</p>
                    <p className="text-sm text-surface-400">{metric.detail}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* RIR Drift Deep Dive */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Understanding RIR Drift</h2>
          <p className="mb-4 text-surface-400">
            RIR Drift is subtle but important. It&apos;s a leading indicator of overreaching.
          </p>
          <Card className="p-4 bg-surface-800/50">
            <p className="text-sm text-surface-500 mb-3">Example:</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 bg-success-500/20 text-success-400 text-xs rounded">Week 1</span>
                <span className="text-surface-300">185 lbs × 8 at RIR 2 (felt like 2 left in tank)</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 bg-danger-500/20 text-danger-400 text-xs rounded">Week 3</span>
                <span className="text-surface-300">185 lbs × 8 at RIR 0 (barely got it)</span>
              </div>
            </div>
            <p className="text-sm text-surface-400 mt-3">
              Same performance on paper, but you&apos;re more fatigued. Volume is outpacing recovery.
            </p>
          </Card>
        </section>

        {/* How It Works */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">How It Works</h2>
          <div className="space-y-4">
            {phases.map((phase) => (
              <div key={phase.number} className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center shrink-0">
                  <span className="text-primary-400 font-semibold">{phase.number}</span>
                </div>
                <div>
                  <h4 className="font-semibold text-surface-200">{phase.title}</h4>
                  <p className="text-sm text-surface-400">{phase.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The Math */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">The Math Behind It</h2>
          <p className="mb-4 text-surface-400">We track two key metrics per muscle group:</p>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Card className="p-4 bg-success-500/5 border-success-500/20">
              <h4 className="font-semibold text-success-400 mb-2">MEV</h4>
              <p className="text-sm text-surface-400">
                Minimum Effective Volume - the least amount of work needed to maintain or slowly progress.
              </p>
            </Card>
            <Card className="p-4 bg-danger-500/5 border-danger-500/20">
              <h4 className="font-semibold text-danger-400 mb-2">MRV</h4>
              <p className="text-sm text-surface-400">
                Maximum Recoverable Volume - the most work you can do while still recovering.
              </p>
            </Card>
          </div>

          <Card className="p-4 bg-surface-800/50">
            <pre className="text-xs text-surface-400 font-mono">
{`|----MEV----[====OPTIMAL ZONE====]----MRV----|
              You want to be here`}
            </pre>
          </Card>

          <p className="text-sm text-surface-400 mt-4">
            We start with research-based estimates, then adjust based on YOUR data:
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-surface-400 mt-2 ml-4">
            <li>Stalling/regressing? MRV estimate comes down.</li>
            <li>Crushing it with gas in the tank? MRV estimate goes up.</li>
          </ul>
        </section>

        {/* Real-Time Monitoring */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Real-Time Fatigue Monitoring</h2>
          <p className="mb-4 text-surface-400">
            We don&apos;t wait until you&apos;re overtrained. Mid-mesocycle, we watch for warning signs:
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4 bg-warning-500/10 border-warning-500/20">
              <h4 className="font-semibold text-warning-400 mb-2">{'\uD83D\uDFE1'} Warning Signs</h4>
              <ul className="space-y-1 text-sm text-surface-400">
                <li>• RIR drift starting to accumulate</li>
                <li>• Form slipping on later sets</li>
                <li>• Approaching your estimated MRV</li>
              </ul>
            </Card>
            <Card className="p-4 bg-danger-500/10 border-danger-500/20">
              <h4 className="font-semibold text-danger-400 mb-2">{'\uD83D\uDD34'} Alert Signs</h4>
              <ul className="space-y-1 text-sm text-surface-400">
                <li>• Significant RIR drift (2+ points)</li>
                <li>• Form degradation multiple sessions</li>
                <li>• Exceeded estimated MRV</li>
              </ul>
            </Card>
          </div>

          <p className="text-sm text-surface-500 mt-4">
            When we detect these patterns, you&apos;ll get a heads-up before it becomes a problem.
          </p>
        </section>

        {/* Enhanced Athletes */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">For Enhanced Athletes</h2>
          <Card className="p-4 bg-purple-500/10 border-purple-500/20">
            <p className="text-surface-300 mb-3">
              If you&apos;re using PEDs, your recovery capacity is significantly higher. The system accounts for this:
            </p>
            <ul className="space-y-2 text-sm text-surface-400">
              <li className="flex items-start gap-2">
                <span className="text-purple-400">{'\u2713'}</span>
                <span>Higher baseline volume estimates (+40%)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">{'\u2713'}</span>
                <span>Faster upward adjustment of MRV</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">{'\u2713'}</span>
                <span>Recognition that &quot;normal&quot; overreaching signals may not apply</span>
              </li>
            </ul>
            <p className="text-sm text-surface-500 mt-3">
              Set your status in profile settings. The algorithm adjusts accordingly.
            </p>
          </Card>
        </section>

        {/* What This Means */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">What This Means For You</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-surface-800 rounded text-xs text-surface-400">Week 1</span>
              <span className="text-surface-300">Start with evidence-based volumes</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-surface-800 rounded text-xs text-surface-400">Weeks 2-4</span>
              <span className="text-surface-300">Train, log feedback, let data accumulate</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-surface-800 rounded text-xs text-surface-400">End of meso</span>
              <span className="text-surface-300">Review analysis, see what worked</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-surface-800 rounded text-xs text-surface-400">Next meso</span>
              <span className="text-surface-300">Apply adjustments, repeat</span>
            </div>
          </div>

          <Card className="p-4 bg-success-500/10 border-success-500/20 mt-6">
            <p className="font-semibold text-success-300 mb-2">After 2-3 mesocycles, you&apos;ll know:</p>
            <ul className="space-y-1 text-sm text-surface-400">
              <li>• Exactly how much chest volume you thrive on</li>
              <li>• Whether your back recovers faster or slower than average</li>
              <li>• Which muscles can handle more punishment</li>
            </ul>
            <p className="text-sm text-success-300 mt-3 font-medium">
              No more guessing. No more cookie-cutter programs. Your volume, optimized for YOUR recovery.
            </p>
          </Card>
        </section>

        {/* Tips */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Tips for Best Results</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4 bg-success-500/5 border-success-500/20">
              <h4 className="font-semibold text-success-400 mb-2">{'\u2713'} Do</h4>
              <ul className="space-y-2 text-sm text-surface-400">
                <li>• Log RIR and form honestly every set</li>
                <li>• Complete daily check-ins (especially recovery)</li>
                <li>• Run full 3-4 week mesocycles before adjusting</li>
                <li>• Trust the process - it takes a few cycles</li>
              </ul>
            </Card>
            <Card className="p-4 bg-danger-500/5 border-danger-500/20">
              <h4 className="font-semibold text-danger-400 mb-2">{'\u2717'} Don&apos;t</h4>
              <ul className="space-y-2 text-sm text-surface-400">
                <li>• Change volume mid-mesocycle based on feelings</li>
                <li>• Ignore fatigue warnings</li>
                <li>• Skip logging for some sessions</li>
                <li>• Expect perfect answers in week 1</li>
              </ul>
            </Card>
          </div>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-purple-500/10 to-primary-500/10 border-purple-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">See Your Volume Profile</h3>
            <p className="text-sm text-surface-400 mb-4">
              Check your current volume tolerance estimates and this week&apos;s training volume.
            </p>
            <Link href="/dashboard/volume">
              <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
                View Volume Dashboard
              </button>
            </Link>
          </Card>
        </section>
      </article>

      {/* Related Articles */}
      <div className="mt-12 pt-8 border-t border-surface-800">
        <h3 className="text-lg font-semibold text-surface-100 mb-4">Related Articles</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/dashboard/learn/injury-prevention">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{'\uD83D\uDEE1\uFE0F'}</span>
                <div>
                  <p className="font-medium text-surface-200">Smart Injury Prevention</p>
                  <p className="text-xs text-surface-500">Volume affects injury risk</p>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/dashboard/learn/progressive-overload">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{'\uD83D\uDCC8'}</span>
                <div>
                  <p className="font-medium text-surface-200">Progressive Overload</p>
                  <p className="text-xs text-surface-500">How we track progression</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
