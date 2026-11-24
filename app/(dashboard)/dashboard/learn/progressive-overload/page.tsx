'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import type { Icon as TablerIcon } from '@tabler/icons-react';
import { IconBarbell, IconChartBar, IconListNumbers, IconTarget, IconTrendingUp } from '@tabler/icons-react';
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

const waysToProgress: Array<{ icon: TablerIcon; title: string; body: string }> = [
  { icon: IconBarbell, title: 'More weight', body: 'Add 2.5-5 lbs when you hit your rep target' },
  { icon: IconListNumbers, title: 'More reps', body: 'Add 1-2 reps per set before increasing weight' },
  { icon: IconChartBar, title: 'More sets', body: 'Add volume over the training block' },
  { icon: IconTarget, title: 'Better technique', body: 'Improved muscle tension per rep' },
];

export default function ProgressiveOverloadArticle() {
  useDocumentTitle('Progressive overload');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconTrendingUp}
        tag="Training science"
        title="Progressive overload explained"
        subtitle="The fundamental principle of muscle growth and how HyperTrack automates your progression."
      />

      <ArticleSection title="The core principle">
        <Callout>
          <p>To grow, you must progressively demand more of your body.</p>
        </Callout>
        <p className="text-body text-ink-2">
          The body adapts to stress. If you do the same workout forever, you stop growing. Progressive overload
          means steadily increasing the challenge over time.
        </p>
      </ArticleSection>

      <ArticleSection title="Ways to progress">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {waysToProgress.map((way) => (
            <ContentCard key={way.title}>
              <div className="flex items-start gap-3">
                <IconBadge icon={way.icon} />
                <div className="min-w-0 space-y-1">
                  <h3 className="text-headline text-ink">{way.title}</h3>
                  <p className="text-subhead text-ink-2">{way.body}</p>
                </div>
              </div>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="How we track it">
        <ContentCard>
          <BulletList
            items={[
              'Estimated one-rep max (e1RM) tracking shows your strength progress over time',
              "Weekly volume tracking makes sure you're doing enough work",
              'Plateau detection alerts you when progress stalls',
              'Weight suggestions help you know when to increase',
            ]}
          />
        </ContentCard>
        <TermNote term="e1RM" fullName="estimated one-rep max" />
      </ArticleSection>

      <ArticleCTA
        title="Start a new training block"
        body="Our AI builds progression right into your program."
        href="/dashboard/mesocycle/new"
        label="Create training block"
      />
    </ArticlePage>
  );
}
