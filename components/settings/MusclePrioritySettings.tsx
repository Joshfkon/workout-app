'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS, type MuscleGroup, type MusclePriorityLevel } from '@/types/schema';

interface MusclePriorityData {
  muscleGroup: MuscleGroup;
  priority: MusclePriorityLevel;
  reason?: string;
}

interface MusclePrioritySettingsProps {
  userId: string;
  onSave?: (priorities: MusclePriorityData[]) => void;
  className?: string;
}

const PRIORITY_LABELS: Record<MusclePriorityLevel, string> = {
  1: 'High Priority',
  2: 'Focus',
  3: 'Normal',
  4: 'Maintenance',
  5: 'Low Priority',
};

const PRIORITY_COLORS: Record<MusclePriorityLevel, string> = {
  1: 'bg-primary-500',
  2: 'bg-primary-400',
  3: 'bg-surface-500',
  4: 'bg-surface-600',
  5: 'bg-surface-700',
};

const PRIORITY_BADGE_VARIANTS: Record<MusclePriorityLevel, 'info' | 'default' | 'outline'> = {
  1: 'info',
  2: 'info',
  3: 'default',
  4: 'outline',
  5: 'outline',
};

// Group muscles by body region for better organization
const MUSCLE_GROUPS_BY_REGION: Record<string, MuscleGroup[]> = {
  'Upper Body - Push': ['chest', 'shoulders', 'triceps'],
  'Upper Body - Pull': ['back', 'biceps', 'forearms', 'traps'],
  'Lower Body': ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'],
  'Core': ['abs'],
};

export function MusclePrioritySettings({
  userId,
  onSave,
  className = '',
}: MusclePrioritySettingsProps) {
  const [priorities, setPriorities] = useState<Map<MuscleGroup, MusclePriorityData>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load existing priorities
  useEffect(() => {
    const loadPriorities = async () => {
      setIsLoading(true);
      const supabase = createUntypedClient();

      const { data, error } = await supabase
        .from('user_muscle_priorities')
        .select('*')
        .eq('user_id', userId);

      const priorityMap = new Map<MuscleGroup, MusclePriorityData>();

      // First, initialize all muscles with default priority (3)
      MUSCLE_GROUPS.forEach((muscle) => {
        priorityMap.set(muscle, {
          muscleGroup: muscle,
          priority: 3,
        });
      });

      // Then override with saved priorities from database
      if (!error && data) {
        data.forEach((row: { muscle_group: MuscleGroup; priority: MusclePriorityLevel; reason?: string }) => {
          priorityMap.set(row.muscle_group, {
            muscleGroup: row.muscle_group,
            priority: row.priority,
            reason: row.reason,
          });
        });
      }

      setPriorities(priorityMap);
      setIsLoading(false);
    };

    loadPriorities();
  }, [userId]);

  const handlePriorityChange = useCallback((muscle: MuscleGroup, priority: MusclePriorityLevel) => {
    setPriorities((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(muscle);
      newMap.set(muscle, {
        muscleGroup: muscle,
        priority,
        reason: existing?.reason,
      });
      return newMap;
    });
    setHasChanges(true);
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    const supabase = createUntypedClient();

    // Only save priorities that are not the default (3)
    const prioritiesToSave = Array.from(priorities.values()).filter(
      (p) => p.priority !== 3
    );

    // Delete all existing priorities for this user first
    await supabase
      .from('user_muscle_priorities')
      .delete()
      .eq('user_id', userId);

    // Insert new priorities
    if (prioritiesToSave.length > 0) {
      const { error } = await supabase
        .from('user_muscle_priorities')
        .upsert(
          prioritiesToSave.map((p) => ({
            user_id: userId,
            muscle_group: p.muscleGroup,
            priority: p.priority,
            reason: p.reason,
          })),
          { onConflict: 'user_id,muscle_group' }
        );

      if (error) {
        console.error('Error saving muscle priorities:', error);
      }
    }

    setHasChanges(false);
    setIsSaving(false);

    if (onSave) {
      onSave(Array.from(priorities.values()));
    }
  };

  const handleReset = () => {
    const newMap = new Map<MuscleGroup, MusclePriorityData>();
    MUSCLE_GROUPS.forEach((muscle) => {
      newMap.set(muscle, {
        muscleGroup: muscle,
        priority: 3,
      });
    });
    setPriorities(newMap);
    setHasChanges(true);
  };

  const formatMuscleName = (muscle: string) => {
    return muscle
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-8 text-center">
          <p className="text-surface-400">Loading priorities...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Muscle Training Priorities</span>
          {hasChanges && (
            <Badge variant="warning" size="sm">
              Unsaved changes
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Priority Legend */}
        <div className="flex flex-wrap gap-2 p-3 bg-surface-800/50 rounded-lg">
          <span className="text-xs text-surface-400 w-full mb-1">Priority Levels:</span>
          {([1, 2, 3, 4, 5] as MusclePriorityLevel[]).map((level) => (
            <div key={level} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded ${PRIORITY_COLORS[level]}`} />
              <span className="text-xs text-surface-400">{PRIORITY_LABELS[level]}</span>
            </div>
          ))}
        </div>

        {/* Description */}
        <p className="text-sm text-surface-400">
          Set your training priorities for each muscle group. Higher priority muscles will receive
          more volume in your generated programs. Use this to focus on weak points or aesthetic
          goals.
        </p>

        {/* Muscle Groups by Region */}
        {Object.entries(MUSCLE_GROUPS_BY_REGION).map(([region, muscles]) => (
          <section key={region}>
            <h3 className="text-sm font-medium text-surface-300 mb-3">{region}</h3>
            <div className="space-y-2">
              {muscles.map((muscle) => {
                const priorityData = priorities.get(muscle);
                const priority = priorityData?.priority || 3;

                return (
                  <div
                    key={muscle}
                    className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-8 rounded ${PRIORITY_COLORS[priority]}`} />
                      <span className="text-sm font-medium text-surface-200">
                        {formatMuscleName(muscle)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Priority Buttons */}
                      <div className="flex gap-1">
                        {([1, 2, 3, 4, 5] as MusclePriorityLevel[]).map((level) => (
                          <button
                            key={level}
                            onClick={() => handlePriorityChange(muscle, level)}
                            className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                              priority === level
                                ? `${PRIORITY_COLORS[level]} text-white`
                                : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
                            }`}
                            title={PRIORITY_LABELS[level]}
                          >
                            {level}
                          </button>
                        ))}
                      </div>

                      {/* Current Priority Label */}
                      <Badge
                        variant={PRIORITY_BADGE_VARIANTS[priority]}
                        size="sm"
                        className="w-24 justify-center"
                      >
                        {PRIORITY_LABELS[priority]}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Summary */}
        <PrioritySummary priorities={priorities} />

        {/* Actions */}
        <div className="flex justify-between pt-4 border-t border-surface-700">
          <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
            Reset to Default
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? 'Saving...' : 'Save Priorities'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PrioritySummary({ priorities }: { priorities: Map<MuscleGroup, MusclePriorityData> }) {
  const highPriority = Array.from(priorities.values()).filter((p) => p.priority <= 2);
  const lowPriority = Array.from(priorities.values()).filter((p) => p.priority >= 4);

  if (highPriority.length === 0 && lowPriority.length === 0) {
    return (
      <div className="p-4 bg-surface-800/50 rounded-lg text-center">
        <p className="text-sm text-surface-400">
          All muscles set to normal priority. Adjust above to customize your training focus.
        </p>
      </div>
    );
  }

  const formatMuscleName = (muscle: string) =>
    muscle
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  return (
    <div className="p-4 bg-surface-800/50 rounded-lg space-y-3">
      <h4 className="text-sm font-medium text-surface-300">Your Training Focus</h4>

      {highPriority.length > 0 && (
        <div>
          <span className="text-xs text-surface-400">Extra volume for: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {highPriority.map((p) => (
              <Badge key={p.muscleGroup} variant="info" size="sm">
                {formatMuscleName(p.muscleGroup)}
                {p.priority === 1 && ' ++'}
                {p.priority === 2 && ' +'}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {lowPriority.length > 0 && (
        <div>
          <span className="text-xs text-surface-400">Maintenance volume for: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {lowPriority.map((p) => (
              <Badge key={p.muscleGroup} variant="outline" size="sm">
                {formatMuscleName(p.muscleGroup)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-surface-500">
        High priority muscles get up to 20% more volume. Low priority muscles get reduced volume.
      </p>
    </div>
  );
}

// Hook to fetch muscle priorities for use in other components
export function useMusclePriorities(userId: string) {
  const [priorities, setPriorities] = useState<MusclePriorityData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadPriorities = async () => {
      const supabase = createUntypedClient();

      const { data, error } = await supabase
        .from('user_muscle_priorities')
        .select('*')
        .eq('user_id', userId);

      if (!error && data) {
        setPriorities(
          data.map((row: { muscle_group: MuscleGroup; priority: MusclePriorityLevel; reason?: string }) => ({
            muscleGroup: row.muscle_group,
            priority: row.priority,
            reason: row.reason,
          }))
        );
      }

      setIsLoading(false);
    };

    loadPriorities();
  }, [userId]);

  return { priorities, isLoading };
}
