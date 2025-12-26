'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, ExplainedTerm } from '@/components/ui';
import { ContextCard } from '@/components/onboarding/ContextCard';
import { createUntypedClient } from '@/lib/supabase/client';
import { calculateBodyComposition, getFFMIAssessment, getFFMIBracket } from '@/services/coachingEngine';
import { useUserPreferences } from '@/hooks/useUserPreferences';
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
    { value: 9, label: '9%', description: 'Hard Abs' },
    { value: 12, label: '12%', description: 'Faint Abs' },
    { value: 15, label: '15%', description: 'Flat Stomach' },
    { value: 20, label: '20%', description: 'Soft Everything' },
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
  
  // Step state: 'units' -> 'body-comp'
  const [step, setStep] = useState<'units' | 'body-comp'>('units');
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
  const [useDexa, setUseDexa] = useState(false);
  const [showBodyFatGuide, setShowBodyFatGuide] = useState(false);
  
  // Save unit preference and proceed
  const handleUnitsConfirm = async () => {
    await updatePreference('units', selectedUnits);
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
        .select('height_cm, sex')
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
        ffmiBracket: getFFMIBracket(comp.ffmi)
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
            leanMassKg: bodyComp?.leanMassKg,
            ffmi: bodyComp?.ffmi
          },
          selected_benchmarks: []
        })
        .select()
        .single();
      
      if (sessionError) throw sessionError;
      
      // Update user profile with sex and height
      await supabase
        .from('users')
        .update({ sex, height_cm: height, weight_kg: weight })
        .eq('id', user.id);
      
      // Navigate to benchmark selection with session ID
      router.push(`/onboarding/benchmarks?session=${session.id}`);
    } catch (err) {
      console.error('Error creating coaching session:', err);
    } finally {
      setIsLoading(false);
    }
  };
  
  const canContinue = bodyComp !== null && bodyComp.ffmi > 0;
  
  // Unit selection step
  if (step === 'units') {
    return (
      <div className="max-w-md mx-auto space-y-8 animate-fade-in">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s === 1 
                  ? 'bg-primary-500 text-white' 
                  : 'bg-surface-800 text-surface-500'
              }`}>
                {s}
              </div>
              {s < 4 && (
                <div className="w-12 h-0.5 bg-surface-800" />
              )}
            </div>
          ))}
        </div>
        
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Welcome to HyperTracker!</h1>
          <p className="text-surface-400 mb-6">
            Your AI-powered hypertrophy training and nutrition companion.
          </p>
          
          {/* Feature highlights */}
          <div className="grid grid-cols-2 gap-3 mb-6 text-left">
            <div className="p-3 bg-surface-800/50 rounded-lg border border-surface-700">
              <span className="text-lg">🏋️</span>
              <p className="text-sm font-medium text-surface-200 mt-1">Smart Workouts</p>
              <p className="text-xs text-surface-500">AI mesocycle planning</p>
            </div>
            <div className="p-3 bg-surface-800/50 rounded-lg border border-surface-700">
              <span className="text-lg">🍎</span>
              <p className="text-sm font-medium text-surface-200 mt-1">Nutrition Tracking</p>
              <p className="text-xs text-surface-500">300K+ food database</p>
            </div>
            <div className="p-3 bg-surface-800/50 rounded-lg border border-surface-700">
              <span className="text-lg">🤖</span>
              <p className="text-sm font-medium text-surface-200 mt-1">AI Coaching</p>
              <p className="text-xs text-surface-500">Personalized advice</p>
            </div>
            <div className="p-3 bg-surface-800/50 rounded-lg border border-surface-700">
              <span className="text-lg">📊</span>
              <p className="text-sm font-medium text-surface-200 mt-1">Body Analytics</p>
              <p className="text-xs text-surface-500">DEXA & FFMI tracking</p>
            </div>
          </div>
          
          <p className="text-surface-400">
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
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                }`}
              >
                <div className="text-center">
                  <div className="text-4xl mb-2">🇺🇸</div>
                  <div className="text-xl font-bold text-white">Imperial</div>
                  <div className="text-sm text-surface-400 mt-1">lbs, inches</div>
                </div>
              </button>
              
              <button
                onClick={() => setSelectedUnits('kg')}
                className={`p-6 rounded-xl border-2 transition-all ${
                  selectedUnits === 'kg'
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                }`}
              >
                <div className="text-center">
                  <div className="text-4xl mb-2">🌍</div>
                  <div className="text-xl font-bold text-white">Metric</div>
                  <div className="text-sm text-surface-400 mt-1">kg, cm</div>
                </div>
              </button>
            </div>
            
            <p className="text-xs text-surface-500 text-center mt-4">
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
  
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              s <= 2 
                ? 'bg-primary-500 text-white' 
                : 'bg-surface-800 text-surface-500'
            }`}>
              {s}
            </div>
            {s < 4 && (
              <div className={`w-12 h-0.5 ${s < 2 ? 'bg-primary-500' : 'bg-surface-800'}`} />
            )}
          </div>
        ))}
      </div>
      
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Body Composition</h1>
        <p className="text-surface-400">
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
        <Card className="bg-primary-500/10 border-primary-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-primary-400">DEXA Scan Data Found!</p>
                <p className="text-sm text-surface-400">
                  We found your DEXA scan: {existingDexa.weight_kg}kg, {existingDexa.body_fat_percent.toFixed(1)}% body fat
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={handleUseDexa}>
                Use DEXA Data
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      <div className="grid md:grid-cols-2 gap-6">
        {/* Input form */}
        <Card>
          <CardHeader>
            <CardTitle>Body Composition</CardTitle>
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
                <label className="block text-sm font-medium text-surface-200 mb-2">Height</label>
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
                    <span className="text-xs text-surface-500 mt-1 block text-center">feet</span>
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
                    <span className="text-xs text-surface-500 mt-1 block text-center">inches</span>
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
                    label="Body Fat %"
                    type="number"
                    value={useDexa && existingDexa ? String(existingDexa.body_fat_percent) : bodyFatPercent}
                    onChange={(e) => {
                      setUseDexa(false);
                      setBodyFatPercent(e.target.value);
                    }}
                    placeholder="15"
                    min={3}
                    max={60}
                    step={0.5}
                    disabled={useDexa}
                    hint={useDexa ? 'Using DEXA scan data' : ''}
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
                    {showBodyFatGuide ? 'Hide Guide' : '📷 Visual Guide'}
                  </Button>
                )}
              </div>
              
              {/* Body fat visual guide */}
              {!useDexa && showBodyFatGuide && (
                <div className="mt-3 p-4 bg-surface-800/50 rounded-lg border border-surface-700">
                  <p className="text-sm font-medium text-surface-200 mb-3">
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
                                ? 'bg-primary-500 text-white'
                                : 'bg-surface-700 hover:bg-surface-600 text-surface-200'
                            }`}
                          >
                            <p className="text-lg font-bold">{option.label}</p>
                            <p className="text-xs opacity-75">{option.description}</p>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    // Female options (no image yet, but keep text options)
                    <div className="grid grid-cols-2 gap-2">
                      {BODY_FAT_OPTIONS.female.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setBodyFatPercent(String(option.value));
                            setShowBodyFatGuide(false);
                          }}
                          className={`p-3 rounded-lg text-left transition-all ${
                            bodyFatPercent === String(option.value)
                              ? 'bg-primary-500 text-white'
                              : 'bg-surface-700 hover:bg-surface-600 text-surface-200'
                          }`}
                        >
                          <p className="text-lg font-bold">{option.label}</p>
                          <p className="text-xs opacity-75">{option.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  <p className="text-xs text-surface-500 mt-3 text-center">
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
            <CardTitle>Your Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {bodyComp ? (
              <div className="space-y-6">
                {/* FFMI display */}
                <div className="text-center p-6 bg-surface-800/50 rounded-xl">
                  <p className="text-sm text-surface-500 mb-1">
                    <ExplainedTerm term="FFMI" />
                  </p>
                  <p className="text-5xl font-bold text-white mb-2">{bodyComp.ffmi.toFixed(1)}</p>
                  <p className={`text-sm font-medium capitalize ${
                    bodyComp.ffmiBracket === 'elite' ? 'text-accent-400' :
                    bodyComp.ffmiBracket === 'excellent' ? 'text-primary-400' :
                    bodyComp.ffmiBracket === 'above_average' ? 'text-success-400' :
                    bodyComp.ffmiBracket === 'average' ? 'text-info-400' :
                    'text-surface-400'
                  }`}>
                    {bodyComp.ffmiBracket.replace('_', ' ')}
                  </p>
                </div>
                
                {/* Assessment with beginner-friendly context */}
                <div className="p-3 bg-surface-800/30 rounded-lg border border-surface-700">
                  <p className="text-sm text-surface-300 mb-2">
                    {bodyComp.ffmiAssessment}
                  </p>
                  <p className="text-xs text-surface-500">
                    This helps us understand your current muscle development and set realistic goals.
                  </p>
                </div>
                
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-surface-800/50 rounded-lg text-center">
                    <p className="text-xs text-surface-500">Lean Mass</p>
                    <p className="text-lg font-semibold text-surface-200">
                      {units === 'lb' 
                        ? `${kgToLbs(bodyComp.leanMassKg).toFixed(1)} lbs`
                        : `${bodyComp.leanMassKg.toFixed(1)} kg`}
                    </p>
                  </div>
                  <div className="p-3 bg-surface-800/50 rounded-lg text-center">
                    <p className="text-xs text-surface-500">Fat Mass</p>
                    <p className="text-lg font-semibold text-surface-200">
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
                  <p className="text-xs text-surface-500">FFMI Scale ({sex === 'male' ? 'Men' : 'Women'})</p>
                  <div className="h-3 bg-surface-800 rounded-full overflow-hidden relative">
                    <div 
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-surface-600 via-success-500 to-accent-500"
                      style={{ width: '100%' }}
                    />
                    {/* Marker */}
                    <div 
                      className="absolute top-0 w-1 h-full bg-white shadow-lg"
                      style={{ 
                        left: `${Math.min(100, Math.max(0, ((bodyComp.ffmi - 15) / 12) * 100))}%`,
                        transform: 'translateX(-50%)'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-surface-500">
                    <span>15</span>
                    <span>18</span>
                    <span>21</span>
                    <span>24</span>
                    <span>27</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-surface-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <p>Enter your measurements to see your metrics</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Continue button */}
      <div className="flex justify-end pt-4">
        <Button 
          size="lg" 
          onClick={handleContinue} 
          disabled={!canContinue || isLoading}
          isLoading={isLoading}
        >
          Continue to Strength Testing
          <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

