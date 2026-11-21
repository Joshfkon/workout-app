'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconCalculator,
  IconChartBar,
  IconChevronRight,
  IconDeviceWatch,
  IconFlame,
  IconListCheck,
  IconShieldCheck,
  IconTarget,
  IconTrendingUp,
} from '@tabler/icons-react';
import { ArticleCTA, ArticlePage, ContentCard, IconBadge } from '@/components/learn/ArticleKit';

const articles: Array<{
  id: string;
  icon: TablerIcon;
  title: string;
  subtitle: string;
  description: string;
  tag: string;
  readTime: string;
}> = [
  {
    id: 'rpe-calibration',
    icon: IconTarget,
    title: 'How hard is hard: RPE and safety tiers',
    subtitle: 'How we help you understand true proximity to failure',
    description:
      'Learn why most lifters underestimate their capacity by 2-4 reps, how AMRAP sets calibrate your perception, and which exercises are safe to push to failure.',
    tag: 'Training science',
    readTime: '6 min read',
  },
  {
    id: 'adaptive-volume',
    icon: IconChartBar,
    title: 'Personal volume and recovery',
    subtitle: 'How we learn your optimal training volume through data, not guesswork',
    description:
      'Discover how we track your progression, RIR drift, and form quality to work out your own maximum recoverable volume (the most weekly sets you can recover from) for each muscle group.',
    tag: 'Training science',
    readTime: '8 min read',
  },
  {
    id: 'adaptive-tdee',
    icon: IconFlame,
    title: 'How we work out your metabolism',
    subtitle: 'Why generic formulas fail, and how we use your own data instead',
    description:
      'Learn how our adaptive TDEE system fits your logged weight and calories to work out how many calories you really burn each day.',
    tag: 'Nutrition science',
    readTime: '5 min read',
  },
  {
    id: 'wearable-integration',
    icon: IconDeviceWatch,
    title: 'Calories that follow your activity',
    subtitle: 'How we use your Apple Watch or Fitbit data for day-by-day accuracy',
    description:
      'Learn how we integrate step data and workout calories to give you daily calorie targets that match your actual activity level.',
    tag: 'Wearables',
    readTime: '6 min read',
  },
  {
    id: 'injury-prevention',
    icon: IconShieldCheck,
    title: 'Injury prevention',
    subtitle: 'How we keep you safe with exercise biomechanics analysis',
    description:
      'Discover how we analyze stabilizer muscles, spinal loading, and movement patterns to protect you from injury and suggest safe alternatives.',
    tag: 'Safety',
    readTime: '6 min read',
  },
  {
    id: 'exercise-science',
    icon: IconListCheck,
    title: 'How we rate exercises',
    subtitle: 'Why we rate exercises S/A/B/C and how to pick the best movements',
    description:
      'Understand the hypertrophy research behind our exercise ratings, including stimulus-to-fatigue ratio, stretch under load, and progression ease.',
    tag: 'Training science',
    readTime: '7 min read',
  },
  {
    id: 'progressive-overload',
    icon: IconTrendingUp,
    title: 'Progressive overload explained',
    subtitle: 'The science of getting stronger over time',
    description:
      'Learn the fundamental principle of muscle growth and how HyperTrack tracks and automates your progression.',
    tag: 'Training science',
    readTime: '4 min read',
  },
  {
    id: 'data-explained',
    icon: IconCalculator,
    title: 'Understanding your data',
    subtitle: 'What all your numbers mean',
    description:
      'A comprehensive guide to the numbers we track: estimated one-rep max, weekly set targets, fatigue budget, FFMI, and more.',
    tag: 'Guide',
    readTime: '8 min read',
  },
];

export default function LearnPage() {
  useDocumentTitle('Learn');
  return (
    <ArticlePage>
      <header className="space-y-2">
        <h1 className="text-large-title text-ink">Learn</h1>
        <p className="text-body text-ink-2">
          The research behind HyperTrack, and what every number in the app means.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { value: '12+', label: 'Research principles' },
          { value: '20+', label: 'Injury types covered' },
          { value: '500+', label: 'Rated exercises' },
          { value: 'Adaptive', label: 'Calorie burn estimate' },
        ].map((stat) => (
          <ContentCard key={stat.label} className="text-center">
            <p className="text-title text-ink">{stat.value}</p>
            <p className="text-caption text-ink-3">{stat.label}</p>
          </ContentCard>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-title text-ink">Articles</h2>
        {articles.map((article) => (
          <Link key={article.id} href={`/dashboard/learn/${article.id}`} className="block">
            <ContentCard className="transition-colors active:bg-fill">
              <div className="flex items-start gap-3">
                <IconBadge icon={article.icon} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-caption text-action">{article.tag}</p>
                  <h3 className="text-headline text-ink">{article.title}</h3>
                  <p className="text-subhead text-ink-2">{article.subtitle}</p>
                  <p className="text-subhead text-ink-3">{article.description}</p>
                  <p className="text-caption text-ink-3">{article.readTime}</p>
                </div>
                <IconChevronRight size={20} className="mt-2 shrink-0 text-ink-3" aria-hidden="true" />
              </div>
            </ContentCard>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-title text-ink">Research we build on</h2>
        <ContentCard className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { name: 'Dr. Mike Israetel', topic: 'Volume, stimulus vs fatigue' },
            { name: 'Dr. Brad Schoenfeld', topic: 'Muscle growth' },
            { name: 'Dr. Greg Nuckols', topic: 'Periodization' },
            { name: 'Dr. Eric Helms', topic: 'Natural bodybuilding' },
          ].map((r) => (
            <div key={r.name}>
              <p className="text-body font-medium text-ink">{r.name}</p>
              <p className="text-caption text-ink-3">{r.topic}</p>
            </div>
          ))}
        </ContentCard>
      </section>

      <ArticleCTA
        title="Want the full research list?"
        body="The science page covers all 12+ principles the app is built on."
        href="/dashboard/science"
        label="See all principles"
      />
    </ArticlePage>
  );
}
