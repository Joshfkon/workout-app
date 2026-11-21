'use client';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconAdjustments,
  IconApple,
  IconBarbell,
  IconBattery2,
  IconBook,
  IconBrain,
  IconCalculator,
  IconChartBar,
  IconCheck,
  IconCircleHalf2,
  IconClock,
  IconFlame,
  IconMinus,
  IconPill,
  IconRefresh,
  IconRobot,
  IconStar,
  IconTarget,
  IconTrendingUp,
  IconTrophy,
} from '@tabler/icons-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  ArticleHeader,
  ArticlePage,
  ArticleSection,
  ContentCard,
  IconBadge,
  TermNote,
} from '@/components/learn/ArticleKit';

const features: Array<{ icon: TablerIcon; title: string; description: string; competitors: string }> = [
  {
    icon: IconBrain,
    title: 'AI-powered mesocycle planning',
    description: 'Unlike basic workout trackers, HyperTrack uses intelligent algorithms to design periodized training programs tailored to your goals, experience, recovery capacity, and available time.',
    competitors: 'Most apps just let you log workouts. We plan them for you.',
  },
  {
    icon: IconRobot,
    title: 'AI coaching notes',
    description: 'Get personalized coaching advice before every workout. Our AI looks at your history, body composition, mesocycle phase, and goals to give context-aware guidance, like having a knowledgeable coach in your pocket.',
    competitors: 'Other apps give generic tips. We give advice specific to you.',
  },
  {
    icon: IconApple,
    title: 'Complete nutrition tracking',
    description: 'Track your nutrition with USDA FoodData Central: 300,000+ foods. Log meals, scan barcodes, and watch your macros update in real time on your dashboard.',
    competitors: 'Why switch apps? We bring training and nutrition together.',
  },
  {
    icon: IconCalculator,
    title: 'Smart macro calculator',
    description: 'Our evidence-based macro calculator considers your goals, activity level, training frequency, and even GLP-1 medications. Macros update automatically when you log a new weight.',
    competitors: 'Static macro targets are outdated. Ours adapt.',
  },
  {
    icon: IconBattery2,
    title: 'Auto-regulation and fatigue management',
    description: 'Our fatigue budget system tracks both whole-body (CNS) and local muscle fatigue, adjusting your workout in real time. The stimulus-to-fatigue ratio (SFR) makes sure every exercise earns its place.',
    competitors: 'Other apps ignore fatigue. We plan for sustainable gains.',
  },
  {
    icon: IconStar,
    title: 'S-tier exercise selection',
    description: 'Every exercise in our database is rated S/A/B/C for muscle-building effectiveness. We prioritize high stimulus-to-fatigue exercises so you get more growth with less burnout.',
    competitors: 'Random exercise generators ignore exercise quality.',
  },
  {
    icon: IconTarget,
    title: 'Smart rep range system',
    description: 'Rep ranges adapt to muscle fiber type, exercise position in the workout, periodization phase, and your experience level. Fast-twitch dominant muscles get heavier loads; slow-twitch get higher reps.',
    competitors: 'Generic "3x10" recommendations are obsolete.',
  },
  {
    icon: IconChartBar,
    title: 'DEXA tracking and FFMI analysis',
    description: 'Track body composition scans over time. Calculate your fat-free mass index to see where you stand against natural limits. Get AI coaching recommendations for recomposition.',
    competitors: 'No other workout app integrates body composition intelligence.',
  },
  {
    icon: IconPill,
    title: 'GLP-1 and peptide support',
    description: 'On Ozempic, Mounjaro, or other GLP-1 medications? We raise protein targets (up to 1.2g/lb) to prevent muscle loss during aggressive cuts. First app to support this.',
    competitors: 'Most apps don\'t even know what GLP-1s are.',
  },
  {
    icon: IconRefresh,
    title: 'Reactive deload detection',
    description: 'HyperTrack monitors performance trends, sleep quality, motivation, and joint health to suggest deloads before you overtrain, not on a fixed schedule.',
    competitors: 'Fixed "deload every 4th week" ignores individual recovery.',
  },
  {
    icon: IconTrendingUp,
    title: 'e1RM tracking and plateau detection',
    description: 'Track your estimated one-rep max (e1RM: the most you could lift once, worked out from your normal sets) for every exercise. Our algorithms spot stagnation early and suggest exercise swaps, volume changes, or intensity changes.',
    competitors: 'Most apps just show raw numbers. We show the trend.',
  },
  {
    icon: IconBarbell,
    title: 'Intelligent volume landmarks',
    description: 'Set a personal MEV (minimum effective volume: the fewest weekly sets that still grow a muscle) and MRV (maximum recoverable volume: the most weekly sets you can recover from) for each muscle group. HyperTrack keeps you in the productive zone.',
    competitors: 'Cookie-cutter volume prescriptions waste your time.',
  },
  {
    icon: IconClock,
    title: 'Smart rest timer',
    description: 'Auto-starting rest timers with exercise-specific durations and audio alerts. Compounds get longer rest for strength; isolations get shorter rest for metabolic stress.',
    competitors: 'Basic timers ignore exercise context.',
  },
  {
    icon: IconFlame,
    title: 'Set quality assessment',
    description: 'Every set is rated stimulative, effective, or junk based on how hard it felt (RPE), how many reps you had left (RIR), and your rep targets. Know exactly which sets drove growth and which were wasted volume.',
    competitors: 'Logging without analysis is just a diary.',
  },
];

type SupportLevel = boolean | 'partial';

interface ComparisonRow {
  feature: string;
  hypertracker: SupportLevel;
  strongApp: SupportLevel;
  hevy: SupportLevel;
  fitbod: SupportLevel;
}

function SupportIcon({ value }: { value: SupportLevel }) {
  if (value === true) {
    return (
      <span className="inline-flex text-action">
        <IconCheck size={20} stroke={2.5} aria-hidden="true" />
        <span className="sr-only">Full support</span>
      </span>
    );
  }
  if (value === 'partial') {
    return (
      <span className="inline-flex text-ink-2">
        <IconCircleHalf2 size={18} aria-hidden="true" />
        <span className="sr-only">Partial support</span>
      </span>
    );
  }
  return (
    <span className="inline-flex text-ink-3">
      <IconMinus size={18} aria-hidden="true" />
      <span className="sr-only">Not available</span>
    </span>
  );
}

const comparisonPoints: ComparisonRow[] = [
  { feature: 'AI mesocycle generation', hypertracker: true, strongApp: false, hevy: false, fitbod: 'partial' },
  { feature: 'AI coaching notes', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Integrated nutrition tracking', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Smart macro calculator', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'GLP-1/peptide macro adjustment', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Auto-update macros on weight change', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'S-tier exercise scoring', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Fatigue budget system', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'SFR-based exercise selection', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'DEXA/FFMI tracking', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Reactive deload detection', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Muscle fiber type optimization', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Volume landmark personalization', hypertracker: true, strongApp: false, hevy: false, fitbod: 'partial' },
  { feature: 'Set quality analysis', hypertracker: true, strongApp: false, hevy: false, fitbod: false },
  { feature: 'Basic workout logging', hypertracker: true, strongApp: true, hevy: true, fitbod: true },
  { feature: 'Exercise library', hypertracker: true, strongApp: true, hevy: true, fitbod: true },
];

const audiences: Array<{ icon: TablerIcon; title: string; body: string }> = [
  {
    icon: IconTrophy,
    title: 'Intermediate lifters',
    body: 'Past the beginner gains but want to make the most of the next phase. You need smart programming, not just more volume.',
  },
  {
    icon: IconBook,
    title: 'Evidence-based enthusiasts',
    body: 'You\'ve read the research and want an app that actually puts it to work. No bro-science here.',
  },
  {
    icon: IconAdjustments,
    title: 'Optimization nerds',
    body: 'You want to squeeze every drop of progress from your training. You care about efficiency, not just effort.',
  },
];

export default function AboutPage() {
  useDocumentTitle('About');

  return (
    <ArticlePage>
      <ArticleHeader
        backHref=""
        title="HyperTrack"
        subtitle="The most scientifically advanced muscle-building and nutrition app ever built. AI-powered workout planning, smart nutrition tracking, and personal coaching, all in one place."
      />

      <ArticleSection title="Our philosophy">
        <ContentCard className="space-y-3 text-body text-ink-2">
          <p>
            <strong className="font-semibold text-ink">Most fitness apps are glorified notepads.</strong> They let you log
            sets and reps or track calories on their own, maybe show a graph, and call it a day. But data without
            intelligence is just busywork.
          </p>
          <p>
            HyperTrack brings <strong className="font-semibold text-ink">training and nutrition</strong> into one system
            built on current science: Renaissance Periodization&apos;s volume landmarks, Mike Israetel&apos;s SFR concepts,
            Greg Nuckols&apos; periodization research, Brad Schoenfeld&apos;s hypertrophy mechanisms, and evidence-based
            nutrition. Our AI coaching ties it all together.
          </p>
          <p>
            <strong className="font-semibold text-ink">The result?</strong> Every set you do is intentional. Every
            exercise is S-tier optimized. Your macros adapt to your changing body. You get personal
            coaching advice before every workout. No more guessing, no more junk volume, no more spinning your wheels.
          </p>
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Features that actually matter">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <ContentCard key={feature.title} className="space-y-2">
              <IconBadge icon={feature.icon} />
              <h3 className="text-headline text-ink">{feature.title}</h3>
              <p className="text-subhead text-ink-2">{feature.description}</p>
              <p className="text-caption text-action">{feature.competitors}</p>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="How we compare">
        <ContentCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-subhead">
              <thead>
                <tr className="bg-fill">
                  <th scope="col" className="p-3 text-left font-medium text-ink-2">Feature</th>
                  <th scope="col" className="p-3 text-center font-semibold text-action">HyperTrack</th>
                  <th scope="col" className="p-3 text-center font-medium text-ink-2">Strong</th>
                  <th scope="col" className="p-3 text-center font-medium text-ink-2">Hevy</th>
                  <th scope="col" className="p-3 text-center font-medium text-ink-2">Fitbod</th>
                </tr>
              </thead>
              <tbody>
                {comparisonPoints.map((row, idx) => (
                  <tr key={row.feature} className={idx % 2 === 1 ? 'bg-fill/50' : ''}>
                    <td className="p-3 text-ink-2">{row.feature}</td>
                    <td className="p-3 text-center">
                      <SupportIcon value={Boolean(row.hypertracker)} />
                    </td>
                    <td className="p-3 text-center">
                      <SupportIcon value={row.strongApp} />
                    </td>
                    <td className="p-3 text-center">
                      <SupportIcon value={row.hevy} />
                    </td>
                    <td className="p-3 text-center">
                      <SupportIcon value={row.fitbod} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-fill p-3 text-caption text-ink-3">
            <span className="inline-flex items-center gap-1">
              <IconCheck size={14} stroke={2.5} className="text-action" aria-hidden="true" /> Full support
            </span>
            <span className="inline-flex items-center gap-1">
              <IconCircleHalf2 size={14} className="text-ink-2" aria-hidden="true" /> Partial or limited
            </span>
            <span className="inline-flex items-center gap-1">
              <IconMinus size={14} aria-hidden="true" /> Not available
            </span>
          </div>
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Who is HyperTrack for?">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {audiences.map((a) => (
            <ContentCard key={a.title} className="space-y-2">
              <IconBadge icon={a.icon} />
              <h3 className="text-headline text-ink">{a.title}</h3>
              <p className="text-subhead text-ink-2">{a.body}</p>
            </ContentCard>
          ))}
        </div>
      </ArticleSection>

      <ArticleSection title="Built on real science">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Volume landmarks (RP)</h3>
            <p className="text-subhead text-ink-2">
              The MEV, MAV, and MRV concepts from Renaissance Periodization keep you training in the productive zone:
              enough to grow, not so much you can&apos;t recover.
            </p>
            <TermNote term="MAV" fullName="maximum adaptive volume" />
          </ContentCard>
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Stimulus-to-fatigue ratio</h3>
            <p className="text-subhead text-ink-2">
              Not all exercises are equal. Machine flyes give more chest stimulus per unit of fatigue than barbell bench.
              We rate exercises S/A/B/C and prioritize accordingly.
            </p>
          </ContentCard>
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Evidence-based protein</h3>
            <p className="text-subhead text-ink-2">
              1g/lb protein for muscle building, raised to 1.2g/lb during aggressive cuts or GLP-1 use. Our macro
              calculator puts the latest research to work.
            </p>
          </ContentCard>
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Fiber type optimization</h3>
            <p className="text-subhead text-ink-2">
              Calves are slow-twitch dominant (need high reps). Hamstrings are fast-twitch (respond to heavy loads). Your
              rep ranges should reflect this.
            </p>
          </ContentCard>
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Autoregulation and RPE</h3>
            <p className="text-subhead text-ink-2">
              RIR targets that progress through your mesocycle. Start at 3 RIR, end at 0-1 RIR. Steady overload without
              guessing.
            </p>
          </ContentCard>
          <ContentCard className="space-y-2">
            <h3 className="text-headline text-ink">Adaptive TDEE</h3>
            <p className="text-subhead text-ink-2">
              Your metabolism adapts during dieting. When you log a new weight, we recalculate your TDEE and macro targets
              to keep progress on track.
            </p>
            <TermNote term="TDEE" fullName="total daily energy expenditure" />
          </ContentCard>
        </div>
      </ArticleSection>

      <ContentCard className="space-y-3 text-center">
        <h2 className="text-headline text-ink">Ready to train smarter?</h2>
        <p className="text-body text-ink-2">Stop leaving gains on the table with outdated training methods.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard/mesocycle/new"
            className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-action px-5 text-body font-semibold text-on-action"
          >
            Create your mesocycle
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-fill px-5 text-body font-semibold text-ink"
          >
            Go to dashboard
          </Link>
        </div>
      </ContentCard>

      <p className="text-center text-caption text-ink-3">
        HyperTrack keeps evolving. Built for the lifting community.
      </p>
    </ArticlePage>
  );
}
