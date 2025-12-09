'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Button, Badge } from '@/components/ui';
import { ExerciseCard, SetInputRow, RestTimer, WarmupProtocol, ReadinessCheckIn, SessionSummary } from '@/components/workout';
import type { Exercise, ExerciseBlock, SetLog, WarmupSet } from '@/types/schema';

// Mock data - in real app, this would come from database
const mockExercise: Exercise = {
  id: '1',
  name: 'Barbell Bench Press',
  primaryMuscle: 'chest',
  secondaryMuscles: ['triceps', 'shoulders'],
  mechanic: 'compound',
  defaultRepRange: [6, 10],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  formCues: [
    'Arch upper back, not lower',
    'Tuck elbows 45 degrees',
    'Touch mid-chest',
    'Drive feet into floor',
  ],
  commonMistakes: [
    'Bouncing bar off chest',
    'Flaring elbows 90 degrees',
    'Lifting hips off bench',
  ],
  setupNote: 'Set up with eyes under bar, grip slightly wider than shoulders',
  movementPattern: 'horizontal_push',
  equipmentRequired: ['barbell', 'bench'],
};

const mockBlock: ExerciseBlock = {
  id: '1',
  workoutSessionId: '1',
  exerciseId: '1',
  order: 1,
  supersetGroupId: null,
  supersetOrder: null,
  targetSets: 4,
  targetRepRange: [6, 10],
  targetRir: 2,
  targetWeightKg: 80,
  targetRestSeconds: 180,
  progressionType: 'load',
  suggestionReason: 'Weight increased by 2.5kg based on hitting 10 reps last session',
  warmupProtocol: [
    { setNumber: 1, percentOfWorking: 0, targetReps: 10, purpose: 'General warmup' },
    { setNumber: 2, percentOfWorking: 50, targetReps: 8, purpose: 'Movement groove' },
    { setNumber: 3, percentOfWorking: 70, targetReps: 5, purpose: 'Neuromuscular preparation' },
    { setNumber: 4, percentOfWorking: 85, targetReps: 3, purpose: 'CNS potentiation' },
  ],
  note: null,
};

type WorkoutPhase = 'checkin' | 'workout' | 'summary';

export default function WorkoutPage() {
  const params = useParams();
  const [phase, setPhase] = useState<WorkoutPhase>('checkin');
  const [completedSets, setCompletedSets] = useState<SetLog[]>([]);
  const [currentSetNumber, setCurrentSetNumber] = useState(1);
  const [showRestTimer, setShowRestTimer] = useState(false);

  const handleCheckInComplete = () => {
    setPhase('workout');
  };

  const handleSetComplete = (data: { weightKg: number; reps: number; rpe: number; note?: string }) => {
    const newSet: SetLog = {
      id: `set-${Date.now()}`,
      exerciseBlockId: mockBlock.id,
      setNumber: currentSetNumber,
      weightKg: data.weightKg,
      reps: data.reps,
      rpe: data.rpe,
      restSeconds: null,
      isWarmup: false,
      quality: data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective',
      qualityReason: '',
      note: data.note || null,
      loggedAt: new Date().toISOString(),
    };

    setCompletedSets([...completedSets, newSet]);
    setCurrentSetNumber(currentSetNumber + 1);
    setShowRestTimer(true);
  };

  const handleWorkoutComplete = () => {
    setPhase('summary');
  };

  const handleSummarySubmit = (data: { sessionRpe: number; pumpRating: number; notes: string }) => {
    // In real app, save to database
    console.log('Session completed:', data);
    // Redirect to history or dashboard
  };

  if (phase === 'checkin') {
    return (
      <div className="max-w-lg mx-auto py-8">
        <ReadinessCheckIn
          onSubmit={handleCheckInComplete}
          onSkip={handleCheckInComplete}
        />
      </div>
    );
  }

  if (phase === 'summary') {
    return (
      <div className="py-8">
        <SessionSummary
          session={{
            id: '1',
            userId: '1',
            mesocycleId: null,
            state: 'completed',
            plannedDate: new Date().toISOString().split('T')[0],
            startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            completedAt: new Date().toISOString(),
            preWorkoutCheckIn: null,
            sessionRpe: null,
            pumpRating: null,
            sessionNotes: null,
            completionPercent: 100,
          }}
          exerciseBlocks={[mockBlock]}
          allSets={completedSets}
          onSubmit={handleSummarySubmit}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Workout header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Push Day</h1>
          <p className="text-surface-400">Week 3 • Day 1</p>
        </div>
        <Button variant="outline" onClick={handleWorkoutComplete}>
          Finish Workout
        </Button>
      </div>

      {/* Progress bar */}
      <div className="bg-surface-800 rounded-full h-2 overflow-hidden">
        <div
          className="bg-primary-500 h-full transition-all duration-300"
          style={{ width: `${(completedSets.length / mockBlock.targetSets) * 100}%` }}
        />
      </div>

      {/* Rest timer */}
      {showRestTimer && (
        <div className="animate-slide-down">
          <RestTimer
            defaultSeconds={mockBlock.targetRestSeconds}
            autoStart
            onComplete={() => setShowRestTimer(false)}
          />
        </div>
      )}

      {/* Warmup protocol */}
      <WarmupProtocol
        warmupSets={mockBlock.warmupProtocol}
        workingWeight={mockBlock.targetWeightKg}
        minIncrement={mockExercise.minWeightIncrementKg}
      />

      {/* Exercise card */}
      <ExerciseCard
        exercise={mockExercise}
        block={mockBlock}
        sets={completedSets}
        isActive
      />

      {/* Set input */}
      {completedSets.length < mockBlock.targetSets && (
        <SetInputRow
          setNumber={currentSetNumber}
          targetWeight={mockBlock.targetWeightKg}
          targetRepRange={mockBlock.targetRepRange}
          targetRir={mockBlock.targetRir}
          previousSet={completedSets[completedSets.length - 1]}
          isLastSet={currentSetNumber === mockBlock.targetSets}
          onSubmit={handleSetComplete}
        />
      )}

      {/* All sets completed */}
      {completedSets.length >= mockBlock.targetSets && (
        <Card className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-medium text-surface-200">Exercise Complete!</p>
          <p className="text-surface-500 mt-1">Move to next exercise or finish workout</p>
          <div className="flex justify-center gap-3 mt-4">
            <Button variant="secondary">Next Exercise</Button>
            <Button onClick={handleWorkoutComplete}>Finish Workout</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

