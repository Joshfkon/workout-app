'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

export default function AdaptiveTDEEArticle() {
  useDocumentTitle('Adaptive TDEE');
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
          <span className="text-4xl">🔥</span>
          <span className="px-3 py-1 bg-orange-500/10 text-orange-400 rounded-full text-xs font-medium">
            Nutrition Science
          </span>
        </div>
        <h1 className="text-3xl font-bold text-ink mb-3">
          How We Calculate Your Metabolism
        </h1>
        <p className="text-lg text-ink-2">
          Why generic formulas fail, and how we use your actual data for pinpoint accuracy.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-ink-2">
        {/* The Problem */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">
            The Problem with Generic Formulas
          </h2>
          <p className="mb-4">
            Most fitness apps estimate your Total Daily Energy Expenditure (TDEE) using formulas
            like Mifflin-St Jeor or Harris-Benedict. These formulas use your age, height, weight,
            and a rough activity multiplier.
          </p>
          <Card className="p-4 bg-status-bad/10 border-status-bad/20 mb-4">
            <p className="text-status-bad font-medium mb-2">The problem?</p>
            <p className="text-sm text-ink-2">
              These formulas can be off by <strong className="text-ink">300-500+ calories</strong>.
              That&apos;s the difference between losing 1 lb/week and maintaining.
            </p>
          </Card>
          <p className="mb-4">Everyone&apos;s metabolism is different:</p>
          <ul className="list-disc list-inside space-y-2 text-ink-2 ml-4">
            <li>
              <strong className="text-ink-2">Muscle mass</strong> - muscle burns more than fat
            </li>
            <li>
              <strong className="text-ink-2">NEAT</strong> - fidgeting, walking, daily movement
            </li>
            <li>
              <strong className="text-ink-2">Hormonal factors</strong> - thyroid, cortisol, etc.
            </li>
            <li>
              <strong className="text-ink-2">Metabolic adaptation</strong> - from dieting history
            </li>
          </ul>
          <p className="mt-4 text-sm text-ink-3">
            A 180 lb sedentary office worker and a 180 lb construction worker have vastly different
            calorie needs, even with the same &quot;activity level&quot; selected.
          </p>
        </section>

        {/* Our Approach */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">
            Our Approach: Your Body Tells Us
          </h2>
          <p className="mb-4">
            Instead of guessing, we calculate your actual burn rate from your real data.
          </p>
          <Card className="p-5 bg-action/10 border-action/20 mb-6">
            <p className="font-semibold text-action mb-3">The physics is simple:</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-action">•</span>
                <span>1 lb of fat ≈ 3,500 calories</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-action">•</span>
                <span>If you eat 500 cal below your TDEE daily, you lose ~1 lb/week</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-action">•</span>
                <span>If you eat at TDEE, weight stays stable</span>
              </li>
            </ul>
          </Card>
          <p className="mb-4">
            By tracking your <strong>actual weight changes</strong> against your{' '}
            <strong>actual calorie intake</strong>, we can back-calculate your true TDEE.
          </p>
        </section>

        {/* The Math */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">The Equation</h2>
          <Card className="p-5 bg-fill/50 font-mono text-sm space-y-3 mb-4">
            <div>
              <p className="text-ink-3">Weight change formula:</p>
              <p className="text-ink">Weight_change = (Calories_in - TDEE) / 3500</p>
            </div>
            <div>
              <p className="text-ink-3">
                Over any interval between two weigh-ins, solve for TDEE:
              </p>
              <p className="text-ink">
                TDEE = mean_daily_intake − (ΔWeight × 3500) / interval_days
              </p>
            </div>
          </Card>
          <p className="text-sm text-ink-3 mb-4">
            This is the key: the math works over an <strong className="text-ink-2">interval</strong>,
            not a single day. It needs your <strong className="text-ink-2">intake logged
            consistently</strong> and just two weigh-ins far enough apart — not a weigh-in every
            single day. Weighing more often only sharpens the picture.
          </p>
          <p className="text-sm text-ink-3">
            We smooth your weigh-ins into a <strong className="text-ink-2">trend weight</strong>{' '}
            first (a single scale reading carries ±1–2 lb of water and glycogen noise), then average
            several intervals — weighting recent ones more, because metabolism adapts.
          </p>
        </section>

        {/* How It Works */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">How It Works</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-action/20 flex items-center justify-center shrink-0">
                <span className="text-action font-bold">1</span>
              </div>
              <div>
                <p className="font-medium text-ink">Log your food</p>
                <p className="text-sm text-ink-3">As accurately as possible</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-action/20 flex items-center justify-center shrink-0">
                <span className="text-action font-bold">2</span>
              </div>
              <div>
                <p className="font-medium text-ink">Weigh in 2–3× a week</p>
                <p className="text-sm text-ink-3">
                  Same time, same conditions (morning, after bathroom). Daily is welcome but not
                  required — a couple of weigh-ins a week is enough.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-action/20 flex items-center justify-center shrink-0">
                <span className="text-action font-bold">3</span>
              </div>
              <div>
                <p className="font-medium text-ink">We run the math</p>
                <p className="text-sm text-ink-3">
                  We measure energy balance over the interval between your weigh-ins, using your
                  smoothed trend weight
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-status-ok/20 flex items-center justify-center shrink-0">
                <span className="text-status-ok font-bold">4</span>
              </div>
              <div>
                <p className="font-medium text-ink">A number from day one</p>
                <p className="text-sm text-ink-3">
                  You start with the formula estimate and it personalizes toward your measured
                  reality with every interval — no waiting for the feature to &quot;unlock&quot;
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The Convergence */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">The Convergence Graph</h2>
          <p className="mb-4">
            On day one the number is the formula estimate. As each weigh-in interval closes, the
            estimate is nudged from that starting point toward your measured reality — a smooth,
            gradual drift, never a sudden switch. Early on it leans on the formula; over a few weeks
            it becomes almost entirely your own data.
          </p>
          <Card className="p-6 bg-fill/30 mb-4">
            <div className="text-center text-ink-3 text-sm mb-4">
              Example Convergence Pattern
            </div>
            <div className="h-40 flex items-end justify-between gap-1 px-4">
              {/* Simulated chart bars showing convergence */}
              {[16, 15.2, 14.8, 15.5, 14.2, 14.0, 13.8, 13.9, 13.7, 13.6, 13.5, 13.5, 13.4, 13.4].map(
                (val, i) => (
                  <div
                    key={i}
                    className="bg-orange-500 flex-1 rounded-t"
                    style={{ height: `${((val - 12) / 5) * 100}%` }}
                  />
                )
              )}
            </div>
            <div className="flex justify-between text-xs text-ink-3 mt-2 px-4">
              <span>Day 1</span>
              <span>Day 7</span>
              <span>Day 14</span>
            </div>
            <p className="text-center text-xs text-ink-3 mt-4">
              The estimate drifts from formula toward your data as intervals close
            </p>
          </Card>
          <p className="text-sm text-ink-3">
            After a few weeks of consistent food logging plus a couple of weigh-ins each week, the
            number is almost entirely your own data. This is YOUR actual metabolism, not a
            formula&apos;s guess.
          </p>
        </section>

        {/* Why It Matters */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">Why This Matters</h2>
          <Card className="p-5 space-y-4 mb-4">
            <div className="flex items-center justify-between py-2 border-b border-sep">
              <span className="text-ink-2">Generic formula says:</span>
              <span className="font-medium text-ink">2,400 cal/day</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-sep">
              <span className="text-ink-2">Your actual TDEE:</span>
              <span className="font-medium text-status-warn">2,150 cal/day</span>
            </div>
            <div className="pt-2">
              <p className="text-sm text-ink-3">
                If you ate at the formula&apos;s &quot;500 calorie deficit&quot; (1,900 cal), you&apos;d actually
                only be in a <strong className="text-ink-2">250 cal deficit</strong>. Half
                the expected fat loss!
              </p>
            </div>
          </Card>
          <p className="mb-4">With your personalized number, predictions become accurate:</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-status-ok">✓</span>
              <span>&quot;At 1,800 cal/day, you&apos;ll hit 170 lbs by March 15&quot;</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-status-ok">✓</span>
              <span>&quot;To lose 1 lb/week, eat 1,650 cal/day&quot;</span>
            </li>
          </ul>
        </section>

        {/* Tips */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">Tips for Accuracy</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4 bg-status-ok/10 border-status-ok/20">
              <p className="font-medium text-status-ok mb-2">Do:</p>
              <ul className="space-y-1 text-sm text-ink-2">
                <li>• Weigh in 2–3× a week at the same time</li>
                <li>• Log everything you eat, every day</li>
                <li>• Keep logging through a phase change (we handle the water jump)</li>
                <li>• Use a food scale when possible</li>
              </ul>
            </Card>
            <Card className="p-4 bg-status-bad/10 border-status-bad/20">
              <p className="font-medium text-status-bad mb-2">Don&apos;t:</p>
              <ul className="space-y-1 text-sm text-ink-2">
                <li>• Skip logging days</li>
                <li>• Guess at portions</li>
                <li>• Panic at daily weight swings</li>
                <li>• Change diet drastically mid-tracking</li>
              </ul>
            </Card>
          </div>
        </section>

        {/* The Math Deep Dive */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4">
            The Math (For Nerds)
          </h2>
          <Card className="p-5 bg-fill/50">
            <p className="text-sm text-ink-2 mb-4">
              We use ordinary least-squares regression to find the α (alpha) value that minimizes
              prediction error:
            </p>
            <div className="font-mono text-sm space-y-2 p-4 bg-card rounded-lg mb-4">
              <p className="text-ink-2">TDEE = α × Body_Weight</p>
              <p className="text-ink-3 text-xs mt-2">Where α ≈ 12-16 cal/lb for most people</p>
            </div>
            <p className="text-sm text-ink-2 mb-3">We minimize:</p>
            <div className="font-mono text-sm p-4 bg-card rounded-lg mb-4">
              <p className="text-ink-2">Σ(predicted_weight - actual_weight)²</p>
            </div>
            <p className="text-sm text-ink-3">
              By finding the α that makes our predictions match reality most closely across your
              data window. Standard error tells us how confident we are. As you log more consistent
              data, standard error decreases and confidence increases.
            </p>
          </Card>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="bg-orange-500/10 p-6 text-center border-orange-500/20">
            <h3 className="text-lg font-bold text-ink mb-2">
              Ready to Track Your Metabolism?
            </h3>
            <p className="text-sm text-ink-2 mb-4">
              Start logging your weight and nutrition daily. Your personal TDEE estimate will be
              ready in 2-3 weeks.
            </p>
            <Link href="/dashboard/nutrition">
              <button className="px-6 py-2 bg-action hover:bg-action text-on-action font-semibold rounded-lg transition-colors">
                Go to Nutrition Tracking
              </button>
            </Link>
          </Card>
        </section>
      </article>

      {/* Related Articles */}
      <div className="mt-12 pt-8 border-t border-sep">
        <h3 className="text-lg font-semibold text-ink mb-4">Related Articles</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/dashboard/learn/injury-prevention">
            <Card className="p-4 hover:border-sep transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🛡️</span>
                <div>
                  <p className="font-medium text-ink">Smart Injury Prevention</p>
                  <p className="text-xs text-ink-3">How we keep you safe</p>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/dashboard/science">
            <Card className="p-4 hover:border-sep transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <p className="font-medium text-ink">All Science Principles</p>
                  <p className="text-xs text-ink-3">12+ research-backed algorithms</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
