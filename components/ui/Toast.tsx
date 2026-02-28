'use client';

import { memo, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  onDismiss: (id: string) => void;
}

/**
 * Individual toast notification
 */
export const Toast = memo(function Toast({
  id,
  type,
  message,
  duration = 5000,
  onDismiss,
}: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(id), 200);
  }, [id, onDismiss]);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(handleDismiss, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, handleDismiss]);

  const typeStyles = {
    success: {
      bg: 'bg-success-500/10',
      border: 'border-success-500/30',
      icon: 'text-success-400',
      text: 'text-success-300',
    },
    error: {
      bg: 'bg-danger-500/10',
      border: 'border-danger-500/30',
      icon: 'text-danger-400',
      text: 'text-danger-300',
    },
    warning: {
      bg: 'bg-warning-500/10',
      border: 'border-warning-500/30',
      icon: 'text-warning-400',
      text: 'text-warning-300',
    },
    info: {
      bg: 'bg-primary-500/10',
      border: 'border-primary-500/30',
      icon: 'text-primary-400',
      text: 'text-primary-300',
    },
  };

  const icons = {
    success: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  const styles = typeStyles[type];

  return (
    <div
      className={cn(
        'rounded-lg border shadow-lg max-w-sm w-full',
        styles.bg,
        styles.border,
        'transform transition-all duration-200',
        isExiting
          ? 'opacity-0 translate-x-4'
          : 'opacity-100 translate-x-0 animate-in slide-in-from-right-4 fade-in-0'
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={cn('flex-shrink-0', styles.icon)}>
            {icons[type]}
          </div>

          {/* Message */}
          <p className={cn('flex-1 text-sm leading-snug', styles.text)}>
            {message}
          </p>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-surface-500 hover:text-surface-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});

Toast.displayName = 'Toast';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

export interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Container for managing multiple toasts
 * Renders toasts in a fixed position at the top-right of the screen
 */
export const ToastContainer = memo(function ToastContainer({
  toasts,
  onDismiss,
}: ToastContainerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || toasts.length === 0) return null;

  const content = (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          type={toast.type}
          message={toast.message}
          duration={toast.duration}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );

  return createPortal(content, document.body);
});

ToastContainer.displayName = 'ToastContainer';

/**
 * Simple hook for managing toasts
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showSuccess = useCallback((message: string, duration?: number) => {
    return addToast('success', message, duration);
  }, [addToast]);

  const showError = useCallback((message: string, duration?: number) => {
    return addToast('error', message, duration ?? 8000); // Errors show longer by default
  }, [addToast]);

  const showWarning = useCallback((message: string, duration?: number) => {
    return addToast('warning', message, duration);
  }, [addToast]);

  const showInfo = useCallback((message: string, duration?: number) => {
    return addToast('info', message, duration);
  }, [addToast]);

  return {
    toasts,
    addToast,
    dismissToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  };
}
