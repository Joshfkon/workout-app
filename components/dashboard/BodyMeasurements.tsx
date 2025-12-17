'use client';

import { useState, useEffect } from 'react';
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

const MEASUREMENT_FIELDS: { key: keyof Measurements; label: string; group: string }[] = [
  { key: 'neck', label: 'Neck', group: 'Upper Body' },
  { key: 'shoulders', label: 'Shoulders', group: 'Upper Body' },
  { key: 'chest', label: 'Chest', group: 'Upper Body' },
  { key: 'left_bicep', label: 'Left Bicep', group: 'Arms' },
  { key: 'right_bicep', label: 'Right Bicep', group: 'Arms' },
  { key: 'left_forearm', label: 'Left Forearm', group: 'Arms' },
  { key: 'right_forearm', label: 'Right Forearm', group: 'Arms' },
  { key: 'waist', label: 'Waist', group: 'Core' },
  { key: 'hips', label: 'Hips', group: 'Core' },
  { key: 'left_thigh', label: 'Left Thigh', group: 'Legs' },
  { key: 'right_thigh', label: 'Right Thigh', group: 'Legs' },
  { key: 'left_calf', label: 'Left Calf', group: 'Legs' },
  { key: 'right_calf', label: 'Right Calf', group: 'Legs' },
];

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, user_id, logged_at, notes, created_at, updated_at, ...measurementData } = todayData;
        setMeasurements(measurementData);
      }

      // Get last 5 measurement entries
      const { data: historyData } = await supabase
        .from('body_measurements')
        .select('*')
        .eq('user_id', userId)
        .order('logged_at', { ascending: false })
        .limit(5);

      if (historyData && historyData.length > 0) {
        const formattedHistory = historyData.map((entry: Record<string, unknown>) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, user_id, logged_at, notes, created_at, updated_at, ...measurementData } = entry;
          return { logged_at: logged_at as string, measurements: measurementData as Measurements };
        });
        setHistory(formattedHistory);
        
        // Set last measurement for comparison (skip today if it exists)
        const previousEntry = formattedHistory.find(h => h.logged_at !== today);
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
                      <label className="text-xs text-surface-400 w-24 flex-shrink-0">{field.label}</label>
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
                          <span className="text-xs text-surface-400">{field.label}</span>
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

