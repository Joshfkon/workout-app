'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconAlertTriangle,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconFlame,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react';
import {
  ArticleCTA,
  ArticleHeader,
  ArticlePage,
  ArticleSection,
  BulletList,
  Callout,
  ContentCard,
  IconBadge,
  TermNote,
} from '@/components/learn/ArticleKit';

function RelatedLink({ href, icon, title, subtitle }: { href: string; icon: TablerIcon; title: string; subtitle: string }) {
  return (
    <Link href={href} className="block">
      <ContentCard className="transition-colors active:bg-fill">
        <div className="flex items-center gap-3">
          <IconBadge icon={icon} />
          <div className="min-w-0 flex-1">
            <p className="text-headline text-ink">{title}</p>
            <p className="text-subhead text-ink-3">{subtitle}</p>
          </div>
          <IconChevronRight size={20} className="shrink-0 text-ink-3" aria-hidden="true" />
        </div>
      </ContentCard>
    </Link>
  );
}

const steps = [
  { title: 'Log your food', body: 'As accurately as possible.' },
  {
    title: 'Weigh in 2–3 times a week',
    body: 'Same time, same conditions (morning, after the bathroom). Daily is welcome but not required — a couple of weigh-ins a week is enough.',
  },
  {
    title: 'We run the math',
    body: 'We measure energy balance over the interval between your weigh-ins, using your smoothed trend weight.',
  },
  {
    title: 'A number from day one',
    body: 'You start with the formula estimate and it personalizes toward your measured reality with every interval — no waiting for the feature to "unlock".',
  },
];

export default function AdaptiveTDEEArticle() {
  useDocumentTitle('Adaptive TDEE');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconFlame}
        tag="Nutrition science"
        title="How we calculate your metabolism"
        subtitle="Why generic formulas fail, and how we use your actual data for pinpoint accuracy."
      />

      <ArticleSection title="The problem with generic formulas">
        <p className="text-body text-ink-2">
          Most fitness apps estimate your total daily energy expenditure (TDEE) using formulas like
          Mifflin-St Jeor or Harris-Benedict. These formulas use your age, height, weight, and a rough
          activity multiplier.
        </p>
        <TermNote term="TDEE" fullName="total daily energy expenditure" />
        <Callout icon={IconAlertTriangle} title="The problem?">
          <p className="text-ink-2">
            These formulas can be off by <strong className="text-ink">300-500+ calories</strong>. That&apos;s
            the difference between losing 1 lb a week and maintaining.
          </p>
        </Callout>
        <p className="text-body text-ink-2">Everyone&apos;s metabolism is different:</p>
        <BulletList
          items={[
            <><strong className="text-ink">Muscle mass</strong> — muscle burns more than fat</>,
            <><strong className="text-ink">NEAT</strong> — fidgeting, walking, daily movement</>,
            <><strong className="text-ink">Hormonal factors</strong> — thyroid, cortisol, etc.</>,
            <><strong className="text-ink">Metabolic adaptation</strong> — from dieting history</>,
          ]}
        />
        <p className="text-subhead text-ink-3">
          A 180 lb sedentary office worker and a 180 lb construction worker have vastly different calorie
          needs, even with the same &quot;activity level&quot; selected.
        </p>
      </ArticleSection>

      <ArticleSection title="Our approach: your body tells us">
        <p className="text-body text-ink-2">
          Instead of guessing, we calculate your actual burn rate from your real data.
        </p>
        <Callout title="The physics is simple">
          <BulletList
            className="text-ink"
            items={[
              '1 lb of fat ≈ 3,500 calories',
              'If you eat 500 cal below your TDEE daily, you lose ~1 lb a week',
              'If you eat at TDEE, weight stays stable',
            ]}
          />
        </Callout>
        <p className="text-body text-ink-2">
          By tracking your <strong className="text-ink">actual weight changes</strong> against your{' '}
          <strong className="text-ink">actual calorie intake</strong>, we can back-calculate your true TDEE.
        </p>
      </ArticleSection>

      <ArticleSection title="The equation">
        <ContentCard className="space-y-3 font-mono text-subhead">
          <div>
            <p className="text-ink-3">Weight change formula:</p>
            <p className="text-ink">Weight_change = (Calories_in - TDEE) / 3500</p>
          </div>
          <div>
            <p className="text-ink-3">Over any interval between two weigh-ins, solve for TDEE:</p>
            <p className="text-ink">TDEE = mean_daily_intake − (ΔWeight × 3500) / interval_days</p>
          </div>
        </ContentCard>
        <p className="text-body text-ink-2">
          This is the key: the math works over an <strong className="text-ink">interval</strong>, not a single
          day. It needs your <strong className="text-ink">intake logged consistently</strong> and just two
          weigh-ins far enough apart — not a weigh-in every single day. Weighing more often only sharpens
          the picture.
        </p>
        <p className="text-body text-ink-2">
          We smooth your weigh-ins into a <strong className="text-ink">trend weight</strong> first (a single
          scale reading carries ±1–2 lb of water and glycogen noise), then average several intervals —
          weighting recent ones more, because metabolism adapts.
        </p>
      </ArticleSection>

      <ArticleSection title="How it works">
        <ContentCard>
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-action-tint text-subhead font-semibold text-action">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-headline text-ink">{step.title}</p>
                  <p className="text-subhead text-ink-2">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="The convergence graph">
        <p className="text-body text-ink-2">
          On day one the number is the formula estimate. As each weigh-in interval closes, the estimate is
          nudged from that starting point toward your measured reality — a smooth, gradual drift, never a
          sudden switch. Early on it leans on the formula; over a few weeks it becomes almost entirely your
          own data.
        </p>
        <ContentCard>
          <p className="mb-4 text-center text-subhead text-ink-3">Example convergence pattern</p>
          <div className="flex h-40 items-end justify-between gap-1 px-2" aria-hidden="true">
            {/* Simulated chart bars showing convergence */}
            {[16, 15.2, 14.8, 15.5, 14.2, 14.0, 13.8, 13.9, 13.7, 13.6, 13.5, 13.5, 13.4, 13.4].map((val, i) => (
              <div key={i} className="flex-1 rounded-t bg-action" style={{ height: `${((val - 12) / 5) * 100}%` }} />
            ))}
          </div>
          <div className="mt-2 flex justify-between px-2 text-caption text-ink-3">
            <span>Day 1</span>
            <span>Day 7</span>
            <span>Day 14</span>
          </div>
          <p className="mt-4 text-center text-caption text-ink-3">
            The estimate drifts from formula toward your data as intervals close
          </p>
        </ContentCard>
        <p className="text-body text-ink-2">
          After a few weeks of consistent food logging plus a couple of weigh-ins each week, the number is
          almost entirely your own data. This is your actual metabolism, not a formula&apos;s guess.
        </p>
      </ArticleSection>

      <ArticleSection title="Why this matters">
        <ContentCard className="p-0">
          <div className="divide-y divide-sep">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-body text-ink-2">Generic formula says</span>
              <span className="text-body font-medium text-ink">2,400 cal/day</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-body text-ink-2">Your actual TDEE</span>
              <span className="text-body font-medium text-ink">2,150 cal/day</span>
            </div>
            <p className="px-4 py-3 text-subhead text-ink-2">
              If you ate at the formula&apos;s &quot;500 calorie deficit&quot; (1,900 cal), you&apos;d actually
              only be in a <strong className="text-ink">250 cal deficit</strong>. Half the expected fat loss.
            </p>
          </div>
        </ContentCard>
        <p className="text-body text-ink-2">With your personalized number, predictions become accurate:</p>
        <BulletList
          items={[
            '"At 1,800 cal/day, you\'ll hit 170 lbs by March 15"',
            '"To lose 1 lb a week, eat 1,650 cal/day"',
          ]}
        />
      </ArticleSection>

      <ArticleSection title="Tips for accuracy">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ContentCard className="space-y-2">
            <p className="text-headline text-ink">Do</p>
            <ul className="space-y-2 text-subhead text-ink-2">
              {[
                'Weigh in 2–3 times a week at the same time',
                'Log everything you eat, every day',
                'Keep logging through a phase change (we handle the water jump)',
                'Use a food scale when possible',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <IconCheck size={18} className="mt-0.5 shrink-0 text-status-ok" aria-hidden="true" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </ContentCard>
          <ContentCard className="space-y-2">
            <p className="text-headline text-ink">Don&apos;t</p>
            <ul className="space-y-2 text-subhead text-ink-2">
              {[
                'Skip logging days',
                'Guess at portions',
                'Panic at daily weight swings',
                'Change diet drastically mid-tracking',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <IconX size={18} className="mt-0.5 shrink-0 text-status-bad" aria-hidden="true" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </ContentCard>
        </div>
      </ArticleSection>

      <ArticleSection title="The math (for nerds)">
        <ContentCard className="space-y-3">
          <p className="text-body text-ink-2">
            We use ordinary least-squares regression to find the α (alpha) value that minimizes prediction
            error:
          </p>
          <div className="space-y-2 rounded-xl bg-fill p-3 font-mono text-subhead">
            <p className="text-ink">TDEE = α × Body_Weight</p>
            <p className="text-caption text-ink-3">Where α ≈ 12-16 cal/lb for most people</p>
          </div>
          <p className="text-body text-ink-2">We minimize:</p>
          <div className="rounded-xl bg-fill p-3 font-mono text-subhead">
            <p className="text-ink">Σ(predicted_weight - actual_weight)²</p>
          </div>
          <p className="text-subhead text-ink-3">
            By finding the α that makes our predictions match reality most closely across your data window.
            Standard error tells us how confident we are. As you log more consistent data, standard error
            decreases and confidence increases.
          </p>
        </ContentCard>
      </ArticleSection>

      <ArticleCTA
        title="Ready to track your metabolism?"
        body="Start logging your weight and nutrition daily. Your personal TDEE estimate will be ready in 2-3 weeks."
        href="/dashboard/nutrition"
        label="Go to nutrition tracking"
      />

      <ArticleSection title="Related articles">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RelatedLink
            href="/dashboard/learn/injury-prevention"
            icon={IconShieldCheck}
            title="Smart injury prevention"
            subtitle="How we keep you safe"
          />
          <RelatedLink
            href="/dashboard/science"
            icon={IconChartBar}
            title="All science principles"
            subtitle="12+ research-backed algorithms"
          />
        </div>
      </ArticleSection>
    </ArticlePage>
  );
}
