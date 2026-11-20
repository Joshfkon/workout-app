'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';

const articles = [
  {
    id: 'rpe-calibration',
    icon: '🎯',
    title: 'RPE Calibration & Safety Tiers',
    subtitle: 'How we help you understand true proximity to failure',
    description:
      'Learn why most lifters underestimate their capacity by 2-4 reps, how AMRAP sets calibrate your perception, and which exercises are safe to push to failure.',
    color: 'green',
    tag: 'Training Science',
    readTime: '6 min read',
  },
  {
    id: 'adaptive-volume',
    icon: '📊',
    title: 'Personalized Volume & Recovery',
    subtitle: 'How we learn your optimal training volume through data, not guesswork',
    description:
      'Discover how we track your progression, RIR drift, and form quality to calculate YOUR personal Maximum Recoverable Volume for each muscle group.',
    color: 'purple',
    tag: 'Training Science',
    readTime: '8 min read',
  },
  {
    id: 'adaptive-tdee',
    icon: '🔥',
    title: 'How We Calculate Your Metabolism',
    subtitle: 'Why generic formulas fail, and how we use YOUR data for accuracy',
    description:
      'Learn how our adaptive TDEE system uses least-squares regression on your actual weight and calorie data to calculate your personal burn rate.',
    color: 'orange',
    tag: 'Nutrition Science',
    readTime: '5 min read',
  },
  {
    id: 'wearable-integration',
    icon: '⌚',
    title: 'Activity-Adjusted TDEE',
    subtitle: 'How we use your Apple Watch or Fitbit data for day-by-day accuracy',
    description:
      'Learn how we integrate step data and workout calories to give you daily calorie targets that match your actual activity level.',
    color: 'blue',
    tag: 'Wearable Integration',
    readTime: '6 min read',
  },
  {
    id: 'injury-prevention',
    icon: '🛡️',
    title: 'Smart Injury Prevention',
    subtitle: 'How we keep you safe with exercise biomechanics analysis',
    description:
      'Discover how we analyze stabilizer muscles, spinal loading, and movement patterns to protect you from injury and suggest safe alternatives.',
    color: 'green',
    tag: 'Safety',
    readTime: '6 min read',
  },
  {
    id: 'exercise-science',
    icon: '📊',
    title: 'Exercise Selection Science',
    subtitle: 'Why we rate exercises S/A/B/C and how to pick the best movements',
    description:
      'Understand the hypertrophy research behind our exercise ratings, including stimulus-to-fatigue ratio, stretch under load, and progression ease.',
    color: 'purple',
    tag: 'Training Science',
    readTime: '7 min read',
  },
  {
    id: 'progressive-overload',
    icon: '📈',
    title: 'Progressive Overload Explained',
    subtitle: 'The science of getting stronger over time',
    description:
      'Learn the fundamental principle of muscle growth and how HyperTrack tracks and automates your progression.',
    color: 'blue',
    tag: 'Training Science',
    readTime: '4 min read',
  },
  {
    id: 'data-explained',
    icon: '🧮',
    title: 'Understanding Your Data',
    subtitle: 'What all your numbers mean',
    description:
      'A comprehensive guide to the metrics we track: E1RM, volume landmarks, fatigue budget, FFMI, and more.',
    color: 'cyan',
    tag: 'Guide',
    readTime: '8 min read',
  },
];

const colorClasses: Record<string, { bg: string; border: string; text: string; gradient: string }> = {
  orange: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    text: 'text-orange-400',
    gradient: 'from-orange-500/10',
  },
  green: {
    bg: 'bg-status-ok/10',
    border: 'border-status-ok/20',
    text: 'text-status-ok',
    gradient: 'from-status-ok/10',
  },
  purple: {
    bg: 'bg-action/10',
    border: 'border-action/20',
    text: 'text-action',
    gradient: 'from-action/10',
  },
  blue: {
    bg: 'bg-action/10',
    border: 'border-action/20',
    text: 'text-action',
    gradient: 'from-action/10',
  },
  cyan: {
    bg: 'bg-action/10',
    border: 'border-action/20',
    text: 'text-action',
    gradient: 'from-action/10',
  },
};

export default function LearnPage() {
  useDocumentTitle('Learn');
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-ink">
          Learn & Science
        </h1>
        <p className="text-ink-2 max-w-xl mx-auto">
          Understand the research and algorithms that power HyperTrack. Every feature is built on
          evidence-based science.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-action">12+</p>
          <p className="text-xs text-ink-3">Principles</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-status-ok">20+</p>
          <p className="text-xs text-ink-3">Injury Types</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-action">500+</p>
          <p className="text-xs text-ink-3">S-Tier Exercises</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-orange-400">AI</p>
          <p className="text-xs text-ink-3">TDEE</p>
        </Card>
      </div>

      {/* Article List */}
      <div className="space-y-4">
        {articles.map((article) => {
          const colors = colorClasses[article.color];
          return (
            <Link key={article.id} href={`/dashboard/learn/${article.id}`}>
              <Card
                className="p-6 transition-colors duration-200 active:bg-fill cursor-pointer group"
              >
                <div className="flex items-start gap-4">
                  <div className="text-4xl shrink-0">{article.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
                      <div>
                        <h3 className="text-lg font-semibold text-ink group-hover:text-ink transition-colors">
                          {article.title}
                        </h3>
                        <p className="text-sm text-ink-2">{article.subtitle}</p>
                      </div>
                      <span
                        className={`px-3 py-1 ${colors.bg} ${colors.text} rounded-full text-xs font-medium shrink-0`}
                      >
                        {article.tag}
                      </span>
                    </div>
                    <p className="text-sm text-ink-3 mb-3">{article.description}</p>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-ink-3">{article.readTime}</span>
                      <span
                        className={`text-xs ${colors.text} group-hover:translate-x-1 transition-transform`}
                      >
                        Read article →
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Featured Researchers */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Research We Build On</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-fill/50 rounded-lg">
            <p className="font-medium text-ink text-sm">Dr. Mike Israetel</p>
            <p className="text-xs text-ink-3">Volume, SFR</p>
          </div>
          <div className="text-center p-3 bg-fill/50 rounded-lg">
            <p className="font-medium text-ink text-sm">Dr. Brad Schoenfeld</p>
            <p className="text-xs text-ink-3">Hypertrophy</p>
          </div>
          <div className="text-center p-3 bg-fill/50 rounded-lg">
            <p className="font-medium text-ink text-sm">Dr. Greg Nuckols</p>
            <p className="text-xs text-ink-3">Periodization</p>
          </div>
          <div className="text-center p-3 bg-fill/50 rounded-lg">
            <p className="font-medium text-ink text-sm">Dr. Eric Helms</p>
            <p className="text-xs text-ink-3">Natural BBing</p>
          </div>
        </div>
      </Card>

      {/* CTA */}
      <Card className="bg-action/10 p-6 text-center border-action/20">
        <h2 className="text-xl font-bold text-ink mb-2">Want More Science?</h2>
        <p className="text-sm text-ink-2 mb-4">
          Check out our full science page with all 12+ research principles.
        </p>
        <Link href="/dashboard/science">
          <button className="px-6 py-2 bg-action hover:bg-action text-on-action font-semibold rounded-lg transition-colors">
            View All Principles
          </button>
        </Link>
      </Card>
    </div>
  );
}
