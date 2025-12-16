'use client';

import { useState } from 'react';
import { Button, Card, Slider, Badge } from '@/components/ui';
import type { PreWorkoutCheckIn, Rating, TemporaryInjury, WeightUnit } from '@/types/schema';
import { calculateReadinessScore, getReadinessInterpretation } from '@/services/fatigueEngine';

// Injury area options with display names
const INJURY_AREAS: { value: TemporaryInjury['area']; label: string; icon: string }[] = [
  { value: 'lower_back', label: 'Lower Back', icon: '🔻' },
  { value: 'upper_back', label: 'Upper Back', icon: '🔺' },
  { value: 'neck', label: 'Neck', icon: '🦴' },
  { value: 'shoulder_left', label: 'Left Shoulder', icon: '💪' },
  { value: 'shoulder_right', label: 'Right Shoulder', icon: '💪' },
  { value: 'elbow_left', label: 'Left Elbow', icon: '🦾' },
  { value: 'elbow_right', label: 'Right Elbow', icon: '🦾' },
  { value: 'wrist_left', label: 'Left Wrist', icon: '🤚' },
  { value: 'wrist_right', label: 'Right Wrist', icon: '🤚' },
  { value: 'hip_left', label: 'Left Hip', icon: '🦵' },
  { value: 'hip_right', label: 'Right Hip', icon: '🦵' },
  { value: 'knee_left', label: 'Left Knee', icon: '🦿' },
  { value: 'knee_right', label: 'Right Knee', icon: '🦿' },
  { value: 'ankle_left', label: 'Left Ankle', icon: '🦶' },
  { value: 'ankle_right', label: 'Right Ankle', icon: '🦶' },
  { value: 'chest', label: 'Chest', icon: '❤️' },
  { value: 'other', label: 'Other', icon: '⚠️' },
];

// Convert lbs to kg
const lbsToKg = (lbs: number) => lbs * 0.453592;

interface TodayNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  targetCalories?: number;
  targetProtein?: number;
}

interface ReadinessCheckInProps {
  onSubmit: (checkIn: PreWorkoutCheckIn) => void;
  onSkip?: () => void;
  onSkipPermanently?: () => void;
  unit?: WeightUnit;
  todayNutrition?: TodayNutrition;
}

export function ReadinessCheckIn({ onSubmit, onSkip, onSkipPermanently, unit = 'kg', todayNutrition }: ReadinessCheckInProps) {
  const [sleepHours, setSleepHours] = useState(7);
  const [sleepQuality, setSleepQuality] = useState<Rating>(3);
  const [stressLevel, setStressLevel] = useState<Rating>(3);
  const [bodyweight, setBodyweight] = useState('');
  const [showInjurySection, setShowInjurySection] = useState(false);
  const [temporaryInjuries, setTemporaryInjuries] = useState<TemporaryInjury[]>([]);
  const [selectedArea, setSelectedArea] = useState<TemporaryInjury['area'] | ''>('');
  const [selectedSeverity, setSelectedSeverity] = useState<1 | 2 | 3>(1);
  
  // Calculate nutrition rating from logged data
  const getNutritionRating = (): Rating => {
    if (!todayNutrition) return 3; // Default if no data
    
    const { calories, protein, targetCalories, targetProtein } = todayNutrition;
    
    // If no targets, just check if they've eaten something
    if (!targetCalories && !targetProtein) {
      if (calories === 0) return 1;
      if (calories < 500) return 2;
      if (protein >= 50) return 4;
      return 3;
    }
    
    // Calculate how close they are to targets
    const caloriePercent = targetCalories ? (calories / targetCalories) * 100 : 100;
    const proteinPercent = targetProtein ? (protein / targetProtein) * 100 : 100;
    
    // Weight protein more heavily for workout performance
    const score = (caloriePercent * 0.4) + (proteinPercent * 0.6);
    
    if (score >= 90) return 5;
    if (score >= 75) return 4;
    if (score >= 50) return 3;
    if (score >= 25) return 2;
    return 1;
  };
  
  const nutritionRating = getNutritionRating();

  const addInjury = () => {
    if (selectedArea) {
      // Check if already added
      if (!temporaryInjuries.some(i => i.area === selectedArea)) {
        setTemporaryInjuries([...temporaryInjuries, { area: selectedArea, severity: selectedSeverity }]);
      }
      setSelectedArea('');
      setSelectedSeverity(1);
    }
  };

  const removeInjury = (area: TemporaryInjury['area']) => {
    setTemporaryInjuries(temporaryInjuries.filter(i => i.area !== area));
  };

  const readinessScore = calculateReadinessScore({
    sleepHours,
    sleepQuality,
    stressLevel,
    nutritionRating,
  });

  const interpretation = getReadinessInterpretation(readinessScore);

  const handleSubmit = () => {
    // Convert bodyweight to kg if entered in lbs
    let bodyweightKg: number | null = null;
    if (bodyweight) {
      const enteredWeight = parseFloat(bodyweight);
      bodyweightKg = unit === 'lb' ? lbsToKg(enteredWeight) : enteredWeight;
    }
    
    const checkIn: PreWorkoutCheckIn = {
      sleepHours,
      sleepQuality,
      stressLevel,
      nutritionRating,
      bodyweightKg,
      readinessScore,
      temporaryInjuries: temporaryInjuries.length > 0 ? temporaryInjuries : undefined,
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
          Help us optimize your workout based on how you&apos;re feeling today
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

        {/* Today's Nutrition (from logging) */}
        <div className="p-4 bg-surface-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-surface-200">
              Today&apos;s Nutrition
            </label>
            <span className={`text-sm font-medium ${
              nutritionRating >= 4 ? 'text-success-400' : 
              nutritionRating >= 3 ? 'text-primary-400' : 
              nutritionRating >= 2 ? 'text-warning-400' : 'text-danger-400'
            }`}>
              {getRatingLabel(nutritionRating, 'nutrition')}
            </span>
          </div>
          {todayNutrition ? (
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-2 bg-surface-900/50 rounded">
                <p className="text-lg font-bold text-surface-100">{todayNutrition.calories}</p>
                <p className="text-xs text-surface-500">cal</p>
              </div>
              <div className="p-2 bg-surface-900/50 rounded">
                <p className="text-lg font-bold text-primary-400">{todayNutrition.protein}g</p>
                <p className="text-xs text-surface-500">protein</p>
              </div>
              <div className="p-2 bg-surface-900/50 rounded">
                <p className="text-lg font-bold text-surface-300">{todayNutrition.carbs}g</p>
                <p className="text-xs text-surface-500">carbs</p>
              </div>
              <div className="p-2 bg-surface-900/50 rounded">
                <p className="text-lg font-bold text-surface-300">{todayNutrition.fat}g</p>
                <p className="text-xs text-surface-500">fat</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-surface-500">No nutrition logged today. Log your meals to improve this score!</p>
          )}
          {todayNutrition && todayNutrition.targetProtein && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all ${
                    (todayNutrition.protein / todayNutrition.targetProtein) >= 0.9 
                      ? 'bg-success-500' 
                      : (todayNutrition.protein / todayNutrition.targetProtein) >= 0.5
                        ? 'bg-warning-500'
                        : 'bg-danger-500'
                  }`}
                  style={{ width: `${Math.min(100, (todayNutrition.protein / todayNutrition.targetProtein) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-surface-400">
                {Math.round((todayNutrition.protein / todayNutrition.targetProtein) * 100)}% protein
              </span>
            </div>
          )}
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
              placeholder={unit === 'lb' ? 'e.g., 165' : 'e.g., 75.5'}
              step="0.1"
              className="flex-1 px-4 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <span className="text-surface-400">{unit}</span>
          </div>
        </div>

        {/* Temporary Injury Section */}
        <div className="border-t border-surface-700 pt-4">
          <button
            type="button"
            onClick={() => setShowInjurySection(!showInjurySection)}
            className="flex items-center justify-between w-full text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🤕</span>
              <span className="text-sm font-medium text-surface-200">
                Dealing with pain or injury today?
              </span>
            </div>
            <svg 
              className={`w-5 h-5 text-surface-400 transition-transform ${showInjurySection ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {/* Current injuries display */}
          {temporaryInjuries.length > 0 && !showInjurySection && (
            <div className="flex flex-wrap gap-2 mt-2">
              {temporaryInjuries.map(injury => {
                const areaInfo = INJURY_AREAS.find(a => a.value === injury.area);
                return (
                  <Badge 
                    key={injury.area} 
                    variant={injury.severity === 3 ? 'danger' : injury.severity === 2 ? 'warning' : 'default'}
                  >
                    {areaInfo?.icon} {areaInfo?.label}
                  </Badge>
                );
              })}
            </div>
          )}

          {showInjurySection && (
            <div className="mt-4 space-y-4 p-4 bg-surface-800/50 rounded-lg">
              <p className="text-xs text-surface-400">
                Tell us about any temporary pain or injury. We&apos;ll adjust your workout to avoid aggravating it.
              </p>

              {/* Current injuries */}
              {temporaryInjuries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-surface-300">Current issues:</p>
                  <div className="flex flex-wrap gap-2">
                    {temporaryInjuries.map(injury => {
                      const areaInfo = INJURY_AREAS.find(a => a.value === injury.area);
                      const severityLabels = ['Mild', 'Moderate', 'Significant'];
                      return (
                        <div 
                          key={injury.area}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                            injury.severity === 3 
                              ? 'bg-danger-500/20 text-danger-400' 
                              : injury.severity === 2 
                                ? 'bg-warning-500/20 text-warning-400'
                                : 'bg-surface-700 text-surface-300'
                          }`}
                        >
                          <span>{areaInfo?.icon}</span>
                          <span>{areaInfo?.label}</span>
                          <span className="text-xs opacity-70">({severityLabels[injury.severity - 1]})</span>
                          <button
                            onClick={() => removeInjury(injury.area)}
                            className="ml-1 p-0.5 hover:bg-surface-600 rounded-full"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add injury form */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-surface-300 mb-1.5">Area affected</label>
                  <select
                    value={selectedArea}
                    onChange={(e) => setSelectedArea(e.target.value as TemporaryInjury['area'])}
                    className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-100 text-sm"
                  >
                    <option value="">Select area...</option>
                    {INJURY_AREAS.filter(area => !temporaryInjuries.some(i => i.area === area.value)).map(area => (
                      <option key={area.value} value={area.value}>
                        {area.icon} {area.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-surface-300 mb-1.5">Severity</label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map(level => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setSelectedSeverity(level as 1 | 2 | 3)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                          selectedSeverity === level
                            ? level === 3 
                              ? 'bg-danger-500 text-white'
                              : level === 2
                                ? 'bg-warning-500 text-black'
                                : 'bg-primary-500 text-white'
                            : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
                        }`}
                      >
                        {level === 1 ? 'Mild' : level === 2 ? 'Moderate' : 'Significant'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-surface-500 mt-1">
                    {selectedSeverity === 1 && 'Slight discomfort - can work around it'}
                    {selectedSeverity === 2 && 'Noticeable pain - need to be careful'}
                    {selectedSeverity === 3 && 'Significant pain - avoid stressing this area'}
                  </p>
                </div>

                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={addInjury}
                  disabled={!selectedArea}
                  className="w-full"
                >
                  + Add to List
                </Button>
              </div>
            </div>
          )}
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

        {/* Don't show again option */}
        {onSkipPermanently && (
          <div className="pt-4 border-t border-surface-700 mt-4">
            <button
              onClick={onSkipPermanently}
              className="w-full text-center text-sm text-surface-500 hover:text-surface-300 transition-colors"
            >
              Don&apos;t show this again
            </button>
            <p className="text-xs text-surface-600 text-center mt-1">
              You can re-enable this in Settings
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

