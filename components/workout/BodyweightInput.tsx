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
import { formatWeightValue, convertWeightForDisplay, inputWeightToKg, convertWeight } from '@/lib/utils';

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
  // Seed existing modification weights exactly (convertWeightForDisplay) so editing a set
  // doesn't silently round the user's input to plate increments.
  const [addedWeight, setAddedWeight] = useState(
    value?.addedWeightKg ? convertWeightForDisplay(value.addedWeightKg, unit).toString() : ''
  );
  const [assistanceWeight, setAssistanceWeight] = useState(
    value?.assistanceWeightKg ? convertWeightForDisplay(value.assistanceWeightKg, unit).toString() : ''
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
        <label className="block text-xs text-ink-3 mb-1">Weight</label>
        <div className="bg-fill/50 rounded-lg p-3">
          <div className="text-center">
            <div className="text-lg font-semibold text-ink">Bodyweight</div>
            <div className="text-2xl font-bold text-action">{displayBw} {unit}</div>
            <div className="text-xs text-ink-3 mt-1">
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
    <div className="space-y-2">
      <label className="block text-xs text-ink-3">Weight</label>

      {/* Modification selector - more compact */}
      <div className="bg-fill/50 rounded p-1.5 space-y-0.5">
        {options.filter(o => o.available).map((option) => (
          <label
            key={option.value}
            className={`flex items-center gap-1.5 p-1.5 rounded cursor-pointer transition-colors ${
              modification === option.value
                ? 'bg-action/20 border border-action/50'
                : 'hover:bg-sep/50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="modification"
              value={option.value}
              checked={modification === option.value}
              onChange={(e) => setModification(e.target.value as BodyweightModification)}
              disabled={disabled}
              className="w-3.5 h-3.5 text-action bg-sep border-sep focus:ring-action"
            />
            <span className="text-xs text-ink">{option.label}</span>
          </label>
        ))}
      </div>

      {/* Added weight input - more compact */}
      {modification === 'weighted' && (
        <div>
          <label className="block text-xs text-ink-3 mb-0.5">Added Weight ({unit})</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3 text-xs">+</span>
            <input
              type="number"
              inputMode="decimal"
              value={addedWeight}
              onChange={(e) => setAddedWeight(e.target.value)}
              disabled={disabled}
              step="0.5"
              min="0"
              placeholder="0"
              className="w-full pl-6 pr-2 py-1.5 bg-card rounded text-ink text-center font-mono text-sm focus:ring-2 focus:ring-action focus:border-transparent disabled:opacity-50 shadow-card"
            />
          </div>
        </div>
      )}

      {/* Assistance inputs - more compact */}
      {modification === 'assisted' && (
        <div className="space-y-2">
          {/* Assistance type */}
          <div>
            <label className="block text-xs text-ink-3 mb-0.5">Assistance Type</label>
            <select
              value={assistanceType}
              onChange={(e) => setAssistanceType(e.target.value as 'machine' | 'band' | 'partner')}
              disabled={disabled}
              className="w-full px-2 py-1.5 bg-card rounded text-ink text-sm focus:ring-2 focus:ring-action focus:border-transparent disabled:opacity-50 shadow-card"
            >
              <option value="machine">Machine (counterweight)</option>
              <option value="band">Resistance Band</option>
              <option value="partner">Partner Assist</option>
            </select>
          </div>

          {/* Machine/partner assistance weight */}
          {assistanceType !== 'band' && (
            <div>
              <label className="block text-xs text-ink-3 mb-0.5">
                Assistance ({unit})
                <span className="ml-1 text-ink-3 text-xs">(amount helping you)</span>
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={assistanceWeight}
                onChange={(e) => setAssistanceWeight(e.target.value)}
                disabled={disabled}
                step="5"
                min="0"
                placeholder="0"
                className="w-full px-2 py-1.5 bg-card rounded text-ink text-center font-mono text-sm focus:ring-2 focus:ring-action focus:border-transparent disabled:opacity-50 shadow-card"
              />
            </div>
          )}

          {/* Band color selector */}
          {assistanceType === 'band' && (
            <div>
              <label className="block text-xs text-ink-3 mb-0.5">Band Color/Strength</label>
              <select
                value={bandColor}
                onChange={(e) => setBandColor(e.target.value as BandAssistance['color'])}
                disabled={disabled}
                className="w-full px-2 py-1.5 bg-card rounded text-ink text-sm focus:ring-2 focus:ring-action focus:border-transparent disabled:opacity-50 shadow-card"
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

      {/* Weight summary - more compact */}
      <div className="bg-fill rounded p-2">
        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between">
            <span className="text-ink-2">BW:</span>
            <span className="text-ink font-mono">{displayBw} {unit}</span>
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

          <div className="border-t border-sep pt-0.5 mt-0.5">
            <div className="flex justify-between font-semibold">
              <span className="text-ink-2">
                {modification === 'assisted' ? 'Effective:' : 'Total:'}
              </span>
              <span className="text-action font-mono">{displayEffective} {unit}</span>
            </div>
          </div>

          {modification === 'assisted' && (
            <div className="text-xs text-ink-3 text-center mt-1">
              (You&apos;re lifting {percentBw}% of your BW)
            </div>
          )}
        </div>

        {/* Band disclaimer - more compact */}
        {modification === 'assisted' && assistanceType === 'band' && (
          <div className="mt-2 p-1.5 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-400">
            Band assistance varies through the movement - this is approximate
          </div>
        )}
      </div>
    </div>
  );
}
