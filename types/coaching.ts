// ============ AI COACHING TYPES ============

/** Phase type for training goal */
export type PhaseType = 'cut' | 'bulk' | 'maintain';

/** Training phase with goals and progress */
export interface TrainingPhase {
  id: string;
  userId: string;
  phaseType: PhaseType;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  startWeightKg: number;
  targetWeightKg?: number;
  targetBodyFatPercent?: number;
  currentWeek: number;
  plannedDurationWeeks?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** AI coaching conversation message */
export interface CoachingMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  context?: CoachingContext;
}

/** AI coaching conversation thread */
export interface CoachingConversation {
  id: string;
  userId: string;
  title?: string;
  startedAt: string;
  lastMessageAt: string;
  messages: CoachingMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Recent lift performance data */
export interface RecentLift {
  exerciseName: string;
  date: string;
  topSetWeight: number;
  topSetReps: number;
  topSetRpe: number;
  estimated1RM: number;
}

/** Coaching context passed to AI for personalized advice */
export interface CoachingContext {
  user: {
    name: string;
    age: number;
    sex: 'male' | 'female';
    height: number; // cm
    trainingAge: number; // years
  };
  phase?: {
    type: PhaseType;
    weekNumber: number;
    startWeight: number;
    targetWeight?: number;
  };
  currentStats: {
    weight: number;
    weightTrend?: 'increasing' | 'stable' | 'decreasing';
    bodyFat?: number;
    leanMass?: number;
    lastDexaDate?: string;
  };
  training: {
    currentBlock?: string;
    weekInBlock?: number;
    daysPerWeek?: number;
    recentLifts: RecentLift[];
  };
  // Future: nutrition object will be added here
}

/** Request to AI coaching endpoint */
export interface CoachingRequest {
  conversationId?: string;
  message: string;
  context: CoachingContext;
}

/** Response from AI coaching endpoint */
export interface CoachingResponse {
  conversationId: string;
  message: string;
  timestamp: string;
}
