'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { IconChartBar } from '@tabler/icons-react';
import {
  ArticleCTA,
  ArticleHeader,
  ArticlePage,
  ArticleSection,
  BulletList,
  ContentCard,
} from '@/components/learn/ArticleKit';

const resistanceProfiles = [
  { equipment: 'Cables and well-designed machines', rating: 'Excellent' },
  { equipment: 'Free weights (most angles)', rating: 'Good' },
  { equipment: 'Bodyweight at disadvantaged angles', rating: 'Variable' },
];

const progressionEase = [
  { level: 'Easy', detail: 'Machines (small increments), barbells' },
  { level: 'Medium', detail: 'Dumbbells (5lb jumps can be big)' },
  { level: 'Hard', detail: 'Bodyweight exercises' },
];

const tiers = [
  { tier: 'S', title: 'S-tier', body: 'Maximum stimulus, favorable fatigue, great progression' },
  { tier: 'A', title: 'A-tier', body: 'Excellent exercises with minor drawbacks' },
  { tier: 'B', title: 'B-tier', body: 'Good exercises, useful for variety' },
  { tier: 'C', title: 'C-tier', body: 'Suboptimal but still usable' },
];

export default function ExerciseScienceArticle() {
  useDocumentTitle('Exercise science');
  return (
    <ArticlePage>
      <ArticleHeader
        icon={IconChartBar}
        tag="Training science"
        title="Exercise selection science"
        subtitle="Why we rate exercises S/A/B/C and how to pick the most effective movements for muscle growth."
      />

      <ArticleSection title="Why some exercises build more muscle">
        <p className="text-body text-ink-2">
          Not all exercises are created equal. We rate every exercise using criteria from peer-reviewed
          hypertrophy research:
        </p>
      </ArticleSection>

      <ArticleSection title="Stretch under load">
        <p className="text-body text-ink-2">
          Does the muscle get stretched while under tension? This triggers more muscle growth.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">High stretch</h3>
            <BulletList
              className="text-subhead"
              items={[
                'Incline dumbbell curl',
                'Romanian deadlift',
                'Cable fly (stretched position)',
                'Overhead tricep extension',
              ]}
            />
          </ContentCard>
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Low stretch</h3>
            <BulletList
              className="text-subhead text-ink-3"
              items={['Concentration curl (peak)', 'Leg press (top position)', 'Pec deck (contracted)']}
            />
          </ContentCard>
        </div>
      </ArticleSection>

      <ArticleSection title="Resistance profile">
        <p className="text-body text-ink-2">
          Is the exercise challenging throughout the full range, or only at certain points?
        </p>
        <ContentCard className="p-0">
          <div className="divide-y divide-sep">
            {resistanceProfiles.map((r) => (
              <div key={r.equipment} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 text-body text-ink">{r.equipment}</span>
                <span className="shrink-0 text-subhead text-ink-2">{r.rating}</span>
              </div>
            ))}
          </div>
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Progression ease">
        <p className="text-body text-ink-2">How easy is it to add weight over time?</p>
        <ContentCard className="p-0">
          <div className="divide-y divide-sep">
            {progressionEase.map((p) => (
              <div key={p.level} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="shrink-0 text-headline text-ink">{p.level}</span>
                <span className="min-w-0 text-right text-subhead text-ink-2">{p.detail}</span>
              </div>
            ))}
          </div>
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Our tier system">
        <ContentCard className="space-y-4">
          {tiers.map((t) => (
            <div key={t.tier} className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action-tint text-headline text-action"
                aria-hidden="true"
              >
                {t.tier}
              </span>
              <div className="min-w-0">
                <h3 className="text-headline text-ink">{t.title}</h3>
                <p className="text-subhead text-ink-2">{t.body}</p>
              </div>
            </div>
          ))}
        </ContentCard>
      </ArticleSection>

      <ArticleCTA
        title="Explore our exercise database"
        body="See ratings for 500+ exercises with detailed hypertrophy scores."
        href="/dashboard/exercises"
        label="View exercises"
      />
    </ArticlePage>
  );
}
