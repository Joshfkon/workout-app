'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import Link from 'next/link';

const scienceConcepts = [
  {
    title: 'Volume Landmarks (MEV, MAV, MRV)',
    source: 'Renaissance Periodization',
    icon: '📊',
    explanation: 'MEV (Minimum Effective Volume) is the least you need to grow. MAV (Maximum Adaptive Volume) is the sweet spot for gains. MRV (Maximum Recoverable Volume) is the ceiling—go beyond it and you regress.',
    application: 'We track your weekly sets per muscle and keep you in the productive zone—typically 10-20 sets/week for most muscles, adjusted for your recovery capacity.',
    color: 'primary',
    deepDive: {
      title: 'Understanding Volume Landmarks',
      sections: [
        {
          heading: 'What is MEV (Minimum Effective Volume)?',
          content: 'MEV represents the minimum amount of training volume needed to stimulate muscle growth. Below this threshold, your training won\'t produce meaningful hypertrophy. For most muscles, MEV falls around 6-8 direct sets per week for trained individuals. Beginners can grow on less, while advanced lifters may need more just to maintain.',
        },
        {
          heading: 'The MAV Sweet Spot',
          content: 'Maximum Adaptive Volume (MAV) is where the magic happens. This is the volume range where you\'re getting the best return on investment—enough stimulus to grow optimally without excessive fatigue. For most people, MAV falls between 12-20 sets per muscle group per week, though this varies significantly based on training age, recovery capacity, and the specific muscle.',
        },
        {
          heading: 'Understanding MRV (Maximum Recoverable Volume)',
          content: 'MRV is your ceiling—the most volume you can recover from. Go beyond it and you\'ll accumulate fatigue faster than you recover, leading to regression rather than progress. Key signs you\'re approaching MRV: persistent soreness, declining performance, sleep disruption, and loss of motivation. MRV isn\'t fixed; it changes with sleep, nutrition, stress, and training phase.',
        },
        {
          heading: 'Practical Application',
          content: 'Start your mesocycle at or slightly above MEV, then progressively add sets each week toward MAV. When performance stalls or you notice MRV warning signs, it\'s time to deload. This "accumulate and dissipate" approach is the foundation of effective periodization.',
        },
      ],
    },
  },
  {
    title: 'Stimulus-to-Fatigue Ratio (SFR)',
    source: 'Dr. Mike Israetel',
    icon: '⚡',
    explanation: 'Not all exercises are equal. A machine fly gives great chest stimulus with minimal fatigue to recover from. A barbell bench press stimulates chest but also taxes shoulders, triceps, and CNS.',
    application: 'When building your program, we prioritize high-SFR exercises (machines, cables, isolation work) later in mesocycles when fatigue is high, saving low-SFR compounds for when you\'re fresh.',
    color: 'accent',
    deepDive: {
      title: 'Maximizing Your Training Efficiency',
      sections: [
        {
          heading: 'What is Stimulus-to-Fatigue Ratio?',
          content: 'SFR measures how much muscle-building stimulus an exercise provides relative to the systemic and local fatigue it generates. A high-SFR exercise gives you lots of growth stimulus while being easy to recover from. A low-SFR exercise may stimulate growth but also generates significant fatigue that impacts other training.',
        },
        {
          heading: 'High-SFR Exercises',
          content: 'Machine exercises, cables, and isolation movements typically have high SFR. A cable fly, for example, provides excellent chest stimulus through a full range of motion with minimal stress on shoulders, triceps, or CNS. These exercises let you accumulate volume without accumulating excessive fatigue.',
        },
        {
          heading: 'Low-SFR Exercises',
          content: 'Heavy compound movements like barbell squats, deadlifts, and bench press have lower SFR. While they\'re excellent for strength and do stimulate hypertrophy, they also generate substantial systemic fatigue, CNS stress, and can limit recovery for other training. This doesn\'t make them bad—just different tools for different situations.',
        },
        {
          heading: 'Strategic Exercise Selection',
          content: 'Early in a mesocycle when you\'re fresh, low-SFR compounds are fine—you can recover from them. As fatigue accumulates through the mesocycle, shifting toward higher-SFR exercises lets you maintain training stimulus while managing fatigue. This is why smart programs often swap barbell movements for machine variations as the mesocycle progresses.',
        },
      ],
    },
  },
  {
    title: 'S-Tier Exercise Scoring',
    source: 'Hypertrophy Research',
    icon: '⭐',
    explanation: 'Exercises can be ranked by their hypertrophy effectiveness. S-tier exercises provide maximum muscle stimulus with favorable fatigue profiles and joint-friendly mechanics.',
    application: 'Every exercise in our database is rated S/A/B/C. Your mesocycle is built with S-tier exercises prioritized, ensuring you\'re doing the most effective movements for muscle growth.',
    color: 'warning',
    deepDive: {
      title: 'The Exercise Tier System Explained',
      sections: [
        {
          heading: 'What Makes an S-Tier Exercise?',
          content: 'S-tier exercises score highly across multiple factors: they provide excellent stimulus to the target muscle through a full range of motion, have favorable resistance curves that match muscle strength profiles, generate manageable fatigue, and are joint-friendly for long-term training. Not every great exercise is S-tier for every person—individual anatomy matters.',
        },
        {
          heading: 'The Tier Breakdown',
          content: 'S-Tier: Best-in-class exercises with optimal stimulus and favorable fatigue profiles. A-Tier: Excellent exercises with minor tradeoffs. B-Tier: Good exercises that work but may have suboptimal resistance curves or higher injury risk. C-Tier: Exercises that technically work the muscle but have significant drawbacks.',
        },
        {
          heading: 'Examples by Muscle Group',
          content: 'Chest S-Tier: Machine chest press, cable fly, dumbbell press. Back S-Tier: Chest-supported rows, lat pulldown, cable row. Quads S-Tier: Leg press, hack squat, leg extension. These exercises let you load the target muscle heavily through a full ROM with manageable injury risk.',
        },
        {
          heading: 'When to Use Lower-Tier Exercises',
          content: 'Lower-tier exercises aren\'t useless—they may be necessary for variety, addressing specific weaknesses, or working around equipment limitations. A B-tier exercise done consistently beats an S-tier exercise you can\'t access. The tier system is a guide, not a rigid rule.',
        },
      ],
    },
  },
  {
    title: 'Muscle Fiber Type Dominance',
    source: 'Exercise Physiology Research',
    icon: '💪',
    explanation: 'Muscles have different proportions of fast-twitch (explosive, fatigable) and slow-twitch (endurance, resistant) fibers. Each type responds to different rep ranges.',
    application: 'Hamstrings are ~70% fast-twitch → respond to 4-8 reps. Calves are ~60% slow-twitch → need 15-25 reps. Your rep ranges reflect the muscle being trained.',
    color: 'danger',
    deepDive: {
      title: 'Training by Fiber Type',
      sections: [
        {
          heading: 'Fast-Twitch vs. Slow-Twitch Fibers',
          content: 'Type I (slow-twitch) fibers are endurance-oriented: they resist fatigue but produce less force. Type II (fast-twitch) fibers are powerful but fatigue quickly. Most muscles contain both types, but the ratio varies significantly between muscle groups and individuals.',
        },
        {
          heading: 'Muscle-Specific Fiber Composition',
          content: 'Research shows consistent patterns: Calves (soleus) are ~60-80% slow-twitch, evolved for constant postural work. Hamstrings are ~70% fast-twitch, designed for explosive hip extension. Quads are mixed but lean fast-twitch. Delts are relatively balanced. Back muscles vary by function.',
        },
        {
          heading: 'Rep Range Implications',
          content: 'Fast-twitch dominant muscles respond well to heavier loads and lower reps (4-10 range)—they can generate the force needed and benefit from the mechanical tension. Slow-twitch dominant muscles often respond better to higher reps (12-25+) with shorter rest periods, matching their fatigue-resistant nature.',
        },
        {
          heading: 'Individual Variation',
          content: 'While averages exist, individuals vary. Some people are "fast-twitch dominant" overall and respond better to heavy training across the board. Others are slow-twitch dominant and thrive on higher volume. Pay attention to how your muscles respond—consistent strength gains usually indicate you\'re matching your fiber type.',
        },
      ],
    },
  },
  {
    title: 'Evidence-Based Protein Requirements',
    source: 'Schoenfeld & Aragon Research',
    icon: '🥩',
    explanation: 'Muscle protein synthesis is maximized at 1.6-2.2g/kg of protein daily for trained individuals. Higher protein becomes even more critical during caloric deficits to prevent muscle loss.',
    application: 'Our macro calculator sets protein at 1g/lb (2.2g/kg) by default—the gold standard for lifters. When on GLP-1 medications, we increase to 1.2g/lb to protect muscle during aggressive cuts.',
    color: 'success',
    deepDive: {
      title: 'The Science of Protein Intake',
      sections: [
        {
          heading: 'The Research Consensus',
          content: 'Meta-analyses by Schoenfeld, Aragon, and others consistently show that 1.6-2.2g/kg (0.7-1g/lb) of protein daily maximizes muscle protein synthesis in resistance-trained individuals. Going higher doesn\'t hurt, but additional benefits diminish. This is substantially higher than RDA recommendations, which are designed for sedentary individuals, not athletes.',
        },
        {
          heading: 'Protein Timing and Distribution',
          content: 'While total daily protein matters most, distribution helps. Aim for 4-6 protein feedings of 0.4-0.5g/kg each (roughly 25-50g per meal for most people). This keeps muscle protein synthesis elevated throughout the day. The "anabolic window" post-workout exists but is wider than once thought—a few hours, not 30 minutes.',
        },
        {
          heading: 'Protein During a Deficit',
          content: 'When cutting, protein becomes even more critical. Research shows that higher protein intakes (up to 2.3-3.1g/kg) help preserve lean mass during caloric restriction. The leaner you are and the more aggressive your deficit, the more protein you need to protect muscle. This is why we recommend 1.2g/lb for GLP-1 users on aggressive cuts.',
        },
        {
          heading: 'Protein Quality Matters',
          content: 'Not all protein is equal. Animal proteins are "complete" with all essential amino acids in good proportions. Plant proteins can work but often need to be combined for complete amino acid profiles. Leucine content is particularly important—aim for 2-3g leucine per meal to maximally stimulate muscle protein synthesis.',
        },
      ],
    },
  },
  {
    title: 'Autoregulation with RPE/RIR',
    source: 'Powerlifting & Sports Science',
    icon: '🎯',
    explanation: 'RPE (Rate of Perceived Exertion) and RIR (Reps in Reserve) let you train to appropriate intensity based on how you feel that day, not a fixed percentage of 1RM that ignores recovery state.',
    application: 'Start mesocycles at 3 RIR (could do 3 more). Progress to 1 RIR by the end. Last sets can go to 0 RIR. This systematic approach ensures progressive overload without burning out.',
    color: 'primary',
    deepDive: {
      title: 'Training by Feel, Backed by Science',
      sections: [
        {
          heading: 'What is RPE/RIR?',
          content: 'RPE (Rate of Perceived Exertion) is a 1-10 scale where 10 is maximum effort. RIR (Reps in Reserve) counts how many more reps you could have done. They\'re inversely related: RPE 10 = 0 RIR (failure), RPE 8 = 2 RIR, RPE 7 = 3 RIR. RIR is often more intuitive for lifters to gauge.',
        },
        {
          heading: 'Why Autoregulation Works',
          content: 'Your strength fluctuates daily based on sleep, stress, nutrition, and accumulated fatigue. Percentage-based programs assume your 1RM is constant—it\'s not. Autoregulation lets you push harder on good days and back off on bad days while still hitting appropriate intensity. This leads to better long-term progress and fewer injuries.',
        },
        {
          heading: 'Learning to Rate Accurately',
          content: 'Accurate RPE/RIR assessment takes practice. Beginners often underestimate how many reps they have left. Film your sets and occasionally test to failure (safely) to calibrate your sense. Signs you\'re at true 1-2 RIR: bar speed significantly slows, form starts to break down, you\'re genuinely uncertain if you could complete another rep.',
        },
        {
          heading: 'Programming with RPE/RIR',
          content: 'A typical mesocycle progression: Week 1 at 3 RIR (moderate effort), Week 2-3 at 2 RIR, Week 4-5 at 1 RIR, with occasional 0 RIR sets on the last set of an exercise. This creates systematic overload while managing fatigue. Deload weeks return to 4+ RIR to dissipate accumulated fatigue.',
        },
      ],
    },
  },
  {
    title: 'Adaptive TDEE Estimation',
    source: 'Metabolic Research',
    icon: '🔥',
    explanation: 'Generic formulas can be off by 300-500 calories. By tracking your actual weight changes against calorie intake, we back-calculate your personal burn rate using least-squares regression.',
    application: 'After 2-3 weeks of logging, we calculate YOUR actual TDEE from real data. Weight predictions become highly accurate once your estimate stabilizes.',
    color: 'accent',
    link: '/dashboard/learn/adaptive-tdee',
    deepDive: {
      title: 'Your Personal Metabolism Decoded',
      sections: [
        {
          heading: 'Why Generic Formulas Fail',
          content: 'Formulas like Mifflin-St Jeor or Harris-Benedict estimate TDEE based on age, weight, height, and activity level. But they can\'t account for individual metabolic variation, NEAT differences, or actual activity levels. Two people with identical stats can have TDEE differences of 500+ calories due to factors these formulas can\'t capture.',
        },
        {
          heading: 'The Math Behind Adaptive TDEE',
          content: 'We use your actual data: calories consumed and weight changes over time. Using least-squares regression, we calculate what your true caloric burn must be to produce the weight changes you\'ve experienced. 1 pound of body weight change ≈ 3,500 calories. With enough data points, we can accurately back-calculate your personal TDEE.',
        },
        {
          heading: 'Data Quality Matters',
          content: 'Accurate TDEE estimation requires honest, consistent logging. Underreporting calories (even unconsciously) will make your estimated TDEE appear lower than reality. Weight fluctuations from water, sodium, and glycogen can add noise—this is why we need 2-3 weeks of data before estimates stabilize.',
        },
        {
          heading: 'Using Your Adaptive TDEE',
          content: 'Once calibrated, your adaptive TDEE becomes a powerful tool. For weight loss, create a consistent deficit below it. For muscle gain, a small surplus above it. The system continues learning—if your metabolism adapts (as it does during extended diets), your TDEE estimate adjusts accordingly.',
        },
      ],
    },
  },
  {
    title: 'Daily Undulating Periodization (DUP)',
    source: 'Dr. Greg Nuckols & Others',
    icon: '📈',
    explanation: 'Instead of training heavy for weeks then light for weeks (linear periodization), DUP rotates intensity daily. Monday: strength (4-6 reps). Wednesday: hypertrophy (8-12). Friday: power.',
    application: 'Our mesocycle builder can create DUP programs that hit each muscle with different stimuli each session, maximizing both strength and size adaptations.',
    color: 'warning',
    deepDive: {
      title: 'Why Varying Your Training Works',
      sections: [
        {
          heading: 'The Problem with Linear Periodization',
          content: 'Traditional linear periodization dedicates entire training blocks to one quality: hypertrophy phase, then strength phase, then peaking. The problem? You can lose adaptations from previous phases while focusing on new ones. After weeks of low-rep strength work, you may have lost some hypertrophy gains.',
        },
        {
          heading: 'How DUP Works',
          content: 'Daily Undulating Periodization varies training stimulus within each week. You might train heavy (4-6 reps) on Monday, moderate (8-12 reps) on Wednesday, and light/high-rep (12-20 reps) on Friday. This way, you\'re constantly training multiple qualities and maintaining all adaptations simultaneously.',
        },
        {
          heading: 'Research Support',
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
    title: 'Fatigue Budget System',
    source: 'Training Load Research',
    icon: '😴',
    explanation: 'Both systemic (CNS) and local muscle fatigue accumulate during training. Exceeding your recovery capacity leads to overtraining, injury, and regression instead of gains.',
    application: 'Each exercise has a "fatigue cost" (compounds: 8-12 pts, isolations: 3-5 pts). We track your weekly fatigue budget and trigger deloads when you\'re approaching your limit.',
    color: 'danger',
    deepDive: {
      title: 'Managing Fatigue for Long-Term Progress',
      sections: [
        {
          heading: 'Types of Training Fatigue',
          content: 'Fatigue isn\'t just muscle soreness. Systemic fatigue affects your entire body and CNS—heavy deadlifts don\'t just tire your back, they impact recovery globally. Local fatigue is muscle-specific. Both accumulate and both need to be managed. Ignoring either leads to plateaus, injury, or overtraining.',
        },
        {
          heading: 'The Fatigue Point System',
          content: 'We assign fatigue costs based on exercise demands. Heavy compounds (squats, deadlifts): 8-12 points—they\'re systemically demanding. Machine compounds (leg press, chest press): 5-7 points. Isolation exercises: 3-5 points. This lets us track your total weekly fatigue load across all training.',
        },
        {
          heading: 'Recognizing Fatigue Accumulation',
          content: 'Warning signs you\'re exceeding your fatigue budget: declining performance on key lifts, persistent soreness lasting 3+ days, sleep disturbances, decreased motivation, elevated resting heart rate, mood changes. These indicate systemic fatigue that rest days alone won\'t fix.',
        },
        {
          heading: 'Strategic Deloading',
          content: 'When fatigue accumulates to threshold levels, a deload week is needed. Cut volume by 50%, maintain intensity, focus on recovery. This allows fatigue to dissipate while maintaining fitness. Most people need to deload every 4-8 weeks depending on training intensity and individual recovery capacity.',
        },
      ],
    },
  },
  {
    title: 'Progressive Overload Mechanics',
    source: 'Fundamental Training Principle',
    icon: '🏋️',
    explanation: 'To grow, you must progressively do more: more weight, more reps, more sets, less rest, better technique. The body adapts to what you demand of it.',
    application: 'Each week, we suggest adding 1-2 reps or 2.5% weight to key lifts. When you hit the top of your rep range with good form, we recommend increasing load.',
    color: 'success',
    deepDive: {
      title: 'The Foundation of All Progress',
      sections: [
        {
          heading: 'Why Progressive Overload is Non-Negotiable',
          content: 'Your body adapts to stress by getting stronger and building muscle. Once adapted, the same stress no longer triggers adaptation. To continue growing, you must progressively increase demands. This is the single most important training principle—without it, you\'ll plateau regardless of exercise selection or program design.',
        },
        {
          heading: 'Methods of Progression',
          content: 'Weight: Adding load to the bar. Reps: Doing more reps at the same weight. Sets: Adding volume. Density: Same work in less time. Technique: Better execution for more effective stimulus. Range of Motion: Deeper stretches or fuller contractions. All are valid forms of overload.',
        },
        {
          heading: 'Double Progression Method',
          content: 'The most practical approach: Work within a rep range (e.g., 8-12 reps). Start at the bottom of the range with a weight that\'s challenging. Each session, try to add reps. Once you hit the top of the range with good form, increase weight and drop back to the bottom of the range. Repeat.',
        },
        {
          heading: 'Rate of Progression',
          content: 'Beginners can add weight weekly. Intermediates might progress every 2-3 weeks. Advanced lifters may take months to add meaningful weight. The key is consistent micro-progression over time. Adding 2.5lbs per month to your bench is still 30lbs per year—significant long-term progress.',
        },
      ],
    },
  },
  {
    title: 'FFMI & Natural Limits',
    source: 'Body Composition Research',
    icon: '📏',
    explanation: 'Fat-Free Mass Index (FFMI) normalizes lean mass by height. Natural lifters typically max out around 25 FFMI. Knowing your position helps set realistic expectations.',
    application: 'Enter your DEXA data and we calculate your FFMI. Compare against natural benchmarks to understand if you should bulk, cut, or recomp. AI coaching adapts recommendations accordingly.',
    color: 'primary',
    deepDive: {
      title: 'Understanding Your Muscular Potential',
      sections: [
        {
          heading: 'What is FFMI?',
          content: 'Fat-Free Mass Index (FFMI) = lean mass in kg / (height in meters)². It normalizes muscle mass by height, allowing fair comparison between individuals of different sizes. FFMI of 20 is average for non-training males. Natural lifters with good genetics and years of training typically reach 23-25.',
        },
        {
          heading: 'The Natural Limit Research',
          content: 'Studies of pre-steroid era athletes and natural bodybuilding competitors suggest an FFMI ceiling around 25-26 for genetically gifted naturals. Values above 26 are extremely rare without pharmaceutical assistance. This doesn\'t mean you can\'t look impressive—an FFMI of 23-24 with low body fat looks exceptionally muscular.',
        },
        {
          heading: 'Calculating Your FFMI',
          content: 'You need accurate lean mass data—DEXA scans are ideal. If using body fat estimates: Lean mass = Total weight × (1 - body fat %). Then: FFMI = Lean mass (kg) / Height (m)². Adjusted FFMI adds a height correction: FFMI + 6.1 × (1.8 - height in m).',
        },
        {
          heading: 'Using FFMI for Decision Making',
          content: 'If your FFMI is below 22-23, you likely have significant room to grow—prioritize building muscle with slight caloric surplus. If you\'re approaching 24-25, you\'re nearing natural limits—focus on optimizing body composition rather than expecting massive size gains. This prevents spinning wheels on unrealistic goals.',
        },
      ],
    },
  },
  {
    title: 'GLP-1 & Muscle Preservation',
    source: 'Recent Clinical Research',
    icon: '💊',
    explanation: 'GLP-1 agonists (Ozempic, Mounjaro) cause rapid weight loss, but up to 40% can be muscle without intervention. Higher protein and resistance training are essential for preservation.',
    application: 'When you indicate GLP-1 use, we boost protein targets to 1.2g/lb and ensure your training program maintains sufficient volume to preserve muscle during aggressive cuts.',
    color: 'accent',
    deepDive: {
      title: 'Protecting Muscle on GLP-1 Medications',
      sections: [
        {
          heading: 'The Muscle Loss Problem',
          content: 'GLP-1 agonists like semaglutide (Ozempic/Wegovy) and tirzepatide (Mounjaro) produce dramatic weight loss—often 15-20%+ of body weight. But studies show 25-40% of weight lost can be lean mass, not fat. Without intervention, you may end up "skinny fat" with reduced metabolism and less muscle than when you started.',
        },
        {
          heading: 'Why GLP-1s Accelerate Muscle Loss',
          content: 'These medications suppress appetite dramatically, often creating severe caloric deficits of 1000+ calories. Such aggressive deficits, combined with reduced protein intake (because you\'re eating less overall) and potential reduction in physical activity, create the perfect storm for muscle catabolism.',
        },
        {
          heading: 'The Intervention Protocol',
          content: 'Research and clinical experience suggest three key interventions: 1) High protein intake (1.2g/lb or higher) to maximize muscle protein synthesis despite the deficit. 2) Consistent resistance training with sufficient volume to signal muscle preservation. 3) Avoiding excessive deficits—eating enough to support training even if appetite is low.',
        },
        {
          heading: 'Realistic Expectations',
          content: 'Even with optimal intervention, some muscle loss is likely during rapid weight loss. The goal is minimization, not complete prevention. Expect to lose some strength during the weight loss phase—this is normal. Once you reach goal weight and return to maintenance calories, you can rebuild any lost muscle relatively quickly.',
        },
      ],
    },
  },
];

const colorClasses: Record<string, { bg: string; border: string; text: string }> = {
  primary: { bg: 'bg-primary-500/10', border: 'border-primary-500/20', text: 'text-primary-400' },
  accent: { bg: 'bg-accent-500/10', border: 'border-accent-500/20', text: 'text-accent-400' },
  warning: { bg: 'bg-warning-500/10', border: 'border-warning-500/20', text: 'text-warning-400' },
  danger: { bg: 'bg-danger-500/10', border: 'border-danger-500/20', text: 'text-danger-400' },
  success: { bg: 'bg-success-500/10', border: 'border-success-500/20', text: 'text-success-400' },
};

export default function SciencePage() {
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
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 via-purple-400 to-pink-400">
          The Science Behind HyperTracker
        </h1>
        <p className="text-lg text-surface-400 max-w-2xl mx-auto">
          Every algorithm in HyperTracker is based on peer-reviewed research and proven training methodologies.
          Here&apos;s the science that powers your gains.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-primary-400">12+</p>
          <p className="text-sm text-surface-400">Research Principles</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-accent-400">300K+</p>
          <p className="text-sm text-surface-400">Foods in Database</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-warning-400">500+</p>
          <p className="text-sm text-surface-400">S-Tier Exercises</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-success-400">AI</p>
          <p className="text-sm text-surface-400">Powered Coaching</p>
        </Card>
      </div>

      {/* Science Concepts */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-surface-100">Core Principles</h2>
        <div className="grid gap-4">
          {scienceConcepts.map((concept) => {
            const colors = colorClasses[concept.color];
            const isExpanded = expandedItems.has(concept.title);
            return (
              <Card
                key={concept.title}
                className={`p-6 ${colors.border} hover:border-opacity-50 transition-all duration-200 overflow-hidden`}
              >
                <div className="flex items-start gap-4">
                  <div className="text-3xl shrink-0">{concept.icon}</div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <h3 className="text-lg font-bold text-surface-100">{concept.title}</h3>
                      <span className={`px-3 py-1 ${colors.bg} ${colors.text} rounded-full text-xs font-medium shrink-0`}>
                        {concept.source}
                      </span>
                    </div>
                    <p className="text-surface-300">{concept.explanation}</p>

                    {/* In HyperTracker section - always visible */}
                    <div className={`p-3 ${colors.bg} rounded-lg border ${colors.border}`}>
                      <p className="text-sm">
                        <span className={`font-semibold ${colors.text}`}>In HyperTracker: </span>
                        <span className="text-surface-300">{concept.application}</span>
                      </p>
                    </div>

                    {/* Deep Dive Toggle Button */}
                    <button
                      onClick={() => toggleExpanded(concept.title)}
                      className={`flex items-center gap-2 text-sm ${colors.text} hover:opacity-80 transition-opacity`}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {isExpanded ? 'Hide deep dive' : 'Read deep dive article'}
                    </button>

                    {/* Expandable Deep Dive Content */}
                    {isExpanded && (
                      <div className="animate-slide-down space-y-4 pt-2">
                        <div className={`p-4 bg-surface-800/50 rounded-lg border border-surface-700`}>
                          <h4 className={`font-bold ${colors.text} mb-4 text-lg`}>
                            {concept.deepDive.title}
                          </h4>
                          <div className="space-y-4">
                            {concept.deepDive.sections.map((section, idx) => (
                              <div key={idx}>
                                <h5 className="font-semibold text-surface-200 mb-1">{section.heading}</h5>
                                <p className="text-surface-400 text-sm leading-relaxed">{section.content}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Link to learn page if available */}
                        {concept.link && (
                          <Link
                            href={concept.link}
                            className={`inline-flex items-center gap-1 text-sm ${colors.text} hover:underline`}
                          >
                            Read full article
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Key Researchers */}
      <Card className="p-6">
        <h2 className="text-xl font-bold text-surface-100 mb-4">Standing on the Shoulders of Giants</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Mike Israetel</p>
            <p className="text-xs text-surface-500">Volume, SFR, RP System</p>
          </div>
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Brad Schoenfeld</p>
            <p className="text-xs text-surface-500">Hypertrophy Mechanisms</p>
          </div>
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Greg Nuckols</p>
            <p className="text-xs text-surface-500">Periodization Research</p>
          </div>
          <div className="p-4 bg-surface-800/50 rounded-lg text-center">
            <p className="font-semibold text-surface-200">Dr. Eric Helms</p>
            <p className="text-xs text-surface-500">Natural Bodybuilding</p>
          </div>
        </div>
      </Card>

      {/* Deep Dive Articles */}
      <Card className="p-6">
        <h2 className="text-xl font-bold text-surface-100 mb-4">Deep Dive Articles</h2>
        <p className="text-surface-400 mb-4">
          Want to understand the science in more detail? Check out our Learn & Science section.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/dashboard/learn/adaptive-tdee">
            <div className="p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔥</span>
                <div>
                  <p className="font-semibold text-surface-200">Adaptive TDEE Estimation</p>
                  <p className="text-xs text-surface-500">How we calculate your personal metabolism</p>
                </div>
              </div>
            </div>
          </Link>
          <Link href="/dashboard/learn/injury-prevention">
            <div className="p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🛡️</span>
                <div>
                  <p className="font-semibold text-surface-200">Smart Injury Prevention</p>
                  <p className="text-xs text-surface-500">How we keep you safe with biomechanics</p>
                </div>
              </div>
            </div>
          </Link>
        </div>
        <Link href="/dashboard/learn" className="block mt-4 text-center text-sm text-primary-400 hover:text-primary-300 transition-colors">
          View all articles →
        </Link>
      </Card>

      {/* CTA */}
      <Card className="p-8 text-center bg-gradient-to-r from-primary-500/10 via-purple-500/10 to-accent-500/10 border-primary-500/20">
        <h2 className="text-2xl font-bold text-surface-100 mb-2">Ready to Apply the Science?</h2>
        <p className="text-surface-400 mb-6">
          Stop guessing. Let evidence-based algorithms optimize your training and nutrition.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/dashboard/mesocycle/new">
            <button className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
              Create Mesocycle
            </button>
          </Link>
          <Link href="/dashboard/nutrition">
            <button className="px-6 py-3 bg-surface-800 hover:bg-surface-700 text-surface-200 font-semibold rounded-lg transition-colors">
              Set Up Nutrition
            </button>
          </Link>
          <Link href="/dashboard/learn">
            <button className="px-6 py-3 bg-surface-800 hover:bg-surface-700 text-surface-200 font-semibold rounded-lg transition-colors">
              Learn More
            </button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

