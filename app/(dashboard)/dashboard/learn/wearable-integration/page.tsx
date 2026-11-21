'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconActivity,
  IconAlertTriangle,
  IconChartBar,
  IconChevronRight,
  IconDeviceWatch,
  IconFlame,
  IconRun,
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

const targetModes = [
  {
    title: 'Fixed target',
    body: "Eat the same every day. Simple, but some days you'll be in a bigger deficit than others.",
  },
  {
    title: 'Activity-adjusted',
    body: 'Eat more on active days, less on rest days. Keeps your deficit more consistent and may help with energy levels.',
  },
  {
    title: 'Deficit-locked',
    body: 'Automatically adjust to maintain your exact target deficit (e.g., always 500 cal below burn).',
  },
];

const devices: Array<{ icon: TablerIcon; name: string; via: string }> = [
  { icon: IconDeviceWatch, name: 'Apple Watch', via: 'via HealthKit' },
  { icon: IconActivity, name: 'Fitbit', via: 'via OAuth' },
  { icon: IconChartBar, name: 'Google Fit', via: 'Android devices' },
  { icon: IconRun, name: 'Garmin', via: 'Coming soon' },
];

export default function WearableIntegrationArticle() {
  useDocumentTitle('Wearable integration');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconDeviceWatch}
        tag="Wearable integration"
        title="Activity-adjusted TDEE"
        subtitle="How we use your Apple Watch, Fitbit, or other wearable data for day-by-day accuracy."
      />

      <ArticleSection title={<>The problem with &quot;average&quot; TDEE</>}>
        <p className="text-body text-ink-2">
          Your basic TDEE model gives you an average daily burn. But you don&apos;t live an average day every
          day.
        </p>
        <TermNote term="TDEE" fullName="total daily energy expenditure" />
        <ContentCard className="p-0">
          <div className="divide-y divide-sep">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-body text-ink-2">Monday: leg day + 15,000 steps</span>
              <span className="shrink-0 font-mono text-subhead text-ink">~2,800 cal</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-body text-ink-2">Tuesday: rest day + 4,000 steps</span>
              <span className="shrink-0 font-mono text-subhead text-ink">~2,100 cal</span>
            </div>
            <p className="px-4 py-3 text-subhead text-ink-3">
              That&apos;s a <strong className="text-ink">700 calorie swing</strong> between days.
            </p>
          </div>
        </ContentCard>
        <p className="text-body text-ink-2">
          If you eat the same amount both days, you&apos;re in a big deficit Monday and barely any deficit
          Tuesday. Your weekly average might be on target, but your daily experience varies wildly.
        </p>
      </ArticleSection>

      <ArticleSection title="How we incorporate activity data">
        <p className="text-body text-ink-2">
          When you connect your Apple Watch, Fitbit, or other wearable, we pull in your daily step count.
          Combined with your logged workouts from the app, we can estimate your actual burn for each specific
          day.
        </p>
        <Callout title="The enhanced model">
          <p className="font-mono text-subhead text-ink">Daily TDEE = Base Metabolism + Step Burn + Workout Burn</p>
          <div className="space-y-1 pt-2 text-subhead text-ink-2">
            <p>
              <strong className="text-ink">Base metabolism</strong> = your resting burn (what we already
              calculate)
            </p>
            <p>
              <strong className="text-ink">Step burn</strong> = calories from walking and daily movement
            </p>
            <p>
              <strong className="text-ink">Workout burn</strong> = calories from your logged resistance
              training
            </p>
          </div>
        </Callout>
      </ArticleSection>

      <ArticleSection title="Why we use our own workout estimates">
        <ContentCard className="flex gap-3">
          <IconAlertTriangle size={20} className="mt-0.5 shrink-0 text-status-warn" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-headline text-ink">Watch out</p>
            <p className="text-body text-ink-2">
              Your Apple Watch might say you burned 600 calories during your 45-minute lifting session.
              It&apos;s probably wrong — heart rate-based estimates for resistance training are notoriously
              inaccurate, often <strong className="text-ink">2-3x too high</strong>.
            </p>
          </div>
        </ContentCard>
        <p className="text-body text-ink-2">We use conservative estimates based on research:</p>
        <BulletList
          items={[
            <><strong className="text-ink">Workout duration</strong> — longer = more burn</>,
            <><strong className="text-ink">Rest periods</strong> — shorter rest = higher intensity</>,
            <><strong className="text-ink">Muscle groups</strong> — legs burn more than arms</>,
            <><strong className="text-ink">Your body weight</strong> — heavier = more calories</>,
          ]}
        />
        <p className="text-subhead text-ink-3">
          This gives a more realistic 150-250 calories for a typical 45-60 minute lifting session, rather
          than the inflated 500+ your watch might report.
        </p>
      </ArticleSection>

      <ArticleSection title="Avoiding double-counting">
        <p className="text-body text-ink-2">
          If you walked to the gym and your watch counted 2,000 steps during your workout, we shouldn&apos;t
          count those steps and the workout calories.
        </p>
        <ContentCard className="space-y-3">
          <p className="text-headline text-ink">How we handle it</p>
          <ol className="space-y-3">
            {[
              'Track hourly step breakdowns from your wearable',
              'Identify steps that occurred during your logged workout time',
              'Deduct those steps from your step calorie total',
            ].map((t, i) => (
              <li key={t} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-action-tint text-subhead font-semibold text-action">
                  {i + 1}
                </span>
                <span className="text-body text-ink-2">{t}</span>
              </li>
            ))}
          </ol>
        </ContentCard>
        <p className="text-subhead text-ink-3">
          You get credit for the workout or the steps during that time, not both.
        </p>
      </ArticleSection>

      <ArticleSection title="Dynamic calorie targets (optional)">
        <p className="text-body text-ink-2">You can choose how to handle activity variations:</p>
        <div className="space-y-3">
          {targetModes.map((m) => (
            <ContentCard key={m.title} className="space-y-1">
              <p className="text-headline text-ink">{m.title}</p>
              <p className="text-subhead text-ink-2">{m.body}</p>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="Calibration over time">
        <p className="text-body text-ink-2">
          Different devices count steps differently. A Fitbit might count 10% more steps than an Apple Watch
          for the same walk.
        </p>
        <Callout title="We learn your device's calibration">
          <p className="text-ink-2">
            By comparing predicted weight changes to actual, we can detect if your steps burn more or fewer
            calories than expected.
          </p>
          <p className="text-ink-2">
            If high-step days consistently lead to more weight loss than predicted, we increase your
            calibration factor automatically.
          </p>
        </Callout>
        <p className="text-subhead text-ink-3">
          After 2-3 weeks with a connected device, your step-calorie estimates become personalized to you and
          your specific wearable.
        </p>
      </ArticleSection>

      <ArticleSection title="Supported devices">
        <div className="grid grid-cols-2 gap-3">
          {devices.map((d) => (
            <ContentCard key={d.name} className="flex flex-col items-center gap-2 text-center">
              <IconBadge icon={d.icon} />
              <div>
                <p className="text-headline text-ink">{d.name}</p>
                <p className="text-caption text-ink-3">{d.via}</p>
              </div>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="The math (for nerds)">
        <ContentCard className="space-y-3">
          <p className="text-body text-ink-2">We use gradient descent to learn optimal parameters:</p>
          <div className="space-y-1 rounded-xl bg-fill p-3 font-mono text-subhead">
            <p className="text-ink">Daily TDEE = α × weight + β × netSteps + γ × workoutCals</p>
            <p className="pt-2 text-caption text-ink-3">Where:</p>
            <p className="text-caption text-ink-3">α ≈ 13-16 cal/lb (base metabolism)</p>
            <p className="text-caption text-ink-3">β ≈ 0.03-0.05 cal/step</p>
            <p className="text-caption text-ink-3">γ ≈ 0.8-1.2 (workout multiplier)</p>
          </div>
          <p className="text-subhead text-ink-3">
            These parameters are learned from your actual weight and calorie data, personalized to your
            metabolism and activity patterns.
          </p>
        </ContentCard>
      </ArticleSection>

      <ArticleCTA
        title="Ready to connect your wearable?"
        body="Start getting day-by-day calorie targets based on your actual activity level."
        href="/dashboard/settings/wearables"
        label="Connect device"
      />

      <ArticleSection title="Related articles">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RelatedLink
            href="/dashboard/learn/adaptive-tdee"
            icon={IconFlame}
            title="Adaptive TDEE"
            subtitle="How we calculate your base metabolism"
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
