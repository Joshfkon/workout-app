'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  MUSCLE_GROUPS,
  MUSCLE_PRIORITY_HEADS,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type MuscleGroup,
  type MusclePriorityLevel,
  type StandardMuscleGroup,
} from '@/types/schema';

/** A coarse group, or one of its prioritizable heads (side delts…). */
type PriorityKey = MuscleGroup | StandardMuscleGroup;

interface MusclePriorityData {
  muscleGroup: PriorityKey;
  priority: MusclePriorityLevel;
  reason?: string;
}

interface MusclePrioritySettingsProps {
  userId: string;
  onSave?: (priorities: MusclePriorityData[]) => void;
  className?: string;
}

const PRIORITY_LABELS: Record<MusclePriorityLevel, string> = {
  1: 'High priority',
  2: 'Focus',
  3: 'Normal',
  4: 'Maintenance',
  5: 'Low priority',
};

const PRIORITY_COLORS: Record<MusclePriorityLevel, string> = {
  1: 'bg-action',
  2: 'bg-action',
  3: 'bg-ink-3',
  4: 'bg-sep',
  5: 'bg-sep',
};

const PRIORITY_BADGE_VARIANTS: Record<MusclePriorityLevel, 'info' | 'default' | 'outline'> = {
  1: 'info',
  2: 'info',
  3: 'default',
  4: 'outline',
  5: 'outline',
};

// Group muscles by body region for better organization.
//
// Every MUSCLE_GROUPS member must appear exactly once here or it silently
// becomes un-prioritizable: state is seeded from MUSCLE_GROUPS but the form
// only renders what this map lists. Asserted in the component's test.
// 'erectors' sits under Core & Spine (matching STANDARD_MUSCLE_GROUPS_BY_REGION
// in lib/exercises/types.ts) rather than under Pull — it is loaded by hinges
// and squats, which is the whole reason it is no longer part of 'back'.
const MUSCLE_GROUPS_BY_REGION: Record<string, MuscleGroup[]> = {
  'Upper Body - Push': ['chest', 'shoulders', 'triceps'],
  'Upper Body - Pull': ['back', 'biceps', 'forearms', 'traps'],
  'Lower Body': ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'],
  'Core & Spine': ['abs', 'erectors'],
};

export function MusclePrioritySettings({
  userId,
  onSave,
  className = '',
}: MusclePrioritySettingsProps) {
  const [priorities, setPriorities] = useState<Map<PriorityKey, MusclePriorityData>>(new Map());
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

      const priorityMap = new Map<PriorityKey, MusclePriorityData>();

      // First, initialize all muscles (and their prioritizable heads) with
      // default priority (3)
      ALL_PRIORITY_KEYS.forEach((muscle) => {
        priorityMap.set(muscle, {
          muscleGroup: muscle,
          priority: 3,
        });
      });

      // Then override with saved priorities from database
      if (!error && data) {
        data.forEach((row: { muscle_group: PriorityKey; priority: MusclePriorityLevel; reason?: string }) => {
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

  const handlePriorityChange = useCallback((muscle: PriorityKey, priority: MusclePriorityLevel) => {
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
    const newMap = new Map<PriorityKey, MusclePriorityData>();
    ALL_PRIORITY_KEYS.forEach((muscle) => {
      newMap.set(muscle, {
        muscleGroup: muscle,
        priority: 3,
      });
    });
    setPriorities(newMap);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-8 text-center">
          <p className="text-ink-2">Loading priorities...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Muscle training priorities</span>
          {hasChanges && (
            <Badge variant="warning" size="sm">
              Unsaved changes
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Priority Legend */}
        <div className="flex flex-wrap gap-2 p-3 bg-fill/50 rounded-lg">
          <span className="text-caption text-ink-2 w-full mb-1">Priority levels:</span>
          {([1, 2, 3, 4, 5] as MusclePriorityLevel[]).map((level) => (
            <div key={level} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded ${PRIORITY_COLORS[level]}`} />
              <span className="text-caption text-ink-2">{PRIORITY_LABELS[level]}</span>
            </div>
          ))}
        </div>

        {/* Description */}
        <p className="text-body text-ink-2">
          Set your training priorities for each muscle group. Higher priority muscles will receive
          more volume in your generated programs. Use this to focus on weak points or aesthetic
          goals.
        </p>

        {/* Muscle Groups by Region */}
        {Object.entries(MUSCLE_GROUPS_BY_REGION).map(([region, muscles]) => (
          <section key={region}>
            <h3 className="text-body font-medium text-ink-2 mb-3">{region}</h3>
            <div className="space-y-2">
              {muscles.map((muscle) => {
                const heads = MUSCLE_PRIORITY_HEADS[muscle] ?? [];
                const headSet = heads.some((h) => (priorities.get(h)?.priority ?? 3) !== 3);
                return (
                  <div key={muscle} className="space-y-1">
                    <PriorityRow
                      muscle={muscle}
                      label={formatMuscleName(muscle)}
                      priority={priorities.get(muscle)?.priority || 3}
                      onChange={handlePriorityChange}
                    />
                    {/* Single heads (side delts, upper chest…): a bodybuilder
                        bringing up one head could only prioritize the group. */}
                    {heads.length > 0 && (
                      <details className="ml-4 group" open={headSet} data-testid={`priority-heads-${muscle}`}>
                        <summary className="cursor-pointer py-1 text-caption text-action">
                          Target one head ({heads.map((h) => STANDARD_MUSCLE_DISPLAY_NAMES[h]).join(', ')})
                        </summary>
                        <div className="mt-1 space-y-1">
                          {heads.map((head) => (
                            <PriorityRow
                              key={head}
                              muscle={head}
                              label={STANDARD_MUSCLE_DISPLAY_NAMES[head]}
                              priority={priorities.get(head)?.priority || 3}
                              onChange={handlePriorityChange}
                              compact
                            />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Summary */}
        <PrioritySummary priorities={priorities} />

        {/* Actions */}
        <div className="flex justify-between pt-4 border-t border-sep">
          <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
            Reset to default
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? 'Saving...' : 'Save priorities'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Every key the form can set: the coarse groups and their heads. */
const ALL_PRIORITY_KEYS: PriorityKey[] = [
  ...MUSCLE_GROUPS,
  ...Object.values(MUSCLE_PRIORITY_HEADS).flatMap((heads) => [...(heads ?? [])]),
];

/** "Side Delts" for a head, "Shoulders" for a group. */
function formatMuscleName(muscle: string): string {
  const head = STANDARD_MUSCLE_DISPLAY_NAMES[muscle as StandardMuscleGroup];
  if (head && !(MUSCLE_GROUPS as readonly string[]).includes(muscle)) return head;
  return muscle
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function PriorityRow({
  muscle,
  label,
  priority,
  onChange,
  compact = false,
}: {
  muscle: PriorityKey;
  label: string;
  priority: MusclePriorityLevel;
  onChange: (muscle: PriorityKey, priority: MusclePriorityLevel) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg sm:flex-row sm:items-center sm:justify-between ${
        compact ? 'p-2 bg-fill/30' : 'p-3 bg-fill/50'
      }`}
      data-testid={`priority-row-${muscle}`}
    >
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <div className="flex items-center gap-3">
          <div className={`w-2 ${compact ? 'h-6' : 'h-8'} rounded ${PRIORITY_COLORS[priority]}`} />
          <span className={`${compact ? 'text-subhead' : 'text-body'} font-medium text-ink`}>{label}</span>
        </div>

        {/* Current Priority Label (next to name on mobile) */}
        <Badge variant={PRIORITY_BADGE_VARIANTS[priority]} size="sm" className="justify-center sm:hidden">
          {PRIORITY_LABELS[priority]}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        {/* Priority Buttons */}
        <div className="flex gap-1">
          {([1, 2, 3, 4, 5] as MusclePriorityLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => onChange(muscle, level)}
              className={`w-8 h-8 rounded-lg text-caption font-medium transition-all ${
                priority === level ? `${PRIORITY_COLORS[level]} text-white` : 'bg-sep text-ink-2 hover:bg-sep'
              }`}
              title={PRIORITY_LABELS[level]}
              aria-label={`${label}: ${PRIORITY_LABELS[level]}`}
              aria-pressed={priority === level}
            >
              {level}
            </button>
          ))}
        </div>

        {/* Current Priority Label (inline on desktop) */}
        <Badge
          variant={PRIORITY_BADGE_VARIANTS[priority]}
          size="sm"
          className="hidden w-24 justify-center sm:inline-flex"
        >
          {PRIORITY_LABELS[priority]}
        </Badge>
      </div>
    </div>
  );
}

function PrioritySummary({ priorities }: { priorities: Map<PriorityKey, MusclePriorityData> }) {
  const highPriority = Array.from(priorities.values()).filter((p) => p.priority <= 2);
  const lowPriority = Array.from(priorities.values()).filter((p) => p.priority >= 4);

  if (highPriority.length === 0 && lowPriority.length === 0) {
    return (
      <div className="p-4 bg-fill/50 rounded-lg text-center">
        <p className="text-body text-ink-2">
          All muscles set to normal priority. Adjust above to customize your training focus.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-fill/50 rounded-lg space-y-3">
      <h4 className="text-body font-medium text-ink-2">Your training focus</h4>

      {highPriority.length > 0 && (
        <div>
          <span className="text-caption text-ink-2">Extra volume for: </span>
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
          <span className="text-caption text-ink-2">Maintenance volume for: </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {lowPriority.map((p) => (
              <Badge key={p.muscleGroup} variant="outline" size="sm">
                {formatMuscleName(p.muscleGroup)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-caption text-ink-3">
        High priority muscles get up to 20% more volume. A single head gets half that on its group, and
        its exercises lead the group&apos;s slot in each session. Low priority muscles get reduced volume.
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
          data.map((row: { muscle_group: PriorityKey; priority: MusclePriorityLevel; reason?: string }) => ({
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
