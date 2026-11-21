'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconFlame,
  IconRuler,
  IconSettings,
  IconShieldCheck,
  IconStretching,
  IconTarget,
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

const injuryCategories = [
  { name: 'Back', count: 4, examples: 'Lower back strain, herniated disc, sciatica' },
  { name: 'Shoulder', count: 3, examples: 'Impingement, rotator cuff, instability' },
  { name: 'Knee', count: 4, examples: 'Patellofemoral, meniscus, ACL' },
  { name: 'Hip', count: 3, examples: 'Flexor strain, FAI, bursitis' },
  { name: 'Arm', count: 3, examples: 'Elbow tendinitis, wrist strain, carpal tunnel' },
  { name: 'Neck/ankle', count: 3, examples: 'Neck strain, cervical disc, ankle sprain' },
];

const safetyChecks: Array<{ icon: TablerIcon; title: string; description: string; detail: string }> = [
  {
    icon: IconTarget,
    title: 'Primary and secondary muscles',
    description: 'Which muscles are doing the work',
    detail: 'We check if any of your injured muscles are directly targeted by the exercise.',
  },
  {
    icon: IconSettings,
    title: 'Stabilizer muscles',
    description: 'What other apps miss',
    detail:
      'Bench press primarily works chest, but your lower back is working isometrically. If you have a back injury, bench can aggravate it.',
  },
  {
    icon: IconStretching,
    title: 'Spinal loading',
    description: 'Compression and shear force',
    detail: 'Exercises rated none/low/moderate/high. Back injuries filter out moderate and high spinal loading.',
  },
  {
    icon: IconRuler,
    title: 'Position stress',
    description: 'Which joints are stressed',
    detail:
      'Each exercise maps which joints are under tension: lower back, shoulders, knees, wrists, elbows, hips, neck.',
  },
  {
    icon: IconArrowsExchange,
    title: 'Movement requirements',
    description: 'Required movement patterns',
    detail:
      'Does it require spinal flexion, extension, rotation, or a back arch? These are flagged for relevant injuries.',
  },
];

const spinalLoading = [
  { level: 'None', examples: 'Machine chest press, leg extension' },
  { level: 'Low', examples: 'Cable exercises, most isolation work' },
  { level: 'Moderate', examples: 'Bench press, lunges, hip thrusts' },
  { level: 'High', examples: 'Squats, deadlifts, barbell rows' },
];

const exampleScenario = {
  injury: 'Lower back strain - moderate severity',
  avoid: [
    { name: 'Deadlift', reason: 'High spinal loading, requires extension' },
    { name: 'Barbell row', reason: 'High spinal loading, back stabilization' },
    { name: 'Squat', reason: 'Moderate-high spinal loading' },
    { name: 'Good morning', reason: 'High spinal loading, extension' },
  ],
  caution: [
    { name: 'Bench press', reason: 'Requires back arch, moderate spinal stress' },
    { name: 'Hip thrust', reason: 'Back arch position' },
  ],
  safe: [
    { name: 'Machine chest press', reason: 'Supported position, no spinal loading' },
    { name: 'Leg extension', reason: 'No back involvement' },
    { name: 'Cable fly', reason: 'No spinal loading, isolation movement' },
    { name: 'Lat pulldown', reason: 'Supported, no axial loading' },
  ],
};

const flagGroups: Array<{
  title: string;
  note?: string;
  icon: TablerIcon;
  iconClass: string;
  items: Array<{ name: string; reason: string }>;
}> = [
  { title: 'Avoid', icon: IconX, iconClass: 'text-status-bad', items: exampleScenario.avoid },
  {
    title: 'Caution',
    note: 'Use lighter weight, stop if discomfort',
    icon: IconAlertTriangle,
    iconClass: 'text-status-warn',
    items: exampleScenario.caution,
  },
  { title: 'Safe', icon: IconCheck, iconClass: 'text-status-ok', items: exampleScenario.safe },
];

const substitutions = [
  { from: 'barbell rows', to: ['Chest-supported row', 'Cable row with back pad', 'Machine row'] },
  { from: 'squats', to: ['Leg press', 'Hack squat', 'Leg extension + leg curl'] },
];

const recoverySteps = [
  { weeks: 'Week 1-2', width: 'w-1/3', label: 'Only "safe" exercises' },
  { weeks: 'Week 3-4', width: 'w-2/3', label: 'Add "caution" at reduced weight' },
  { weeks: 'Week 5+', width: 'w-full', label: 'Full exercise library' },
];

const discomfortLevels = [
  { name: 'Twinge', body: 'Noticed something, minor' },
  { name: 'Discomfort', body: 'Uncomfortable but manageable' },
  { name: 'Pain', body: 'Should stop' },
];

export default function InjuryPreventionArticle() {
  useDocumentTitle('Injury prevention');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconShieldCheck}
        tag="Safety"
        title="Smart injury prevention"
        subtitle="How we analyze exercise biomechanics to keep you safe and suggest intelligent alternatives."
      />

      <ArticleSection title={<>Beyond &quot;skip leg day&quot;</>}>
        <p className="text-body text-ink-2">
          Most fitness apps handle injuries with a blunt instrument: &quot;Oh, you hurt your shoulder? Here,
          do legs instead.&quot;
        </p>
        <Callout title="That's not good enough.">
          <p className="text-ink-2">
            A back injury doesn&apos;t just affect back exercises — it affects squats, deadlifts, bench press
            (yes, bench press), and dozens of other movements.
          </p>
        </Callout>
        <p className="text-body text-ink-2">
          We built a comprehensive system that actually understands exercise biomechanics.
        </p>
      </ArticleSection>

      <ArticleSection title="How we analyze exercises">
        <p className="text-body text-ink-2">Every exercise in our database has detailed safety metadata:</p>
        <div className="space-y-3">
          {safetyChecks.map((check) => (
            <ContentCard key={check.title}>
              <div className="flex items-start gap-3">
                <IconBadge icon={check.icon} />
                <div className="min-w-0 space-y-1">
                  <h3 className="text-headline text-ink">{check.title}</h3>
                  <p className="text-subhead text-ink-3">{check.description}</p>
                  <p className="text-subhead text-ink-2">{check.detail}</p>
                </div>
              </div>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="Spinal loading levels">
        <ContentCard className="overflow-x-auto p-0">
          <table className="w-full text-left">
            <thead>
              <tr className="text-caption text-ink-3">
                <th className="px-4 py-3 font-medium">Level</th>
                <th className="px-4 py-3 font-medium">Examples</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sep">
              {spinalLoading.map((row) => (
                <tr key={row.level}>
                  <td className="px-4 py-3 text-body font-medium text-ink">{row.level}</td>
                  <td className="px-4 py-3 text-subhead text-ink-2">{row.examples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ContentCard>
        <p className="text-subhead text-ink-3">
          If you have a back injury, we automatically filter out moderate and high spinal loading exercises.
        </p>
      </ArticleSection>

      <ArticleSection title="How it works in practice">
        <ContentCard className="space-y-1">
          <p className="text-subhead text-ink-3">You log:</p>
          <p className="text-headline text-ink">&quot;{exampleScenario.injury}&quot;</p>
        </ContentCard>
        <p className="text-body text-ink-2">We ask follow-up questions:</p>
        <BulletList
          items={[
            'Does bending forward hurt? (flexion)',
            'Does arching backward hurt? (extension)',
            'Does twisting hurt? (rotation)',
            'Does carrying heavy things hurt? (loading)',
          ]}
        />
        <p className="text-body text-ink-2">We then flag exercises:</p>
        <div className="space-y-3">
          {flagGroups.map((group) => {
            const Icon = group.icon;
            return (
              <ContentCard key={group.title} className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Icon size={20} className={`shrink-0 ${group.iconClass}`} aria-hidden="true" />
                  <h3 className="text-headline text-ink">{group.title}</h3>
                  {group.note && <span className="text-caption text-ink-3">{group.note}</span>}
                </div>
                <ul className="space-y-2">
                  {group.items.map((ex) => (
                    <li key={ex.name} className="text-subhead">
                      <span className="text-ink">{ex.name}</span>
                      <span className="text-ink-3"> — {ex.reason}</span>
                    </li>
                  ))}
                </ul>
              </ContentCard>
            );
          })}
        </div>
      </ArticleSection>

      <ArticleSection title="Smart substitutions">
        <p className="text-body text-ink-2">
          When we flag an exercise, we don&apos;t just say &quot;don&apos;t do this.&quot; We offer alternatives:
        </p>
        <div className="space-y-3">
          {substitutions.map((s) => (
            <ContentCard key={s.from} className="space-y-2">
              <p className="text-subhead text-ink-3">Can&apos;t do {s.from}?</p>
              <div className="flex flex-wrap gap-2">
                {s.to.map((alt) => (
                  <span key={alt} className="rounded-full bg-fill px-3 py-1 text-subhead text-ink-2">
                    {alt}
                  </span>
                ))}
              </div>
            </ContentCard>
          ))}
        </div>
        <p className="text-subhead text-ink-3">We prioritize:</p>
        <ol className="ml-4 list-inside list-decimal space-y-1 text-body text-ink-2">
          <li>Same muscle group</li>
          <li>Similar movement pattern</li>
          <li>Machine/supported versions</li>
          <li>Matching hypertrophy effectiveness</li>
        </ol>
      </ArticleSection>

      <ArticleSection title="20+ injury types supported">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {injuryCategories.map((cat) => (
            <ContentCard key={cat.name} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-headline text-ink">{cat.name}</span>
                <span className="rounded-full bg-fill px-2 py-0.5 text-caption text-ink-2">{cat.count}</span>
              </div>
              <p className="text-caption text-ink-3">{cat.examples}</p>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="Tracking recovery">
        <p className="text-body text-ink-2">As your injury heals, gradually reintroduce exercises:</p>
        <ContentCard className="space-y-4">
          {recoverySteps.map((step) => (
            <div key={step.weeks} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-subhead text-ink-3">{step.weeks}</span>
                <span className="text-right text-subhead text-ink-2">{step.label}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-fill">
                <div className={`h-full ${step.width} bg-action`} />
              </div>
            </div>
          ))}
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Discomfort logging">
        <p className="text-body text-ink-2">During workouts, you can log discomfort on any set:</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {discomfortLevels.map((lvl) => (
            <ContentCard key={lvl.name} className="space-y-1 text-center">
              <p className="text-headline text-ink">{lvl.name}</p>
              <p className="text-caption text-ink-3">{lvl.body}</p>
            </ContentCard>
          ))}
        </div>
        <Callout>
          <p className="text-ink-2">
            If you log discomfort <strong className="text-ink">3+ times</strong> on the same body part in 2
            weeks, we prompt:
          </p>
          <p className="italic text-action">
            &quot;You&apos;ve logged knee discomfort multiple times. Want to track this as an injury for
            smarter exercise recommendations?&quot;
          </p>
        </Callout>
      </ArticleSection>

      <ArticleSection title="Volume and injury risk">
        <p className="text-body text-ink-2">
          Excessive volume doesn&apos;t just hurt gains — it increases injury risk.
        </p>
        <ContentCard className="space-y-3">
          <h3 className="text-headline text-ink">When fatigue accumulates</h3>
          <ul className="space-y-2 text-body text-ink-2">
            {[
              'Form breaks down (the system tracks this)',
              'Stabilizer muscles fatigue before prime movers',
              'Connective tissue stress accumulates',
              'Reaction time and coordination suffer',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <IconAlertTriangle size={18} className="mt-0.5 shrink-0 text-status-warn" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </ContentCard>
        <p className="text-body text-ink-2">
          This is why we monitor form quality and RIR drift. Catching fatigue early isn&apos;t just about
          optimizing gains — it&apos;s injury prevention.
        </p>
        <TermNote term="RIR" fullName="reps in reserve" />
        <ContentCard className="flex gap-3">
          <IconAlertTriangle size={20} className="mt-0.5 shrink-0 text-status-bad" aria-hidden="true" />
          <p className="text-body font-medium text-ink">
            If you&apos;re seeing form degradation warnings, take them seriously. An ugly set today could be a
            tweaked back tomorrow.
          </p>
        </ContentCard>
        <Link
          href="/dashboard/learn/adaptive-volume"
          className="inline-flex items-center gap-1 text-body text-action"
        >
          Learn more about our volume tracking
          <IconChevronRight size={18} aria-hidden="true" />
        </Link>
      </ArticleSection>

      <ArticleSection title="The bottom line">
        <ContentCard className="space-y-3">
          <p className="text-body text-ink">We don&apos;t just track what muscles an exercise works. We understand:</p>
          <ul className="space-y-2 text-body text-ink-2">
            {[
              'What stabilizes the movement',
              'What loads the spine',
              'What stresses each joint',
              'What positions are required',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <IconCheck size={18} className="mt-0.5 shrink-0 text-action" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="text-body font-medium text-ink">
            So when you&apos;re injured, we can give you a workout that&apos;s actually safe — not just &quot;do
            arms instead.&quot;
          </p>
        </ContentCard>
      </ArticleSection>

      <ArticleCTA
        title="Have an injury?"
        body="Log it in your profile and we'll automatically adjust your workouts."
        href="/dashboard/profile"
        label="Manage injuries"
      />

      <ArticleSection title="Related articles">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RelatedLink
            href="/dashboard/learn/adaptive-volume"
            icon={IconChartBar}
            title="Personalized volume and recovery"
            subtitle="How we track fatigue to prevent injury"
          />
          <RelatedLink
            href="/dashboard/learn/adaptive-tdee"
            icon={IconFlame}
            title="How we calculate your metabolism"
            subtitle="Adaptive TDEE (daily calorie burn) estimation"
          />
        </div>
      </ArticleSection>
    </ArticlePage>
  );
}
