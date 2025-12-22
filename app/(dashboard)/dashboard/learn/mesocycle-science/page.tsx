'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

const aiFeatures = [
  {
    icon: '🎯',
    title: 'Smart Split Selection',
    description: 'AI recommends the optimal training split based on your schedule',
    detail: 'We analyze your available training days and recommend Upper/Lower, PPL, Full Body, or other splits to maximize muscle frequency while allowing proper recovery.',
  },
  {
    icon: '📊',
    title: 'Personalized Volume',
    description: 'Volume adjusted to YOUR recovery capacity',
    detail: 'Your age, sleep quality, stress levels, and training experience are factored into a recovery multiplier that scales your weekly sets per muscle group.',
  },
  {
    icon: '🧠',
    title: 'DEXA-Informed Programming',
    description: 'Body composition data drives exercise selection',
    detail: 'If you have DEXA scan data, we analyze regional lean mass to identify lagging areas and prioritize exercises for balanced development.',
  },
  {
    icon: '⚡',
    title: 'Fatigue Management System',
    description: 'Dual fatigue tracking prevents overtraining',
    detail: 'We track both systemic fatigue (CNS, whole-body) with a weekly budget, and local muscle fatigue to ensure proper recovery between sessions.',
  },
  {
    icon: '🏋️',
    title: 'Exercise Tier System',
    description: 'S-tier exercises prioritized for maximum ROI',
    detail: 'Exercises are ranked by effectiveness. S-tier compounds get priority placement. Short on time? We select only the highest-impact movements.',
  },
  {
    icon: '🔧',
    title: 'Equipment Awareness',
    description: 'Programs adapt to your available equipment',
    detail: 'Marked equipment as unavailable in your gym settings? We automatically substitute with equivalent movements you can actually perform.',
  },
];

const periodizationDetails = [
  {
    week: '1',
    title: 'Foundation Week',
    description: 'Establish baseline with moderate volume and intensity',
    intensity: '70-75%',
    volume: '100%',
  },
  {
    week: '2-3',
    title: 'Accumulation',
    description: 'Progressive overload - add weight or reps each session',
    intensity: '75-80%',
    volume: '105-110%',
  },
  {
    week: '4-5',
    title: 'Intensification',
    description: 'Push toward peak performance as fatigue accumulates',
    intensity: '80-85%',
    volume: '110-115%',
  },
  {
    week: 'Final',
    title: 'Deload',
    description: 'Reduce volume 50% to dissipate fatigue and supercompensate',
    intensity: '70-75%',
    volume: '50%',
  },
];

const scienceHighlights = [
  {
    title: 'Muscle Protein Synthesis',
    value: '24-72h',
    description: 'Window of elevated MPS after training - why frequency matters',
  },
  {
    title: 'Recovery Between Sessions',
    value: '48-96h',
    description: 'Optimal time before training same muscle again',
  },
  {
    title: 'Volume Response Variance',
    value: '3x',
    description: 'Difference between low and high responders in research',
  },
  {
    title: 'Deload Frequency',
    value: '4-6 weeks',
    description: 'Typical fatigue accumulation timeline before performance drops',
  },
];

export default function MesocycleScienceArticle() {
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
          <span className="text-4xl">🔬</span>
          <span className="px-3 py-1 bg-accent-500/10 text-accent-400 rounded-full text-xs font-medium">
            AI Training Science
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">
          The Science Behind Your Mesocycle
        </h1>
        <p className="text-lg text-surface-400">
          How we build AI-powered training programs that adapt to YOUR body and recovery capacity.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-surface-300">
        {/* What is a Mesocycle */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">What is a Mesocycle?</h2>
          <Card className="p-5 bg-accent-500/10 border-accent-500/20 mb-4">
            <p className="text-lg text-accent-300">
              A mesocycle is a 4-8 week training block designed to push your body, accumulate productive fatigue, then recover stronger.
            </p>
          </Card>
          <p className="mb-4">
            Think of it as a &ldquo;chapter&rdquo; in your training story. Each mesocycle has a beginning (establishing baseline),
            middle (progressive overload), and end (deload to recover). This structured approach prevents the random,
            wandering training that leads to plateaus.
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <Card className="p-4">
              <p className="text-2xl font-bold text-primary-400">4-8</p>
              <p className="text-xs text-surface-500">Weeks per cycle</p>
            </Card>
            <Card className="p-4">
              <p className="text-2xl font-bold text-success-400">10-15%</p>
              <p className="text-xs text-surface-500">Volume increase</p>
            </Card>
            <Card className="p-4">
              <p className="text-2xl font-bold text-warning-400">50%</p>
              <p className="text-xs text-surface-500">Deload reduction</p>
            </Card>
          </div>
        </section>

        {/* AI Features */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">AI-Powered Features</h2>
          <p className="mb-6 text-surface-400">
            Our mesocycle builder isn&apos;t just a template generator. It&apos;s a sophisticated system that considers
            multiple factors to create a program truly personalized to you.
          </p>
          <div className="space-y-4">
            {aiFeatures.map((feature, idx) => (
              <Card key={idx} className="p-4">
                <div className="flex items-start gap-4">
                  <div className="text-2xl shrink-0">{feature.icon}</div>
                  <div>
                    <h4 className="font-semibold text-surface-100">{feature.title}</h4>
                    <p className="text-sm text-primary-400 mb-2">{feature.description}</p>
                    <p className="text-sm text-surface-400">{feature.detail}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Recovery Profile */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Your Recovery Profile</h2>
          <p className="mb-4 text-surface-400">
            Generic programs assume everyone recovers the same. We don&apos;t. Your recovery profile creates a personalized
            &ldquo;volume multiplier&rdquo; that scales your training appropriately.
          </p>
          <Card className="p-4 bg-surface-800/50">
            <h4 className="font-semibold text-surface-200 mb-3">Factors We Analyze:</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span>😴</span>
                <span className="text-surface-400">Sleep Quality (1-5)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>😰</span>
                <span className="text-surface-400">Life Stress Levels (1-5)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>📅</span>
                <span className="text-surface-400">Training Age (years lifting)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🎂</span>
                <span className="text-surface-400">Biological Age</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🏅</span>
                <span className="text-surface-400">Experience Level</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🩹</span>
                <span className="text-surface-400">Injury History</span>
              </div>
            </div>
          </Card>
          <div className="mt-4 p-4 bg-warning-500/10 border border-warning-500/20 rounded-lg">
            <p className="text-sm text-warning-300">
              <strong>Example:</strong> Poor sleep (2/5) + high stress (4/5) might reduce your volume multiplier to 80%,
              meaning we prescribe 20% less volume than someone with optimal recovery. This prevents overtraining
              when life is demanding.
            </p>
          </div>
        </section>

        {/* Periodization */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Periodization Model</h2>
          <p className="mb-6 text-surface-400">
            Your mesocycle follows a structured periodization model that progressively increases demand,
            then strategically reduces it to allow adaptation.
          </p>
          <div className="space-y-3">
            {periodizationDetails.map((phase, idx) => (
              <div key={idx} className="flex gap-4 items-start">
                <div className="w-12 h-12 rounded-lg bg-primary-500/20 flex items-center justify-center shrink-0">
                  <span className="text-primary-400 font-bold text-sm">{phase.week}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-surface-200">{phase.title}</h4>
                    <div className="flex gap-3 text-xs">
                      <span className="px-2 py-1 bg-surface-800 rounded text-surface-400">
                        Intensity: {phase.intensity}
                      </span>
                      <span className="px-2 py-1 bg-surface-800 rounded text-surface-400">
                        Volume: {phase.volume}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-surface-400 mt-1">{phase.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Fatigue Management */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Dual Fatigue Tracking</h2>
          <p className="mb-4 text-surface-400">
            We track two types of fatigue to prevent overtraining while maximizing productive stimulus:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4 bg-danger-500/5 border-danger-500/20">
              <h4 className="font-semibold text-danger-400 mb-2">Systemic Fatigue</h4>
              <p className="text-sm text-surface-400 mb-3">
                CNS and whole-body fatigue from training. Tracked via a weekly &ldquo;budget&rdquo; system.
              </p>
              <div className="space-y-1 text-xs text-surface-500">
                <p>• Compounds: 8-12 fatigue points</p>
                <p>• Isolations: 3-5 fatigue points</p>
                <p>• Weekly budget: ~100 points</p>
              </div>
            </Card>
            <Card className="p-4 bg-warning-500/5 border-warning-500/20">
              <h4 className="font-semibold text-warning-400 mb-2">Local Muscle Fatigue</h4>
              <p className="text-sm text-surface-400 mb-3">
                Per-muscle-group fatigue that requires 48-72 hours recovery.
              </p>
              <div className="space-y-1 text-xs text-surface-500">
                <p>• Recovery time varies by muscle</p>
                <p>• Large muscles: 72+ hours</p>
                <p>• Small muscles: 48 hours</p>
              </div>
            </Card>
          </div>
        </section>

        {/* Rep Range Science */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Fiber-Type Optimized Rep Ranges</h2>
          <p className="mb-4 text-surface-400">
            Different muscles have different fiber type compositions. We optimize rep ranges accordingly:
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-surface-800 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-danger-400"></span>
                <span className="text-surface-300">Fast-Twitch Dominant</span>
                <span className="text-xs text-surface-500">(Hamstrings, Triceps, Chest)</span>
              </div>
              <span className="font-mono text-surface-200 text-sm">4-8 reps</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-surface-800 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-warning-400"></span>
                <span className="text-surface-300">Mixed Fiber Type</span>
                <span className="text-xs text-surface-500">(Back, Quads, Biceps)</span>
              </div>
              <span className="font-mono text-surface-200 text-sm">6-12 reps</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-surface-800 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-success-400"></span>
                <span className="text-surface-300">Slow-Twitch Dominant</span>
                <span className="text-xs text-surface-500">(Calves, Delts, Core)</span>
              </div>
              <span className="font-mono text-surface-200 text-sm">10-20 reps</span>
            </div>
          </div>
          <p className="text-xs text-surface-500 mt-3">
            Compounds are placed early in sessions (when fresh) for heavier loading. Isolations finish the workout with higher reps.
          </p>
        </section>

        {/* Science Numbers */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">The Science in Numbers</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {scienceHighlights.map((stat, idx) => (
              <Card key={idx} className="p-4 text-center">
                <p className="text-2xl font-bold text-primary-400">{stat.value}</p>
                <p className="text-sm font-medium text-surface-200 mt-1">{stat.title}</p>
                <p className="text-xs text-surface-500 mt-1">{stat.description}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Auto-Deload Triggers */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Smart Deload Detection</h2>
          <p className="mb-4 text-surface-400">
            Besides scheduled deloads, we monitor for signs you need one early:
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3 bg-surface-800/50">
              <div className="flex items-center gap-2">
                <span className="text-danger-400">📉</span>
                <span className="text-sm text-surface-300">Performance drops 2+ sessions</span>
              </div>
            </Card>
            <Card className="p-3 bg-surface-800/50">
              <div className="flex items-center gap-2">
                <span className="text-danger-400">😴</span>
                <span className="text-sm text-surface-300">Sleep quality below 2/5</span>
              </div>
            </Card>
            <Card className="p-3 bg-surface-800/50">
              <div className="flex items-center gap-2">
                <span className="text-danger-400">🔴</span>
                <span className="text-sm text-surface-300">RPE consistently 9.5+</span>
              </div>
            </Card>
            <Card className="p-3 bg-surface-800/50">
              <div className="flex items-center gap-2">
                <span className="text-danger-400">💔</span>
                <span className="text-sm text-surface-300">Joint pain reported</span>
              </div>
            </Card>
            <Card className="p-3 bg-surface-800/50">
              <div className="flex items-center gap-2">
                <span className="text-danger-400">📊</span>
                <span className="text-sm text-surface-300">RIR drift detected</span>
              </div>
            </Card>
            <Card className="p-3 bg-surface-800/50">
              <div className="flex items-center gap-2">
                <span className="text-danger-400">⚠️</span>
                <span className="text-sm text-surface-300">Fatigue budget exceeded</span>
              </div>
            </Card>
          </div>
        </section>

        {/* Why This Matters */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Why This Matters</h2>
          <Card className="p-5 bg-success-500/10 border-success-500/20">
            <p className="text-success-300 mb-4">
              Most training apps give you a generic template. We build a program that:
            </p>
            <ul className="space-y-2 text-sm text-surface-300">
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>Adapts to YOUR recovery capacity, not population averages</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>Uses DEXA data to target YOUR lagging muscle groups</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>Tracks fatigue and warns you before overtraining</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>Adjusts to your schedule with optimal splits</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>Respects your equipment availability and injury history</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>Gets smarter over time as we learn YOUR response patterns</span>
              </li>
            </ul>
          </Card>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-accent-500/10 to-primary-500/10 border-accent-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Ready to Train Smarter?</h3>
            <p className="text-sm text-surface-400 mb-4">
              Create an AI-powered mesocycle tailored to your body, schedule, and goals.
            </p>
            <Link href="/dashboard/mesocycle/new">
              <button className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white font-semibold rounded-lg transition-colors">
                Create Mesocycle
              </button>
            </Link>
          </Card>
        </section>
      </article>

      {/* Related Articles */}
      <div className="mt-12 pt-8 border-t border-surface-800">
        <h3 className="text-lg font-semibold text-surface-100 mb-4">Related Articles</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/dashboard/learn/adaptive-volume">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <p className="font-medium text-surface-200">Adaptive Volume</p>
                  <p className="text-xs text-surface-500">How we learn your recovery capacity</p>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/dashboard/learn/progressive-overload">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📈</span>
                <div>
                  <p className="font-medium text-surface-200">Progressive Overload</p>
                  <p className="text-xs text-surface-500">The fundamental principle of growth</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
