'use client';

import { useState } from 'react';
import { Button, Card, Slider } from '@/components/ui';
import type { PreWorkoutCheckIn, Rating } from '@/types/schema';
import { calculateReadinessScore, getReadinessInterpretation } from '@/services/fatigueEngine';

interface ReadinessCheckInProps {
  onSubmit: (checkIn: PreWorkoutCheckIn) => void;
  onSkip?: () => void;
}

export function ReadinessCheckIn({ onSubmit, onSkip }: ReadinessCheckInProps) {
  const [sleepHours, setSleepHours] = useState(7);
  const [sleepQuality, setSleepQuality] = useState<Rating>(3);
  const [stressLevel, setStressLevel] = useState<Rating>(3);
  const [nutritionRating, setNutritionRating] = useState<Rating>(3);
  const [bodyweight, setBodyweight] = useState('');

  const readinessScore = calculateReadinessScore({
    sleepHours,
    sleepQuality,
    stressLevel,
    nutritionRating,
  });

  const interpretation = getReadinessInterpretation(readinessScore);

  const handleSubmit = () => {
    const checkIn: PreWorkoutCheckIn = {
      sleepHours,
      sleepQuality,
      stressLevel,
      nutritionRating,
      bodyweightKg: bodyweight ? parseFloat(bodyweight) : null,
      readinessScore,
    };
    onSubmit(checkIn);
  };

  const getRatingLabel = (rating: Rating, type: 'sleep' | 'stress' | 'nutrition') => {
    const labels = {
      sleep: ['Terrible', 'Poor', 'Okay', 'Good', 'Great'],
      stress: ['Very High', 'High', 'Moderate', 'Low', 'Very Low'],
      nutrition: ['Poor', 'Below Average', 'Average', 'Good', 'Excellent'],
    };
    return labels[type][rating - 1];
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-success-400';
    if (score >= 60) return 'text-primary-400';
    if (score >= 40) return 'text-warning-400';
    return 'text-danger-400';
  };

  return (
    <Card variant="elevated" className="max-w-md mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-surface-100">
          Pre-Workout Check-In
        </h2>
        <p className="text-sm text-surface-400 mt-1">
          Help us optimize your workout based on how you're feeling today
        </p>
      </div>

      <div className="space-y-6">
        {/* Sleep Hours */}
        <div>
          <Slider
            label="Hours of Sleep"
            min={3}
            max={12}
            step={0.5}
            value={sleepHours}
            onChange={(e) => setSleepHours(parseFloat(e.target.value))}
            valueFormatter={(v) => `${v}h`}
            marks={[
              { value: 3, label: '3h' },
              { value: 6, label: '6h' },
              { value: 8, label: '8h' },
              { value: 12, label: '12h' },
            ]}
          />
        </div>

        {/* Sleep Quality */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-surface-200">
              Sleep Quality
            </label>
            <span className="text-sm text-primary-400">
              {getRatingLabel(sleepQuality, 'sleep')}
            </span>
          </div>
          <div className="flex gap-2">
            {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
              <button
                key={rating}
                onClick={() => setSleepQuality(rating)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  sleepQuality === rating
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                }`}
              >
                {rating}
              </button>
            ))}
          </div>
        </div>

        {/* Stress Level */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-surface-200">
              Stress Level
            </label>
            <span className="text-sm text-primary-400">
              {getRatingLabel(stressLevel, 'stress')}
            </span>
          </div>
          <div className="flex gap-2">
            {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
              <button
                key={rating}
                onClick={() => setStressLevel(rating)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  stressLevel === rating
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                }`}
              >
                {rating}
              </button>
            ))}
          </div>
          <p className="text-xs text-surface-500 mt-1">1 = Very High Stress, 5 = Very Low Stress</p>
        </div>

        {/* Nutrition */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-surface-200">
              Today's Nutrition
            </label>
            <span className="text-sm text-primary-400">
              {getRatingLabel(nutritionRating, 'nutrition')}
            </span>
          </div>
          <div className="flex gap-2">
            {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
              <button
                key={rating}
                onClick={() => setNutritionRating(rating)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  nutritionRating === rating
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                }`}
              >
                {rating}
              </button>
            ))}
          </div>
        </div>

        {/* Bodyweight (optional) */}
        <div>
          <label className="block text-sm font-medium text-surface-200 mb-1.5">
            Bodyweight (optional)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={bodyweight}
              onChange={(e) => setBodyweight(e.target.value)}
              placeholder="e.g., 75.5"
              step="0.1"
              className="flex-1 px-4 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <span className="text-surface-400">kg</span>
          </div>
        </div>

        {/* Readiness Score Display */}
        <div className="bg-surface-800/50 rounded-xl p-4 text-center">
          <p className="text-sm text-surface-400 mb-1">Readiness Score</p>
          <p className={`text-4xl font-bold ${getScoreColor(readinessScore)}`}>
            {readinessScore}
          </p>
          <p className={`text-sm mt-2 ${getScoreColor(readinessScore)}`}>
            {interpretation.message}
          </p>
          <p className="text-xs text-surface-500 mt-1">
            {interpretation.recommendation}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          {onSkip && (
            <Button variant="ghost" onClick={onSkip} className="flex-1">
              Skip
            </Button>
          )}
          <Button onClick={handleSubmit} className="flex-1">
            Start Workout
          </Button>
        </div>
      </div>
    </Card>
  );
}

