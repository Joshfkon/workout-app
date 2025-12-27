'use client';

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
      'Learn the fundamental principle of muscle growth and how HyperTracker tracks and automates your progression.',
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
    bg: 'bg-success-500/10',
    border: 'border-success-500/20',
    text: 'text-success-400',
    gradient: 'from-success-500/10',
  },
  purple: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    text: 'text-purple-400',
    gradient: 'from-purple-500/10',
  },
  blue: {
    bg: 'bg-primary-500/10',
    border: 'border-primary-500/20',
    text: 'text-primary-400',
    gradient: 'from-primary-500/10',
  },
  cyan: {
    bg: 'bg-accent-500/10',
    border: 'border-accent-500/20',
    text: 'text-accent-400',
    gradient: 'from-accent-500/10',
  },
};

export default function LearnPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 via-purple-400 to-pink-400">
          Learn & Science
        </h1>
        <p className="text-surface-400 max-w-xl mx-auto">
          Understand the research and algorithms that power HyperTracker. Every feature is built on
          evidence-based science.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-primary-400">12+</p>
          <p className="text-xs text-surface-500">Principles</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-success-400">20+</p>
          <p className="text-xs text-surface-500">Injury Types</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-purple-400">500+</p>
          <p className="text-xs text-surface-500">S-Tier Exercises</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-orange-400">AI</p>
          <p className="text-xs text-surface-500">TDEE</p>
        </Card>
      </div>

      {/* Article List */}
      <div className="space-y-4">
        {articles.map((article) => {
          const colors = colorClasses[article.color];
          return (
            <Link key={article.id} href={`/dashboard/learn/${article.id}`}>
              <Card
                className={`p-6 border ${colors.border} hover:border-opacity-60 transition-all duration-200 bg-gradient-to-r ${colors.gradient} to-transparent cursor-pointer group`}
              >
                <div className="flex items-start gap-4">
                  <div className="text-4xl shrink-0">{article.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
                      <div>
                        <h3 className="text-lg font-semibold text-surface-100 group-hover:text-white transition-colors">
                          {article.title}
                        </h3>
                        <p className="text-sm text-surface-400">{article.subtitle}</p>
                      </div>
                      <span
                        className={`px-3 py-1 ${colors.bg} ${colors.text} rounded-full text-xs font-medium shrink-0`}
                      >
                        {article.tag}
                      </span>
                    </div>
                    <p className="text-sm text-surface-500 mb-3">{article.description}</p>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-surface-600">{article.readTime}</span>
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
        <h2 className="text-lg font-semibold text-surface-100 mb-4">Research We Build On</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="font-medium text-surface-200 text-sm">Dr. Mike Israetel</p>
            <p className="text-xs text-surface-500">Volume, SFR</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="font-medium text-surface-200 text-sm">Dr. Brad Schoenfeld</p>
            <p className="text-xs text-surface-500">Hypertrophy</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="font-medium text-surface-200 text-sm">Dr. Greg Nuckols</p>
            <p className="text-xs text-surface-500">Periodization</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="font-medium text-surface-200 text-sm">Dr. Eric Helms</p>
            <p className="text-xs text-surface-500">Natural BBing</p>
          </div>
        </div>
      </Card>

      {/* CTA */}
      <Card className="p-6 text-center bg-gradient-to-r from-primary-500/10 to-purple-500/10 border-primary-500/20">
        <h2 className="text-xl font-bold text-surface-100 mb-2">Want More Science?</h2>
        <p className="text-sm text-surface-400 mb-4">
          Check out our full science page with all 12+ research principles.
        </p>
        <Link href="/dashboard/science">
          <button className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
            View All Principles
          </button>
        </Link>
      </Card>
    </div>
  );
}
