'use client';

import { Button } from '@/components/ui';
import { getExerciseInjuryRisk } from '../_lib/injuryRisk';
import type { ExerciseBlockWithExercise } from '../_lib/types';

interface InjuryReportModalProps {
  isOpen: boolean;
  blocks: ExerciseBlockWithExercise[];
  temporaryInjuries: { area: string; severity: 1 | 2 | 3 }[];
  selectedInjuryArea: string;
  selectedInjurySeverity: 1 | 2 | 3;
  onClose: () => void;
  onSelectedInjuryAreaChange: (area: string) => void;
  onSelectedInjurySeverityChange: (severity: 1 | 2 | 3) => void;
  onTemporaryInjuriesChange: (injuries: { area: string; severity: 1 | 2 | 3 }[]) => void;
  onApply: () => void;
}

export function InjuryReportModal({
  isOpen,
  blocks,
  temporaryInjuries,
  selectedInjuryArea,
  selectedInjurySeverity,
  onClose,
  onSelectedInjuryAreaChange,
  onSelectedInjurySeverityChange,
  onTemporaryInjuriesChange,
  onApply,
}: InjuryReportModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-surface-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🤕</span>
            <h2 className="text-lg font-semibold text-surface-100">Report Pain/Injury</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-surface-400 hover:text-surface-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-sm text-surface-400">
            Tell us about any pain or discomfort. We&apos;ll suggest exercise swaps to avoid aggravating it.
          </p>

          {/* Current injuries */}
          {temporaryInjuries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-surface-300">Currently reported:</p>
              <div className="flex flex-wrap gap-2">
                {temporaryInjuries.map(injury => {
                  const areaLabels: Record<string, string> = {
                    lower_back: '🔻 Lower Back', upper_back: '🔺 Upper Back', neck: '🦴 Neck',
                    shoulder_left: '💪 Left Shoulder', shoulder_right: '💪 Right Shoulder',
                    elbow_left: '🦾 Left Elbow', elbow_right: '🦾 Right Elbow',
                    wrist_left: '🤚 Left Wrist', wrist_right: '🤚 Right Wrist',
                    hip_left: '🦵 Left Hip', hip_right: '🦵 Right Hip',
                    knee_left: '🦿 Left Knee', knee_right: '🦿 Right Knee',
                    ankle_left: '🦶 Left Ankle', ankle_right: '🦶 Right Ankle',
                    chest: '❤️ Chest', other: '⚠️ Other'
                  };
                  const severityLabels = ['Mild', 'Moderate', 'Significant'];
                  return (
                    <div
                      key={injury.area}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                        injury.severity === 3
                          ? 'bg-danger-500/20 text-danger-400'
                          : injury.severity === 2
                            ? 'bg-warning-500/20 text-warning-400'
                            : 'bg-surface-700 text-surface-300'
                      }`}
                    >
                      <span>{areaLabels[injury.area] || injury.area}</span>
                      <span className="text-xs opacity-70">({severityLabels[injury.severity - 1]})</span>
                      <button
                        onClick={() => onTemporaryInjuriesChange(temporaryInjuries.filter(i => i.area !== injury.area))}
                        className="ml-1 p-0.5 hover:bg-surface-600 rounded-full"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add new injury */}
          <div className="space-y-3 p-4 bg-surface-800/50 rounded-lg">
            <p className="text-xs font-medium text-surface-300">Add an issue:</p>

            <div>
              <label className="block text-xs text-surface-400 mb-1">Area affected</label>
              <select
                value={selectedInjuryArea}
                onChange={(e) => onSelectedInjuryAreaChange(e.target.value)}
                className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-100 text-sm"
              >
                <option value="">Select area...</option>
                <optgroup label="Back & Core">
                  <option value="lower_back">🔻 Lower Back</option>
                  <option value="upper_back">🔺 Upper Back</option>
                  <option value="neck">🦴 Neck</option>
                  <option value="chest">❤️ Chest</option>
                </optgroup>
                <optgroup label="Upper Body">
                  <option value="shoulder_left">💪 Left Shoulder</option>
                  <option value="shoulder_right">💪 Right Shoulder</option>
                  <option value="elbow_left">🦾 Left Elbow</option>
                  <option value="elbow_right">🦾 Right Elbow</option>
                  <option value="wrist_left">🤚 Left Wrist</option>
                  <option value="wrist_right">🤚 Right Wrist</option>
                </optgroup>
                <optgroup label="Lower Body">
                  <option value="hip_left">🦵 Left Hip</option>
                  <option value="hip_right">🦵 Right Hip</option>
                  <option value="knee_left">🦿 Left Knee</option>
                  <option value="knee_right">🦿 Right Knee</option>
                  <option value="ankle_left">🦶 Left Ankle</option>
                  <option value="ankle_right">🦶 Right Ankle</option>
                </optgroup>
                <option value="other">⚠️ Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-surface-400 mb-1">Severity</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(level => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onSelectedInjurySeverityChange(level as 1 | 2 | 3)}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                      selectedInjurySeverity === level
                        ? level === 3
                          ? 'bg-danger-500 text-white'
                          : level === 2
                            ? 'bg-warning-500 text-black'
                            : 'bg-primary-500 text-white'
                        : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
                    }`}
                  >
                    {level === 1 ? 'Mild' : level === 2 ? 'Moderate' : 'Significant'}
                  </button>
                ))}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (selectedInjuryArea && !temporaryInjuries.some(i => i.area === selectedInjuryArea)) {
                  onTemporaryInjuriesChange([...temporaryInjuries, { area: selectedInjuryArea, severity: selectedInjurySeverity }]);
                  onSelectedInjuryAreaChange('');
                  onSelectedInjurySeverityChange(1);
                }
              }}
              disabled={!selectedInjuryArea || temporaryInjuries.some(i => i.area === selectedInjuryArea)}
              className="w-full"
            >
              + Add to List
            </Button>
          </div>

          {/* What will happen info */}
          {temporaryInjuries.length > 0 && (
            <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
              <p className="text-xs text-primary-400 font-medium mb-1">What happens now?</p>
              <p className="text-xs text-surface-400">
                We&apos;ll flag exercises that could aggravate these areas. You can easily swap them for safer alternatives.
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-surface-800 space-y-2">
          {/* Show risky exercises count */}
          {temporaryInjuries.length > 0 && (
            <div className="text-center text-sm text-surface-400 mb-2">
              {blocks.filter(b => getExerciseInjuryRisk(b.exercise, temporaryInjuries).isRisky).length > 0 ? (
                <span className="text-warning-400">
                  ⚠️ {blocks.filter(b => getExerciseInjuryRisk(b.exercise, temporaryInjuries).severity >= 2).length} exercise(s) may need swapping
                </span>
              ) : (
                <span className="text-success-400">✓ All exercises look safe!</span>
              )}
            </div>
          )}
          <Button onClick={onApply} className="w-full">
            {temporaryInjuries.length > 0 ? 'Apply & Continue Workout' : 'Close'}
          </Button>
        </div>
      </div>
    </div>
  );
}
