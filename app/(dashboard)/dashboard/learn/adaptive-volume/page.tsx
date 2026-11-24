'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconDna,
  IconGauge,
  IconHeart,
  IconHourglass,
  IconMeat,
  IconMedal,
  IconMoodNervous,
  IconPill,
  IconShieldCheck,
  IconTarget,
  IconTrendingUp,
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

const metricsTracked: Array<{ icon: TablerIcon; title: string; description: string; detail: string }> = [
  {
    icon: IconTrendingUp,
    title: 'Progression rate',
    description: 'Are you getting stronger week over week?',
    detail:
      "If yes, you're recovering. If you're stalling or regressing, you may be exceeding your recovery capacity.",
  },
  {
    icon: IconGauge,
    title: 'RIR drift',
    description: 'Same weight feeling harder over time?',
    detail:
      "If the same weight at the same reps feels much harder by week 3 than week 1, fatigue is building faster than you're recovering.",
  },
  {
    icon: IconTarget,
    title: 'Form quality',
    description: 'Is technique degrading?',
    detail:
      "Your set feedback captures form quality. If you're grinding out uglier and uglier reps, that's fatigue showing.",
  },
  {
    icon: IconHeart,
    title: 'Recovery scores',
    description: 'Does low recovery predict bad sessions?',
    detail:
      'Your daily check-in recovery ratings correlate with performance. A strong link with consistently low recovery means volume may be too high.',
  },
];

const recoveryFactors: Array<{ icon: TablerIcon; label: string }> = [
  { icon: IconDna, label: 'Genetics - some people recover faster' },
  { icon: IconMedal, label: 'Training age - beginners need less' },
  { icon: IconMoodNervous, label: 'Life stress - work, sleep, relationships' },
  { icon: IconMeat, label: 'Nutrition - protein, calories' },
  { icon: IconHourglass, label: 'Age - recovery slows over time' },
  { icon: IconPill, label: 'PED use - significantly higher capacity' },
];

const phases = [
  {
    number: 1,
    title: 'Establish baseline',
    description: 'Train with evidence-based starting volumes for 3-4 weeks. We collect data.',
  },
  {
    number: 2,
    title: 'Analyze outcomes',
    description:
      'At the end of the training block, we analyze progression, RIR drift, form quality, and recovery correlation.',
  },
  {
    number: 3,
    title: 'Adjust',
    description:
      'We work out whether volume was too high, optimal, or too low for each muscle group, then suggest specific adjustments.',
  },
  {
    number: 4,
    title: 'Refine',
    description:
      'Over multiple training blocks, your personal volume tolerance emerges. After 3-4 cycles, we have high confidence in your optimal ranges.',
  },
];

const timeline = [
  { when: 'Week 1', what: 'Start with evidence-based volumes' },
  { when: 'Weeks 2-4', what: 'Train, log feedback, let data accumulate' },
  { when: 'End of meso', what: 'Review analysis, see what worked' },
  { when: 'Next meso', what: 'Apply adjustments, repeat' },
];

const signGroups: Array<{ icon: TablerIcon; iconClass: string; title: string; items: string[] }> = [
  {
    icon: IconAlertTriangle,
    iconClass: 'text-status-warn',
    title: 'Warning signs',
    items: ['RIR drift starting to accumulate', 'Form slipping on later sets', 'Approaching your estimated MRV'],
  },
  {
    icon: IconAlertOctagon,
    iconClass: 'text-status-bad',
    title: 'Alert signs',
    items: ['Significant RIR drift (2+ points)', 'Form degradation multiple sessions', 'Exceeded estimated MRV'],
  },
];

const tips: Array<{ icon: TablerIcon; iconClass: string; title: string; items: string[] }> = [
  {
    icon: IconCheck,
    iconClass: 'text-status-ok',
    title: 'Do',
    items: [
      'Log RIR and form honestly every set',
      'Complete daily check-ins (especially recovery)',
      'Run full 3-4 week training blocks before adjusting',
      'Trust the process - it takes a few cycles',
    ],
  },
  {
    icon: IconX,
    iconClass: 'text-status-bad',
    title: "Don't",
    items: [
      'Change volume mid-block based on feelings',
      'Ignore fatigue warnings',
      'Skip logging for some sessions',
      'Expect perfect answers in week 1',
    ],
  },
];

function IconList({ icon: Icon, iconClass, items }: { icon: TablerIcon; iconClass: string; items: string[] }) {
  return (
    <ul className="space-y-2 text-subhead text-ink-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Icon size={18} className={`mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AdaptiveVolumeArticle() {
  useDocumentTitle('Adaptive volume');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconChartBar}
        tag="Training science"
        title="How we learn your recovery capacity"
        subtitle="Personalized volume recommendations based on your data, not population averages."
      />

      <ArticleSection title="The volume problem">
        <p className="text-body text-ink-2">Every fitness influencer has an opinion on how many sets you should do:</p>
        <ContentCard>
          <BulletList
            items={[
              '“10-20 sets per muscle per week”',
              '“Do more until you stop progressing”',
              '“Less is more - just train harder”',
            ]}
          />
        </ContentCard>
        <Callout icon={IconAlertTriangle} title="The problem?">
          <p className="text-ink-2">
            Individual variation is massive. Research shows a <strong className="text-ink">3x difference</strong>{' '}
            between low and high responders. One person&apos;s optimal is another person&apos;s overtraining.
          </p>
        </Callout>
      </ArticleSection>

      <ArticleSection title="Why generic recommendations fail">
        <p className="text-body text-ink-2">
          Standard volume recommendations come from research averages. But you&apos;re not average - you&apos;re
          you.
        </p>
        <ContentCard className="space-y-3">
          <h3 className="text-headline text-ink">Factors that affect your recovery</h3>
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
        <p className="text-subhead text-ink-3">
          A study might find &quot;16 sets/week is optimal for quad growth&quot; - but that&apos;s the average.
          Some subjects grew best at 12 sets, others at 22.
        </p>
      </ArticleSection>

      <ArticleSection title="Our approach: let your body tell us">
        <p className="text-body text-ink-2">
          Instead of guessing, we track what actually happens when you train at different volumes.
        </p>
        <TermNote term="RIR" fullName="reps in reserve" />
        <h3 className="text-headline text-ink">What we monitor</h3>
        <div className="space-y-3">
          {metricsTracked.map((metric) => (
            <ContentCard key={metric.title}>
              <div className="flex items-start gap-3">
                <IconBadge icon={metric.icon} />
                <div className="min-w-0 space-y-1">
                  <h4 className="text-headline text-ink">{metric.title}</h4>
                  <p className="text-subhead text-ink-3">{metric.description}</p>
                  <p className="text-subhead text-ink-2">{metric.detail}</p>
                </div>
              </div>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="Understanding RIR drift">
        <p className="text-body text-ink-2">
          RIR drift is subtle but important. It&apos;s an early sign of overreaching.
        </p>
        <ContentCard className="space-y-3">
          <p className="text-subhead text-ink-3">Example:</p>
          <div className="space-y-2">
            {[
              { week: 'Week 1', text: '185 lbs × 8 at RIR 2 (felt like 2 left in tank)' },
              { week: 'Week 3', text: '185 lbs × 8 at RIR 0 (barely got it)' },
            ].map((row) => (
              <div key={row.week} className="flex items-center gap-3">
                <span className="shrink-0 rounded-lg bg-fill px-2 py-1 text-caption text-ink-2">{row.week}</span>
                <span className="text-body text-ink-2">{row.text}</span>
              </div>
            ))}
          </div>
          <p className="text-subhead text-ink-2">
            Same performance on paper, but you&apos;re more fatigued. Volume is outpacing recovery.
          </p>
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="How it works">
        <ContentCard className="space-y-4">
          {phases.map((phase) => (
            <div key={phase.number} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-action-tint text-subhead font-semibold text-action">
                {phase.number}
              </span>
              <div className="min-w-0">
                <h3 className="text-headline text-ink">{phase.title}</h3>
                <p className="text-subhead text-ink-2">{phase.description}</p>
              </div>
            </div>
          ))}
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="The math behind it">
        <p className="text-body text-ink-2">We track two key numbers per muscle group:</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ContentCard className="space-y-1">
            <h3 className="text-headline text-ink">MEV</h3>
            <p className="text-subhead text-ink-2">
              Minimum effective volume: the least work needed to maintain or slowly progress.
            </p>
          </ContentCard>
          <ContentCard className="space-y-1">
            <h3 className="text-headline text-ink">MRV</h3>
            <p className="text-subhead text-ink-2">
              Maximum recoverable volume: the most work you can do while still recovering.
            </p>
          </ContentCard>
        </div>

        <ContentCard className="space-y-2">
          <div className="flex h-8 overflow-hidden rounded-lg bg-fill" aria-hidden="true">
            <div className="w-1/4" />
            <div className="flex flex-1 items-center justify-center bg-action-tint text-caption font-medium text-action">
              Optimal zone
            </div>
            <div className="w-1/4" />
          </div>
          <div className="flex justify-between text-caption text-ink-3">
            <span>MEV</span>
            <span className="text-action">You want to be here</span>
            <span>MRV</span>
          </div>
        </ContentCard>

        <p className="text-body text-ink-2">We start with research-based estimates, then adjust based on your data:</p>
        <BulletList
          items={['Stalling or regressing? MRV estimate comes down.', 'Crushing it with gas in the tank? MRV estimate goes up.']}
        />
      </ArticleSection>

      <ArticleSection title="Real-time fatigue monitoring">
        <p className="text-body text-ink-2">
          We don&apos;t wait until you&apos;re overtrained. Mid-block, we watch for warning signs:
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {signGroups.map((group) => (
            <ContentCard key={group.title} className="space-y-2">
              <h3 className="text-headline text-ink">{group.title}</h3>
              <IconList icon={group.icon} iconClass={group.iconClass} items={group.items} />
            </ContentCard>
          ))}
        </div>
        <p className="text-subhead text-ink-3">
          When we spot these patterns, you&apos;ll get a heads-up before it becomes a problem.
        </p>
      </ArticleSection>

      <ArticleSection title="For enhanced athletes">
        <Callout>
          <p className="text-ink-2">
            If you&apos;re using PEDs, your recovery capacity is significantly higher. The system accounts for
            this:
          </p>
          <ul className="space-y-2 pt-1 text-ink-2">
            {[
              'Volume ceiling (MRV) raised ~35–40%, starting volumes ~10%',
              'Faster weekly volume progression toward the raised ceiling',
              'Recognition that “normal” overreaching signals may not apply',
              'Joint-stress limits stay unchanged — tendons adapt slower than muscle, regardless of enhancement',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <IconCheck size={18} className="mt-0.5 shrink-0 text-action" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="pt-1 text-subhead text-ink-3">
            Set your status in profile settings. The algorithm adjusts accordingly.
          </p>
        </Callout>
      </ArticleSection>

      <ArticleSection title="What this means for you">
        <ContentCard className="p-0">
          <div className="divide-y divide-sep">
            {timeline.map((row) => (
              <div key={row.when} className="flex items-center gap-3 px-4 py-3">
                <span className="w-24 shrink-0 text-subhead font-medium text-ink">{row.when}</span>
                <span className="min-w-0 text-body text-ink-2">{row.what}</span>
              </div>
            ))}
          </div>
        </ContentCard>
        <Callout title="After 2-3 training blocks, you'll know:">
          <BulletList
            items={[
              'Exactly how much chest volume you thrive on',
              'Whether your back recovers faster or slower than average',
              'Which muscles can handle more punishment',
            ]}
          />
          <p className="pt-1 font-medium text-ink">
            No more guessing. No more cookie-cutter programs. Your volume, tuned to your recovery.
          </p>
        </Callout>
      </ArticleSection>

      <ArticleSection title="Tips for best results">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tips.map((group) => (
            <ContentCard key={group.title} className="space-y-2">
              <h3 className="text-headline text-ink">{group.title}</h3>
              <IconList icon={group.icon} iconClass={group.iconClass} items={group.items} />
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleCTA
        title="See your volume profile"
        body="Check your current volume tolerance estimates and this week's training volume."
        href="/dashboard/volume"
        label="View volume dashboard"
      />

      <ArticleSection title="Related articles">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RelatedLink
            href="/dashboard/learn/injury-prevention"
            icon={IconShieldCheck}
            title="Smart injury prevention"
            subtitle="Volume affects injury risk"
          />
          <RelatedLink
            href="/dashboard/learn/progressive-overload"
            icon={IconTrendingUp}
            title="Progressive overload"
            subtitle="How we track progression"
          />
        </div>
      </ArticleSection>
    </ArticlePage>
  );
}
