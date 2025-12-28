'use client';

import { useState, useEffect, useRef } from 'react';
import { Button, Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';

interface Measurements {
  neck?: number;
  shoulders?: number;
  chest?: number;
  left_bicep?: number;
  right_bicep?: number;
  left_forearm?: number;
  right_forearm?: number;
  waist?: number;
  hips?: number;
  left_thigh?: number;
  right_thigh?: number;
  left_calf?: number;
  right_calf?: number;
}

interface MeasurementHistory {
  logged_at: string;
  measurements: Measurements;
}

interface BodyMeasurementsProps {
  userId: string;
  unit?: 'in' | 'cm';
}

const MEASUREMENT_FIELDS: { key: keyof Measurements; label: string; group: string; instructions: string }[] = [
  { key: 'neck', label: 'Neck', group: 'Upper Body', instructions: 'Measure around the middle of your neck, just below the Adam\'s apple. Keep the tape level and snug but not tight.' },
  { key: 'shoulders', label: 'Shoulders', group: 'Upper Body', instructions: 'Measure around your shoulders at the widest point, typically across the deltoids. Keep your arms relaxed at your sides.' },
  { key: 'chest', label: 'Chest', group: 'Upper Body', instructions: 'Measure around the fullest part of your chest, usually at nipple level. Keep the tape level and breathe normally.' },
  { key: 'left_bicep', label: 'Left Bicep', group: 'Arms', instructions: 'Measure around the largest part of your flexed bicep. Keep your arm at a 90-degree angle with fist clenched.' },
  { key: 'right_bicep', label: 'Right Bicep', group: 'Arms', instructions: 'Measure around the largest part of your flexed bicep. Keep your arm at a 90-degree angle with fist clenched.' },
  { key: 'left_forearm', label: 'Left Forearm', group: 'Arms', instructions: 'Measure around the thickest part of your forearm, usually about 1 inch below the elbow. Keep your arm straight.' },
  { key: 'right_forearm', label: 'Right Forearm', group: 'Arms', instructions: 'Measure around the thickest part of your forearm, usually about 1 inch below the elbow. Keep your arm straight.' },
  { key: 'waist', label: 'Waist', group: 'Core', instructions: 'Measure around your natural waistline, typically at the narrowest point above your belly button. Keep the tape snug but not compressing.' },
  { key: 'hips', label: 'Hips', group: 'Core', instructions: 'Measure around the widest part of your hips and buttocks. Keep your feet together and the tape level.' },
  { key: 'left_thigh', label: 'Left Thigh', group: 'Legs', instructions: 'Measure around the largest part of your thigh, usually just below the groin. Stand with weight evenly distributed.' },
  { key: 'right_thigh', label: 'Right Thigh', group: 'Legs', instructions: 'Measure around the largest part of your thigh, usually just below the groin. Stand with weight evenly distributed.' },
  { key: 'left_calf', label: 'Left Calf', group: 'Legs', instructions: 'Measure around the largest part of your calf muscle. Stand with weight evenly distributed on both feet.' },
  { key: 'right_calf', label: 'Right Calf', group: 'Legs', instructions: 'Measure around the largest part of your calf muscle. Stand with weight evenly distributed on both feet.' },
];

// Info icon component with tooltip
function InfoIcon({ instructions }: { instructions: string }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'center' | 'left' | 'right'>('center');
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (!showTooltip && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const tooltipWidth = 192; // w-48 = 12rem = 192px
      const viewportWidth = window.innerWidth;

      // Check if tooltip would overflow on the left
      if (rect.left < tooltipWidth / 2) {
        setTooltipPosition('left');
      }
      // Check if tooltip would overflow on the right
      else if (viewportWidth - rect.right < tooltipWidth / 2) {
        setTooltipPosition('right');
      }
      else {
        setTooltipPosition('center');
      }
    }
    setShowTooltip(!showTooltip);
  };

  const getTooltipClasses = () => {
    const base = 'absolute z-50 bottom-full mb-2 w-48 p-2 bg-surface-800 border border-surface-600 rounded-lg shadow-lg';
    switch (tooltipPosition) {
      case 'left':
        return `${base} left-0`;
      case 'right':
        return `${base} right-0`;
      default:
        return `${base} left-1/2 -translate-x-1/2`;
    }
  };

  const getArrowClasses = () => {
    const base = 'absolute top-full -mt-px';
    switch (tooltipPosition) {
      case 'left':
        return `${base} left-2`;
      case 'right':
        return `${base} right-2`;
      default:
        return `${base} left-1/2 -translate-x-1/2`;
    }
  };

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onBlur={() => setTimeout(() => setShowTooltip(false), 150)}
        className="w-4 h-4 rounded-full bg-surface-700 hover:bg-surface-600 text-surface-400 hover:text-surface-200 text-[10px] font-medium flex items-center justify-center transition-colors"
        aria-label="Measurement instructions"
      >
        i
      </button>
      {showTooltip && (
        <div className={getTooltipClasses()}>
          <p className="text-xs text-surface-200 leading-relaxed">{instructions}</p>
          <div className={getArrowClasses()}>
            <div className="border-4 border-transparent border-t-surface-600"></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Convert cm to inches
const cmToIn = (cm: number) => Math.round(cm / 2.54 * 10) / 10;
// Convert inches to cm
const inToCm = (inches: number) => Math.round(inches * 2.54 * 10) / 10;

export function BodyMeasurements({ userId, unit = 'in' }: BodyMeasurementsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [measurements, setMeasurements] = useState<Measurements>({});
  const [history, setHistory] = useState<MeasurementHistory[]>([]);
  const [lastMeasurement, setLastMeasurement] = useState<MeasurementHistory | null>(null);
  const [displayUnit, setDisplayUnit] = useState<'in' | 'cm'>(unit);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const loadMeasurements = async () => {
      const supabase = createUntypedClient();
      const today = new Date().toISOString().split('T')[0];

      // Get today's measurements
      const { data: todayData } = await supabase
        .from('body_measurements')
        .select('*')
        .eq('user_id', userId)
        .eq('logged_at', today)
        .single();

      if (todayData) {
        setMeasurements({
          neck: todayData.neck,
          shoulders: todayData.shoulders,
          chest: todayData.chest,
          left_bicep: todayData.left_bicep,
          right_bicep: todayData.right_bicep,
          left_forearm: todayData.left_forearm,
          right_forearm: todayData.right_forearm,
          waist: todayData.waist,
          hips: todayData.hips,
          left_thigh: todayData.left_thigh,
          right_thigh: todayData.right_thigh,
          left_calf: todayData.left_calf,
          right_calf: todayData.right_calf,
        });
      }

      // Get last 5 measurement entries
      const { data: historyData } = await supabase
        .from('body_measurements')
        .select('*')
        .eq('user_id', userId)
        .order('logged_at', { ascending: false })
        .limit(5);

      if (historyData && historyData.length > 0) {
        const formattedHistory = historyData.map((entry: Record<string, unknown>) => ({
          logged_at: entry.logged_at as string,
          measurements: {
            neck: entry.neck as number | undefined,
            shoulders: entry.shoulders as number | undefined,
            chest: entry.chest as number | undefined,
            left_bicep: entry.left_bicep as number | undefined,
            right_bicep: entry.right_bicep as number | undefined,
            left_forearm: entry.left_forearm as number | undefined,
            right_forearm: entry.right_forearm as number | undefined,
            waist: entry.waist as number | undefined,
            hips: entry.hips as number | undefined,
            left_thigh: entry.left_thigh as number | undefined,
            right_thigh: entry.right_thigh as number | undefined,
            left_calf: entry.left_calf as number | undefined,
            right_calf: entry.right_calf as number | undefined,
          } as Measurements,
        }));
        setHistory(formattedHistory);
        
        // Set last measurement for comparison (skip today if it exists)
        const previousEntry = formattedHistory.find((h: MeasurementHistory) => h.logged_at !== today);
        if (previousEntry) {
          setLastMeasurement(previousEntry);
        }
      }
    };

    loadMeasurements();
  }, [userId, refreshKey]);

  const handleSave = async () => {
    setIsSaving(true);
    const supabase = createUntypedClient();
    const today = new Date().toISOString().split('T')[0];

    // Convert to cm for storage if using inches
    const storedMeasurements: Measurements = {};
    Object.entries(measurements).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        storedMeasurements[key as keyof Measurements] = displayUnit === 'in' ? inToCm(value) : value;
      }
    });

    const { error } = await supabase
      .from('body_measurements')
      .upsert({
        user_id: userId,
        logged_at: today,
        ...storedMeasurements,
      }, {
        onConflict: 'user_id,logged_at',
      });

    if (!error) {
      setRefreshKey(k => k + 1); // Trigger reload
      setIsEditing(false);
    }
    setIsSaving(false);
  };

  const getDisplayValue = (value: number | undefined | null): string => {
    if (value === undefined || value === null) return '-';
    const displayVal = displayUnit === 'in' ? cmToIn(value) : value;
    return displayVal.toFixed(1);
  };

  const getChange = (key: keyof Measurements): { value: number; isPositive: boolean } | null => {
    if (!lastMeasurement) return null;
    const current = measurements[key];
    const previous = lastMeasurement.measurements[key];
    if (current === undefined || previous === undefined) return null;
    
    const diff = current - previous;
    if (Math.abs(diff) < 0.1) return null;
    
    // For waist, decrease is positive (good)
    // For arms/chest/etc, increase is positive (good for muscle building)
    const isWaist = key === 'waist';
    return {
      value: displayUnit === 'in' ? cmToIn(Math.abs(diff)) : Math.abs(diff),
      isPositive: isWaist ? diff < 0 : diff > 0,
    };
  };

  const groupedFields = MEASUREMENT_FIELDS.reduce((acc, field) => {
    if (!acc[field.group]) acc[field.group] = [];
    acc[field.group].push(field);
    return acc;
  }, {} as Record<string, typeof MEASUREMENT_FIELDS>);

  const hasMeasurements = Object.values(measurements).some(v => v !== undefined && v !== null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>📏</span> Body Measurements
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Unit toggle */}
            <div className="flex bg-surface-800 rounded-lg p-0.5">
              <button
                onClick={() => setDisplayUnit('in')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  displayUnit === 'in' ? 'bg-primary-500 text-white' : 'text-surface-400'
                }`}
              >
                in
              </button>
              <button
                onClick={() => setDisplayUnit('cm')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  displayUnit === 'cm' ? 'bg-primary-500 text-white' : 'text-surface-400'
                }`}
              >
                cm
              </button>
            </div>
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                {hasMeasurements ? 'Update' : 'Log'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <div className="space-y-4">
            {Object.entries(groupedFields).map(([group, fields]) => (
              <div key={group}>
                <h4 className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">{group}</h4>
                <div className="grid grid-cols-2 gap-2">
                  {fields.map(field => (
                    <div key={field.key} className="flex items-center gap-2">
                      <label className="text-xs text-surface-400 w-24 flex-shrink-0 flex items-center gap-1">
                        {field.label}
                        <InfoIcon instructions={field.instructions} />
                      </label>
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="number"
                          step="0.1"
                          value={measurements[field.key] !== undefined ? 
                            (displayUnit === 'in' ? cmToIn(measurements[field.key]!) : measurements[field.key]) : ''}
                          onChange={(e) => {
                            const val = e.target.value ? parseFloat(e.target.value) : undefined;
                            const storedVal = val !== undefined ? (displayUnit === 'in' ? inToCm(val) : val) : undefined;
                            setMeasurements(prev => ({ ...prev, [field.key]: storedVal }));
                          }}
                          placeholder="-"
                          className="w-16 px-2 py-1 text-sm bg-surface-900 border border-surface-700 rounded text-surface-100 text-center"
                        />
                        <span className="text-xs text-surface-500">{displayUnit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} isLoading={isSaving} className="flex-1">
                Save Measurements
              </Button>
              <Button variant="secondary" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : hasMeasurements ? (
          <div className="space-y-3">
            {Object.entries(groupedFields).map(([group, fields]) => {
              const hasGroupData = fields.some(f => measurements[f.key] !== undefined);
              if (!hasGroupData) return null;
              
              return (
                <div key={group}>
                  <h4 className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-1.5">{group}</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {fields.map(field => {
                      const value = measurements[field.key];
                      if (value === undefined) return null;
                      const change = getChange(field.key);
                      
                      return (
                        <div key={field.key} className="flex items-center justify-between py-0.5">
                          <span className="text-xs text-surface-400 flex items-center gap-1">
                            {field.label}
                            <InfoIcon instructions={field.instructions} />
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-medium text-surface-200">
                              {getDisplayValue(value)} {displayUnit}
                            </span>
                            {change && (
                              <span className={`text-[10px] ${change.isPositive ? 'text-success-400' : 'text-danger-400'}`}>
                                {change.isPositive ? '↑' : '↓'}{change.value.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            
            {lastMeasurement && (
              <p className="text-[10px] text-surface-600 pt-1">
                Compared to {new Date(lastMeasurement.logged_at).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-surface-400 text-sm mb-2">No measurements logged yet</p>
            <p className="text-xs text-surface-500 mb-3">Track your progress by logging body measurements</p>
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              Log First Measurement
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

