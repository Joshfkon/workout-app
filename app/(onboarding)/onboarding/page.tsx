'use client';

import { IconApple, IconBarbell, IconChartLine, IconCheck, IconRuler2, IconSparkles, IconWorld } from '@tabler/icons-react';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, ExplainedTerm, SegmentedControl } from '@/components/ui';
import { ContextCard } from '@/components/onboarding/ContextCard';
import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps';
import { createUntypedClient } from '@/lib/supabase/client';
import { calculateBodyComposition, getFFMIAssessment, getFFMIBracket } from '@/services/coachingEngine';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { updateOnboardingStep, completeOnboarding, confirmedOnboardingGoal, type TrainingGoal } from '@/lib/onboarding/onboardingProgress';
import type { StandingInjuryArea } from '@/lib/training/standingInjuries';
import { GoalStep } from './_components/GoalStep';
import { earlierGoalAnswer, type GoalPreselection } from '@/lib/onboarding/goalPreselection';
import { TrainingStep } from './_components/TrainingStep';
import { targetsGoalName } from './_components/DailyTargetsCard';
import { HeightField, cmToFeetInches, feetInchesToCm } from './_components/HeightField';
import {
  EMPTY_TRAINING_SETUP,
  customChangeForGoal,
  nearestRateForChange,
  rateForGoal,
  trainingPreferencesPatch,
  trainingSetupFromPreferences,
  type TrainingSetupAnswers,
} from '@/lib/onboarding/trainingSetup';
import {
  experienceSummary,
  liftingAnswerFromMetadata,
  onboardingExperience,
} from '@/lib/onboarding/experienceOptions';
import { TextSizeControl } from '@/components/settings/TextSizeControl';
import { phaseToNutritionGoal, starterTargets } from '@/lib/nutrition/phaseTargets';
import { askedForBenchmarks, skipsBenchmarks, statedTrackingFocus } from '@/lib/onboarding/trackingFocus';
import { resolveBeginnerMode } from '@/lib/beginnerMode';
import { savePreferencesPatch } from '@/lib/settings/savePreferencesPatch';
import { saveMacroSettings } from '@/lib/actions/nutrition';
import type { LengthUnit, WeightUnit } from '@/types/schema';
import { lengthUnitForWeightUnit, resolveLengthUnit } from '@/lib/units/lengthUnits';

// Unit conversion helpers
const kgToLbs = (kg: number) => kg * 2.20462;
const lbsToKg = (lbs: number) => lbs / 2.20462;

// Body fat visual reference with clickable values
const BODY_FAT_OPTIONS = {
  male: [
    { value: 9, label: '9%', description: 'Hard abs' },
    { value: 12, label: '12%', description: 'Faint abs' },
    { value: 15, label: '15%', description: 'Flat stomach' },
    { value: 20, label: '20%', description: 'Soft everything' },
  ],
  female: [
    { value: 16, label: '16%', description: 'Very lean, visible abs' },
    { value: 20, label: '20%', description: 'Athletic, toned' },
    { value: 25, label: '25%', description: 'Average, feminine shape' },
    { value: 32, label: '32%', description: 'Higher body fat' },
  ]
};

/** Typical adult body fat, used only when the user skips ("I don't know — skip"). */
function typicalBodyFat(sex: 'male' | 'female'): string {
  return sex === 'female' ? '32' : '22';
}

export default function OnboardingBodyCompPage() {
  const router = useRouter();
  const { preferences, updatePreference } = useUserPreferences();
  
  // Step state: 'units' -> 'body-comp' -> 'goal' -> 'training' (lifters only,
  // optional). Nothing is saved until the last of these is left.
  const [step, setStep] = useState<'units' | 'body-comp' | 'goal' | 'training'>('units');
  // The highlighted unit IS the selection: Continue saves whatever is shown
  // as picked, no extra tap needed. It starts from the stored preference
  // (default Imperial) and follows it if that loads late, until the user
  // picks one themselves.
  // Weight and length are separate choices; the Imperial / Metric cards are
  // a shortcut that sets both.
  const [selectedUnits, setSelectedUnits] = useState<WeightUnit>(preferences.units || 'lb');
  const [selectedLength, setSelectedLength] = useState<LengthUnit>(() =>
    resolveLengthUnit(preferences, preferences.units || 'lb')
  );
  const unitsTouched = useRef(false);
  const storedLength = resolveLengthUnit(preferences, preferences.units || 'lb');
  useEffect(() => {
    if (unitsTouched.current) return;
    if (preferences.units) setSelectedUnits(preferences.units);
    setSelectedLength(storedLength);
  }, [preferences.units, storedLength]);
  const pickSystem = (u: WeightUnit) => {
    unitsTouched.current = true;
    setSelectedUnits(u);
    setSelectedLength(lengthUnitForWeightUnit(u));
  };
  const pickWeight = (u: WeightUnit) => {
    unitsTouched.current = true;
    setSelectedUnits(u);
  };
  const pickLength = (l: LengthUnit) => {
    unitsTouched.current = true;
    setSelectedLength(l);
  };
  const [isSavingUnits, setIsSavingUnits] = useState(false);
  const units = selectedUnits;
  const lengthUnit = selectedLength;
  // Height has its own cm / ft & in toggle on the body step; it starts on
  // the length unit picked first and only changes how height is typed.
  const [heightUnitPicked, setHeightUnitPicked] = useState<LengthUnit | null>(null);
  const heightUnit = heightUnitPicked ?? lengthUnit;

  const [isLoading, setIsLoading] = useState(false);
  const [existingDexa, setExistingDexa] = useState<{
    weight_kg: number;
    lean_mass_kg: number;
    fat_mass_kg: number;
    body_fat_percent: number;
  } | null>(null);
  
  // Form state - stored in display units
  // No preselection: a required, neutral choice (restored from the profile
  // when re-entering onboarding).
  const [sex, setSex] = useState<'male' | 'female' | null>(null);
  const [heightDisplay, setHeightDisplay] = useState<string>('');
  // For imperial: feet and inches
  const [heightFeet, setHeightFeet] = useState<string>('');
  const [heightInches, setHeightInches] = useState<string>('');
  const [weightDisplay, setWeightDisplay] = useState<string>('');
  // Optional: only the calorie target needs it (restored from the profile).
  const [ageDisplay, setAgeDisplay] = useState<string>('');
  const [bodyFatPercent, setBodyFatPercent] = useState<string>('');
  // True when the user skipped body fat and we filled in a typical value.
  // A guessed body fat must not drive a muscle-mass verdict or a goal pick.
  const [bfEstimated, setBfEstimated] = useState(false);
  const [useDexa, setUseDexa] = useState(false);
  const [showBodyFatGuide, setShowBodyFatGuide] = useState(false);
  // Training goal (users.goal). Preselected to Maintain so Continue works in
  // one tap (the product owner keeps a preselection), and the goal step says
  // so out loud. An earlier answer wins over the default: a goal saved by
  // this step before (re-entering onboarding; see confirmedOnboardingGoal),
  // else the direction of food targets already set up in Eat
  // (macro_settings.goal). Registration's 'maintenance' placeholder isn't
  // treated as a choice.
  const [goal, setGoal] = useState<TrainingGoal | null>('maintenance');
  // Where the preselected goal came from; null once the user picks one.
  const [goalSource, setGoalSource] = useState<GoalPreselection | null>('default');
  const goalTouched = useRef(false);
  // Protein typed on the goal step (g a day); null = the calculated figure.
  const [proteinOverride, setProteinOverride] = useState<number | null>(null);
  // Calories typed on the targets card (kcal a day); null = the calculated figure.
  const [calorieOverride, setCalorieOverride] = useState<number | null>(null);
  // Optional "areas to go easy on", saved as body areas in
  // users.preferences.injuryAreas (lib/training/standingInjuries), never
  // injury_history. null = unanswered, which leaves the stored value alone.
  const [injuryAreas, setInjuryAreas] = useState<StandingInjuryArea[] | null>(null);
  // Re-entering onboarding: show the areas saved last time. If the user then
  // clears them all, that is saved as [] rather than ignored.
  const injuryAreasSeeded = useRef(false);
  // Targets the user already has (re-entering onboarding, or set up in Eat).
  // Starter targets are only created when there are none and no saved
  // calculator settings, so nothing the user chose gets overwritten.
  const [existingTargets, setExistingTargets] = useState<{ calories: number; protein: number } | null>(null);
  const [hasMacroSettings, setHasMacroSettings] = useState(false);
  // Said "No, food tracking" at sign-up: starter targets count no workouts,
  // and onboarding ends at the goal step (no strength benchmarks) unless the
  // user came here to calibrate (?benchmarks=1).
  const [foodFocus, setFoodFocus] = useState(false);
  // Beginner mode, offered on the goal step: the saved choice, else on for
  // novices (lib/beginnerMode). Saved on Continue for lifters.
  const [beginnerMode, setBeginnerMode] = useState(false);
  const beginnerTouched = useRef(false);
  // Sign-up's experience answer, shown back on the goal step (not re-asked).
  const [experienceShown, setExperienceShown] = useState<{ label: string; fromSignUp: boolean } | null>(null);
  // The sign-up answer's level when the users row doesn't have it yet
  // (lib/onboarding/experienceOptions onboardingExperience); saved on Continue.
  const [experienceToSave, setExperienceToSave] = useState<string | null>(null);
  // Optional training step (lifters): days, split, and the bulk/cut pace.
  const [trainingAnswers, setTrainingAnswers] = useState<TrainingSetupAnswers>(EMPTY_TRAINING_SETUP);
  const trainingTouched = useRef(false);
  const [trainingBusy, setTrainingBusy] = useState<'continue' | 'skip' | null>(null);
  useEffect(() => {
    if (injuryAreasSeeded.current || preferences.injuryAreas.length === 0) return;
    injuryAreasSeeded.current = true;
    setInjuryAreas((current) => current ?? preferences.injuryAreas);
  }, [preferences.injuryAreas]);
  
  // Save unit preference and proceed
  const handleUnitsConfirm = async () => {
    if (isSavingUnits) return;
    setIsSavingUnits(true);
    try {
      // One after the other: each is a read-merge-write of users.preferences.
      await updatePreference('units', selectedUnits);
      await updatePreference('lengthUnits', selectedLength);

      // Track progress
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await updateOnboardingStep(supabase, user.id, 'units');
      }
    } catch (err) {
      // Progress tracking is best-effort; the unit is already applied locally.
      console.error('Error saving units step:', err);
    } finally {
      setIsSavingUnits(false);
    }

    setStep('body-comp');
  };
  
  // Convert display values to metric for calculations
  const getHeightCm = () => {
    if (heightUnit === 'in') return feetInchesToCm(heightFeet, heightInches);
    if (!heightDisplay) return 0;
    return parseFloat(heightDisplay) || 0;
  };
  // Switching the height unit carries the number across.
  const switchHeightUnit = (next: LengthUnit) => {
    if (next === heightUnit) return;
    const cm = getHeightCm();
    if (next === 'in') {
      if (cm > 0) {
        const { feet, inches } = cmToFeetInches(cm);
        setHeightFeet(String(feet));
        setHeightInches(String(inches));
      }
    } else if (cm > 0) {
      setHeightDisplay(String(Math.round(cm)));
    }
    setHeightUnitPicked(next);
  };
  
  const getWeightKg = () => {
    if (!weightDisplay) return 0;
    const val = parseFloat(weightDisplay);
    return units === 'lb' ? lbsToKg(val) : val;
  };
  
  // A height saved earlier (re-entering onboarding), filled into the height
  // fields in the length unit picked on the first step. Once only, so it
  // never overwrites what the user types.
  const [savedHeightCm, setSavedHeightCm] = useState<number | null>(null);
  const heightPrefilled = useRef(false);
  useEffect(() => {
    if (step !== 'body-comp' || savedHeightCm == null || heightPrefilled.current) return;
    heightPrefilled.current = true;
    if (heightUnit === 'in') {
      const { feet, inches } = cmToFeetInches(savedHeightCm);
      setHeightFeet((current) => current || String(feet));
      setHeightInches((current) => current || String(inches));
    } else {
      setHeightDisplay((current) => current || String(savedHeightCm));
    }
  }, [step, savedHeightCm, heightUnit]);

  // Computed values
  const [bodyComp, setBodyComp] = useState<{
    leanMassKg: number;
    ffmi: number;
    ffmiAssessment: string;
    ffmiBracket: string;
  } | null>(null);
  
  // Fetch existing DEXA data if available
  useEffect(() => {
    async function fetchDexaData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setFoodFocus(statedTrackingFocus(user.user_metadata) === 'food');
      
      // Get latest DEXA scan
      const { data: dexaScans } = await supabase
        .from('dexa_scans')
        .select('*')
        .eq('user_id', user.id)
        .order('scan_date', { ascending: false })
        .limit(1);
      
      if (dexaScans && dexaScans.length > 0) {
        setExistingDexa(dexaScans[0]);
      }
      
      // Get user height if available
      const { data: userData } = await supabase
        .from('users')
        .select('height_cm, sex, age, goal, experience, preferences, onboarding_step, onboarding_completed')
        .eq('id', user.id)
        .single();

      const [{ data: targetsRow }, { data: macroSettingsRow }] = await Promise.all([
        supabase.from('nutrition_targets').select('calories, protein').eq('user_id', user.id).maybeSingle(),
        supabase.from('macro_settings').select('user_id, goal').eq('user_id', user.id).maybeSingle(),
      ]);
      if (targetsRow?.calories) {
        setExistingTargets({ calories: targetsRow.calories, protein: targetsRow.protein ?? 0 });
      }
      if (macroSettingsRow) setHasMacroSettings(true);
      
      if (userData?.height_cm) {
        // Shown once the length unit is settled (see the effect below).
        setSavedHeightCm(userData.height_cm);
      }
      if (userData?.sex) {
        setSex(userData.sex as 'male' | 'female');
      }
      if (userData?.age) {
        setAgeDisplay((current) => current || String(userData.age));
      }
      const prefs = (userData?.preferences as Record<string, unknown> | null) ?? {};
      const liftingAnswer = liftingAnswerFromMetadata(user.user_metadata);
      const signUpLevel = onboardingExperience(
        liftingAnswer,
        userData?.experience,
        userData?.onboarding_completed
      );
      if (signUpLevel.changed) setExperienceToSave(signUpLevel.experience);
      if (!beginnerTouched.current) {
        setBeginnerMode(resolveBeginnerMode(prefs.beginnerMode, signUpLevel.experience));
      }
      setExperienceShown(experienceSummary(liftingAnswer, signUpLevel.experience));
      if (!trainingTouched.current) setTrainingAnswers(trainingSetupFromPreferences(prefs));
      const earlier = earlierGoalAnswer(
        confirmedOnboardingGoal(userData),
        (macroSettingsRow as { goal?: string | null } | null)?.goal ?? null
      );
      // Don't overwrite a pick the user made while this was loading.
      if (earlier && !goalTouched.current) {
        setGoal(earlier.goal);
        setGoalSource(earlier.source);
      }
    }
    
    fetchDexaData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Calculate body composition when inputs change
  useEffect(() => {
    const height = getHeightCm();
    const weight = useDexa && existingDexa ? existingDexa.weight_kg : getWeightKg();
    const bf = useDexa && existingDexa ? existingDexa.body_fat_percent : parseFloat(bodyFatPercent);
    
    if (sex && height > 0 && weight > 0 && bf > 0 && bf < 100) {
      const comp = calculateBodyComposition(weight, bf, height);
      setBodyComp({
        leanMassKg: comp.leanMassKg,
        ffmi: comp.ffmi,
        ffmiAssessment: getFFMIAssessment(comp.ffmi, sex),
        ffmiBracket: getFFMIBracket(comp.ffmi, sex)
      });
    } else {
      setBodyComp(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightDisplay, heightFeet, heightInches, weightDisplay, bodyFatPercent, useDexa, existingDexa, sex, units, heightUnit]);
  
  const handleUseDexa = () => {
    if (existingDexa) {
      setUseDexa(true);
      // Convert DEXA weight to display units
      const displayWeight = units === 'lb'
        ? kgToLbs(existingDexa.weight_kg).toFixed(1)
        : String(existingDexa.weight_kg);
      setWeightDisplay(displayWeight);
      setBodyFatPercent(String(existingDexa.body_fat_percent));
    }
  };
  
  const getAge = () => {
    // Out-of-range ages are ignored rather than saved (users.age has a CHECK).
    const age = parseInt(ageDisplay, 10);
    return age >= 13 && age <= 100 ? age : null;
  };

  // Daily calorie + protein targets for the picked goal, from the same
  // calculation a phase switch uses (lib/nutrition/phaseTargets), so what
  // this step shows is exactly what Eat starts with.
  // `training` = the optional training step's answers (null = skipped or not
  // asked): the picked pace and days a week feed the same calculation.
  // The user's own body fat (DEXA, typed, or picked from the guide), never
  // the skip placeholder: protein follows their lean mass (the calculator's
  // rule, as in Eat) instead of an assumed 20% / 28%.
  const ownBodyFat = (): number | null => {
    if (useDexa && existingDexa) return existingDexa.body_fat_percent;
    if (bfEstimated) return null;
    const bf = parseFloat(bodyFatPercent);
    return bf > 0 && bf < 100 ? bf : null;
  };
  // ONE function for every calorie/protein figure in setup: the goal step's
  // card, the training step's line, what Skip uses and what gets saved.
  const starterFor = (training: TrainingSetupAnswers | null) => {
    if (!goal) return null;
    const weightKg = useDexa && existingDexa ? existingDexa.weight_kg : getWeightKg();
    const customKg = training ? customChangeForGoal(goal, training.weeklyChangeKg) : null;
    return starterTargets({
      phase: goal,
      weightKg,
      heightCm: getHeightCm(),
      age: getAge(),
      sex,
      liftsWeights: !foodFocus,
      nutritionGoal:
        customKg !== null
          ? nearestRateForChange(goal, customKg, weightKg)
          : training
            ? rateForGoal(goal, training.rate)
            : null,
      workoutsPerWeek: training?.daysPerWeek ?? null,
      bodyFatPercent: ownBodyFat(),
      weeklyChangeKg: customKg,
      proteinG: proteinOverride,
      caloriesKcal: calorieOverride,
    });
  };
  /** Props for the targets card (breakdown + Edit), shared by the goal and training steps. */
  const targetsCardFor = (s: NonNullable<ReturnType<typeof starterFor>>) => ({
    calorieBasis: s.calories,
    proteinBasis: s.protein,
    goalName: targetsGoalName(s.settings.goal, s.targetWeightChangePerWeek !== null),
    calorieOverride,
    proteinOverride,
  });
  const starter = starterFor(null);
  const createStarterTargets = !existingTargets && !hasMacroSettings;

  // Synchronous double-tap guard (as on /register): two taps land before the
  // isLoading re-render disables the button, and each would insert a
  // coaching session. The ref flips in the same tick.
  const goalSubmittingRef = useRef(false);

  const handleContinue = async (training: TrainingSetupAnswers | null = null) => {
    if (!goal || !sex || goalSubmittingRef.current) return;
    const starter = starterFor(training);
    goalSubmittingRef.current = true;
    setIsLoading(true);
    // On success we navigate away: stay busy until the route changes rather
    // than re-enabling Continue under the user's finger.
    let navigating = false;

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      // Convert display values to metric for storage
      const height = getHeightCm();
      const weight = useDexa && existingDexa ? existingDexa.weight_kg : getWeightKg();
      const bf = useDexa && existingDexa ? existingDexa.body_fat_percent : parseFloat(bodyFatPercent);

      // Food-only users finish here: no strength benchmarks, so no coaching
      // session to carry them (lib/onboarding/trackingFocus).
      const finishHere = skipsBenchmarks(
        statedTrackingFocus(user.user_metadata),
        askedForBenchmarks(window.location.search)
      );

      // Create coaching session (benchmarks → calibration carry its id)
      let sessionId: string | null = null;
      if (!finishHere) {
        const { data: session, error: sessionError } = await supabase
          .from('coaching_sessions')
          .insert({
            user_id: user.id,
            status: 'in_progress',
            body_composition: {
              heightCm: height,
              totalWeightKg: weight,
              bodyFatPercentage: bf,
              bodyFatEstimated: bfEstimated,
              leanMassKg: bodyComp?.leanMassKg,
              ffmi: bodyComp?.ffmi
            },
            selected_benchmarks: []
          })
          .select()
          .single();

        if (sessionError) throw sessionError;
        sessionId = session.id;
      }
      
      // Update user profile with sex, height, and the confirmed training goal
      const { error: profileError } = await supabase
        .from('users')
        .update({
          sex,
          height_cm: height,
          weight_kg: weight,
          goal,
          ...(getAge() ? { age: getAge() } : {}),
          // The sign-up answer's level, when the row still had the default.
          ...(experienceToSave ? { experience: experienceToSave } : {}),
        })
        .eq('id', user.id);

      // First nutrition targets for the chosen goal (best-effort: Eat can
      // always calculate them later).
      if (createStarterTargets && starter && !profileError) {
        try {
          const saved = await saveMacroSettings({
            ...starter.settings,
            target_weight_change_per_week: starter.targetWeightChangePerWeek,
            // A hand-set protein or calorie figure is a hand-set target: the
            // adaptive sync must not recalculate it away
            // (setMacroAutoUpdateEnabled's rule).
            ...(starter.protein.setByHand || starter.calories.setByHand ? { auto_update_enabled: false } : {}),
          });
          if (saved.success) {
            const { error: targetsError } = await supabase
              .from('nutrition_targets')
              .insert({ user_id: user.id, ...starter.targets });
            if (targetsError) console.error('Error saving starter targets:', targetsError);
          }
        } catch (err) {
          console.error('Error saving starter targets:', err);
        }
      }

      // Optional injuries answer: merged into users.preferences (the hook
      // re-reads the JSON first), only when the question was answered.
      const injuryAnswer = injuryAreas ?? (injuryAreasSeeded.current ? [] : null);
      if (injuryAnswer !== null) {
        await updatePreference('injuryAreas', injuryAnswer);
      }

      // Beginner mode (lifters; food-only users aren't asked), plus the
      // optional training step's days and split, in one merge into
      // users.preferences. Best-effort: Settings can always change them.
      if (!foodFocus) {
        try {
          await savePreferencesPatch(supabase, user.id, {
            beginnerMode,
            ...(training ? trainingPreferencesPatch(training) : {}),
          });
        } catch (err) {
          console.error('Error saving beginner mode:', err);
        }
      }
      
      // Track progress - user completed goal selection. The 'goal' marker is
      // what tells a chosen goal apart from registration's placeholder, so it
      // is only written once the goal itself was saved.
      if (profileError) {
        console.error('Error saving profile:', profileError);
      } else {
        await updateOnboardingStep(supabase, user.id, 'goal');
      }
      
      if (finishHere) {
        // Food-only: setup is done. Strength calibration stays reachable
        // later (Progress / Settings link to ONBOARDING_BENCHMARKS_ENTRY).
        if (!profileError) await completeOnboarding(supabase, user.id);
        router.push('/dashboard');
        navigating = true;
        return;
      }

      // Navigate to benchmark selection with session ID
      router.push(`/onboarding/benchmarks?session=${sessionId}`);
      navigating = true;
    } catch (err) {
      console.error('Error creating coaching session:', err);
    } finally {
      if (!navigating) {
        goalSubmittingRef.current = false;
        setIsLoading(false);
        setTrainingBusy(null);
      }
    }
  };

  // Goal step → the optional training step for lifters; food-only users
  // (and anyone not lifting) finish straight from the goal step.
  const handleGoalContinue = () => {
    if (!goal || !sex) return;
    if (foodFocus) {
      void handleContinue(null);
      return;
    }
    setStep('training');
  };

  const finishTrainingStep = (skip: boolean) => {
    if (goalSubmittingRef.current) return;
    setTrainingBusy(skip ? 'skip' : 'continue');
    void handleContinue(skip ? null : trainingAnswers);
  };
  
  const canContinue = bodyComp !== null && bodyComp.ffmi > 0;
  // Women's FFMI runs ~3 points lower; the scale bar shifts with it.
  const ffmiScaleMin = sex === 'female' ? 12 : 15;

  // Why Continue is disabled, in words (a dimmed button alone reads as broken).
  const missingBodyComp: string[] = [];
  if (!canContinue) {
    if (!sex) missingBodyComp.push('sex (Female or Male)');
    if (!(getHeightCm() > 0)) missingBodyComp.push('height');
    if (!(useDexa && existingDexa) && !(getWeightKg() > 0)) missingBodyComp.push('weight');
    const bfValue = useDexa && existingDexa ? existingDexa.body_fat_percent : parseFloat(bodyFatPercent);
    if (!(bfValue > 0 && bfValue < 100)) missingBodyComp.push('body-fat estimate');
  }
  
  // Unit selection step
  if (step === 'units') {
    return (
      <div className="max-w-md mx-auto space-y-8 animate-fade-in">
        <OnboardingSteps current="units" foodFocus={foodFocus} />

        <div className="text-center">
          <h1 className="text-large-title font-bold text-ink mb-2">Welcome to HyperTrack!</h1>
          <p className="text-ink-2 mb-6">
            Your AI-powered hypertrophy training and nutrition companion.
          </p>
          
          {/* Feature highlights */}
          <div className="grid grid-cols-2 gap-3 mb-6 text-left">
            <div className="p-3 bg-fill/50 rounded-lg border border-sep">
              <IconBarbell size={20} className="text-action" aria-hidden="true" />
              <p className="text-body font-medium text-ink mt-1">Smart workouts</p>
              <p className="text-caption text-ink-3">AI mesocycle planning</p>
            </div>
            <div className="p-3 bg-fill/50 rounded-lg border border-sep">
              <IconApple size={20} className="text-action" aria-hidden="true" />
              <p className="text-body font-medium text-ink mt-1">Nutrition tracking</p>
              <p className="text-caption text-ink-3">300K+ food database</p>
            </div>
            <div className="p-3 bg-fill/50 rounded-lg border border-sep">
              <IconSparkles size={20} className="text-action" aria-hidden="true" />
              <p className="text-body font-medium text-ink mt-1">AI coaching</p>
              <p className="text-caption text-ink-3">Personalized advice</p>
            </div>
            <div className="p-3 bg-fill/50 rounded-lg border border-sep">
              <IconChartLine size={20} className="text-action" aria-hidden="true" />
              <p className="text-body font-medium text-ink mt-1">Body analytics</p>
              <p className="text-caption text-ink-3">DEXA & FFMI tracking</p>
            </div>
          </div>
          
          <p className="text-ink-2">
            First, which units do you use? Pick a system, or set weight and length separately.
          </p>
        </div>
        
        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label="Units">
              {([
                { value: 'lb' as const, title: 'Imperial', detail: 'lb & inches', Icon: IconRuler2 },
                { value: 'kg' as const, title: 'Metric', detail: 'kg & cm', Icon: IconWorld },
              ]).map(({ value, title, detail, Icon }) => {
                // A system is "picked" only while both choices match it.
                const checked = selectedUnits === value && selectedLength === lengthUnitForWeightUnit(value);
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={`${title} (${detail})`}
                    data-testid={`units-option-${value}`}
                    onClick={() => pickSystem(value)}
                    className={`relative p-6 rounded-xl border-2 transition-all ${
                      checked ? 'border-action bg-action/10' : 'border-sep hover:border-sep bg-fill/50'
                    }`}
                  >
                    {checked && (
                      <span
                        aria-hidden="true"
                        className="absolute top-2 right-2 w-5 h-5 rounded-full bg-action text-on-action flex items-center justify-center"
                      >
                        <IconCheck size={13} stroke={3} />
                      </span>
                    )}
                    <div className="text-center">
                      <Icon size={36} className="mx-auto mb-2 text-action" aria-hidden="true" />
                      <div className="text-title font-bold text-ink">{title}</div>
                      <div className="text-body text-ink-2 mt-1">{detail}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* The two choices on their own, always visible: e.g. kg on the
                bar but inches for height and the tape. */}
            <div className="mt-5 space-y-3" data-testid="units-separate">
              <div>
                <p className="text-subhead font-medium text-ink mb-1.5">
                  Weight <span className="text-caption text-ink-3 font-normal">(lifts, body weight)</span>
                </p>
                <SegmentedControl<WeightUnit>
                  label="Weight units"
                  value={selectedUnits}
                  onChange={pickWeight}
                  options={[
                    { value: 'kg', label: 'kg' },
                    { value: 'lb', label: 'lb' },
                  ]}
                  className="w-full"
                />
              </div>
              <div>
                <p className="text-subhead font-medium text-ink mb-1.5">
                  Length <span className="text-caption text-ink-3 font-normal">(height, body measurements)</span>
                </p>
                <SegmentedControl<LengthUnit>
                  label="Length units"
                  value={selectedLength}
                  onChange={pickLength}
                  options={[
                    { value: 'cm', label: 'cm' },
                    { value: 'in', label: 'inches' },
                  ]}
                  className="w-full"
                />
              </div>
            </div>
            
            <p className="text-caption text-ink-3 text-center mt-4">
              You can change these anytime in Settings
            </p>
          </CardContent>
        </Card>

        {/* Text size: asked up front so everything after it is readable.
            Applies on tap (the preview and this whole page grow with it)
            and saves itself; Default unless the user picks otherwise. */}
        <Card data-testid="onboarding-text-size">
          <CardContent className="p-6 space-y-3">
            <div>
              <p className="text-headline text-ink">Text size</p>
              <p className="text-subhead text-ink-2 mt-0.5">Pick what&apos;s easiest to read.</p>
            </div>
            <TextSizeControl preview />
          </CardContent>
        </Card>
        
        <Button
          onClick={handleUnitsConfirm}
          className="w-full"
          size="lg"
          isLoading={isSavingUnits}
          aria-busy={isSavingUnits}
          data-testid="units-continue"
        >
          Continue with {selectedUnits} &amp; {selectedLength === 'in' ? 'inches' : 'cm'}
          <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
      </div>
    );
  }

  if (step === 'training') {
    const trainingStarter = starterFor(trainingAnswers);
    return (
      <TrainingStep
        answers={trainingAnswers}
        onChange={(next) => {
          trainingTouched.current = true;
          setTrainingAnswers(next);
        }}
        goal={goal}
        defaultRate={goal && goal !== 'maintenance' ? phaseToNutritionGoal(goal, null) : null}
        rateApplies={createStarterTargets}
        weightKg={useDexa && existingDexa ? existingDexa.weight_kg : getWeightKg()}
        units={units}
        targets={trainingStarter ? trainingStarter.targets : null}
        targetsCard={
          trainingStarter && sex
            ? {
                ...targetsCardFor(trainingStarter),
                sex,
                onCaloriesChange: setCalorieOverride,
                onProteinChange: setProteinOverride,
              }
            : null
        }
        skipTargets={createStarterTargets && starter ? starter.targets : null}
        busy={trainingBusy ?? (isLoading ? 'continue' : null)}
        onBack={() => setStep('goal')}
        onSkip={() => finishTrainingStep(true)}
        onContinue={() => finishTrainingStep(false)}
      />
    );
  }

  // Goal selection step
  if (step === 'goal') {
    const bf = useDexa && existingDexa ? existingDexa.body_fat_percent : parseFloat(bodyFatPercent);
    // Body-fat-aware guidance, mirroring the mesocycle builder's DEXA thresholds
    // A typical-value guess (skipped body fat) never drives a recommendation.
    const recommended: 'bulk' | 'cut' | null = bfEstimated || !bf || isNaN(bf)
      ? null
      : bf >= (sex === 'male' ? 20 : 30)
        ? 'cut'
        : bf <= (sex === 'male' ? 12 : 20)
          ? 'bulk'
          : null;

    return (
      <GoalStep
        goal={goal}
        onGoalChange={(g) => {
          goalTouched.current = true;
          setGoal(g);
          setGoalSource(null);
        }}
        preselection={goalSource}
        recommended={recommended}
        bodyFatPercent={bf}
        injuryAreas={injuryAreas}
        onInjuryAreasChange={setInjuryAreas}
        dailyTargets={
          existingTargets
            ? { ...existingTargets, kind: 'existing' }
            : createStarterTargets && starter
              ? {
                  calories: starter.targets.calories,
                  protein: starter.targets.protein,
                  kind: 'new',
                  ...targetsCardFor(starter),
                }
              : null
        }
        units={units}
        sex={sex}
        onProteinChange={setProteinOverride}
        onCaloriesChange={setCalorieOverride}
        targetsNeedAge={createStarterTargets && !getAge()}
        ageDisplay={ageDisplay}
        onAgeChange={setAgeDisplay}
        foodFocus={foodFocus}
        {...(foodFocus
          ? {}
          : {
              beginnerMode,
              onBeginnerModeChange: (value: boolean) => {
                beginnerTouched.current = true;
                setBeginnerMode(value);
              },
            })}
        experience={experienceShown}
        isLoading={isLoading}
        onBack={() => setStep('body-comp')}
        onContinue={handleGoalContinue}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="max-w-md mx-auto">
        <OnboardingSteps current="body" foodFocus={foodFocus} showLaterNote />
      </div>

      <div className="text-center mb-6">
        <h1 className="text-large-title font-bold text-ink mb-2">Body composition</h1>
        <p className="text-ink-2">
          Let&apos;s understand your body composition to personalize your training.
        </p>
      </div>

      {/* Context card explaining why we need this data */}
      <ContextCard
        cardKey="bodyComposition"
        className="mb-6"
        defaultCollapsed={false}
        collapsible={true}
      />
      
      {/* DEXA data notice */}
      {existingDexa && !useDexa && (
        <Card className="bg-action/10 border-action/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-action">DEXA Scan Data Found!</p>
                <p className="text-body text-ink-2">
                  We found your DEXA scan: {existingDexa.weight_kg}kg, {existingDexa.body_fat_percent.toFixed(1)}% body fat
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={handleUseDexa}>
                Use DEXA data
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      <div className="grid md:grid-cols-2 gap-6">
        {/* Input form */}
        <Card>
          <CardHeader>
            <CardTitle>Body composition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p id="sex-label" className="block text-body font-medium text-ink mb-2">Sex</p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="sex-label">
                {([
                  { value: 'female' as const, label: 'Female' },
                  { value: 'male' as const, label: 'Male' },
                ]).map((option) => {
                  const checked = sex === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      data-testid={`sex-option-${option.value}`}
                      onClick={() => {
                        setSex(option.value);
                        // A skipped-body-fat estimate follows the sex it was based on.
                        if (bfEstimated) setBodyFatPercent(typicalBodyFat(option.value));
                      }}
                      className={`min-h-[44px] rounded-input border-2 text-body font-medium transition-colors ${
                        checked ? 'border-action bg-action/10 text-ink' : 'border-sep bg-fill/50 text-ink-2 hover:text-ink'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-caption text-ink-3 mt-1">
                Used for body-fat references and strength comparisons.
              </p>
            </div>

            {/* Asked up front with the basics: it drives the calorie target. */}
            <Input
              label="Age (optional)"
              type="number"
              inputMode="numeric"
              value={ageDisplay}
              onChange={(e) => setAgeDisplay(e.target.value)}
              placeholder="30"
              min={13}
              max={100}
              hint="Used to work out your daily calorie target."
            />
            
            <HeightField
              unit={heightUnit}
              onUnitChange={switchHeightUnit}
              cm={heightDisplay}
              onCmChange={setHeightDisplay}
              feet={heightFeet}
              onFeetChange={setHeightFeet}
              inches={heightInches}
              onInchesChange={setHeightInches}
            />

            <Input
              label={`Weight (${units === 'lb' ? 'lbs' : 'kg'})`}
              type="number"
              value={useDexa && existingDexa 
                ? (units === 'lb' ? kgToLbs(existingDexa.weight_kg).toFixed(1) : String(existingDexa.weight_kg))
                : weightDisplay}
              onChange={(e) => {
                setUseDexa(false);
                setWeightDisplay(e.target.value);
              }}
              placeholder={units === 'lb' ? '175' : '80'}
              min={units === 'lb' ? 66 : 30}
              max={units === 'lb' ? 660 : 300}
              disabled={useDexa}
            />

            <div>
              {/* Why it's asked, right at the field, in terms of what it sets
                  (UX panel round 21). */}
              <p className="text-subhead text-ink-2 mb-2" data-testid="body-fat-why">
                <span className="font-medium text-ink">Why we ask:</span> it splits your weight into lean
                mass and fat. Your protein target is set from your lean mass, and so is your resting
                calorie burn. A scale or scan reading is best; a look-alike guess below is fine. Optional: you can skip it.
              </p>
              <Input
                label="Body fat %"
                type="number"
                value={useDexa && existingDexa ? String(existingDexa.body_fat_percent) : bodyFatPercent}
                onChange={(e) => {
                  setUseDexa(false);
                  setBfEstimated(false);
                  setBodyFatPercent(e.target.value);
                }}
                placeholder="15"
                min={3}
                max={60}
                step={0.5}
                disabled={useDexa}
                // A filled-in estimate must not look typed: muted italic
                // text and a dashed border until the user changes it.
                className={!useDexa && bfEstimated ? 'border-dashed italic text-ink-2' : undefined}
                aria-describedby={!useDexa && bfEstimated ? 'body-fat-estimate-note' : undefined}
                data-estimated={!useDexa && bfEstimated ? 'true' : undefined}
                hint={useDexa ? 'Using DEXA scan data' : undefined}
              />
              {!useDexa && bfEstimated && (
                <p
                  id="body-fat-estimate-note"
                  className="mt-1.5 text-subhead text-ink-2"
                  data-testid="body-fat-estimate-note"
                >
                  <span className="mr-1.5 inline-block rounded-full bg-fill px-2 py-0.5 text-caption font-medium text-ink">
                    Skipped
                  </span>
                  Using {bodyFatPercent}%, about average for {sex === 'female' ? 'women' : 'men'}, for now.
                  Type your own number any time.
                </p>
              )}
              {!useDexa && !bfEstimated && !(parseFloat(bodyFatPercent) > 0) && !sex && (
                <p className="mt-2 text-subhead text-ink-2" data-testid="body-fat-needs-sex">
                  Pick your sex above to see the look-alike guide or to skip this.
                </p>
              )}

              {/* The visual guide, right under the field whenever there's no
                  number yet (UX panel round 20: "body fat was asked without
                  any help for estimating it" while the guide hid behind a
                  button). The four looks are always there; photos on a tap. */}
              {!useDexa && sex && (showBodyFatGuide || bfEstimated || !(parseFloat(bodyFatPercent) > 0)) && (
                <div className="mt-3 p-3 bg-fill/50 rounded-lg border border-sep" data-testid="body-fat-guide">
                  <p className="text-body font-medium text-ink mb-2">
                    Not sure? Tap the look closest to yours:
                  </p>
                  {showBodyFatGuide && (
                    <div className="rounded-lg overflow-hidden mb-3 relative">
                      <Image
                        src={sex === 'male' ? '/images/body-fat-guide-male.png' : '/images/body-fat-guide-female.png'}
                        alt={`${sex === 'male' ? 'Male' : 'Female'} body fat percentage visual guide`}
                        width={600}
                        height={600}
                        className="w-full h-auto"
                        priority
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {BODY_FAT_OPTIONS[sex].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setBodyFatPercent(String(option.value));
                          setBfEstimated(false);
                          setShowBodyFatGuide(false);
                        }}
                        className={`min-h-[44px] p-2 rounded-lg text-center transition-all ${
                          !bfEstimated && bodyFatPercent === String(option.value)
                            ? 'bg-action text-on-action'
                            : 'bg-sep hover:bg-sep text-ink'
                        }`}
                      >
                        <p className="text-headline font-bold">{option.label}</p>
                        <p className="text-subhead opacity-80">{option.description}</p>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBodyFatGuide((v) => !v)}
                      className="min-h-[44px] text-subhead font-medium text-action"
                      data-testid="body-fat-photos"
                      aria-expanded={showBodyFatGuide}
                    >
                      {showBodyFatGuide ? 'Hide example photos' : 'See example photos'}
                    </button>
                    {!bfEstimated && !(parseFloat(bodyFatPercent) > 0) && (
                      <button
                        type="button"
                        className="min-h-[44px] text-subhead font-medium text-action"
                        data-testid="body-fat-not-sure"
                        onClick={() => {
                          // Typical adult values; flagged so nothing downstream
                          // presents a verdict built on a guess.
                          setBodyFatPercent(typicalBodyFat(sex));
                          setBfEstimated(true);
                          setShowBodyFatGuide(false);
                        }}
                      >
                        I don’t know — skip
                      </button>
                    )}
                  </div>
                  <p className="text-subhead text-ink-2 mt-1">
                    An estimate is fine. You can add a real number later on the Body composition page.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Results preview */}
        <Card>
          <CardHeader>
            <CardTitle>Your metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {bodyComp && bfEstimated ? (
              <p className="text-body text-ink-2" data-testid="body-comp-estimated">
                You skipped body fat, so we&apos;re using a typical value and leaving out the muscle-mass rating for now.
                Add your real number later on the Body composition page and we&apos;ll fill this in.
              </p>
            ) : bodyComp ? (
              <div className="space-y-6">
                {/* FFMI display */}
                <div className="text-center p-6 bg-fill/50 rounded-xl">
                  <p className="text-body text-ink-3 mb-1">
                    <ExplainedTerm term="FFMI" />
                  </p>
                  <p className="text-5xl font-bold text-ink mb-2">{bodyComp.ffmi.toFixed(1)}</p>
                  <p className={`text-subhead font-medium capitalize ${
                    bodyComp.ffmiBracket === 'elite' ? 'text-action' :
                    bodyComp.ffmiBracket === 'excellent' ? 'text-action' :
                    bodyComp.ffmiBracket === 'above_average' ? 'text-status-ok' :
                    bodyComp.ffmiBracket === 'average' ? 'text-ink' :
                    'text-ink-2'
                  }`}>
                    {bodyComp.ffmiBracket.replace('_', ' ')}
                  </p>
                </div>
                
                {/* Assessment with beginner-friendly context */}
                <div className="p-3 bg-fill/30 rounded-lg border border-sep">
                  <p className="text-body text-ink-2 mb-2">
                    {bodyComp.ffmiAssessment}
                  </p>
                  <p className="text-caption text-ink-3">
                    This helps us understand your current muscle development and set realistic goals.
                  </p>
                </div>
                
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-fill/50 rounded-lg text-center">
                    <p className="text-caption text-ink-3">Lean mass</p>
                    <p className="text-headline font-semibold text-ink">
                      {units === 'lb' 
                        ? `${kgToLbs(bodyComp.leanMassKg).toFixed(1)} lbs`
                        : `${bodyComp.leanMassKg.toFixed(1)} kg`}
                    </p>
                  </div>
                  <div className="p-3 bg-fill/50 rounded-lg text-center">
                    <p className="text-caption text-ink-3">Fat mass</p>
                    <p className="text-headline font-semibold text-ink">
                      {(() => {
                        const totalWeight = useDexa && existingDexa ? existingDexa.weight_kg : getWeightKg();
                        const fatMass = totalWeight - bodyComp.leanMassKg;
                        return units === 'lb' 
                          ? `${kgToLbs(fatMass).toFixed(1)} lbs`
                          : `${fatMass.toFixed(1)} kg`;
                      })()}
                    </p>
                  </div>
                </div>
                
                {/* FFMI scale */}
                <div className="space-y-2">
                  <p className="text-caption text-ink-3">FFMI Scale ({sex === 'male' ? 'Men' : 'Women'})</p>
                  <div className="h-3 bg-fill rounded-full overflow-hidden relative">
                    <div 
                      className="absolute top-0 left-0 h-full bg-sep "
                      style={{ width: '100%' }}
                    />
                    {/* Marker */}
                    <div 
                      className="absolute top-0 w-1 h-full bg-white shadow-lg"
                      style={{ 
                        left: `${Math.min(100, Math.max(0, ((bodyComp.ffmi - ffmiScaleMin) / 12) * 100))}%`,
                        transform: 'translateX(-50%)'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-caption text-ink-3">
                    {[0, 3, 6, 9, 12].map((d) => (
                      <span key={d}>{ffmiScaleMin + d}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-ink-3">
                <svg className="w-12 h-12 mx-auto mb-3 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <p>Enter your measurements to see your metrics</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Continue button */}
      <div className="flex flex-col items-end gap-2 pt-4">
        {missingBodyComp.length > 0 && (
          <p className="text-caption text-ink-2 text-right" data-testid="body-comp-missing">
            Add your {missingBodyComp.join(', ').replace(/, ([^,]*)$/, ' and $1')} to continue.
            {missingBodyComp.includes('body-fat estimate') &&
              ' Not sure of your body fat? Pick the closest look in the visual guide, or tap “I don’t know — skip”.'}
          </p>
        )}
        <Button
          size="lg"
          onClick={async () => {
            // Track progress - user completed body composition
            const supabase = createUntypedClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await updateOnboardingStep(supabase, user.id, 'body_comp');
            }
            setStep('goal');
          }}
          disabled={!canContinue}
        >
          Continue
          <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

