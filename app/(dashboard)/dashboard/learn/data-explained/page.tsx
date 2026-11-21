'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import type { ReactNode } from 'react';
import { IconCalculator } from '@tabler/icons-react';
import { ArticleCTA, ArticleHeader, ArticlePage, ContentCard, TermNote } from '@/components/learn/ArticleKit';

const metrics: Array<{ name: string; description: string; formula: string; usage: string; terms?: ReactNode }> = [
  {
    name: 'e1RM (estimated 1RM)',
    description: 'Your estimated one-rep max, calculated from your best sets using the Epley formula.',
    formula: 'Weight × (1 + Reps/30)',
    usage: 'Tracks strength progress over time without needing to actually max out.',
    terms: <TermNote term="e1RM" fullName="estimated one-rep max" />,
  },
  {
    name: 'Weekly volume',
    description: 'Total hard sets per muscle group per week.',
    formula: 'Count of sets within 0-3 RIR',
    usage: "Keeps you in the productive 10-20 sets a week range for most muscles.",
    terms: <TermNote term="RIR" fullName="reps in reserve" />,
  },
  {
    name: 'Fatigue budget',
    description: 'Running total of exercise "costs" to prevent overtraining.',
    formula: 'Compounds: 8-12 pts, Isolations: 3-5 pts',
    usage: 'Triggers deloads when approaching your weekly limit.',
  },
  {
    name: 'FFMI',
    description: 'Fat-free mass index: how muscular you are relative to your height.',
    formula: 'Lean Mass (kg) / Height (m)² + 6.1 × (1.8 - Height)',
    usage: 'Natural limit typically 24-26. Helps set realistic goals.',
  },
  {
    name: 'RPE and RIR',
    description: 'Rate of perceived exertion and reps in reserve.',
    formula: 'RPE 10 = 0 RIR = failure',
    usage: 'Adjusts intensity to how you are performing on the day.',
    terms: <TermNote term="RPE" fullName="rate of perceived exertion" />,
  },
  {
    name: 'MEV, MAV and MRV',
    description: 'Volume landmarks from Renaissance Periodization.',
    formula: 'MEV < MAV < MRV',
    usage: 'Minimum effective, maximum adaptive and maximum recoverable volume.',
    terms: (
      <>
        <TermNote term="MEV" fullName="minimum effective volume" />
        <TermNote term="MAV" fullName="maximum adaptive volume" />
        <TermNote term="MRV" fullName="maximum recoverable volume" />
      </>
    ),
  },
];

export default function DataExplainedArticle() {
  useDocumentTitle('Data explained');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconCalculator}
        tag="Guide"
        title="Understanding your data"
        subtitle="A guide to every metric we track and what the numbers mean."
      />

      <div className="space-y-3">
        {metrics.map((metric) => (
          <ContentCard key={metric.name} className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-headline text-ink">{metric.name}</h2>
              <p className="text-body text-ink-2">{metric.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-fill p-3">
                <p className="text-caption text-ink-3">Formula</p>
                <p className="font-mono text-subhead text-ink-2">{metric.formula}</p>
              </div>
              <div className="rounded-xl bg-fill p-3">
                <p className="text-caption text-ink-3">How we use it</p>
                <p className="text-subhead text-ink-2">{metric.usage}</p>
              </div>
            </div>
            {metric.terms && <div className="space-y-1">{metric.terms}</div>}
          </ContentCard>
        ))}
      </div>

      <ArticleCTA
        title="View your analytics"
        body="See all your metrics in action on your dashboard."
        href="/dashboard/analytics"
        label="Go to analytics"
      />
    </ArticlePage>
  );
}
