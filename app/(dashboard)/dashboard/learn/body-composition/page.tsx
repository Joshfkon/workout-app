'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

export default function BodyCompositionArticle() {
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
          <span className="text-4xl">📊</span>
          <span className="px-3 py-1 bg-primary-500/10 text-primary-400 rounded-full text-xs font-medium">
            Body Composition
          </span>
        </div>
        <h1 className="text-3xl font-bold text-surface-100 mb-3">
          Understanding Body Composition Predictions
        </h1>
        <p className="text-lg text-surface-400">
          Why we show ranges instead of single numbers, and how we calibrate predictions to YOUR body.
        </p>
      </div>

      {/* Article Content */}
      <article className="space-y-8 text-surface-300">
        {/* Why Ranges */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">
            Why We Show Wide Ranges
          </h2>
          <p className="mb-4">
            When you see our body composition projections, you&apos;ll notice we show ranges, not single
            numbers. This isn&apos;t hedging—it&apos;s honesty.
          </p>
          <Card className="p-4 bg-warning-500/10 border-warning-500/20 mb-4">
            <p className="text-warning-300 font-medium mb-2">Body composition is hard to predict because:</p>
            <ul className="space-y-2 text-sm text-surface-400">
              <li className="flex items-start gap-2">
                <span className="text-warning-400">•</span>
                <span><strong className="text-surface-300">Genetics vary wildly</strong> - Some people partition nutrients toward muscle naturally, others don&apos;t</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning-400">•</span>
                <span><strong className="text-surface-300">Measurement is imprecise</strong> - Even DEXA has ±1-2% variance between scans</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning-400">•</span>
                <span><strong className="text-surface-300">Many variables matter</strong> - Sleep, stress, hormones, micronutrient status, and more</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning-400">•</span>
                <span><strong className="text-surface-300">Individual response differs</strong> - The same protocol produces different results in different people</span>
              </li>
            </ul>
          </Card>
          <p className="text-sm text-surface-500">
            We can estimate trends and probabilities, but claiming precision would be misleading.
          </p>
        </section>

        {/* What is P-Ratio */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">What is P-Ratio?</h2>
          <p className="mb-4">
            P-ratio (partition ratio) describes how your body partitions weight loss between fat and lean tissue.
          </p>
          <Card className="p-5 bg-surface-800/50 mb-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-surface-700">
                <span className="text-surface-400">P-ratio of 0.80</span>
                <span className="text-surface-200">80% of weight lost is fat, 20% is lean mass</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-surface-700">
                <span className="text-surface-400">P-ratio of 0.95</span>
                <span className="text-success-400">95% fat loss, 5% lean loss (excellent)</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-surface-400">P-ratio of 0.60</span>
                <span className="text-danger-400">60% fat loss, 40% lean loss (poor - crash diet territory)</span>
              </div>
            </div>
          </Card>
          <p className="text-sm text-surface-500">
            Research on trained individuals doing moderate deficits with adequate protein shows typical P-ratios of 0.75-0.85.
          </p>
        </section>

        {/* What Affects P-Ratio */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">What Affects Your P-Ratio?</h2>

          {/* Protein */}
          <h3 className="text-lg font-semibold text-surface-200 mt-6 mb-3">
            🥩 Protein Intake (Major Factor)
          </h3>
          <p className="mb-4">Higher protein = better partitioning. Research consistently shows:</p>
          <Card className="p-4 bg-surface-800/50 mb-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">&lt;1.2g/kg</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-danger-400">Significant muscle loss risk</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">1.6g/kg</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-200">Adequate for most</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">2.0g/kg</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-success-400">Optimal for cutting</span>
              </div>
              <div className="py-2">
                <span className="text-surface-400">2.4g/kg+</span>
              </div>
              <div className="py-2">
                <span className="text-surface-500">Diminishing returns</span>
              </div>
            </div>
          </Card>
          <p className="text-sm text-surface-500 mb-6">
            If you&apos;re not hitting 1.8-2.2g/kg while cutting, this is your #1 lever.
          </p>

          {/* Training */}
          <h3 className="text-lg font-semibold text-surface-200 mt-6 mb-3">
            🏋️ Training Volume (Major Factor)
          </h3>
          <p className="mb-4">
            Resistance training provides the stimulus that tells your body &quot;keep this muscle.&quot; During a deficit:
          </p>
          <ul className="space-y-2 text-sm text-surface-400 mb-6 ml-4">
            <li className="flex items-start gap-2">
              <span className="text-surface-500">•</span>
              <span><strong className="text-danger-400">No training:</strong> Body catabolizes muscle readily</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-surface-500">•</span>
              <span><strong className="text-warning-400">Maintenance volume:</strong> Preserves most muscle mass</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-surface-500">•</span>
              <span><strong className="text-success-400">High volume:</strong> May slightly enhance preservation, but recovery is limited in a deficit</span>
            </li>
          </ul>
          <p className="text-sm text-surface-500 mb-6">
            Don&apos;t drastically cut training volume during a cut. The signal matters.
          </p>

          {/* Deficit Size */}
          <h3 className="text-lg font-semibold text-surface-200 mt-6 mb-3">
            📉 Deficit Size (Moderate Factor)
          </h3>
          <p className="mb-4">
            Larger deficits = worse partitioning. Your body perceives larger deficits as more threatening and is more likely to break down muscle.
          </p>
          <Card className="p-4 bg-surface-800/50 mb-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">10-15% of TDEE</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-success-400">Best partitioning, slower loss</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">20-25% of TDEE</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-200">Good partitioning, moderate pace</span>
              </div>
              <div className="py-2">
                <span className="text-surface-400">30%+ of TDEE</span>
              </div>
              <div className="py-2">
                <span className="text-danger-400">Worse partitioning, faster loss</span>
              </div>
            </div>
          </Card>
          <p className="text-sm text-surface-500 mb-6">
            A 500 cal deficit is typically better than 1000 cal for body composition, even if total weight loss is slower.
          </p>

          {/* Starting Body Fat */}
          <h3 className="text-lg font-semibold text-surface-200 mt-6 mb-3">
            📏 Starting Body Fat (Moderate Factor)
          </h3>
          <p className="mb-4">
            The leaner you are, the harder your body fights to preserve remaining fat. This is evolutionary—extremely low body fat is dangerous.
          </p>
          <Card className="p-4 bg-surface-800/50 mb-4">
            <p className="text-xs text-surface-500 mb-3">For males:</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">&gt;20% body fat</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-success-400">Favorable - plenty of fat to lose</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">15-20% body fat</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-200">Good</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-surface-400">12-15% body fat</span>
              </div>
              <div className="py-2 border-b border-surface-700">
                <span className="text-warning-400">Getting harder</span>
              </div>
              <div className="py-2">
                <span className="text-surface-400">&lt;12% body fat</span>
              </div>
              <div className="py-2">
                <span className="text-danger-400">Body fights hard - expect more muscle loss</span>
              </div>
            </div>
          </Card>
          <p className="text-sm text-surface-500 mb-6">
            This is why competition prep is so difficult and why extreme leanness isn&apos;t sustainable.
          </p>

          {/* PED Use */}
          <h3 className="text-lg font-semibold text-surface-200 mt-6 mb-3">
            💉 PED Use (Major Factor)
          </h3>
          <p className="mb-4">
            This is the elephant in the room. Anabolic compounds dramatically improve nutrient partitioning. An enhanced athlete can:
          </p>
          <ul className="space-y-2 text-sm text-surface-400 mb-4 ml-4">
            <li>• Run larger deficits with less muscle loss</li>
            <li>• Get leaner without as much partitioning penalty</li>
            <li>• Sometimes gain muscle while losing fat (true recomp)</li>
          </ul>
          <p className="text-sm text-surface-500">
            Natural and enhanced athletes should have different expectations. If you&apos;re enhanced, you can toggle this in settings for more accurate predictions.
          </p>
        </section>

        {/* Calibration */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">How We Calibrate to YOU</h2>
          <p className="mb-4">
            Generic predictions are just starting points. The real power comes from your actual DEXA data.
          </p>
          <Card className="p-5 bg-primary-500/10 border-primary-500/20 mb-6">
            <p className="font-semibold text-primary-300 mb-3">After your second scan, we can calculate YOUR actual P-ratio:</p>
            <div className="font-mono text-sm p-4 bg-surface-900 rounded-lg">
              <p className="text-surface-300">Your P-ratio = Fat lost / Total weight lost</p>
              <p className="text-surface-500 text-xs mt-2">
                If you lost 10 lbs total and 8 lbs was fat (per DEXA), your P-ratio was 0.80
              </p>
            </div>
          </Card>
          <p className="mb-4">
            We use this to refine future predictions. After 2-3 scan pairs, we have a reasonable estimate of YOUR personal response.
          </p>
        </section>

        {/* DEXA Conditions */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">Why DEXA Conditions Matter</h2>
          <p className="mb-4">
            We ask about scan conditions because they affect accuracy:
          </p>
          <ul className="space-y-2 text-surface-400 mb-4 ml-4">
            <li className="flex items-start gap-2">
              <span className="text-surface-500">•</span>
              <span><strong className="text-surface-300">Time of day:</strong> Morning fasted is most consistent</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-surface-500">•</span>
              <span><strong className="text-surface-300">Hydration:</strong> Dehydration underestimates lean mass</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-surface-500">•</span>
              <span><strong className="text-surface-300">Recent training:</strong> Causes fluid shifts</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-surface-500">•</span>
              <span><strong className="text-surface-300">Same provider:</strong> Different machines have different calibrations</span>
            </li>
          </ul>
          <p className="text-sm text-surface-500">
            For best tracking, try to scan under similar conditions each time.
          </p>
        </section>

        {/* Bottom Line */}
        <section>
          <h2 className="text-xl font-bold text-surface-100 mb-4">The Bottom Line</h2>
          <p className="mb-4">Our projections give you:</p>
          <ul className="space-y-2 text-surface-400 mb-4 ml-4">
            <li className="flex items-start gap-2">
              <span className="text-success-400">✓</span>
              <span>A reasonable expected outcome based on your data</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-success-400">✓</span>
              <span>A range of possibilities reflecting real uncertainty</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-success-400">✓</span>
              <span>Actionable recommendations to push toward the better end</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-success-400">✓</span>
              <span>Improving accuracy as we learn from your actual results</span>
            </li>
          </ul>
          <Card className="p-4 bg-surface-800/50 border-surface-700">
            <p className="text-sm text-surface-400">
              Don&apos;t fixate on hitting exact numbers. Use projections to set reasonable expectations
              and make informed decisions about your cut.
            </p>
          </Card>
        </section>

        {/* CTA */}
        <section className="pt-4">
          <Card className="p-6 text-center bg-gradient-to-r from-primary-500/10 to-accent-500/10 border-primary-500/20">
            <h3 className="text-lg font-bold text-surface-100 mb-2">
              Ready to Track Your Body Composition?
            </h3>
            <p className="text-sm text-surface-400 mb-4">
              Add your DEXA scans and get personalized projections calibrated to your body.
            </p>
            <Link href="/dashboard/body-composition">
              <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
                Go to Body Composition
              </button>
            </Link>
          </Card>
        </section>
      </article>

      {/* Related Articles */}
      <div className="mt-12 pt-8 border-t border-surface-800">
        <h3 className="text-lg font-semibold text-surface-100 mb-4">Related Articles</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/dashboard/learn/adaptive-tdee">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔥</span>
                <div>
                  <p className="font-medium text-surface-200">Adaptive TDEE</p>
                  <p className="text-xs text-surface-500">How we calculate your metabolism</p>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/dashboard/science">
            <Card className="p-4 hover:border-surface-600 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <p className="font-medium text-surface-200">All Science Principles</p>
                  <p className="text-xs text-surface-500">12+ research-backed algorithms</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
