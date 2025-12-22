'use client';

import { useState, useCallback, useEffect } from 'react';
import type {
  BodyweightData,
  BodyweightModification,
  WeightUnit,
  BandAssistance,
} from '@/types/schema';
import {
  BAND_ASSISTANCE_PRESETS,
  calculateEffectiveLoad,
  getBandAssistanceKg,
} from '@/types/schema';
import { formatWeightValue, inputWeightToKg, convertWeight } from '@/lib/utils';

interface BodyweightInputProps {
  /** User's current body weight in kg */
  userBodyweightKg: number;
  /** Whether weight can be added (e.g., weighted pull-ups) */
  canAddWeight?: boolean;
  /** Whether assistance can be used (e.g., assisted pull-ups) */
  canUseAssistance?: boolean;
  /** Whether this is a pure bodyweight exercise (no modifications) */
  isPureBodyweight?: boolean;
  /** Current bodyweight data (for editing existing sets) */
  value?: BodyweightData;
  /** Callback when bodyweight data changes */
  onChange: (data: BodyweightData) => void;
  /** Weight unit for display */
  unit?: WeightUnit;
  /** Whether the input is disabled */
  disabled?: boolean;
}

export function BodyweightInput({
  userBodyweightKg,
  canAddWeight = true,
  canUseAssistance = true,
  isPureBodyweight = false,
  value,
  onChange,
  unit = 'kg',
  disabled = false,
}: BodyweightInputProps) {
  // State
  const [modification, setModification] = useState<BodyweightModification>(
    value?.modification || 'none'
  );
  const [addedWeight, setAddedWeight] = useState(
    value?.addedWeightKg ? formatWeightValue(value.addedWeightKg, unit).toString() : ''
  );
  const [assistanceWeight, setAssistanceWeight] = useState(
    value?.assistanceWeightKg ? formatWeightValue(value.assistanceWeightKg, unit).toString() : ''
  );
  const [assistanceType, setAssistanceType] = useState<'machine' | 'band' | 'partner'>(
    value?.assistanceType || 'machine'
  );
  const [bandColor, setBandColor] = useState<BandAssistance['color']>(
    value?.bandColor || 'red'
  );

  // Calculate effective load
  const calculateData = useCallback((): BodyweightData => {
    const addedKg = modification === 'weighted' ? inputWeightToKg(parseFloat(addedWeight) || 0, unit) : undefined;
    let assistKg = modification === 'assisted' ? inputWeightToKg(parseFloat(assistanceWeight) || 0, unit) : undefined;

    // For band assistance, use the preset value
    if (modification === 'assisted' && assistanceType === 'band') {
      assistKg = getBandAssistanceKg(bandColor);
    }

    const effectiveLoadKg = calculateEffectiveLoad(userBodyweightKg, modification, addedKg, assistKg);

    return {
      userBodyweightKg,
      modification,
      addedWeightKg: addedKg,
      assistanceWeightKg: assistKg,
      assistanceType: modification === 'assisted' ? assistanceType : undefined,
      bandColor: modification === 'assisted' && assistanceType === 'band' ? bandColor : undefined,
      effectiveLoadKg,
    };
  }, [userBodyweightKg, modification, addedWeight, assistanceWeight, assistanceType, bandColor, unit]);

  // Update parent when data changes
  useEffect(() => {
    const data = calculateData();
    onChange(data);
  }, [calculateData, onChange]);

  // Format weight for display
  const displayWeight = (kg: number) => formatWeightValue(kg, unit);
  const displayBw = displayWeight(userBodyweightKg);
  const effectiveLoad = calculateData().effectiveLoadKg;
  const displayEffective = displayWeight(effectiveLoad);

  // Calculate percentage of BW
  const percentBw = Math.round((effectiveLoad / userBodyweightKg) * 100);

  // Pure bodyweight - just show the weight
  if (isPureBodyweight) {
    return (
      <div className="space-y-2">
        <label className="block text-xs text-surface-500 mb-1">Weight</label>
        <div className="bg-surface-800/50 rounded-lg p-3">
          <div className="text-center">
            <div className="text-lg font-semibold text-surface-100">Bodyweight</div>
            <div className="text-2xl font-bold text-primary-400">{displayBw} {unit}</div>
            <div className="text-xs text-surface-500 mt-1">
              (based on your latest weigh-in)
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Modification selector options
  const options: { value: BodyweightModification; label: string; available: boolean }[] = [
    { value: 'none', label: 'Bodyweight Only', available: true },
    { value: 'weighted', label: 'Add Weight', available: canAddWeight },
    { value: 'assisted', label: 'Use Assistance', available: canUseAssistance },
  ];

  return (
    <div className="space-y-3">
      <label className="block text-xs text-surface-500">Weight</label>

      {/* Modification selector */}
      <div className="bg-surface-800/50 rounded-lg p-2 space-y-1">
        {options.filter(o => o.available).map((option) => (
          <label
            key={option.value}
            className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
              modification === option.value
                ? 'bg-primary-500/20 border border-primary-500/50'
                : 'hover:bg-surface-700/50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="modification"
              value={option.value}
              checked={modification === option.value}
              onChange={(e) => setModification(e.target.value as BodyweightModification)}
              disabled={disabled}
              className="w-4 h-4 text-primary-500 bg-surface-700 border-surface-600 focus:ring-primary-500"
            />
            <span className="text-sm text-surface-200">{option.label}</span>
          </label>
        ))}
      </div>

      {/* Added weight input */}
      {modification === 'weighted' && (
        <div>
          <label className="block text-xs text-surface-500 mb-1">Added Weight ({unit})</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500">+</span>
            <input
              type="number"
              value={addedWeight}
              onChange={(e) => setAddedWeight(e.target.value)}
              disabled={disabled}
              step="0.5"
              min="0"
              placeholder="0"
              className="w-full pl-8 pr-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
            />
          </div>
        </div>
      )}

      {/* Assistance inputs */}
      {modification === 'assisted' && (
        <div className="space-y-3">
          {/* Assistance type */}
          <div>
            <label className="block text-xs text-surface-500 mb-1">Assistance Type</label>
            <select
              value={assistanceType}
              onChange={(e) => setAssistanceType(e.target.value as 'machine' | 'band' | 'partner')}
              disabled={disabled}
              className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
            >
              <option value="machine">Machine (counterweight)</option>
              <option value="band">Resistance Band</option>
              <option value="partner">Partner Assist</option>
            </select>
          </div>

          {/* Machine/partner assistance weight */}
          {assistanceType !== 'band' && (
            <div>
              <label className="block text-xs text-surface-500 mb-1">
                Assistance ({unit})
                <span className="ml-1 text-surface-600">(amount helping you)</span>
              </label>
              <input
                type="number"
                value={assistanceWeight}
                onChange={(e) => setAssistanceWeight(e.target.value)}
                disabled={disabled}
                step="5"
                min="0"
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
          )}

          {/* Band color selector */}
          {assistanceType === 'band' && (
            <div>
              <label className="block text-xs text-surface-500 mb-1">Band Color/Strength</label>
              <select
                value={bandColor}
                onChange={(e) => setBandColor(e.target.value as BandAssistance['color'])}
                disabled={disabled}
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
              >
                {BAND_ASSISTANCE_PRESETS.map((band) => (
                  <option key={band.color} value={band.color}>
                    {band.color.charAt(0).toUpperCase() + band.color.slice(1)} ({band.label} ~{band.assistanceLbsRange[0]}-{band.assistanceLbsRange[1]} lbs)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Weight summary */}
      <div className="bg-surface-800 rounded-lg p-3">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-400">BW:</span>
            <span className="text-surface-200 font-mono">{displayBw} {unit}</span>
          </div>

          {modification === 'weighted' && parseFloat(addedWeight) > 0 && (
            <div className="flex justify-between text-green-400">
              <span>Added:</span>
              <span className="font-mono">+ {formatWeightValue(inputWeightToKg(parseFloat(addedWeight), unit), unit)} {unit}</span>
            </div>
          )}

          {modification === 'assisted' && effectiveLoad < userBodyweightKg && (
            <div className="flex justify-between text-blue-400">
              <span>Assistance:</span>
              <span className="font-mono">
                - {formatWeightValue(userBodyweightKg - effectiveLoad, unit)} {unit}
                {assistanceType === 'band' && ' (approx)'}
              </span>
            </div>
          )}

          <div className="border-t border-surface-700 pt-1 mt-1">
            <div className="flex justify-between font-semibold">
              <span className="text-surface-300">
                {modification === 'assisted' ? 'Effective:' : 'Total:'}
              </span>
              <span className="text-primary-400 font-mono">{displayEffective} {unit}</span>
            </div>
          </div>

          {modification === 'assisted' && (
            <div className="text-xs text-surface-500 text-center mt-2">
              (You&apos;re lifting {percentBw}% of your BW)
            </div>
          )}
        </div>

        {/* Band disclaimer */}
        {modification === 'assisted' && assistanceType === 'band' && (
          <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-400">
            Band assistance varies through the movement - this is approximate
          </div>
        )}
      </div>
    </div>
  );
}
