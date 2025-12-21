'use client';

import { memo, useState } from 'react';
import type { SetDiscomfort, DiscomfortBodyPart, DiscomfortSeverity } from '@/types/schema';

const BODY_PARTS: Array<{ value: DiscomfortBodyPart; label: string }> = [
  { value: 'lower_back', label: 'Lower Back' },
  { value: 'upper_back', label: 'Upper Back' },
  { value: 'neck', label: 'Neck' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'left_shoulder', label: 'L Shoulder' },
  { value: 'right_shoulder', label: 'R Shoulder' },
  { value: 'elbows', label: 'Elbows' },
  { value: 'left_elbow', label: 'L Elbow' },
  { value: 'right_elbow', label: 'R Elbow' },
  { value: 'wrists', label: 'Wrists' },
  { value: 'left_wrist', label: 'L Wrist' },
  { value: 'right_wrist', label: 'R Wrist' },
  { value: 'knees', label: 'Knees' },
  { value: 'left_knee', label: 'L Knee' },
  { value: 'right_knee', label: 'R Knee' },
  { value: 'hips', label: 'Hips' },
  { value: 'left_hip', label: 'L Hip' },
  { value: 'right_hip', label: 'R Hip' },
  { value: 'other', label: 'Other' },
];

const SEVERITY_OPTIONS: Array<{
  value: DiscomfortSeverity;
  label: string;
  subLabel: string;
  color: string;
  bgColor: string;
  selectedBg: string;
}> = [
  {
    value: 'twinge',
    label: 'Twinge',
    subLabel: 'Mild',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/20',
    selectedBg: 'bg-yellow-500 text-white border-yellow-500',
  },
  {
    value: 'discomfort',
    label: 'Discomfort',
    subLabel: 'Moderate',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20',
    selectedBg: 'bg-orange-500 text-white border-orange-500',
  },
  {
    value: 'pain',
    label: 'Pain',
    subLabel: 'Stop',
    color: 'text-danger-400',
    bgColor: 'bg-danger-500/10 border-danger-500/20 hover:bg-danger-500/20',
    selectedBg: 'bg-danger-500 text-white border-danger-500',
  },
];

interface DiscomfortLoggerProps {
  value: SetDiscomfort | undefined;
  onChange: (value: SetDiscomfort | undefined) => void;
  disabled?: boolean;
}

/**
 * Optional discomfort logger component
 * Expands when clicked to allow logging body part, severity, and notes
 */
export const DiscomfortLogger = memo(function DiscomfortLogger({
  value,
  onChange,
  disabled = false,
}: DiscomfortLoggerProps) {
  const [isExpanded, setIsExpanded] = useState(!!value);
  const [bodyPart, setBodyPart] = useState<DiscomfortBodyPart | null>(
    value?.bodyPart || null
  );
  const [severity, setSeverity] = useState<DiscomfortSeverity | null>(
    value?.severity || null
  );
  const [notes, setNotes] = useState(value?.notes || '');

  const handleSave = () => {
    if (bodyPart && severity) {
      onChange({
        bodyPart,
        severity,
        notes: notes || undefined,
      });
      setIsExpanded(false);
    }
  };

  const handleCancel = () => {
    setBodyPart(value?.bodyPart || null);
    setSeverity(value?.severity || null);
    setNotes(value?.notes || '');
    setIsExpanded(false);
  };

  const handleClear = () => {
    onChange(undefined);
    setBodyPart(null);
    setSeverity(null);
    setNotes('');
    setIsExpanded(false);
  };

  // Already has discomfort logged - show summary
  if (value && !isExpanded) {
    return (
      <div className="bg-warning-500/10 border border-warning-500/30 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-warning-400">
              {SEVERITY_OPTIONS.find((s) => s.value === value.severity)?.label}
            </span>
            <span className="text-surface-400">-</span>
            <span className="text-surface-300">
              {BODY_PARTS.find((b) => b.value === value.bodyPart)?.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExpanded(true)}
              disabled={disabled}
              className="text-xs text-surface-400 hover:text-surface-300"
            >
              Edit
            </button>
            <button
              onClick={handleClear}
              disabled={disabled}
              className="text-xs text-danger-400 hover:text-danger-300"
            >
              Remove
            </button>
          </div>
        </div>
        {value.notes && (
          <p className="text-xs text-surface-400 mt-1 italic">{value.notes}</p>
        )}
      </div>
    );
  }

  // Collapsed - show expand button
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        disabled={disabled}
        className="flex items-center gap-2 text-sm text-warning-400/70 hover:text-warning-400 transition-colors disabled:opacity-50"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        Log discomfort (optional)
      </button>
    );
  }

  // Expanded - show full form
  return (
    <div className="bg-surface-800/50 border border-surface-700 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-surface-200 flex items-center gap-2">
          <svg className="w-4 h-4 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          Log Discomfort
        </h4>
      </div>

      {/* Body Part Selection */}
      <div>
        <label className="block text-xs text-surface-400 mb-2">Where?</label>
        <div className="flex flex-wrap gap-1.5">
          {BODY_PARTS.map((part) => (
            <button
              key={part.value}
              type="button"
              onClick={() => setBodyPart(part.value)}
              className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                bodyPart === part.value
                  ? 'bg-primary-500 text-white border-primary-500'
                  : 'bg-surface-900 text-surface-300 border-surface-700 hover:border-surface-600'
              }`}
            >
              {part.label}
            </button>
          ))}
        </div>
      </div>

      {/* Severity Selection */}
      <div>
        <label className="block text-xs text-surface-400 mb-2">Severity</label>
        <div className="grid grid-cols-3 gap-2">
          {SEVERITY_OPTIONS.map((option) => {
            const isSelected = severity === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSeverity(option.value)}
                className={`
                  flex flex-col items-center justify-center py-2 px-2 rounded-lg border transition-all
                  ${isSelected ? option.selectedBg : option.bgColor}
                `}
              >
                <span
                  className={`text-sm font-medium ${isSelected ? 'text-white' : option.color}`}
                >
                  {option.label}
                </span>
                <span
                  className={`text-xs ${isSelected ? 'text-white/80' : 'text-surface-400'}`}
                >
                  {option.subLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pain Warning */}
      {severity === 'pain' && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-lg p-3">
          <p className="text-sm text-danger-400 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            Consider stopping this exercise. Continuing through pain can worsen injury.
          </p>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-xs text-surface-400 mb-2">Notes (optional)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Brief description..."
          className="w-full px-3 py-2 text-sm bg-surface-900 border border-surface-700 rounded-lg text-surface-200 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 text-sm text-surface-400 hover:text-surface-300 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!bodyPart || !severity}
          className="px-4 py-2 text-sm bg-warning-500 text-white rounded-lg hover:bg-warning-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save Discomfort
        </button>
      </div>
    </div>
  );
});

export default DiscomfortLogger;
