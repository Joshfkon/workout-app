'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

const injuryCategories = [
  { name: 'Back', count: 4, examples: 'Lower back strain, Herniated disc, Sciatica' },
  { name: 'Shoulder', count: 3, examples: 'Impingement, Rotator cuff, Instability' },
  { name: 'Knee', count: 4, examples: 'Patellofemoral, Meniscus, ACL' },
  { name: 'Hip', count: 3, examples: 'Flexor strain, FAI, Bursitis' },
  { name: 'Arm', count: 3, examples: 'Elbow tendinitis, Wrist strain, Carpal tunnel' },
  { name: 'Neck/Ankle', count: 3, examples: 'Neck strain, Cervical disc, Ankle sprain' },
];

const safetyChecks = [
  {
    icon: '🎯',
    title: 'Primary & Secondary Muscles',
    description: 'Which muscles are doing the work',
    detail: 'We check if any of your injured muscles are directly targeted by the exercise.',
  },
  {
    icon: '⚙️',
    title: 'Stabilizer Muscles',
    description: 'What other apps miss',
    detail:
      'Bench press primarily works chest, but your lower back is working isometrically. If you have a back injury, bench can aggravate it.',
  },
  {
    icon: '🔩',
    title: 'Spinal Loading',
    description: 'Compression and shear force',
    detail: 'Exercises rated none/low/moderate/high. Back injuries filter out moderate and high spinal loading.',
  },
  {
    icon: '📐',
    title: 'Position Stress',
    description: 'Which joints are stressed',
    detail:
      'Each exercise maps which joints are under tension: lower back, shoulders, knees, wrists, elbows, hips, neck.',
  },
  {
    icon: '🔄',
    title: 'Movement Requirements',
    description: 'Required movement patterns',
    detail:
      'Does it require spinal flexion, extension, rotation, or a back arch? These are flagged for relevant injuries.',
  },
];

const exampleScenario = {
  injury: 'Lower back strain - moderate severity',
  avoid: [
    { name: 'Deadlift', reason: 'High spinal loading, requires extension' },
    { name: 'Barbell Row', reason: 'High spinal loading, back stabilization' },
    { name: 'Squat', reason: 'Moderate-high spinal loading' },
    { name: 'Good Morning', reason: 'High spinal loading, extension' },
  ],
  caution: [
    { name: 'Bench Press', reason: 'Requires back arch, moderate spinal stress' },
    { name: 'Hip Thrust', reason: 'Back arch position' },
  ],
  safe: [
    { name: 'Machine Chest Press', reason: 'Supported position, no spinal loading' },
    { name: 'Leg Extension', reason: 'No back involvement' },
    { name: 'Cable Fly', reason: 'No spinal loading, isolation movement' },
    { name: 'Lat Pulldown', reason: 'Supported, no axial loading' },
  ],
};

export default function InjuryPreventionArticle() {
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
          <span className="text-4xl">🛡️</span>
          <span className="px-3 py-1 bg-success-500/10 text-success-400 rounded-full text-xs font-medium">
            Safety
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">Smart Injury Prevention</h1>
        <p className="text-lg text-surface-400">
          How we analyze exercise biomechanics to keep you safe and suggest intelligent alternatives.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-surface-300">
        {/* Beyond Skip Leg Day */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Beyond &quot;Skip Leg Day&quot;
          </h2>
          <p className="mb-4">
            Most fitness apps handle injuries with a blunt instrument: &quot;Oh, you hurt your
            shoulder? Here, do legs instead.&quot;
          </p>
          <Card className="p-4 bg-danger-500/10 border-danger-500/20 mb-4">
            <p className="text-danger-300 font-medium mb-2">That&apos;s not good enough.</p>
            <p className="text-sm text-surface-400">
              A back injury doesn&apos;t just affect back exercises—it affects squats, deadlifts,
              bench press (yes, bench press), and dozens of other movements.
            </p>
          </Card>
          <p className="text-surface-400">
            We built a comprehensive system that actually understands exercise biomechanics.
          </p>
        </section>

        {/* What We Track */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">How We Analyze Exercises</h2>
          <p className="mb-6 text-surface-400">
            Every exercise in our database has detailed safety metadata:
          </p>
          <div className="space-y-4">
            {safetyChecks.map((check, idx) => (
              <Card key={idx} className="p-4">
                <div className="flex items-start gap-4">
                  <div className="text-2xl shrink-0">{check.icon}</div>
                  <div>
                    <h3 className="font-semibold text-surface-100">{check.title}</h3>
                    <p className="text-sm text-surface-500 mb-2">{check.description}</p>
                    <p className="text-sm text-surface-400">{check.detail}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Spinal Loading Table */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Spinal Loading Levels</h2>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-800">
                <tr>
                  <th className="px-4 py-3 text-left text-surface-300 font-medium">Level</th>
                  <th className="px-4 py-3 text-left text-surface-300 font-medium">Examples</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800">
                <tr className="bg-success-500/5">
                  <td className="px-4 py-3 font-medium text-success-400">None</td>
                  <td className="px-4 py-3 text-surface-400">
                    Machine chest press, leg extension
                  </td>
                </tr>
                <tr className="bg-primary-500/5">
                  <td className="px-4 py-3 font-medium text-primary-400">Low</td>
                  <td className="px-4 py-3 text-surface-400">
                    Cable exercises, most isolation work
                  </td>
                </tr>
                <tr className="bg-warning-500/5">
                  <td className="px-4 py-3 font-medium text-warning-400">Moderate</td>
                  <td className="px-4 py-3 text-surface-400">Bench press, lunges, hip thrusts</td>
                </tr>
                <tr className="bg-danger-500/5">
                  <td className="px-4 py-3 font-medium text-danger-400">High</td>
                  <td className="px-4 py-3 text-surface-400">Squats, deadlifts, barbell rows</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <p className="text-sm text-surface-500 mt-3">
            If you have a back injury, we automatically filter out moderate and high spinal loading
            exercises.
          </p>
        </section>

        {/* Example Scenario */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">How It Works In Practice</h2>
          <Card className="p-4 bg-surface-800/50 mb-4">
            <p className="text-sm text-surface-400 mb-2">You log:</p>
            <p className="font-medium text-surface-200">&quot;{exampleScenario.injury}&quot;</p>
          </Card>

          <p className="text-sm text-surface-400 mb-4">We ask follow-up questions:</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-surface-500 mb-6 ml-4">
            <li>Does bending forward hurt? (flexion)</li>
            <li>Does arching backward hurt? (extension)</li>
            <li>Does twisting hurt? (rotation)</li>
            <li>Does carrying heavy things hurt? (loading)</li>
          </ul>

          <p className="text-sm text-surface-400 mb-4">We then flag exercises:</p>

          <div className="space-y-4">
            {/* Avoid */}
            <Card className="p-4 bg-danger-500/10 border-danger-500/20">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-danger-400 text-xl">🔴</span>
                <span className="font-semibold text-danger-300">Avoid</span>
              </div>
              <ul className="space-y-2">
                {exampleScenario.avoid.map((ex, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-danger-400">×</span>
                    <div>
                      <span className="text-surface-200">{ex.name}</span>
                      <span className="text-surface-500 ml-2">— {ex.reason}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Caution */}
            <Card className="p-4 bg-warning-500/10 border-warning-500/20">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-warning-400 text-xl">🟡</span>
                <span className="font-semibold text-warning-300">Caution</span>
                <span className="text-xs text-surface-500">Use lighter weight, stop if discomfort</span>
              </div>
              <ul className="space-y-2">
                {exampleScenario.caution.map((ex, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-warning-400">⚠</span>
                    <div>
                      <span className="text-surface-200">{ex.name}</span>
                      <span className="text-surface-500 ml-2">— {ex.reason}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Safe */}
            <Card className="p-4 bg-success-500/10 border-success-500/20">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-success-400 text-xl">🟢</span>
                <span className="font-semibold text-success-300">Safe</span>
              </div>
              <ul className="space-y-2">
                {exampleScenario.safe.map((ex, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-success-400">✓</span>
                    <div>
                      <span className="text-surface-200">{ex.name}</span>
                      <span className="text-surface-500 ml-2">— {ex.reason}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </section>

        {/* Smart Substitutions */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Smart Substitutions</h2>
          <p className="mb-4 text-surface-400">
            When we flag an exercise, we don&apos;t just say &quot;don&apos;t do this.&quot; We offer
            alternatives:
          </p>
          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-sm text-surface-500 mb-2">Can&apos;t do Barbell Rows?</p>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-surface-800 rounded-full text-sm text-surface-300">
                  → Chest-Supported Row
                </span>
                <span className="px-3 py-1 bg-surface-800 rounded-full text-sm text-surface-300">
                  → Cable Row with back pad
                </span>
                <span className="px-3 py-1 bg-surface-800 rounded-full text-sm text-surface-300">
                  → Machine Row
                </span>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-surface-500 mb-2">Can&apos;t do Squats?</p>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-surface-800 rounded-full text-sm text-surface-300">
                  → Leg Press
                </span>
                <span className="px-3 py-1 bg-surface-800 rounded-full text-sm text-surface-300">
                  → Hack Squat
                </span>
                <span className="px-3 py-1 bg-surface-800 rounded-full text-sm text-surface-300">
                  → Leg Extension + Leg Curl
                </span>
              </div>
            </Card>
          </div>
          <p className="text-sm text-surface-500 mt-4">We prioritize:</p>
          <ol className="list-decimal list-inside space-y-1 text-sm text-surface-400 mt-2 ml-4">
            <li>Same muscle group</li>
            <li>Similar movement pattern</li>
            <li>Machine/supported versions</li>
            <li>Matching hypertrophy effectiveness</li>
          </ol>
        </section>

        {/* Injury Types */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">20+ Injury Types Supported</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {injuryCategories.map((cat, idx) => (
              <Card key={idx} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-surface-200">{cat.name}</span>
                  <span className="text-xs px-2 py-0.5 bg-surface-800 rounded-full text-surface-400">
                    {cat.count}
                  </span>
                </div>
                <p className="text-xs text-surface-500">{cat.examples}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Tracking Recovery */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Tracking Recovery</h2>
          <p className="mb-4 text-surface-400">
            As your injury heals, gradually reintroduce exercises:
          </p>
          <Card className="p-5">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 text-sm text-surface-500">Week 1-2</div>
                <div className="flex-1 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-success-500"></div>
                </div>
                <div className="text-sm text-surface-400">Only &quot;Safe&quot; exercises</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-16 text-sm text-surface-500">Week 3-4</div>
                <div className="flex-1 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div className="h-full w-2/3 bg-warning-500"></div>
                </div>
                <div className="text-sm text-surface-400">Add &quot;Caution&quot; at reduced weight</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-16 text-sm text-surface-500">Week 5+</div>
                <div className="flex-1 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div className="h-full w-full bg-primary-500"></div>
                </div>
                <div className="text-sm text-surface-400">Full exercise library</div>
              </div>
            </div>
          </Card>
        </section>

        {/* Discomfort Logging */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Discomfort Logging</h2>
          <p className="mb-4 text-surface-400">
            During workouts, you can log discomfort on any set:
          </p>
          <div className="flex gap-3 mb-4">
            <Card className="flex-1 p-3 text-center bg-warning-500/5 border-warning-500/20">
              <p className="text-warning-400 font-medium">Twinge</p>
              <p className="text-xs text-surface-500">Noticed something, minor</p>
            </Card>
            <Card className="flex-1 p-3 text-center bg-warning-500/10 border-warning-500/30">
              <p className="text-warning-300 font-medium">Discomfort</p>
              <p className="text-xs text-surface-500">Uncomfortable but manageable</p>
            </Card>
            <Card className="flex-1 p-3 text-center bg-danger-500/10 border-danger-500/20">
              <p className="text-danger-400 font-medium">Pain</p>
              <p className="text-xs text-surface-500">Should stop</p>
            </Card>
          </div>
          <Card className="p-4 bg-primary-500/10 border-primary-500/20">
            <p className="text-sm text-surface-400">
              If you log discomfort <strong className="text-surface-200">3+ times</strong> on the same body part
              in 2 weeks, we prompt:
            </p>
            <p className="text-sm text-primary-300 mt-2 italic">
              &quot;You&apos;ve logged knee discomfort multiple times. Want to track this as an injury
              for smarter exercise recommendations?&quot;
            </p>
          </Card>
        </section>

        {/* Volume and Injury Risk */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Volume and Injury Risk</h2>
          <p className="mb-4 text-surface-400">
            Excessive volume doesn&apos;t just hurt gains - it increases injury risk.
          </p>
          <Card className="p-4 bg-warning-500/10 border-warning-500/20 mb-4">
            <h4 className="font-semibold text-warning-300 mb-2">When fatigue accumulates:</h4>
            <ul className="space-y-2 text-sm text-surface-400">
              <li className="flex items-start gap-2">
                <span className="text-warning-400">{'\u26A0'}</span>
                <span>Form breaks down (the system tracks this)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning-400">{'\u26A0'}</span>
                <span>Stabilizer muscles fatigue before prime movers</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning-400">{'\u26A0'}</span>
                <span>Connective tissue stress accumulates</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning-400">{'\u26A0'}</span>
                <span>Reaction time and coordination suffer</span>
              </li>
            </ul>
          </Card>
          <p className="text-sm text-surface-400 mb-4">
            This is why we monitor form quality and RIR drift. Catching fatigue early isn&apos;t just
            about optimizing gains - it&apos;s injury prevention.
          </p>
          <Card className="p-4 bg-danger-500/10 border-danger-500/20">
            <p className="text-sm text-danger-300 font-medium">
              If you&apos;re seeing form degradation warnings, take them seriously. An ugly set today
              could be a tweaked back tomorrow.
            </p>
          </Card>
          <Link
            href="/dashboard/learn/adaptive-volume"
            className="block mt-4 text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            Learn more about our volume tracking {'\u2192'}
          </Link>
        </section>

        {/* The Bottom Line */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">The Bottom Line</h2>
          <Card className="p-5 bg-success-500/10 border-success-500/20">
            <p className="mb-3">
              We don&apos;t just track what muscles an exercise works. We understand:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>What stabilizes the movement</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>What loads the spine</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>What stresses each joint</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success-400">✓</span>
                <span>What positions are required</span>
              </li>
            </ul>
            <p className="mt-4 font-medium text-success-300">
              So when you&apos;re injured, we can give you a workout that&apos;s actually safe—not just
              &quot;do arms instead.&quot;
            </p>
          </Card>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-success-500/10 to-primary-500/10 border-success-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Have an Injury?</h3>
            <p className="text-sm text-surface-400 mb-4">
              Log it in your profile and we&apos;ll automatically adjust your workouts.
            </p>
            <Link href="/dashboard/profile">
              <button className="px-6 py-2 bg-success-500 hover:bg-success-600 text-white font-semibold rounded-lg transition-colors">
                Manage Injuries
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
                <span className="text-2xl">{'\uD83D\uDCCA'}</span>
                <div>
                  <p className="font-medium text-surface-200">Personalized Volume & Recovery</p>
                  <p className="text-xs text-surface-500">How we track fatigue to prevent injury</p>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/dashboard/learn/adaptive-tdee">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{'\uD83D\uDD25'}</span>
                <div>
                  <p className="font-medium text-surface-200">How We Calculate Your Metabolism</p>
                  <p className="text-xs text-surface-500">Adaptive TDEE estimation</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
