// ============ EDUCATION SYSTEM TYPES ============

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
  },
  MAV: {
    term: 'MAV',
    fullName: 'Maximum Adaptive Volume',
    shortExplanation: 'The optimal training zone where you get the best results. This is your "sweet spot" for muscle growth.',
    longExplanation: 'Training within your MAV range gives you the best balance of stimulus and recovery. Going above this provides diminishing returns.',
    learnMoreSlug: 'adaptive-volume',
  },
  MRV: {
    term: 'MRV',
    fullName: 'Maximum Recoverable Volume',
    shortExplanation: 'The upper limit of sets you can recover from. Going beyond this leads to fatigue without extra gains.',
    longExplanation: 'Exceeding your MRV means you\'re doing more work than your body can recover from, which can lead to overtraining, injury, and actually slower progress.',
    learnMoreSlug: 'adaptive-volume',
  },

  // Intensity Measures
  RPE: {
    term: 'RPE',
    fullName: 'Rate of Perceived Exertion',
    shortExplanation: 'A 1-10 scale measuring how hard a set felt. Higher numbers mean harder effort.',
    longExplanation: 'RPE helps auto-regulate your training based on daily readiness. RPE 7 means you could do 3 more reps, RPE 10 means you couldn\'t do another rep.',
    learnMoreSlug: 'progressive-overload',
  },
  RIR: {
    term: 'RIR',
    fullName: 'Reps In Reserve',
    shortExplanation: 'How many more reps you could have done. RIR 2 means you had 2 reps left "in the tank".',
    longExplanation: 'RIR is the flip side of RPE. Most hypertrophy training targets RIR 1-3 (leaving some in the tank) to maximize muscle growth while allowing recovery.',
    learnMoreSlug: 'progressive-overload',
  },

  // Body Composition
  FFMI: {
    term: 'FFMI',
    fullName: 'Fat-Free Mass Index',
    shortExplanation: 'A measure of how much muscle you carry relative to your height. Think of it as "BMI for muscle".',
    longExplanation: 'FFMI helps assess muscular development independent of body fat. Natural lifters typically max out around 25 FFMI. Values above this usually indicate exceptional genetics or enhancement.',
    learnMoreSlug: 'understanding-data',
  },
  E1RM: {
    term: 'E1RM',
    fullName: 'Estimated One-Rep Max',
    shortExplanation: 'The maximum weight you could lift for one rep, calculated from your performance at higher reps.',
    longExplanation: 'E1RM lets us track strength progress without actually testing your max (which is fatiguing and risky). It\'s calculated using proven formulas based on weight × reps.',
    learnMoreSlug: 'understanding-data',
  },

  // Set Quality
  STIMULATIVE_SET: {
    term: 'Stimulative Set',
    shortExplanation: 'A set hard enough to trigger muscle growth (RPE 7.5-9.5). These are your "money sets".',
    longExplanation: 'Research shows that sets need to be challenging enough to recruit high-threshold motor units. Too easy = not stimulative. Too hard = excessive fatigue.',
    learnMoreSlug: 'progressive-overload',
  },
  JUNK_VOLUME: {
    term: 'Junk Volume',
    shortExplanation: 'Sets that are too easy (RPE 5 or below) to stimulate growth. They add fatigue without benefit.',
    longExplanation: 'Junk volume often comes from excessive warm-up sets or going through the motions. These sets don\'t count toward your weekly volume.',
  },
  FORM_QUALITY: {
    term: 'Form Quality',
    shortExplanation: 'How well you maintained technique during the set. Good form means better results and lower injury risk.',
    longExplanation: 'Tracking form helps identify when weight should increase vs. when technique needs work. Consistently ugly form suggests the weight is too heavy.',
  },

  // Training Phases
  DELOAD: {
    term: 'Deload',
    shortExplanation: 'A planned recovery week with reduced volume/intensity. Helps your body fully recover and supercompensate.',
    longExplanation: 'Deloads prevent accumulated fatigue from catching up with you. Typically involves 40-60% reduction in volume while maintaining intensity.',
    learnMoreSlug: 'adaptive-volume',
  },
  MESOCYCLE: {
    term: 'Mesocycle',
    shortExplanation: 'A training block (usually 4-8 weeks) with progressive overload followed by a deload.',
    longExplanation: 'Mesocycles provide structure for systematic progression. Volume and intensity increase week-to-week, then reset after a deload.',
  },

  // Strength
  PERCENTILE: {
    term: 'Percentile',
    shortExplanation: 'Where you rank compared to others. 75th percentile means you\'re stronger than 75% of that group.',
    longExplanation: 'We compare your lifts against general population, trained lifters, and your body composition peers to give you context on your strength.',
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
    color: 'text-green-400',
  },
  {
    rir: 2,
    rpe: 8,
    label: '2-3 Good',
    shortDesc: 'Working hard',
    longDesc: 'Challenging but sustainable. This is the sweet spot for most training.',
    example: 'Getting tough, but you could definitely get 2-3 more reps with good form.',
    color: 'text-yellow-400',
  },
  {
    rir: 1,
    rpe: 9,
    label: '1 Hard',
    shortDesc: 'Near limit',
    longDesc: 'Very challenging. Maybe one more rep possible. Use sparingly.',
    example: 'That was hard. You might get one more rep, but it would be ugly.',
    color: 'text-orange-400',
  },
  {
    rir: 0,
    rpe: 10,
    label: '0 Max',
    shortDesc: 'True failure',
    longDesc: 'Complete muscular failure. Nothing left. Only for testing, not regular training.',
    example: 'Couldn\'t complete another rep even if someone paid you.',
    color: 'text-red-400',
  },
];
