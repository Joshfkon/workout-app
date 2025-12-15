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
} from '@/lib/nutrition/macroCalculator';

interface MacroCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
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
      { goal, peptide }
    );

    setRecommendation(result);
  };

  const handleApply = async () => {
    if (!recommendation) return;

    setIsApplying(true);
    try {
      await onApply({
        calories: recommendation.calories,
        protein: recommendation.protein,
        carbs: recommendation.carbs,
        fat: recommendation.fat,
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

            <div className="text-sm text-surface-300 bg-surface-900/50 p-3 rounded-lg">
              <p className="mb-2">{recommendation.explanation}</p>
              <div className="flex flex-wrap gap-4 text-xs text-surface-400">
                <span>BMR: {recommendation.bmr} cal</span>
                <span>TDEE: {recommendation.tdee} cal</span>
                {recommendation.deficit !== 0 && (
                  <span>
                    {recommendation.deficit < 0 ? 'Deficit' : 'Surplus'}: {Math.abs(recommendation.deficit)} cal/day
                  </span>
                )}
              </div>
            </div>

            {recommendation.peptideNotes && (
              <div className="p-3 bg-accent-500/10 border border-accent-500/20 rounded-lg">
                <p className="text-sm text-accent-300">
                  💡 <strong>Peptide Tip:</strong> {recommendation.peptideNotes}
                </p>
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

