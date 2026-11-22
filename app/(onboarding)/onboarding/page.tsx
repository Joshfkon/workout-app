'use client';

import { IconApple, IconBarbell, IconChartLine, IconRuler2, IconSparkles, IconWorld } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, ExplainedTerm } from '@/components/ui';
import { ContextCard } from '@/components/onboarding/ContextCard';
import { createUntypedClient } from '@/lib/supabase/client';
import { calculateBodyComposition, getFFMIAssessment, getFFMIBracket } from '@/services/coachingEngine';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { updateOnboardingStep } from '@/lib/onboarding/onboardingProgress';
import type { WeightUnit } from '@/types/schema';

// Unit conversion helpers
const cmToInches = (cm: number) => cm / 2.54;
const inchesToCm = (inches: number) => inches * 2.54;
const kgToLbs = (kg: number) => kg * 2.20462;
const lbsToKg = (lbs: number) => lbs / 2.20462;

// Convert total inches to feet and inches
const inchesToFeetInches = (totalInches: number) => {
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { feet, inches };
};

// Convert feet and inches to total inches
const feetInchesToInches = (feet: number, inches: number) => {
  return feet * 12 + inches;
};

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

export default function OnboardingBodyCompPage() {
  const router = useRouter();
  const { preferences, updatePreference } = useUserPreferences();
  
  // Step state: 'units' -> 'body-comp' -> 'goal'
  const [step, setStep] = useState<'units' | 'body-comp' | 'goal'>('units');
  const [selectedUnits, setSelectedUnits] = useState<WeightUnit>(preferences.units || 'lb');
  const units = selectedUnits;
  
  const [isLoading, setIsLoading] = useState(false);
  const [existingDexa, setExistingDexa] = useState<{
    weight_kg: number;
    lean_mass_kg: number;
    fat_mass_kg: number;
    body_fat_percent: number;
  } | null>(null);
  
  // Form state - stored in display units
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [heightDisplay, setHeightDisplay] = useState<string>('');
  // For imperial: feet and inches
  const [heightFeet, setHeightFeet] = useState<string>('');
  const [heightInches, setHeightInches] = useState<string>('');
  const [weightDisplay, setWeightDisplay] = useState<string>('');
  const [bodyFatPercent, setBodyFatPercent] = useState<string>('');
  // True when the user chose "Not sure" and we filled in a typical value.
  // A guessed body fat must not drive a muscle-mass verdict or a goal pick.
  const [bfEstimated, setBfEstimated] = useState(false);
  const [useDexa, setUseDexa] = useState(false);
  const [showBodyFatGuide, setShowBodyFatGuide] = useState(false);
  // Training goal (users.goal). Seeded from the signup selection; confirmed or
  // changed on the goal sub-step with body-fat-aware guidance.
  const [goal, setGoal] = useState<'bulk' | 'cut' | 'maintenance'>('maintenance');
  
  // Save unit preference and proceed
  const handleUnitsConfirm = async () => {
    await updatePreference('units', selectedUnits);
    
    // Track progress
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await updateOnboardingStep(supabase, user.id, 'units');
    }
    
    setStep('body-comp');
  };
  
  // Convert display values to metric for calculations
  const getHeightCm = () => {
    if (units === 'lb') {
      // Imperial: use feet + inches
      const feet = parseFloat(heightFeet) || 0;
      const inches = parseFloat(heightInches) || 0;
      if (feet === 0 && inches === 0) return 0;
      const totalInches = feetInchesToInches(feet, inches);
      return inchesToCm(totalInches);
    } else {
      // Metric: use cm
      if (!heightDisplay) return 0;
      return parseFloat(heightDisplay);
    }
  };
  
  const getWeightKg = () => {
    if (!weightDisplay) return 0;
    const val = parseFloat(weightDisplay);
    return units === 'lb' ? lbsToKg(val) : val;
  };
  
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
        .select('height_cm, sex, goal')
        .eq('id', user.id)
        .single();
      
      if (userData?.height_cm) {
        // Convert to display units
        if (units === 'lb') {
          const totalInches = cmToInches(userData.height_cm);
          const { feet, inches } = inchesToFeetInches(totalInches);
          setHeightFeet(String(feet));
          setHeightInches(String(inches));
        } else {
          setHeightDisplay(String(userData.height_cm));
        }
      }
      if (userData?.sex) {
        setSex(userData.sex as 'male' | 'female');
      }
      if (userData?.goal === 'bulk' || userData?.goal === 'cut' || userData?.goal === 'maintenance') {
        setGoal(userData.goal);
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
    
    if (height > 0 && weight > 0 && bf > 0 && bf < 100) {
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
  }, [heightDisplay, heightFeet, heightInches, weightDisplay, bodyFatPercent, useDexa, existingDexa, sex, units]);
  
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
  
  const handleContinue = async () => {
    setIsLoading(true);
    
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      // Convert display values to metric for storage
      const height = getHeightCm();
      const weight = useDexa && existingDexa ? existingDexa.weight_kg : getWeightKg();
      const bf = useDexa && existingDexa ? existingDexa.body_fat_percent : parseFloat(bodyFatPercent);
      
      // Create coaching session
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
      
      // Update user profile with sex, height, and the confirmed training goal
      await supabase
        .from('users')
        .update({ sex, height_cm: height, weight_kg: weight, goal })
        .eq('id', user.id);
      
      // Track progress - user completed goal selection
      await updateOnboardingStep(supabase, user.id, 'goal');
      
      // Navigate to benchmark selection with session ID
      router.push(`/onboarding/benchmarks?session=${session.id}`);
    } catch (err) {
      console.error('Error creating coaching session:', err);
    } finally {
      setIsLoading(false);
    }
  };
  
  const canContinue = bodyComp !== null && bodyComp.ffmi > 0;
  // Women's FFMI runs ~3 points lower; the scale bar shifts with it.
  const ffmiScaleMin = sex === 'female' ? 12 : 15;

  // Why Continue is disabled, in words (a dimmed button alone reads as broken).
  const missingBodyComp: string[] = [];
  if (!canContinue) {
    if (!(getHeightCm() > 0)) missingBodyComp.push('height');
    if (!(useDexa && existingDexa) && !(getWeightKg() > 0)) missingBodyComp.push('weight');
    const bfValue = useDexa && existingDexa ? existingDexa.body_fat_percent : parseFloat(bodyFatPercent);
    if (!(bfValue > 0 && bfValue < 100)) missingBodyComp.push('body-fat estimate');
  }
  
  // Unit selection step
  if (step === 'units') {
    return (
      <div className="max-w-md mx-auto space-y-8 animate-fade-in">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
                s === 1 
                  ? 'bg-action text-on-action' 
                  : 'bg-fill text-ink-3'
              }`}>
                {s}
              </div>
              {s < 4 && (
                <div className="w-12 h-0.5 bg-fill" />
              )}
            </div>
          ))}
        </div>
        
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
            First, which measurement system do you prefer?
          </p>
        </div>
        
        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setSelectedUnits('lb')}
                className={`p-6 rounded-xl border-2 transition-all ${
                  selectedUnits === 'lb'
                    ? 'border-action bg-action/10'
                    : 'border-sep hover:border-sep bg-fill/50'
                }`}
              >
                <div className="text-center">
                  <IconRuler2 size={36} className="mx-auto mb-2 text-action" aria-hidden="true" />
                  <div className="text-title font-bold text-ink">Imperial</div>
                  <div className="text-body text-ink-2 mt-1">lbs, inches</div>
                </div>
              </button>
              
              <button
                onClick={() => setSelectedUnits('kg')}
                className={`p-6 rounded-xl border-2 transition-all ${
                  selectedUnits === 'kg'
                    ? 'border-action bg-action/10'
                    : 'border-sep hover:border-sep bg-fill/50'
                }`}
              >
                <div className="text-center">
                  <IconWorld size={36} className="mx-auto mb-2 text-action" aria-hidden="true" />
                  <div className="text-title font-bold text-ink">Metric</div>
                  <div className="text-body text-ink-2 mt-1">kg, cm</div>
                </div>
              </button>
            </div>
            
            <p className="text-caption text-ink-3 text-center mt-4">
              You can change this anytime in Settings
            </p>
          </CardContent>
        </Card>
        
        <Button onClick={handleUnitsConfirm} className="w-full" size="lg">
          Continue
          <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
      </div>
    );
  }

  // Goal selection step
  if (step === 'goal') {
    const bf = useDexa && existingDexa ? existingDexa.body_fat_percent : parseFloat(bodyFatPercent);
    // Body-fat-aware guidance, mirroring the mesocycle builder's DEXA thresholds
    // A typical-value guess ("Not sure") never drives a recommendation.
    const recommended: 'bulk' | 'cut' | null = bfEstimated || !bf || isNaN(bf)
      ? null
      : bf >= (sex === 'male' ? 20 : 30)
        ? 'cut'
        : bf <= (sex === 'male' ? 12 : 20)
          ? 'bulk'
          : null;

    const GOAL_OPTIONS: { value: 'cut' | 'maintenance' | 'bulk'; label: string; description: string }[] = [
      { value: 'cut', label: 'Cut', description: 'Lose fat while holding on to muscle. Calorie deficit.' },
      { value: 'maintenance', label: 'Maintain', description: 'Hold steady or recomp. Eat around maintenance.' },
      { value: 'bulk', label: 'Bulk', description: 'Build muscle. Calorie surplus.' },
    ];

    return (
      <div className="max-w-md mx-auto space-y-6 animate-fade-in">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
                s <= 2
                  ? 'bg-action text-on-action'
                  : 'bg-fill text-ink-3'
              }`}>
                {s}
              </div>
              {s < 4 && (
                <div className={`w-12 h-0.5 ${s < 2 ? 'bg-action' : 'bg-fill'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="text-center mb-6">
          <h1 className="text-large-title font-bold text-ink mb-2">What&apos;s your goal right now?</h1>
          <p className="text-ink-2">
            This sets your training phase — it shapes your program&apos;s volume, rep ranges, and nutrition targets.
          </p>
        </div>

        {recommended && (
          <div className="p-3 bg-action/10 border border-action/20 rounded-lg">
            <p className="text-body text-action">
              Going by body fat alone (~{bf.toFixed(0)}%), {recommended === 'cut'
                ? 'a cut would be a good starting point.'
                : 'you’re lean enough that a bulk would put most extra calories toward muscle.'}{' '}
              Already have a plan, like cutting for a show? Pick that. Your choice wins.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {GOAL_OPTIONS.map((option) => {
            const isSelected = goal === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setGoal(option.value)}
                aria-pressed={isSelected}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'bg-action/10 border-action'
                    : 'bg-card border-sep hover:border-sep'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{option.label}</span>
                  {recommended === option.value && (
                    <span className="text-caption font-medium px-2 py-0.5 rounded-full bg-status-ok/10 text-status-ok">
                      Fits your body fat
                    </span>
                  )}
                </div>
                <p className="text-body text-ink-2 mt-1">{option.description}</p>
              </button>
            );
          })}
        </div>

        <p className="text-caption text-ink-3 text-center">
          You can change this anytime from the phase chip on your dashboard.
        </p>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={() => setStep('body-comp')} disabled={isLoading}>
            Back
          </Button>
          <Button
            size="lg"
            onClick={handleContinue}
            disabled={isLoading}
            isLoading={isLoading}
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-subhead font-medium ${
              s <= 2 
                ? 'bg-action text-on-action' 
                : 'bg-fill text-ink-3'
            }`}>
              {s}
            </div>
            {s < 4 && (
              <div className={`w-12 h-0.5 ${s < 2 ? 'bg-action' : 'bg-fill'}`} />
            )}
          </div>
        ))}
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
            <Select
              label="Sex"
              value={sex}
              onChange={(e) => setSex(e.target.value as 'male' | 'female')}
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
              ]}
              hint="Used for strength percentile comparisons"
            />
            
            {units === 'lb' ? (
              <div>
                <label className="block text-body font-medium text-ink mb-2">Height</label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      value={heightFeet}
                      onChange={(e) => setHeightFeet(e.target.value)}
                      placeholder="5"
                      min={3}
                      max={8}
                    />
                    <span className="text-caption text-ink-3 mt-1 block text-center">feet</span>
                  </div>
                  <div className="flex-1">
                    <Input
                      type="number"
                      value={heightInches}
                      onChange={(e) => setHeightInches(e.target.value)}
                      placeholder="9"
                      min={0}
                      max={11}
                    />
                    <span className="text-caption text-ink-3 mt-1 block text-center">inches</span>
                  </div>
                </div>
              </div>
            ) : (
              <Input
                label="Height (cm)"
                type="number"
                value={heightDisplay}
                onChange={(e) => setHeightDisplay(e.target.value)}
                placeholder="175"
                min={100}
                max={250}
              />
            )}
            
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
              <div className="flex items-end gap-2">
                <div className="flex-1">
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
                    hint={
                      useDexa
                        ? 'Using DEXA scan data'
                        : bfEstimated
                          ? 'A typical value for now. Update it any time.'
                          : "Don't know it? Use the visual guide, or tap Not sure."
                    }
                  />
                </div>
                {!useDexa && (
                  <Button 
                    type="button"
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowBodyFatGuide(!showBodyFatGuide)}
                    className="mb-1"
                  >
                    {showBodyFatGuide ? 'Hide guide' : 'Visual guide'}
                  </Button>
                )}
              </div>
              {!useDexa && !bfEstimated && !(parseFloat(bodyFatPercent) > 0) && (
                <button
                  type="button"
                  className="mt-2 text-subhead font-medium text-action"
                  data-testid="body-fat-not-sure"
                  onClick={() => {
                    // Typical adult values; flagged so nothing downstream
                    // presents a verdict built on a guess.
                    setBodyFatPercent(sex === 'female' ? '32' : '22');
                    setBfEstimated(true);
                    setShowBodyFatGuide(false);
                  }}
                >
                  Not sure — use a typical estimate
                </button>
              )}
              
              {/* Body fat visual guide */}
              {!useDexa && showBodyFatGuide && (
                <div className="mt-3 p-4 bg-fill/50 rounded-lg border border-sep">
                  <p className="text-body font-medium text-ink mb-3">
                    Tap a body fat level that looks closest to you ({sex === 'male' ? 'Male' : 'Female'}):
                  </p>
                  
                  {sex === 'male' ? (
                    <>
                      {/* Visual guide image for males */}
                      <div className="rounded-lg overflow-hidden mb-3 relative">
                        <Image 
                          src="/images/body-fat-guide-male.png" 
                          alt="Male body fat percentage visual guide"
                          width={600}
                          height={600}
                          className="w-full h-auto"
                          priority
                        />
                      </div>
                      
                      {/* Clickable options */}
                      <div className="grid grid-cols-4 gap-2">
                        {BODY_FAT_OPTIONS.male.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setBodyFatPercent(String(option.value));
                              setShowBodyFatGuide(false);
                            }}
                            className={`p-2 rounded-lg text-center transition-all ${
                              bodyFatPercent === String(option.value)
                                ? 'bg-action text-on-action'
                                : 'bg-sep hover:bg-sep text-ink'
                            }`}
                          >
                            <p className="text-headline font-bold">{option.label}</p>
                            <p className="text-caption opacity-75">{option.description}</p>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Visual guide image for females */}
                      <div className="rounded-lg overflow-hidden mb-3 relative">
                        <Image 
                          src="/images/body-fat-guide-female.png" 
                          alt="Female body fat percentage visual guide"
                          width={600}
                          height={600}
                          className="w-full h-auto"
                          priority
                        />
                      </div>
                      
                      {/* Clickable options */}
                      <div className="grid grid-cols-4 gap-2">
                        {BODY_FAT_OPTIONS.female.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setBodyFatPercent(String(option.value));
                              setShowBodyFatGuide(false);
                            }}
                            className={`p-2 rounded-lg text-center transition-all ${
                              bodyFatPercent === String(option.value)
                                ? 'bg-action text-on-action'
                                : 'bg-sep hover:bg-sep text-ink'
                            }`}
                          >
                            <p className="text-headline font-bold">{option.label}</p>
                            <p className="text-caption opacity-75">{option.description}</p>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  
                  <p className="text-caption text-ink-3 mt-3 text-center">
                    Don&apos;t worry about being exact — an estimate is fine!
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
                We&apos;re using a typical body-fat value, so we&apos;ll skip the muscle-mass rating for now.
                Add your real number later in Settings and we&apos;ll fill this in.
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
              ' Not sure of your body fat? Pick the closest look in the visual guide, or tap Not sure.'}
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

