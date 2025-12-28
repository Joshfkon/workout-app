// ============ EDUCATION SYSTEM TYPES ============

/**
 * Categories for glossary entries
 */
export type GlossaryCategory =
  | 'volume'
  | 'intensity'
  | 'body-composition'
  | 'periodization'
  | 'set-quality'
  | 'strength'
  | 'nutrition'
  | 'recovery';

/**
 * Education preferences for controlling beginner-friendly features
 */
export interface EducationPreferences {
  /** Show beginner-friendly tips and explanations */
  showBeginnerTips: boolean;

  /** Explain science terms with plain language tooltips */
  explainScienceTerms: boolean;

  /** IDs of dismissed one-time hints */
  dismissedHints: string[];

  /** IDs of completed guided tours */
  completedTours: string[];
}

/**
 * Default education preferences for new users
 */
export const DEFAULT_EDUCATION_PREFERENCES: EducationPreferences = {
  showBeginnerTips: true,
  explainScienceTerms: true,
  dismissedHints: [],
  completedTours: [],
};

/**
 * Tooltip content for a scientific term
 */
export interface TooltipContent {
  /** The term being explained (e.g., "MEV") */
  term: string;

  /** Full name if it's an acronym */
  fullName?: string;

  /** Short, beginner-friendly explanation (1-2 sentences) */
  shortExplanation: string;

  /** Longer explanation with more context */
  longExplanation?: string;

  /** Slug for the Learn article if available */
  learnMoreSlug?: string;

  /** Category for glossary grouping */
  category?: GlossaryCategory;
}

/**
 * Content for a context card shown before data collection
 */
export interface ContextCardContent {
  /** Icon to display (emoji or icon name) */
  icon: string;

  /** Title explaining what we're asking */
  title: string;

  /** Bullet points explaining why this matters */
  points: string[];

  /** Optional "what happens next" preview */
  preview?: string;
}

/**
 * First-time hint configuration
 */
export interface FirstTimeHintConfig {
  /** Unique ID for tracking dismissal */
  id: string;

  /** Title of the hint */
  title: string;

  /** Description/explanation */
  description: string;

  /** Position relative to target element */
  position?: 'top' | 'bottom' | 'left' | 'right';

  /** Optional action button */
  action?: {
    label: string;
    href?: string;
  };
}

// ============ TOOLTIP CONTENT LIBRARY ============

export const TOOLTIP_CONTENT: Record<string, TooltipContent> = {
  // Volume Landmarks
  MEV: {
    term: 'MEV',
    fullName: 'Minimum Effective Volume',
    shortExplanation: 'The minimum sets per week needed to maintain muscle. Below this, you risk losing progress.',
    longExplanation: 'Research shows that training below MEV leads to gradual muscle loss over time. Your MEV is personalized based on your experience level - more advanced lifters need more volume to maintain.',
    learnMoreSlug: 'adaptive-volume',
    category: 'volume',
  },
  MAV: {
    term: 'MAV',
    fullName: 'Maximum Adaptive Volume',
    shortExplanation: 'The optimal training zone where you get the best results. This is your "sweet spot" for muscle growth.',
    longExplanation: 'Training within your MAV range gives you the best balance of stimulus and recovery. Going above this provides diminishing returns.',
    learnMoreSlug: 'adaptive-volume',
    category: 'volume',
  },
  MRV: {
    term: 'MRV',
    fullName: 'Maximum Recoverable Volume',
    shortExplanation: 'The upper limit of sets you can recover from. Going beyond this leads to fatigue without extra gains.',
    longExplanation: 'Exceeding your MRV means you\'re doing more work than your body can recover from, which can lead to overtraining, injury, and actually slower progress.',
    learnMoreSlug: 'adaptive-volume',
    category: 'volume',
  },
  VOLUME: {
    term: 'Volume',
    shortExplanation: 'The total amount of work you do, typically measured as sets per muscle group per week.',
    longExplanation: 'Training volume is a key driver of muscle growth. Too little = no progress. Too much = you can\'t recover. Finding your personal sweet spot is crucial.',
    category: 'volume',
  },
  FREQUENCY: {
    term: 'Frequency',
    shortExplanation: 'How often you train a muscle group per week. Higher frequency often allows for more total volume.',
    longExplanation: 'Research suggests training each muscle 2-3x per week is optimal for most people. This spreads volume across more sessions, improving workout quality.',
    category: 'volume',
  },

  // Intensity Measures
  RPE: {
    term: 'RPE',
    fullName: 'Rate of Perceived Exertion',
    shortExplanation: 'A 1-10 scale measuring how hard a set felt. Higher numbers mean harder effort.',
    longExplanation: 'RPE helps auto-regulate your training based on daily readiness. RPE 7 means you could do 3 more reps, RPE 10 means you couldn\'t do another rep.',
    learnMoreSlug: 'progressive-overload',
    category: 'intensity',
  },
  RIR: {
    term: 'RIR',
    fullName: 'Reps In Reserve',
    shortExplanation: 'How many more reps you could have done. RIR 2 means you had 2 reps left "in the tank".',
    longExplanation: 'RIR is the flip side of RPE. Most hypertrophy training targets RIR 1-3 (leaving some in the tank) to maximize muscle growth while allowing recovery.',
    learnMoreSlug: 'progressive-overload',
    category: 'intensity',
  },
  INTENSITY: {
    term: 'Intensity',
    shortExplanation: 'How heavy the weight is relative to your max. Often expressed as a percentage of 1RM.',
    longExplanation: 'For hypertrophy, moderate intensity (60-80% 1RM) with sufficient volume works best. Strength training uses higher intensity (80-95% 1RM) with lower volume.',
    category: 'intensity',
  },
  PROGRESSIVE_OVERLOAD: {
    term: 'Progressive Overload',
    shortExplanation: 'Gradually increasing the demands on your muscles over time. The fundamental principle of getting stronger.',
    longExplanation: 'You can progressively overload by adding weight, reps, sets, or improving technique. Without progressive overload, your body has no reason to adapt.',
    learnMoreSlug: 'progressive-overload',
    category: 'intensity',
  },

  // Body Composition
  FFMI: {
    term: 'FFMI',
    fullName: 'Fat-Free Mass Index',
    shortExplanation: 'A measure of how much muscle you carry relative to your height. Think of it as "BMI for muscle".',
    longExplanation: 'FFMI helps assess muscular development independent of body fat. Natural lifters typically max out around 25 FFMI. Values above this usually indicate exceptional genetics or enhancement.',
    learnMoreSlug: 'understanding-data',
    category: 'body-composition',
  },
  E1RM: {
    term: 'E1RM',
    fullName: 'Estimated One-Rep Max',
    shortExplanation: 'The maximum weight you could lift for one rep, calculated from your performance at higher reps.',
    longExplanation: 'E1RM lets us track strength progress without actually testing your max (which is fatiguing and risky). It\'s calculated using proven formulas based on weight × reps.',
    learnMoreSlug: 'understanding-data',
    category: 'strength',
  },
  BODY_FAT_PERCENTAGE: {
    term: 'Body Fat %',
    fullName: 'Body Fat Percentage',
    shortExplanation: 'The proportion of your total body weight that is fat tissue.',
    longExplanation: 'For men, 10-20% is generally considered athletic. For women, 18-28% is athletic. Lower isn\'t always better - essential fat is needed for health.',
    category: 'body-composition',
  },
  LEAN_MASS: {
    term: 'Lean Mass',
    shortExplanation: 'Everything in your body that isn\'t fat - muscles, bones, organs, and water.',
    longExplanation: 'Building lean mass is the goal of hypertrophy training. More lean mass means a higher metabolism and better strength.',
    category: 'body-composition',
  },
  RECOMP: {
    term: 'Recomp',
    fullName: 'Body Recomposition',
    shortExplanation: 'Simultaneously building muscle and losing fat. Slow but effective for those near maintenance calories.',
    longExplanation: 'Recomposition works best for beginners, those returning after a break, or when you\'re already lean. Progress is slower than dedicated bulk/cut cycles.',
    category: 'body-composition',
  },

  // Set Quality
  STIMULATIVE_SET: {
    term: 'Stimulative Set',
    shortExplanation: 'A set hard enough to trigger muscle growth (RPE 7.5-9.5). These are your "money sets".',
    longExplanation: 'Research shows that sets need to be challenging enough to recruit high-threshold motor units. Too easy = not stimulative. Too hard = excessive fatigue.',
    learnMoreSlug: 'progressive-overload',
    category: 'set-quality',
  },
  JUNK_VOLUME: {
    term: 'Junk Volume',
    shortExplanation: 'Sets that are too easy (RPE 5 or below) to stimulate growth. They add fatigue without benefit.',
    longExplanation: 'Junk volume often comes from excessive warm-up sets or going through the motions. These sets don\'t count toward your weekly volume.',
    category: 'set-quality',
  },
  FORM_QUALITY: {
    term: 'Form Quality',
    shortExplanation: 'How well you maintained technique during the set. Good form means better results and lower injury risk.',
    longExplanation: 'Tracking form helps identify when weight should increase vs. when technique needs work. Consistently ugly form suggests the weight is too heavy.',
    category: 'set-quality',
  },
  EFFECTIVE_SET: {
    term: 'Effective Set',
    shortExplanation: 'A working set that contributes to muscle growth (RPE 6-7). Good work, but not quite as stimulating.',
    longExplanation: 'Effective sets count toward your weekly volume but aren\'t as powerful as stimulative sets. A mix of both is fine.',
    category: 'set-quality',
  },

  // Training Phases / Periodization
  DELOAD: {
    term: 'Deload',
    shortExplanation: 'A planned recovery week with reduced volume/intensity. Helps your body fully recover and supercompensate.',
    longExplanation: 'Deloads prevent accumulated fatigue from catching up with you. Typically involves 40-60% reduction in volume while maintaining intensity.',
    learnMoreSlug: 'adaptive-volume',
    category: 'periodization',
  },
  MESOCYCLE: {
    term: 'Mesocycle',
    shortExplanation: 'A training block (usually 4-8 weeks) with progressive overload followed by a deload.',
    longExplanation: 'Mesocycles provide structure for systematic progression. Volume and intensity increase week-to-week, then reset after a deload.',
    category: 'periodization',
  },
  PERIODIZATION: {
    term: 'Periodization',
    shortExplanation: 'Organizing training into phases with different focuses (hypertrophy, strength, deload).',
    longExplanation: 'Periodization prevents plateaus and overtraining by varying stress over time. Each phase builds on the previous one.',
    category: 'periodization',
  },
  MACROCYCLE: {
    term: 'Macrocycle',
    shortExplanation: 'A long-term training plan, typically 3-12 months, made up of multiple mesocycles.',
    longExplanation: 'Macrocycles help you plan toward major goals like competitions or peak physique. They sequence phases strategically.',
    category: 'periodization',
  },
  MICROCYCLE: {
    term: 'Microcycle',
    shortExplanation: 'The smallest training cycle, typically one week. Contains your individual workout sessions.',
    longExplanation: 'Microcycles determine your weekly structure - which muscles on which days, rest days, etc.',
    category: 'periodization',
  },

  // Strength
  PERCENTILE: {
    term: 'Percentile',
    shortExplanation: 'Where you rank compared to others. 75th percentile means you\'re stronger than 75% of that group.',
    longExplanation: 'We compare your lifts against general population, trained lifters, and your body composition peers to give you context on your strength.',
    category: 'strength',
  },
  ONE_REP_MAX: {
    term: '1RM',
    fullName: 'One Rep Max',
    shortExplanation: 'The maximum weight you can lift for exactly one repetition with good form.',
    longExplanation: 'Testing your true 1RM is fatiguing and carries injury risk. We use E1RM (estimated 1RM) calculated from your working sets instead.',
    category: 'strength',
  },
  STRENGTH_STANDARDS: {
    term: 'Strength Standards',
    shortExplanation: 'Benchmarks for classifying lifters as beginner, intermediate, advanced, or elite.',
    longExplanation: 'Standards are based on body weight ratios. They help set realistic goals and identify relative weaknesses.',
    category: 'strength',
  },

  // Nutrition
  TDEE: {
    term: 'TDEE',
    fullName: 'Total Daily Energy Expenditure',
    shortExplanation: 'The total calories you burn per day, including exercise and daily activities.',
    longExplanation: 'TDEE = BMR + activity. Eating above TDEE = weight gain (bulking). Eating below = weight loss (cutting). At TDEE = maintenance.',
    category: 'nutrition',
  },
  MACROS: {
    term: 'Macros',
    fullName: 'Macronutrients',
    shortExplanation: 'Protein, carbohydrates, and fats - the three main nutrient categories that provide calories.',
    longExplanation: 'For muscle building, protein is king (0.7-1g per lb bodyweight). Carbs fuel workouts, fats support hormones. Balance matters.',
    category: 'nutrition',
  },
  PROTEIN_INTAKE: {
    term: 'Protein Intake',
    shortExplanation: 'How much protein you eat daily. Critical for muscle repair and growth.',
    longExplanation: 'Research suggests 0.7-1g per pound of body weight for those training hard. More isn\'t necessarily better, but too little limits progress.',
    category: 'nutrition',
  },
  CALORIC_SURPLUS: {
    term: 'Caloric Surplus',
    shortExplanation: 'Eating more calories than you burn. Required for optimal muscle building.',
    longExplanation: 'A moderate surplus (200-500 calories) supports muscle growth while minimizing fat gain. Too large a surplus just adds fat faster.',
    category: 'nutrition',
  },
  CALORIC_DEFICIT: {
    term: 'Caloric Deficit',
    shortExplanation: 'Eating fewer calories than you burn. Required for fat loss.',
    longExplanation: 'A moderate deficit (300-500 calories) preserves muscle while losing fat. Too aggressive and you\'ll lose muscle along with fat.',
    category: 'nutrition',
  },

  // Recovery
  RECOVERY: {
    term: 'Recovery',
    shortExplanation: 'The process of your body repairing and adapting to training stress. Where gains actually happen.',
    longExplanation: 'You don\'t get stronger while lifting - you get stronger while recovering. Sleep, nutrition, and stress management all impact recovery.',
    category: 'recovery',
  },
  SUPERCOMPENSATION: {
    term: 'Supercompensation',
    shortExplanation: 'When your body rebuilds stronger than before after recovering from training stress.',
    longExplanation: 'This is why timing matters - train again too soon and you don\'t recover fully. Wait too long and you lose the adaptation window.',
    category: 'recovery',
  },
  FATIGUE: {
    term: 'Fatigue',
    shortExplanation: 'Accumulated tiredness from training that temporarily reduces performance.',
    longExplanation: 'Some fatigue is normal and expected. Too much accumulated fatigue masks your true strength and increases injury risk - that\'s when you need a deload.',
    category: 'recovery',
  },
  DOMS: {
    term: 'DOMS',
    fullName: 'Delayed Onset Muscle Soreness',
    shortExplanation: 'The muscle soreness that peaks 24-72 hours after training. Not a reliable indicator of workout quality.',
    longExplanation: 'DOMS is caused by unfamiliar movements or eccentric stress. Being sore doesn\'t mean you had a good workout, and not being sore doesn\'t mean you didn\'t.',
    category: 'recovery',
  },
  SLEEP: {
    term: 'Sleep',
    shortExplanation: 'The most important recovery factor. 7-9 hours is optimal for muscle growth and performance.',
    longExplanation: 'During deep sleep, growth hormone peaks and muscle protein synthesis is elevated. Poor sleep directly impairs gains and increases injury risk.',
    category: 'recovery',
  },
};

// Category display names and icons
export const GLOSSARY_CATEGORIES: Record<GlossaryCategory, { label: string; icon: string; description: string }> = {
  'volume': {
    label: 'Training Volume',
    icon: '📊',
    description: 'Sets, reps, and how much work you do',
  },
  'intensity': {
    label: 'Intensity & Effort',
    icon: '💪',
    description: 'How hard you push and measuring effort',
  },
  'body-composition': {
    label: 'Body Composition',
    icon: '📐',
    description: 'Muscle, fat, and physique metrics',
  },
  'periodization': {
    label: 'Periodization',
    icon: '📅',
    description: 'Training phases and program structure',
  },
  'set-quality': {
    label: 'Set Quality',
    icon: '✅',
    description: 'Measuring how effective your sets are',
  },
  'strength': {
    label: 'Strength',
    icon: '🏋️',
    description: 'Measuring and comparing your strength',
  },
  'nutrition': {
    label: 'Nutrition',
    icon: '🍎',
    description: 'Calories, macros, and eating for gains',
  },
  'recovery': {
    label: 'Recovery',
    icon: '😴',
    description: 'Rest, sleep, and adaptation',
  },
};

// ============ CONTEXT CARD CONTENT ============

export const CONTEXT_CARDS: Record<string, ContextCardContent> = {
  bodyComposition: {
    icon: '📊',
    title: 'Why we measure your body composition',
    points: [
      'Calculate your personalized nutrition targets',
      'Track progress beyond just weight on the scale',
      'Set realistic goals based on your physique',
      'Compare your strength relative to your muscle mass',
    ],
    preview: 'This data helps us recommend the right training volume and calorie targets for your goals.',
  },
  benchmarkSelection: {
    icon: '🎯',
    title: 'Why we test your strength',
    points: [
      'Calibrate weight recommendations for ALL exercises',
      'Identify muscle imbalances to address',
      'Set your starting point for progress tracking',
      'Personalize your training intensity',
    ],
    preview: 'After testing, we\'ll automatically suggest appropriate weights for your entire workout.',
  },
  calibration: {
    icon: '⚖️',
    title: 'How calibration works',
    points: [
      'We\'ll guide you through warm-up sets',
      'You\'ll work up to a challenging weight',
      'Tell us how hard each set felt',
      'We calculate your strength from there',
    ],
    preview: 'This typically takes 3-4 minutes per lift. You can skip any lift you prefer not to test.',
  },
  mesocycleCreation: {
    icon: '📅',
    title: 'Building your training program',
    points: [
      'We\'ll create a structured plan based on your goals',
      'Volume starts moderate and builds each week',
      'A deload week helps you recover and grow',
      'Everything is customizable to your preferences',
    ],
    preview: 'Your mesocycle will include smart progressions and automatic deload timing.',
  },
  mesocycleSchedule: {
    icon: '📆',
    title: 'Setting your training schedule',
    points: [
      'More training days = higher frequency per muscle (great for growth)',
      'Session length determines how many exercises you can do',
      'We\'ll recommend the best split for your schedule',
      'Short on time? We\'ll prioritize the most effective exercises',
    ],
    preview: 'Your schedule affects which muscles get trained together and how often.',
  },
  mesocycleCustomize: {
    icon: '⚙️',
    title: 'Fine-tuning your program',
    points: [
      'Training split determines which muscles get trained together',
      'Longer mesocycles allow more progression before deloading',
      'Our AI recommendations are based on your profile and goals',
      'Feel free to customize - you know your body best',
    ],
    preview: 'Any changes you make here will be reflected in your workout structure.',
  },
  periodization: {
    icon: '📈',
    title: 'How your program progresses',
    points: [
      'Each week gradually increases challenge (progressive overload)',
      'Volume increases while intensity stays consistent',
      'The final week is a deload - reduced volume for recovery',
      'After the deload, you\'ll be stronger and ready for the next block',
    ],
    preview: 'This wave pattern of stress and recovery is key to long-term gains.',
  },
  deloadWeek: {
    icon: '🔄',
    title: 'Why the deload week matters',
    points: [
      'Accumulated fatigue can mask your true strength',
      'Recovery allows your body to fully adapt to training',
      'You\'ll feel refreshed and often hit PRs after deloading',
      'Skipping deloads leads to burnout and plateaus',
    ],
    preview: 'The deload uses 50% of normal volume while keeping weights the same.',
  },
  firstWorkout: {
    icon: '🏋️',
    title: 'Your first workout',
    points: [
      'We\'ll guide you through each exercise with clear targets',
      'Log your sets to track progress and get smart recommendations',
      'Rate how hard each set felt (RIR) for auto-regulation',
      'Rest timers help optimize your recovery between sets',
    ],
    preview: 'After a few workouts, we\'ll learn your patterns and personalize even more.',
  },
  weeklyProgress: {
    icon: '📊',
    title: 'Understanding your weekly progress',
    points: [
      'Volume tracks total sets per muscle group',
      'Green zone means optimal training for growth',
      'Below minimum (MEV) risks muscle loss',
      'Above maximum (MRV) means too much to recover from',
    ],
    preview: 'Check your dashboard weekly to see how your training is distributed.',
  },
};

// ============ RIR/RPE EXPLANATION CONTENT ============

export interface RIRExplanation {
  rir: number;
  rpe: number;
  label: string;
  shortDesc: string;
  longDesc: string;
  example: string;
  color: string;
}

export const RIR_EXPLANATIONS: RIRExplanation[] = [
  {
    rir: 4,
    rpe: 6,
    label: '4+ Easy',
    shortDesc: 'Warm-up feel',
    longDesc: 'Very controlled, could do many more reps. Good for warm-ups and technique practice.',
    example: 'Feels like a warm-up set. Form is perfect, breathing is easy.',
    color: 'text-red-400',
  },
  {
    rir: 2,
    rpe: 8,
    label: '2-3 Good',
    shortDesc: 'Working hard',
    longDesc: 'Challenging but sustainable. This is the sweet spot for most training.',
    example: 'Getting tough, but you could definitely get 2-3 more reps with good form.',
    color: 'text-green-400',
  },
  {
    rir: 1,
    rpe: 9,
    label: '1 Hard',
    shortDesc: 'Near limit',
    longDesc: 'Very challenging. Maybe one more rep possible. Use sparingly.',
    example: 'That was hard. You might get one more rep, but it would be ugly.',
    color: 'text-yellow-400',
  },
  {
    rir: 0,
    rpe: 10,
    label: '0 Max',
    shortDesc: 'True failure',
    longDesc: 'Complete muscular failure. Nothing left. Only for testing, not regular training.',
    example: 'Couldn\'t complete another rep even if someone paid you.',
    color: 'text-orange-400',
  },
];
