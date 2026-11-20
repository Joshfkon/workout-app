'use client';

import { IconAdjustments, IconAlertTriangle, IconBulb, IconPill, IconRun } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  calculateMacros,
  getGoalOptions,
  getActivityOptions,
  getPeptideOptions,
  lbsToKg,
  inchesToCm,
  type Goal,
  type ActivityLevel,
  type Sex,
  type Peptide,
  type MacroRecommendation,
  type CardioConfig,
  type CardioModality,
} from '@/lib/nutrition/macroCalculator';
import { saveMacroSettings, getMacroSettings } from '@/lib/actions/nutrition';

/** Round kg->lbs conversion artifacts (e.g. 171.078511999999) for display. */
const formatLbs = (lbs: number) => (Math.round(lbs * 10) / 10).toString();

/** Default 7-level goal when all we know is the user's current phase. */
const PHASE_TO_GOAL: Record<'bulk' | 'cut' | 'maintenance', Goal> = {
  cut: 'moderate_cut',
  maintenance: 'maintain',
  bulk: 'slow_bulk',
};

interface MacroCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meals_per_day?: number;
    cardio_prescription?: any;
  }) => Promise<void>;
  existingTargets?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  userStats?: {
    weightLbs?: number;
    heightInches?: number;
    age?: number;
    sex?: Sex;
    bodyFatPercent?: number;
  };
  workoutsPerWeek?: number;
  /** User's current training phase (users.goal), used to pre-select the goal. */
  currentPhase?: 'bulk' | 'cut' | 'maintenance';
}

export function MacroCalculatorModal({
  isOpen,
  onClose,
  onApply,
  existingTargets,
  userStats,
  workoutsPerWeek = 4,
  currentPhase,
}: MacroCalculatorModalProps) {
  // User stats
  const [weight, setWeight] = useState(
    userStats?.weightLbs != null ? formatLbs(userStats.weightLbs) : ''
  );
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [age, setAge] = useState(userStats?.age?.toString() || '');
  const [sex, setSex] = useState<Sex>(userStats?.sex || 'male');
  const [bodyFat, setBodyFat] = useState(userStats?.bodyFatPercent?.toString() || '');

  // Activity
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate');
  const [workouts, setWorkouts] = useState(workoutsPerWeek.toString());
  const [workoutDuration, setWorkoutDuration] = useState('60');
  const [workoutIntensity, setWorkoutIntensity] = useState<'light' | 'moderate' | 'intense'>('moderate');

  // Goal
  const [goal, setGoal] = useState<Goal>('maintain');
  
  // Peptides/Medications
  const [peptide, setPeptide] = useState<Peptide>('none');

  // Cardio Configuration
  const [cardioEnabled, setCardioEnabled] = useState(true);
  const [cardioMode, setCardioMode] = useState<'lifestyle' | 'prep'>('lifestyle');
  const [cardioModality, setCardioModality] = useState<CardioModality>('incline_walk');
  const [cardioNetEfficiency, setCardioNetEfficiency] = useState('0.65');

  // Results
  const [recommendation, setRecommendation] = useState<MacroRecommendation | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');

  // Update form when userStats props change (after data loads)
  useEffect(() => {
    if (userStats?.weightLbs) {
      setWeight(formatLbs(userStats.weightLbs));
    }
    if (userStats?.heightInches) {
      const feet = Math.floor(userStats.heightInches / 12);
      const inches = userStats.heightInches % 12;
      setHeightFeet(feet.toString());
      setHeightInches(inches.toString());
    }
    if (userStats?.age) {
      setAge(userStats.age.toString());
    }
    if (userStats?.sex) {
      setSex(userStats.sex);
    }
    if (userStats?.bodyFatPercent) {
      setBodyFat(userStats.bodyFatPercent.toString());
    }
  }, [userStats]);

  // Update workouts when prop changes
  useEffect(() => {
    if (workoutsPerWeek) {
      setWorkouts(workoutsPerWeek.toString());
    }
  }, [workoutsPerWeek]);

  // Seed the form from saved macro settings when the modal opens, so reopening
  // the calculator doesn't silently reset goal/activity/peptide to defaults
  // (applying with the stale 'maintain' default used to flip a bulking or
  // cutting user back to maintenance). Falls back to the profile phase for
  // users who have never saved macro settings.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getMacroSettings()
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          if (saved.goal) setGoal(saved.goal);
          if (saved.activity_level) setActivityLevel(saved.activity_level);
          setPeptide(saved.peptide || 'none');
          if (saved.workout_intensity) setWorkoutIntensity(saved.workout_intensity);
          if (saved.avg_workout_minutes) setWorkoutDuration(saved.avg_workout_minutes.toString());
        } else if (currentPhase) {
          setGoal(PHASE_TO_GOAL[currentPhase]);
        }
      })
      .catch(() => {
        if (!cancelled && currentPhase) setGoal(PHASE_TO_GOAL[currentPhase]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentPhase]);

  const calculateRecommendation = () => {
    setError('');

    const weightLbs = parseFloat(weight);
    const feet = parseFloat(heightFeet) || 0;
    const inches = parseFloat(heightInches) || 0;
    const totalInches = (feet * 12) + inches;
    const ageNum = parseInt(age);

    if (!weightLbs || weightLbs <= 0) {
      setError('Please enter your weight');
      return;
    }
    if (totalInches <= 0) {
      setError('Please enter your height');
      return;
    }
    if (!ageNum || ageNum <= 0) {
      setError('Please enter your age');
      return;
    }

    const weightKg = lbsToKg(weightLbs);
    const heightCm = inchesToCm(totalInches);
    const bodyFatPercent = bodyFat ? parseFloat(bodyFat) : undefined;

    // Build cardio config
    const cardioConfig: CardioConfig | undefined = cardioEnabled ? {
      enabled: true,
      mode: cardioMode,
      modality: cardioModality,
      netEfficiency: parseFloat(cardioNetEfficiency) || 0.65,
    } : undefined;

    const result = calculateMacros(
      {
        weightKg,
        heightCm,
        age: ageNum,
        sex,
        bodyFatPercent,
      },
      {
        activityLevel,
        workoutsPerWeek: parseInt(workouts) || 4,
        avgWorkoutMinutes: parseInt(workoutDuration) || 60,
        workoutIntensity,
      },
      { goal, peptide },
      undefined, // overrideTDEE
      cardioConfig
    );

    setRecommendation(result);
  };

  const handleApply = async () => {
    if (!recommendation) return;

    setIsApplying(true);
    try {
      // Save macro targets (include cardio prescription if present)
      await onApply({
        calories: recommendation.calories,
        protein: recommendation.protein,
        carbs: recommendation.carbs,
        fat: recommendation.fat,
        cardio_prescription: recommendation.cardioPrescription || null,
      });
      
      // Save macro settings for auto-recalculation when weight changes
      const totalHeightInches = (parseFloat(heightFeet) * 12) + parseFloat(heightInches);
      const heightCm = inchesToCm(totalHeightInches);
      
      await saveMacroSettings({
        height_cm: heightCm,
        age: parseInt(age),
        sex: sex,
        activity_level: activityLevel,
        workouts_per_week: parseInt(workouts),
        avg_workout_minutes: parseInt(workoutDuration),
        workout_intensity: workoutIntensity,
        goal: goal,
        target_weight_change_per_week: null, // Using goal default
        peptide: peptide,
        auto_update_enabled: true,
      });
      
      onClose();
    } catch (err) {
      setError('Failed to save targets. Please try again.');
    } finally {
      setIsApplying(false);
    }
  };

  const goalOptions = getGoalOptions();
  const activityOptions = getActivityOptions();
  const peptideOptions = getPeptideOptions();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Smart Macro Calculator"
      size="lg"
    >
      <div className="space-y-6">
        {error && (
          <div className="p-3 text-sm text-status-bad bg-status-bad/10 border border-status-bad/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Step 1: Your Stats */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">
            Your Stats
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">
                Weight (lbs)
              </label>
              <Input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="175"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">
                Age
              </label>
              <Input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">
              Height
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="number"
                  value={heightFeet}
                  onChange={(e) => setHeightFeet(e.target.value)}
                  placeholder="5"
                />
                <span className="text-xs text-ink-3 mt-1">feet</span>
              </div>
              <div className="flex-1">
                <Input
                  type="number"
                  value={heightInches}
                  onChange={(e) => setHeightInches(e.target.value)}
                  placeholder="10"
                />
                <span className="text-xs text-ink-3 mt-1">inches</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">
                Sex
              </label>
              <Select
                value={sex}
                onChange={(e) => setSex(e.target.value as Sex)}
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">
                Body Fat % (optional)
              </label>
              <Input
                type="number"
                value={bodyFat}
                onChange={(e) => setBodyFat(e.target.value)}
                placeholder="15"
              />
            </div>
          </div>
        </div>

        {/* Step 2: Activity Level */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">
            Activity Level
          </h3>

          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">
              Daily Activity (excluding workouts)
            </label>
            <Select
              value={activityLevel}
              onChange={(e) => setActivityLevel(e.target.value as ActivityLevel)}
              options={activityOptions.map(opt => ({
                value: opt.value,
                label: `${opt.label} - ${opt.description}`,
              }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">
                Workouts/Week
              </label>
              <Input
                type="number"
                value={workouts}
                onChange={(e) => setWorkouts(e.target.value)}
                min="0"
                max="14"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">
                Duration (min)
              </label>
              <Input
                type="number"
                value={workoutDuration}
                onChange={(e) => setWorkoutDuration(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">
                Intensity
              </label>
              <Select
                value={workoutIntensity}
                onChange={(e) => setWorkoutIntensity(e.target.value as 'light' | 'moderate' | 'intense')}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'moderate', label: 'Moderate' },
                  { value: 'intense', label: 'Intense' },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Step 3: Goal */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">
            Your Goal
          </h3>
          <p className="text-xs text-ink-2">
            This also sets your training phase (bulk / cut / maintain) used for progression and volume recommendations.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {goalOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGoal(opt.value)}
                className={`p-2 rounded-lg border text-center transition-colors ${
                  goal === opt.value
                    ? 'border-action bg-action/10'
                    : 'border-sep hover:border-sep'
                }`}
              >
                <div className="text-sm font-medium text-ink">{opt.label}</div>
                <div className="text-xs text-ink-2">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 4: Medications/Peptides */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">
            Medications (Optional)
          </h3>
          <p className="text-xs text-ink-2">
            GLP-1 medications affect appetite and require higher protein to prevent muscle loss.
          </p>

          <Select
            value={peptide}
            onChange={(e) => setPeptide(e.target.value as Peptide)}
            options={peptideOptions.map(opt => ({
              value: opt.value,
              label: opt.label,
            }))}
          />
          
          {peptide !== 'none' && (
            <div className="p-3 bg-status-warn/10 border border-status-warn/20 rounded-lg">
              <p className="text-sm text-status-warn">
                <IconPill size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />
                <strong>Peptide Adjustments:</strong> Protein increased to prevent muscle loss. 
                You may tolerate a larger deficit due to reduced appetite.
              </p>
            </div>
          )}
        </div>

        {/* Step 5: Cardio Configuration (only show when cutting) */}
        {(goal.includes('cut')) && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">
              Zone 2 Cardio (Optional)
            </h3>
            <p className="text-xs text-ink-2">
              When macro floors block your desired cut rate, cardio can help you reach your goal by burning stored body fat without reducing essential dietary nutrients.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cardio-enabled"
                checked={cardioEnabled}
                onChange={(e) => setCardioEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-sep bg-fill text-action focus:ring-action"
              />
              <label htmlFor="cardio-enabled" className="text-sm text-ink-2">
                Enable cardio prescription
              </label>
            </div>

            {cardioEnabled && (
              <div className="space-y-3 p-3 bg-fill/50 border border-sep rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink-2 mb-1">
                      Mode
                    </label>
                    <Select
                      value={cardioMode}
                      onChange={(e) => setCardioMode(e.target.value as 'lifestyle' | 'prep')}
                      options={[
                        { value: 'lifestyle', label: 'Lifestyle (45 min/day cap)' },
                        { value: 'prep', label: 'Prep (90 min/day cap)' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-2 mb-1">
                      Modality
                    </label>
                    <Select
                      value={cardioModality}
                      onChange={(e) => setCardioModality(e.target.value as CardioModality)}
                      options={[
                        { value: 'incline_walk', label: 'Incline Walk' },
                        { value: 'bike', label: 'Bike' },
                        { value: 'elliptical', label: 'Elliptical' },
                        { value: 'rower', label: 'Rower' },
                      ]}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">
                    Net Efficiency ({cardioNetEfficiency})
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="0.8"
                    step="0.05"
                    value={cardioNetEfficiency}
                    onChange={(e) => setCardioNetEfficiency(e.target.value)}
                    className="w-full"
                  />
                  <p className="text-xs text-ink-3 mt-1">
                    Accounts for NEAT drop and metabolic efficiency (0.6-0.75 typical)
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Calculate Button */}
        <Button onClick={calculateRecommendation} variant="primary" className="w-full">
          Calculate My Macros
        </Button>

        {/* Results */}
        {recommendation && (
          <div className="space-y-4 p-4 bg-fill/50 border border-sep rounded-lg">
            <h3 className="text-lg font-semibold text-ink">
              Your Recommended Targets
            </h3>

            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-action">
                  {recommendation.calories}
                </div>
                <div className="text-sm text-ink-2">Calories</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-action">
                  {recommendation.protein}g
                </div>
                <div className="text-sm text-ink-2">Protein</div>
                <div className="text-xs text-ink-3">{recommendation.proteinPercent}%</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-status-warn">
                  {recommendation.carbs}g
                </div>
                <div className="text-sm text-ink-2">Carbs</div>
                <div className="text-xs text-ink-3">{recommendation.carbsPercent}%</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-status-bad">
                  {recommendation.fat}g
                </div>
                <div className="text-sm text-ink-2">Fat</div>
                <div className="text-xs text-ink-3">{recommendation.fatPercent}%</div>
              </div>
            </div>

            <div className="text-sm text-ink-2 bg-card/50 p-3 rounded-lg space-y-2">
              <p className="mb-2">{recommendation.explanation}</p>
              
              {/* Energy Metrics */}
              <div className="flex flex-wrap gap-4 text-xs text-ink-2 pt-2 border-t border-sep">
                <span>BMR: {recommendation.bmr} cal</span>
                <span>TDEE: {recommendation.tdee} cal</span>
                {recommendation.deficit !== 0 && (
                  <span>
                    {recommendation.deficit < 0 ? 'Deficit' : 'Surplus'}: {Math.abs(recommendation.deficit)} cal/day
                  </span>
                )}
                {Math.abs(recommendation.weeklyChangeKg) > 0.01 && (
                  <span>
                    {recommendation.weeklyChangeKg < 0 ? 'Loss' : 'Gain'}: {Math.abs(recommendation.weeklyChangeLbs).toFixed(2)} lb/week
                  </span>
                )}
              </div>

              {/* Show requested vs final only when the difference is meaningful —
                  macro rounding always shifts final calories by a few kcal, and a
                  "2308 → 2305 (−3 cal)" adjustment is noise, not information */}
              {(Math.abs(recommendation.calories - recommendation.requestedCalories) >= 25 ||
                Math.abs(recommendation.requestedWeeklyChangeKg - recommendation.weeklyChangeKg) >= 0.023) && (
                <div className="pt-2 border-t border-sep">
                  <p className="text-xs font-medium text-ink-2 mb-1">Adjustments Applied:</p>
                  {Math.abs(recommendation.calories - recommendation.requestedCalories) >= 25 && (
                    <p className="text-xs text-ink-3">
                      Calories: {recommendation.requestedCalories} → {recommendation.calories}
                      ({recommendation.calories - recommendation.requestedCalories > 0 ? '+' : ''}
                      {recommendation.calories - recommendation.requestedCalories} cal)
                    </p>
                  )}
                  {Math.abs(recommendation.requestedWeeklyChangeKg - recommendation.weeklyChangeKg) >= 0.023 && (
                    <p className="text-xs text-ink-3">
                      Weekly change: {recommendation.requestedWeeklyChangeKg.toFixed(3)} kg → {recommendation.weeklyChangeKg.toFixed(3)} kg
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Guardrails Applied */}
            {recommendation.guardrailsApplied && recommendation.guardrailsApplied.length > 0 && (
              <div className="p-3 bg-action/10 border border-action/20 rounded-lg">
                <p className="text-xs font-medium text-action mb-2">
                  <IconAdjustments size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />
                  Guardrails Applied:
                </p>
                <ul className="space-y-1">
                  {recommendation.guardrailsApplied.map((guardrail, index) => (
                    <li key={index} className="text-xs text-action">
                      • {guardrail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Peptide Notes */}
            {recommendation.peptideNotes && (
              <div className="p-3 bg-action/10 border border-action/20 rounded-lg">
                <p className="text-sm text-action">
                  <IconBulb size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />
                  <strong>Peptide Tip:</strong> {recommendation.peptideNotes}
                </p>
              </div>
            )}

            {/* Cardio Prescription */}
            {recommendation.cardioPrescription && recommendation.cardioPrescription.needed && (
              <div className="p-4 bg-action/10 border border-action/20 rounded-lg space-y-3">
                <div className="flex items-start gap-2">
                  <IconRun size={20} className="shrink-0 text-action" aria-hidden="true" />
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-action mb-1">
                      Zone 2 Cardio Prescription
                    </h4>
                    <p className="text-xs text-action mb-2">
                      {recommendation.cardioPrescription.summary}
                    </p>
                    <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                      <div>
                        <span className="text-ink-2">Minutes/Day:</span>
                        <span className="ml-2 font-semibold text-ink">
                          {recommendation.cardioPrescription.prescribedMinutesPerDay}
                        </span>
                      </div>
                      <div>
                        <span className="text-ink-2">Minutes/Week:</span>
                        <span className="ml-2 font-semibold text-ink">
                          {recommendation.cardioPrescription.prescribedMinutesPerWeek}
                        </span>
                      </div>
                      <div>
                        <span className="text-ink-2">Kcal/Day:</span>
                        <span className="ml-2 font-semibold text-ink">
                          ~{recommendation.cardioPrescription.shortfallKcalPerDay}
                        </span>
                      </div>
                      <div>
                        <span className="text-ink-2">Loss Rate:</span>
                        <span className="ml-2 font-semibold text-ink">
                          {recommendation.cardioPrescription.withCardioWeeklyLossLbs} lb/wk
                        </span>
                      </div>
                    </div>
                    {recommendation.cardioPrescription.hitCap && (
                      <div className="mt-2 p-2 bg-status-warn/10 border border-status-warn/20 rounded text-xs text-status-warn">
                        <IconAlertTriangle size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />
                        Cardio capped at {recommendation.cardioPrescription.capMinutesPerDay} min/day
                      </div>
                    )}
                    <div className="mt-3 p-2 bg-card/50 rounded text-xs text-ink-2">
                      <strong className="text-ink-2">Why cardio ≠ eating less:</strong> {recommendation.cardioPrescription.whyCardioNotDiet}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={handleApply}
              variant="primary"
              disabled={isApplying}
              className="w-full"
            >
              {isApplying ? 'Applying...' : 'Apply These Targets'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

