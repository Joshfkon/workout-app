'use client';

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
import { saveMacroSettings } from '@/lib/actions/nutrition';

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
}

export function MacroCalculatorModal({
  isOpen,
  onClose,
  onApply,
  existingTargets,
  userStats,
  workoutsPerWeek = 4,
}: MacroCalculatorModalProps) {
  // User stats
  const [weight, setWeight] = useState(userStats?.weightLbs?.toString() || '');
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
      setWeight(userStats.weightLbs.toString());
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
      <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
        {error && (
          <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Step 1: Your Stats */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
            Your Stats
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
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
              <label className="block text-sm font-medium text-surface-300 mb-1">
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
            <label className="block text-sm font-medium text-surface-300 mb-1">
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
                <span className="text-xs text-surface-500 mt-1">feet</span>
              </div>
              <div className="flex-1">
                <Input
                  type="number"
                  value={heightInches}
                  onChange={(e) => setHeightInches(e.target.value)}
                  placeholder="10"
                />
                <span className="text-xs text-surface-500 mt-1">inches</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
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
              <label className="block text-sm font-medium text-surface-300 mb-1">
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
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
            Activity Level
          </h3>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1">
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
              <label className="block text-sm font-medium text-surface-300 mb-1">
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
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Duration (min)
              </label>
              <Input
                type="number"
                value={workoutDuration}
                onChange={(e) => setWorkoutDuration(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
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
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
            Your Goal
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {goalOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGoal(opt.value)}
                className={`p-2 rounded-lg border text-center transition-colors ${
                  goal === opt.value
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-700 hover:border-surface-600'
                }`}
              >
                <div className="text-sm font-medium text-surface-100">{opt.label}</div>
                <div className="text-xs text-surface-400">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 4: Medications/Peptides */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
            Medications (Optional)
          </h3>
          <p className="text-xs text-surface-400">
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
            <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg">
              <p className="text-sm text-warning-300">
                💊 <strong>Peptide Adjustments:</strong> Protein increased to prevent muscle loss. 
                You may tolerate a larger deficit due to reduced appetite.
              </p>
            </div>
          )}
        </div>

        {/* Step 5: Cardio Configuration (only show when cutting) */}
        {(goal.includes('cut')) && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
              Zone 2 Cardio (Optional)
            </h3>
            <p className="text-xs text-surface-400">
              When macro floors block your desired cut rate, cardio can help you reach your goal by burning stored body fat without reducing essential dietary nutrients.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cardio-enabled"
                checked={cardioEnabled}
                onChange={(e) => setCardioEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-surface-700 bg-surface-800 text-primary-500 focus:ring-primary-500"
              />
              <label htmlFor="cardio-enabled" className="text-sm text-surface-300">
                Enable cardio prescription
              </label>
            </div>

            {cardioEnabled && (
              <div className="space-y-3 p-3 bg-surface-800/50 border border-surface-700 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-1">
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
                    <label className="block text-sm font-medium text-surface-300 mb-1">
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
                  <label className="block text-sm font-medium text-surface-300 mb-1">
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
                  <p className="text-xs text-surface-500 mt-1">
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
          <div className="space-y-4 p-4 bg-surface-800/50 border border-surface-700 rounded-lg">
            <h3 className="text-lg font-semibold text-surface-100">
              Your Recommended Targets
            </h3>

            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-primary-400">
                  {recommendation.calories}
                </div>
                <div className="text-sm text-surface-400">Calories</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-accent-400">
                  {recommendation.protein}g
                </div>
                <div className="text-sm text-surface-400">Protein</div>
                <div className="text-xs text-surface-500">{recommendation.proteinPercent}%</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-warning-400">
                  {recommendation.carbs}g
                </div>
                <div className="text-sm text-surface-400">Carbs</div>
                <div className="text-xs text-surface-500">{recommendation.carbsPercent}%</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-danger-400">
                  {recommendation.fat}g
                </div>
                <div className="text-sm text-surface-400">Fat</div>
                <div className="text-xs text-surface-500">{recommendation.fatPercent}%</div>
              </div>
            </div>

            <div className="text-sm text-surface-300 bg-surface-900/50 p-3 rounded-lg space-y-2">
              <p className="mb-2">{recommendation.explanation}</p>
              
              {/* Energy Metrics */}
              <div className="flex flex-wrap gap-4 text-xs text-surface-400 pt-2 border-t border-surface-800">
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

              {/* Show requested vs final if they differ */}
              {(recommendation.requestedCalories !== recommendation.calories || 
                Math.abs(recommendation.requestedWeeklyChangeKg - recommendation.weeklyChangeKg) > 0.01) && (
                <div className="pt-2 border-t border-surface-800">
                  <p className="text-xs font-medium text-surface-400 mb-1">Adjustments Applied:</p>
                  {recommendation.requestedCalories !== recommendation.calories && (
                    <p className="text-xs text-surface-500">
                      Calories: {recommendation.requestedCalories} → {recommendation.calories} 
                      ({recommendation.calories - recommendation.requestedCalories > 0 ? '+' : ''}
                      {recommendation.calories - recommendation.requestedCalories} cal)
                    </p>
                  )}
                  {Math.abs(recommendation.requestedWeeklyChangeKg - recommendation.weeklyChangeKg) > 0.01 && (
                    <p className="text-xs text-surface-500">
                      Weekly change: {recommendation.requestedWeeklyChangeKg.toFixed(3)} kg → {recommendation.weeklyChangeKg.toFixed(3)} kg
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Guardrails Applied */}
            {recommendation.guardrailsApplied && recommendation.guardrailsApplied.length > 0 && (
              <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                <p className="text-xs font-medium text-primary-300 mb-2">
                  ⚙️ Guardrails Applied:
                </p>
                <ul className="space-y-1">
                  {recommendation.guardrailsApplied.map((guardrail, index) => (
                    <li key={index} className="text-xs text-primary-400">
                      • {guardrail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Peptide Notes */}
            {recommendation.peptideNotes && (
              <div className="p-3 bg-accent-500/10 border border-accent-500/20 rounded-lg">
                <p className="text-sm text-accent-300">
                  💡 <strong>Peptide Tip:</strong> {recommendation.peptideNotes}
                </p>
              </div>
            )}

            {/* Cardio Prescription */}
            {recommendation.cardioPrescription && recommendation.cardioPrescription.needed && (
              <div className="p-4 bg-primary-500/10 border border-primary-500/20 rounded-lg space-y-3">
                <div className="flex items-start gap-2">
                  <span className="text-xl">🏃</span>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-primary-300 mb-1">
                      Zone 2 Cardio Prescription
                    </h4>
                    <p className="text-xs text-primary-400 mb-2">
                      {recommendation.cardioPrescription.summary}
                    </p>
                    <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                      <div>
                        <span className="text-surface-400">Minutes/Day:</span>
                        <span className="ml-2 font-semibold text-surface-200">
                          {recommendation.cardioPrescription.prescribedMinutesPerDay}
                        </span>
                      </div>
                      <div>
                        <span className="text-surface-400">Minutes/Week:</span>
                        <span className="ml-2 font-semibold text-surface-200">
                          {recommendation.cardioPrescription.prescribedMinutesPerWeek}
                        </span>
                      </div>
                      <div>
                        <span className="text-surface-400">Kcal/Day:</span>
                        <span className="ml-2 font-semibold text-surface-200">
                          ~{recommendation.cardioPrescription.shortfallKcalPerDay}
                        </span>
                      </div>
                      <div>
                        <span className="text-surface-400">Loss Rate:</span>
                        <span className="ml-2 font-semibold text-surface-200">
                          {recommendation.cardioPrescription.withCardioWeeklyLossLbs} lb/wk
                        </span>
                      </div>
                    </div>
                    {recommendation.cardioPrescription.hitCap && (
                      <div className="mt-2 p-2 bg-warning-500/10 border border-warning-500/20 rounded text-xs text-warning-300">
                        ⚠️ Cardio capped at {recommendation.cardioPrescription.capMinutesPerDay} min/day
                      </div>
                    )}
                    <div className="mt-3 p-2 bg-surface-900/50 rounded text-xs text-surface-400">
                      <strong className="text-surface-300">Why cardio ≠ eating less:</strong> {recommendation.cardioPrescription.whyCardioNotDiet}
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

