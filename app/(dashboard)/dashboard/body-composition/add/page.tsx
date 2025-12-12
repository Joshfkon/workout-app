'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { calculateLeanMass, calculateFatMass } from '@/services/bodyCompEngine';
import type { DexaRegionalData } from '@/types/schema';
import { useUserPreferences } from '@/hooks/useUserPreferences';

// Unit conversion helpers
const kgToLbs = (kg: number) => kg * 2.20462;
const lbsToKg = (lbs: number) => lbs / 2.20462;

export default function AddDexaScanPage() {
  const router = useRouter();
  const { preferences } = useUserPreferences();
  const units = preferences.units;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state - stored in display units, converted to kg on save
  const [scanDate, setScanDate] = useState(new Date().toISOString().split('T')[0]);
  const [weightDisplay, setWeightDisplay] = useState('');
  const [bodyFatPercent, setBodyFatPercent] = useState('');
  const [leanMassDisplay, setLeanMassDisplay] = useState('');
  const [fatMassDisplay, setFatMassDisplay] = useState('');
  const [boneMassDisplay, setBoneMassDisplay] = useState('');
  const [notes, setNotes] = useState('');
  const [inputMode, setInputMode] = useState<'calculated' | 'manual'>('calculated');

  // Progress photo upload state
  const [progressPhoto, setProgressPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  
  // Convert display value to kg
  const toKg = (displayValue: string): number => {
    const val = parseFloat(displayValue);
    if (isNaN(val)) return 0;
    return units === 'lb' ? lbsToKg(val) : val;
  };
  
  // Convert kg to display value
  const toDisplay = (kgValue: number): string => {
    return units === 'lb' ? kgToLbs(kgValue).toFixed(2) : kgValue.toFixed(2);
  };
  
  // Regional data state
  const [showRegionalData, setShowRegionalData] = useState(false);
  const [regionalInputMode, setRegionalInputMode] = useState<'combined' | 'split'>('combined');
  const [regionalData, setRegionalData] = useState({
    // Combined totals (for DEXA scans that don't split left/right)
    totalArmsFat: '', totalArmsLean: '',
    totalLegsFat: '', totalLegsLean: '',
    // Split values (for DEXA scans that do split)
    leftArmFat: '', leftArmLean: '',
    rightArmFat: '', rightArmLean: '',
    leftLegFat: '', leftLegLean: '',
    rightLegFat: '', rightLegLean: '',
    // Always single values
    trunkFat: '', trunkLean: '',
    androidFat: '', gynoidFat: '',
  });

  // Handle photo selection
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid image file');
        return;
      }
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        setError('Image size must be less than 10MB');
        return;
      }
      setProgressPhoto(file);
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Remove photo
  const handleRemovePhoto = () => {
    setProgressPhoto(null);
    setPhotoPreview(null);
  };

  // Auto-calculate lean/fat mass when weight and body fat are entered
  const handleWeightOrBfChange = (newWeight: string, newBf: string) => {
    setWeightDisplay(newWeight);
    setBodyFatPercent(newBf);
    
    if (inputMode === 'calculated') {
      const weightInKg = toKg(newWeight);
      const bf = parseFloat(newBf);
      
      if (weightInKg > 0 && !isNaN(bf) && bf >= 0 && bf <= 100) {
        const leanKg = calculateLeanMass(weightInKg, bf);
        const fatKg = calculateFatMass(weightInKg, bf);
        // Display in user's preferred units
        setLeanMassDisplay(toDisplay(leanKg));
        setFatMassDisplay(toDisplay(fatKg));
      }
    }
  };

  // Build regional data object if any regional fields are filled
  const buildRegionalData = (): { data: DexaRegionalData | null; error: string | null } => {
    const { totalArmsFat, totalArmsLean, totalLegsFat, totalLegsLean,
            leftArmFat, leftArmLean, rightArmFat, rightArmLean,
            leftLegFat, leftLegLean, rightLegFat, rightLegLean,
            trunkFat, trunkLean, androidFat, gynoidFat } = regionalData;
    
    // Check if any regional data was entered
    const hasAnyRegionalData = Object.values(regionalData).some(v => v !== '');
    if (!hasAnyRegionalData) return { data: null, error: null };
    
    // Validate based on input mode
    const missingFields: string[] = [];
    
    if (regionalInputMode === 'combined') {
      // Combined mode - just need total arms, total legs, trunk
      if (!totalArmsLean) missingFields.push('Total Arms Lean');
      if (!totalLegsLean) missingFields.push('Total Legs Lean');
      if (!trunkLean) missingFields.push('Trunk Lean');
      
      if (missingFields.length > 0) {
        return { 
          data: null, 
          error: `Missing required fields: ${missingFields.join(', ')}`
        };
      }
      
      // Split totals evenly between left/right (assumes symmetry)
      const armsLean = parseFloat(totalArmsLean) || 0;
      const armsFat = parseFloat(totalArmsFat) || 0;
      const legsLean = parseFloat(totalLegsLean) || 0;
      const legsFat = parseFloat(totalLegsFat) || 0;
      
      return {
        data: {
          left_arm: { fat_g: armsFat / 2, lean_g: armsLean / 2 },
          right_arm: { fat_g: armsFat / 2, lean_g: armsLean / 2 },
          left_leg: { fat_g: legsFat / 2, lean_g: legsLean / 2 },
          right_leg: { fat_g: legsFat / 2, lean_g: legsLean / 2 },
          trunk: { fat_g: parseFloat(trunkFat) || 0, lean_g: parseFloat(trunkLean) || 0 },
          android: { fat_g: parseFloat(androidFat) || 0 },
          gynoid: { fat_g: parseFloat(gynoidFat) || 0 },
        },
        error: null
      };
    } else {
      // Split mode - need individual left/right values
      if (!leftArmLean) missingFields.push('Left Arm Lean');
      if (!rightArmLean) missingFields.push('Right Arm Lean');
      if (!leftLegLean) missingFields.push('Left Leg Lean');
      if (!rightLegLean) missingFields.push('Right Leg Lean');
      if (!trunkLean) missingFields.push('Trunk Lean');
      
      if (missingFields.length > 0) {
        return { 
          data: null, 
          error: `Missing required fields: ${missingFields.join(', ')}`
        };
      }
      
      return {
        data: {
          left_arm: { fat_g: parseFloat(leftArmFat) || 0, lean_g: parseFloat(leftArmLean) || 0 },
          right_arm: { fat_g: parseFloat(rightArmFat) || 0, lean_g: parseFloat(rightArmLean) || 0 },
          left_leg: { fat_g: parseFloat(leftLegFat) || 0, lean_g: parseFloat(leftLegLean) || 0 },
          right_leg: { fat_g: parseFloat(rightLegFat) || 0, lean_g: parseFloat(rightLegLean) || 0 },
          trunk: { fat_g: parseFloat(trunkFat) || 0, lean_g: parseFloat(trunkLean) || 0 },
          android: { fat_g: parseFloat(androidFat) || 0 },
          gynoid: { fat_g: parseFloat(gynoidFat) || 0 },
        },
        error: null
      };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be logged in');

      // Upload progress photo if one is selected
      let progressPhotoUrl: string | null = null;
      if (progressPhoto) {
        setIsUploadingPhoto(true);
        const fileExt = progressPhoto.name.split('.').pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('progress-photos')
          .upload(fileName, progressPhoto, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error('Photo upload error:', uploadError);
          throw new Error(`Failed to upload photo: ${uploadError.message}`);
        }

        // Get the public URL (or signed URL for private buckets)
        const { data: { publicUrl } } = supabase.storage
          .from('progress-photos')
          .getPublicUrl(fileName);

        progressPhotoUrl = fileName; // Store the path, not the public URL
        setIsUploadingPhoto(false);
      }

      // Convert display values to kg for storage
      const weight = toKg(weightDisplay);
      const bf = parseFloat(bodyFatPercent);
      const lean = toKg(leanMassDisplay);
      const fat = toKg(fatMassDisplay);
      const bone = boneMassDisplay ? toKg(boneMassDisplay) : null;
      
      // Build and validate regional data
      const regionalResult = buildRegionalData();
      if (regionalResult.error) {
        throw new Error(regionalResult.error);
      }

      if (isNaN(weight) || isNaN(bf) || isNaN(lean) || isNaN(fat)) {
        throw new Error('Please fill in all required fields with valid numbers');
      }

      if (bf < 0 || bf > 100) {
        throw new Error('Body fat percentage must be between 0 and 100');
      }

      // Validate numeric ranges to prevent database overflow
      // DECIMAL(5,2) max is 999.99, DECIMAL(4,2) max is 99.99
      if (weight > 999) {
        throw new Error('Weight seems too high. Please enter weight in kg (not grams or lbs).');
      }
      if (lean > 999) {
        throw new Error('Lean mass seems too high. Please enter in kg (not grams).');
      }
      if (fat > 999) {
        throw new Error('Fat mass seems too high. Please enter in kg (not grams).');
      }
      if (bone && bone > 99) {
        throw new Error('Bone mass seems too high. Please enter in kg (not grams).');
      }

      console.log('Saving DEXA scan with regional data:', regionalResult.data);

      // Round numbers to match database precision (DECIMAL(5,2) and DECIMAL(4,1))
      const roundedWeight = Math.round(weight * 100) / 100;  // 2 decimal places
      const roundedLean = Math.round(lean * 100) / 100;
      const roundedFat = Math.round(fat * 100) / 100;
      const roundedBf = Math.round(bf * 10) / 10;  // 1 decimal place
      const roundedBone = bone ? Math.round(bone * 100) / 100 : null;

      // Build insert object - only include regional_data if we have it
      const insertData: Record<string, unknown> = {
        user_id: user.id,
        scan_date: scanDate,
        weight_kg: roundedWeight,
        lean_mass_kg: roundedLean,
        fat_mass_kg: roundedFat,
        body_fat_percent: roundedBf,
        bone_mass_kg: roundedBone,
        notes: notes || null,
        progress_photo_url: progressPhotoUrl,
      };

      // Only add regional_data if it's not null (column might not exist in older DBs)
      if (regionalResult.data) {
        insertData.regional_data = regionalResult.data;
      }

      const { error: insertError, data: insertedData } = await supabase
        .from('dexa_scans')
        .insert(insertData)
        .select();

      console.log('Insert result:', { error: insertError, data: insertedData });

      if (insertError) {
        console.error('Insert error details:', {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
        });
        
        // Show more specific error messages
        if (insertError.message?.includes('duplicate') || insertError.code === '23505') {
          throw new Error(`A scan already exists for ${scanDate}. Please choose a different date.`);
        }
        if (insertError.message?.includes('regional_data') || insertError.code === '42703') {
          // Column doesn't exist - try again without regional_data
          console.log('Retrying without regional_data...');
          const { error: retryError } = await supabase.from('dexa_scans').insert({
            user_id: user.id,
            scan_date: scanDate,
            weight_kg: weight,
            lean_mass_kg: lean,
            fat_mass_kg: fat,
            body_fat_percent: bf,
            bone_mass_kg: bone,
            notes: notes || null,
          });
          if (retryError) {
            throw new Error(retryError.message || 'Failed to save scan');
          }
          // Success without regional data
          router.push('/dashboard/body-composition');
          return;
        }
        if (insertError.message?.includes('violates row-level security')) {
          throw new Error('Permission denied. Please log out and log back in.');
        }
        throw new Error(insertError.message || 'Failed to save scan to database');
      }

      router.push('/dashboard/body-composition');
    } catch (err) {
      console.error('Submit error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save scan');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Add DEXA Scan</h1>
        <p className="text-surface-400 mt-1">Record your body composition data</p>
      </div>

      {error && (
        <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Date */}
            <Input
              label="Scan Date"
              type="date"
              value={scanDate}
              onChange={(e) => setScanDate(e.target.value)}
              required
            />

            {/* Input Mode Toggle */}
            <div className="flex gap-2 p-1 bg-surface-800 rounded-lg">
              <button
                type="button"
                onClick={() => setInputMode('calculated')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  inputMode === 'calculated'
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Auto-Calculate
              </button>
              <button
                type="button"
                onClick={() => setInputMode('manual')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  inputMode === 'manual'
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Manual Entry
              </button>
            </div>

            {inputMode === 'calculated' ? (
              <>
                <p className="text-xs text-surface-500">
                  Enter your total weight and body fat %, and lean/fat mass will be calculated automatically.
                </p>
                
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={`Total Weight (${units === 'lb' ? 'lbs' : 'kg'})`}
                    type="number"
                    step="0.1"
                    value={weightDisplay}
                    onChange={(e) => handleWeightOrBfChange(e.target.value, bodyFatPercent)}
                    placeholder={units === 'lb' ? 'e.g., 177.5' : 'e.g., 80.5'}
                    required
                  />
                  <Input
                    label="Body Fat %"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={bodyFatPercent}
                    onChange={(e) => handleWeightOrBfChange(weightDisplay, e.target.value)}
                    placeholder="e.g., 15.0"
                    required
                  />
                </div>

                {leanMassDisplay && fatMassDisplay && (
                  <div className="grid grid-cols-2 gap-4 p-4 bg-surface-800/50 rounded-lg">
                    <div>
                      <p className="text-xs text-surface-500">Calculated Lean Mass</p>
                      <p className="text-lg font-mono text-surface-200">{leanMassDisplay} {units === 'lb' ? 'lbs' : 'kg'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Calculated Fat Mass</p>
                      <p className="text-lg font-mono text-surface-200">{fatMassDisplay} {units === 'lb' ? 'lbs' : 'kg'}</p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-surface-500">
                  Enter all values directly from your DEXA scan report.
                </p>
                
                <Input
                  label={`Total Weight (${units === 'lb' ? 'lbs' : 'kg'})`}
                  type="number"
                  step="0.1"
                  value={weightDisplay}
                  onChange={(e) => setWeightDisplay(e.target.value)}
                  placeholder={units === 'lb' ? 'e.g., 177.5' : 'e.g., 80.5'}
                  required
                />

                <Input
                  label="Body Fat %"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={bodyFatPercent}
                  onChange={(e) => setBodyFatPercent(e.target.value)}
                  placeholder="e.g., 15.0"
                  required
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={`Lean Mass (${units === 'lb' ? 'lbs' : 'kg'})`}
                    type="number"
                    step="0.01"
                    value={leanMassDisplay}
                    onChange={(e) => setLeanMassDisplay(e.target.value)}
                    placeholder={units === 'lb' ? 'e.g., 144.40' : 'e.g., 65.50'}
                    required
                  />
                  <Input
                    label={`Fat Mass (${units === 'lb' ? 'lbs' : 'kg'})`}
                    type="number"
                    step="0.01"
                    value={fatMassDisplay}
                    onChange={(e) => setFatMassDisplay(e.target.value)}
                    placeholder={units === 'lb' ? 'e.g., 26.68' : 'e.g., 12.10'}
                    required
                  />
                </div>
              </>
            )}

            {/* Optional: Bone Mass */}
            <Input
              label={`Bone Mass (${units === 'lb' ? 'lbs' : 'kg'}) - Optional`}
              type="number"
              step="0.01"
              value={boneMassDisplay}
              onChange={(e) => setBoneMassDisplay(e.target.value)}
              placeholder={units === 'lb' ? 'e.g., 6.50' : 'e.g., 2.95'}
              hint="Bone mineral content if provided by your scan"
            />

            {/* Regional Data Section */}
            <div className="border border-surface-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowRegionalData(!showRegionalData)}
                className="w-full flex items-center justify-between p-4 bg-surface-800/50 hover:bg-surface-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-surface-200">Regional Body Composition</span>
                  <Badge variant="info" size="sm">Optional</Badge>
                </div>
                <svg 
                  className={`w-5 h-5 text-surface-400 transition-transform ${showRegionalData ? 'rotate-180' : ''}`}
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showRegionalData && (
                <div className="p-4 space-y-6 border-t border-surface-700">
                  <p className="text-xs text-surface-500">
                    Enter regional data from your DEXA report for better exercise recommendations. 
                    Values should be in <strong>grams (g)</strong>.
                  </p>
                  
                  {/* Input Mode Toggle */}
                  <div className="flex gap-2 p-1 bg-surface-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setRegionalInputMode('combined')}
                      className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-colors ${
                        regionalInputMode === 'combined'
                          ? 'bg-primary-500 text-white'
                          : 'text-surface-400 hover:text-surface-200'
                      }`}
                    >
                      Total Arms/Legs
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegionalInputMode('split')}
                      className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-colors ${
                        regionalInputMode === 'split'
                          ? 'bg-primary-500 text-white'
                          : 'text-surface-400 hover:text-surface-200'
                      }`}
                    >
                      Left/Right Split
                    </button>
                  </div>
                  <p className="text-xs text-surface-600">
                    {regionalInputMode === 'combined' 
                      ? 'Use this if your DEXA report shows total arms and total legs without left/right breakdown.'
                      : 'Use this if your DEXA report shows separate values for left and right limbs.'}
                  </p>
                  
                  {regionalInputMode === 'combined' ? (
                    <>
                      {/* Arms - Combined */}
                      <div>
                        <h4 className="text-sm font-medium text-surface-300 mb-3 flex items-center gap-2">
                          💪 Arms (Total)
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="Total Lean (g)"
                            type="number"
                            step="1"
                            value={regionalData.totalArmsLean}
                            onChange={(e) => setRegionalData({...regionalData, totalArmsLean: e.target.value})}
                            placeholder="e.g., 7000"
                          />
                          <Input
                            label="Total Fat (g)"
                            type="number"
                            step="1"
                            value={regionalData.totalArmsFat}
                            onChange={(e) => setRegionalData({...regionalData, totalArmsFat: e.target.value})}
                            placeholder="e.g., 2400"
                          />
                        </div>
                      </div>

                      {/* Legs - Combined */}
                      <div>
                        <h4 className="text-sm font-medium text-surface-300 mb-3 flex items-center gap-2">
                          🦵 Legs (Total)
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="Total Lean (g)"
                            type="number"
                            step="1"
                            value={regionalData.totalLegsLean}
                            onChange={(e) => setRegionalData({...regionalData, totalLegsLean: e.target.value})}
                            placeholder="e.g., 20000"
                          />
                          <Input
                            label="Total Fat (g)"
                            type="number"
                            step="1"
                            value={regionalData.totalLegsFat}
                            onChange={(e) => setRegionalData({...regionalData, totalLegsFat: e.target.value})}
                            placeholder="e.g., 8000"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Arms - Split */}
                      <div>
                        <h4 className="text-sm font-medium text-surface-300 mb-3 flex items-center gap-2">
                          💪 Arms
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <p className="text-xs text-surface-500 font-medium">Left Arm</p>
                            <Input
                              label="Lean (g)"
                              type="number"
                              step="1"
                              value={regionalData.leftArmLean}
                              onChange={(e) => setRegionalData({...regionalData, leftArmLean: e.target.value})}
                              placeholder="e.g., 3500"
                            />
                            <Input
                              label="Fat (g)"
                              type="number"
                              step="1"
                              value={regionalData.leftArmFat}
                              onChange={(e) => setRegionalData({...regionalData, leftArmFat: e.target.value})}
                              placeholder="e.g., 1200"
                            />
                          </div>
                          <div className="space-y-3">
                            <p className="text-xs text-surface-500 font-medium">Right Arm</p>
                            <Input
                              label="Lean (g)"
                              type="number"
                              step="1"
                              value={regionalData.rightArmLean}
                              onChange={(e) => setRegionalData({...regionalData, rightArmLean: e.target.value})}
                              placeholder="e.g., 3650"
                            />
                            <Input
                              label="Fat (g)"
                              type="number"
                              step="1"
                              value={regionalData.rightArmFat}
                              onChange={(e) => setRegionalData({...regionalData, rightArmFat: e.target.value})}
                              placeholder="e.g., 1150"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Legs - Split */}
                      <div>
                        <h4 className="text-sm font-medium text-surface-300 mb-3 flex items-center gap-2">
                          🦵 Legs
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <p className="text-xs text-surface-500 font-medium">Left Leg</p>
                            <Input
                              label="Lean (g)"
                              type="number"
                              step="1"
                              value={regionalData.leftLegLean}
                              onChange={(e) => setRegionalData({...regionalData, leftLegLean: e.target.value})}
                              placeholder="e.g., 9800"
                            />
                            <Input
                              label="Fat (g)"
                              type="number"
                              step="1"
                              value={regionalData.leftLegFat}
                              onChange={(e) => setRegionalData({...regionalData, leftLegFat: e.target.value})}
                              placeholder="e.g., 4200"
                            />
                          </div>
                          <div className="space-y-3">
                            <p className="text-xs text-surface-500 font-medium">Right Leg</p>
                            <Input
                              label="Lean (g)"
                              type="number"
                              step="1"
                              value={regionalData.rightLegLean}
                              onChange={(e) => setRegionalData({...regionalData, rightLegLean: e.target.value})}
                              placeholder="e.g., 10200"
                            />
                            <Input
                              label="Fat (g)"
                              type="number"
                              step="1"
                              value={regionalData.rightLegFat}
                              onChange={(e) => setRegionalData({...regionalData, rightLegFat: e.target.value})}
                              placeholder="e.g., 4100"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Trunk */}
                  <div>
                    <h4 className="text-sm font-medium text-surface-300 mb-3 flex items-center gap-2">
                      🫁 Trunk
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Lean (g)"
                        type="number"
                        step="1"
                        value={regionalData.trunkLean}
                        onChange={(e) => setRegionalData({...regionalData, trunkLean: e.target.value})}
                        placeholder="e.g., 28000"
                      />
                      <Input
                        label="Fat (g)"
                        type="number"
                        step="1"
                        value={regionalData.trunkFat}
                        onChange={(e) => setRegionalData({...regionalData, trunkFat: e.target.value})}
                        placeholder="e.g., 8500"
                      />
                    </div>
                  </div>

                  {/* Android/Gynoid */}
                  <div>
                    <h4 className="text-sm font-medium text-surface-300 mb-3 flex items-center gap-2">
                      📊 Android/Gynoid Fat Regions
                    </h4>
                    <p className="text-xs text-surface-500 mb-3">
                      These measurements help assess metabolic health risk. Lower android/gynoid ratio is generally better.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Android Fat (g)"
                        type="number"
                        step="1"
                        value={regionalData.androidFat}
                        onChange={(e) => setRegionalData({...regionalData, androidFat: e.target.value})}
                        placeholder="e.g., 2800"
                        hint="Abdominal region"
                      />
                      <Input
                        label="Gynoid Fat (g)"
                        type="number"
                        step="1"
                        value={regionalData.gynoidFat}
                        onChange={(e) => setRegionalData({...regionalData, gynoidFat: e.target.value})}
                        placeholder="e.g., 3200"
                        hint="Hip/thigh region"
                      />
                    </div>
                  </div>

                  {/* Regional Data Status */}
                  {(() => {
                    const result = buildRegionalData();
                    const hasAnyData = Object.values(regionalData).some(v => v !== '');
                    if (!hasAnyData) return null;
                    
                    if (result.error) {
                      return (
                        <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                          <p className="text-sm text-warning-400 font-medium">⚠️ Regional data incomplete</p>
                          <p className="text-xs text-warning-300 mt-1">{result.error}</p>
                        </div>
                      );
                    }
                    
                    return (
                      <div className="p-3 bg-success-500/10 border border-success-500/20 rounded-lg">
                        <p className="text-sm text-success-400 font-medium">✓ Regional data ready to save</p>
                        <p className="text-xs text-success-300 mt-1">All required lean mass fields are filled.</p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this scan..."
                rows={3}
                className="w-full px-4 py-2.5 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Progress Photo Upload */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1.5">
                Progress Photo (Optional)
              </label>
              <p className="text-xs text-surface-500 mb-3">
                Upload a photo to track visual progress alongside your body composition metrics
              </p>

              {!photoPreview ? (
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelect}
                    className="hidden"
                    id="progress-photo-input"
                  />
                  <label
                    htmlFor="progress-photo-input"
                    className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-surface-700 rounded-lg cursor-pointer hover:border-primary-500 hover:bg-surface-800/50 transition-colors"
                  >
                    <svg className="w-12 h-12 text-surface-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm text-surface-400">Click to upload a progress photo</p>
                    <p className="text-xs text-surface-600 mt-1">PNG, JPG up to 10MB</p>
                  </label>
                </div>
              ) : (
                <div className="relative">
                  <img
                    src={photoPreview}
                    alt="Progress photo preview"
                    className="w-full h-64 object-cover rounded-lg border border-surface-700"
                  />
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="absolute top-2 right-2 p-2 bg-danger-500 text-white rounded-full hover:bg-danger-600 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={isSubmitting || isUploadingPhoto}
                className="flex-1"
              >
                {isUploadingPhoto ? 'Uploading Photo...' : isSubmitting ? 'Saving...' : 'Save Scan'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">About DEXA Scans</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-surface-400">
            DEXA (Dual-Energy X-ray Absorptiometry) is considered the gold standard for body composition 
            measurement. For best tracking, try to get scans under similar conditions (same time of day, 
            hydration status, etc.).
          </p>
          <p className="text-sm text-surface-500 mt-3">
            <strong>Tip:</strong> Getting scans every 8-12 weeks provides enough time to see meaningful 
            changes while not being too frequent.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

