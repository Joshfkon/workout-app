'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconAlertTriangle,
  IconBandage,
  IconBarbell,
  IconBolt,
  IconBrain,
  IconCake,
  IconCalendar,
  IconChartBar,
  IconChartLine,
  IconCheck,
  IconChevronRight,
  IconGauge,
  IconHeartBroken,
  IconMedal,
  IconMicroscope,
  IconMoodNervous,
  IconMoon,
  IconTarget,
  IconTool,
  IconTrendingDown,
  IconTrendingUp,
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

const aiFeatures: Array<{ icon: TablerIcon; title: string; description: string; detail: string }> = [
  {
    icon: IconTarget,
    title: 'Smart split selection',
    description: 'AI recommends the optimal training split based on your schedule',
    detail: 'We analyze your available training days and recommend Upper/Lower, PPL, Full Body, or other splits to maximize muscle frequency while allowing proper recovery.',
  },
  {
    icon: IconChartBar,
    title: 'Personalized volume',
    description: 'Volume adjusted to your recovery capacity',
    detail: 'Your age, sleep quality, stress levels, and training experience are factored into a recovery multiplier that scales your weekly sets per muscle group.',
  },
  {
    icon: IconBrain,
    title: 'DEXA-informed programming',
    description: 'Body composition data drives exercise selection',
    detail: 'If you have DEXA scan data, we analyze regional lean mass to identify lagging areas and prioritize exercises for balanced development.',
  },
  {
    icon: IconBolt,
    title: 'Fatigue management system',
    description: 'Dual fatigue tracking prevents overtraining',
    detail: 'We track both systemic fatigue (CNS, whole-body) with a weekly budget, and local muscle fatigue to ensure proper recovery between sessions.',
  },
  {
    icon: IconBarbell,
    title: 'Exercise tier system',
    description: 'S-tier exercises prioritized for maximum ROI',
    detail: 'Exercises are ranked by effectiveness. S-tier compounds get priority placement. Short on time? We select only the highest-impact movements.',
  },
  {
    icon: IconTool,
    title: 'Equipment awareness',
    description: 'Programs adapt to your available equipment',
    detail: 'Marked equipment as unavailable in your gym settings? We automatically substitute with equivalent movements you can actually perform.',
  },
];

const recoveryFactors: Array<{ icon: TablerIcon; label: string }> = [
  { icon: IconMoon, label: 'Sleep quality (1-5)' },
  { icon: IconMoodNervous, label: 'Life stress levels (1-5)' },
  { icon: IconCalendar, label: 'Training age (years lifting)' },
  { icon: IconCake, label: 'Biological age' },
  { icon: IconMedal, label: 'Experience level' },
  { icon: IconBandage, label: 'Injury history' },
];

const periodizationDetails = [
  {
    week: '1',
    title: 'Foundation week',
    description: 'Establish baseline with moderate volume and intensity',
    intensity: '70-75%',
    volume: '100%',
  },
  {
    week: '2-3',
    title: 'Accumulation',
    description: 'Progressive overload — add weight or reps each session',
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

const repRanges = [
  { type: 'Fast-twitch dominant', muscles: 'Hamstrings, triceps, chest', range: '4-8 reps' },
  { type: 'Mixed fiber type', muscles: 'Back, quads, biceps', range: '6-12 reps' },
  { type: 'Slow-twitch dominant', muscles: 'Calves, delts, core', range: '10-20 reps' },
];

const scienceHighlights = [
  {
    title: 'Muscle protein synthesis',
    value: '24-72h',
    description: 'Window of elevated MPS after training — why frequency matters',
  },
  {
    title: 'Recovery between sessions',
    value: '48-96h',
    description: 'Optimal time before training the same muscle again',
  },
  {
    title: 'Volume response variance',
    value: '3x',
    description: 'Difference between low and high responders in research',
  },
  {
    title: 'Deload frequency',
    value: '4-6 weeks',
    description: 'Typical fatigue accumulation timeline before performance drops',
  },
];

const deloadTriggers: Array<{ icon: TablerIcon; label: string }> = [
  { icon: IconTrendingDown, label: 'Performance drops 2+ sessions' },
  { icon: IconMoon, label: 'Sleep quality below 2/5' },
  { icon: IconGauge, label: 'RPE consistently 9.5+' },
  { icon: IconHeartBroken, label: 'Joint pain reported' },
  { icon: IconChartLine, label: 'RIR drift detected' },
  { icon: IconAlertTriangle, label: 'Fatigue budget exceeded' },
];

export default function MesocycleScienceArticle() {
  useDocumentTitle('Training block science');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconMicroscope}
        tag="AI training science"
        title="The science behind your training block"
        subtitle="How we build AI-powered training programs that adapt to your body and recovery capacity."
      />

      <ArticleSection title="What is a training block?">
        <Callout>
          <p>
            A training block (a &ldquo;mesocycle&rdquo; in coaching jargon) is a 4-8 week program designed to push your body, accumulate productive
            fatigue, then recover stronger.
          </p>
        </Callout>
        <p className="text-body text-ink-2">
          Think of it as a &ldquo;chapter&rdquo; in your training story. Each training block has a beginning
          (establishing baseline), middle (progressive overload), and end (deload to recover). This structured
          approach prevents the random, wandering training that leads to plateaus.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: '4-8', label: 'Weeks per cycle' },
            { value: '10-15%', label: 'Volume increase' },
            { value: '50%', label: 'Deload reduction' },
          ].map((s) => (
            <ContentCard key={s.label} className="px-2 text-center">
              <p className="text-title text-ink">{s.value}</p>
              <p className="text-caption text-ink-3">{s.label}</p>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="AI-powered features">
        <p className="text-body text-ink-2">
          Our training block builder isn&apos;t just a template generator. It&apos;s a sophisticated system that
          considers multiple factors to create a program truly personalized to you.
        </p>
        <div className="space-y-3">
          {aiFeatures.map((feature) => (
            <ContentCard key={feature.title}>
              <div className="flex items-start gap-3">
                <IconBadge icon={feature.icon} />
                <div className="min-w-0 space-y-1">
                  <h3 className="text-headline text-ink">{feature.title}</h3>
                  <p className="text-subhead text-action">{feature.description}</p>
                  <p className="text-subhead text-ink-2">{feature.detail}</p>
                </div>
              </div>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="Your recovery profile">
        <p className="text-body text-ink-2">
          Generic programs assume everyone recovers the same. We don&apos;t. Your recovery profile creates a
          personalized &ldquo;volume multiplier&rdquo; that scales your training appropriately.
        </p>
        <ContentCard className="space-y-3">
          <h3 className="text-headline text-ink">Factors we analyze</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recoveryFactors.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.label} className="flex items-center gap-2">
                  <Icon size={20} className="shrink-0 text-action" aria-hidden="true" />
                  <span className="text-body text-ink-2">{f.label}</span>
                </div>
              );
            })}
          </div>
        </ContentCard>
        <Callout title="Example">
          <p className="text-ink-2">
            Poor sleep (2/5) + high stress (4/5) might reduce your volume multiplier to 80%, meaning we
            prescribe 20% less volume than someone with optimal recovery. This prevents overtraining when life
            is demanding.
          </p>
        </Callout>
      </ArticleSection>

      <ArticleSection title="Periodization model">
        <p className="text-body text-ink-2">
          Your training block follows a structured periodization model that progressively increases demand, then
          strategically reduces it to allow adaptation.
        </p>
        <ContentCard className="space-y-4">
          {periodizationDetails.map((phase) => (
            <div key={phase.title} className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-action-tint">
                <span className="text-subhead font-semibold text-action">{phase.week}</span>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-headline text-ink">{phase.title}</h3>
                <p className="text-subhead text-ink-2">{phase.description}</p>
                <div className="flex flex-wrap gap-2 text-caption text-ink-2">
                  <span className="rounded-lg bg-fill px-2 py-1">Intensity: {phase.intensity}</span>
                  <span className="rounded-lg bg-fill px-2 py-1">Volume: {phase.volume}</span>
                </div>
              </div>
            </div>
          ))}
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Dual fatigue tracking">
        <p className="text-body text-ink-2">
          We track two types of fatigue to prevent overtraining while maximizing productive stimulus:
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Systemic fatigue</h3>
            <p className="text-subhead text-ink-2">
              CNS and whole-body fatigue from training. Tracked via a weekly &ldquo;budget&rdquo; system.
            </p>
            <BulletList
              className="text-subhead text-ink-3"
              items={['Compounds: 8-12 fatigue points', 'Isolations: 3-5 fatigue points', 'Weekly budget: ~100 points']}
            />
          </ContentCard>
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Local muscle fatigue</h3>
            <p className="text-subhead text-ink-2">Per-muscle-group fatigue that requires 48-72 hours recovery.</p>
            <BulletList
              className="text-subhead text-ink-3"
              items={['Recovery time varies by muscle', 'Large muscles: 72+ hours', 'Small muscles: 48 hours']}
            />
          </ContentCard>
        </div>
      </ArticleSection>

      <ArticleSection title="Fiber-type optimized rep ranges">
        <p className="text-body text-ink-2">
          Different muscles have different fiber type compositions. We optimize rep ranges accordingly:
        </p>
        <ContentCard className="p-0">
          <div className="divide-y divide-sep">
            {repRanges.map((r) => (
              <div key={r.type} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-body text-ink">{r.type}</p>
                  <p className="text-caption text-ink-3">{r.muscles}</p>
                </div>
                <span className="shrink-0 font-mono text-subhead text-ink">{r.range}</span>
              </div>
            ))}
          </div>
        </ContentCard>
        <p className="text-subhead text-ink-3">
          Compounds are placed early in sessions (when fresh) for heavier loading. Isolations finish the
          workout with higher reps.
        </p>
      </ArticleSection>

      <ArticleSection title="The science in numbers">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {scienceHighlights.map((stat) => (
            <ContentCard key={stat.title} className="space-y-1 text-center">
              <p className="text-title text-ink">{stat.value}</p>
              <p className="text-subhead font-medium text-ink">{stat.title}</p>
              <p className="text-caption text-ink-3">{stat.description}</p>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="Smart deload detection">
        <p className="text-body text-ink-2">Besides scheduled deloads, we monitor for signs you need one early:</p>
        <ContentCard>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {deloadTriggers.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.label} className="flex items-center gap-2">
                  <Icon size={20} className="shrink-0 text-action" aria-hidden="true" />
                  <span className="text-body text-ink-2">{t.label}</span>
                </li>
              );
            })}
          </ul>
        </ContentCard>
        <div className="space-y-1">
          <TermNote term="RPE" fullName="rate of perceived exertion" />
          <TermNote term="RIR" fullName="reps in reserve" />
        </div>
      </ArticleSection>

      <ArticleSection title="Why this matters">
        <ContentCard className="space-y-3">
          <p className="text-body text-ink">Most training apps give you a generic template. We build a program that:</p>
          <ul className="space-y-2 text-body text-ink-2">
            {[
              'Adapts to your recovery capacity, not population averages',
              'Uses DEXA data to target your lagging muscle groups',
              'Tracks fatigue and warns you before overtraining',
              'Adjusts to your schedule with optimal splits',
              'Respects your equipment availability and injury history',
              'Gets smarter over time as we learn your response patterns',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <IconCheck size={18} className="mt-0.5 shrink-0 text-action" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </ContentCard>
      </ArticleSection>

      <ArticleCTA
        title="Ready to train smarter?"
        body="Create an AI-powered training block tailored to your body, schedule, and goals."
        href="/dashboard/mesocycle/new"
        label="Create training block"
      />

      <ArticleSection title="Related articles">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RelatedLink
            href="/dashboard/learn/adaptive-volume"
            icon={IconChartBar}
            title="Adaptive volume"
            subtitle="How we learn your recovery capacity"
          />
          <RelatedLink
            href="/dashboard/learn/progressive-overload"
            icon={IconTrendingUp}
            title="Progressive overload"
            subtitle="The fundamental principle of growth"
          />
        </div>
      </ArticleSection>
    </ArticlePage>
  );
}
