'use client';

/**
 * SignalToast - Compact interrupt for meaningful workout signals
 *
 * Only shows when something important happens (big drop, RPE ceiling, pain, etc).
 * Non-blocking, dismissible, auto-fades. Never modal.
 */

import { useState, useEffect } from 'react';
import { IconX, IconAlertTriangle, IconTrendingUp, IconInfoCircle, IconFlame } from '@tabler/icons-react';
import type { SignalType } from '@/services/inWorkoutSignals';

export interface SignalToastProps {
  type: SignalType;
  severity: 'info' | 'warning' | 'alert';
  message: string;
  exerciseName: string;
  onDismiss: () => void;
  autoFadeMs?: number;
}

export function SignalToast({
  type,
  severity,
  message,
  exerciseName,
  onDismiss,
  autoFadeMs = 8000,
}: SignalToastProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (autoFadeMs > 0) {
      const fadeTimer = setTimeout(() => {
        setIsFading(true);
        setTimeout(onDismiss, 300);
      }, autoFadeMs);

      return () => clearTimeout(fadeTimer);
    }
  }, [autoFadeMs, onDismiss]);

  if (!isVisible) return null;

  const handleDismiss = () => {
    setIsFading(true);
    setTimeout(onDismiss, 300);
  };

  const { icon: Icon, bgColor, borderColor, textColor, iconColor } = getSignalStyle(type, severity);

  return (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100vw-2rem)] transition-all duration-300 ${
        isFading ? 'opacity-0 -translate-y-2' : 'opacity-100 translate-y-0'
      }`}
      data-testid="signal-toast"
      role="alert"
      aria-live="assertive"
    >
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-xl ${bgColor} ${borderColor} border-2 shadow-2xl backdrop-blur-md`}
      >
        <Icon className={`w-5 h-5 ${iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${textColor} mb-0.5`}>
            {exerciseName}
          </p>
          <p className="text-sm text-surface-100 leading-snug">
            {message}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded-lg hover:bg-surface-800/50 transition-colors"
          aria-label="Dismiss signal"
        >
          <IconX className="w-4 h-4 text-surface-300" />
        </button>
      </div>
    </div>
  );
}

function getSignalStyle(type: SignalType, severity: 'info' | 'warning' | 'alert') {
  // Different visuals per signal type
  if (type === 'crushing_it') {
    return {
      icon: IconTrendingUp,
      bgColor: 'bg-success-900/90',
      borderColor: 'border-success-500/60',
      textColor: 'text-success-200',
      iconColor: 'text-success-400',
    };
  }

  if (type === 'pain_logged' || severity === 'alert') {
    return {
      icon: IconAlertTriangle,
      bgColor: 'bg-error-900/90',
      borderColor: 'border-error-500/60',
      textColor: 'text-error-200',
      iconColor: 'text-error-400',
    };
  }

  if (type === 'fatigue_warning' || type === 'form_breakdown') {
    return {
      icon: IconFlame,
      bgColor: 'bg-warning-900/90',
      borderColor: 'border-warning-500/60',
      textColor: 'text-warning-200',
      iconColor: 'text-warning-400',
    };
  }

  if (severity === 'warning') {
    return {
      icon: IconAlertTriangle,
      bgColor: 'bg-warning-900/90',
      borderColor: 'border-warning-500/60',
      textColor: 'text-warning-200',
      iconColor: 'text-warning-400',
    };
  }

  return {
    icon: IconInfoCircle,
    bgColor: 'bg-primary-900/90',
    borderColor: 'border-primary-500/60',
    textColor: 'text-primary-200',
    iconColor: 'text-primary-400',
  };
}
