'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, Input, Select, Slider } from '@/components/ui';

export default function NewMesocyclePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [splitType, setSplitType] = useState('PPL');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [totalWeeks, setTotalWeeks] = useState(6);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    setIsLoading(true);
    // In real app, save to database
    await new Promise((r) => setTimeout(r, 1000));
    router.push('/dashboard/mesocycle');
  };

  const splitOptions = [
    { value: 'PPL', label: 'Push/Pull/Legs' },
    { value: 'Upper/Lower', label: 'Upper/Lower' },
    { value: 'Full Body', label: 'Full Body' },
    { value: 'Bro Split', label: 'Bro Split (5-day)' },
    { value: 'Custom', label: 'Custom Split' },
  ];

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Create Mesocycle</h1>
        <p className="text-surface-400 mt-1">
          Set up your training block ({step}/3)
        </p>
      </div>

      {/* Progress steps */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex-1 h-1 rounded-full ${
              s <= step ? 'bg-primary-500' : 'bg-surface-700'
            }`}
          />
        ))}
      </div>

      <Card variant="elevated">
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-surface-100">Basic Info</h2>
              <p className="text-sm text-surface-400">Name your mesocycle and choose a split</p>
            </div>

            <Input
              label="Mesocycle Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Hypertrophy Block 1"
            />

            <Select
              label="Training Split"
              value={splitType}
              onChange={(e) => setSplitType(e.target.value)}
              options={splitOptions}
            />

            <div className="pt-4 flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!name}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-surface-100">Schedule</h2>
              <p className="text-sm text-surface-400">Configure your training frequency</p>
            </div>

            <Slider
              label="Training Days per Week"
              min={2}
              max={6}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(parseInt(e.target.value))}
              valueFormatter={(v) => `${v} days`}
              marks={[
                { value: 2, label: '2' },
                { value: 3, label: '3' },
                { value: 4, label: '4' },
                { value: 5, label: '5' },
                { value: 6, label: '6' },
              ]}
            />

            <Slider
              label="Mesocycle Length"
              min={4}
              max={8}
              value={totalWeeks}
              onChange={(e) => setTotalWeeks(parseInt(e.target.value))}
              valueFormatter={(v) => `${v} weeks`}
              marks={[
                { value: 4, label: '4' },
                { value: 5, label: '5' },
                { value: 6, label: '6' },
                { value: 7, label: '7' },
                { value: 8, label: '8' },
              ]}
            />

            <div className="p-4 bg-surface-800/50 rounded-lg">
              <p className="text-sm text-surface-400">
                Week {totalWeeks} will automatically be a deload week with reduced volume.
              </p>
            </div>

            <div className="pt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-surface-100">Review</h2>
              <p className="text-sm text-surface-400">Confirm your mesocycle settings</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Name</span>
                <span className="text-surface-200 font-medium">{name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Split</span>
                <span className="text-surface-200 font-medium">{splitType}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Frequency</span>
                <span className="text-surface-200 font-medium">{daysPerWeek} days/week</span>
              </div>
              <div className="flex justify-between py-2 border-b border-surface-800">
                <span className="text-surface-400">Duration</span>
                <span className="text-surface-200 font-medium">{totalWeeks} weeks</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-surface-400">Deload Week</span>
                <span className="text-surface-200 font-medium">Week {totalWeeks}</span>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={handleSubmit} isLoading={isLoading}>
                Create Mesocycle
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

