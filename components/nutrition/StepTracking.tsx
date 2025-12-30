'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@/components/ui';
import { saveManualSteps, getStepsForDate } from '@/lib/actions/steps';
import { getLocalDateString } from '@/lib/utils';
import { createUntypedClient } from '@/lib/supabase/client';

interface StepTrackingProps {
  date: string;
  userWeightKg: number;
}

export function StepTracking({ date, userWeightKg }: StepTrackingProps) {
  const [steps, setSteps] = useState<string>('');
  const [savedSteps, setSavedSteps] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const supabase = createUntypedClient();

  useEffect(() => {
    loadSteps();
  }, [date]);

  async function loadSteps() {
    setIsLoading(true);
    try {
      const currentSteps = await getStepsForDate(date);
      setSavedSteps(currentSteps);
      if (currentSteps !== null) {
        setSteps(String(currentSteps));
      }
    } catch (error) {
      console.error('Failed to load steps:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave() {
    const stepsNum = parseInt(steps, 10);
    if (isNaN(stepsNum) || stepsNum < 0) {
      alert('Please enter a valid number of steps');
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveManualSteps(date, stepsNum, userWeightKg);
      if (result.success) {
        setSavedSteps(stepsNum);
        // Show success feedback
        const input = document.getElementById('steps-input') as HTMLInputElement;
        if (input) {
          input.classList.add('border-success-500');
          setTimeout(() => {
            input.classList.remove('border-success-500');
          }, 1000);
        }
      } else {
        alert(result.error || 'Failed to save steps');
      }
    } catch (error) {
      console.error('Failed to save steps:', error);
      alert('Failed to save steps');
    } finally {
      setIsSaving(false);
    }
  }

  // Only calculate on client to prevent hydration mismatch
  const isClient = typeof window !== 'undefined';
  const isToday = isClient && date === getLocalDateString(new Date());
  const displayDate = isToday 
    ? 'Today' 
    : isClient
      ? new Date(date).toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric' 
        })
      : date; // Fallback for SSR

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>👣</span>
          <span>Step Tracking</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div>
            <label htmlFor="steps-input" className="block text-sm font-medium text-surface-300 mb-1.5">
              Steps for {displayDate}
            </label>
            <div className="flex gap-2">
              <Input
                id="steps-input"
                type="number"
                min="0"
                placeholder="Enter steps"
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSave();
                  }
                }}
                className="flex-1"
                disabled={isLoading || isSaving}
              />
              <Button
                onClick={handleSave}
                disabled={isLoading || isSaving || !steps}
                variant="primary"
                size="sm"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
          
          {savedSteps !== null && (
            <div className="text-sm text-surface-400">
              Saved: <span className="font-medium text-surface-200">{savedSteps.toLocaleString()}</span> steps
            </div>
          )}

          {isToday && savedSteps === null && (
            <p className="text-xs text-surface-500">
              Log your steps to improve TDEE accuracy
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

