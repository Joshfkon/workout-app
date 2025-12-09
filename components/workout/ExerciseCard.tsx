'use client';

import { useState } from 'react';
import { Card, Badge, SetQualityBadge } from '@/components/ui';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/Accordion';
import type { Exercise, ExerciseBlock, SetLog, ProgressionType } from '@/types/schema';

interface ExerciseCardProps {
  exercise: Exercise;
  block: ExerciseBlock;
  sets: SetLog[];
  onSetComplete?: (setData: Partial<SetLog>) => void;
  isActive?: boolean;
}

export function ExerciseCard({
  exercise,
  block,
  sets,
  onSetComplete,
  isActive = false,
}: ExerciseCardProps) {
  const [showFormCues, setShowFormCues] = useState(false);

  const completedSets = sets.filter((s) => !s.isWarmup);
  const progressPercent = Math.round((completedSets.length / block.targetSets) * 100);

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
            <span className="text-surface-500">Weight:</span>
            <span className="font-medium text-surface-200">
              {block.targetWeightKg}kg
            </span>
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
              <tr key={set.id} className="hover:bg-surface-800/30">
                <td className="px-4 py-2.5 text-surface-300">{set.setNumber}</td>
                <td className="px-4 py-2.5 text-center font-mono text-surface-200">
                  {set.weightKg}kg
                </td>
                <td className="px-4 py-2.5 text-center font-mono text-surface-200">
                  {set.reps}
                </td>
                <td className="px-4 py-2.5 text-center font-mono text-surface-200">
                  {set.rpe}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <SetQualityBadge quality={set.quality} />
                </td>
              </tr>
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

