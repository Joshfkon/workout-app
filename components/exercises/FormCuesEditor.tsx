'use client';

/**
 * Form Cues Editor
 *
 * Allows adding, editing, and removing form cues for an exercise.
 */

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

interface FormCuesEditorProps {
  cues: string[];
  onChange: (cues: string[]) => void;
  maxCues?: number;
}

export function FormCuesEditor({
  cues,
  onChange,
  maxCues = 5,
}: FormCuesEditorProps) {
  const [newCue, setNewCue] = useState('');

  const addCue = () => {
    if (newCue.trim() && cues.length < maxCues) {
      onChange([...cues, newCue.trim()]);
      setNewCue('');
    }
  };

  const removeCue = (index: number) => {
    onChange(cues.filter((_, i) => i !== index));
  };

  const updateCue = (index: number, value: string) => {
    const updated = [...cues];
    updated[index] = value;
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      {/* Existing Cues */}
      {cues.map((cue, index) => (
        <div key={index} className="flex items-start gap-2">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-700
            flex items-center justify-center text-xs text-surface-400 mt-2">
            {index + 1}
          </span>
          <div className="flex-1">
            <Input
              value={cue}
              onChange={(e) => updateCue(index, e.target.value)}
              placeholder="Form cue..."
            />
          </div>
          <button
            type="button"
            onClick={() => removeCue(index)}
            className="flex-shrink-0 mt-2 p-1 text-surface-500 hover:text-danger-400
              transition-colors"
            aria-label="Remove cue"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ))}

      {/* Add New Cue */}
      {cues.length < maxCues && (
        <div className="flex items-start gap-2">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-700/50
            flex items-center justify-center text-xs text-surface-500 mt-2">
            +
          </span>
          <div className="flex-1">
            <Input
              value={newCue}
              onChange={(e) => setNewCue(e.target.value)}
              placeholder="Add a form cue..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCue();
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addCue}
            disabled={!newCue.trim()}
            className="mt-1"
          >
            Add
          </Button>
        </div>
      )}

      {cues.length >= maxCues && (
        <p className="text-xs text-surface-500 text-center">
          Maximum {maxCues} form cues
        </p>
      )}
    </div>
  );
}
