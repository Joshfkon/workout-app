'use client';

import { useState } from 'react';
import { Card, Badge, SetQualityBadge, Button } from '@/components/ui';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/Accordion';
import type { Exercise, ExerciseBlock, SetLog, ProgressionType, WeightUnit } from '@/types/schema';
import { formatWeight, formatWeightValue, inputWeightToKg } from '@/lib/utils';

interface ExerciseCardProps {
  exercise: Exercise;
  block: ExerciseBlock;
  sets: SetLog[];
  onSetComplete?: (setData: Partial<SetLog>) => void;
  onSetEdit?: (setId: string, data: { weightKg: number; reps: number; rpe: number }) => void;
  onSetDelete?: (setId: string) => void;
  isActive?: boolean;
  unit?: WeightUnit;
  recommendedWeight?: number;  // AI-suggested weight in kg
}

export function ExerciseCard({
  exercise,
  block,
  sets,
  onSetComplete,
  onSetEdit,
  onSetDelete,
  isActive = false,
  unit = 'kg',
  recommendedWeight,
}: ExerciseCardProps) {
  const [showFormCues, setShowFormCues] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editRpe, setEditRpe] = useState('');

  const completedSets = sets.filter((s) => !s.isWarmup);
  const progressPercent = Math.round((completedSets.length / block.targetSets) * 100);

  // Format weight for display
  const displayWeight = (kg: number) => formatWeightValue(kg, unit);
  const weightLabel = unit === 'lb' ? 'lbs' : 'kg';

  const startEditing = (set: SetLog) => {
    setEditingSetId(set.id);
    setEditWeight(String(displayWeight(set.weightKg)));
    setEditReps(String(set.reps));
    setEditRpe(String(set.rpe));
  };

  const cancelEditing = () => {
    setEditingSetId(null);
    setEditWeight('');
    setEditReps('');
    setEditRpe('');
  };

  const saveEdit = () => {
    if (!editingSetId || !onSetEdit) return;
    const weightNum = parseFloat(editWeight);
    const repsNum = parseInt(editReps);
    const rpeNum = parseFloat(editRpe);
    
    if (!isNaN(weightNum) && !isNaN(repsNum) && !isNaN(rpeNum)) {
      // Convert from display unit back to kg
      const weightKg = inputWeightToKg(weightNum, unit);
      onSetEdit(editingSetId, { weightKg, reps: repsNum, rpe: rpeNum });
    }
    cancelEditing();
  };

  const getProgressionIcon = (type: ProgressionType | null) => {
    switch (type) {
      case 'load':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        );
      case 'reps':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'sets':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <Card
      variant={isActive ? 'elevated' : 'default'}
      padding="none"
      className={`overflow-hidden transition-all ${isActive ? 'ring-2 ring-primary-500/50' : ''}`}
    >
      {/* Header */}
      <div className="p-4 border-b border-surface-800">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-surface-100 truncate">
                {exercise.name}
              </h3>
              {block.progressionType && (
                <span className="flex items-center gap-1 text-primary-400">
                  {getProgressionIcon(block.progressionType)}
                </span>
              )}
            </div>
            <p className="text-sm text-surface-400 mt-0.5">
              {exercise.primaryMuscle} • {exercise.mechanic}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={progressPercent === 100 ? 'success' : 'default'}>
              {completedSets.length}/{block.targetSets}
            </Badge>
          </div>
        </div>

        {/* Targets */}
        <div className="flex flex-wrap gap-3 mt-3 text-sm">
          <div className="flex items-center gap-1.5">
            {block.targetWeightKg > 0 ? (
              <>
                <span className="text-surface-500">Weight:</span>
                <span className="font-medium text-surface-200">
                  {displayWeight(block.targetWeightKg)} {weightLabel}
                </span>
              </>
            ) : recommendedWeight && recommendedWeight > 0 ? (
              <>
                <span className="text-primary-500">💡 Suggested:</span>
                <span className="font-medium text-primary-300">
                  {displayWeight(recommendedWeight)} {weightLabel}
                </span>
              </>
            ) : (
              <>
                <span className="text-surface-500">Weight:</span>
                <span className="font-medium text-surface-400 italic">
                  Enter your working weight
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-surface-500">Reps:</span>
            <span className="font-medium text-surface-200">
              {block.targetRepRange[0]}-{block.targetRepRange[1]}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-surface-500">RIR:</span>
            <span className="font-medium text-surface-200">
              {block.targetRir}
            </span>
          </div>
        </div>

        {/* Suggestion reason */}
        {block.suggestionReason && (
          <p className="mt-2 text-xs text-primary-400/80 italic">
            {block.suggestionReason}
          </p>
        )}
      </div>

      {/* Sets table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-800/50">
            <tr>
              <th className="px-4 py-2 text-left text-surface-400 font-medium">Set</th>
              <th className="px-4 py-2 text-center text-surface-400 font-medium">Weight</th>
              <th className="px-4 py-2 text-center text-surface-400 font-medium">Reps</th>
              <th className="px-4 py-2 text-center text-surface-400 font-medium">RPE</th>
              <th className="px-4 py-2 text-right text-surface-400 font-medium">Quality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800">
            {/* Completed sets */}
            {completedSets.map((set) => (
              editingSetId === set.id ? (
                <tr key={set.id} className="bg-primary-500/10">
                  <td className="px-4 py-2 text-surface-300">{set.setNumber}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={editWeight}
                      onChange={(e) => setEditWeight(e.target.value)}
                      step="0.5"
                      className="w-full px-2 py-1 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={editReps}
                      onChange={(e) => setEditReps(e.target.value)}
                      className="w-full px-2 py-1 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={editRpe}
                      onChange={(e) => setEditRpe(e.target.value)}
                      step="0.5"
                      className="w-full px-2 py-1 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={saveEdit}
                        className="p-1 text-success-400 hover:bg-success-500/20 rounded"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="p-1 text-surface-400 hover:bg-surface-700 rounded"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={set.id}
                  className={`hover:bg-surface-800/30 group`}
                >
                  <td className="px-4 py-2.5 text-surface-300">{set.setNumber}</td>
                  <td 
                    className={`px-4 py-2.5 text-center font-mono text-surface-200 ${onSetEdit ? 'cursor-pointer' : ''}`}
                    onClick={() => onSetEdit && startEditing(set)}
                  >
                    {displayWeight(set.weightKg)} {weightLabel}
                  </td>
                  <td 
                    className={`px-4 py-2.5 text-center font-mono text-surface-200 ${onSetEdit ? 'cursor-pointer' : ''}`}
                    onClick={() => onSetEdit && startEditing(set)}
                  >
                    {set.reps}
                  </td>
                  <td 
                    className={`px-4 py-2.5 text-center font-mono text-surface-200 ${onSetEdit ? 'cursor-pointer' : ''}`}
                    onClick={() => onSetEdit && startEditing(set)}
                  >
                    {set.rpe}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <SetQualityBadge quality={set.quality} />
                      {onSetDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Delete this set?')) {
                              onSetDelete(set.id);
                            }
                          }}
                          className="p-1 text-surface-600 hover:text-danger-400 hover:bg-danger-500/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete set"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            ))}
            {/* Remaining sets placeholder */}
            {Array.from({ length: block.targetSets - completedSets.length }).map((_, i) => (
              <tr key={`empty-${i}`} className="bg-surface-800/20">
                <td className="px-4 py-2.5 text-surface-500">
                  {completedSets.length + i + 1}
                </td>
                <td className="px-4 py-2.5 text-center text-surface-600">—</td>
                <td className="px-4 py-2.5 text-center text-surface-600">—</td>
                <td className="px-4 py-2.5 text-center text-surface-600">—</td>
                <td className="px-4 py-2.5 text-right text-surface-600">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form cues accordion */}
      {exercise.formCues.length > 0 && (
        <div className="border-t border-surface-800">
          <Accordion>
            <AccordionItem id="form-cues">
              <div className="px-4">
                <AccordionTrigger id="form-cues">
                  <span className="text-sm text-surface-400">Form Cues & Tips</span>
                </AccordionTrigger>
                <AccordionContent id="form-cues">
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-xs font-medium text-surface-300 uppercase tracking-wide mb-1">
                        Key Cues
                      </h4>
                      <ul className="space-y-1">
                        {exercise.formCues.map((cue, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-surface-400">
                            <span className="text-primary-400 mt-1">•</span>
                            {cue}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {exercise.commonMistakes.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-surface-300 uppercase tracking-wide mb-1">
                          Common Mistakes
                        </h4>
                        <ul className="space-y-1">
                          {exercise.commonMistakes.map((mistake, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-danger-400/80">
                              <span className="mt-1">✗</span>
                              {mistake}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {exercise.setupNote && (
                      <div className="pt-2 border-t border-surface-800">
                        <p className="text-xs text-surface-500">
                          <span className="font-medium">Setup:</span> {exercise.setupNote}
                        </p>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </div>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </Card>
  );
}

