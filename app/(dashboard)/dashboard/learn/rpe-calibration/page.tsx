'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconAlertTriangle,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconHandStop,
  IconShieldCheck,
  IconTarget,
  IconTrendingUp,
} from '@tabler/icons-react';
import {
  ArticleHeader,
  ArticlePage,
  ArticleSection,
  BackLink,
  BulletList,
  ContentCard,
  IconBadge,
  TermNote,
} from '@/components/learn/ArticleKit';
import { RPE_CALIBRATION_CONTENT } from '@/lib/content/learnContent';

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

/**
 * The shared learn content is written in title case; show headings in
 * sentence case, keeping acronyms (RIR, AMRAP) and the product name.
 */
function toSentenceCase(text: string): string {
  return text
    .split(' ')
    .map((word, i) => {
      if (i === 0) return word;
      const bare = word.replace(/[^A-Za-z]/g, '');
      if (bare.length > 1 && bare === bare.toUpperCase()) return word;
      if (bare === 'HyperTrack') return word;
      return word.toLowerCase();
    })
    .join(' ');
}

/** Render `**bold**` spans from the shared content as emphasis. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

/**
 * Turn a section's plain-text content into paragraphs and bullet lists:
 * consecutive "- " lines become one list, everything else is a paragraph.
 */
function renderSectionContent(content: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(<BulletList key={`list-${blocks.length}`} items={bullets.map(renderInline)} />);
      bullets = [];
    }
  };
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('- ')) {
      bullets.push(line.slice(2));
      continue;
    }
    flush();
    if (line) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="text-body text-ink-2">
          {renderInline(line)}
        </p>
      );
    }
  }
  flush();
  return blocks;
}

const keyTakeaways = [
  'Most lifters underestimate proximity to failure by 2-4 reps',
  'AMRAP sets on safe exercises calibrate your RPE perception',
  'Never go to failure on heavy barbell compounds - injury risk is too high',
  'Your bias is shown after each AMRAP so you can adjust future efforts',
];

const safetyTiers: Array<{
  icon: TablerIcon;
  iconClass: string;
  title: string;
  body: string;
  examples: string;
}> = [
  {
    icon: IconCircleCheck,
    iconClass: 'text-status-ok',
    title: 'Safe to fail',
    body: 'Machines, cables, isolation exercises. The machine catches the weight. Use these for AMRAP calibration sets.',
    examples: 'Leg press, chest fly machine, lat pulldown, cable curls',
  },
  {
    icon: IconAlertTriangle,
    iconClass: 'text-status-warn',
    title: 'Moderate risk',
    body: 'Free weights that can be dropped, supported movements. Keep 1 rep in reserve normally, test at mesocycle end.',
    examples: 'Dumbbell bench, lunges, Romanian deadlifts, step-ups',
  },
  {
    icon: IconHandStop,
    iconClass: 'text-status-bad',
    title: 'Protect (never fail)',
    body: 'Heavy barbell compounds where failure means injury risk. Always stay at 2+ RIR. Use calibration from safe exercises.',
    examples: 'Barbell bench press, back squat, deadlift, overhead press',
  },
];

const rirReference = [
  { value: '4+', label: 'Easy', detail: 'Could do 4+ more', accent: false },
  { value: '2-3', label: 'Good', detail: 'Optimal training zone', accent: true },
  { value: '1', label: 'Hard', detail: 'Could do 1 more', accent: false },
  { value: '0', label: 'Failure', detail: 'No more reps possible', accent: false },
];

export default function RPECalibrationPage() {
  useDocumentTitle('RPE calibration');
  const rpeContent = RPE_CALIBRATION_CONTENT;

  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconTarget}
        tag="Training science"
        title={toSentenceCase(rpeContent.title.replace('&', 'and'))}
        subtitle={rpeContent.description}
      />
      <div className="space-y-1">
        <TermNote term="RPE" fullName="rate of perceived exertion" />
        <TermNote term="RIR" fullName="reps in reserve" />
      </div>

      <ArticleSection title="Key takeaways">
        <ContentCard>
          <ul className="space-y-2 text-body text-ink-2">
            {keyTakeaways.map((t) => (
              <li key={t} className="flex items-start gap-2">
                <IconCheck size={18} className="mt-0.5 shrink-0 text-action" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </ContentCard>
      </ArticleSection>

      {rpeContent.sections.map((section) => (
        <ArticleSection key={section.heading} title={toSentenceCase(section.heading)}>
          {renderSectionContent(section.content)}
        </ArticleSection>
      ))}

      <ArticleSection title="Safety tier reference">
        <p className="text-body text-ink-2">
          Every exercise in the app has a safety tier that sets how close to failure you should push.
        </p>
        <div className="space-y-3">
          {safetyTiers.map((tier) => {
            const Icon = tier.icon;
            return (
              <ContentCard key={tier.title}>
                <div className="flex items-start gap-3">
                  <Icon size={22} stroke={2} className={`mt-0.5 shrink-0 ${tier.iconClass}`} aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-headline text-ink">{tier.title}</h3>
                    <p className="text-subhead text-ink-2">{tier.body}</p>
                    <p className="text-caption text-ink-3">Examples: {tier.examples}</p>
                  </div>
                </div>
              </ContentCard>
            );
          })}
        </div>
      </ArticleSection>

      <ArticleSection title="RIR quick reference">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {rirReference.map((r) => (
            <ContentCard key={r.label} className="space-y-1 text-center">
              <p className={`text-title ${r.accent ? 'text-action' : 'text-ink'}`}>{r.value}</p>
              <p className="text-subhead font-medium text-ink">{r.label}</p>
              <p className="text-caption text-ink-3">{r.detail}</p>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="How calibration works">
        <ContentCard className="space-y-3">
          <p className="text-body text-ink-2">
            <strong className="font-semibold text-ink">Scenario:</strong> You&apos;ve been doing leg press,
            reporting your sets as &quot;8 reps @ RIR 3&quot; (implying you could do 11 total).
          </p>
          <p className="text-body text-ink-2">
            On your last set, we make it an AMRAP. You push to true failure and hit 14 reps.
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Predicted', value: '11' },
              { label: 'Actual', value: '14' },
              { label: 'Bias', value: '+3' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-fill p-3">
                <p className="text-caption text-ink-3">{s.label}</p>
                <p className="text-title text-ink">{s.value}</p>
              </div>
            ))}
          </div>
          <p className="text-body text-ink-2">
            <strong className="font-semibold text-ink">Result:</strong> You were sandbagging by 3 reps. Your
            &quot;hard&quot; sets weren&apos;t as hard as you thought. Time to push harder on your working sets.
          </p>
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Related articles">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RelatedLink
            href="/dashboard/learn/progressive-overload"
            icon={IconTrendingUp}
            title="Progressive overload explained"
            subtitle="The science of getting stronger over time"
          />
          <RelatedLink
            href="/dashboard/learn/injury-prevention"
            icon={IconShieldCheck}
            title="Smart injury prevention"
            subtitle="How we keep you safe with exercise analysis"
          />
          <RelatedLink
            href="/dashboard/learn/adaptive-volume"
            icon={IconChartBar}
            title="Personalized volume and recovery"
            subtitle="How we learn your optimal training volume"
          />
        </div>
      </ArticleSection>

      <div className="flex justify-center">
        <BackLink href="/dashboard/learn" label="All articles" />
      </div>
    </ArticlePage>
  );
}
