'use server';

/**
 * In-Workout AI Coaching Actions
 *
 * Provides lightweight, contextual coaching cues during active workout sessions.
 * Uses xAI Grok for natural language generation while keeping signal detection
 * deterministic and off the critical path.
 */

import type { SetLog } from '@/types/schema';

/**
 * Lazy-load OpenAI client to avoid pulling in `Response` dependency at module load time.
 * This prevents "Response is not defined" errors in Jest when client components
 * transitively import this module through the workout components barrel.
 */
async function getXaiClient() {
  const { default: OpenAI } = await import('openai');
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  });
}

// System prompts for different coaching contexts
const WHISPER_PROMPT = `You are a concise strength coach providing real-time exercise guidance during an active workout. Your cues must be:
- ONE SHORT LINE (max 12 words)
- Specific to the data provided
- Actionable and encouraging
- Never generic cheerleading

Compare current performance to last session when data exists. Focus on what matters NOW.`;

const REST_TIP_PROMPT = `You are a strength coach providing a quick tip during rest periods. Be:
- BRIEF (1-2 short sentences max)
- Specific and actionable
- Focused on form, breathing, or mental prep for the next set
- Never motivational fluff`;

const SESSION_SPINE_PROMPT = `You are a strength coach creating a session checklist. Provide 3-5 bullet points that:
- Highlight key focus areas for THIS workout
- Reference specific exercises or muscles when relevant
- Are concrete and trackable (user can mentally "check off")
- Avoid generic advice`;

/**
 * Generate a per-exercise whisper - short contextual cue
 */
export async function generateExerciseWhisper(input: {
  exerciseName: string;
  setsCompletedToday: number;
  lastSessionData?: {
    avgWeight: number;
    avgReps: number;
    avgRpe: number;
  };
  todayData?: {
    avgWeight: number;
    avgReps: number;
    avgRpe: number;
  };
  units: 'kg' | 'lb';
}): Promise<{ cue: string; generated: boolean }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      cue: generateFallbackWhisper(input),
      generated: false,
    };
  }

  try {
    const openai = await getXaiClient();

    const context = buildWhisperContext(input);
    const response = await openai.chat.completions.create({
      model: 'grok-4.6',
      max_tokens: 50,
      temperature: 0.7,
      messages: [
        { role: 'system', content: WHISPER_PROMPT },
        { role: 'user', content: context },
      ],
    });

    const cue = response.choices[0]?.message?.content?.trim() || generateFallbackWhisper(input);

    return {
      cue,
      generated: true,
    };
  } catch (error) {
    console.error('[In-Workout Coach] Whisper generation failed:', error);
    return {
      cue: generateFallbackWhisper(input),
      generated: false,
    };
  }
}

/**
 * Polish a detected signal into natural language
 */
export async function polishSignalMessage(input: {
  signalType: 'big_drop' | 'rpe_ceiling' | 'crushing_it' | 'pain_logged' | 'fatigue_warning' | 'form_breakdown';
  exerciseName?: string;
  details: string;
}): Promise<{ message: string; generated: boolean }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      message: input.details,
      generated: false,
    };
  }

  try {
    const openai = await getXaiClient();

    const prompt = `Signal detected: ${input.signalType}. Raw: ${input.details}. Rephrase into ONE SHORT coaching line (max 15 words) that's specific and actionable.`;
    
    const response = await openai.chat.completions.create({
      model: 'grok-4.6',
      max_tokens: 40,
      temperature: 0.6,
      messages: [
        { role: 'system', content: 'You are a concise strength coach. Convert signals into brief, actionable cues.' },
        { role: 'user', content: prompt },
      ],
    });

    const message = response.choices[0]?.message?.content?.trim() || input.details;

    return {
      message,
      generated: true,
    };
  } catch (error) {
    console.error('[In-Workout Coach] Signal polish failed:', error);
    return {
      message: input.details,
      generated: false,
    };
  }
}

/**
 * Generate a rest-timer tip
 */
export async function generateRestTip(input: {
  nextExerciseName: string;
  nextWeight?: number;
  nextReps?: string;
  restSecondsRemaining: number;
  units: 'kg' | 'lb';
}): Promise<{ tip: string; generated: boolean }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      tip: generateFallbackRestTip(input),
      generated: false,
    };
  }

  try {
    const openai = await getXaiClient();

    const context = `Next: ${input.nextExerciseName}${input.nextWeight ? ` at ${input.nextWeight}${input.units}` : ''}${input.nextReps ? ` for ${input.nextReps}` : ''}. ${input.restSecondsRemaining}s rest remaining.`;
    
    const response = await openai.chat.completions.create({
      model: 'grok-4.6',
      max_tokens: 60,
      temperature: 0.7,
      messages: [
        { role: 'system', content: REST_TIP_PROMPT },
        { role: 'user', content: `Give a quick tip for: ${context}` },
      ],
    });

    const tip = response.choices[0]?.message?.content?.trim() || generateFallbackRestTip(input);

    return {
      tip,
      generated: true,
    };
  } catch (error) {
    console.error('[In-Workout Coach] Rest tip generation failed:', error);
    return {
      tip: generateFallbackRestTip(input),
      generated: false,
    };
  }
}

/**
 * Generate session spine - live workout checklist
 */
export async function generateSessionSpine(input: {
  exercises: Array<{ name: string; primaryMuscle: string; sets: number }>;
  workoutType?: string;
  weekInMeso?: number;
  totalWeeks?: number;
  injuries?: Array<{ area: string; severity: 1 | 2 | 3 }>;
}): Promise<{ spine: string[]; generated: boolean }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      spine: generateFallbackSpine(input),
      generated: false,
    };
  }

  try {
    const openai = await getXaiClient();

    const context = buildSpineContext(input);
    
    const response = await openai.chat.completions.create({
      model: 'grok-4.6',
      max_tokens: 200,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SESSION_SPINE_PROMPT },
        { role: 'user', content: `Create 3-5 focus bullets for: ${context}` },
      ],
    });

    const rawSpine = response.choices[0]?.message?.content?.trim() || '';
    const spine = parseSpineResponse(rawSpine);

    return {
      spine: spine.length > 0 ? spine : generateFallbackSpine(input),
      generated: true,
    };
  } catch (error) {
    console.error('[In-Workout Coach] Spine generation failed:', error);
    return {
      spine: generateFallbackSpine(input),
      generated: false,
    };
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function buildWhisperContext(input: Parameters<typeof generateExerciseWhisper>[0]): string {
  const { exerciseName, setsCompletedToday, lastSessionData, todayData, units } = input;
  
  const parts: string[] = [`Exercise: ${exerciseName}`, `Completed: ${setsCompletedToday} sets today`];
  
  if (lastSessionData) {
    parts.push(`Last session: ${lastSessionData.avgWeight.toFixed(1)}${units} × ${lastSessionData.avgReps} @ RPE ${lastSessionData.avgRpe.toFixed(1)}`);
  }
  
  if (todayData) {
    parts.push(`Today so far: ${todayData.avgWeight.toFixed(1)}${units} × ${todayData.avgReps} @ RPE ${todayData.avgRpe.toFixed(1)}`);
  }
  
  return parts.join('\n');
}

function buildSpineContext(input: Parameters<typeof generateSessionSpine>[0]): string {
  const parts: string[] = [];
  
  if (input.workoutType) {
    parts.push(`Type: ${input.workoutType}`);
  }
  
  if (input.weekInMeso && input.totalWeeks) {
    parts.push(`Week ${input.weekInMeso}/${input.totalWeeks}`);
  }
  
  if (input.injuries && input.injuries.length > 0) {
    const injuryList = input.injuries.map(i => `${i.area} (severity ${i.severity})`).join(', ');
    parts.push(`Injuries: ${injuryList}`);
  }
  
  const exerciseSummary = input.exercises.slice(0, 6).map(e => `${e.name} (${e.sets} sets)`).join(', ');
  parts.push(`Exercises: ${exerciseSummary}${input.exercises.length > 6 ? ` +${input.exercises.length - 6} more` : ''}`);
  
  return parts.join('\n');
}

function parseSpineResponse(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, ''));
  
  return lines.slice(0, 5);
}

function generateFallbackWhisper(input: Parameters<typeof generateExerciseWhisper>[0]): string {
  const { exerciseName, lastSessionData, todayData, units } = input;
  
  if (lastSessionData && todayData) {
    const weightDelta = todayData.avgWeight - lastSessionData.avgWeight;
    if (Math.abs(weightDelta) > 2) {
      return weightDelta > 0 
        ? `Up ${Math.abs(weightDelta).toFixed(1)}${units} from last time — nice progression`
        : `Down ${Math.abs(weightDelta).toFixed(1)}${units} from last session`;
    }
    
    const repDelta = todayData.avgReps - lastSessionData.avgReps;
    if (Math.abs(repDelta) >= 2) {
      return repDelta > 0
        ? `${Math.abs(repDelta)} more reps than last time — keep it up`
        : `${Math.abs(repDelta)} fewer reps than last session`;
    }
  }
  
  return `Focus on controlled reps and good form`;
}

function generateFallbackRestTip(input: Parameters<typeof generateRestTip>[0]): string {
  const tips = [
    'Take deep breaths and visualize the movement',
    'Brace your core before each rep',
    'Focus on controlled negatives',
    'Stay present — one rep at a time',
    'Keep tension through the full range',
  ];
  
  return tips[Math.floor(Math.random() * tips.length)];
}

function generateFallbackSpine(input: Parameters<typeof generateSessionSpine>[0]): string[] {
  const spine: string[] = [];
  
  if (input.injuries && input.injuries.length > 0) {
    spine.push(`Work around ${input.injuries.map(i => i.area.replace('_', ' ')).join(' and ')} safely`);
  }
  
  const compounds = input.exercises.filter(e => e.sets >= 3);
  if (compounds.length > 0) {
    spine.push(`Hit your compounds first: ${compounds.slice(0, 2).map(e => e.name).join(', ')}`);
  }
  
  if (input.weekInMeso && input.totalWeeks) {
    if (input.weekInMeso <= 2) {
      spine.push('Establish working weights with good form');
    } else if (input.weekInMeso >= input.totalWeeks - 1) {
      spine.push('Final push — bring intensity on top sets');
    } else {
      spine.push('Build volume while maintaining RPE 7-9');
    }
  }
  
  const muscles = Array.from(new Set(input.exercises.map(e => e.primaryMuscle)));
  if (muscles.length > 0) {
    spine.push(`Target muscles: ${muscles.slice(0, 3).join(', ')}`);
  }
  
  spine.push('Log RPE honestly for accurate progression');
  
  return spine.slice(0, 5);
}

/**
 * Generate post-workout reel - summary of the session with key highlights
 */
export async function generatePostWorkoutReel(input: {
  totalSets: number;
  totalVolume: number; // in display units
  units: 'kg' | 'lb';
  durationMinutes: number;
  exercises: Array<{
    name: string;
    sets: number;
    isPR?: boolean;
    vsLastSession?: {
      weightDelta: number;
      repDelta: number;
    };
  }>;
  fatigueSignals?: Array<{
    exerciseName: string;
    signal: string;
  }>;
}): Promise<{ bullets: string[]; generated: boolean }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      bullets: generateFallbackReel(input),
      generated: false,
    };
  }

  try {
    const openai = await getXaiClient();

    const context = buildReelContext(input);
    
    const response = await openai.chat.completions.create({
      model: 'grok-4.6',
      max_tokens: 200,
      temperature: 0.7,
      messages: [
        { 
          role: 'system', 
          content: `You are a concise strength coach summarizing a completed workout. Provide exactly 3 short bullet points highlighting the most important aspects: volume/PRs/progression vs last time, and notable fatigue signals if any. Each bullet should be one short sentence (max 15 words). Be specific with numbers.` 
        },
        { role: 'user', content: `Summarize this workout in 3 bullets:\n\n${context}` },
      ],
    });

    const rawReel = response.choices[0]?.message?.content?.trim() || '';
    const bullets = parseReelResponse(rawReel);

    return {
      bullets: bullets.length > 0 ? bullets : generateFallbackReel(input),
      generated: true,
    };
  } catch (error) {
    console.error('[Post-Workout Reel] Generation failed:', error);
    return {
      bullets: generateFallbackReel(input),
      generated: false,
    };
  }
}

function buildReelContext(input: Parameters<typeof generatePostWorkoutReel>[0]): string {
  const parts: string[] = [
    `Duration: ${input.durationMinutes} minutes`,
    `Total: ${input.totalSets} sets, ${input.totalVolume.toFixed(0)}${input.units} volume`,
  ];

  const prs = input.exercises.filter(e => e.isPR);
  if (prs.length > 0) {
    parts.push(`PRs: ${prs.map(e => e.name).join(', ')}`);
  }

  const progressions = input.exercises.filter(e => e.vsLastSession && 
    (Math.abs(e.vsLastSession.weightDelta) >= 2.5 || Math.abs(e.vsLastSession.repDelta) >= 2));
  if (progressions.length > 0) {
    const examples = progressions.slice(0, 2).map(e => {
      const vs = e.vsLastSession!;
      if (Math.abs(vs.weightDelta) >= 2.5) {
        return `${e.name}: ${vs.weightDelta > 0 ? '+' : ''}${vs.weightDelta.toFixed(1)}${input.units}`;
      }
      return `${e.name}: ${vs.repDelta > 0 ? '+' : ''}${vs.repDelta} reps`;
    }).join(', ');
    parts.push(`Progression: ${examples}`);
  }

  if (input.fatigueSignals && input.fatigueSignals.length > 0) {
    const signals = input.fatigueSignals.slice(0, 2).map(s => `${s.exerciseName}: ${s.signal}`).join('; ');
    parts.push(`Fatigue signals: ${signals}`);
  }

  return parts.join('\n');
}

function parseReelResponse(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, ''));
  
  return lines.slice(0, 3);
}

function generateFallbackReel(input: Parameters<typeof generatePostWorkoutReel>[0]): string[] {
  const bullets: string[] = [];

  // Bullet 1: Volume summary
  bullets.push(`${input.totalSets} sets, ${input.totalVolume.toFixed(0)}${input.units} volume in ${input.durationMinutes} minutes`);

  // Bullet 2: PRs or progression
  const prs = input.exercises.filter(e => e.isPR);
  if (prs.length > 0) {
    bullets.push(`New PR${prs.length > 1 ? 's' : ''}: ${prs.map(e => e.name).join(', ')}`);
  } else {
    const progressions = input.exercises.filter(e => e.vsLastSession && 
      (Math.abs(e.vsLastSession.weightDelta) >= 2.5 || Math.abs(e.vsLastSession.repDelta) >= 2));
    if (progressions.length > 0) {
      const first = progressions[0];
      const vs = first.vsLastSession!;
      if (Math.abs(vs.weightDelta) >= 2.5) {
        bullets.push(`${first.name}: ${vs.weightDelta > 0 ? '+' : ''}${vs.weightDelta.toFixed(1)}${input.units} vs last time`);
      } else {
        bullets.push(`${first.name}: ${vs.repDelta > 0 ? '+' : ''}${vs.repDelta} reps vs last time`);
      }
    } else {
      bullets.push(`${input.exercises.length} exercises trained across ${input.totalSets} sets`);
    }
  }

  // Bullet 3: Fatigue signals or completion note
  if (input.fatigueSignals && input.fatigueSignals.length > 0) {
    const signal = input.fatigueSignals[0];
    bullets.push(`${signal.exerciseName}: ${signal.signal}`);
  } else {
    bullets.push('All sets completed — good session');
  }

  return bullets;
}
