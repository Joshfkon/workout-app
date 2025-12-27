'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SafetyTierBadge, SafetyTierLegend } from '@/components/workout/SafetyTierBadge';
import { RPE_CALIBRATION_CONTENT, SAFETY_TIERS_CONTENT } from '@/lib/content/learnContent';

export default function RPECalibrationPage() {
  const rpeContent = RPE_CALIBRATION_CONTENT;
  const safetyContent = SAFETY_TIERS_CONTENT;

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      {/* Back link */}
      <Link
        href="/dashboard/learn"
        className="inline-flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to Learn
      </Link>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <span className="text-5xl">🎯</span>
          <div>
            <Badge variant="success" size="sm" className="mb-2">
              Training Science
            </Badge>
            <h1 className="text-2xl font-bold text-surface-100">{rpeContent.title}</h1>
            <p className="text-surface-400 mt-1">{rpeContent.description}</p>
          </div>
        </div>
      </div>

      {/* Quick summary card */}
      <Card className="p-6 bg-gradient-to-r from-success-500/10 to-transparent border-success-500/20">
        <h2 className="text-lg font-semibold text-surface-100 mb-3">Key Takeaways</h2>
        <ul className="space-y-2 text-sm text-surface-300">
          <li className="flex items-start gap-2">
            <span className="text-success-400 mt-0.5">✓</span>
            <span>Most lifters underestimate proximity to failure by 2-4 reps</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-success-400 mt-0.5">✓</span>
            <span>AMRAP sets on safe exercises calibrate your RPE perception</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-success-400 mt-0.5">✓</span>
            <span>Never go to failure on heavy barbell compounds - injury risk is too high</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-success-400 mt-0.5">✓</span>
            <span>Your bias is shown after each AMRAP so you can adjust future efforts</span>
          </li>
        </ul>
      </Card>

      {/* RPE Content Sections */}
      <div className="space-y-8">
        {rpeContent.sections.map((section, index) => (
          <section key={index} className="space-y-3">
            <h2 className="text-lg font-semibold text-surface-100">{section.heading}</h2>
            <div className="text-surface-300 leading-relaxed whitespace-pre-line text-sm">
              {section.content}
            </div>
          </section>
        ))}
      </div>

      {/* Safety Tiers Visual */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-surface-100 mb-4">Safety Tier Reference</h2>
        <p className="text-sm text-surface-400 mb-4">
          Every exercise in the app has a safety tier that determines how close to failure you should push.
        </p>

        <div className="space-y-4">
          {/* Push Freely */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-success-500/10 border border-success-500/20">
            <SafetyTierBadge tier="push_freely" showTooltip={false} />
            <div>
              <p className="text-sm font-medium text-success-400">Safe to Fail</p>
              <p className="text-xs text-surface-400 mt-1">
                Machines, cables, isolation exercises. The machine catches the weight.
                Use these for AMRAP calibration sets.
              </p>
              <p className="text-xs text-surface-500 mt-2">
                Examples: Leg press, chest fly machine, lat pulldown, cable curls
              </p>
            </div>
          </div>

          {/* Push Cautiously */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
            <SafetyTierBadge tier="push_cautiously" showTooltip={false} />
            <div>
              <p className="text-sm font-medium text-warning-400">Moderate Risk</p>
              <p className="text-xs text-surface-400 mt-1">
                Free weights that can be dropped, supported movements.
                Keep 1 rep in reserve normally, test at mesocycle end.
              </p>
              <p className="text-xs text-surface-500 mt-2">
                Examples: Dumbbell bench, lunges, Romanian deadlifts, step-ups
              </p>
            </div>
          </div>

          {/* Protect */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
            <SafetyTierBadge tier="protect" showTooltip={false} />
            <div>
              <p className="text-sm font-medium text-danger-400">Protect (Never Fail)</p>
              <p className="text-xs text-surface-400 mt-1">
                Heavy barbell compounds where failure means injury risk.
                Always stay at 2+ RIR. Use calibration from safe exercises.
              </p>
              <p className="text-xs text-surface-500 mt-2">
                Examples: Barbell bench press, back squat, deadlift, overhead press
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* RIR Reference */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-surface-100 mb-4">RIR Quick Reference</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-surface-800/50 rounded-lg text-center">
            <p className="text-2xl font-bold text-surface-100">4+</p>
            <p className="text-sm text-surface-400">Easy</p>
            <p className="text-xs text-surface-500">Could do 4+ more</p>
          </div>
          <div className="p-3 bg-surface-800/50 rounded-lg text-center">
            <p className="text-2xl font-bold text-primary-400">2-3</p>
            <p className="text-sm text-surface-400">Good</p>
            <p className="text-xs text-surface-500">Optimal training zone</p>
          </div>
          <div className="p-3 bg-surface-800/50 rounded-lg text-center">
            <p className="text-2xl font-bold text-warning-400">1</p>
            <p className="text-sm text-surface-400">Hard</p>
            <p className="text-xs text-surface-500">Could do 1 more</p>
          </div>
          <div className="p-3 bg-surface-800/50 rounded-lg text-center">
            <p className="text-2xl font-bold text-danger-400">0</p>
            <p className="text-sm text-surface-400">Failure</p>
            <p className="text-xs text-surface-500">No more reps possible</p>
          </div>
        </div>
      </Card>

      {/* Calibration Example */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-surface-100 mb-4">How Calibration Works</h2>
        <div className="space-y-4 text-sm">
          <div className="p-4 bg-surface-800/50 rounded-lg">
            <p className="text-surface-300 mb-3">
              <strong className="text-surface-100">Scenario:</strong> You&apos;ve been doing leg press, reporting
              your sets as &quot;8 reps @ RIR 3&quot; (implying you could do 11 total).
            </p>
            <p className="text-surface-300 mb-3">
              On your last set, we make it an AMRAP. You push to true failure and hit 14 reps.
            </p>
            <div className="grid grid-cols-3 gap-3 text-center py-3">
              <div>
                <p className="text-xs text-surface-500 uppercase">Predicted</p>
                <p className="text-xl font-bold text-surface-300">11</p>
              </div>
              <div>
                <p className="text-xs text-surface-500 uppercase">Actual</p>
                <p className="text-xl font-bold text-surface-100">14</p>
              </div>
              <div>
                <p className="text-xs text-surface-500 uppercase">Bias</p>
                <p className="text-xl font-bold text-warning-400">+3</p>
              </div>
            </div>
            <p className="text-surface-400">
              <strong className="text-warning-400">Result:</strong> You were sandbagging by 3 reps.
              Your &quot;hard&quot; sets weren&apos;t as hard as you thought. Time to push harder on your
              working sets.
            </p>
          </div>
        </div>
      </Card>

      {/* Related Articles */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-surface-100 mb-4">Related Articles</h2>
        <div className="space-y-3">
          <Link
            href="/dashboard/learn/progressive-overload"
            className="block p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors"
          >
            <p className="font-medium text-surface-200">Progressive Overload Explained</p>
            <p className="text-sm text-surface-500">The science of getting stronger over time</p>
          </Link>
          <Link
            href="/dashboard/learn/injury-prevention"
            className="block p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors"
          >
            <p className="font-medium text-surface-200">Smart Injury Prevention</p>
            <p className="text-sm text-surface-500">How we keep you safe with exercise analysis</p>
          </Link>
          <Link
            href="/dashboard/learn/adaptive-volume"
            className="block p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors"
          >
            <p className="font-medium text-surface-200">Personalized Volume & Recovery</p>
            <p className="text-sm text-surface-500">How we learn your optimal training volume</p>
          </Link>
        </div>
      </Card>

      {/* Back to learn */}
      <div className="text-center pt-4">
        <Link
          href="/dashboard/learn"
          className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
        >
          ← Back to all articles
        </Link>
      </div>
    </div>
  );
}
