'use client';

import { Card } from '@/components/ui';
import Link from 'next/link';

const features = [
  {
    icon: '🧠',
    title: 'AI-Powered Mesocycle Planning',
    description: 'Unlike basic workout trackers, HyperTracker uses intelligent algorithms to design periodized training programs tailored to your goals, experience, recovery capacity, and available time.',
    competitors: 'Most apps just let you log workouts. We plan them for you.',
  },
  {
    icon: '⚡',
    title: 'Auto-Regulation & Fatigue Management',
    description: 'Our fatigue budget system tracks both systemic (CNS) and local muscle fatigue, adjusting your workout in real-time. The Stimulus-to-Fatigue Ratio (SFR) ensures every exercise earns its place.',
    competitors: 'Other apps ignore fatigue. We optimize for sustainable gains.',
  },
  {
    icon: '🎯',
    title: 'Smart Rep Range System',
    description: 'Rep ranges adapt based on muscle fiber type dominance, exercise position in workout, periodization phase, and your experience level. Fast-twitch dominant muscles get heavier loads; slow-twitch get higher reps.',
    competitors: 'Generic "3x10" recommendations are obsolete.',
  },
  {
    icon: '📊',
    title: 'DEXA Tracking & FFMI Analysis',
    description: 'Track body composition scans over time. Calculate your Fat-Free Mass Index to see where you stand against natural limits. Get AI coaching recommendations for optimal recomposition.',
    competitors: 'No other workout app integrates body composition intelligence.',
  },
  {
    icon: '🔄',
    title: 'Reactive Deload Detection',
    description: 'HyperTracker monitors performance trends, sleep quality, motivation, and joint health to automatically suggest deloads before you overtrain—not on a fixed schedule.',
    competitors: 'Fixed "deload every 4th week" ignores individual recovery.',
  },
  {
    icon: '📈',
    title: 'E1RM Tracking & Plateau Detection',
    description: 'Track estimated one-rep max trends for every exercise. Our algorithms detect stagnation early and suggest exercise swaps, volume adjustments, or intensity changes.',
    competitors: 'Most apps just show raw numbers. We show trajectory.',
  },
  {
    icon: '🏋️',
    title: 'Intelligent Volume Landmarks',
    description: 'Set personalized MEV (Minimum Effective Volume) and MRV (Maximum Recoverable Volume) for each muscle group. HyperTracker keeps you in the productive zone.',
    competitors: 'Cookie-cutter volume prescriptions waste your time.',
  },
  {
    icon: '⏱️',
    title: 'Smart Rest Timer',
    description: 'Auto-starting rest timers with exercise-specific durations. Compounds get longer rest for strength; isolations get shorter rest for metabolic stress.',
    competitors: 'Basic timers ignore exercise context.',
  },
  {
    icon: '🔥',
    title: 'Set Quality Assessment',
    description: 'Every set is rated as stimulative, effective, or junk based on RPE, RIR, and rep targets. Know exactly which sets drove growth and which were wasted volume.',
    competitors: 'Logging without analysis is just a diary.',
  },
  {
    icon: '🎚️',
    title: 'Daily Undulating Periodization (DUP)',
    description: 'Automatically rotate through hypertrophy, strength, and power days within your week. Built-in tempo recommendations and rest period adjustments for each training style.',
    competitors: 'Linear periodization is outdated for intermediates.',
  },
  {
    icon: '🩹',
    title: 'Injury-Aware Programming',
    description: 'Mark injured areas in your profile. HyperTracker automatically excludes problematic exercises and suggests alternatives that work around limitations.',
    competitors: 'Most apps ignore injury history entirely.',
  },
  {
    icon: '📱',
    title: 'Mid-Workout Flexibility',
    description: 'Equipment taken? Add exercises on the fly. Our fatigue system recalculates to ensure you stay within productive limits even when improvising.',
    competitors: 'Rigid workout plans fail in real gym conditions.',
  },
];

type SupportLevel = boolean | 'partial';

interface ComparisonRow {
  feature: string;
  hypertracker: SupportLevel;
  strongApp: SupportLevel;
  hevy: SupportLevel;
  fitbod: SupportLevel;
}

function SupportIcon({ value }: { value: SupportLevel }) {
  if (value === true) return <span className="text-success-400">✓</span>;
  if (value === 'partial') return <span className="text-warning-400">◐</span>;
  return <span className="text-surface-600">—</span>;
}

const comparisonPoints: ComparisonRow[] = [
  { feature: 'AI Mesocycle Generation', hypertracker: true, strongApp: false, hevy: false, fitbod: 'partial' },
  { feature: 'Fatigue Budget System', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'SFR-Based Exercise Selection', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'DEXA/FFMI Tracking', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Reactive Deload Detection', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Muscle Fiber Type Optimization', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Volume Landmark Personalization', hypertracker: true, strongApp: false, hevy: false, fitbod: 'partial' },
  { feature: 'Set Quality Analysis', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'DUP/Block Periodization', hypertracker: true, strongApp: false, hevy: false, fitbod: 'partial' },
  { feature: 'Injury-Aware Substitutions', hypertracker: true, strongApp: false, hevy: false, fitbod: 'partial' },
  { feature: 'Basic Workout Logging', hypertracker: true, strongApp: true, hevy: true, fitbod: true },
  { feature: 'Exercise Library', hypertracker: true, strongApp: true, hevy: true, fitbod: true },
];

export default function AboutPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary-400 via-purple-400 to-pink-400">
          HyperTracker
        </h1>
        <p className="text-xl text-surface-300 max-w-2xl mx-auto">
          The most scientifically advanced hypertrophy training app ever built. 
          Not just a workout logger—your AI-powered muscle building co-pilot.
        </p>
      </div>

      {/* Philosophy */}
      <Card className="p-8 bg-gradient-to-br from-primary-500/10 to-purple-500/10 border-primary-500/20">
        <h2 className="text-2xl font-bold text-surface-100 mb-4">Our Philosophy</h2>
        <div className="space-y-4 text-surface-300">
          <p>
            <strong className="text-surface-100">Most workout apps are glorified notepads.</strong> They let you log sets and reps, 
            maybe show a graph, and call it a day. But logging without intelligence is just busywork.
          </p>
          <p>
            HyperTracker is built on the latest exercise science: Renaissance Periodization&apos;s volume landmarks, 
            Mike Israetel&apos;s SFR concepts, Greg Nuckols&apos; periodization research, and Brad Schoenfeld&apos;s 
            hypertrophy mechanisms. We&apos;ve encoded decades of research into algorithms that work for YOU.
          </p>
          <p>
            <strong className="text-surface-100">The result?</strong> Every set you do is intentional. Every exercise is optimized. 
            Every deload is timed perfectly. No more guessing, no more junk volume, no more spinning your wheels.
          </p>
        </div>
      </Card>

      {/* Features Grid */}
      <div>
        <h2 className="text-2xl font-bold text-surface-100 mb-6 text-center">
          Features That Actually Matter
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature) => (
            <Card key={feature.title} className="p-5 hover:border-primary-500/30 transition-colors">
              <div className="text-3xl mb-3">{feature.icon}</div>
              <h3 className="text-lg font-semibold text-surface-100 mb-2">{feature.title}</h3>
              <p className="text-sm text-surface-400 mb-3">{feature.description}</p>
              <p className="text-xs text-primary-400 italic">{feature.competitors}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Comparison Table */}
      <div>
        <h2 className="text-2xl font-bold text-surface-100 mb-6 text-center">
          How We Compare
        </h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-800/50">
                  <th className="text-left p-4 text-surface-300 font-medium">Feature</th>
                  <th className="text-center p-4 text-primary-400 font-bold">HyperTracker</th>
                  <th className="text-center p-4 text-surface-400 font-medium">Strong</th>
                  <th className="text-center p-4 text-surface-400 font-medium">Hevy</th>
                  <th className="text-center p-4 text-surface-400 font-medium">Fitbod</th>
                </tr>
              </thead>
              <tbody>
                {comparisonPoints.map((row, idx) => (
                  <tr key={row.feature} className={idx % 2 === 0 ? 'bg-surface-900/30' : ''}>
                    <td className="p-4 text-surface-300">{row.feature}</td>
                    <td className="p-4 text-center">
                      {row.hypertracker ? (
                        <span className="text-success-400 text-xl">✓</span>
                      ) : (
                        <span className="text-surface-600">—</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <SupportIcon value={row.strongApp} />
                    </td>
                    <td className="p-4 text-center">
                      <SupportIcon value={row.hevy} />
                    </td>
                    <td className="p-4 text-center">
                      <SupportIcon value={row.fitbod} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-surface-800/30 border-t border-surface-800">
            <p className="text-xs text-surface-500 text-center">
              ✓ = Full support &nbsp;|&nbsp; ◐ = Partial/Limited &nbsp;|&nbsp; — = Not available
            </p>
          </div>
        </Card>
      </div>

      {/* Who It's For */}
      <Card className="p-8">
        <h2 className="text-2xl font-bold text-surface-100 mb-6 text-center">Who Is HyperTracker For?</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-4xl mb-3">🏆</div>
            <h3 className="font-semibold text-surface-200 mb-2">Intermediate Lifters</h3>
            <p className="text-sm text-surface-400">
              Past the beginner gains but want to maximize the next phase. You need smart programming, not just more volume.
            </p>
          </div>
          <div className="text-center">
            <div className="text-4xl mb-3">📚</div>
            <h3 className="font-semibold text-surface-200 mb-2">Evidence-Based Enthusiasts</h3>
            <p className="text-sm text-surface-400">
              You&apos;ve read the research and want an app that actually implements it. No bro-science here.
            </p>
          </div>
          <div className="text-center">
            <div className="text-4xl mb-3">⚙️</div>
            <h3 className="font-semibold text-surface-200 mb-2">Optimization Nerds</h3>
            <p className="text-sm text-surface-400">
              You want to squeeze every drop of gains from your training. You care about efficiency, not just effort.
            </p>
          </div>
        </div>
      </Card>

      {/* Science Section */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-surface-100 text-center">Built on Real Science</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="font-semibold text-surface-200 mb-2">Volume Landmarks (RP)</h3>
            <p className="text-sm text-surface-400">
              MEV, MAV, MRV concepts from Renaissance Periodization ensure you&apos;re always training in the productive zone—enough to grow, not so much you can&apos;t recover.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-surface-200 mb-2">Stimulus-to-Fatigue Ratio</h3>
            <p className="text-sm text-surface-400">
              Not all exercises are equal. Machine flyes give more chest stimulus per unit of fatigue than barbell bench. We optimize your exercise selection accordingly.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-surface-200 mb-2">Fiber Type Optimization</h3>
            <p className="text-sm text-surface-400">
              Calves are slow-twitch dominant (need high reps). Hamstrings are fast-twitch (respond to heavy loads). Your rep ranges should reflect this.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-surface-200 mb-2">Autoregulation & RPE</h3>
            <p className="text-sm text-surface-400">
              RIR (Reps in Reserve) targets that progress through your mesocycle. Start at 3 RIR, end at 0-1 RIR. Systematic overload without guessing.
            </p>
          </Card>
        </div>
      </div>

      {/* CTA */}
      <Card className="p-8 text-center bg-gradient-to-r from-primary-500/20 to-purple-500/20 border-primary-500/30">
        <h2 className="text-2xl font-bold text-surface-100 mb-2">Ready to Train Smarter?</h2>
        <p className="text-surface-400 mb-6">
          Stop leaving gains on the table with outdated training methods.
        </p>
        <div className="flex justify-center gap-4">
          <Link href="/dashboard/mesocycle/new">
            <button className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
              Create Your Mesocycle
            </button>
          </Link>
          <Link href="/dashboard">
            <button className="px-6 py-3 bg-surface-800 hover:bg-surface-700 text-surface-200 font-semibold rounded-lg transition-colors">
              Go to Dashboard
            </button>
          </Link>
        </div>
      </Card>

      {/* Footer note */}
      <p className="text-center text-xs text-surface-600">
        HyperTracker is continuously evolving. Built with ❤️ for the lifting community.
      </p>
    </div>
  );
}

