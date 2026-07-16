'use client';

import { useState, useEffect, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Badge } from '@/components/ui';
import {
  SLEEP_QUALITY_TO_RATING,
  ratingToSleepQuality,
  type Rating,
  type SleepQuality,
  type DailyCheckIn as DailyCheckInType,
} from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString, cmToIn, inToCm } from '@/lib/utils';
import { fetchLastSleepEntry, upsertSleepEntry } from '@/lib/sleep/sleepLog';
import { saveWaistFromCheckin } from '@/lib/body/bodyLog';
import { SleepFields, clampSleepHours } from '@/components/dashboard/SleepQuickLog';
import { SLEEP_LOG_QUERY_KEY_PREFIX } from '@/hooks/useSleepLog';
import { useUserPreferences } from '@/hooks/useUserPreferences';

/** One-time protocol hint flag (per device). */
const WAIST_HINT_SEEN_KEY = 'hypertrack_waist_hint_seen';

interface DailyCheckInProps {
  userId: string;
  userGoal?: 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';
  onComplete?: () => void;
}

export const DailyCheckIn = memo(function DailyCheckIn({ userId, userGoal, onComplete }: DailyCheckInProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [todaysCheckIn, setTodaysCheckIn] = useState<Partial<DailyCheckInType> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Check-in values
  const [sleepHours, setSleepHours] = useState(7);
  const [sleepQuality, setSleepQuality] = useState<SleepQuality>('ok');
  const [energyLevel, setEnergyLevel] = useState<Rating>(3);
  const [moodRating, setMoodRating] = useState<Rating>(3);
  const [focusRating, setFocusRating] = useState<Rating>(3);
  const [libidoRating, setLibidoRating] = useState<Rating>(3);
  const [sorenessLevel, setSorenessLevel] = useState<Rating>(3);
  const [hungerLevel, setHungerLevel] = useState<Rating>(3);

  // Optional morning waist. Stored empty by default so a skipped entry writes
  // nothing. `waistInput` is in the user's DISPLAY unit; conversion to cm
  // happens only at save.
  const { preferences } = useUserPreferences();
  const measurementUnit: 'in' | 'cm' = preferences.units === 'kg' ? 'cm' : 'in';
  const trackWaist = preferences.trackWaistInCheckin;
  const [waistInput, setWaistInput] = useState('');
  const [savedWaistCm, setSavedWaistCm] = useState<number | null>(null);
  const [waistHintSeen, setWaistHintSeen] = useState(true);

  const isOnCut = userGoal === 'cut';

  // Define questions based on user goal
  const baseQuestions = [
    {
      // Two-field sleep step: hours (0.5-step stepper, defaulting to the last
      // sleep_log entry) + poor/ok/good quality chips — the same pair the
      // home Sleep card's inline sheet edits.
      id: 'sleep',
      title: 'Sleep',
      icon: '😴',
      question: 'How did you sleep last night?',
      type: 'sleep' as const,
      value: sleepHours,
      onChange: (v: number) => setSleepHours(v),
    },
    {
      id: 'energy',
      title: 'Energy',
      icon: '⚡',
      question: "How's your energy level?",
      type: 'rating' as const,
      value: energyLevel,
      onChange: (v: Rating) => setEnergyLevel(v),
      labels: ['Exhausted', 'Low', 'Moderate', 'Good', 'Energized'],
    },
    {
      id: 'mood',
      title: 'Mood',
      icon: '🌤️',
      question: "How's your mood today?",
      type: 'rating' as const,
      value: moodRating,
      onChange: (v: Rating) => setMoodRating(v),
      labels: ['Bad', 'Low', 'Neutral', 'Good', 'Great'],
    },
  ];
  
  // Add cut-specific questions
  const cutQuestions = isOnCut ? [
    {
      id: 'focus',
      title: 'Mental Focus',
      icon: '🎯',
      question: 'How clear is your mental focus?',
      type: 'rating' as const,
      value: focusRating,
      onChange: (v: Rating) => setFocusRating(v),
      labels: ['Very Foggy', 'Foggy', 'Normal', 'Sharp', 'Very Sharp'],
      warning: focusRating <= 2,
    },
    {
      id: 'libido',
      title: 'Libido',
      icon: '🔥',
      question: 'How would you rate your libido/drive?',
      type: 'rating' as const,
      value: libidoRating,
      onChange: (v: Rating) => setLibidoRating(v),
      labels: ['Very Low', 'Low', 'Normal', 'High', 'Very High'],
      warning: libidoRating <= 2,
    },
    {
      id: 'hunger',
      title: 'Satiety',
      icon: '🍽️',
      question: 'How satisfied/full do you feel?',
      type: 'rating' as const,
      value: hungerLevel,
      onChange: (v: Rating) => setHungerLevel(v),
      labels: ['Starving', 'Very Hungry', 'Hungry', 'Satisfied', 'Full'],
      warning: hungerLevel <= 2,
    },
  ] : [];
  
  const extraQuestions = [
    {
      id: 'soreness',
      title: 'Recovery',
      icon: '💪',
      question: 'How recovered do your muscles feel?',
      type: 'rating' as const,
      value: sorenessLevel,
      onChange: (v: Rating) => setSorenessLevel(v),
      labels: ['Very Sore', 'Sore', 'Moderate', 'Slight', 'Fresh'],
    },
  ];
  
  // Optional, skippable morning-waist step — only when the user keeps it on.
  const waistQuestions = trackWaist ? [
    {
      id: 'waist',
      title: 'Morning Waist',
      icon: '📏',
      question: 'Morning waist (optional)',
      type: 'waist' as const,
      value: waistInput,
      onChange: (v: string) => setWaistInput(v),
    },
  ] : [];

  const questions = [...baseQuestions, ...cutQuestions, ...extraQuestions, ...waistQuestions];
  const currentQuestion = questions[step];
  
  // Check if already checked in today, and seed the sleep fields: today's
  // check-in values win, else default hours/quality to the LAST sleep_log
  // entry so re-logging a typical night is one tap.
  useEffect(() => {
    async function checkTodaysCheckIn() {
      const supabase = createUntypedClient();
      const todayStr = getLocalDateString();

      const [{ data }, lastSleep, todaysWaist] = await Promise.all([
        supabase
          .from('daily_check_ins')
          .select('*')
          .eq('user_id', userId)
          .eq('date', todayStr)
          .single(),
        fetchLastSleepEntry(supabase, userId).catch(() => null),
        // Today's waist may already exist (grid or an earlier check-in) — the
        // check-in edits the SAME body_measurements row, so seed the field.
        supabase
          .from('body_measurements')
          .select('waist')
          .eq('user_id', userId)
          .eq('logged_at', todayStr)
          .maybeSingle()
          .then(({ data: m }: { data: { waist: number | null } | null }) => m?.waist ?? null)
          .catch(() => null),
      ]);

      if (data) {
        setAlreadyCheckedIn(true);
        setTodaysCheckIn(data);
        if (typeof data.sleep_hours === 'number') setSleepHours(clampSleepHours(data.sleep_hours));
        setSleepQuality(ratingToSleepQuality(data.sleep_quality));
      } else if (lastSleep) {
        setSleepHours(clampSleepHours(lastSleep.hours));
        setSleepQuality(lastSleep.quality);
      }

      if (typeof todaysWaist === 'number') {
        setSavedWaistCm(todaysWaist);
        setWaistInput(
          measurementUnit === 'in' ? cmToIn(todaysWaist).toFixed(1) : todaysWaist.toFixed(1)
        );
      }

      // Protocol hint shows once per device.
      try {
        setWaistHintSeen(localStorage.getItem(WAIST_HINT_SEEN_KEY) === '1');
      } catch {
        setWaistHintSeen(false);
      }

      setIsLoading(false);
    }

    checkTodaysCheckIn();
    // measurementUnit only formats the prefill string; re-running on a late
    // units load would needlessly refetch, so it is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Persist the "hint seen" flag the first time the waist step is shown, so
  // the protocol hint appears exactly once (never nags).
  useEffect(() => {
    if (currentQuestion?.type === 'waist' && !waistHintSeen) {
      try {
        localStorage.setItem(WAIST_HINT_SEEN_KEY, '1');
      } catch {
        /* private mode — fine, hint just shows again next time */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.type]);

  // Calculate refeed recommendation for cuts
  const getRefeedStatus = () => {
    if (!isOnCut) return null;
    
    const lowFocus = focusRating <= 2;
    const lowLibido = libidoRating <= 2;
    const highHunger = hungerLevel <= 2;
    const lowEnergy = energyLevel <= 2;
    
    const warningCount = [lowFocus, lowLibido, highHunger, lowEnergy].filter(Boolean).length;
    
    if (warningCount >= 3) {
      return {
        level: 'high' as const,
        message: 'Strong signs you need a refeed day',
        recommendation: 'Consider having a higher-carb day (maintenance calories) to restore glycogen and hormonal balance.',
      };
    } else if (warningCount >= 2) {
      return {
        level: 'medium' as const,
        message: 'Some signs of diet fatigue',
        recommendation: 'Monitor these symptoms. If they persist, plan a refeed within the next 2-3 days.',
      };
    } else if (warningCount >= 1) {
      return {
        level: 'low' as const,
        message: 'Minor fatigue signals',
        recommendation: 'Keep tracking. This is normal during a cut, but watch if it worsens.',
      };
    }
    return null;
  };
  
  const handleNext = () => {
    if (step < questions.length - 1) {
      setStep(step + 1);
    }
  };
  
  const handlePrev = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };
  
  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      const supabase = createUntypedClient();
      const todayStr = getLocalDateString();
      
      const checkInData = {
        user_id: userId,
        date: todayStr,
        sleep_hours: sleepHours,
        // The 1-5 rating column stays (readiness scorer input); the chips map
        // onto it via the shared bridge.
        sleep_quality: SLEEP_QUALITY_TO_RATING[sleepQuality],
        energy_level: energyLevel,
        mood_rating: moodRating,
        focus_rating: isOnCut ? focusRating : null,
        libido_rating: isOnCut ? libidoRating : null,
        soreness_level: sorenessLevel,
        hunger_level: isOnCut ? hungerLevel : null,
      };

      const { error } = await supabase
        .from('daily_check_ins')
        .upsert(checkInData, { onConflict: 'user_id,date' });

      if (error) throw error;

      // Dual-write the sleep pair to sleep_log (one row per local day; a
      // repeat check-in EDITS it) — the home Sleep card, recovery windows and
      // the deload advisor all read from there.
      try {
        await upsertSleepEntry(supabase, userId, {
          localDay: todayStr,
          hours: sleepHours,
          quality: sleepQuality,
        });
        // Refresh the shared sleep cache (home Sleep card, recovery hooks).
        queryClient.invalidateQueries({ queryKey: [SLEEP_LOG_QUERY_KEY_PREFIX] });
      } catch (sleepError) {
        // Best-effort: a sleep_log hiccup must not fail the check-in itself.
        console.error('Failed to save sleep entry from check-in:', sleepError);
      }

      // Optional morning waist → the SAME body_measurements day-row the Body
      // grid uses (source='daily_checkin'). Best-effort and non-blocking: a
      // skipped or malformed entry writes nothing and never fails the check-in.
      if (trackWaist) {
        const parsed = parseFloat(waistInput);
        if (waistInput.trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
          const waistCm = measurementUnit === 'in' ? inToCm(parsed) : parsed;
          try {
            await saveWaistFromCheckin(supabase, userId, todayStr, Math.round(waistCm * 10) / 10);
            setSavedWaistCm(Math.round(waistCm * 10) / 10);
          } catch (waistError) {
            console.error('Failed to save waist from check-in:', waistError);
          }
        }
      }

      setAlreadyCheckedIn(true);
      setTodaysCheckIn(checkInData);
      onComplete?.();
    } catch (error) {
      console.error('Failed to save check-in:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleReset = () => {
    setAlreadyCheckedIn(false);
    setTodaysCheckIn(null);
    setStep(0);
  };
  
  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-surface-700 rounded w-1/3" />
          <div className="h-8 bg-surface-700 rounded" />
        </div>
      </Card>
    );
  }
  
  // Show summary if already checked in
  if (alreadyCheckedIn && todaysCheckIn) {
    const refeedStatus = getRefeedStatus();
    
    // Handle both camelCase (from type) and snake_case (from DB) properties
    const displayData = {
      sleepHours: (todaysCheckIn as any).sleep_hours ?? (todaysCheckIn as any).sleepHours ?? sleepHours,
      energyLevel: (todaysCheckIn as any).energy_level ?? (todaysCheckIn as any).energyLevel ?? energyLevel,
      moodRating: (todaysCheckIn as any).mood_rating ?? (todaysCheckIn as any).moodRating ?? moodRating,
      sorenessLevel: (todaysCheckIn as any).soreness_level ?? (todaysCheckIn as any).sorenessLevel ?? sorenessLevel,
    };
    
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">✅</span>
            <h3 className="font-medium text-surface-100">Daily Check-In Complete</h3>
          </div>
          <button 
            onClick={handleReset}
            className="text-xs text-surface-400 hover:text-surface-200"
          >
            Update
          </button>
        </div>
        
        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="p-2 bg-surface-800 rounded-lg">
            <p className="text-lg">😴</p>
            <p className="text-sm font-medium text-surface-100">{displayData.sleepHours}h</p>
            <p className="text-xs text-surface-500">Sleep</p>
          </div>
          <div className="p-2 bg-surface-800 rounded-lg">
            <p className="text-lg">⚡</p>
            <p className="text-sm font-medium text-surface-100">{displayData.energyLevel}/5</p>
            <p className="text-xs text-surface-500">Energy</p>
          </div>
          <div className="p-2 bg-surface-800 rounded-lg">
            <p className="text-lg">🌤️</p>
            <p className="text-sm font-medium text-surface-100">{displayData.moodRating}/5</p>
            <p className="text-xs text-surface-500">Mood</p>
          </div>
          <div className="p-2 bg-surface-800 rounded-lg">
            <p className="text-lg">💪</p>
            <p className="text-sm font-medium text-surface-100">{displayData.sorenessLevel}/5</p>
            <p className="text-xs text-surface-500">Recovery</p>
          </div>
        </div>
        
        {/* Morning waist (value only — never a day-over-day delta). */}
        {trackWaist && savedWaistCm !== null && (
          <div className="mt-3 flex items-center justify-between px-3 py-2 bg-surface-800 rounded-lg" data-testid="checkin-waist-summary">
            <span className="text-xs text-surface-400">📏 Morning waist</span>
            <span className="text-sm font-medium text-surface-100">
              {measurementUnit === 'in' ? cmToIn(savedWaistCm).toFixed(1) : savedWaistCm.toFixed(1)} {measurementUnit}
            </span>
          </div>
        )}

        {/* Refeed alert for cuts */}
        {isOnCut && refeedStatus && refeedStatus.level !== 'low' && (
          <div className={`mt-3 p-3 rounded-lg ${
            refeedStatus.level === 'high' 
              ? 'bg-amber-500/20 border border-amber-500/30' 
              : 'bg-yellow-500/10 border border-yellow-500/20'
          }`}>
            <div className="flex items-start gap-2">
              <span className="text-lg">{refeedStatus.level === 'high' ? '⚠️' : '💡'}</span>
              <div>
                <p className={`text-sm font-medium ${refeedStatus.level === 'high' ? 'text-amber-400' : 'text-yellow-400'}`}>
                  {refeedStatus.message}
                </p>
                <p className="text-xs text-surface-300 mt-1">{refeedStatus.recommendation}</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    );
  }
  
  // Show check-in flow
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{currentQuestion?.icon}</span>
          <h3 className="font-medium text-surface-100">Daily Check-In</h3>
        </div>
        <Badge variant="default" size="sm">
          {step + 1}/{questions.length}
        </Badge>
      </div>
      
      {/* Progress bar */}
      <div className="h-1 bg-surface-700 rounded-full mb-4 overflow-hidden">
        <div 
          className="h-full bg-primary-500 transition-all duration-300"
          style={{ width: `${((step + 1) / questions.length) * 100}%` }}
        />
      </div>
      
      {/* Question */}
      {currentQuestion && (
        <div className="space-y-4">
          <p className="text-surface-200">{currentQuestion.question}</p>
          
          {currentQuestion.type === 'sleep' && (
            <SleepFields
              hours={sleepHours}
              quality={sleepQuality}
              onHoursChange={setSleepHours}
              onQualityChange={setSleepQuality}
            />
          )}


          {currentQuestion.type === 'waist' && (
            <div className="space-y-3" data-testid="checkin-waist-field">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={waistInput}
                  onChange={(e) => setWaistInput(e.target.value)}
                  placeholder={measurementUnit === 'in' ? 'e.g. 33.5' : 'e.g. 85.0'}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:border-primary-500"
                />
                <span className="text-sm text-surface-400 w-8">{measurementUnit}</span>
              </div>
              {!waistHintSeen && (
                <p className="text-xs text-surface-500 leading-snug" data-testid="waist-protocol-hint">
                  Morning, fasted, after using the bathroom, at navel level — consistency matters more than precision.
                </p>
              )}
              <p className="text-xs text-surface-500">
                Optional — leave blank to skip. One entry per day; you can edit it anytime.
              </p>
            </div>
          )}

          {currentQuestion.type === 'rating' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                {([1, 2, 3, 4, 5] as Rating[]).map((rating, index) => (
                  <button
                    key={rating}
                    onClick={() => currentQuestion.onChange(rating as any)}
                    className={`flex-1 flex flex-col items-center py-2 px-1 rounded-lg transition-colors ${
                      currentQuestion.value === rating
                        ? (currentQuestion as any).warning && rating <= 2
                          ? 'bg-amber-500 text-white'
                          : 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    <span className="text-lg font-medium">{rating}</span>
                    <span className={`text-[10px] leading-tight text-center ${
                      currentQuestion.value === rating ? 'text-white/80' : 'text-surface-500'
                    }`}>
                      {currentQuestion.labels?.[index]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Warning for low cut metrics */}
          {(currentQuestion as any).warning && Number(currentQuestion.value) <= 2 && (
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-xs text-amber-400">
                ⚠️ Low {currentQuestion.title.toLowerCase()} can be a sign of diet fatigue
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Navigation */}
      <div className="flex gap-2 mt-4">
        {step > 0 && (
          <Button variant="ghost" onClick={handlePrev} size="sm">
            Back
          </Button>
        )}
        <div className="flex-1" />
        {step < questions.length - 1 ? (
          <Button onClick={handleNext} size="sm">
            Next
          </Button>
        ) : (
          <Button onClick={handleSubmit} isLoading={isSubmitting} size="sm">
            Complete
          </Button>
        )}
      </div>
    </Card>
  );
});
