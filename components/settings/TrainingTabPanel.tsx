'use client';

import type { Equipment, MuscleGroup, Experience } from '@/types/schema';
import { Card, CardHeader, CardTitle, CardContent, Button, Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui';
import { MUSCLE_GROUPS } from '@/types/schema';
import { muscleDisplayName } from '@/lib/utils';
import { GymEquipmentSettings } from '@/components/settings/GymEquipmentSettings';
import { LegacyHistoryBackfill } from '@/components/settings/LegacyHistoryBackfill';
import { ExerciseVarietySettings } from '@/components/settings/ExerciseVarietySettings';
import { MusclePrioritySettings } from '@/components/settings/MusclePrioritySettings';
import { VolumeLandmarksCard } from '@/components/settings/VolumeLandmarksCard';
import { TrainingStyleCard } from '@/components/settings/TrainingStyleCard';

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
  hasUnsavedChanges: boolean;
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
  hasUnsavedChanges,
}: TrainingTabPanelProps) {
  return (
    <div className="space-y-6">
      {/* Plan (mesocycles) vs freestyle — saves on tap */}
      <TrainingStyleCard userId={userId} />

      {/* Collapsible sections to reduce scroll cliff */}
      <Card>
        <CardHeader>
          <CardTitle>Training configuration</CardTitle>
          <p className="text-body text-ink-2 mt-1">
            Configure equipment, gym setup, exercise preferences, and volume parameters
          </p>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" defaultOpen={['equipment']}>
            <AccordionItem id="equipment">
              <AccordionTrigger id="equipment">
                <span className="text-body font-semibold">Equipment & injuries</span>
              </AccordionTrigger>
              <AccordionContent id="equipment">
                <div className="space-y-6 pt-2">
          <div>
            <label className="block text-body font-medium text-ink mb-3">
              Available equipment
            </label>
            <p className="text-caption text-ink-3 mb-3">
              Broad categories — exercises will only use equipment you check here
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ALL_EQUIPMENT.map((equip) => (
                <label
                  key={equip}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    availableEquipment.includes(equip)
                      ? 'bg-action/10 border border-action/30'
                      : 'bg-fill border border-sep hover:border-sep'
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
                    className="w-4 h-4 rounded border-sep bg-fill text-action focus:ring-action"
                  />
                  <span className="text-body text-ink capitalize">{equip}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-body font-medium text-ink mb-3">
              Injury history / cautious areas
            </label>
            <p className="text-caption text-ink-3 mb-3">
              Select muscle groups to be cautious with. The AI will avoid or modify exercises for these areas.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {MUSCLE_GROUPS.map((muscle) => (
                <label
                  key={muscle}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    injuryHistory.includes(muscle)
                      ? 'bg-status-warn/10 border border-status-warn/30'
                      : 'bg-fill border border-sep hover:border-sep'
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
                    className="w-4 h-4 rounded border-sep bg-fill text-status-warn focus:ring-status-warn"
                  />
                  <span className="text-body text-ink">{muscleDisplayName(muscle)}</span>
                </label>
              ))}
            </div>
          </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Gym Equipment */}
            <AccordionItem id="gym">
              <AccordionTrigger id="gym">
                <span className="text-body font-semibold">Gym equipment & locations</span>
              </AccordionTrigger>
              <AccordionContent id="gym">
                <div className="pt-2">
                  <GymEquipmentSettings />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Legacy history → gym assignment (location-scoped calibration) */}
            {userId && (
              <AccordionItem id="history-gym">
                <AccordionTrigger id="history-gym">
                  <span className="text-body font-semibold">Past workouts &amp; gyms</span>
                </AccordionTrigger>
                <AccordionContent id="history-gym">
                  <div className="pt-2">
                    <LegacyHistoryBackfill userId={userId} />
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Exercise Variety */}
            {userId && (
              <AccordionItem id="variety">
                <AccordionTrigger id="variety">
                  <span className="text-body font-semibold">Exercise variety</span>
                </AccordionTrigger>
                <AccordionContent id="variety">
                  <div className="pt-2">
                    <p className="text-body text-ink-2 mb-4">
                      Control how much the AI rotates between different exercises for each muscle group.
                      Higher variety means different exercises each session for the same muscle.
                    </p>
                    <ExerciseVarietySettings userId={userId} />
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Muscle Priorities */}
            {userId && (
              <AccordionItem id="priorities">
                <AccordionTrigger id="priorities">
                  <span className="text-body font-semibold">Muscle group priorities</span>
                </AccordionTrigger>
                <AccordionContent id="priorities">
                  <div className="pt-2">
                    <p className="text-body text-ink-2 mb-4">
                      Set training priorities for each muscle group. Higher priority muscles will receive more volume in program generation.
                    </p>
                    <MusclePrioritySettings userId={userId} />
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Volume Landmarks */}
            <AccordionItem id="volume">
              <AccordionTrigger id="volume">
                <span className="text-body font-semibold">Volume landmarks</span>
              </AccordionTrigger>
              <AccordionContent id="volume">
                <div className="pt-2">
                  <p className="text-body text-ink-2 mb-4">
                    Weekly sets per muscle group (based on Dr. Mike Israetel&apos;s research)
                  </p>
                  <VolumeLandmarksCard
                    experience={experience}
                    volumeLandmarks={volumeLandmarks}
                    setVolumeLandmarks={setVolumeLandmarks}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Sticky Save Button with unsaved indicator */}
      <div className="sticky bottom-4 z-10">
        <div className="relative">
          {hasUnsavedChanges && !isSaving && (
            <div className="absolute -top-8 left-0 right-0 text-center">
              <span className="text-caption text-status-warn bg-card/95 px-3 py-1 rounded-full border border-status-warn/30">
                Unsaved changes
              </span>
            </div>
          )}
          <Button onClick={onSave} isLoading={isSaving} className="w-full shadow-lg">
            Save training changes
          </Button>
        </div>
      </div>
    </div>
  );
}
