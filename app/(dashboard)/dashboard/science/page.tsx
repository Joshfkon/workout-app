'use client';

import { Card } from '@/components/ui';
import Link from 'next/link';

const scienceConcepts = [
  {
    title: 'Volume Landmarks (MEV, MAV, MRV)',
    source: 'Renaissance Periodization',
    icon: '📊',
    explanation: 'MEV (Minimum Effective Volume) is the least you need to grow. MAV (Maximum Adaptive Volume) is the sweet spot for gains. MRV (Maximum Recoverable Volume) is the ceiling—go beyond it and you regress.',
    application: 'We track your weekly sets per muscle and keep you in the productive zone—typically 10-20 sets/week for most muscles, adjusted for your recovery capacity.',
    color: 'primary',
  },
  {
    title: 'Stimulus-to-Fatigue Ratio (SFR)',
    source: 'Dr. Mike Israetel',
    icon: '⚡',
    explanation: 'Not all exercises are equal. A machine fly gives great chest stimulus with minimal fatigue to recover from. A barbell bench press stimulates chest but also taxes shoulders, triceps, and CNS.',
    application: 'When building your program, we prioritize high-SFR exercises (machines, cables, isolation work) later in mesocycles when fatigue is high, saving low-SFR compounds for when you\'re fresh.',
    color: 'accent',
  },
  {
    title: 'S-Tier Exercise Scoring',
    source: 'Hypertrophy Research',
    icon: '⭐',
    explanation: 'Exercises can be ranked by their hypertrophy effectiveness. S-tier exercises provide maximum muscle stimulus with favorable fatigue profiles and joint-friendly mechanics.',
    application: 'Every exercise in our database is rated S/A/B/C. Your mesocycle is built with S-tier exercises prioritized, ensuring you\'re doing the most effective movements for muscle growth.',
    color: 'warning',
  },
  {
    title: 'Muscle Fiber Type Dominance',
    source: 'Exercise Physiology Research',
    icon: '💪',
    explanation: 'Muscles have different proportions of fast-twitch (explosive, fatigable) and slow-twitch (endurance, resistant) fibers. Each type responds to different rep ranges.',
    application: 'Hamstrings are ~70% fast-twitch → respond to 4-8 reps. Calves are ~60% slow-twitch → need 15-25 reps. Your rep ranges reflect the muscle being trained.',
    color: 'danger',
  },
  {
    title: 'Evidence-Based Protein Requirements',
    source: 'Schoenfeld & Aragon Research',
    icon: '🥩',
    explanation: 'Muscle protein synthesis is maximized at 1.6-2.2g/kg of protein daily for trained individuals. Higher protein becomes even more critical during caloric deficits to prevent muscle loss.',
    application: 'Our macro calculator sets protein at 1g/lb (2.2g/kg) by default—the gold standard for lifters. When on GLP-1 medications, we increase to 1.2g/lb to protect muscle during aggressive cuts.',
    color: 'success',
  },
  {
    title: 'Autoregulation with RPE/RIR',
    source: 'Powerlifting & Sports Science',
    icon: '🎯',
    explanation: 'RPE (Rate of Perceived Exertion) and RIR (Reps in Reserve) let you train to appropriate intensity based on how you feel that day, not a fixed percentage of 1RM that ignores recovery state.',
    application: 'Start mesocycles at 3 RIR (could do 3 more). Progress to 1 RIR by the end. Last sets can go to 0 RIR. This systematic approach ensures progressive overload without burning out.',
    color: 'primary',
  },
  {
    title: 'TDEE & Adaptive Thermogenesis',
    source: 'Metabolic Research',
    icon: '🔥',
    explanation: 'Your Total Daily Energy Expenditure (TDEE) includes BMR, activity, and exercise. During dieting, metabolic adaptation can reduce TDEE by 10-15%. Tracking weight helps recalibrate.',
    application: 'Our macro calculator computes TDEE from your stats and activity level. When you log new weight, we automatically recalculate your targets to keep progress on track.',
    color: 'accent',
  },
  {
    title: 'Daily Undulating Periodization (DUP)',
    source: 'Dr. Greg Nuckols & Others',
    icon: '📈',
    explanation: 'Instead of training heavy for weeks then light for weeks (linear periodization), DUP rotates intensity daily. Monday: strength (4-6 reps). Wednesday: hypertrophy (8-12). Friday: power.',
    application: 'Our mesocycle builder can create DUP programs that hit each muscle with different stimuli each session, maximizing both strength and size adaptations.',
    color: 'warning',
  },
  {
    title: 'Fatigue Budget System',
    source: 'Training Load Research',
    icon: '😴',
    explanation: 'Both systemic (CNS) and local muscle fatigue accumulate during training. Exceeding your recovery capacity leads to overtraining, injury, and regression instead of gains.',
    application: 'Each exercise has a "fatigue cost" (compounds: 8-12 pts, isolations: 3-5 pts). We track your weekly fatigue budget and trigger deloads when you\'re approaching your limit.',
    color: 'danger',
  },
  {
    title: 'Progressive Overload Mechanics',
    source: 'Fundamental Training Principle',
    icon: '🏋️',
    explanation: 'To grow, you must progressively do more: more weight, more reps, more sets, less rest, better technique. The body adapts to what you demand of it.',
    application: 'Each week, we suggest adding 1-2 reps or 2.5% weight to key lifts. When you hit the top of your rep range with good form, we recommend increasing load.',
    color: 'success',
  },
  {
    title: 'FFMI & Natural Limits',
    source: 'Body Composition Research',
    icon: '📏',
    explanation: 'Fat-Free Mass Index (FFMI) normalizes lean mass by height. Natural lifters typically max out around 25 FFMI. Knowing your position helps set realistic expectations.',
    application: 'Enter your DEXA data and we calculate your FFMI. Compare against natural benchmarks to understand if you should bulk, cut, or recomp. AI coaching adapts recommendations accordingly.',
    color: 'primary',
  },
  {
    title: 'GLP-1 & Muscle Preservation',
    source: 'Recent Clinical Research',
    icon: '💊',
    explanation: 'GLP-1 agonists (Ozempic, Mounjaro) cause rapid weight loss, but up to 40% can be muscle without intervention. Higher protein and resistance training are essential for preservation.',
    application: 'When you indicate GLP-1 use, we boost protein targets to 1.2g/lb and ensure your training program maintains sufficient volume to preserve muscle during aggressive cuts.',
    color: 'accent',
  },
];

const colorClasses: Record<string, { bg: string; border: string; text: string }> = {
  primary: { bg: 'bg-primary-500/10', border: 'border-primary-500/20', text: 'text-primary-400' },
  accent: { bg: 'bg-accent-500/10', border: 'border-accent-500/20', text: 'text-accent-400' },
  warning: { bg: 'bg-warning-500/10', border: 'border-warning-500/20', text: 'text-warning-400' },
  danger: { bg: 'bg-danger-500/10', border: 'border-danger-500/20', text: 'text-danger-400' },
  success: { bg: 'bg-success-500/10', border: 'border-success-500/20', text: 'text-success-400' },
};

export default function SciencePage() {
  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 via-purple-400 to-pink-400">
          The Science Behind HyperTracker
        </h1>
        <p className="text-lg text-surface-400 max-w-2xl mx-auto">
          Every algorithm in HyperTracker is based on peer-reviewed research and proven training methodologies. 
          Here&apos;s the science that powers your gains.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-primary-400">12+</p>
          <p className="text-sm text-surface-400">Research Principles</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-accent-400">300K+</p>
          <p className="text-sm text-surface-400">Foods in Database</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-warning-400">500+</p>
          <p className="text-sm text-surface-400">S-Tier Exercises</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-success-400">AI</p>
          <p className="text-sm text-surface-400">Powered Coaching</p>
        </Card>
      </div>

      {/* Science Concepts */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-surface-100">Core Principles</h2>
        <div className="grid gap-4">
          {scienceConcepts.map((concept) => {
            const colors = colorClasses[concept.color];
            return (
              <Card key={concept.title} className={`p-6 ${colors.border} hover:border-opacity-50 transition-colors`}>
                <div className="flex items-start gap-4">
                  <div className={`text-3xl shrink-0`}>{concept.icon}</div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <h3 className="text-lg font-bold text-surface-100">{concept.title}</h3>
                      <span className={`px-3 py-1 ${colors.bg} ${colors.text} rounded-full text-xs font-medium shrink-0`}>
                        {concept.source}
                      </span>
                    </div>
                    <p className="text-surface-300">{concept.explanation}</p>
                    <div className={`p-3 ${colors.bg} rounded-lg border ${colors.border}`}>
                      <p className="text-sm">
                        <span className={`font-semibold ${colors.text}`}>In HyperTracker: </span>
                        <span className="text-surface-300">{concept.application}</span>
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Key Researchers */}
      <Card className="p-6">
        <h2 className="text-xl font-bold text-surface-100 mb-4">Standing on the Shoulders of Giants</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Mike Israetel</p>
            <p className="text-xs text-surface-500">Volume, SFR, RP System</p>
          </div>
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Brad Schoenfeld</p>
            <p className="text-xs text-surface-500">Hypertrophy Mechanisms</p>
          </div>
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Greg Nuckols</p>
            <p className="text-xs text-surface-500">Periodization Research</p>
          </div>
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Eric Helms</p>
            <p className="text-xs text-surface-500">Natural Bodybuilding</p>
          </div>
        </div>
      </Card>

      {/* CTA */}
      <Card className="p-8 text-center bg-gradient-to-r from-primary-500/10 via-purple-500/10 to-accent-500/10 border-primary-500/20">
        <h2 className="text-2xl font-bold text-surface-100 mb-2">Ready to Apply the Science?</h2>
        <p className="text-surface-400 mb-6">
          Stop guessing. Let evidence-based algorithms optimize your training and nutrition.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/dashboard/mesocycle/new">
            <button className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
              Create Mesocycle
            </button>
          </Link>
          <Link href="/dashboard/nutrition">
            <button className="px-6 py-3 bg-surface-800 hover:bg-surface-700 text-surface-200 font-semibold rounded-lg transition-colors">
              Set Up Nutrition
            </button>
          </Link>
          <Link href="/dashboard/about">
            <button className="px-6 py-3 bg-surface-800 hover:bg-surface-700 text-surface-200 font-semibold rounded-lg transition-colors">
              Learn More
            </button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

