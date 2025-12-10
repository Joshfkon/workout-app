'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { calculateBodyComposition, getFFMIAssessment, getFFMIBracket } from '@/services/coachingEngine';
import { useUserPreferences } from '@/hooks/useUserPreferences';

// Unit conversion helpers
const cmToInches = (cm: number) => cm / 2.54;
const inchesToCm = (inches: number) => inches * 2.54;
const kgToLbs = (kg: number) => kg * 2.20462;
const lbsToKg = (lbs: number) => lbs / 2.20462;

// Body fat visual reference images descriptions
const BODY_FAT_REFERENCES = {
  male: [
    { range: '8-10%', description: 'Very lean, visible abs, vascular' },
    { range: '12-15%', description: 'Athletic, some ab definition' },
    { range: '18-20%', description: 'Average, soft midsection' },
    { range: '25%+', description: 'Higher body fat, no ab definition' },
  ],
  female: [
    { range: '15-18%', description: 'Very lean, visible abs' },
    { range: '20-23%', description: 'Athletic, toned' },
    { range: '25-28%', description: 'Average, feminine shape' },
    { range: '32%+', description: 'Higher body fat' },
  ]
};

export default function OnboardingBodyCompPage() {
  const router = useRouter();
  const { preferences } = useUserPreferences();
  const units = preferences.units;
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
  const [weightDisplay, setWeightDisplay] = useState<string>('');
  const [bodyFatPercent, setBodyFatPercent] = useState<string>('');
  const [useDexa, setUseDexa] = useState(false);
  
  // Convert display values to metric for calculations
  const getHeightCm = () => {
    if (!heightDisplay) return 0;
    const val = parseFloat(heightDisplay);
    return units === 'lb' ? inchesToCm(val) : val;
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
        const displayHeight = units === 'lb' 
          ? cmToInches(userData.height_cm).toFixed(1)
          : String(userData.height_cm);
        setHeightDisplay(displayHeight);
      }
      if (userData?.sex) {
        setSex(userData.sex as 'male' | 'female');
      }
    }
    
    fetchDexaData();
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
  }, [heightDisplay, weightDisplay, bodyFatPercent, useDexa, existingDexa, sex, units]);
  
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
  
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === 1 
                ? 'bg-primary-500 text-white' 
                : 'bg-surface-800 text-surface-500'
            }`}>
              {step}
            </div>
            {step < 4 && (
              <div className={`w-12 h-0.5 ${step < 1 ? 'bg-primary-500' : 'bg-surface-800'}`} />
            )}
          </div>
        ))}
      </div>
      
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Welcome to HyperTrack!</h1>
        <p className="text-surface-400">
          Let&apos;s start by understanding your body composition. This helps us calibrate your strength profile.
        </p>
      </div>
      
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
            
            <Input
              label={`Height (${units === 'lb' ? 'inches' : 'cm'})`}
              type="number"
              value={heightDisplay}
              onChange={(e) => setHeightDisplay(e.target.value)}
              placeholder={units === 'lb' ? '69' : '175'}
              min={units === 'lb' ? 40 : 100}
              max={units === 'lb' ? 96 : 250}
            />
            
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
                hint={useDexa ? 'Using DEXA scan data' : 'Estimate if you don\'t know'}
              />
              
              {/* Body fat reference guide */}
              {!useDexa && (
                <div className="mt-2 p-3 bg-surface-800/50 rounded-lg">
                  <p className="text-xs text-surface-500 mb-2">Visual reference ({sex}):</p>
                  <div className="grid grid-cols-2 gap-2">
                    {BODY_FAT_REFERENCES[sex].map((ref) => (
                      <button
                        key={ref.range}
                        type="button"
                        onClick={() => setBodyFatPercent(ref.range.split('-')[0].replace('%', ''))}
                        className="p-2 text-left rounded bg-surface-800 hover:bg-surface-700 transition-colors"
                      >
                        <p className="text-sm font-medium text-surface-200">{ref.range}</p>
                        <p className="text-xs text-surface-500">{ref.description}</p>
                      </button>
                    ))}
                  </div>
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
                  <p className="text-sm text-surface-500 mb-1">Fat-Free Mass Index (FFMI)</p>
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
                
                {/* Assessment */}
                <p className="text-sm text-surface-400">
                  {bodyComp.ffmiAssessment}
                </p>
                
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

