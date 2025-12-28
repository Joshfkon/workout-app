'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Button, Input, Select } from '@/components/ui';
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
  const [showInfo, setShowInfo] = useState(false);
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

  const toggleInfo = useCallback(() => setShowInfo(prev => !prev), []);

  const targetMinutes = prescription?.prescribedMinutesPerDay || 0;
  const percentage = useMemo(() =>
    targetMinutes > 0 ? Math.min(100, Math.round((todayTotal / targetMinutes) * 100)) : 0
  , [targetMinutes, todayTotal]);

  return (
    <div className="space-y-3">
      {/* Compact Header with Progress and Info Button */}
      {prescription && targetMinutes > 0 && (
        <div className="relative">
          {/* Info Button */}
          <button
            onClick={toggleInfo}
            className="absolute -top-1 -right-1 p-1.5 text-surface-400 hover:text-primary-400 hover:bg-surface-800 rounded-full transition-colors"
            aria-label={showInfo ? 'Hide details' : 'Show details'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Compact Progress View */}
          <div className="flex items-center gap-3 pr-8">
            <div className="flex-1">
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
            </div>
            <span className="text-xs font-medium text-surface-300 whitespace-nowrap">
              {todayTotal}/{targetMinutes} min
            </span>
          </div>

          {/* Expandable Details */}
          {showInfo && (
            <div className="mt-3 p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
              {prescription.summary && (
                <p className="text-sm text-primary-300 mb-3">
                  {prescription.summary}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-surface-400">Target:</span>
                  <span className="ml-1 font-semibold text-surface-200">
                    {prescription.prescribedMinutesPerDay} min/day
                  </span>
                </div>
                {prescription.prescribedMinutesPerWeek && (
                  <div>
                    <span className="text-surface-400">Weekly:</span>
                    <span className="ml-1 font-semibold text-surface-200">
                      {prescription.prescribedMinutesPerWeek} min
                    </span>
                  </div>
                )}
                {prescription.shortfallKcalPerDay && (
                  <div>
                    <span className="text-surface-400">Burns:</span>
                    <span className="ml-1 font-semibold text-surface-200">
                      ~{prescription.shortfallKcalPerDay} kcal/day
                    </span>
                  </div>
                )}
              </div>
              {prescription.hitCap && prescription.capMinutesPerDay && (
                <div className="mt-2 p-2 bg-warning-500/10 border border-warning-500/20 rounded text-xs text-warning-300">
                  Cardio capped at {prescription.capMinutesPerDay} min/day
                </div>
              )}
              {prescription.whyCardioNotDiet && (
                <div className="mt-3 p-2 bg-surface-900/50 rounded text-xs text-surface-400">
                  <strong className="text-surface-300">Why cardio helps:</strong>{' '}
                  {prescription.whyCardioNotDiet}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Today's Logs - Compact */}
      {todayLogs.length > 0 && (
        <div className="space-y-1">
          {todayLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between py-1 px-2 bg-surface-800/30 rounded"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-surface-200">{log.minutes} min</span>
                <span className="text-surface-500 capitalize">
                  {log.modality.replace('_', ' ')}
                </span>
              </div>
              <button
                onClick={() => deleteLog(log.id)}
                className="p-0.5 text-surface-600 hover:text-danger-400 transition-colors"
                aria-label="Delete cardio log"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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

