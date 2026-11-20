'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatTone = 'neutral' | 'ok' | 'warn' | 'bad';

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Small unit after the value ("h", "ms", "lb"). */
  unit?: ReactNode;
  /** One line under the value ("+0.4 vs avg", "today"). */
  note?: ReactNode;
  noteTone?: StatTone;
  align?: 'start' | 'center';
  className?: string;
}

const TONES: Record<StatTone, string> = {
  neutral: 'text-ink-2',
  ok: 'text-status-ok',
  warn: 'text-status-warn',
  bad: 'text-status-bad',
};

/** Design system stat tile: caption label, big tabular number, one note line. */
export function StatTile({ label, value, unit, note, noteTone = 'neutral', align = 'start', className }: StatTileProps) {
  return (
    <div className={cn('rounded-card bg-card px-3.5 py-3 shadow-card', align === 'center' && 'text-center', className)}>
      <div className="text-caption text-ink-2">{label}</div>
      <div className="mt-0.5 text-[22px] font-bold leading-7 text-ink tabular-nums">
        {value}
        {unit && <span className="text-subhead font-medium text-ink-2"> {unit}</span>}
      </div>
      {note && <div className={cn('text-caption', TONES[noteTone])}>{note}</div>}
    </div>
  );
}
