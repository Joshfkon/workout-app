'use client';

import Link from 'next/link';

const features = [
  {
    icon: '🧠',
    title: 'AI-Powered Mesocycle Planning',
    description: 'Unlike basic workout trackers, HyperTracker uses intelligent algorithms to design periodized training programs tailored to your goals, experience, recovery capacity, and available time.',
    howItWorks: 'We analyze your training frequency, session duration, experience level, sleep quality, and stress to recommend the optimal split, volume distribution, and periodization model.',
  },
  {
    icon: '⚡',
    title: 'Auto-Regulation & Fatigue Management',
    description: 'Our fatigue budget system tracks both systemic (CNS) and local muscle fatigue, adjusting your workout in real-time.',
    howItWorks: 'Each exercise has a fatigue "cost". Compounds cost more (8-12 points) than isolations (3-5 points). When your weekly budget depletes, we suggest deloads before you burn out.',
  },
  {
    icon: '🎯',
    title: 'Smart Rep Range System',
    description: 'Rep ranges adapt based on muscle fiber type dominance, exercise position in workout, periodization phase, and your experience level.',
    howItWorks: 'Fast-twitch muscles (hamstrings, triceps) get 4-8 reps. Slow-twitch (calves, delts) get 12-20. Mixed-fiber (chest, back) get 8-12. Compounds start workouts heavier; isolations finish lighter.',
  },
  {
    icon: '📊',
    title: 'DEXA Tracking & FFMI Analysis',
    description: 'Track body composition scans over time. Calculate your Fat-Free Mass Index to see where you stand against natural limits.',
    howItWorks: 'Enter your DEXA scan data (or estimates). We calculate FFMI (Lean Mass / Height²) and compare you to natural benchmarks (21-25 range). AI coaching suggests bulk, cut, or recomp.',
  },
  {
    icon: '🔄',
    title: 'Reactive Deload Detection',
    description: 'HyperTracker monitors performance trends, sleep quality, motivation, and joint health to automatically suggest deloads before you overtrain.',
    howItWorks: 'If RPE consistently hits 9.5+, sleep drops below 2/5, or you miss rep targets for 2+ sessions, we trigger an early deload instead of waiting for a fixed schedule.',
  },
  {
    icon: '📈',
    title: 'E1RM Tracking & Plateau Detection',
    description: 'Track estimated one-rep max trends for every exercise. Our algorithms detect stagnation early and suggest interventions.',
    howItWorks: 'Using the Brzycki formula, we calculate E1RM from every working set. When your E1RM flatlines for 3+ sessions, we flag a plateau and suggest exercise swaps or intensity techniques.',
  },
];

const scienceConcepts = [
  {
    title: 'Volume Landmarks (MEV, MAV, MRV)',
    source: 'Renaissance Periodization',
    explanation: 'MEV (Minimum Effective Volume) is the least you need to grow. MAV (Maximum Adaptive Volume) is the sweet spot for gains. MRV (Maximum Recoverable Volume) is the ceiling—go beyond it and you regress.',
    application: 'We track your weekly sets per muscle and keep you in the productive zone—typically 10-20 sets/week for most muscles, adjusted for your recovery capacity.',
  },
  {
    title: 'Stimulus-to-Fatigue Ratio (SFR)',
    source: 'Dr. Mike Israetel',
    explanation: 'Not all exercises are equal. A machine fly gives great chest stimulus with minimal fatigue to recover from. A barbell bench press stimulates chest but also taxes shoulders, triceps, and CNS.',
    application: 'When building your program, we prioritize high-SFR exercises (machines, cables, isolation work) later in mesocycles when fatigue is high, saving low-SFR compounds for when you&apos;re fresh.',
  },
  {
    title: 'Muscle Fiber Type Dominance',
    source: 'Exercise Physiology Research',
    explanation: 'Muscles have different proportions of fast-twitch (explosive, fatigable) and slow-twitch (endurance, resistant) fibers. Each type responds to different rep ranges.',
    application: 'Hamstrings are ~70% fast-twitch → respond to 4-8 reps. Calves are ~60% slow-twitch → need 15-25 reps. Your rep ranges should reflect the muscle being trained, not a one-size-fits-all &quot;3x10&quot;.',
  },
  {
    title: 'Autoregulation with RPE/RIR',
    source: 'Powerlifting & Sports Science',
    explanation: 'RPE (Rate of Perceived Exertion) and RIR (Reps in Reserve) let you train to appropriate intensity based on how you feel that day, not a fixed percentage of 1RM that ignores recovery state.',
    application: 'Start mesocycles at 3 RIR (could do 3 more). Progress to 1 RIR by the end. Last sets can go to 0 RIR. This systematic approach ensures progressive overload without burning out.',
  },
  {
    title: 'Daily Undulating Periodization (DUP)',
    source: 'Dr. Greg Nuckols & Others',
    explanation: 'Instead of training heavy for weeks then light for weeks (linear periodization), DUP rotates intensity daily. Monday: strength (4-6 reps). Wednesday: hypertrophy (8-12). Friday: power (explosive work).',
    application: 'Our mesocycle builder can create DUP programs that hit each muscle with different stimuli each session, maximizing both strength and size adaptations.',
  },
  {
    title: 'Progressive Overload Mechanics',
    source: 'Fundamental Training Principle',
    explanation: 'To grow, you must progressively do more: more weight, more reps, more sets, less rest, better technique. The body adapts to what you demand of it.',
    application: 'Each week, we suggest adding 1-2 reps or 2.5% weight to key lifts. When you hit the top of your rep range with good form, we recommend increasing load.',
  },
];

const comparisonTable = [
  { feature: 'AI Mesocycle Generation', hypertracker: true, others: false },
  { feature: 'Fatigue Budget System', hypertracker: true, others: false },
  { feature: 'Fiber Type Optimization', hypertracker: true, others: false },
  { feature: 'DEXA/FFMI Tracking', hypertracker: true, others: false },
  { feature: 'Reactive Deload Detection', hypertracker: true, others: false },
  { feature: 'Set Quality Analysis', hypertracker: true, others: false },
  { feature: 'Regional Body Comp Analysis', hypertracker: true, others: false },
  { feature: 'Smart Weight Recommendations', hypertracker: true, others: 'partial' },
  { feature: 'Basic Workout Logging', hypertracker: true, others: true },
];

export default function LearnPage() {
  return (
    <div className="min-h-screen bg-surface-950">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-primary-900/30 via-transparent to-transparent" />
          <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-purple-900/20 via-transparent to-transparent" />
        </div>
        
        <div className="relative max-w-6xl mx-auto px-4 py-20">
          <Link href="/" className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-200 mb-8 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Home
          </Link>
          
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6">
            The Science Behind{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-purple-400">
              HyperTracker
            </span>
          </h1>
          <p className="text-xl text-surface-300 max-w-3xl">
            We didn&apos;t just build another workout logger. We encoded decades of exercise science research 
            into algorithms that optimize your training in real-time.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 pb-20 space-y-20">
        
        {/* The Problem */}
        <section className="py-12 border-b border-surface-800">
          <h2 className="text-3xl font-bold text-white mb-6">The Problem with Most Workout Apps</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="p-6 bg-surface-900/50 rounded-xl border border-surface-800">
              <div className="text-4xl mb-4">📝</div>
              <h3 className="font-semibold text-surface-200 mb-2">They&apos;re Just Digital Notepads</h3>
              <p className="text-surface-400 text-sm">
                Log your sets, see a chart, repeat. No intelligence, no optimization, no understanding of WHY you&apos;re doing what you&apos;re doing.
              </p>
            </div>
            <div className="p-6 bg-surface-900/50 rounded-xl border border-surface-800">
              <div className="text-4xl mb-4">🎲</div>
              <h3 className="font-semibold text-surface-200 mb-2">Random Workout Generators</h3>
              <p className="text-surface-400 text-sm">
                Some apps generate workouts, but without understanding periodization, fatigue accumulation, or your specific needs. It&apos;s fitness roulette.
              </p>
            </div>
            <div className="p-6 bg-surface-900/50 rounded-xl border border-surface-800">
              <div className="text-4xl mb-4">🔄</div>
              <h3 className="font-semibold text-surface-200 mb-2">One-Size-Fits-All Volume</h3>
              <p className="text-surface-400 text-sm">
                &quot;Do 3x10 for everything&quot; ignores that muscles respond differently, people recover differently, and goals require different approaches.
              </p>
            </div>
          </div>
        </section>

        {/* Features Deep Dive */}
        <section>
          <h2 className="text-3xl font-bold text-white mb-8 text-center">Features That Actually Matter</h2>
          <div className="space-y-8">
            {features.map((feature, idx) => (
              <div 
                key={feature.title}
                className={`p-8 rounded-2xl border ${
                  idx % 2 === 0 
                    ? 'bg-gradient-to-r from-primary-500/5 to-transparent border-primary-500/20' 
                    : 'bg-gradient-to-r from-purple-500/5 to-transparent border-purple-500/20'
                }`}
              >
                <div className="flex items-start gap-6">
                  <div className="text-5xl shrink-0">{feature.icon}</div>
                  <div>
                    <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
                    <p className="text-surface-300 mb-4">{feature.description}</p>
                    <div className="p-4 bg-surface-900/50 rounded-lg border border-surface-700">
                      <p className="text-sm text-surface-400">
                        <span className="font-semibold text-primary-400">How it works: </span>
                        {feature.howItWorks}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The Science */}
        <section>
          <h2 className="text-3xl font-bold text-white mb-4 text-center">Built on Real Science</h2>
          <p className="text-center text-surface-400 mb-12 max-w-2xl mx-auto">
            Every algorithm in HyperTracker is based on peer-reviewed research and proven training methodologies.
          </p>
          
          <div className="grid gap-6">
            {scienceConcepts.map((concept) => (
              <div key={concept.title} className="p-6 bg-surface-900/50 rounded-xl border border-surface-800 hover:border-surface-700 transition-colors">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h3 className="text-lg font-bold text-white">{concept.title}</h3>
                  <span className="px-3 py-1 bg-surface-800 rounded-full text-xs text-surface-400 shrink-0">
                    {concept.source}
                  </span>
                </div>
                <p className="text-surface-300 mb-4">{concept.explanation}</p>
                <div className="flex items-start gap-2 p-3 bg-primary-500/10 rounded-lg border border-primary-500/20">
                  <svg className="w-5 h-5 text-primary-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-primary-300">
                    <span className="font-semibold">In HyperTracker:</span> {concept.application}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Comparison */}
        <section>
          <h2 className="text-3xl font-bold text-white mb-8 text-center">How We Compare</h2>
          <div className="overflow-hidden rounded-xl border border-surface-800">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-800/70">
                  <th className="text-left p-4 text-surface-300 font-medium">Feature</th>
                  <th className="text-center p-4 text-primary-400 font-bold">HyperTracker</th>
                  <th className="text-center p-4 text-surface-400 font-medium">Other Apps</th>
                </tr>
              </thead>
              <tbody>
                {comparisonTable.map((row, idx) => (
                  <tr 
                    key={row.feature} 
                    className={idx % 2 === 0 ? 'bg-surface-900/30' : 'bg-surface-900/10'}
                  >
                    <td className="p-4 text-surface-300">{row.feature}</td>
                    <td className="p-4 text-center">
                      <span className="text-success-400 text-xl">✓</span>
                    </td>
                    <td className="p-4 text-center">
                      {row.others === true ? (
                        <span className="text-success-400 text-xl">✓</span>
                      ) : row.others === 'partial' ? (
                        <span className="text-warning-400">◐</span>
                      ) : (
                        <span className="text-surface-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Who It's For */}
        <section className="text-center">
          <h2 className="text-3xl font-bold text-white mb-8">Who Is HyperTracker For?</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary-500/20 to-purple-500/20 flex items-center justify-center">
                <span className="text-4xl">🏆</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Intermediate Lifters</h3>
              <p className="text-surface-400">
                Past the beginner gains, ready to maximize the next phase with intelligent programming.
              </p>
            </div>
            <div className="p-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary-500/20 to-purple-500/20 flex items-center justify-center">
                <span className="text-4xl">📚</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Science-Based Lifters</h3>
              <p className="text-surface-400">
                You&apos;ve read the research and want an app that actually implements it. No bro-science.
              </p>
            </div>
            <div className="p-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary-500/20 to-purple-500/20 flex items-center justify-center">
                <span className="text-4xl">⚙️</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Optimization Nerds</h3>
              <p className="text-surface-400">
                You want to squeeze every drop of gains from your training. Efficiency over effort.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12 px-8 bg-gradient-to-r from-primary-500/10 via-purple-500/10 to-primary-500/10 rounded-2xl border border-primary-500/20">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Train Smarter?</h2>
          <p className="text-surface-300 mb-8 max-w-xl mx-auto">
            Stop leaving gains on the table with outdated training methods. 
            Join the evidence-based lifting revolution.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="px-8 py-4 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-primary-500/25"
            >
              Get Started Free
            </Link>
            <Link
              href="/login"
              className="px-8 py-4 bg-surface-800 hover:bg-surface-700 text-surface-200 font-semibold rounded-xl transition-colors"
            >
              Sign In
            </Link>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-surface-800 py-8 text-center">
        <p className="text-sm text-surface-500">
          HyperTracker © {new Date().getFullYear()} • Built with ❤️ for the lifting community
        </p>
      </div>
    </div>
  );
}

