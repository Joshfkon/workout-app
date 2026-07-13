'use client';

import { useState, useEffect, memo } from 'react';
import { Button, Card, Badge } from '@/components/ui';
import type { Rating, DailyCheckIn as DailyCheckInType } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { isNativePlatform, getPlatform } from '@/lib/integrations/capacitor-stub';

interface DailyCheckInProps {
  userId: string;
  userGoal?: 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';
  onComplete?: () => void;
}

/** One-time "Auto-fill from Apple Health" offer — dismissed forever once acted on. */
const HEALTH_OFFER_DISMISSED_KEY = 'hypertrack:healthkit-sleep-offer-dismissed';

function readHealthOfferDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(HEALTH_OFFER_DISMISSED_KEY) === '1';
  } catch {
    return true;
  }
}

function persistHealthOfferDismissed(): void {
  try {
    window.localStorage.setItem(HEALTH_OFFER_DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable — the offer just shows again next time.
  }
}

export const DailyCheckIn = memo(function DailyCheckIn({ userId, userGoal, onComplete }: DailyCheckInProps) {
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [todaysCheckIn, setTodaysCheckIn] = useState<Partial<DailyCheckInType> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Apple Health sleep auto-fill (iOS native only; absent everywhere else)
  const [sleepSource, setSleepSource] = useState<'manual' | 'healthkit' | null>(null);
  const [prefilledSleepHours, setPrefilledSleepHours] = useState<number | null>(null);
  const [isIOSNative, setIsIOSNative] = useState(false);
  const [healthKitConnected, setHealthKitConnected] = useState<boolean | null>(null);
  const [healthOfferDismissed, setHealthOfferDismissed] = useState(true);
  const [isConnectingHealth, setIsConnectingHealth] = useState(false);

  // Check-in values
  const [sleepHours, setSleepHours] = useState(7);
  const [sleepQuality, setSleepQuality] = useState<Rating>(3);
  const [energyLevel, setEnergyLevel] = useState<Rating>(3);
  const [moodRating, setMoodRating] = useState<Rating>(3);
  const [focusRating, setFocusRating] = useState<Rating>(3);
  const [libidoRating, setLibidoRating] = useState<Rating>(3);
  const [sorenessLevel, setSorenessLevel] = useState<Rating>(3);
  const [hungerLevel, setHungerLevel] = useState<Rating>(3);
  
  const isOnCut = userGoal === 'cut';

  // Define questions based on user goal
  const baseQuestions = [
    {
      id: 'sleep',
      title: 'Sleep',
      icon: '😴',
      question: 'How did you sleep last night?',
      type: 'slider' as const,
      value: sleepHours,
      onChange: (v: number) => setSleepHours(v),
      min: 3,
      max: 12,
      step: 0.5,
      format: (v: number) => `${v} hours`,
    },
    {
      id: 'sleepQuality',
      title: 'Sleep Quality',
      icon: '💤',
      question: 'How was your sleep quality?',
      type: 'rating' as const,
      value: sleepQuality,
      onChange: (v: Rating) => setSleepQuality(v),
      labels: ['Terrible', 'Poor', 'Okay', 'Good', 'Great'],
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
  
  const questions = [...baseQuestions, ...cutQuestions, ...extraQuestions];
  const currentQuestion = questions[step];
  
  // Check if already checked in today
  useEffect(() => {
    async function checkTodaysCheckIn() {
      const supabase = createUntypedClient();
      const todayStr = getLocalDateString();

      const { data } = await supabase
        .from('daily_check_ins')
        .select('*')
        .eq('user_id', userId)
        .eq('date', todayStr)
        .single();

      if (data) {
        // A HealthKit sleep auto-fill creates a row with ONLY sleep fields;
        // that must not read as a completed check-in. A user-answered field
        // (energy) marks true completion.
        const completed = data.energy_level != null;
        setAlreadyCheckedIn(completed);
        setTodaysCheckIn(data);
        if (data.sleep_hours != null) {
          const hours = Number(data.sleep_hours);
          setSleepHours(hours);
          setSleepSource((data.sleep_source as 'manual' | 'healthkit' | null) ?? 'manual');
          if (data.sleep_source === 'healthkit') setPrefilledSleepHours(hours);
        }
      }
      setIsLoading(false);
    }

    checkTodaysCheckIn();
  }, [userId]);

  // Apple Health inline offer: iOS native app only, once, and only while not
  // connected. Web/PWA/Android never load any HealthKit code from here.
  useEffect(() => {
    if (!isNativePlatform() || getPlatform() !== 'ios') return;
    setIsIOSNative(true);
    setHealthOfferDismissed(readHealthOfferDismissed());
    import('@/lib/actions/healthkit')
      .then((m) => m.getHealthKitSyncContext())
      .then((ctx) => setHealthKitConnected(ctx.connected))
      .catch(() => setHealthKitConnected(false));
  }, []);

  const handleDismissHealthOffer = () => {
    setHealthOfferDismissed(true);
    persistHealthOfferDismissed();
  };

  const handleConnectAppleHealth = async () => {
    setIsConnectingHealth(true);
    try {
      const healthkit = await import('@/lib/integrations/healthkit');
      const result = await healthkit.requestHealthKitPermissions();
      if (!result.granted) return;

      const { upsertWearableConnection } = await import('@/lib/actions/wearable');
      await upsertWearableConnection({
        source: 'apple_healthkit',
        permissions: ['steps', 'active_energy', 'sleep', 'heart_rate'],
        deviceName: 'Apple Health',
      });
      setHealthKitConnected(true);

      const sync = await import('@/lib/integrations/healthkit-sync');
      await sync.runHealthKitSync({ force: true });

      // Pull the freshly-synced night into the slider (if one landed).
      const supabase = createUntypedClient();
      const { data } = await supabase
        .from('daily_check_ins')
        .select('sleep_hours, sleep_source')
        .eq('user_id', userId)
        .eq('date', getLocalDateString())
        .maybeSingle();
      if (data?.sleep_hours != null && data.sleep_source === 'healthkit') {
        const hours = Number(data.sleep_hours);
        setSleepHours(hours);
        setSleepSource('healthkit');
        setPrefilledSleepHours(hours);
      }
    } catch (error) {
      console.warn('Apple Health connect failed:', error);
    } finally {
      setIsConnectingHealth(false);
      handleDismissHealthOffer();
    }
  };
  
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
      
      // Manual correction wins: touching the auto-filled value re-tags the day
      // as manual so HealthKit never overwrites it again. Submitting an
      // untouched auto-fill keeps the healthkit tag (and future corrections).
      const submittedSleepSource =
        sleepSource === 'healthkit' && prefilledSleepHours === sleepHours
          ? 'healthkit'
          : 'manual';

      const checkInData = {
        user_id: userId,
        date: todayStr,
        sleep_hours: sleepHours,
        sleep_source: submittedSleepSource,
        sleep_quality: sleepQuality,
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

      setAlreadyCheckedIn(true);
      setTodaysCheckIn(checkInData);
      setSleepSource(submittedSleepSource);
      if (submittedSleepSource === 'manual') setPrefilledSleepHours(null);
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
            <p className="text-xs text-surface-500">
              {(todaysCheckIn as any).sleep_source === 'healthkit' ? 'Sleep ⌚' : 'Sleep'}
            </p>
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
          
          {currentQuestion.type === 'slider' && (
            <div className="space-y-2">
              <input
                type="range"
                min={currentQuestion.min}
                max={currentQuestion.max}
                step={currentQuestion.step}
                value={currentQuestion.value as number}
                onChange={(e) => currentQuestion.onChange(parseFloat(e.target.value))}
                className="w-full accent-primary-500"
              />
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">{currentQuestion.min}h</span>
                <span className="text-lg font-bold text-primary-400">
                  {currentQuestion.format?.(currentQuestion.value as number)}
                </span>
                <span className="text-surface-500">{currentQuestion.max}h</span>
              </div>

              {/* Auto-filled from Apple Health (untouched values keep the tag) */}
              {currentQuestion.id === 'sleep' &&
                sleepSource === 'healthkit' &&
                prefilledSleepHours === sleepHours && (
                  <p
                    className="text-xs text-surface-500 text-center"
                    data-testid="sleep-healthkit-tag"
                  >
                    ⌚ from Apple Health — adjust if it looks off
                  </p>
                )}

              {/* One-time inline offer (iOS native, not yet connected) */}
              {currentQuestion.id === 'sleep' &&
                isIOSNative &&
                healthKitConnected === false &&
                !healthOfferDismissed && (
                  <div
                    className="flex items-center justify-between gap-2 p-2 bg-surface-800 rounded-lg"
                    data-testid="sleep-healthkit-offer"
                  >
                    <button
                      onClick={handleConnectAppleHealth}
                      disabled={isConnectingHealth}
                      className="flex-1 text-left text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50"
                    >
                      {isConnectingHealth
                        ? 'Connecting to Apple Health…'
                        : '⌚ Auto-fill from Apple Health'}
                    </button>
                    <button
                      onClick={handleDismissHealthOffer}
                      aria-label="Dismiss Apple Health offer"
                      className="text-surface-500 hover:text-surface-300 text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                )}
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
          {(currentQuestion as any).warning && currentQuestion.value <= 2 && (
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
