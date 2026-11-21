'use client';

import { IconAlertTriangle, IconBandage, IconTarget } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import { Button, Card, Slider, Badge } from '@/components/ui';
import type {
  PreWorkoutCheckIn,
  Rating,
  TemporaryInjury,
  WeightUnit,
  StandardMuscleGroup,
  SorenessRating,
} from '@/types/schema';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import { calculateReadinessScore, getReadinessInterpretation } from '@/services/fatigueEngine';

/** Muscle soreness ratings keyed by muscle; unrated muscles are simply absent. */
export type MuscleSorenessRatings = Partial<Record<StandardMuscleGroup, SorenessRating>>;

const SORENESS_CHIP_OPTIONS: { value: SorenessRating; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Sore' },
  { value: 3, label: 'Still very sore' },
];

// Injury area options with display names
const INJURY_AREAS: { value: TemporaryInjury['area']; label: string }[] = [
  { value: 'lower_back', label: 'Lower back' },
  { value: 'upper_back', label: 'Upper back' },
  { value: 'neck', label: 'Neck' },
  { value: 'shoulder_left', label: 'Left shoulder' },
  { value: 'shoulder_right', label: 'Right shoulder' },
  { value: 'elbow_left', label: 'Left elbow' },
  { value: 'elbow_right', label: 'Right elbow' },
  { value: 'wrist_left', label: 'Left wrist' },
  { value: 'wrist_right', label: 'Right wrist' },
  { value: 'hip_left', label: 'Left hip' },
  { value: 'hip_right', label: 'Right hip' },
  { value: 'knee_left', label: 'Left knee' },
  { value: 'knee_right', label: 'Right knee' },
  { value: 'ankle_left', label: 'Left ankle' },
  { value: 'ankle_right', label: 'Right ankle' },
  { value: 'chest', label: 'Chest' },
  { value: 'other', label: 'Other' },
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

/**
 * Compact 1–5 segmented control (~36px visual; hit area padded to ≥44px via
 * the ::after overlay so touch targets stay comfortable).
 */
function RatingSegments({
  value,
  onChange,
  selectedClass = 'bg-action text-on-action',
}: {
  value: Rating;
  onChange: (rating: Rating) => void;
  selectedClass?: string;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-fill p-0.5">
      {([1, 2, 3, 4, 5] as Rating[]).map((rating) => (
        <button
          key={rating}
          onClick={() => onChange(rating)}
          aria-pressed={value === rating}
          className={`relative flex-1 h-8 rounded-md text-subhead font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] ${
            value === rating
              ? selectedClass
              : 'text-ink-2 hover:bg-sep'
          }`}
        >
          {rating}
        </button>
      ))}
    </div>
  );
}

interface ReadinessCheckInProps {
  onSubmit: (checkIn: PreWorkoutCheckIn, sorenessRatings?: MuscleSorenessRatings) => void;
  onSkip?: () => void;
  onSkipPermanently?: () => void;
  /**
   * Renders an X in the header and enables Escape-to-close. Dismissal is a
   * cancel: no partial data is submitted, unsaved selections are discarded.
   */
  onClose?: () => void;
  unit?: WeightUnit;
  todayNutrition?: TodayNutrition;
  userGoal?: 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';
  /**
   * Muscles on today's menu that were also trained in a completed session in
   * the last few days — shows optional "How sore is X?" chip rows. The ratings
   * are passed back via onSubmit's second argument (no defaults; skippable).
   */
  sorenessMuscles?: StandardMuscleGroup[];
  // Initial values from daily check-in and weight log
  initialValues?: {
    sleepHours?: number | null;
    sleepQuality?: Rating | null;
    stressLevel?: Rating | null;
    focusRating?: Rating | null;
    libidoRating?: Rating | null;
    bodyweightKg?: number | null;
  };
}

export function ReadinessCheckIn({ onSubmit, onSkip, onSkipPermanently, onClose, unit = 'kg', todayNutrition, userGoal, sorenessMuscles, initialValues }: ReadinessCheckInProps) {
  // Initialize with daily check-in data if available
  const [sleepHours, setSleepHours] = useState(initialValues?.sleepHours ?? 7);
  const [sleepQuality, setSleepQuality] = useState<Rating>(initialValues?.sleepQuality ?? 3);
  const [stressLevel, setStressLevel] = useState<Rating>(initialValues?.stressLevel ?? 3);

  // Initialize bodyweight from weight log (convert to display unit)
  const initialBodyweight = initialValues?.bodyweightKg
    ? (unit === 'lb' ? (initialValues.bodyweightKg * 2.20462).toFixed(1) : initialValues.bodyweightKg.toFixed(1))
    : '';
  const [bodyweight, setBodyweight] = useState(initialBodyweight);

  // Per-muscle soreness — intentionally no defaults (null = not rated).
  const [sorenessRatings, setSorenessRatings] = useState<MuscleSorenessRatings>({});

  const [showInjurySection, setShowInjurySection] = useState(false);
  const [temporaryInjuries, setTemporaryInjuries] = useState<TemporaryInjury[]>([]);
  const [selectedArea, setSelectedArea] = useState<TemporaryInjury['area'] | ''>('');
  const [selectedSeverity, setSelectedSeverity] = useState<1 | 2 | 3>(1);

  // Cut-specific tracking for refeed detection (initialize from daily check-in)
  const [focusRating, setFocusRating] = useState<Rating>(initialValues?.focusRating ?? 3);
  const [libidoRating, setLibidoRating] = useState<Rating>(initialValues?.libidoRating ?? 3);

  // Update values when initialValues are loaded (in case they load after mount)
  useEffect(() => {
    if (initialValues) {
      if (initialValues.sleepHours !== undefined) {
        setSleepHours(initialValues.sleepHours ?? 7);
      }
      if (initialValues.sleepQuality !== undefined && initialValues.sleepQuality !== null) {
        setSleepQuality(initialValues.sleepQuality);
      }
      if (initialValues.stressLevel !== undefined && initialValues.stressLevel !== null) {
        setStressLevel(initialValues.stressLevel);
      }
      if (initialValues.focusRating !== undefined && initialValues.focusRating !== null) {
        setFocusRating(initialValues.focusRating);
      }
      if (initialValues.libidoRating !== undefined && initialValues.libidoRating !== null) {
        setLibidoRating(initialValues.libidoRating);
      }
      if (initialValues.bodyweightKg !== undefined && initialValues.bodyweightKg !== null) {
        const bodyweightStr = unit === 'lb'
          ? (initialValues.bodyweightKg * 2.20462).toFixed(1)
          : initialValues.bodyweightKg.toFixed(1);
        setBodyweight(bodyweightStr);
      }
    }
  }, [initialValues, unit]);

  // Escape closes without submitting (dismissal = cancel).
  useEffect(() => {
    if (!onClose) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Show cut-specific questions when user is cutting
  const isOnCut = userGoal === 'cut';

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

  const toggleSoreness = (muscle: StandardMuscleGroup, value: SorenessRating) => {
    setSorenessRatings((prev) => {
      if (prev[muscle] === value) {
        // Tap again to un-rate (skippable — null means "not rated").
        const next = { ...prev };
        delete next[muscle];
        return next;
      }
      return { ...prev, [muscle]: value };
    });
  };

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

  // Calculate if refeed is recommended (for cuts)
  const calculateRefeedRecommended = (): boolean => {
    if (!isOnCut) return false;

    // Refeed indicators: low focus, low libido, poor sleep, low energy
    const lowFocus = focusRating <= 2;
    const lowLibido = libidoRating <= 2;
    const poorSleep = sleepQuality <= 2;
    const highStress = stressLevel <= 2;

    // Recommend refeed if multiple indicators are present
    const indicatorCount = [lowFocus, lowLibido, poorSleep, highStress].filter(Boolean).length;
    return indicatorCount >= 2 || (lowFocus && lowLibido);
  };

  const refeedRecommended = calculateRefeedRecommended();

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
      // Include cut-specific metrics if on a cut
      ...(isOnCut && {
        focusRating,
        libidoRating,
        refeedRecommended,
      }),
    };
    onSubmit(
      checkIn,
      Object.keys(sorenessRatings).length > 0 ? sorenessRatings : undefined
    );
  };

  const getRatingLabel = (rating: Rating, type: 'sleep' | 'stress' | 'nutrition' | 'focus' | 'libido') => {
    const labels = {
      sleep: ['Terrible', 'Poor', 'Okay', 'Good', 'Great'],
      stress: ['Very High', 'High', 'Moderate', 'Low', 'Very Low'],
      nutrition: ['Poor', 'Below average', 'Average', 'Good', 'Excellent'],
      focus: ['Very Foggy', 'Foggy', 'Normal', 'Sharp', 'Very Sharp'],
      libido: ['Very Low', 'Low', 'Normal', 'High', 'Very High'],
    };
    return labels[type][rating - 1];
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-status-ok';
    if (score >= 60) return 'text-action';
    if (score >= 40) return 'text-status-warn';
    return 'text-status-bad';
  };

  return (
    <Card
      variant="elevated"
      padding="none"
      data-testid="readiness-checkin"
      className="w-full max-w-md mx-auto flex flex-col min-h-0 max-h-full overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sep flex-shrink-0">
        <h2 className="text-headline font-semibold text-ink">
          Pre-workout check-in
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close check-in"
            data-testid="readiness-checkin-close"
            className="-m-2 p-2 text-ink-2 hover:text-ink hover:bg-fill rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div data-testid="readiness-checkin-body" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {/* Sleep Hours */}
        <div>
          <Slider
            label="Hours of sleep"
            min={3}
            max={12}
            step={0.5}
            value={sleepHours}
            onChange={(e) => setSleepHours(parseFloat(e.target.value))}
            valueFormatter={(v) => `${v}h`}
          />
        </div>

        {/* Sleep Quality */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-subhead font-medium text-ink">
              Sleep quality
            </label>
            <span className="text-subhead text-action">
              {getRatingLabel(sleepQuality, 'sleep')}
            </span>
          </div>
          <RatingSegments value={sleepQuality} onChange={setSleepQuality} />
        </div>

        {/* Stress Level */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-subhead font-medium text-ink">
              Stress level{' '}
              <span className="font-normal text-caption text-ink-3">(1 = high, 5 = low)</span>
            </label>
            <span className="text-subhead text-action">
              {getRatingLabel(stressLevel, 'stress')}
            </span>
          </div>
          <RatingSegments value={stressLevel} onChange={setStressLevel} />
        </div>

        {/* Muscle soreness from the last session hitting today's muscles */}
        {sorenessMuscles && sorenessMuscles.length > 0 && (
          <div>
            <label className="text-subhead font-medium text-ink">
              Muscle soreness{' '}
              <span className="font-normal text-caption text-ink-3">(optional)</span>
            </label>
            <div className="mt-1.5 space-y-1.5">
              {sorenessMuscles.map((muscle) => (
                <div key={muscle} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-caption font-medium text-ink-2 min-w-[60px]">
                    {STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    {SORENESS_CHIP_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => toggleSoreness(muscle, option.value)}
                        className={`relative rounded-full px-2.5 py-1 text-caption font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
                          sorenessRatings[muscle] === option.value
                            ? 'bg-action text-on-action'
                            : 'bg-fill text-ink-2 hover:bg-sep'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cut-specific: Focus & Libido (for refeed detection) */}
        {isOnCut && (
          <div className="bg-status-warn-tint p-3 border border-status-warn/20 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <IconTarget className="h-5 w-5 flex-shrink-0 text-status-warn" stroke={1.75} aria-hidden="true" />
              <div>
                <p className="text-subhead font-medium text-ink">Cut health check</p>
                <p className="text-caption text-ink-2">These help us detect when you might need a refeed</p>
              </div>
            </div>

            {/* Focus Rating */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-subhead font-medium text-ink">
                  Mental focus and clarity
                </label>
                <span className={`text-subhead ${focusRating <= 2 ? 'text-status-warn' : 'text-action'}`}>
                  {getRatingLabel(focusRating, 'focus')}
                </span>
              </div>
              <RatingSegments
                value={focusRating}
                onChange={setFocusRating}
                selectedClass={focusRating <= 2 ? 'bg-status-warn text-white' : 'bg-action text-on-action'}
              />
            </div>

            {/* Libido Rating */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-subhead font-medium text-ink">
                  Libido and drive
                </label>
                <span className={`text-subhead ${libidoRating <= 2 ? 'text-status-warn' : 'text-action'}`}>
                  {getRatingLabel(libidoRating, 'libido')}
                </span>
              </div>
              <RatingSegments
                value={libidoRating}
                onChange={setLibidoRating}
                selectedClass={libidoRating <= 2 ? 'bg-status-warn text-white' : 'bg-action text-on-action'}
              />
              <p className="text-caption text-ink-3 mt-1">A drop in libido can indicate hormonal stress from dieting</p>
            </div>

            {/* Refeed Alert */}
            {refeedRecommended && (
              <div className="p-3 bg-status-warn-tint rounded-lg">
                <div className="flex items-start gap-2">
                  <IconAlertTriangle className="h-5 w-5 flex-shrink-0 text-status-warn" stroke={1.75} aria-hidden="true" />
                  <div>
                    <p className="text-subhead font-medium text-status-warn">Refeed recommended</p>
                    <p className="text-caption text-ink-2 mt-1">
                      Low focus and libido can indicate your body needs more fuel. Consider a higher-carb day to restore glycogen and hormonal balance.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Today's Nutrition (from logging) */}
        <div className="px-3 py-2.5 bg-fill/50 rounded-lg">
          <div className="flex items-center justify-between">
            <label className="text-subhead font-medium text-ink">
              Today&apos;s Nutrition
            </label>
            <span className={`text-subhead font-medium ${
              nutritionRating >= 4 ? 'text-status-ok' :
              nutritionRating >= 3 ? 'text-action' :
              nutritionRating >= 2 ? 'text-status-warn' : 'text-status-bad'
            }`}>
              {getRatingLabel(nutritionRating, 'nutrition')}
            </span>
          </div>
          {todayNutrition ? (
            <p className="mt-1 text-subhead text-ink-2">
              {Math.round(todayNutrition.calories)} cal
              {' · '}
              <span className="text-action">{Math.round(todayNutrition.protein * 10) / 10}g P</span>
              {' · '}
              {Math.round(todayNutrition.carbs)}g C
              {' · '}
              {Math.round(todayNutrition.fat)}g F
            </p>
          ) : (
            <p className="mt-1 text-caption text-ink-3">No nutrition logged today. Log your meals to improve this score!</p>
          )}
          {todayNutrition && todayNutrition.targetProtein && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-sep rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    (todayNutrition.protein / todayNutrition.targetProtein) >= 0.9
                      ? 'bg-status-ok'
                      : (todayNutrition.protein / todayNutrition.targetProtein) >= 0.5
                        ? 'bg-status-warn'
                        : 'bg-status-bad'
                  }`}
                  style={{ width: `${Math.min(100, (todayNutrition.protein / todayNutrition.targetProtein) * 100)}%` }}
                />
              </div>
              <span className="text-caption text-ink-2">
                {Math.round((todayNutrition.protein / todayNutrition.targetProtein) * 100)}% protein
              </span>
            </div>
          )}
        </div>

        {/* Bodyweight (optional) — label and input inline */}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="checkin-bodyweight" className="text-subhead font-medium text-ink">
            Bodyweight{' '}
            <span className="font-normal text-caption text-ink-3">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="checkin-bodyweight"
              type="number"
              value={bodyweight}
              onChange={(e) => setBodyweight(e.target.value)}
              placeholder={unit === 'lb' ? 'e.g., 165' : 'e.g., 75.5'}
              step="0.1"
              className="w-24 px-3 py-2 text-right bg-fill border border-sep rounded-lg text-ink placeholder:text-ink-3 focus:ring-2 focus:ring-action focus:border-transparent"
            />
            <span className="text-subhead text-ink-2">{unit}</span>
          </div>
        </div>

        {/* Temporary Injury Section */}
        <div className="border-t border-sep pt-3">
          <button
            type="button"
            onClick={() => setShowInjurySection(!showInjurySection)}
            className="flex items-center justify-between w-full text-left"
          >
            <div className="flex items-center gap-2">
              <IconBandage className="h-5 w-5 flex-shrink-0 text-ink-2" stroke={1.75} aria-hidden="true" />
              <span className="text-subhead font-medium text-ink">
                Dealing with pain or injury today?
              </span>
            </div>
            <svg
              className={`w-5 h-5 text-ink-2 transition-transform ${showInjurySection ? 'rotate-180' : ''}`}
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
                    {areaInfo?.label}
                  </Badge>
                );
              })}
            </div>
          )}

          {showInjurySection && (
            <div className="mt-3 space-y-4 p-4 bg-fill/50 rounded-lg">
              <p className="text-caption text-ink-2">
                Tell us about any temporary pain or injury. We&apos;ll adjust your workout to avoid aggravating it.
              </p>

              {/* Current injuries */}
              {temporaryInjuries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-caption font-medium text-ink-2">Current issues:</p>
                  <div className="flex flex-wrap gap-2">
                    {temporaryInjuries.map(injury => {
                      const areaInfo = INJURY_AREAS.find(a => a.value === injury.area);
                      const severityLabels = ['Mild', 'Moderate', 'Significant'];
                      return (
                        <div
                          key={injury.area}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-subhead ${
                            injury.severity === 3
                              ? 'bg-status-bad/20 text-status-bad'
                              : injury.severity === 2
                                ? 'bg-status-warn/20 text-status-warn'
                                : 'bg-sep text-ink-2'
                          }`}
                        >
                          <span>{areaInfo?.label}</span>
                          <span className="text-caption opacity-70">({severityLabels[injury.severity - 1]})</span>
                          <button
                            onClick={() => removeInjury(injury.area)}
                            className="ml-1 p-0.5 hover:bg-sep rounded-full"
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
                  <label className="block text-caption font-medium text-ink-2 mb-1.5">Area affected</label>
                  <select
                    value={selectedArea}
                    onChange={(e) => setSelectedArea(e.target.value as TemporaryInjury['area'])}
                    className="w-full px-3 py-2 bg-sep border border-sep rounded-lg text-ink text-subhead"
                  >
                    <option value="">Select area...</option>
                    {INJURY_AREAS.filter(area => !temporaryInjuries.some(i => i.area === area.value)).map(area => (
                      <option key={area.value} value={area.value}>
                        {area.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-caption font-medium text-ink-2 mb-1.5">Severity</label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map(level => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setSelectedSeverity(level as 1 | 2 | 3)}
                        className={`flex-1 py-2 px-3 rounded-lg text-caption font-medium transition-colors ${
                          selectedSeverity === level
                            ? level === 3
                              ? 'bg-status-bad text-white'
                              : level === 2
                                ? 'bg-status-warn text-black'
                                : 'bg-action text-on-action'
                            : 'bg-sep text-ink-2 hover:bg-sep'
                        }`}
                      >
                        {level === 1 ? 'Mild' : level === 2 ? 'Moderate' : 'Significant'}
                      </button>
                    ))}
                  </div>
                  <p className="text-caption text-ink-3 mt-1">
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
        <div className="bg-fill/50 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-subhead text-ink-2">Readiness score</p>
            <p className={`text-subhead ${getScoreColor(readinessScore)}`}>
              {interpretation.message}
            </p>
            <p className="text-caption text-ink-3 mt-0.5">
              {interpretation.recommendation}
            </p>
          </div>
          <p className={`text-large-title font-bold flex-shrink-0 ${getScoreColor(readinessScore)}`}>
            {readinessScore}
          </p>
        </div>

        {/* Don't show again option */}
        {onSkipPermanently && (
          <button
            onClick={onSkipPermanently}
            className="w-full text-center text-caption text-ink-3 hover:text-ink-2 transition-colors"
          >
            Don&apos;t show this again — re-enable in Settings
          </button>
        )}
      </div>

      {/* Sticky footer — actions visible at every scroll position */}
      <div
        data-testid="readiness-checkin-footer"
        className="flex gap-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-sep bg-card flex-shrink-0"
      >
        {onSkip && (
          <Button variant="ghost" onClick={onSkip} className="flex-1">
            Skip
          </Button>
        )}
        <Button onClick={handleSubmit} className="flex-1">
          Start workout
        </Button>
      </div>
    </Card>
  );
}
