'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import type { CardioModality } from '@/lib/nutrition/macroCalculator';

interface CardioTrackerProps {
  userId: string;
  prescription?: {
    prescribedMinutesPerDay: number;
    modality?: CardioModality;
    summary?: string;
    prescribedMinutesPerWeek?: number;
    shortfallKcalPerDay?: number;
    withCardioWeeklyLossLbs?: number;
    hitCap?: boolean;
    capMinutesPerDay?: number;
    whyCardioNotDiet?: string;
  };
}

interface CardioLogEntry {
  id: string;
  logged_at: string;
  minutes: number;
  modality: string;
  notes?: string;
}

// Memoized options to prevent re-creation on each render
const CARDIO_OPTIONS = [
  { value: 'incline_walk', label: 'Incline Walk' },
  { value: 'bike', label: 'Bike' },
  { value: 'elliptical', label: 'Elliptical' },
  { value: 'rower', label: 'Rower' },
  { value: 'other', label: 'Other' },
];

export const CardioTracker = memo(function CardioTracker({ userId, prescription }: CardioTrackerProps) {
  const [todayTotal, setTodayTotal] = useState(0);
  const [todayLogs, setTodayLogs] = useState<CardioLogEntry[]>([]);
  const [isLogging, setIsLogging] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [modality, setModality] = useState<CardioModality>('incline_walk');
  const [notes, setNotes] = useState('');

  const supabase = createUntypedClient();

  const loadTodayData = useCallback(async () => {
    const today = getLocalDateString();

    const { data: cardioLogs } = await supabase
      .from('cardio_log')
      .select('id, logged_at, minutes, modality, notes')
      .eq('user_id', userId)
      .eq('logged_at', today)
      .order('created_at', { ascending: false });

    if (cardioLogs) {
      setTodayLogs(cardioLogs as CardioLogEntry[]);
      const total = cardioLogs.reduce((sum: number, entry: any) => sum + (entry.minutes || 0), 0);
      setTodayTotal(total);
    }
  }, [supabase, userId]);

  useEffect(() => {
    loadTodayData();
  }, [loadTodayData]);

  const logCardio = useCallback(async () => {
    const minutesNum = parseInt(minutes);
    if (!minutesNum || minutesNum <= 0) return;

    setIsLogging(true);
    const today = getLocalDateString();

    try {
      const { error } = await supabase.from('cardio_log').insert({
        user_id: userId,
        logged_at: today,
        minutes: minutesNum,
        modality: modality,
        notes: notes || null,
      });

      if (error) throw error;

      // Reload data
      await loadTodayData();
      setShowLogForm(false);
      setMinutes('');
      setNotes('');
      setModality(prescription?.modality || 'incline_walk');
    } catch (error) {
      console.error('Failed to log cardio:', error);
    } finally {
      setIsLogging(false);
    }
  }, [minutes, modality, notes, prescription?.modality, supabase, userId, loadTodayData]);

  const deleteLog = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('cardio_log')
      .delete()
      .eq('id', id);

    if (!error) {
      await loadTodayData();
    }
  }, [supabase, loadTodayData]);

  const handleMinutesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMinutes(e.target.value);
  }, []);

  const handleModalityChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setModality(e.target.value as CardioModality);
  }, []);

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setNotes(e.target.value);
  }, []);

  const handleShowLogForm = useCallback(() => setShowLogForm(true), []);

  const handleCancelLogForm = useCallback(() => {
    setShowLogForm(false);
    setMinutes('');
    setNotes('');
  }, []);

  const targetMinutes = prescription?.prescribedMinutesPerDay || 0;
  const percentage = useMemo(() =>
    targetMinutes > 0 ? Math.min(100, Math.round((todayTotal / targetMinutes) * 100)) : 0
  , [targetMinutes, todayTotal]);
  const remaining = useMemo(() => Math.max(0, targetMinutes - todayTotal), [targetMinutes, todayTotal]);

  return (
    <div className="space-y-3">
      {/* Prescription Info */}
      {prescription && (
        <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
          {prescription.summary && (
            <p className="text-sm text-primary-300 mb-3">
              {prescription.summary}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
            <div>
              <span className="text-surface-400">Target:</span>
              <span className="ml-2 font-semibold text-surface-200">
                {prescription.prescribedMinutesPerDay} min/day
              </span>
            </div>
            <div>
              <span className="text-surface-400">Today:</span>
              <span className="ml-2 font-semibold text-surface-200">
                {todayTotal} min
              </span>
            </div>
            {prescription.prescribedMinutesPerWeek && (
              <div>
                <span className="text-surface-400">Minutes/Week:</span>
                <span className="ml-2 font-semibold text-surface-200">
                  {prescription.prescribedMinutesPerWeek}
                </span>
              </div>
            )}
            {prescription.shortfallKcalPerDay && (
              <div>
                <span className="text-surface-400">Kcal/Day:</span>
                <span className="ml-2 font-semibold text-surface-200">
                  ~{prescription.shortfallKcalPerDay}
                </span>
              </div>
            )}
          </div>
          {targetMinutes > 0 && (
            <div className="space-y-1 mb-3">
              <div className="flex justify-between text-xs">
                <span className="text-surface-400">Progress</span>
                <span className={percentage >= 100 ? 'text-success-400' : 'text-surface-400'}>
                  {percentage}%
                </span>
              </div>
              <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    percentage >= 100
                      ? 'bg-success-500'
                      : percentage >= 75
                      ? 'bg-primary-500'
                      : percentage >= 50
                      ? 'bg-warning-500'
                      : 'bg-danger-500'
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              {remaining > 0 && (
                <p className="text-xs text-surface-500 mt-1">
                  {remaining} minutes remaining
                </p>
              )}
            </div>
          )}
          {prescription.hitCap && prescription.capMinutesPerDay && (
            <div className="mt-2 p-2 bg-warning-500/10 border border-warning-500/20 rounded text-xs text-warning-300">
              ⚠️ Cardio capped at {prescription.capMinutesPerDay} min/day
            </div>
          )}
          {prescription.whyCardioNotDiet && (
            <div className="mt-3 p-2 bg-surface-900/50 rounded text-xs text-surface-400">
              <strong className="text-surface-300">Why cardio ≠ eating less:</strong>{' '}
              {prescription.whyCardioNotDiet}
            </div>
          )}
        </div>
      )}

      {/* Today's Logs */}
      {todayLogs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Today&apos;s Sessions</p>
          {todayLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between p-2 bg-surface-800/50 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-surface-200">{log.minutes} min</span>
                <span className="text-xs text-surface-400 capitalize">
                  {log.modality.replace('_', ' ')}
                </span>
                {log.notes && (
                  <span className="text-xs text-surface-500">• {log.notes}</span>
                )}
              </div>
              <button
                onClick={() => deleteLog(log.id)}
                className="p-1 text-surface-500 hover:text-danger-400 transition-colors"
                aria-label="Delete cardio log"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Log Form */}
      {showLogForm ? (
        <div className="space-y-3 p-3 bg-surface-800/50 border border-surface-700 rounded-lg">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-300 mb-1">
                Minutes
              </label>
              <Input
                type="number"
                value={minutes}
                onChange={handleMinutesChange}
                placeholder="30"
                min="1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-300 mb-1">
                Type
              </label>
              <Select
                value={modality}
                onChange={handleModalityChange}
                options={CARDIO_OPTIONS}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-300 mb-1">
              Notes (optional)
            </label>
            <Input
              type="text"
              value={notes}
              onChange={handleNotesChange}
              placeholder="e.g., Zone 2, felt good"
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={logCardio}
              disabled={isLogging || !minutes || parseInt(minutes) <= 0}
              variant="primary"
              size="sm"
              className="flex-1"
            >
              {isLogging ? 'Logging...' : 'Log Cardio'}
            </Button>
            <Button
              onClick={handleCancelLogForm}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={handleShowLogForm}
          variant="outline"
          size="sm"
          className="w-full"
        >
          + Log Cardio Session
        </Button>
      )}
    </div>
  );
});

