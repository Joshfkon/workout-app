'use client';

import { useState } from 'react';
import { Button, Card, Badge } from '@/components/ui';
import type { WorkoutSession, SetLog, ExerciseBlock } from '@/types/schema';
import { formatDuration } from '@/lib/utils';

interface SessionSummaryProps {
  session: WorkoutSession;
  exerciseBlocks: ExerciseBlock[];
  allSets: SetLog[];
  onSubmit: (data: {
    sessionRpe: number;
    pumpRating: number;
    notes: string;
  }) => void;
}

export function SessionSummary({
  session,
  exerciseBlocks,
  allSets,
  onSubmit,
}: SessionSummaryProps) {
  const [sessionRpe, setSessionRpe] = useState(7);
  const [pumpRating, setPumpRating] = useState(3);
  const [notes, setNotes] = useState('');

  // Calculate stats
  const workingSets = allSets.filter((s) => !s.isWarmup);
  const totalSets = workingSets.length;
  const totalReps = workingSets.reduce((sum, s) => sum + s.reps, 0);
  const totalVolume = workingSets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
  const avgRpe = totalSets > 0
    ? Math.round((workingSets.reduce((sum, s) => sum + s.rpe, 0) / totalSets) * 10) / 10
    : 0;

  // Duration
  const duration = session.startedAt
    ? Math.floor(
        (Date.now() - new Date(session.startedAt).getTime()) / 1000
      )
    : 0;

  // Set quality breakdown
  const qualityBreakdown = workingSets.reduce(
    (acc, set) => {
      acc[set.quality] = (acc[set.quality] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const handleSubmit = () => {
    onSubmit({
      sessionRpe,
      pumpRating,
      notes,
    });
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-surface-100">
          Workout Complete!
        </h2>
        <p className="text-surface-400 mt-1">
          Great job finishing your session
        </p>
      </div>

      {/* Stats Grid */}
      <Card>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-400">{totalSets}</p>
            <p className="text-xs text-surface-500">Working Sets</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-400">{totalReps}</p>
            <p className="text-xs text-surface-500">Total Reps</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-400">
              {Math.round(totalVolume / 1000 * 10) / 10}k
            </p>
            <p className="text-xs text-surface-500">Volume (kg)</p>
          </div>
          <div className="text-center p-3 bg-surface-800/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-400">
              {formatDuration(duration)}
            </p>
            <p className="text-xs text-surface-500">Duration</p>
          </div>
        </div>

        {/* Quality breakdown */}
        {totalSets > 0 && (
          <div className="mt-4 pt-4 border-t border-surface-800">
            <p className="text-sm text-surface-400 mb-2">Set Quality</p>
            <div className="flex gap-2 flex-wrap">
              {qualityBreakdown.stimulative && (
                <Badge variant="success">
                  {qualityBreakdown.stimulative} Stimulative
                </Badge>
              )}
              {qualityBreakdown.effective && (
                <Badge variant="info">
                  {qualityBreakdown.effective} Effective
                </Badge>
              )}
              {qualityBreakdown.junk && (
                <Badge variant="default">
                  {qualityBreakdown.junk} Junk
                </Badge>
              )}
              {qualityBreakdown.excessive && (
                <Badge variant="danger">
                  {qualityBreakdown.excessive} Excessive
                </Badge>
              )}
            </div>
            <p className="text-xs text-surface-500 mt-2">
              Avg RPE: {avgRpe}
            </p>
          </div>
        )}
      </Card>

      {/* Session RPE */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3">
          How hard was this session?
        </h3>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rpe) => (
            <button
              key={rpe}
              onClick={() => setSessionRpe(rpe)}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                sessionRpe === rpe
                  ? rpe >= 9
                    ? 'bg-danger-500 text-white'
                    : rpe >= 7
                    ? 'bg-warning-500 text-white'
                    : 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
              }`}
            >
              {rpe}
            </button>
          ))}
        </div>
        <p className="text-xs text-surface-500 mt-2 text-center">
          Session RPE (1 = Very Easy, 10 = Maximum Effort)
        </p>
      </Card>

      {/* Pump Rating */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3">
          How was the pump/mind-muscle connection?
        </h3>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              key={rating}
              onClick={() => setPumpRating(rating)}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                pumpRating === rating
                  ? 'bg-accent-500 text-white'
                  : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
              }`}
            >
              {rating === 1 && '😐'}
              {rating === 2 && '🙂'}
              {rating === 3 && '😊'}
              {rating === 4 && '😄'}
              {rating === 5 && '🔥'}
            </button>
          ))}
        </div>
        <p className="text-xs text-surface-500 mt-2 text-center">
          1 = Poor Connection, 5 = Incredible Pump
        </p>
      </Card>

      {/* Notes */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3">
          Session Notes (optional)
        </h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="How did you feel? Any issues? Wins to celebrate?"
          rows={3}
          className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-surface-200 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
        />
      </Card>

      {/* Submit */}
      <Button onClick={handleSubmit} size="lg" className="w-full">
        Save & Finish
      </Button>
    </div>
  );
}

