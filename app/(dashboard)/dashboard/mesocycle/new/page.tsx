'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BUILDER_INPUTS_QUERY_KEY, fetchBuilderInputs } from '@/lib/training/fetchBuilderInputs';
import { invalidatePlannedFrequency } from '@/hooks/usePlannedFrequency';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Slider, Badge, Toggle } from '@/components/ui';
import { FirstTimeHint, InlineHint } from '@/components/ui/FirstTimeHint';
import { ContextCard } from '@/components/onboarding/ContextCard';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useSubscription } from '@/hooks/useSubscription';
import { useEducationStore } from '@/hooks/useEducationPreferences';
import { UpgradePrompt } from '@/components/subscription';
import { formatWeight, getLocalDateString, muscleDisplayName } from '@/lib/utils';
import { describeSupabaseError } from '@/lib/errors';
import { describeMesocycleInsertFailure } from '../_lib/mesocycleErrors';
import { createMesocycle } from '@/lib/training/createMesocycle';
import type { Goal, Experience, DexaScan, Equipment, MuscleGroup, Rating, ExtendedUserProfile, FullProgramRecommendation, DexaRegionalData, WorkoutDay, Split } from '@/types/schema';
import { TrainingScheduleSelector, MesocycleLengthGuidance } from '@/components/mesocycle';
import {
  buildTrainingSchedule,
  describeTrainingSchedule,
  intervalDaysPerWeek,
  type ScheduleMode,
} from '@/lib/training/trainingSchedule';
import {
  generateMesocycleRecommendation,
  generateWorkoutTemplates,
  recommendSplit,
  calculateRecoveryFactors,
  effectiveTrainingAge,
  evaluateMesocycleLength,
  type MesocycleRecommendation,
  type WorkoutTemplate,
} from '@/services/mesocycleBuilder';
import { generateFullMesocycleWithFatigue, sessionSetCapacity } from '@/services/sessionBuilderWithFatigue';
import { MusclePrioritySettings } from '@/components/settings/MusclePrioritySettings';
import {
  builderDefaultsFromHistory,
  priorityVolumeAdjustments,
  plannedVolumeWithBands,
  deliveredSetsAtPeak,
  isUnderDelivered,
  isAtOrBelowMev,
  onceWeeklyCeilingMuscles,
  onceWeeklyCeilingNote,
  weekByWeekPlan,
  rampLine,
  rirLine,
  deloadSummary,
  formatRir,
  rampExplanation,
  recoveryVolumeExplanation,
  priorityLabel,
  headsOf,
  formatHeadSets,
  defaultSessionMinutes,
  sessionLengthOptions,
  onboardingScheduleDefaults,
  type OnboardingScheduleDefaults,
  type BuilderHistoryDefaults,
  type MusclePriorityRow,
} from '@/lib/training/builderDefaults';
import type { VolumeAdjustmentInput } from '@/services/mesocycleBuilder';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import { analyzeRegionalComposition } from '@/services/regionalAnalysis';
import { IconAlertTriangle, IconBolt, IconBulb, IconCalendar, IconGauge, IconHeartBroken, IconMoon, IconTrendingDown } from '@tabler/icons-react';

/** Days a split's rotation needs so no day is dropped (Bro Split: one per body part). */
const SPLIT_MIN_DAYS: Record<string, number> = { 'Bro Split': 5, 'Upper/Lower': 4 };

/** The generator's session-cap warning (sessionBuilderWithFatigue Step 8b);
 *  the review's volume card says it with the fix beside it, so the
 *  "Things to consider" list leaves it out. */
const CAP_WARNING = /-minute sessions hold fewer weekly sets/;

export default function NewMesocyclePage() {
  useDocumentTitle('New Mesocycle');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { preferences } = useUserPreferences();
  const { canAccess, isLoading: subLoading } = useSubscription();
  const showBeginnerTips = useEducationStore((state) => state.showBeginnerTips);

  const [step, setStep] = useState(1);
  const [isFirstMesocycle, setIsFirstMesocycle] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // User profile data
  const [userGoal, setUserGoal] = useState<Goal>('maintenance');
  const [userExperience, setUserExperience] = useState<Experience>('intermediate');
  const [latestDexa, setLatestDexa] = useState<DexaScan | null>(null);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  
  // Extended profile data
  const [userAge, setUserAge] = useState<number>(30);
  const [sleepQuality, setSleepQuality] = useState<Rating>(3);
  const [stressLevel, setStressLevel] = useState<Rating>(3);
  // users.training_age as stored (0 / null = never set); the planners use
  // effectiveTrainingAge, which falls back to the experience level.
  const [storedTrainingAge, setStoredTrainingAge] = useState<number | null>(null);
  const [enhancedAthleteMode, setEnhancedAthleteMode] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight']);
  const [injuryHistory, setInjuryHistory] = useState<MuscleGroup[]>([]);
  const [unavailableEquipmentIds, setUnavailableEquipmentIds] = useState<string[]>([]);
  
  // Form state
  const [name, setName] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  // Two-a-day training: 2 sessions on every training day (fixed-day mode).
  const [sessionsPerDay, setSessionsPerDay] = useState(1);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(60);
  // Once the lifter moves the length, the loaded default stops overwriting it.
  const sessionLengthTouchedRef = useRef(false);
  const chooseSessionLength = (minutes: number) => {
    sessionLengthTouchedRef.current = true;
    setSessionDurationMinutes(minutes);
  };
  const [userId, setUserId] = useState<string | null>(null);
  // Settings → Muscle priorities, editable from the review step.
  const [showPriorityEditor, setShowPriorityEditor] = useState(false);
  /** Saved priorities (from either editor) → this plan's volume adjustments. */
  const applySavedPriorities = (saved: { muscleGroup: string; priority: number }[]) =>
    setPriorityAdjustments(
      priorityVolumeAdjustments(
        saved
          .filter((p) => p.priority !== 3)
          .map((p) => ({ muscle_group: p.muscleGroup, priority: p.priority }) as MusclePriorityRow)
      )
    );
  // Week table: groups whose heads (side delts…) are listed under them.
  const [showAllHeads, setShowAllHeads] = useState(false);
  const [useAiRecommendation, setUseAiRecommendation] = useState(true);
  
  // AI recommendations
  const [recommendation, setRecommendation] = useState<MesocycleRecommendation | null>(null);
  const [workoutTemplates, setWorkoutTemplates] = useState<WorkoutTemplate[]>([]);
  const [fullProgram, setFullProgram] = useState<FullProgramRecommendation | null>(null);
  
  // Manual overrides
  const [splitType, setSplitType] = useState('Upper/Lower');
  // Once the lifter picks a split, recommendations stop overwriting it.
  const [splitTouched, setSplitTouched] = useState(false);
  const [totalWeeks, setTotalWeeks] = useState(6);
  // What the lifter has been doing (prefills the schedule) and Settings →
  // Muscle priorities (feed the volume step) — lib/training/builderDefaults.
  const [historyDefaults, setHistoryDefaults] = useState<BuilderHistoryDefaults | null>(null);
  const [priorityAdjustments, setPriorityAdjustments] = useState<VolumeAdjustmentInput[]>([]);
  // Onboarding answers (users.preferences trainingDaysPerWeek / currentSplit):
  // the fallback when there is too little history to read a schedule from.
  const [onboardingDefaults, setOnboardingDefaults] = useState<OnboardingScheduleDefaults | null>(null);
  const historyUsable = historyDefaults?.daysPerWeek != null;
  /** The builder split matching recent training, if it reads as one; else
   *  the split the lifter named at onboarding. */
  const historySplit: Split | null = historyUsable
    ? historyDefaults?.splitKind === 'body_part' ? 'Bro Split' : historyDefaults?.splitKind === 'ppl' ? 'PPL' : null
    : onboardingDefaults?.split ?? null;

  // Preferred workout days
  const [preferredWorkoutDays, setPreferredWorkoutDays] = useState<WorkoutDay[]>([
    'Monday', 'Tuesday', 'Thursday', 'Friday'
  ]);

  // Schedule shape. 'interval' trains every N days from the start date — an
  // "every other day" cadence, which no fixed set of weekdays can express.
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('fixed_days');
  const [trainingIntervalDays, setTrainingIntervalDays] = useState(2);

  // The block starts today, so that is what an interval schedule counts from.
  const scheduleAnchorDate = getLocalDateString();

  // True cadence of an interval schedule: every other day is 3.5/week, not 4.
  const intervalSessionsPerWeek = (7 / trainingIntervalDays).toFixed(1).replace(/\.0$/, '');

  // Two-a-day only combines with fixed weekdays; an interval cadence stays 1/day.
  const effectiveSessionsPerDay = scheduleMode === 'fixed_days' ? sessionsPerDay : 1;

  // What the program/progression math plans in: SESSIONS per week. days_per_week
  // stores this number (the same convention interval mode already uses), so a
  // 7-day two-a-day plan is 14. The slider keeps counting calendar days.
  const plannedSessionsPerWeek = daysPerWeek * effectiveSessionsPerDay;

  // Interval cadences aren't whole sessions per week (every other day is 3.5),
  // but the program/progression math plans in whole sessions — keep
  // daysPerWeek pinned to the nearest whole number so every downstream
  // calculation (volume, split choice, time budget) stays consistent.
  const handleScheduleModeChange = (mode: ScheduleMode) => {
    setScheduleMode(mode);
    if (mode === 'interval') setDaysPerWeek(intervalDaysPerWeek(trainingIntervalDays));
  };

  const handleTrainingIntervalChange = (intervalDays: number) => {
    setTrainingIntervalDays(intervalDays);
    setDaysPerWeek(intervalDaysPerWeek(intervalDays));
  };

  const scheduleSummary = describeTrainingSchedule(
    buildTrainingSchedule({
      days_per_week: plannedSessionsPerWeek,
      sessions_per_day: effectiveSessionsPerDay,
      preferred_workout_days: preferredWorkoutDays,
      schedule_mode: scheduleMode,
      training_interval_days: trainingIntervalDays,
      start_date: scheduleAnchorDate,
    }),
    { short: true }
  );

  // Get default workout days based on frequency
  const getDefaultWorkoutDays = (days: number): WorkoutDay[] => {
    const patterns: Record<number, WorkoutDay[]> = {
      2: ['Monday', 'Thursday'],
      3: ['Monday', 'Wednesday', 'Friday'],
      4: ['Monday', 'Tuesday', 'Thursday', 'Friday'],
      5: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      6: ['Monday', 'Tuesday', 'Wednesday', 'Friday', 'Saturday', 'Sunday'],
      7: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    };
    return patterns[days] || patterns[4];
  };

  // Update preferred days when daysPerWeek changes
  // Uses getDefaultWorkoutDays() which provides optimal rest day patterns:
  // - 4 days: Mon/Tue/Thu/Fri (Wednesday rest)
  // - 6 days: Mon/Tue/Wed/Fri/Sat/Sun (Thursday rest)
  useEffect(() => {
    const defaultDays = getDefaultWorkoutDays(daysPerWeek);
    setPreferredWorkoutDays(defaultDays);
  }, [daysPerWeek]);

  // Calculate estimated exercises based on time (proper estimation with rest periods)
  const getExerciseEstimate = (minutes: number) => {
    // Time per exercise calculation:
    // Compound: 3 sets × (50s work + 150s rest avg) + 4min warmup + 1min transition ≈ 15 min
    // Isolation: 3 sets × (35s work + 75s rest avg) + 1min transition ≈ 6.5 min
    // Average exercise (50/50 mix): ~10-11 min
    
    const compoundWithWarmup = 15; // minutes
    const compoundNoWarmup = 11;
    const isolation = 6.5;
    
    // Assume 50% compounds, 50% isolations, 1 warmup per 3 exercises
    const avgCompoundTime = (compoundWithWarmup + compoundNoWarmup * 2) / 3;
    const avgExerciseTime = avgCompoundTime * 0.5 + isolation * 0.5;
    
    const maxExercises = Math.floor(minutes / avgExerciseTime);
    
    // Provide a range (+/- 1)
    return { 
      min: Math.max(1, maxExercises - 1), 
      max: Math.max(2, maxExercises + 1) 
    };
  };
  
  const exerciseEstimate = getExerciseEstimate(sessionDurationMinutes);

  // Optimal session duration based on weekly SESSION count (two-a-day counts both)
  const getOptimalSessionTime = (sessions: number): { min: number; optimal: number; max: number; quickMin: number; reason: string } => {
    switch (sessions) {
      case 2:
        return { min: 60, optimal: 75, max: 90, quickMin: 30, reason: 'Full body 2x/week needs longer sessions to hit all muscle groups' };
      case 3:
        return { min: 50, optimal: 60, max: 75, quickMin: 25, reason: 'Full body or PPL works well with moderate session length' };
      case 4:
        return { min: 45, optimal: 55, max: 70, quickMin: 20, reason: 'Upper/Lower split allows focused training per session' };
      case 5:
        return { min: 40, optimal: 50, max: 65, quickMin: 15, reason: 'Higher frequency allows shorter, more focused sessions' };
      case 6:
        return { min: 35, optimal: 45, max: 60, quickMin: 15, reason: 'PPL 2x/week - keep sessions efficient to manage recovery' };
      case 7:
        return { min: 30, optimal: 45, max: 60, quickMin: 15, reason: 'Daily training - keep sessions moderate so recovery keeps up' };
      default:
        if (sessions > 7) {
          return { min: 25, optimal: 40, max: 50, quickMin: 15, reason: 'Two-a-day training - split the volume into short, focused sessions to stay recoverable' };
        }
        return { min: 45, optimal: 60, max: 75, quickMin: 20, reason: 'Standard recommendation' };
    }
  };

  // Assess total weekly volume
  const assessWeeklyVolume = (days: number, minutesPerSession: number) => {
    const totalMinutes = days * minutesPerSession;
    const totalHours = totalMinutes / 60;
    
    // Adjusted ranges - recognize that even minimal training has benefits
    const quickWorkout = 1.5; // hours/week - "quick workout" threshold
    const minEffective = 2.5; // hours/week - minimum for solid results
    const optimalMin = 4;
    const optimalMax = 6;
    const maxRecoverable = 8;
    
    let status: 'quick' | 'minimal' | 'low' | 'optimal' | 'high' | 'too_high';
    let message: string;
    let color: string;
    
    if (totalHours < quickWorkout) {
      status = 'quick';
      message = `${totalHours.toFixed(1)} hrs/week is a "quick workout" schedule. We'll maximize efficiency with S-tier exercises only.`;
      color = 'text-action';
    } else if (totalHours < minEffective) {
      status = 'minimal';
      message = `${totalHours.toFixed(1)} hrs/week is minimal but effective. Focus on the highest-impact exercises.`;
      color = 'text-status-warn';
    } else if (totalHours < optimalMin) {
      status = 'low';
      message = `${totalHours.toFixed(1)} hrs/week is moderate. You'll make solid progress with focused effort.`;
      color = 'text-ink-2';
    } else if (totalHours <= optimalMax) {
      status = 'optimal';
      message = `${totalHours.toFixed(1)} hrs/week is in the optimal range for hypertrophy!`;
      color = 'text-status-ok';
    } else if (totalHours <= maxRecoverable) {
      status = 'high';
      message = `${totalHours.toFixed(1)} hrs/week is high volume. Make sure nutrition and sleep support this.`;
      color = 'text-status-warn';
    } else {
      status = 'too_high';
      message = `${totalHours.toFixed(1)} hrs/week exceeds typical recovery capacity. Consider reducing.`;
      color = 'text-status-bad';
    }
    
    return { status, message, color, totalHours, optimalMin, optimalMax };
  };

  const optimalTime = getOptimalSessionTime(plannedSessionsPerWeek);
  const volumeAssessment = assessWeeklyVolume(plannedSessionsPerWeek, sessionDurationMinutes);

  // Builder inputs (lib/training/fetchBuilderInputs): one parallel batch,
  // cached for the session so coming back to the builder is instant. They
  // seed the form ONCE per visit — a background refetch must never overwrite
  // what the lifter has already changed.
  const inputsQuery = useQuery({
    queryKey: BUILDER_INPUTS_QUERY_KEY,
    queryFn: fetchBuilderInputs,
    staleTime: 60 * 1000,
  });
  const appliedInputsRef = useRef(false);
  useEffect(() => {
    const inputs = inputsQuery.data;
    if (!inputs || appliedInputsRef.current) return;
    appliedInputsRef.current = true;
    // All in one synchronous pass, so React batches it into ONE render — the
    // program generator below re-runs on every input change, and the old
    // serial fetch-then-set sequence ran it once per round trip.
    const { profile, latestDexa: scan } = inputs;
    setUserId(inputs.userId);
    if (profile) {
      setEnhancedAthleteMode(profile.enhanced_athlete_mode === true);
      setUserGoal((profile.goal as Goal) || 'maintenance');
      setUserExperience((profile.experience as Experience) || 'intermediate');
      setHeightCm(profile.height_cm);
      if (profile.age) setUserAge(profile.age);
      if (profile.sleep_quality) setSleepQuality(profile.sleep_quality as Rating);
      if (profile.stress_level) setStressLevel(profile.stress_level as Rating);
      if (profile.training_age !== null && profile.training_age !== undefined) setStoredTrainingAge(Number(profile.training_age));
      if (profile.available_equipment && Array.isArray(profile.available_equipment)) {
        setAvailableEquipment(profile.available_equipment as Equipment[]);
      }
      if (profile.injury_history && Array.isArray(profile.injury_history)) {
        setInjuryHistory(profile.injury_history as MuscleGroup[]);
      }
    }
    if (scan) {
      setLatestDexa({
        id: scan.id,
        userId: scan.user_id,
        scanDate: scan.scan_date,
        weightKg: scan.weight_kg,
        leanMassKg: scan.lean_mass_kg,
        fatMassKg: scan.fat_mass_kg,
        bodyFatPercent: scan.body_fat_percent,
        boneMassKg: scan.bone_mass_kg ?? undefined,
        regionalData: (scan.regional_data as DexaScan['regionalData']) || null,
        notes: scan.notes,
        createdAt: scan.created_at,
      } as DexaScan);
    }
    setUnavailableEquipmentIds(inputs.unavailableEquipmentIds);
    setIsFirstMesocycle(inputs.isFirstMesocycle);
    // Session length: the last block's, else by experience
    // (lib/training/builderDefaults defaultSessionMinutes).
    const loadedDefault = defaultSessionMinutes(
      ((profile?.experience as Experience | undefined) ?? 'intermediate'),
      inputs.lastSessionMinutes
    );
    setSessionDurationMinutes((current) => (sessionLengthTouchedRef.current ? current : loadedDefault));
    // Muscle priorities from Settings — the generator never saw them.
    setPriorityAdjustments(priorityVolumeAdjustments(inputs.priorityRows));
    // Recent training → schedule defaults (sessions a week, split).
    const defaults = builderDefaultsFromHistory(inputs.recentSessions, inputs.historySpanDays);
    setHistoryDefaults(defaults);
    const fromOnboarding = onboardingScheduleDefaults(profile?.preferences);
    setOnboardingDefaults(fromOnboarding);
    const days = defaults.daysPerWeek ?? fromOnboarding.daysPerWeek;
    if (days) setDaysPerWeek(days);
  }, [inputsQuery.data]);

  const trainingAge = effectiveTrainingAge(storedTrainingAge, userExperience);
  const trainingAgeAssumed = !(storedTrainingAge !== null && storedTrainingAge > 0);

  // Lagging areas from the latest DEXA's regional data (when there is one).
  const laggingAreas = useMemo(() => {
    if (!latestDexa?.regionalData || !latestDexa.leanMassKg) return [] as string[];
    return analyzeRegionalComposition(latestDexa.regionalData as DexaRegionalData, latestDexa.leanMassKg).laggingAreas;
  }, [latestDexa]);

  // Build extended profile for full program generation
  const extendedProfile: ExtendedUserProfile = {
    age: userAge,
    experience: userExperience,
    goal: userGoal,
    sleepQuality,
    stressLevel,
    availableEquipment,
    injuryHistory,
    trainingAge,
    heightCm,
    latestDexa,
    enhancedAthleteMode,
  };
  // Building the plan at another session length (the review's "try 75 min").
  const buildProgramAt = (minutes: number) =>
    generateFullMesocycleWithFatigue(plannedSessionsPerWeek, extendedProfile, minutes, laggingAreas, unavailableEquipmentIds, effectiveSessionsPerDay, totalWeeks, priorityAdjustments, splitType as Split);

  // Calculate recovery factors for display
  const recoveryFactors = calculateRecoveryFactors(extendedProfile);

  // Evaluate mesocycle length selection and provide guidance
  const mesocycleLengthGuidance = useMemo(() => {
    return evaluateMesocycleLength(totalWeeks, userGoal, userExperience, recoveryFactors);
  }, [totalWeeks, userGoal, userExperience, recoveryFactors]);

  // Generate recommendations when days change
  useEffect(() => {
    if (useAiRecommendation) {
      // Generate legacy recommendation for backwards compatibility
      const rec = generateMesocycleRecommendation(
        { goal: userGoal, experience: userExperience, heightCm, latestDexa },
        plannedSessionsPerWeek
      );
      setRecommendation(rec);
      // The split in use: the lifter's pick, else the one their recent
      // training shows, else the recommendation. The preview below and the
      // generated plan both follow it.
      const activeSplit = (splitTouched ? splitType : historySplit ?? rec.splitType) as Split;
      if (!splitTouched) setSplitType(activeSplit);
      // Enhanced athletes default to one extra accumulation week before
      // deload (suggested default only — the user can still change it).
      // Default inside the range the length guidance below recommends (it
      // counts the recovery profile's deload rhythm); defaulting to 8 weeks
      // and then warning "8 weeks is on the longer side" contradicted itself.
      const suggested = Math.min(8, rec.totalWeeks + (enhancedAthleteMode ? 1 : 0));
      const range = evaluateMesocycleLength(suggested, userGoal, userExperience, calculateRecoveryFactors(extendedProfile)).recommendedRange;
      setTotalWeeks(Math.min(range.max, Math.max(range.min, suggested)));
      
      // Generate workout templates
      const templates = generateWorkoutTemplates(
        activeSplit,
        rec.volumePerMuscle,
        latestDexa?.leanMassKg || null,
        userExperience
      );
      setWorkoutTemplates(templates);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysPerWeek, plannedSessionsPerWeek, effectiveSessionsPerDay, userGoal, userExperience, heightCm, latestDexa, useAiRecommendation,
      userAge, sleepQuality, stressLevel, trainingAge, availableEquipment, injuryHistory, sessionDurationMinutes, unavailableEquipmentIds, enhancedAthleteMode, splitTouched, historySplit, splitType]);

  // Generate the full program. Kept separate from the effect above because it
  // also depends on the chosen block length: that effect RESETS totalWeeks to
  // the recommended default, so it must not re-run when the slider moves.
  // The chosen length drives generation — the program has exactly totalWeeks
  // weeks and its last one is the deload this page promises.
  useEffect(() => {
    if (useAiRecommendation) {
      // Uses the full-featured generator with fatigue tracking, SFR, and mesocycle weeks
      setFullProgram(buildProgramAt(sessionDurationMinutes));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysPerWeek, plannedSessionsPerWeek, effectiveSessionsPerDay, userGoal, userExperience, heightCm, latestDexa, useAiRecommendation,
      userAge, sleepQuality, stressLevel, trainingAge, availableEquipment, injuryHistory, sessionDurationMinutes, unavailableEquipmentIds, enhancedAthleteMode, totalWeeks, priorityAdjustments, splitType, laggingAreas]);

  // The generated plan read week by week: credited sets per muscle, volume
  // and load shares, RIR (lib/training/builderDefaults weekByWeekPlan).
  const planWeeks = useMemo(() => weekByWeekPlan(fullProgram), [fullProgram]);
  const deload = useMemo(() => deloadSummary(planWeeks), [planWeeks]);

  // Longer session lengths worth offering where the sessions cap muscles or
  // leave them at MEV, with what each changes (review step only: two extra
  // generations).
  const sessionOptions = useMemo(() => {
    if (step !== 3 || !fullProgram) return [];
    const delivered = deliveredSetsAtPeak(fullProgram);
    if (!delivered) return [];
    const rows = plannedVolumeWithBands(fullProgram.volumePerMuscle, { recoveryProfile: enhancedAthleteMode ? 'enhanced' : 'standard' });
    const caps = fullProgram.volumeCaps ?? {};
    const focus = rows.filter(
      (r) => caps[r.muscle as keyof typeof caps] || isUnderDelivered(r.sets, delivered[r.muscle]) || isAtOrBelowMev(delivered[r.muscle], r.mev)
    );
    return sessionLengthOptions(sessionDurationMinutes, focus, delivered, buildProgramAt);
  // buildProgramAt reads the same inputs that produced fullProgram.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fullProgram]);
  const deloadLine = deload
    ? `Week ${deload.weekNumber} is a deload: ${deload.volumePercent}% of the sets` +
      (deload.loadPercent !== null ? `, loads at ${deload.loadPercent}% intensity` : '') +
      (deload.rir ? `, ${formatRir(deload.rir)}` : '') +
      '.'
    : null;

  // Generate default name
  useEffect(() => {
    const goalNames: Record<string, string> = {
      bulk: 'Hypertrophy',
      cut: 'Cutting',
      maintenance: 'Training',
      recomp: 'Recomp'
    };
    setName(`${goalNames[userGoal] || 'Training'} Block - ${splitType}`);
  }, [userGoal, splitType]);

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be logged in');

      // Recovery factors feed the stored recovery_multiplier. The planners are
      // already pure and headless; only the WRITE needed extracting.
      const userProfile: ExtendedUserProfile = {
        age: userAge,
        experience: userExperience,
        goal: userGoal,
        sleepQuality,
        stressLevel,
        availableEquipment,
        injuryHistory,
        trainingAge,
        heightCm: heightCm || null,
        latestDexa: latestDexa || null,
        enhancedAthleteMode,
      };
      const recoveryFactors = calculateRecoveryFactors(userProfile);

      // Deactivating the previous block, reconciling total_weeks/deload_week
      // against the generated program, and the row shape all live in
      // lib/training/createMesocycle so a headless run creates an identical one.
      await createMesocycle(
        supabase,
        {
          userId: user.id,
          name,
          splitType: fullProgram?.split ?? splitType,
          // days_per_week counts SESSIONS per week (7 days x 2/day = 14).
          daysPerWeek: plannedSessionsPerWeek,
          sessionsPerDay: effectiveSessionsPerDay,
          totalWeeks,
          scheduleMode,
          trainingIntervalDays,
          preferredWorkoutDays,
          sessionDurationMinutes,
          fullProgram,
          recommendation,
          recoveryFactors,
          enhancedAthleteMode,
          startDate: scheduleAnchorDate,
        },
        { describeInsertFailure: describeMesocycleInsertFailure }
      );

      // A brand-new plan changes every muscle's planned weekly frequency, which
      // is the denominator for recovery session capacity. Drop the cached plan
      // so readiness and soreness learning don't normalize against the old one.
      invalidatePlannedFrequency(queryClient);
      // The next visit to the builder must see this block (first-block tips,
      // last session length), and Train must show the new plan.
      void queryClient.invalidateQueries({ queryKey: BUILDER_INPUTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['log'] });

      router.push('/dashboard/mesocycle');
    } catch (err) {
      // Supabase errors are plain objects, not Error instances — describe them
      // explicitly so the user (and we) see what the database actually said.
      console.error('Mesocycle creation failed', err);
      setError(describeSupabaseError(err, 'Failed to create mesocycle'));
      setIsLoading(false);
    }
  };

  const splitOptions = [
    { value: 'PPL', label: 'Push/Pull/Legs' },
    { value: 'Upper/Lower', label: 'Upper/Lower' },
    { value: 'Full Body', label: 'Full Body' },
    { value: 'Bro Split', label: 'Bro Split (5-day)' },
  ];

  // Check subscription access (must be after all hooks)
  if (!subLoading && !canAccess('mesocycleBuilder')) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-title font-bold text-ink">AI Mesocycle Builder</h1>
          <p className="text-ink-2 mt-1">Create scientifically-optimized training programs</p>
        </div>
        <UpgradePrompt feature="mesocycleBuilder" />
      </div>
    );
  }

  // Cold start only: the subscription isn't known yet, or the builder's
  // inputs haven't arrived (nothing cached). Show the builder's shape with a
  // visible label — not a lone "Loading your profile..." line, and not a
  // form of defaults that jumps when the profile lands. Units come from the
  // shared preferences store and never gate the page. A failed inputs read
  // falls through to the form on defaults, as before.
  if (subLoading || (inputsQuery.isPending && !inputsQuery.isError)) {
    return <BuilderSkeleton />;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-title font-bold text-ink">Create mesocycle</h1>
          <div className="group relative">
            <button className="w-5 h-5 rounded-full bg-sep hover:bg-sep text-ink-2 text-caption flex items-center justify-center">
              ?
            </button>
            <div className="absolute left-0 top-7 w-72 p-3 bg-fill border border-sep rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <p className="text-subhead font-medium text-ink mb-1">What is a Mesocycle?</p>
              <p className="text-caption text-ink-2">
                A <span className="text-action">mesocycle</span> is a training block lasting 4-8 weeks, designed to achieve specific goals. It includes progressive overload weeks followed by a deload week to manage fatigue and maximize adaptation.
              </p>
              <p className="text-caption text-ink-3 mt-2">
                Think of it as a &ldquo;chapter&rdquo; in your training story—focused, structured, and building toward the next phase.
              </p>
            </div>
          </div>
        </div>
        <p className="text-ink-2 mt-1">
          AI-assisted training plan based on your profile
        </p>
      </div>

      {/* Progress steps */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex-1 h-1 rounded-full transition-colors ${
              s <= step ? 'bg-action' : 'bg-sep'
            }`}
          />
        ))}
      </div>

      {/* First-time mesocycle creation hint */}
      {step === 1 && isFirstMesocycle && showBeginnerTips && userExperience !== 'advanced' && (
        <InlineHint id="first-mesocycle-intro">
          <div>
            <p className="font-medium mb-1">Creating your first training program!</p>
            <p className="text-subhead text-on-action dark:text-action">
              A mesocycle is a 4-8 week training block designed to progressively build your strength and muscle.
              We&apos;ll help you set up the perfect plan based on your goals and schedule.
            </p>
          </div>
        </InlineHint>
      )}

      {/* Step 1: Context Card */}
      {step === 1 && showBeginnerTips && (
        <ContextCard cardKey="mesocycleSchedule" variant="subtle" defaultCollapsed={!isFirstMesocycle} />
      )}

      {/* Your Profile Summary */}
      {step === 1 && (
        <Card className="border-action/30 bg-action/5">
          <CardHeader>
            <CardTitle className="text-subhead text-action">Your profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-subhead">
              <div>
                <p className="text-ink-3">Goal</p>
                <p className="font-medium text-ink capitalize">{userGoal}</p>
              </div>
              <div>
                <p className="text-ink-3">Experience</p>
                <p className="font-medium text-ink capitalize">{userExperience}</p>
              </div>
              {latestDexa && (
                <>
                  <div>
                    <p className="text-ink-3">Lean mass</p>
                    <p className="font-medium text-ink">
                      {formatWeight(latestDexa.leanMassKg, preferences.units)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-3">Body fat</p>
                    <p className="font-medium text-ink">{latestDexa.bodyFatPercent}%</p>
                  </div>
                </>
              )}
            </div>
            {!latestDexa && (
              <p className="text-caption text-ink-3 mt-3">
                Add a DEXA scan in Body Composition for personalized weight recommendations
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recovery Profile Summary */}
      {step === 1 && (
        <Card className="border-sep">
          <CardHeader>
            <CardTitle className="text-subhead text-ink-2">Recovery profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-subhead">
              <div>
                <p className="text-ink-3">Sleep</p>
                <p className="font-medium text-ink">
                  {sleepQuality}/5 {sleepQuality <= 2 ? '⚠' : sleepQuality >= 4 ? '✓' : ''}
                </p>
              </div>
              <div>
                <p className="text-ink-3">Stress</p>
                <p className="font-medium text-ink">
                  {stressLevel}/5 {stressLevel >= 4 ? '⚠' : stressLevel <= 2 ? '✓' : ''}
                </p>
              </div>
              <div>
                <p className="text-ink-3">Volume modifier</p>
                <p className={`font-medium ${recoveryFactors.volumeMultiplier < 0.9 ? 'text-status-warn' : 'text-status-ok'}`}>
                  {(recoveryFactors.volumeMultiplier * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-ink-3">Deload every</p>
                <p className="font-medium text-ink">{recoveryFactors.deloadFrequencyWeeks} weeks</p>
              </div>
            </div>
            <p className="text-caption text-ink-3 mt-3" data-testid="builder-training-age">
              Training age: {trainingAge} {trainingAge === 1 ? 'year' : 'years'}
              {trainingAgeAssumed ? ` (typical for ${userExperience}; set yours in Settings)` : ''}
            </p>
            {recoveryVolumeExplanation(recoveryFactors) && (
              <p className="text-caption text-ink-2 mt-1" data-testid="builder-volume-modifier-why">
                {recoveryVolumeExplanation(recoveryFactors)}
              </p>
            )}
            {recoveryFactors.warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {recoveryFactors.warnings.map((warning, i) => (
                  <p key={i} className="text-caption text-status-warn flex items-start gap-2">
                    <IconAlertTriangle className="h-4 w-4 flex-shrink-0" stroke={1.75} aria-hidden="true" />
                    <span>{warning}</span>
                  </p>
                ))}
              </div>
            )}
            <p className="text-caption text-ink-3 mt-3">
              Update your recovery profile in <a href="/dashboard/settings" className="text-action hover:underline">Settings</a>
            </p>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="p-4 bg-status-bad/10 border border-status-bad/20 rounded-lg text-status-bad text-subhead">
          {error}
        </div>
      )}

      {/* Step 1: Schedule */}
      {step === 1 && (
        <Card variant="elevated">
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-headline font-semibold text-ink">How often can you train?</h2>
              <p className="text-subhead text-ink-2">We&apos;ll recommend the best split for your schedule</p>
              {historyDefaults?.summary && (
                <p className="mt-1 text-subhead text-ink" data-testid="builder-history-summary">
                  {historyDefaults.summary} Days below start from that.
                </p>
              )}
            </div>

            {scheduleMode === 'fixed_days' ? (
              <>
                <Slider
                  label="Training days per week"
                  min={2}
                  max={7}
                  value={daysPerWeek}
                  onChange={(e) => setDaysPerWeek(parseInt(e.target.value))}
                  valueFormatter={(v) => `${v} days`}
                  marks={[
                    { value: 2, label: '2' },
                    { value: 3, label: '3' },
                    { value: 4, label: '4' },
                    { value: 5, label: '5' },
                    { value: 6, label: '6' },
                    { value: 7, label: '7' },
                  ]}
                />

                {/* Two-a-day sessions */}
                <div className="flex items-center justify-between p-3 bg-fill/30 rounded-lg">
                  <div>
                    <p className="font-medium text-ink">Train twice a day</p>
                    <p className="text-caption text-ink-3">
                      {sessionsPerDay === 2
                        ? `2 sessions on each training day — ${plannedSessionsPerWeek} sessions/week`
                        : 'Two shorter sessions on each training day (advanced)'}
                    </p>
                  </div>
                  <Toggle
                    checked={sessionsPerDay === 2}
                    onChange={(checked) => setSessionsPerDay(checked ? 2 : 1)}
                  />
                </div>

                {sessionsPerDay === 2 && (
                  <div className="p-3 bg-status-warn/10 border border-status-warn/20 rounded-lg">
                    <p className="text-caption text-status-warn">
                      Two-a-day training is demanding. The plan alternates the split across
                      both sessions (e.g. Push in the morning, Pull in the evening) — make sure
                      sleep and nutrition can support {plannedSessionsPerWeek} weekly sessions.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-subhead font-medium text-ink">Training days per week</span>
                <span className="text-subhead text-action font-medium">
                  ~{intervalSessionsPerWeek} days
                </span>
              </div>
            )}

            {/* Schedule shape: fixed weekdays, or an every-N-days cadence */}
            <div className="space-y-2">
              <label className="block text-subhead font-medium text-ink">
                When do you want to train?
              </label>
              <p className="text-caption text-ink-3">
                {scheduleMode === 'fixed_days'
                  ? `Pick ${daysPerWeek} days that work best for your schedule`
                  : 'Your training days roll through the week instead of repeating'}
              </p>
              <TrainingScheduleSelector
                daysPerWeek={daysPerWeek}
                mode={scheduleMode}
                onModeChange={handleScheduleModeChange}
                selectedDays={preferredWorkoutDays}
                onDaysChange={setPreferredWorkoutDays}
                intervalDays={trainingIntervalDays}
                onIntervalChange={handleTrainingIntervalChange}
                anchorDate={scheduleAnchorDate}
              />
            </div>

            <Slider
              label="Time per session"
              min={15}
              max={120}
              step={5}
              value={sessionDurationMinutes}
              onChange={(e) => chooseSessionLength(parseInt(e.target.value))}
              valueFormatter={(v) => `${v} min`}
              marks={[
                { value: 15, label: '15' },
                { value: 30, label: '30' },
                { value: 45, label: '45' },
                { value: 60, label: '60' },
                { value: 75, label: '75' },
                { value: 90, label: '90' },
                { value: 120, label: '120' },
              ]}
            />

            {/* Quick workout mode indicator */}
            {sessionDurationMinutes <= 25 && (
              <div className="p-3 bg-action/10 border border-action/20 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <IconBolt className="h-5 w-5 flex-shrink-0" stroke={1.75} aria-hidden="true" />
                  <span className="font-medium text-action">Quick workout mode</span>
                </div>
                <p className="text-caption text-ink-2">
                  Short on time? No problem! We&apos;ll prioritize the most effective exercises (S-tier) for maximum results. 
                  {sessionDurationMinutes <= 20 
                    ? ' Expect 2-3 exercises per session focusing on compounds.'
                    : ' Expect 3-4 exercises per session with compound focus.'}
                </p>
              </div>
            )}

            {/* Optimal session recommendation */}
            <div className="p-4 bg-fill/50 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-subhead font-medium text-ink-2">
                  Recommended for {plannedSessionsPerWeek} sessions/week:
                </span>
                <span className="text-subhead text-action font-medium">{optimalTime.optimal} min</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-sep rounded-full overflow-hidden">
                  {/* Optimal zone indicator */}
                  <div 
                    className="h-full bg-status-warn "
                    style={{
                      marginLeft: `${((optimalTime.min - 30) / 90) * 100}%`,
                      width: `${((optimalTime.max - optimalTime.min) / 90) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-caption text-ink-3">
                <span>30 min</span>
                <span className="text-status-ok">Optimal: {optimalTime.min}-{optimalTime.max} min</span>
                <span>120 min</span>
              </div>
              <p className="text-caption text-ink-2">{optimalTime.reason}</p>
              
              {/* Session time messaging */}
              {sessionDurationMinutes <= 25 && (
                <div className="flex items-start gap-2 p-2 bg-action/10 rounded text-action text-caption">
                  <IconBolt className="h-4 w-4 flex-shrink-0" stroke={1.75} aria-hidden="true" />
                  <span>Quick workout mode: We&apos;ll select only the highest-impact S-tier exercises to maximize your limited time.</span>
                </div>
              )}
              {sessionDurationMinutes > 25 && sessionDurationMinutes < optimalTime.min && (
                <div className="flex items-start gap-2 p-2 bg-fill rounded text-ink-2 text-caption">
                  <IconBulb className="h-4 w-4 flex-shrink-0" stroke={1.75} aria-hidden="true" />
                  <span>Shorter than optimal ({sessionDurationMinutes} vs {optimalTime.optimal} min), but totally workable. We&apos;ll prioritize the best exercises.</span>
                </div>
              )}
              {sessionDurationMinutes > optimalTime.max && (
                <div className="flex items-start gap-2 p-2 bg-status-warn/10 rounded text-status-warn text-caption">
                  <IconAlertTriangle className="h-4 w-4 flex-shrink-0" stroke={1.75} aria-hidden="true" />
                  <span>Long sessions ({sessionDurationMinutes} min) can impact recovery. Quality &gt; quantity!</span>
                </div>
              )}
            </div>

            {/* Weekly volume assessment */}
            <div className={`p-4 rounded-lg border ${
              volumeAssessment.status === 'optimal' 
                ? 'bg-status-ok/10 border-status-ok/20' 
                : volumeAssessment.status === 'quick'
                ? 'bg-action/10 border-action/20'
                : volumeAssessment.status === 'too_high'
                ? 'bg-status-bad/10 border-status-bad/20'
                : 'bg-status-warn/10 border-status-warn/20'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-subhead font-medium text-ink">Weekly training volume</span>
                <span className={`text-headline font-bold ${volumeAssessment.color}`}>
                  {volumeAssessment.totalHours.toFixed(1)} hrs
                </span>
              </div>
              
              {/* Volume bar */}
              <div className="relative h-3 bg-sep rounded-full overflow-hidden mb-2">
                {/* Optimal zone */}
                <div 
                  className="absolute h-full bg-status-ok/30"
                  style={{
                    left: `${(volumeAssessment.optimalMin / 10) * 100}%`,
                    width: `${((volumeAssessment.optimalMax - volumeAssessment.optimalMin) / 10) * 100}%`,
                  }}
                />
                {/* Current position */}
                <div 
                  className={`absolute h-full w-1 ${
                    volumeAssessment.status === 'optimal' ? 'bg-status-ok' : 'bg-status-warn'
                  }`}
                  style={{
                    left: `${Math.min((volumeAssessment.totalHours / 10) * 100, 100)}%`,
                  }}
                />
              </div>
              
              <div className="flex justify-between text-caption text-ink-3 mb-2">
                <span>0h</span>
                <span className="text-status-ok/70">Optimal: {volumeAssessment.optimalMin}-{volumeAssessment.optimalMax}h</span>
                <span>10h</span>
              </div>
              
              <p className={`text-caption ${volumeAssessment.color}`}>
                {volumeAssessment.status === 'optimal' ? '✓ ' : ''}
                {volumeAssessment.message}
              </p>
            </div>

            {/* Exercise count estimate */}
            <div className="p-3 bg-fill/30 rounded-lg">
              <div className="flex items-center gap-2 text-subhead">
                <svg className="w-4 h-4 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="text-ink-2">
                  Estimated{' '}
                  <span className="text-ink font-medium">{exerciseEstimate.min}-{exerciseEstimate.max} exercises</span>
                  {' '}per session
                </span>
              </div>
            </div>

            {/* AI Recommendation */}
            {fullProgram && (
              <div className="p-4 bg-fill/50 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className="font-medium text-ink">AI recommendation</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="info">{fullProgram.split}</Badge>
                  <span className="text-subhead text-ink-2">
                    {/* The reason must describe the split on the badge; the
                        older recommendation's text described its own pick
                        (a Bro Split badge with an Arnold-split blurb). */}
                    {fullProgram.split === recommendation?.splitType
                      ? recommendation?.splitReason
                      : historySplit === fullProgram.split
                        ? 'Matches your recent training.'
                        : 'Your choice of split.'}
                  </span>
                </div>
                {fullProgram.programNotes.length > 0 && (
                  <div className="pt-2 border-t border-sep space-y-1">
                    {fullProgram.programNotes.slice(0, 3).map((note, i) => (
                      <p key={i} className="text-caption text-ink-2">{note}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!fullProgram && recommendation && (
              <div className="p-4 bg-fill/50 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className="font-medium text-ink">AI recommendation</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="info">{recommendation.splitType}</Badge>
                  <span className="text-subhead text-ink-2">{recommendation.splitReason}</span>
                </div>
              </div>
            )}

            {/* Toggle for AI vs Manual */}
            <div className="flex items-center justify-between p-3 bg-fill/30 rounded-lg">
              <div>
                <p className="font-medium text-ink">Use AI recommendations</p>
                <p className="text-caption text-ink-3">Let us optimize your split and volume</p>
              </div>
              <Toggle
                checked={useAiRecommendation}
                onChange={setUseAiRecommendation}
              />
            </div>

            <div className="pt-4 flex justify-end">
              <Button onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 2: Context Card */}
      {step === 2 && showBeginnerTips && (
        <ContextCard cardKey="mesocycleCustomize" variant="subtle" defaultCollapsed={!isFirstMesocycle} />
      )}

      {/* Step 2: Customize */}
      {step === 2 && (
        <Card variant="elevated">
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-headline font-semibold text-ink">Customize your plan</h2>
              <p className="text-subhead text-ink-2">Fine-tune the AI recommendations</p>
            </div>

            {/* Priority muscles (Settings → Training → Muscle priorities) now
                feed the volume step; say which, or where to set them. */}
            <div className="rounded-lg bg-fill/50 p-3 text-subhead" data-testid="builder-priorities">
              {(() => {
                const up = priorityAdjustments.filter((a) => a.reason === 'user_priority');
                return up.length > 0 ? (
                  <p className="text-ink">
                    <span className="font-semibold">Priority muscles:</span>{' '}
                    {up.map((a) => priorityLabel(a)).join(', ')} get extra weekly sets (+10–20%; a single head
                    leads its group&apos;s exercise choice).
                  </p>
                ) : (
                  <p className="text-ink-2">
                    Bringing up a lagging muscle, or one head like side delts? Mark it high priority and this plan
                    gives it extra weekly sets.
                  </p>
                );
              })()}
              {/* Edit here, not via a trip to Settings that left the builder
                  (UX panel: "I can't prioritize lagging muscles"). Same
                  editor and table as Settings → Muscle priorities. */}
              {userId ? (
                <button
                  type="button"
                  className="mt-2 font-semibold text-action"
                  onClick={() => setShowPriorityEditor((v) => !v)}
                  aria-expanded={showPriorityEditor}
                  data-testid="builder-customize-priorities"
                >
                  {showPriorityEditor ? 'Done with priorities' : 'Prioritize muscles'}
                </button>
              ) : null}
              {showPriorityEditor && userId && (
                <div className="mt-3" data-testid="builder-customize-priority-editor">
                  <MusclePrioritySettings userId={userId} onSave={applySavedPriorities} />
                </div>
              )}
            </div>

            <Input
              label="Mesocycle name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Hypertrophy Block 1"
            />

            <Select
              label="Training split"
              value={splitType}
              onChange={(e) => {
                const next = e.target.value;
                setSplitType(next);
                setSplitTouched(true);
                // A body-part split is five days; squeezed into four, the
                // generator dropped a day (legs). Give it its days.
                const needs = SPLIT_MIN_DAYS[next] ?? 0;
                if (scheduleMode === 'fixed_days' && daysPerWeek < needs) setDaysPerWeek(needs);
              }}
              options={splitOptions}
              hint={
                splitTouched
                  ? SPLIT_MIN_DAYS[splitType] && daysPerWeek === SPLIT_MIN_DAYS[splitType] && splitType === 'Bro Split'
                    ? 'Set to 5 days — one per body part.'
                    : undefined
                  : historySplit && splitType === historySplit
                    ? 'Matches your recent training.'
                    : useAiRecommendation && recommendation
                      ? `Recommended for ${plannedSessionsPerWeek} sessions a week: ${recommendation.splitType}. Pick another if you prefer — the plan follows your choice.`
                      : undefined
              }
            />

            <Slider
              label="Mesocycle length"
              min={4}
              max={8}
              value={totalWeeks}
              onChange={(e) => setTotalWeeks(parseInt(e.target.value))}
              valueFormatter={(v) => `${v} weeks`}
              marks={[
                { value: 4, label: '4' },
                { value: 5, label: '5' },
                { value: 6, label: '6' },
                { value: 7, label: '7' },
                { value: 8, label: '8' },
              ]}
            />

            {/* Mesocycle length guidance */}
            <MesocycleLengthGuidance
              guidance={mesocycleLengthGuidance}
              onAcceptRecommendation={(weeks) => setTotalWeeks(weeks)}
            />

            <div className="p-4 bg-fill/50 rounded-lg">
              <p className="text-subhead text-ink-2" data-testid="builder-deload-line">
                {deloadLine ?? (
                  <>
                    <span className="text-ink-2 font-medium">Week {totalWeeks}</span> will automatically be a deload week with 50% reduced volume.
                  </>
                )}
              </p>
            </div>

            {/* AI Recommendations list */}
            {recommendation && recommendation.recommendations.length > 0 && (
              <div className="space-y-2">
                <p className="text-subhead font-medium text-ink-2">Coaching tips</p>
                {recommendation.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 text-subhead text-ink-2">
                    <svg className="w-4 h-4 text-action mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {rec}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <Card variant="elevated">
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-headline font-semibold text-ink">Review your plan</h2>
              <p className="text-subhead text-ink-2">Everything looks good?</p>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-sep">
                <span className="text-ink-2">Name</span>
                <span className="text-ink font-medium">{name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-sep">
                <span className="text-ink-2">Split</span>
                <span className="text-ink font-medium">{fullProgram?.split ?? splitType}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-sep">
                <span className="text-ink-2">Frequency</span>
                <span className="text-ink font-medium">
                  {scheduleMode === 'interval'
                    ? `~${intervalSessionsPerWeek} days/week`
                    : effectiveSessionsPerDay === 2
                    ? `${daysPerWeek} days × 2/day (${plannedSessionsPerWeek} sessions/week)`
                    : `${daysPerWeek} days/week`}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-sep">
                <span className="text-ink-2">Session length</span>
                <span className="text-ink font-medium">{sessionDurationMinutes} min ({exerciseEstimate.min}-{exerciseEstimate.max} exercises)</span>
              </div>
              <div className="flex justify-between py-2 border-b border-sep">
                <span className="text-ink-2">Duration</span>
                <span className="text-ink font-medium">{totalWeeks} weeks</span>
              </div>
              <div className="flex justify-between py-2 border-b border-sep">
                <span className="text-ink-2">Deload</span>
                <span className="text-ink font-medium">Week {totalWeeks}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-ink-2">Workout days</span>
                <span className="text-ink font-medium text-right">
                  {scheduleSummary}
                </span>
              </div>
            </div>

            {/* Weekly time commitment with status */}
            <div className={`p-3 rounded-lg border ${
              volumeAssessment.status === 'optimal'
                ? 'bg-status-ok/10 border-status-ok/20'
                : volumeAssessment.status === 'quick'
                ? 'bg-action/10 border-action/20'
                : volumeAssessment.status === 'too_high'
                ? 'bg-status-bad/10 border-status-bad/20'
                : 'bg-status-warn/10 border-status-warn/20'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-subhead font-medium text-ink-2">Weekly training time</span>
                <span className={`text-headline font-bold ${volumeAssessment.color}`}>
                  {volumeAssessment.totalHours.toFixed(1)} hours
                </span>
              </div>
              <p className={`text-caption mt-1 ${volumeAssessment.color}`}>
                {volumeAssessment.status === 'optimal' && '✓ '}
                {volumeAssessment.message}
              </p>
            </div>

            {/* Week-by-Week Preview - for beginners */}
            {showBeginnerTips && (
              <div className="p-4 bg-fill/50 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <IconCalendar className="h-5 w-5 flex-shrink-0" stroke={1.75} aria-hidden="true" />
                  <span className="font-medium text-ink">What each week looks like</span>
                </div>
                <div className="space-y-2">
                  {Array.from({ length: totalWeeks }, (_, i) => {
                    const weekNum = i + 1;
                    // The generated week's own numbers. (This used to draw a
                    // made-up 80% → 100% ramp no plan actually followed.)
                    const planned = planWeeks[i];
                    const isDeload = planned ? planned.isDeload : weekNum === totalWeeks;
                    const volumePercent = planned ? Math.round(planned.volumeModifier * 100) : isDeload ? 50 : 100;
                    const peakPercent = Math.max(100, ...planWeeks.map((w) => Math.round(w.volumeModifier * 100)));

                    return (
                      <div
                        key={weekNum}
                        className={`flex items-center gap-3 p-2 rounded ${
                          isDeload ? 'bg-status-warn/10 border border-status-warn/20' : 'bg-card/50'
                        }`}
                      >
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
                          isDeload ? 'bg-status-warn/20 text-status-warn' : 'bg-action/20 text-action'
                        }`}>
                          {weekNum}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-subhead ${isDeload ? 'text-status-warn' : 'text-ink-2'}`}>
                              {isDeload ? 'Deload week' : `Week ${weekNum}`}
                            </span>
                            <span className="text-caption text-ink-3">
                              {volumePercent}% volume{planned?.rir ? ` · ${formatRir(planned.rir)}` : ''}
                            </span>
                          </div>
                          <div className="h-1.5 bg-sep rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isDeload ? 'bg-status-warn' : 'bg-action'
                              }`}
                              style={{ width: `${Math.round((volumePercent / peakPercent) * 100)}%` }}
                            />
                          </div>
                        </div>
                        {isDeload && (
                          <span className="text-caption text-status-warn">Recovery</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-caption text-ink-3 mt-3">
                  {fullProgram && planWeeks.length > 0
                    ? rampExplanation(fullProgram.periodization.model, planWeeks)
                    : 'Volume gradually increases each week, then drops during deload for recovery and growth.'}
                </p>
              </div>
            )}

            {/* Science Behind Your Program - Collapsible */}
            <details className="group">
              <summary className="flex items-center justify-between p-4 bg-fill/50 rounded-lg cursor-pointer hover:bg-fill/70 transition-colors">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className="font-medium text-ink">Science behind your program</span>
                </div>
                <svg className="w-5 h-5 text-ink-2 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              
              <div className="mt-4 space-y-4">
                {/* Split Selection Logic */}
                <div className="p-4 bg-card/50 rounded-lg border border-sep">
                  <h4 className="font-medium text-ink flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-action/20 flex items-center justify-center text-caption text-action">1</span>
                    Why {splitType}?
                  </h4>
                  <p className="text-subhead text-ink-2 mb-3">
                    {splitType === 'Full Body'
                      ? `Full Body training ${plannedSessionsPerWeek}x/week allows you to train each muscle 2-3x per week for optimal protein synthesis and frequency. Each session hits all major muscle groups with moderate volume.`
                      : splitType === 'Upper/Lower'
                      ? `Upper/Lower splits hit each muscle group 2x/week with ${plannedSessionsPerWeek} weekly sessions. This provides excellent recovery (72+ hours between sessions) while maintaining high frequency for growth.`
                      : splitType === 'PPL'
                      ? `Push/Pull/Legs ${plannedSessionsPerWeek >= 6 ? '2x/week' : '1x/week'} allows higher volume per muscle group per session. Push days hit chest/shoulders/triceps, Pull days hit back/biceps, and Leg days cover the lower body.`
                      : splitType === 'Arnold'
                      ? `The Arnold split groups Chest/Back, Shoulders/Arms, and Legs for ${plannedSessionsPerWeek} weekly sessions. This classic approach allows high volume with antagonist supersets.`
                      : `The Bro Split dedicates entire sessions to single muscle groups, allowing maximum volume per muscle but lower frequency (1x/week per muscle).`
                    }
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-caption">
                    <div className="p-2 bg-fill rounded text-center">
                      <p className="text-ink-3">Frequency</p>
                      <p className="text-ink font-medium">
                        {splitType === 'Full Body' ? '2-3x'
                          : splitType === 'Upper/Lower' ? '2x'
                          : splitType === 'PPL' ? (plannedSessionsPerWeek >= 6 ? '2x' : '1x')
                          : splitType === 'Arnold' ? '2x'
                          : '1x'}/week per muscle
                      </p>
                    </div>
                    <div className="p-2 bg-fill rounded text-center">
                      <p className="text-ink-3">Recovery</p>
                      <p className="text-ink font-medium">
                        {splitType === 'Full Body' ? '48h'
                          : splitType === 'Upper/Lower' ? '72h'
                          : splitType === 'PPL' ? (plannedSessionsPerWeek >= 6 ? '72h' : '168h')
                          : splitType === 'Arnold' ? '72h'
                          : '168h'} between
                      </p>
                    </div>
                    <div className="p-2 bg-fill rounded text-center">
                      <p className="text-ink-3">Volume/Session</p>
                      <p className="text-ink font-medium">
                        {splitType === 'Full Body' ? 'Moderate' 
                          : splitType === 'Upper/Lower' ? 'Moderate' 
                          : splitType === 'Bro Split' ? 'Very High'
                          : 'High'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rep Range Science */}
                <div className="p-4 bg-card/50 rounded-lg border border-sep">
                  <h4 className="font-medium text-ink flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-action/20 flex items-center justify-center text-caption text-action">2</span>
                    Rep range science
                  </h4>
                  <p className="text-subhead text-ink-2 mb-3">
                    Rep ranges are optimized based on muscle fiber type dominance and exercise position in the workout.
                  </p>
                  <div className="space-y-2 text-subhead">
                    <div className="flex items-center justify-between p-2 bg-fill rounded">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-status-bad"></span>
                        <span className="text-ink-2">Fast-twitch dominant</span>
                        <span className="text-ink-3">(Hamstrings, Triceps)</span>
                      </div>
                      <span className="font-mono text-ink">4-8 reps</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-fill rounded">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-status-warn"></span>
                        <span className="text-ink-2">Mixed fiber type</span>
                        <span className="text-ink-3">(Chest, Back, Quads)</span>
                      </div>
                      <span className="font-mono text-ink">6-12 reps</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-fill rounded">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-status-ok"></span>
                        <span className="text-ink-2">Slow-twitch dominant</span>
                        <span className="text-ink-3">(Calves, Core, Delts)</span>
                      </div>
                      <span className="font-mono text-ink">10-20 reps</span>
                    </div>
                  </div>
                  <p className="text-caption text-ink-3 mt-3">
                    Compounds start sessions (heavier, 6-10 reps). Isolations finish (lighter, 10-15 reps) to maximize performance when fresh.
                  </p>
                </div>

                {/* Volume Logic */}
                <div className="p-4 bg-card/50 rounded-lg border border-sep">
                  <h4 className="font-medium text-ink flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-action/20 flex items-center justify-center text-caption text-action">3</span>
                    Volume recommendations
                  </h4>
                  <p className="text-subhead text-ink-2 mb-3">
                    Weekly sets per muscle are based on research-backed landmarks adjusted for your experience and recovery capacity.
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-caption mb-3">
                    <div className="p-2 bg-fill rounded text-center">
                      <p className="text-ink-3">MV (Minimum)</p>
                      <p className="text-ink font-medium">~6 sets/week</p>
                      <p className="text-ink-3">Maintain gains</p>
                    </div>
                    <div className="p-2 bg-status-ok/10 border border-status-ok/20 rounded text-center">
                      <p className="text-status-ok">MEV-MAV</p>
                      <p className="text-ink font-medium">10-20 sets/week</p>
                      <p className="text-ink-3">Optimal growth</p>
                    </div>
                    <div className="p-2 bg-fill rounded text-center">
                      <p className="text-ink-3">MRV (Maximum)</p>
                      <p className="text-ink font-medium">20+ sets/week</p>
                      <p className="text-ink-3">Risk of overtraining</p>
                    </div>
                  </div>
                  <p className="text-caption text-ink-3">
                    Your volume is modified by: Recovery capacity ({(recoveryFactors.volumeMultiplier * 100).toFixed(0)}%) • Experience ({userExperience}) • Goal ({userGoal})
                  </p>
                </div>

                {/* Fatigue Management */}
                <div className="p-4 bg-card/50 rounded-lg border border-sep">
                  <h4 className="font-medium text-ink flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-action/20 flex items-center justify-center text-caption text-action">4</span>
                    Fatigue management
                  </h4>
                  <p className="text-subhead text-ink-2 mb-3">
                    We track both systemic fatigue (CNS, whole-body) and local fatigue (per muscle group) to prevent overtraining.
                  </p>
                  <div className="space-y-2 text-subhead">
                    <div className="p-2 bg-fill rounded">
                      <div className="flex justify-between mb-1">
                        <span className="text-ink-2">Systemic fatigue budget</span>
                        <span className="text-ink">100 points/week</span>
                      </div>
                      <p className="text-caption text-ink-3">Compounds: 8-12 pts • Isolations: 3-5 pts • Depleted = auto-deload</p>
                    </div>
                    <div className="p-2 bg-fill rounded">
                      <div className="flex justify-between mb-1">
                        <span className="text-ink-2">Local muscle recovery</span>
                        <span className="text-ink">48-72 hours</span>
                      </div>
                      <p className="text-caption text-ink-3">We space exercises to allow full recovery before hitting the same muscle again</p>
                    </div>
                  </div>
                </div>

                {/* Periodization */}
                <div className="p-4 bg-card/50 rounded-lg border border-sep">
                  <h4 className="font-medium text-ink flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-action/20 flex items-center justify-center text-caption text-action">5</span>
                    Periodization model
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-subhead mb-3">
                    <div>
                      <p className="text-ink-3">Model</p>
                      <p className="text-ink capitalize">{fullProgram?.periodization.model.replace('_', ' ') || 'Linear'}</p>
                    </div>
                    <div>
                      <p className="text-ink-3">Deload strategy</p>
                      <p className="text-ink capitalize">{fullProgram?.periodization.deloadStrategy || 'Volume'}</p>
                    </div>
                  </div>
                  <div className="p-2 bg-fill rounded text-caption">
                    <p className="text-ink-2">
                      <span className="text-ink-2 font-medium">Week 1-{totalWeeks - 1}:</span> Progressive overload (+sets or +weight each week)
                    </p>
                    <p className="text-ink-2 mt-1">
                      <span className="text-status-warn font-medium">Week {totalWeeks} (Deload):</span>{' '}
                      {deload
                        ? `${deload.volumePercent}% volume${deload.loadPercent !== null ? `, loads at ${deload.loadPercent}%` : ''}${deload.rir ? `, ${formatRir(deload.rir)}` : ''} to dissipate fatigue`
                        : '50% volume to dissipate fatigue'}
                    </p>
                  </div>
                </div>

                {/* Deload Triggers */}
                <div className="p-4 bg-card/50 rounded-lg border border-sep">
                  <h4 className="font-medium text-ink flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-action/20 flex items-center justify-center text-caption text-action">6</span>
                    Auto-Deload Triggers
                  </h4>
                  <p className="text-subhead text-ink-2 mb-3">
                    Besides scheduled deloads, we&apos;ll suggest an early deload if any of these occur:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-caption">
                    <div className="p-2 bg-fill rounded flex items-center gap-2">
                      <IconTrendingDown className="h-4 w-4 flex-shrink-0 text-status-bad" stroke={1.75} aria-hidden="true" />
                      <span className="text-ink-2">Performance drops 2+ sessions</span>
                    </div>
                    <div className="p-2 bg-fill rounded flex items-center gap-2">
                      <IconMoon className="h-4 w-4 flex-shrink-0 text-status-bad" stroke={1.75} aria-hidden="true" />
                      <span className="text-ink-2">Sleep quality below 2/5</span>
                    </div>
                    <div className="p-2 bg-fill rounded flex items-center gap-2">
                      <IconGauge className="h-4 w-4 flex-shrink-0 text-status-bad" stroke={1.75} aria-hidden="true" />
                      <span className="text-ink-2">RPE consistently 9.5+</span>
                    </div>
                    <div className="p-2 bg-fill rounded flex items-center gap-2">
                      <IconHeartBroken className="h-4 w-4 flex-shrink-0 text-status-bad" stroke={1.75} aria-hidden="true" />
                      <span className="text-ink-2">Joint pain reported</span>
                    </div>
                  </div>
                </div>
              </div>
            </details>

            {/* Warnings (the session-cap one is said by the volume card below,
                with the fix next to it). */}
            {fullProgram && fullProgram.warnings.some((w) => !CAP_WARNING.test(w)) && (
              <div className="p-4 bg-status-warn/10 border border-status-warn/20 rounded-lg space-y-2">
                <p className="text-subhead font-medium text-status-warn">Things to consider</p>
                {fullProgram.warnings.filter((w) => !CAP_WARNING.test(w)).map((warning, i) => (
                  <p key={i} className="text-caption text-status-warn">{warning}</p>
                ))}
              </div>
            )}

            {/* Weekly sets per muscle: one line per concept, details folded.
                Muscles the sessions cap or leave at MEV come with the fix —
                the session-length control — right there (UX panel, round 19:
                "I couldn't find a way to change session length"). */}
            {recommendation && (
              <div className="p-4 bg-fill/50 rounded-lg">
                {(() => {
                  const rows = plannedVolumeWithBands(fullProgram?.volumePerMuscle ?? recommendation.volumePerMuscle, { recoveryProfile: enhancedAthleteMode ? 'enhanced' : 'standard' });
                  const deliveredOrNull = deliveredSetsAtPeak(fullProgram);
                  const hasDelivered = deliveredOrNull !== null;
                  const delivered = deliveredOrNull ?? {};
                  const caps = fullProgram?.volumeCaps ?? {};
                  const targetOf = (muscle: string, sets: number) => caps[muscle as keyof typeof caps]?.fits ?? sets;
                  const limited = hasDelivered
                    ? rows.filter((r) => caps[r.muscle as keyof typeof caps] || isUnderDelivered(r.sets, delivered[r.muscle]))
                    : [];
                  const lowRows = hasDelivered ? rows.filter((r) => isAtOrBelowMev(delivered[r.muscle], r.mev)) : [];
                  // Trained once a week past what one session holds: a longer
                  // session won't help, a second day will (say which).
                  const onceWeeklyNote = hasDelivered && fullProgram
                    ? onceWeeklyCeilingNote(onceWeeklyCeilingMuscles(fullProgram.volumePerMuscle, delivered), fullProgram.split)
                    : null;
                  return (
                    <>
                      <p className="text-subhead font-medium text-ink-2">Weekly sets per muscle (peak week)</p>
                      <p className="text-caption text-ink-3 mb-3">
                        {hasDelivered ? 'Sets in your sessions (indirect work counts half) · MEV–MRV.' : 'Planned sets · MEV–MRV.'}
                      </p>
                      {(limited.length > 0 || lowRows.length > 0) && (
                        <div className="mb-3 rounded bg-status-warn/10 px-2 py-2" data-testid="builder-volume-capped">
                          {limited.length > 0 && (
                            <p className="text-subhead text-ink" data-testid="builder-volume-short">
                              {sessionDurationMinutes}-min sessions hold less than the target for{' '}
                              {limited.map((r) => `${muscleDisplayName(r.muscle)} ${formatHeadSets(delivered[r.muscle])}/${r.sets}`).join(', ')}.
                            </p>
                          )}
                          {lowRows.length > 0 && (
                            <p className="text-subhead text-ink mt-1" data-testid="builder-volume-mev">
                              At or below MEV: {lowRows.map((r) => `${muscleDisplayName(r.muscle)} ${formatHeadSets(delivered[r.muscle])} (MEV ${r.mev})`).join(', ')}.
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="builder-session-length-fix">
                            <span className="text-caption text-ink-2">Session length</span>
                            <span className="rounded-full bg-action px-3 py-1 text-caption font-semibold text-white" aria-current="true">
                              {sessionDurationMinutes} min
                            </span>
                            {sessionOptions.map((o) => (
                              <button
                                key={o.minutes}
                                type="button"
                                onClick={() => chooseSessionLength(o.minutes)}
                                className="rounded-full border border-action px-3 py-1 text-caption font-semibold text-action hover:bg-action/10"
                                data-testid={`builder-try-${o.minutes}`}
                                aria-label={`Use ${o.minutes}-minute sessions: ${o.gains.map((g) => `${muscleDisplayName(g.muscle)} ${g.from} to ${g.to}`).join(', ')}`}
                              >
                                {o.minutes} min
                                <span className="ml-1 font-normal text-ink-2">
                                  {o.gains.slice(0, 3).map((g) => `${muscleDisplayName(g.muscle)} ${g.to}`).join(', ')}
                                  {o.gains.length > 3 ? ` +${o.gains.length - 3}` : ''}
                                </span>
                              </button>
                            ))}
                          </div>
                          {onceWeeklyNote && (
                            <p className="text-subhead text-ink mt-2" data-testid="builder-once-weekly-note">
                              {onceWeeklyNote}
                            </p>
                          )}
                          {sessionOptions.length === 0 && !onceWeeklyNote && (
                            <p className="text-caption text-ink-2 mt-1">
                              Longer sessions don&apos;t raise these: one session holds about 10–12 hard sets per muscle. Train them twice a week to go higher.
                            </p>
                          )}
                          <details className="mt-1 text-caption text-ink-2">
                            <summary className="cursor-pointer text-ink-3">Why</summary>
                            <p className="mt-1">
                              A {sessionDurationMinutes}-minute session fits about {sessionSetCapacity(sessionDurationMinutes, userGoal)} working sets, and one muscle
                              gets about 10–12 hard sets before the session&apos;s fatigue budget stops it. Targets the sessions can&apos;t hold are set to what fits
                              {limited.length > 0 ? ` (${limited.map((r) => `${muscleDisplayName(r.muscle)} ${targetOf(r.muscle, r.sets)} of ${r.sets}`).join(', ')})` : ''}.
                              {lowRows.length > 0 ? ' At MEV a muscle holds its size rather than growing.' : ''}
                            </p>
                          </details>
                        </div>
                      )}
                      <ul className="grid grid-cols-1 gap-1.5 text-subhead sm:grid-cols-2" data-testid="builder-volume-bands">
                        {rows.map(({ muscle, sets, mev, mrv }) => {
                          const done = hasDelivered ? delivered[muscle] ?? 0 : sets;
                          const target = targetOf(muscle, sets);
                          const low = isAtOrBelowMev(done, mev);
                          return (
                            <li key={muscle} className="flex items-baseline justify-between gap-2 rounded bg-card/50 px-2 py-1.5">
                              <span className="text-ink">
                                {muscleDisplayName(muscle)}
                                {low && <span className="ml-1.5 text-caption font-semibold text-status-warn">≤ MEV</span>}
                              </span>
                              <span className="tabular-nums text-ink-2 text-right">
                                <span className={`font-semibold ${low ? 'text-status-warn' : done > mrv ? 'text-status-bad' : 'text-ink'}`}>{done}</span>
                                {hasDelivered && done !== target && <> of {target}</>} · {mev}–{mrv}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Week by week: sets per muscle (and per head: side delts under
                shoulders…) for every generated week, the RIR each week
                prescribes, and the deload's real numbers. */}
            {fullProgram && planWeeks.length > 0 && (
              <div className="p-4 bg-fill/50 rounded-lg" data-testid="builder-week-by-week">
                <p className="text-subhead font-medium text-ink-2 mb-1">Week by week</p>
                {rirLine(planWeeks) && (
                  <p className="text-caption text-ink-2" data-testid="builder-rir-line">
                    <span className="font-semibold text-ink">Effort:</span> {rirLine(planWeeks)}
                  </p>
                )}
                {deloadLine && (
                  <p className="text-caption text-ink-2">
                    <span className="font-semibold text-ink">Deload:</span> {deloadLine}
                  </p>
                )}
                <details className="text-caption text-ink-3 mb-2">
                  <summary className="cursor-pointer">Why this ramp</summary>
                  <p className="mt-1">{rampExplanation(fullProgram.periodization.model, planWeeks)}</p>
                </details>
                {(() => {
                  const bandRows = plannedVolumeWithBands(fullProgram.volumePerMuscle, { recoveryProfile: enhancedAthleteMode ? 'enhanced' : 'standard' });
                  // Heads listed by default: shoulders (side delts are the
                  // usual target) and any group with a prioritized head.
                  const prioritizedParents = new Set(priorityAdjustments.filter((a) => a.head).map((a) => a.muscleGroup as string));
                  const prioritizedHeads = new Set(priorityAdjustments.filter((a) => a.head).map((a) => a.head as string));
                  const headsShown = (muscle: string) => showAllHeads || muscle === 'shoulders' || prioritizedParents.has(muscle);
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-caption tabular-nums" data-testid="builder-week-table">
                        <thead>
                          <tr className="text-ink-3">
                            <th scope="col" className="text-left font-medium py-1 pr-2">Sets</th>
                            {planWeeks.map((w) => (
                              <th key={w.weekNumber} scope="col" className={`text-right font-medium py-1 px-1 ${w.isDeload ? 'text-status-warn' : ''}`}>
                                {w.isDeload ? 'Deload' : `W${w.weekNumber}`}
                              </th>
                            ))}
                          </tr>
                          <tr className="text-ink-3">
                            <th scope="row" className="text-left font-normal py-0.5 pr-2">Volume</th>
                            {planWeeks.map((w) => (
                              <td key={w.weekNumber} className="text-right py-0.5 px-1">{Math.round(w.volumeModifier * 100)}%</td>
                            ))}
                          </tr>
                          <tr className="text-ink-3 border-b border-sep">
                            <th scope="row" className="text-left font-normal py-0.5 pr-2">RIR</th>
                            {planWeeks.map((w) => (
                              <td key={w.weekNumber} className="text-right py-0.5 px-1">
                                {w.rir ? (w.rir.min === w.rir.max ? w.rir.min : `${w.rir.min}–${w.rir.max}`) : '–'}
                              </td>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bandRows.flatMap(({ muscle, mev }) => [
                            <tr key={muscle} aria-label={`${muscleDisplayName(muscle)}: ${rampLine(planWeeks, muscle)}`}>
                              <th scope="row" className="text-left font-normal text-ink py-0.5 pr-2 whitespace-nowrap">{muscleDisplayName(muscle)}</th>
                              {planWeeks.map((w) => {
                                const sets = Math.round(w.sets[muscle] ?? 0);
                                // A deload sits under MEV by design; flag training weeks only.
                                // Week 1 opening AT MEV is the plan (the ramp climbs from there); only a training week under MEV is flagged.
                                const low = !w.isDeload && sets < mev;
                                return (
                                  <td key={w.weekNumber} className={`text-right py-0.5 px-1 ${low ? 'text-status-warn font-semibold' : 'text-ink-2'}`}>
                                    {sets}
                                  </td>
                                );
                              })}
                            </tr>,
                            ...(headsShown(muscle)
                              ? headsOf(muscle).map((head) => (
                                  <tr key={`${muscle}-${head}`} data-testid={`builder-head-row-${head}`}>
                                    <th scope="row" className="text-left font-normal text-ink-3 py-0.5 pl-3 pr-2 whitespace-nowrap">
                                      {STANDARD_MUSCLE_DISPLAY_NAMES[head]}
                                      {prioritizedHeads.has(head) && <span className="ml-1 text-action" aria-label="prioritized">★</span>}
                                    </th>
                                    {planWeeks.map((w) => (
                                      <td key={w.weekNumber} className="text-right py-0.5 px-1 text-ink-3">{formatHeadSets(w.heads[head])}</td>
                                    ))}
                                  </tr>
                                ))
                              : []),
                          ])}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption">
                  <span className="text-ink-3">Amber: below MEV. Week 1 opens near MEV and adds sets each week. Heads count indirect work at half.</span>
                  <span className="flex gap-3">
                    <button type="button" className="font-semibold text-action" onClick={() => setShowAllHeads((v) => !v)} data-testid="builder-toggle-heads">
                      {showAllHeads ? 'Fewer heads' : 'All heads'}
                    </button>
                    {userId && (
                      <button type="button" className="font-semibold text-action" onClick={() => setShowPriorityEditor((v) => !v)} data-testid="builder-edit-priorities">
                        {showPriorityEditor ? 'Close priorities' : 'Prioritize muscles or heads'}
                      </button>
                    )}
                  </span>
                </div>
                {showPriorityEditor && userId && (
                  <div className="mt-3" data-testid="builder-priority-editor">
                    <MusclePrioritySettings userId={userId} onSave={applySavedPriorities} />
                  </div>
                )}
              </div>
            )}

            {/* Workout Preview */}
            {workoutTemplates.length > 0 && (
              <div>
                <p className="text-subhead font-medium text-ink-2 mb-3">Workout structure</p>
                <div className="flex gap-2 overflow-x-auto pb-2" data-testid="builder-structure">
                  {/* The generated plan's own sessions — what Create saves. The
                      older template preview ignored the chosen split (a Bro
                      Split previewed as Upper/Lower). */}
                  {fullProgram && fullProgram.sessions.length > 0
                    ? fullProgram.sessions.map((session, i) => (
                        <div key={i} className="shrink-0 p-3 bg-fill/50 rounded-lg min-w-[140px]">
                          <p className="font-medium text-ink text-subhead">{session.day}</p>
                          <p className="text-caption text-ink-3 mt-1">
                            {session.exercises.length} exercises · {session.totalSets} sets
                          </p>
                          <p className="text-caption text-ink-2 mt-1">{session.focus}</p>
                        </div>
                      ))
                    : workoutTemplates.map((template, i) => (
                    <div key={i} className="shrink-0 p-3 bg-fill/50 rounded-lg min-w-[140px]">
                      <p className="font-medium text-ink text-subhead">{template.dayName}</p>
                      <p className="text-caption text-ink-3 mt-1">
                        {template.exercises.length} exercises
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {template.muscles.slice(0, 3).map(m => (
                          <Badge key={m} size="sm" variant="default" className="capitalize text-caption">
                            {m}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={handleSubmit} isLoading={isLoading}>
                Create mesocycle
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/** The builder's first step, shaped, while its inputs load (cold start only). */
function BuilderSkeleton() {
  return (
    <div
      className="max-w-2xl mx-auto space-y-6"
      role="status"
      aria-busy="true"
      data-testid="mesocycle-builder-loading"
    >
      <div>
        <h1 className="text-title font-bold text-ink">Create mesocycle</h1>
        <p className="mt-1 flex items-center gap-2 text-ink-2">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
            aria-hidden="true"
          />
          Reading your profile and recent training…
        </p>
      </div>
      <div className="animate-pulse space-y-4" aria-hidden="true">
        <div className="h-10 rounded-card bg-card shadow-card" />
        <div className="rounded-card bg-card p-4 shadow-card space-y-3">
          <div className="h-4 w-1/3 rounded bg-fill" />
          <div className="h-10 w-full rounded bg-fill" />
          <div className="h-4 w-1/2 rounded bg-fill" />
          <div className="h-10 w-full rounded bg-fill" />
        </div>
        <div className="h-32 rounded-card bg-card shadow-card" />
      </div>
    </div>
  );
}
