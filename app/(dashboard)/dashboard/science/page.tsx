'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useState } from 'react';
import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconActivity,
  IconBarbell,
  IconBattery2,
  IconBolt,
  IconChartBar,
  IconChevronDown,
  IconChevronRight,
  IconFlame,
  IconGauge,
  IconListDetails,
  IconMeat,
  IconPill,
  IconRuler,
  IconShieldCheck,
  IconStar,
  IconWaveSine,
} from '@tabler/icons-react';
import {
  ArticleHeader,
  ArticlePage,
  ArticleSection,
  ContentCard,
  IconBadge,
  TermNote,
  type PlainTerm,
} from '@/components/learn/ArticleKit';
import { ListGroup, ListRow } from '@/components/ui/ListRow';

interface ScienceConcept {
  title: string;
  source: string;
  icon: TablerIcon;
  /** Acronyms this card introduces, explained in plain words once per page. */
  terms?: Array<{ term: PlainTerm; fullName: string }>;
  explanation: string;
  application: string;
  link?: string;
  deepDive: {
    title: string;
    sections: Array<{ heading: string; content: string }>;
  };
}

const scienceConcepts: ScienceConcept[] = [
  {
    title: 'Volume landmarks (MEV, MAV, MRV)',
    source: 'Renaissance Periodization',
    terms: [
      { term: 'MEV', fullName: 'minimum effective volume' },
      { term: 'MAV', fullName: 'maximum adaptive volume' },
      { term: 'MRV', fullName: 'maximum recoverable volume' },
    ],
    icon: IconChartBar,
    explanation: 'MEV is the least you need to grow. MAV is the sweet spot for gains. MRV is the ceiling—go beyond it and you regress.',
    application: 'We track your weekly sets per muscle and keep you in the productive zone—typically 10-20 sets/week for most muscles, adjusted for your recovery capacity.',
    deepDive: {
      title: 'Understanding volume landmarks',
      sections: [
        {
          heading: 'What is MEV (minimum effective volume)?',
          content: 'MEV represents the minimum amount of training volume needed to stimulate muscle growth. Below this threshold, your training won\'t produce meaningful hypertrophy. For most muscles, MEV falls around 6-8 direct sets per week for trained individuals. Beginners can grow on less, while advanced lifters may need more just to maintain.',
        },
        {
          heading: 'The MAV sweet spot',
          content: 'MAV is where the magic happens. This is the volume range where you\'re getting the best return on investment—enough stimulus to grow optimally without excessive fatigue. For most people, MAV falls between 12-20 sets per muscle group per week, though this varies significantly based on training age, recovery capacity, and the specific muscle.',
        },
        {
          heading: 'Understanding MRV (maximum recoverable volume)',
          content: 'MRV is your ceiling—the most volume you can recover from. Go beyond it and you\'ll accumulate fatigue faster than you recover, leading to regression rather than progress. Key signs you\'re approaching MRV: persistent soreness, declining performance, sleep disruption, and loss of motivation. MRV isn\'t fixed; it changes with sleep, nutrition, stress, and training phase.',
        },
        {
          heading: 'Practical application',
          content: 'Start your training block at or slightly above MEV, then progressively add sets each week toward MAV. When performance stalls or you notice MRV warning signs, it\'s time to deload. This "accumulate and dissipate" approach is the foundation of effective periodization.',
        },
      ],
    },
  },
  {
    title: 'Stimulus-to-fatigue ratio (SFR)',
    source: 'Dr. Mike Israetel',
    icon: IconBolt,
    explanation: 'Not all exercises are equal. A machine fly gives great chest stimulus with minimal fatigue to recover from. A barbell bench press stimulates chest but also taxes shoulders, triceps, and CNS.',
    application: 'When building your program, we prioritize high-SFR exercises (machines, cables, isolation work) later in training blocks when fatigue is high, saving low-SFR compounds for when you\'re fresh.',
    deepDive: {
      title: 'Maximizing your training efficiency',
      sections: [
        {
          heading: 'What is stimulus-to-fatigue ratio?',
          content: 'SFR measures how much muscle-building stimulus an exercise provides relative to the systemic and local fatigue it generates. A high-SFR exercise gives you lots of growth stimulus while being easy to recover from. A low-SFR exercise may stimulate growth but also generates significant fatigue that impacts other training.',
        },
        {
          heading: 'High-SFR exercises',
          content: 'Machine exercises, cables, and isolation movements typically have high SFR. A cable fly, for example, provides excellent chest stimulus through a full range of motion with minimal stress on shoulders, triceps, or CNS. These exercises let you accumulate volume without accumulating excessive fatigue.',
        },
        {
          heading: 'Low-SFR exercises',
          content: 'Heavy compound movements like barbell squats, deadlifts, and bench press have lower SFR. While they\'re excellent for strength and do stimulate hypertrophy, they also generate substantial systemic fatigue, CNS stress, and can limit recovery for other training. This doesn\'t make them bad—just different tools for different situations.',
        },
        {
          heading: 'Strategic exercise selection',
          content: 'Early in a training block when you\'re fresh, low-SFR compounds are fine—you can recover from them. As fatigue accumulates through the training block, shifting toward higher-SFR exercises lets you maintain training stimulus while managing fatigue. This is why smart programs often swap barbell movements for machine variations as the training block progresses.',
        },
      ],
    },
  },
  {
    title: 'S-tier exercise scoring',
    source: 'Hypertrophy research',
    icon: IconStar,
    explanation: 'Exercises can be ranked by their hypertrophy effectiveness. S-tier exercises provide maximum muscle stimulus with favorable fatigue profiles and joint-friendly mechanics.',
    application: 'Every exercise in our database is rated S/A/B/C. Your training block is built with S-tier exercises prioritized, ensuring you\'re doing the most effective movements for muscle growth.',
    deepDive: {
      title: 'The exercise tier system explained',
      sections: [
        {
          heading: 'What makes an S-tier exercise?',
          content: 'S-tier exercises score highly across multiple factors: they provide excellent stimulus to the target muscle through a full range of motion, have favorable resistance curves that match muscle strength profiles, generate manageable fatigue, and are joint-friendly for long-term training. Not every great exercise is S-tier for every person—individual anatomy matters.',
        },
        {
          heading: 'The tier breakdown',
          content: 'S-tier: Best-in-class exercises with optimal stimulus and favorable fatigue profiles. A-tier: Excellent exercises with minor tradeoffs. B-tier: Good exercises that work but may have suboptimal resistance curves or higher injury risk. C-tier: Exercises that technically work the muscle but have significant drawbacks.',
        },
        {
          heading: 'Examples by muscle group',
          content: 'Chest S-tier: Machine chest press, cable fly, dumbbell press. Back S-tier: Chest-supported rows, lat pulldown, cable row. Quads S-tier: Leg press, hack squat, leg extension. These exercises let you load the target muscle heavily through a full ROM with manageable injury risk.',
        },
        {
          heading: 'When to use lower-tier exercises',
          content: 'Lower-tier exercises aren\'t useless—they may be necessary for variety, addressing specific weaknesses, or working around equipment limitations. A B-tier exercise done consistently beats an S-tier exercise you can\'t access. The tier system is a guide, not a rigid rule.',
        },
      ],
    },
  },
  {
    title: 'Muscle fiber type dominance',
    source: 'Exercise physiology research',
    icon: IconActivity,
    explanation: 'Muscles have different proportions of fast-twitch (explosive, fatigable) and slow-twitch (endurance, resistant) fibers. Each type responds to different rep ranges.',
    application: 'Hamstrings are ~70% fast-twitch: respond to 4-8 reps. Calves are ~60% slow-twitch: need 15-25 reps. Your rep ranges reflect the muscle being trained.',
    deepDive: {
      title: 'Training by fiber type',
      sections: [
        {
          heading: 'Fast-twitch vs. slow-twitch fibers',
          content: 'Type I (slow-twitch) fibers are endurance-oriented: they resist fatigue but produce less force. Type II (fast-twitch) fibers are powerful but fatigue quickly. Most muscles contain both types, but the ratio varies significantly between muscle groups and individuals.',
        },
        {
          heading: 'Muscle-specific fiber composition',
          content: 'Research shows consistent patterns: Calves (soleus) are ~60-80% slow-twitch, evolved for constant postural work. Hamstrings are ~70% fast-twitch, designed for explosive hip extension. Quads are mixed but lean fast-twitch. Delts are relatively balanced. Back muscles vary by function.',
        },
        {
          heading: 'Rep range implications',
          content: 'Fast-twitch dominant muscles respond well to heavier loads and lower reps (4-10 range)—they can generate the force needed and benefit from the mechanical tension. Slow-twitch dominant muscles often respond better to higher reps (12-25+) with shorter rest periods, matching their fatigue-resistant nature.',
        },
        {
          heading: 'Individual variation',
          content: 'While averages exist, individuals vary. Some people are "fast-twitch dominant" overall and respond better to heavy training across the board. Others are slow-twitch dominant and thrive on higher volume. Pay attention to how your muscles respond—consistent strength gains usually indicate you\'re matching your fiber type.',
        },
      ],
    },
  },
  {
    title: 'Evidence-based protein requirements',
    source: 'Schoenfeld and Aragon research',
    icon: IconMeat,
    explanation: 'Muscle protein synthesis is maximized at 1.6-2.2g/kg of protein daily for trained individuals. Higher protein becomes even more critical during caloric deficits to prevent muscle loss.',
    application: 'Our macro calculator sets protein at 1g/lb (2.2g/kg) by default—the gold standard for lifters. When on GLP-1 medications, we increase to 1.2g/lb to protect muscle during aggressive cuts.',
    deepDive: {
      title: 'The science of protein intake',
      sections: [
        {
          heading: 'The research consensus',
          content: 'Meta-analyses by Schoenfeld, Aragon, and others consistently show that 1.6-2.2g/kg (0.7-1g/lb) of protein daily maximizes muscle protein synthesis in resistance-trained individuals. Going higher doesn\'t hurt, but additional benefits diminish. This is substantially higher than RDA recommendations, which are designed for sedentary individuals, not athletes.',
        },
        {
          heading: 'Protein timing and distribution',
          content: 'While total daily protein matters most, distribution helps. Aim for 4-6 protein feedings of 0.4-0.5g/kg each (roughly 25-50g per meal for most people). This keeps muscle protein synthesis elevated throughout the day. The "anabolic window" post-workout exists but is wider than once thought—a few hours, not 30 minutes.',
        },
        {
          heading: 'Protein during a deficit',
          content: 'When cutting, protein becomes even more critical. Research shows that higher protein intakes (up to 2.3-3.1g/kg) help preserve lean mass during caloric restriction. The leaner you are and the more aggressive your deficit, the more protein you need to protect muscle. This is why we recommend 1.2g/lb for GLP-1 users on aggressive cuts.',
        },
        {
          heading: 'Protein quality matters',
          content: 'Not all protein is equal. Animal proteins are "complete" with all essential amino acids in good proportions. Plant proteins can work but often need to be combined for complete amino acid profiles. Leucine content is particularly important—aim for 2-3g leucine per meal to maximally stimulate muscle protein synthesis.',
        },
      ],
    },
  },
  {
    title: 'Autoregulation with RPE/RIR',
    source: 'Powerlifting and sports science',
    terms: [
      { term: 'RPE', fullName: 'rate of perceived exertion' },
      { term: 'RIR', fullName: 'reps in reserve' },
    ],
    icon: IconGauge,
    explanation: 'RPE and RIR let you train to appropriate intensity based on how you feel that day, not a fixed percentage of your one-rep max (1RM) that ignores recovery state.',
    application: 'Start training blocks at 3 RIR (could do 3 more). Progress to 1 RIR by the end. Last sets can go to 0 RIR. This systematic approach ensures progressive overload without burning out.',
    deepDive: {
      title: 'Training by feel, backed by science',
      sections: [
        {
          heading: 'What is RPE/RIR?',
          content: 'RPE is a 1-10 scale where 10 is maximum effort. RIR counts how many more reps you could have done. They\'re inversely related: RPE 10 = 0 RIR (failure), RPE 8 = 2 RIR, RPE 7 = 3 RIR. RIR is often more intuitive for lifters to gauge.',
        },
        {
          heading: 'Why autoregulation works',
          content: 'Your strength fluctuates daily based on sleep, stress, nutrition, and accumulated fatigue. Percentage-based programs assume your 1RM is constant—it\'s not. Autoregulation lets you push harder on good days and back off on bad days while still hitting appropriate intensity. This leads to better long-term progress and fewer injuries.',
        },
        {
          heading: 'Learning to rate accurately',
          content: 'Accurate RPE/RIR assessment takes practice. Beginners often underestimate how many reps they have left. Film your sets and occasionally test to failure (safely) to calibrate your sense. Signs you\'re at true 1-2 RIR: bar speed significantly slows, form starts to break down, you\'re genuinely uncertain if you could complete another rep.',
        },
        {
          heading: 'Programming with RPE/RIR',
          content: 'A typical training block progression: Week 1 at 3 RIR (moderate effort), Week 2-3 at 2 RIR, Week 4-5 at 1 RIR, with occasional 0 RIR sets on the last set of an exercise. This creates systematic overload while managing fatigue. Deload weeks return to 4+ RIR to dissipate accumulated fatigue.',
        },
      ],
    },
  },
  {
    title: 'Adaptive TDEE estimation',
    source: 'Metabolic research',
    terms: [{ term: 'TDEE', fullName: 'total daily energy expenditure' }],
    icon: IconFlame,
    explanation: 'Generic formulas can be off by 300-500 calories. By tracking your actual weight changes against calorie intake, we back-calculate your personal burn rate using least-squares regression.',
    application: 'After 2-3 weeks of logging, we calculate YOUR actual TDEE from real data. Weight predictions become highly accurate once your estimate stabilizes.',
    link: '/dashboard/learn/adaptive-tdee',
    deepDive: {
      title: 'Your personal metabolism decoded',
      sections: [
        {
          heading: 'Why generic formulas fail',
          content: 'Formulas like Mifflin-St Jeor or Harris-Benedict estimate TDEE based on age, weight, height, and activity level. But they can\'t account for individual metabolic variation, NEAT differences, or actual activity levels. Two people with identical stats can have TDEE differences of 500+ calories due to factors these formulas can\'t capture.',
        },
        {
          heading: 'The math behind adaptive TDEE',
          content: 'We use your actual data: calories consumed and weight changes over time. Using least-squares regression, we calculate what your true caloric burn must be to produce the weight changes you\'ve experienced. 1 pound of body weight change ≈ 3,500 calories. With enough data points, we can accurately back-calculate your personal TDEE.',
        },
        {
          heading: 'Data quality matters',
          content: 'Accurate TDEE estimation requires honest, consistent logging. Underreporting calories (even unconsciously) will make your estimated TDEE appear lower than reality. Weight fluctuations from water, sodium, and glycogen can add noise—this is why we need 2-3 weeks of data before estimates stabilize.',
        },
        {
          heading: 'Using your adaptive TDEE',
          content: 'Once calibrated, your adaptive TDEE becomes a powerful tool. For weight loss, create a consistent deficit below it. For muscle gain, a small surplus above it. The system continues learning—if your metabolism adapts (as it does during extended diets), your TDEE estimate adjusts accordingly.',
        },
      ],
    },
  },
  {
    title: 'Daily undulating periodization (DUP)',
    source: 'Dr. Greg Nuckols and others',
    icon: IconWaveSine,
    explanation: 'Instead of training heavy for weeks then light for weeks (linear periodization), DUP rotates intensity daily. Monday: strength (4-6 reps). Wednesday: hypertrophy (8-12). Friday: power.',
    application: 'Our training block builder can create DUP programs that hit each muscle with different stimuli each session, maximizing both strength and size adaptations.',
    deepDive: {
      title: 'Why varying your training works',
      sections: [
        {
          heading: 'The problem with linear periodization',
          content: 'Traditional linear periodization dedicates entire training blocks to one quality: hypertrophy phase, then strength phase, then peaking. The problem? You can lose adaptations from previous phases while focusing on new ones. After weeks of low-rep strength work, you may have lost some hypertrophy gains.',
        },
        {
          heading: 'How DUP works',
          content: 'Daily undulating periodization varies training stimulus within each week. You might train heavy (4-6 reps) on Monday, moderate (8-12 reps) on Wednesday, and light/high-rep (12-20 reps) on Friday. This way, you\'re constantly training multiple qualities and maintaining all adaptations simultaneously.',
        },
        {
          heading: 'Research support',
          content: 'Studies consistently show DUP produces equal or superior results to linear periodization for both strength and hypertrophy. The variety may also help with adherence—training feels less monotonous when you\'re not doing the same rep ranges week after week.',
        },
        {
          heading: 'Implementing DUP',
          content: 'A simple approach: Rotate between three rep ranges across your training week. Each workout hits different intensities while still providing sufficient stimulus. Advanced variations include undulating within the workout itself or using different exercises for different rep ranges based on their strength curves.',
        },
      ],
    },
  },
  {
    title: 'Fatigue budget system',
    source: 'Training load research',
    icon: IconBattery2,
    explanation: 'Both systemic (CNS) and local muscle fatigue accumulate during training. Exceeding your recovery capacity leads to overtraining, injury, and regression instead of gains.',
    application: 'Each exercise has a "fatigue cost" (compounds: 8-12 pts, isolations: 3-5 pts). We track your weekly fatigue budget and trigger deloads when you\'re approaching your limit.',
    deepDive: {
      title: 'Managing fatigue for long-term progress',
      sections: [
        {
          heading: 'Types of training fatigue',
          content: 'Fatigue isn\'t just muscle soreness. Systemic fatigue affects your entire body and CNS—heavy deadlifts don\'t just tire your back, they impact recovery globally. Local fatigue is muscle-specific. Both accumulate and both need to be managed. Ignoring either leads to plateaus, injury, or overtraining.',
        },
        {
          heading: 'The fatigue point system',
          content: 'We assign fatigue costs based on exercise demands. Heavy compounds (squats, deadlifts): 8-12 points—they\'re systemically demanding. Machine compounds (leg press, chest press): 5-7 points. Isolation exercises: 3-5 points. This lets us track your total weekly fatigue load across all training.',
        },
        {
          heading: 'Recognizing fatigue accumulation',
          content: 'Warning signs you\'re exceeding your fatigue budget: declining performance on key lifts, persistent soreness lasting 3+ days, sleep disturbances, decreased motivation, elevated resting heart rate, mood changes. These indicate systemic fatigue that rest days alone won\'t fix.',
        },
        {
          heading: 'Strategic deloading',
          content: 'When fatigue accumulates to threshold levels, a deload week is needed. Cut volume by 50%, maintain intensity, focus on recovery. This allows fatigue to dissipate while maintaining fitness. Most people need to deload every 4-8 weeks depending on training intensity and individual recovery capacity.',
        },
      ],
    },
  },
  {
    title: 'Progressive overload mechanics',
    source: 'Fundamental training principle',
    icon: IconBarbell,
    explanation: 'To grow, you must progressively do more: more weight, more reps, more sets, less rest, better technique. The body adapts to what you demand of it.',
    application: 'Each week, we suggest adding 1-2 reps or 2.5% weight to key lifts. When you hit the top of your rep range with good form, we recommend increasing load.',
    deepDive: {
      title: 'The foundation of all progress',
      sections: [
        {
          heading: 'Why progressive overload is non-negotiable',
          content: 'Your body adapts to stress by getting stronger and building muscle. Once adapted, the same stress no longer triggers adaptation. To continue growing, you must progressively increase demands. This is the single most important training principle—without it, you\'ll plateau regardless of exercise selection or program design.',
        },
        {
          heading: 'Methods of progression',
          content: 'Weight: Adding load to the bar. Reps: Doing more reps at the same weight. Sets: Adding volume. Density: Same work in less time. Technique: Better execution for more effective stimulus. Range of Motion: Deeper stretches or fuller contractions. All are valid forms of overload.',
        },
        {
          heading: 'Double progression method',
          content: 'The most practical approach: Work within a rep range (e.g., 8-12 reps). Start at the bottom of the range with a weight that\'s challenging. Each session, try to add reps. Once you hit the top of the range with good form, increase weight and drop back to the bottom of the range. Repeat.',
        },
        {
          heading: 'Rate of progression',
          content: 'Beginners can add weight weekly. Intermediates might progress every 2-3 weeks. Advanced lifters may take months to add meaningful weight. The key is consistent micro-progression over time. Adding 2.5lbs per month to your bench is still 30lbs per year—significant long-term progress.',
        },
      ],
    },
  },
  {
    title: 'FFMI and natural limits',
    source: 'Body composition research',
    icon: IconRuler,
    explanation: 'Fat-free mass index (FFMI) normalizes lean mass by height. Natural lifters typically max out around 25 FFMI. Knowing your position helps set realistic expectations.',
    application: 'Enter your DEXA data and we calculate your FFMI. Compare against natural benchmarks to understand if you should bulk, cut, or recomp. AI coaching adapts recommendations accordingly.',
    deepDive: {
      title: 'Understanding your muscular potential',
      sections: [
        {
          heading: 'What is FFMI?',
          content: 'Fat-free mass index (FFMI) = lean mass in kg / (height in meters)². It normalizes muscle mass by height, allowing fair comparison between individuals of different sizes. FFMI of 20 is average for non-training males. Natural lifters with good genetics and years of training typically reach 23-25.',
        },
        {
          heading: 'The natural limit research',
          content: 'Studies of pre-steroid era athletes and natural bodybuilding competitors suggest an FFMI ceiling around 25-26 for genetically gifted naturals. Values above 26 are extremely rare without pharmaceutical assistance. This doesn\'t mean you can\'t look impressive—an FFMI of 23-24 with low body fat looks exceptionally muscular.',
        },
        {
          heading: 'Calculating your FFMI',
          content: 'You need accurate lean mass data—DEXA scans are ideal. If using body fat estimates: Lean mass = Total weight × (1 - body fat %). Then: FFMI = Lean mass (kg) / Height (m)². Adjusted FFMI adds a height correction: FFMI + 6.1 × (1.8 - height in m).',
        },
        {
          heading: 'Using FFMI for decision making',
          content: 'If your FFMI is below 22-23, you likely have significant room to grow—prioritize building muscle with slight caloric surplus. If you\'re approaching 24-25, you\'re nearing natural limits—focus on optimizing body composition rather than expecting massive size gains. This prevents spinning wheels on unrealistic goals.',
        },
      ],
    },
  },
  {
    title: 'GLP-1 and muscle preservation',
    source: 'Recent clinical research',
    icon: IconPill,
    explanation: 'GLP-1 agonists (Ozempic, Mounjaro) cause rapid weight loss, but up to 40% can be muscle without intervention. Higher protein and resistance training are essential for preservation.',
    application: 'When you indicate GLP-1 use, we boost protein targets to 1.2g/lb and ensure your training program maintains sufficient volume to preserve muscle during aggressive cuts.',
    deepDive: {
      title: 'Protecting muscle on GLP-1 medications',
      sections: [
        {
          heading: 'The muscle loss problem',
          content: 'GLP-1 agonists like semaglutide (Ozempic/Wegovy) and tirzepatide (Mounjaro) produce dramatic weight loss—often 15-20%+ of body weight. But studies show 25-40% of weight lost can be lean mass, not fat. Without intervention, you may end up "skinny fat" with reduced metabolism and less muscle than when you started.',
        },
        {
          heading: 'Why GLP-1s accelerate muscle loss',
          content: 'These medications suppress appetite dramatically, often creating severe caloric deficits of 1000+ calories. Such aggressive deficits, combined with reduced protein intake (because you\'re eating less overall) and potential reduction in physical activity, create the perfect storm for muscle catabolism.',
        },
        {
          heading: 'The intervention protocol',
          content: 'Research and clinical experience suggest three key interventions: 1) High protein intake (1.2g/lb or higher) to maximize muscle protein synthesis despite the deficit. 2) Consistent resistance training with sufficient volume to signal muscle preservation. 3) Avoiding excessive deficits—eating enough to support training even if appetite is low.',
        },
        {
          heading: 'Realistic expectations',
          content: 'Even with optimal intervention, some muscle loss is likely during rapid weight loss. The goal is minimization, not complete prevention. Expect to lose some strength during the weight loss phase—this is normal. Once you reach goal weight and return to maintenance calories, you can rebuild any lost muscle relatively quickly.',
        },
      ],
    },
  },
];

const quickStats = [
  { value: '12+', label: 'Research principles' },
  { value: '300K+', label: 'Foods in the database' },
  { value: '500+', label: 'S-tier exercises' },
  { value: 'AI', label: 'Coaching notes' },
];

const researchers = [
  { name: 'Dr. Mike Israetel', topic: 'Volume, SFR, RP system' },
  { name: 'Dr. Brad Schoenfeld', topic: 'Hypertrophy mechanisms' },
  { name: 'Dr. Greg Nuckols', topic: 'Periodization research' },
  { name: 'Dr. Eric Helms', topic: 'Natural bodybuilding' },
];

export default function SciencePage() {
  useDocumentTitle('Training science');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpanded = (title: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  return (
    <ArticlePage>
      <ArticleHeader
        backHref=""
        title="The science behind HyperTrack"
        subtitle="Every algorithm in HyperTrack is based on peer-reviewed research and proven training methods. Here is the science behind your progress."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quickStats.map((stat) => (
          <ContentCard key={stat.label} className="text-center">
            <p className="text-title text-ink">{stat.value}</p>
            <p className="text-caption text-ink-3">{stat.label}</p>
          </ContentCard>
        ))}
      </div>

      <ArticleSection title="Core principles">
        <div className="space-y-3">
          {scienceConcepts.map((concept) => {
            const isExpanded = expandedItems.has(concept.title);
            return (
              <ContentCard key={concept.title} className="overflow-hidden">
                <div className="flex items-start gap-3">
                  <IconBadge icon={concept.icon} />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <p className="text-caption text-action">{concept.source}</p>
                      <h3 className="text-headline text-ink">{concept.title}</h3>
                    </div>
                    <p className="text-body text-ink-2">{concept.explanation}</p>

                    {concept.terms && (
                      <div className="space-y-1">
                        {concept.terms.map((t) => (
                          <TermNote key={t.term} term={t.term} fullName={t.fullName} />
                        ))}
                      </div>
                    )}

                    <div className="rounded-xl bg-fill p-3">
                      <p className="text-subhead text-ink-2">
                        <span className="font-semibold text-action">In HyperTrack: </span>
                        {concept.application}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleExpanded(concept.title)}
                      aria-expanded={isExpanded}
                      className="-ml-1 inline-flex min-h-[44px] items-center gap-1 text-subhead font-medium text-action"
                    >
                      <IconChevronDown
                        size={18}
                        aria-hidden="true"
                        className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                      {isExpanded ? 'Hide deep dive' : 'Read deep dive'}
                    </button>

                    {isExpanded && (
                      <div className="animate-slide-down space-y-3">
                        <div className="space-y-3 rounded-xl bg-fill p-3">
                          <h4 className="text-headline text-ink">{concept.deepDive.title}</h4>
                          {concept.deepDive.sections.map((section) => (
                            <div key={section.heading} className="space-y-1">
                              <h5 className="text-subhead font-semibold text-ink">{section.heading}</h5>
                              <p className="text-subhead text-ink-2">{section.content}</p>
                            </div>
                          ))}
                        </div>

                        {concept.link && (
                          <Link href={concept.link} className="inline-flex items-center gap-1 text-subhead font-medium text-action">
                            Read the full article
                            <IconChevronRight size={16} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </ContentCard>
            );
          })}
        </div>
      </ArticleSection>

      <ArticleSection title="Standing on the shoulders of giants">
        <ContentCard className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {researchers.map((r) => (
            <div key={r.name}>
              <p className="text-body font-medium text-ink">{r.name}</p>
              <p className="text-caption text-ink-3">{r.topic}</p>
            </div>
          ))}
        </ContentCard>
      </ArticleSection>

      <ArticleSection title="Deep dive articles">
        <p className="text-body text-ink-2">Want the science in more detail? These articles go further.</p>
        <ListGroup>
          <ListRow
            href="/dashboard/learn/adaptive-tdee"
            icon={<IconFlame size={18} />}
            title="Adaptive TDEE estimation"
            subtitle="How we work out your personal metabolism"
          />
          <ListRow
            href="/dashboard/learn/injury-prevention"
            icon={<IconShieldCheck size={18} />}
            title="Smart injury prevention"
            subtitle="How we keep you safe with biomechanics"
          />
          <ListRow href="/dashboard/learn" icon={<IconListDetails size={18} />} title="View all articles" />
        </ListGroup>
      </ArticleSection>

      <ContentCard className="space-y-3 text-center">
        <h2 className="text-headline text-ink">Ready to apply the science?</h2>
        <p className="text-body text-ink-2">
          Stop guessing. Let evidence-based algorithms guide your training and nutrition.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard/mesocycle/new"
            className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-action px-5 text-body font-semibold text-on-action"
          >
            Create training block
          </Link>
          <Link
            href="/dashboard/nutrition"
            className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-fill px-5 text-body font-semibold text-ink"
          >
            Set up nutrition
          </Link>
          <Link
            href="/dashboard/learn"
            className="inline-flex min-h-[44px] items-center justify-center rounded-button bg-fill px-5 text-body font-semibold text-ink"
          >
            Learn more
          </Link>
        </div>
      </ContentCard>
    </ArticlePage>
  );
}
