'use client';

import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconAdjustments,
  IconApple,
  IconBolt,
  IconBooks,
  IconBrain,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconCircleHalf2,
  IconDice5,
  IconFileText,
  IconInfoCircle,
  IconMinus,
  IconPill,
  IconRefreshAlert,
  IconRepeat,
  IconRobot,
  IconTarget,
  IconTrendingUp,
  IconTrophy,
} from '@tabler/icons-react';
import { PublicAppShell } from '@/components/marketing/PublicAppShell';
import {
  ArticleHeader,
  ArticlePage,
  ArticleSection,
  BulletList,
  ContentCard,
  IconBadge,
} from '@/components/learn/ArticleKit';

const features: Array<{
  icon: TablerIcon;
  title: string;
  description: string;
  howItWorks: string;
  disclaimer?: string;
}> = [
  {
    icon: IconBrain,
    title: 'AI-powered mesocycle planning',
    description: 'Unlike basic workout trackers, HyperTrack uses intelligent algorithms to design periodized training programs tailored to your goals, experience, recovery capacity, and available time.',
    howItWorks: 'We analyze your training frequency, session duration, experience level, sleep quality, and stress to recommend the optimal split, volume distribution, and periodization model.',
  },
  {
    icon: IconRobot,
    title: 'AI coaching and personalized notes',
    description: 'Get real AI-powered coaching advice before every workout. Our system analyzes your history, body composition, and current mesocycle phase to give context-aware guidance.',
    howItWorks: 'Using Grok from xAI, we generate personalized coach notes that consider your workout type, week in mesocycle, recent performance, body composition goals, and training history, like having a knowledgeable coach in your pocket.',
    disclaimer: 'AI-generated coaching is informational and educational. It is not a substitute for professional coaching, medical advice, or personalized training supervision.',
  },
  {
    icon: IconApple,
    title: 'Complete nutrition tracking',
    description: 'Track your nutrition with our integrated food database powered by USDA FoodData Central. Log meals, scan barcodes, calculate macros, and auto-adjust targets as your body changes.',
    howItWorks: 'Search 300,000+ foods from the USDA database. Use our smart macro calculator that factors in your goals, activity level, and even GLP-1 medications. Your macro targets automatically recalculate when you log new weight.',
    disclaimer: 'Nutrition recommendations are general guidelines based on common research-backed approaches. They are not medical or dietitian advice. Consult a healthcare provider for personalized nutrition guidance.',
  },
  {
    icon: IconBolt,
    title: 'Auto-regulation and fatigue management',
    description: 'Our fatigue budget system tracks both systemic (CNS) and local muscle fatigue, adjusting your workout in real time.',
    howItWorks: 'Each exercise has a fatigue "cost". Compounds cost more (8-12 points) than isolations (3-5 points). When your weekly budget depletes, we suggest deloads before you burn out.',
  },
  {
    icon: IconTarget,
    title: 'S-tier exercise selection',
    description: 'Not all exercises are created equal. Our database rates every exercise by hypertrophy effectiveness (S/A/B/C tier) based on stimulus-to-fatigue ratio.',
    howItWorks: 'When building your mesocycle, we prioritize S-tier exercises (high stimulus, low fatigue) like cable work and machines, especially later in mesocycles when fatigue accumulates. Compounds are reserved for when you\'re fresh.',
  },
  {
    icon: IconRepeat,
    title: 'Smart rep range system',
    description: 'Rep ranges adapt based on muscle fiber type dominance, exercise position in workout, periodization phase, and your experience level.',
    howItWorks: 'Fast-twitch muscles (hamstrings, triceps) get 4-8 reps. Slow-twitch (calves, delts) get 12-20. Mixed-fiber (chest, back) get 8-12. Compounds start workouts heavier; isolations finish lighter.',
  },
  {
    icon: IconChartBar,
    title: 'DEXA tracking and FFMI analysis',
    description: 'Track body composition scans over time. Calculate your fat-free mass index (FFMI) to see where you stand against natural limits.',
    howItWorks: 'Enter your DEXA scan data (or estimates). We calculate FFMI (lean mass / height²) and compare you to natural benchmarks (21-25 range). AI coaching suggests bulk, cut, or recomp.',
    disclaimer: 'FFMI analysis and body composition metrics are informational tools, not medical assessments. Natural limit estimates are based on population studies and may not apply to every individual.',
  },
  {
    icon: IconPill,
    title: 'GLP-1 and peptide support',
    description: 'On Ozempic, Mounjaro, or other GLP-1 medications? Our macro calculator adjusts protein targets to prevent muscle loss during aggressive cuts.',
    howItWorks: 'Select your medication and we automatically increase protein recommendations (up to 1.2g/lb) and allow larger caloric deficits while keeping you in a safe, muscle-preserving range.',
    disclaimer: 'This feature provides nutrition guidance for those already prescribed GLP-1 medications by their doctor. It is not medical advice. Always follow your healthcare provider\'s instructions and discuss dietary changes with them.',
  },
  {
    icon: IconRefreshAlert,
    title: 'Reactive deload detection',
    description: 'HyperTrack monitors performance trends, sleep quality, motivation, and joint health to automatically suggest deloads before you overtrain.',
    howItWorks: 'If RPE (how hard a set felt, out of 10) consistently hits 9.5+, sleep drops below 2/5, or you miss rep targets for 2+ sessions, we trigger an early deload instead of waiting for a fixed schedule.',
  },
  {
    icon: IconTrendingUp,
    title: 'e1RM tracking and plateau detection',
    description: 'Track estimated one-rep max (e1RM: the most you could lift once, estimated from a set of several reps) trends for every exercise. Our algorithms detect stagnation early and suggest interventions.',
    howItWorks: 'Using the Brzycki formula, we calculate e1RM from every working set. When your e1RM flatlines for 3+ sessions, we flag a plateau and suggest exercise swaps or intensity techniques.',
  },
];

const scienceConcepts: Array<{
  title: string;
  source: string;
  citation?: string;
  doi?: string;
  explanation: string;
  application: string;
}> = [
  {
    title: 'Volume landmarks (MEV, MAV, MRV)',
    source: 'Renaissance Periodization',
    citation: 'Israetel, M., Hoffman, J., Smith, C. (2015). Scientific Principles of Strength Training. Renaissance Periodization.',
    explanation: 'MEV (minimum effective volume) is the least you need to grow. MAV (maximum adaptive volume) is the sweet spot for gains. MRV (maximum recoverable volume) is the ceiling: go beyond it and you regress.',
    application: 'We track your weekly sets per muscle and keep you in the productive zone, typically 10-20 sets/week for most muscles, adjusted for your recovery capacity.',
  },
  {
    title: 'Stimulus-to-fatigue ratio (SFR)',
    source: 'Renaissance Periodization',
    citation: 'Israetel, M. (2017). Training Volume Landmarks for Muscle Growth. Renaissance Periodization.',
    explanation: 'Not all exercises are equal. A machine fly gives great chest stimulus with minimal fatigue to recover from. A barbell bench press stimulates chest but also taxes shoulders, triceps, and CNS.',
    application: 'When building your program, we prioritize high-SFR exercises (machines, cables, isolation work) later in mesocycles when fatigue is high, saving low-SFR compounds for when you\'re fresh.',
  },
  {
    title: 'Evidence-based protein requirements',
    source: 'Peer-reviewed research',
    citation: 'Morton, R.W., et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. British Journal of Sports Medicine, 52(6), 376-384.',
    doi: 'https://doi.org/10.1136/bjsports-2017-097608',
    explanation: 'A meta-analysis of resistance training studies found that gains in fat-free mass and strength plateaued beyond approximately 1.6 g/kg/day total protein intake, with confidence intervals extending to ~2.2 g/kg/day.',
    application: 'Our macro calculator uses 1g/lb (2.2g/kg) as a starting point, which is consistent with this research. Higher intakes may be used when supported by individual goals and preferences.',
  },
  {
    title: 'Muscle fiber type and rep ranges',
    source: 'Exercise physiology',
    citation: 'Schoenfeld, B.J., et al. (2021). Resistance Training Recommendations to Maximize Muscle Hypertrophy in an Athletic Population. International Journal of Strength and Conditioning, 1(1).',
    doi: 'https://doi.org/10.47206/ijsc.v1i1.81',
    explanation: 'Different muscles may have varying proportions of fast-twitch (explosive, fatigable) and slow-twitch (endurance, resistant) fibers. Research suggests a wide rep range (6-20+) can be effective for hypertrophy.',
    application: 'We program varied rep ranges: typically lower reps (4-8) for posterior chain work, moderate (8-12) for mixed-fiber muscles, and higher (12-20+) for slow-twitch dominant muscles, while acknowledging individual variation.',
  },
  {
    title: 'Autoregulation with RPE and RIR',
    source: 'Strength and conditioning',
    citation: 'Helms, E.R., et al. (2016). Application of the Repetitions in Reserve-Based Rating of Perceived Exertion Scale for Resistance Training. Strength & Conditioning Journal, 38(4), 42-49.',
    doi: 'https://doi.org/10.1519/ssc.0000000000000218',
    explanation: 'RPE (rate of perceived exertion) and RIR (reps in reserve: how many more reps you could have done before failing) let you train at the right intensity for your daily readiness, rather than fixed percentages that may not account for recovery state.',
    application: 'We guide progression through RIR: start mesocycles conservatively at 3 RIR, progress to 1 RIR, with final sets potentially reaching 0 RIR. This systematic approach helps manage fatigue.',
  },
  {
    title: 'Energy balance and metabolic adaptation',
    source: 'Nutrition research',
    citation: 'Trexler, E.T., Smith-Ryan, A.E., & Norton, L.E. (2014). Metabolic adaptation to weight loss: implications for the athlete. Journal of the International Society of Sports Nutrition, 11(1), 7.',
    doi: 'https://doi.org/10.1186/1550-2783-11-7',
    explanation: 'Total daily energy expenditure (TDEE), the calories you burn in a day, includes basal metabolic rate, activity, and exercise. During prolonged caloric restriction, metabolic adaptation can reduce TDEE. Regular monitoring helps adjust targets.',
    application: 'Our calculator estimates TDEE from your stats and activity level. When you log new weight, we can help recalculate your targets to support continued progress.',
  },
  {
    title: 'Periodization models',
    source: 'Training science',
    citation: 'Grgic, J., et al. (2017). Effects of linear and daily undulating periodized resistance training programs on measures of muscle hypertrophy: a systematic review and meta-analysis. PeerJ, 5, e3695.',
    doi: 'https://doi.org/10.7717/peerj.3695',
    explanation: 'Periodization involves systematically varying training variables over time. Research comparing linear and daily undulating models found both produce similar hypertrophy outcomes when training volume is equated.',
    application: 'Our mesocycle builder incorporates periodization principles to help vary intensity and volume across training phases for sustainable progress.',
  },
  {
    title: 'Progressive overload',
    source: 'Fundamental principle',
    citation: 'Schoenfeld, B.J. (2010). The mechanisms of muscle hypertrophy and their application to resistance training. Journal of Strength & Conditioning Research, 24(10), 2857-2872.',
    doi: 'https://doi.org/10.1519/jsc.0b013e3181e840f3',
    explanation: 'Progressive overload, gradually increasing training demands, is a foundational principle for continued adaptation. This can involve increasing weight, reps, sets, or improving technique over time.',
    application: 'We track progression over time and suggest incremental increases when performance indicates readiness, such as adding 1-2 reps or modest weight increases when you hit target rep ranges with good form.',
  },
];

const comparisonTable: Array<{ feature: string; hypertracker: true; others: boolean | 'partial' }> = [
  { feature: 'AI mesocycle generation', hypertracker: true, others: false },
  { feature: 'AI coaching notes', hypertracker: true, others: false },
  { feature: 'Integrated nutrition tracking', hypertracker: true, others: 'partial' },
  { feature: 'Smart macro calculator', hypertracker: true, others: false },
  { feature: 'GLP-1 and peptide support', hypertracker: true, others: false },
  { feature: 'Auto-update macros on weight change', hypertracker: true, others: false },
  { feature: 'S-tier exercise scoring', hypertracker: true, others: false },
  { feature: 'Fatigue budget system', hypertracker: true, others: false },
  { feature: 'Fiber type optimization', hypertracker: true, others: false },
  { feature: 'DEXA and FFMI tracking', hypertracker: true, others: false },
  { feature: 'Reactive deload detection', hypertracker: true, others: false },
  { feature: 'Set quality analysis', hypertracker: true, others: false },
  { feature: 'Regional body comp analysis', hypertracker: true, others: false },
  { feature: 'Smart weight recommendations', hypertracker: true, others: 'partial' },
  { feature: 'Basic workout logging', hypertracker: true, others: true },
];

const problems: Array<{ icon: TablerIcon; title: string; body: string }> = [
  {
    icon: IconFileText,
    title: 'They are just digital notepads',
    body: 'Log your sets, see a chart, repeat. No intelligence, no optimization, no understanding of why you\'re doing what you\'re doing.',
  },
  {
    icon: IconDice5,
    title: 'Random workout generators',
    body: 'Some apps generate workouts, but without understanding periodization, fatigue accumulation, or your specific needs. It\'s fitness roulette.',
  },
  {
    icon: IconRepeat,
    title: 'One-size-fits-all volume',
    body: '"Do 3x10 for everything" ignores that muscles respond differently, people recover differently, and goals require different approaches.',
  },
];

const audiences: Array<{ icon: TablerIcon; title: string; body: string }> = [
  {
    icon: IconTrophy,
    title: 'Intermediate lifters',
    body: 'Past the beginner gains, ready to maximize the next phase with intelligent programming.',
  },
  {
    icon: IconBooks,
    title: 'Science-based lifters',
    body: 'You\'ve read the research and want an app that actually implements it. No bro-science.',
  },
  {
    icon: IconAdjustments,
    title: 'Optimization nerds',
    body: 'You want to squeeze every drop of gains from your training. Efficiency over effort.',
  },
];

const onThisPage = [
  { href: '#features', label: 'Features that matter' },
  { href: '#science', label: 'Scientific foundation' },
  { href: '#comparison', label: 'How we compare' },
  { href: '#sources', label: 'Sources and disclaimers' },
];

function OthersCell({ value }: { value: boolean | 'partial' }) {
  if (value === true) {
    return (
      <>
        <IconCheck size={20} className="mx-auto text-ink-2" aria-hidden="true" />
        <span className="sr-only">Yes</span>
      </>
    );
  }
  if (value === 'partial') {
    return (
      <>
        <IconCircleHalf2 size={20} className="mx-auto text-ink-3" aria-hidden="true" />
        <span className="sr-only">Partial</span>
      </>
    );
  }
  return (
    <>
      <IconMinus size={20} className="mx-auto text-ink-3" aria-hidden="true" />
      <span className="sr-only">No</span>
    </>
  );
}

export default function LearnPage() {
  return (
    <PublicAppShell>
      <ArticlePage className="px-4 pt-8">
        {/* Hero */}
        <div className="space-y-4">
          <ArticleHeader
            backHref=""
            title="The science behind HyperTrack"
            subtitle="We didn't just build another workout logger. We encoded decades of exercise science and nutrition research into AI-powered algorithms that optimize your training, diet, and recovery in real time."
          />

          <ContentCard>
            <h2 className="pb-1 text-headline text-ink">On this page</h2>
            <nav className="divide-y divide-sep">
              {onThisPage.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex min-h-[44px] items-center justify-between gap-2 text-body text-action"
                >
                  {item.label}
                  <IconChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden="true" />
                </a>
              ))}
            </nav>
          </ContentCard>
        </div>

        {/* The problem */}
        <ArticleSection title="The problem with most workout apps">
          <div className="grid gap-3 md:grid-cols-3">
            {problems.map((p) => (
              <ContentCard key={p.title} className="space-y-2">
                <IconBadge icon={p.icon} />
                <h3 className="text-headline text-ink">{p.title}</h3>
                <p className="text-subhead text-ink-2">{p.body}</p>
              </ContentCard>
            ))}
          </div>
        </ArticleSection>

        {/* Features */}
        <section id="features" className="scroll-mt-20 space-y-3">
          <h2 className="text-title text-ink">Features that actually matter</h2>
          {features.map((feature) => (
            <ContentCard key={feature.title}>
              <div className="flex items-start gap-3">
                <IconBadge icon={feature.icon} />
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="text-headline text-ink">{feature.title}</h3>
                  <p className="text-body text-ink-2">{feature.description}</p>
                  <p className="text-subhead text-ink-2">
                    <span className="font-semibold text-action">How it works: </span>
                    {feature.howItWorks}
                  </p>
                  {feature.disclaimer && (
                    <div className="flex gap-2 rounded-xl bg-fill p-3">
                      <IconInfoCircle size={18} className="mt-px shrink-0 text-ink-3" aria-hidden="true" />
                      <p className="text-caption text-ink-2">{feature.disclaimer}</p>
                    </div>
                  )}
                </div>
              </div>
            </ContentCard>
          ))}
        </section>

        {/* The science */}
        <section id="science" className="scroll-mt-20 space-y-3">
          <h2 className="text-title text-ink">Built on real science</h2>
          <p className="text-body text-ink-2">
            Our features are informed by peer-reviewed research and established training methodologies. See citations below.
          </p>
          {scienceConcepts.map((concept) => (
            <ContentCard key={concept.title} className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-headline text-ink">{concept.title}</h3>
                <span className="inline-block rounded-full bg-fill px-2 py-0.5 text-caption text-ink-2">
                  {concept.source}
                </span>
              </div>
              <p className="text-body text-ink-2">{concept.explanation}</p>
              {concept.citation && (
                <p className="text-caption italic text-ink-3">
                  <span className="font-semibold">Citation: </span>
                  {concept.citation}
                  {concept.doi && (
                    <>
                      {' '}
                      <Link
                        href={concept.doi}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-action underline"
                      >
                        [DOI]
                      </Link>
                    </>
                  )}
                </p>
              )}
              <div className="flex items-start gap-2 rounded-xl bg-action-tint p-3">
                <IconCircleCheck size={20} className="mt-px shrink-0 text-action" aria-hidden="true" />
                <p className="text-subhead text-ink">
                  <span className="font-semibold text-action">In HyperTrack:</span> {concept.application}
                </p>
              </div>
            </ContentCard>
          ))}
        </section>

        {/* Comparison */}
        <section id="comparison" className="scroll-mt-20 space-y-3">
          <h2 className="text-title text-ink">How we compare</h2>
          <ContentCard className="px-0 py-1">
            <table className="w-full text-left">
              <thead>
                <tr className="text-subhead">
                  <th scope="col" className="px-4 py-3 font-medium text-ink-2">Feature</th>
                  <th scope="col" className="w-24 px-2 py-3 text-center font-semibold text-action">HyperTrack</th>
                  <th scope="col" className="w-24 px-2 py-3 text-center font-medium text-ink-2">Other apps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sep">
                {comparisonTable.map((row) => (
                  <tr key={row.feature}>
                    <td className="px-4 py-3 text-subhead text-ink">{row.feature}</td>
                    <td className="px-2 py-3 text-center">
                      <IconCheck size={20} className="mx-auto text-action" aria-hidden="true" />
                      <span className="sr-only">Yes</span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <OthersCell value={row.others} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ContentCard>
        </section>

        {/* Sources and disclaimers */}
        <section id="sources" className="scroll-mt-20 space-y-3">
          <h2 className="text-title text-ink">Sources and disclaimers</h2>

          <ContentCard className="space-y-3">
            <h3 className="text-headline text-ink">General disclaimer</h3>
            <p className="text-subhead text-ink-2">
              HyperTrack is a training and nutrition tracking tool designed for informational and educational purposes.
              It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult with qualified
              healthcare professionals, registered dietitians, or certified personal trainers before starting any new training
              program, dietary regimen, or supplementation.
            </p>
            <p className="text-subhead text-ink-2">
              Individual results may vary. The recommendations and calculations provided by HyperTrack are based on general
              research findings and population-level data, which may not apply to every individual.
            </p>
          </ContentCard>

          <ContentCard className="space-y-3">
            <h3 className="text-headline text-ink">AI-generated content</h3>
            <p className="text-subhead text-ink-2">
              Our AI coaching features use Grok from xAI to generate personalized guidance. While informed by training science,
              AI outputs are probabilistic and may occasionally contain errors. AI coaching does not replace human coaching,
              supervision, or professional expertise. For detailed information about data handling, see our{' '}
              <Link href="/privacy" className="text-action underline">
                Privacy Policy
              </Link>
              .
            </p>
          </ContentCard>

          <ContentCard className="space-y-3">
            <h3 className="text-headline text-ink">Health and medical information</h3>
            <p className="text-subhead text-ink-2">
              Features related to body composition (DEXA, FFMI), nutrition targets, and medication support (GLP-1) provide
              general information only. They are not medical assessments, diagnoses, or prescriptions.
            </p>
            <p className="text-subhead text-ink-2">
              If you are taking prescription medications, have existing health conditions, or are under medical supervision,
              consult your healthcare provider before making dietary or training changes. For our full terms, see our{' '}
              <Link href="/terms" className="text-action underline">
                Terms of Service
              </Link>
              .
            </p>
          </ContentCard>

          <ContentCard className="space-y-3">
            <h3 className="text-headline text-ink">Research and methodology</h3>
            <p className="text-subhead text-ink-2">
              Our features are informed by exercise science research, established training methodologies, and industry
              best practices. Citations are provided where specific claims reference published work. Training science is
              an evolving field; our understanding continues to improve as new research emerges.
            </p>
            <p className="text-subhead font-semibold text-ink">Key sources and resources</p>
            <BulletList
              className="text-subhead"
              items={[
                'Renaissance Periodization: volume landmarks, stimulus-to-fatigue ratio research',
                'Stronger By Science: evidence reviews and training science',
                'Brad Schoenfeld, PhD: hypertrophy mechanisms and training research',
                'Eric Helms, PhD: natural bodybuilding and training optimization',
                'British Journal of Sports Medicine, Journal of Strength & Conditioning Research, and other peer-reviewed journals',
              ]}
            />
          </ContentCard>
        </section>

        {/* Who it's for */}
        <ArticleSection title="Who is HyperTrack for?">
          <div className="grid gap-3 md:grid-cols-3">
            {audiences.map((a) => (
              <ContentCard key={a.title} className="space-y-2">
                <IconBadge icon={a.icon} />
                <h3 className="text-headline text-ink">{a.title}</h3>
                <p className="text-subhead text-ink-2">{a.body}</p>
              </ContentCard>
            ))}
          </div>
        </ArticleSection>

        {/* CTA */}
        <ContentCard className="space-y-3 text-center">
          <h2 className="text-title text-ink">Ready to train smarter?</h2>
          <p className="text-body text-ink-2">
            Stop leaving gains on the table with outdated training methods. Join the evidence-based lifting revolution.
          </p>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-action px-6 text-body font-semibold text-on-action"
            >
              Get started free
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-fill px-6 text-body font-semibold text-ink"
            >
              Sign in
            </Link>
          </div>
        </ContentCard>

        <p className="text-center text-caption text-ink-3">
          HyperTrack © {new Date().getFullYear()} · Built for the lifting community
        </p>
      </ArticlePage>
    </PublicAppShell>
  );
}
