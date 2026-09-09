'use client';

import type { Equipment, MuscleGroup, Experience } from '@/types/schema';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { MUSCLE_GROUPS } from '@/types/schema';
import { muscleDisplayName } from '@/lib/utils';
import { GymEquipmentSettings } from '@/components/settings/GymEquipmentSettings';
import { ExerciseVarietySettings } from '@/components/settings/ExerciseVarietySettings';
import { MusclePrioritySettings } from '@/components/settings/MusclePrioritySettings';
import { VolumeLandmarksCard } from '@/components/settings/VolumeLandmarksCard';

const ALL_EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell'];

interface TrainingTabPanelProps {
  userId: string | null;
  
  // Equipment
  availableEquipment: Equipment[];
  setAvailableEquipment: (value: Equipment[]) => void;
  
  // Injury History
  injuryHistory: MuscleGroup[];
  setInjuryHistory: (value: MuscleGroup[]) => void;
  
  // Volume Landmarks
  experience: Experience;
  volumeLandmarks: Record<string, { mev: number; mav: number; mrv: number }>;
  setVolumeLandmarks: React.Dispatch<React.SetStateAction<Record<string, { mev: number; mav: number; mrv: number }>>>;
  
  // Save handling
  onSave: () => void;
  isSaving: boolean;
}

export function TrainingTabPanel({
  userId,
  availableEquipment,
  setAvailableEquipment,
  injuryHistory,
  setInjuryHistory,
  experience,
  volumeLandmarks,
  setVolumeLandmarks,
  onSave,
  isSaving,
}: TrainingTabPanelProps) {
  return (
    <div className="space-y-6">
      {/* Equipment & Gym */}
      <Card>
        <CardHeader>
          <CardTitle>Equipment & Gym</CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Select available equipment to customize exercise selection
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-surface-200 mb-3">
              Available Equipment
            </label>
            <p className="text-xs text-surface-500 mb-3">
              Broad categories — exercises will only use equipment you check here
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ALL_EQUIPMENT.map((equip) => (
                <label
                  key={equip}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    availableEquipment.includes(equip)
                      ? 'bg-primary-500/10 border border-primary-500/30'
                      : 'bg-surface-800 border border-surface-700 hover:border-surface-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={availableEquipment.includes(equip)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAvailableEquipment([...availableEquipment, equip]);
                      } else {
                        setAvailableEquipment(availableEquipment.filter((e) => e !== equip));
                      }
                    }}
                    className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-surface-200 capitalize">{equip}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-200 mb-3">
              Injury History / Cautious Areas
            </label>
            <p className="text-xs text-surface-500 mb-3">
              Select muscle groups to be cautious with. The AI will avoid or modify exercises for these areas.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {MUSCLE_GROUPS.map((muscle) => (
                <label
                  key={muscle}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    injuryHistory.includes(muscle)
                      ? 'bg-warning-500/10 border border-warning-500/30'
                      : 'bg-surface-800 border border-surface-700 hover:border-surface-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={injuryHistory.includes(muscle)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setInjuryHistory([...injuryHistory, muscle]);
                      } else {
                        setInjuryHistory(injuryHistory.filter((m) => m !== muscle));
                      }
                    }}
                    className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-warning-500 focus:ring-warning-500"
                  />
                  <span className="text-sm text-surface-200">{muscleDisplayName(muscle)}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Gym Equipment */}
      <div id="gym-equipment">
        <GymEquipmentSettings />
      </div>

      {/* Exercise Variety Settings */}
      {userId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Exercise Variety
            </CardTitle>
            <p className="text-sm text-surface-400 mt-1">
              Control how much the AI rotates between different exercises for each muscle group.
              Higher variety means different exercises each session for the same muscle.
            </p>
          </CardHeader>
          <CardContent>
            <ExerciseVarietySettings userId={userId} />
          </CardContent>
        </Card>
      )}

      {/* Muscle Priorities */}
      {userId && (
        <Card>
          <CardHeader>
            <CardTitle>Muscle Group Priorities</CardTitle>
            <p className="text-sm text-surface-400 mt-1">
              Set training priorities for each muscle group. Higher priority muscles will receive more volume in program generation.
            </p>
          </CardHeader>
          <CardContent>
            <MusclePrioritySettings userId={userId} />
          </CardContent>
        </Card>
      )}

      {/* Volume Landmarks */}
      <VolumeLandmarksCard
        experience={experience}
        volumeLandmarks={volumeLandmarks}
        setVolumeLandmarks={setVolumeLandmarks}
      />

      {/* Sticky Save Button */}
      <div className="sticky bottom-4 z-10">
        <Button onClick={onSave} isLoading={isSaving} className="w-full shadow-lg">
          Save Training Changes
        </Button>
      </div>
    </div>
  );
}
