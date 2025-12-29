'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button, Card, CardHeader, CardTitle, CardContent, Badge, Input, Modal } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import type { BodyCompositionTarget, MeasurementTargets, TargetProgress, Mesocycle } from '@/types/schema';
import { formatWeight, cmToIn, inToCm } from '@/lib/utils';

interface BodyTargetsProps {
  userId: string;
  unit?: 'in' | 'cm';
  weightUnit?: 'kg' | 'lb';
  currentWeightKg?: number;
  currentBodyFatPercent?: number;
  currentFfmi?: number;
  currentMeasurements?: MeasurementTargets;
}

interface TargetFormData {
  name: string;
  targetWeightKg?: number;
  targetBodyFatPercent?: number;
  targetFfmi?: number;
  targetDate?: string;
  mesocycleId?: string;
  notes?: string;
  measurements: MeasurementTargets;
}

const MEASUREMENT_LABELS: { key: keyof MeasurementTargets; label: string; group: string }[] = [
  { key: 'neck', label: 'Neck', group: 'Upper Body' },
  { key: 'shoulders', label: 'Shoulders', group: 'Upper Body' },
  { key: 'chest', label: 'Chest', group: 'Upper Body' },
  { key: 'upper_back', label: 'Upper Back', group: 'Back' },
  { key: 'lower_back', label: 'Lower Back', group: 'Back' },
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

function calculateProgress(current: number, target: number, isLess: boolean = false): number {
  if (isLess) {
    // For measurements where less is better (waist, body fat)
    const totalChange = current - target;
    if (totalChange <= 0) return 100; // Already at or below target
    const achieved = Math.max(0, current - current); // This needs baseline
    return 0; // Simplified - would need baseline
  }
  // For measurements where more is better
  if (target <= current) return 100;
  return Math.round((current / target) * 100);
}

export function BodyTargets({
  userId,
  unit = 'in',
  weightUnit = 'lb',
  currentWeightKg,
  currentBodyFatPercent,
  currentFfmi,
  currentMeasurements,
}: BodyTargetsProps) {
  const [activeTarget, setActiveTarget] = useState<BodyCompositionTarget | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mesocycles, setMesocycles] = useState<Mesocycle[]>([]);
  const [displayUnit, setDisplayUnit] = useState<'in' | 'cm'>(unit);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [formData, setFormData] = useState<TargetFormData>({
    name: '',
    measurements: {},
  });

  // Load active target and mesocycles
  useEffect(() => {
    const loadData = async () => {
      const supabase = createUntypedClient();

      // Load active target
      const { data: targetData } = await supabase
        .from('body_composition_targets')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (targetData) {
        setActiveTarget({
          id: targetData.id,
          userId: targetData.user_id,
          targetWeightKg: targetData.target_weight_kg,
          targetBodyFatPercent: targetData.target_body_fat_percent,
          targetFfmi: targetData.target_ffmi,
          measurementTargets: {
            neck: targetData.target_neck,
            shoulders: targetData.target_shoulders,
            chest: targetData.target_chest,
            upper_back: targetData.target_upper_back,
            lower_back: targetData.target_lower_back,
            left_bicep: targetData.target_left_bicep,
            right_bicep: targetData.target_right_bicep,
            left_forearm: targetData.target_left_forearm,
            right_forearm: targetData.target_right_forearm,
            waist: targetData.target_waist,
            hips: targetData.target_hips,
            left_thigh: targetData.target_left_thigh,
            right_thigh: targetData.target_right_thigh,
            left_calf: targetData.target_left_calf,
            right_calf: targetData.target_right_calf,
          },
          mesocycleId: targetData.mesocycle_id,
          targetDate: targetData.target_date,
          name: targetData.name,
          notes: targetData.notes,
          isActive: targetData.is_active,
          createdAt: targetData.created_at,
          updatedAt: targetData.updated_at,
        });
      }

      // Load active mesocycles for linking
      const { data: mesoData } = await supabase
        .from('mesocycles')
        .select('*')
        .eq('user_id', userId)
        .in('state', ['planned', 'active'])
        .order('created_at', { ascending: false });

      if (mesoData) {
        setMesocycles(mesoData.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          userId: m.user_id as string,
          name: m.name as string,
          state: m.state as 'planned' | 'active' | 'completed',
          totalWeeks: m.total_weeks as number,
          currentWeek: m.current_week as number,
          deloadWeek: m.deload_week as number,
          daysPerWeek: m.days_per_week as number,
          splitType: m.split_type as string,
          fatigueScore: m.fatigue_score as number,
          createdAt: m.created_at as string,
          startedAt: m.started_at as string | null,
          completedAt: m.completed_at as string | null,
        })));
      }
    };

    loadData();
  }, [userId]);

  // Calculate progress
  const progress = useMemo((): TargetProgress | null => {
    if (!activeTarget) return null;

    const result: TargetProgress = {
      measurements: {},
      overallProgress: 0,
    };

    let progressItems = 0;
    let totalProgress = 0;

    // Weight progress
    if (activeTarget.targetWeightKg && currentWeightKg) {
      const prog = calculateProgress(currentWeightKg, activeTarget.targetWeightKg);
      result.weight = {
        current: currentWeightKg,
        target: activeTarget.targetWeightKg,
        progress: prog,
        remaining: activeTarget.targetWeightKg - currentWeightKg,
      };
      totalProgress += prog;
      progressItems++;
    }

    // Body fat progress (less is better)
    if (activeTarget.targetBodyFatPercent && currentBodyFatPercent) {
      // For body fat, we want to go DOWN
      const starting = currentBodyFatPercent; // Would need historical baseline
      const target = activeTarget.targetBodyFatPercent;
      const prog = currentBodyFatPercent <= target ? 100 : 0;
      result.bodyFat = {
        current: currentBodyFatPercent,
        target: target,
        progress: prog,
        remaining: currentBodyFatPercent - target,
      };
      totalProgress += prog;
      progressItems++;
    }

    // FFMI progress
    if (activeTarget.targetFfmi && currentFfmi) {
      const prog = calculateProgress(currentFfmi, activeTarget.targetFfmi);
      result.ffmi = {
        current: currentFfmi,
        target: activeTarget.targetFfmi,
        progress: prog,
        remaining: activeTarget.targetFfmi - currentFfmi,
      };
      totalProgress += prog;
      progressItems++;
    }

    // Measurement progress
    if (currentMeasurements) {
      for (const [key, target] of Object.entries(activeTarget.measurementTargets)) {
        const current = currentMeasurements[key as keyof MeasurementTargets];
        if (target && current) {
          const isLess = key === 'waist'; // Waist is typically a "less is better" target
          const prog = isLess
            ? (current <= target ? 100 : Math.round((target / current) * 100))
            : calculateProgress(current, target);
          result.measurements[key] = {
            current,
            target,
            progress: prog,
            remaining: target - current,
          };
          totalProgress += prog;
          progressItems++;
        }
      }
    }

    // Calculate days remaining
    if (activeTarget.targetDate) {
      const targetDate = new Date(activeTarget.targetDate);
      const today = new Date();
      const diffTime = targetDate.getTime() - today.getTime();
      result.daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    result.overallProgress = progressItems > 0 ? Math.round(totalProgress / progressItems) : 0;

    return result;
  }, [activeTarget, currentWeightKg, currentBodyFatPercent, currentFfmi, currentMeasurements]);

  const handleSave = async () => {
    setIsSaving(true);
    const supabase = createUntypedClient();

    const targetData = {
      user_id: userId,
      name: formData.name || null,
      target_weight_kg: formData.targetWeightKg || null,
      target_body_fat_percent: formData.targetBodyFatPercent || null,
      target_ffmi: formData.targetFfmi || null,
      target_date: formData.targetDate || null,
      mesocycle_id: formData.mesocycleId || null,
      notes: formData.notes || null,
      is_active: true,
      target_neck: formData.measurements.neck || null,
      target_shoulders: formData.measurements.shoulders || null,
      target_chest: formData.measurements.chest || null,
      target_upper_back: formData.measurements.upper_back || null,
      target_lower_back: formData.measurements.lower_back || null,
      target_left_bicep: formData.measurements.left_bicep || null,
      target_right_bicep: formData.measurements.right_bicep || null,
      target_left_forearm: formData.measurements.left_forearm || null,
      target_right_forearm: formData.measurements.right_forearm || null,
      target_waist: formData.measurements.waist || null,
      target_hips: formData.measurements.hips || null,
      target_left_thigh: formData.measurements.left_thigh || null,
      target_right_thigh: formData.measurements.right_thigh || null,
      target_left_calf: formData.measurements.left_calf || null,
      target_right_calf: formData.measurements.right_calf || null,
    };

    if (activeTarget) {
      // Update existing
      await supabase
        .from('body_composition_targets')
        .update(targetData)
        .eq('id', activeTarget.id);
    } else {
      // Insert new
      await supabase
        .from('body_composition_targets')
        .insert(targetData);
    }

    // Reload
    window.location.reload();
  };

  const startEditing = () => {
    if (activeTarget) {
      setFormData({
        name: activeTarget.name || '',
        targetWeightKg: activeTarget.targetWeightKg,
        targetBodyFatPercent: activeTarget.targetBodyFatPercent,
        targetFfmi: activeTarget.targetFfmi,
        targetDate: activeTarget.targetDate,
        mesocycleId: activeTarget.mesocycleId,
        notes: activeTarget.notes,
        measurements: activeTarget.measurementTargets,
      });
    } else {
      setFormData({
        name: '',
        measurements: {},
      });
    }
    setIsEditing(true);
  };

  const getProgressColor = (progress: number): string => {
    if (progress >= 100) return 'text-success-400';
    if (progress >= 75) return 'text-success-300';
    if (progress >= 50) return 'text-warning-400';
    return 'text-danger-400';
  };

  const getProgressBadge = (progress: number): 'success' | 'warning' | 'danger' => {
    if (progress >= 100) return 'success';
    if (progress >= 50) return 'warning';
    return 'danger';
  };

  const groupedMeasurements = MEASUREMENT_LABELS.reduce((acc, m) => {
    if (!acc[m.group]) acc[m.group] = [];
    acc[m.group].push(m);
    return acc;
  }, {} as Record<string, typeof MEASUREMENT_LABELS>);

  const formatMeasurementValue = (valueCm: number): string => {
    return displayUnit === 'in'
      ? cmToIn(valueCm).toFixed(1)
      : valueCm.toFixed(1);
  };

  const parseMeasurementInput = (value: string): number | undefined => {
    const num = parseFloat(value);
    if (isNaN(num)) return undefined;
    return displayUnit === 'in' ? inToCm(num) : num;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>🎯</span> Body Composition Goals
          </CardTitle>
          <div className="flex items-center gap-2">
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
            <Button variant="outline" size="sm" onClick={startEditing}>
              {activeTarget ? 'Edit' : 'Set Goals'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {activeTarget && progress ? (
          <div className="space-y-4">
            {/* Header with name and overall progress */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-surface-200">
                  {activeTarget.name || 'Current Goals'}
                </h3>
                {progress.daysRemaining !== undefined && (
                  <p className="text-xs text-surface-500">
                    {progress.daysRemaining > 0
                      ? `${progress.daysRemaining} days remaining`
                      : progress.daysRemaining === 0
                      ? 'Target date is today!'
                      : `${Math.abs(progress.daysRemaining)} days past target`
                    }
                  </p>
                )}
              </div>
              <Badge variant={getProgressBadge(progress.overallProgress)} size="md">
                {progress.overallProgress}% Complete
              </Badge>
            </div>

            {/* Main targets */}
            <div className="grid grid-cols-3 gap-3">
              {progress.weight && (
                <div className="p-3 bg-surface-800/50 rounded-lg">
                  <p className="text-xs text-surface-500 mb-1">Weight</p>
                  <p className={`text-lg font-medium ${getProgressColor(progress.weight.progress)}`}>
                    {formatWeight(progress.weight.current, weightUnit)}
                  </p>
                  <p className="text-xs text-surface-400">
                    → {formatWeight(progress.weight.target, weightUnit)}
                  </p>
                  <div className="mt-1 h-1 bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all"
                      style={{ width: `${Math.min(100, progress.weight.progress)}%` }}
                    />
                  </div>
                </div>
              )}

              {progress.bodyFat && (
                <div className="p-3 bg-surface-800/50 rounded-lg">
                  <p className="text-xs text-surface-500 mb-1">Body Fat</p>
                  <p className={`text-lg font-medium ${getProgressColor(progress.bodyFat.progress)}`}>
                    {progress.bodyFat.current.toFixed(1)}%
                  </p>
                  <p className="text-xs text-surface-400">
                    → {progress.bodyFat.target.toFixed(1)}%
                  </p>
                  <div className="mt-1 h-1 bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all"
                      style={{ width: `${Math.min(100, progress.bodyFat.progress)}%` }}
                    />
                  </div>
                </div>
              )}

              {progress.ffmi && (
                <div className="p-3 bg-surface-800/50 rounded-lg">
                  <p className="text-xs text-surface-500 mb-1">FFMI</p>
                  <p className={`text-lg font-medium ${getProgressColor(progress.ffmi.progress)}`}>
                    {progress.ffmi.current.toFixed(1)}
                  </p>
                  <p className="text-xs text-surface-400">
                    → {progress.ffmi.target.toFixed(1)}
                  </p>
                  <div className="mt-1 h-1 bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all"
                      style={{ width: `${Math.min(100, progress.ffmi.progress)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Measurement targets */}
            {Object.keys(progress.measurements).length > 0 && (
              <div className="pt-2 border-t border-surface-800">
                <button
                  onClick={() => setShowMeasurements(!showMeasurements)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <span className="text-sm font-medium text-surface-300">Measurement Goals</span>
                  <span className="text-surface-500 text-xs">{showMeasurements ? '▲' : '▼'}</span>
                </button>

                {showMeasurements && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {Object.entries(progress.measurements).map(([key, m]) => {
                      const label = MEASUREMENT_LABELS.find(l => l.key === key)?.label || key;
                      return (
                        <div key={key} className="flex items-center justify-between py-1">
                          <span className="text-xs text-surface-400">{label}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${getProgressColor(m.progress)}`}>
                              {formatMeasurementValue(m.current)}
                            </span>
                            <span className="text-xs text-surface-500">→</span>
                            <span className="text-xs text-surface-400">
                              {formatMeasurementValue(m.target)} {displayUnit}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Linked mesocycle */}
            {activeTarget.mesocycleId && (
              <div className="pt-2 border-t border-surface-800">
                <p className="text-xs text-surface-500">
                  Linked to mesocycle: {mesocycles.find(m => m.id === activeTarget.mesocycleId)?.name || 'Unknown'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-surface-400 text-sm mb-2">No goals set yet</p>
            <p className="text-xs text-surface-500 mb-3">
              Set target weight, body fat, FFMI, or measurements to track progress
            </p>
            <Button variant="outline" size="sm" onClick={startEditing}>
              Set Goals
            </Button>
          </div>
        )}
      </CardContent>

      {/* Edit Modal */}
      <Modal isOpen={isEditing} onClose={() => setIsEditing(false)} title="Set Body Composition Goals">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Goal name */}
          <div>
            <label className="block text-sm text-surface-300 mb-1">Goal Name (optional)</label>
            <Input
              placeholder="e.g., Summer Cut, Bulk Phase 1"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          {/* Main targets */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-surface-300 mb-1">Target Weight ({weightUnit})</label>
              <Input
                type="number"
                step="0.1"
                placeholder="-"
                value={formData.targetWeightKg ? formatWeight(formData.targetWeightKg, weightUnit) : ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setFormData({
                    ...formData,
                    targetWeightKg: isNaN(val) ? undefined : (weightUnit === 'lb' ? val * 0.453592 : val),
                  });
                }}
              />
            </div>
            <div>
              <label className="block text-sm text-surface-300 mb-1">Target Body Fat %</label>
              <Input
                type="number"
                step="0.1"
                placeholder="-"
                value={formData.targetBodyFatPercent || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  targetBodyFatPercent: parseFloat(e.target.value) || undefined,
                })}
              />
            </div>
            <div>
              <label className="block text-sm text-surface-300 mb-1">Target FFMI</label>
              <Input
                type="number"
                step="0.1"
                placeholder="-"
                value={formData.targetFfmi || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  targetFfmi: parseFloat(e.target.value) || undefined,
                })}
              />
            </div>
          </div>

          {/* Target date */}
          <div>
            <label className="block text-sm text-surface-300 mb-1">Target Date (optional)</label>
            <Input
              type="date"
              value={formData.targetDate || ''}
              onChange={(e) => setFormData({ ...formData, targetDate: e.target.value || undefined })}
            />
          </div>

          {/* Link to mesocycle */}
          {mesocycles.length > 0 && (
            <div>
              <label className="block text-sm text-surface-300 mb-1">Link to Mesocycle (optional)</label>
              <select
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100"
                value={formData.mesocycleId || ''}
                onChange={(e) => setFormData({ ...formData, mesocycleId: e.target.value || undefined })}
              >
                <option value="">None</option>
                {mesocycles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.state})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Measurement targets */}
          <div className="pt-2 border-t border-surface-800">
            <h4 className="text-sm font-medium text-surface-300 mb-3">Measurement Targets ({displayUnit})</h4>
            {Object.entries(groupedMeasurements).map(([group, fields]) => (
              <div key={group} className="mb-4">
                <p className="text-xs text-surface-500 uppercase tracking-wide mb-2">{group}</p>
                <div className="grid grid-cols-2 gap-2">
                  {fields.map((field) => (
                    <div key={field.key} className="flex items-center gap-2">
                      <label className="text-xs text-surface-400 w-24 flex-shrink-0">{field.label}</label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="-"
                        className="w-20"
                        value={formData.measurements[field.key]
                          ? formatMeasurementValue(formData.measurements[field.key]!)
                          : ''
                        }
                        onChange={(e) => {
                          const val = parseMeasurementInput(e.target.value);
                          setFormData({
                            ...formData,
                            measurements: { ...formData.measurements, [field.key]: val },
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-surface-300 mb-1">Notes (optional)</label>
            <textarea
              className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm"
              rows={2}
              placeholder="Any notes about this goal..."
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} isLoading={isSaving} className="flex-1">
              Save Goals
            </Button>
            <Button variant="secondary" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
