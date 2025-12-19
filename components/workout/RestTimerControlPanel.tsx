'use client';

import { useState, useRef, useEffect } from 'react';

interface RestTimerControlPanelProps {
  isRunning: boolean;
  isFinished: boolean;
  onToggle: () => void;
  onAddTime: (seconds: number) => void;
  onReset: () => void;
  onSkip: () => void;
  isVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export function RestTimerControlPanel({
  isRunning,
  isFinished,
  onToggle,
  onAddTime,
  onReset,
  onSkip,
  isVisible: externalIsVisible,
  onVisibilityChange,
}: RestTimerControlPanelProps) {
  // Use external visibility state if provided, otherwise use internal state
  const [internalIsVisible, setInternalIsVisible] = useState(true);
  const isVisible = externalIsVisible !== undefined ? externalIsVisible : internalIsVisible;
  
  const setIsVisible = (visible: boolean) => {
    if (onVisibilityChange) {
      onVisibilityChange(visible);
    } else {
      setInternalIsVisible(visible);
    }
  };
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle swipe/drag down gesture - only from the top area
  const startDrag = (clientY: number) => {
    setIsDragging(true);
    setDragStartY(clientY);
    setCurrentY(clientY);
  };

  const updateDrag = (clientY: number) => {
    if (!isDragging) return;
    setCurrentY(clientY);
    
    // Only allow dragging down
    if (clientY > dragStartY) {
      const deltaY = clientY - dragStartY;
      if (panelRef.current) {
        panelRef.current.style.transform = `translateY(${Math.min(deltaY, 200)}px)`;
        panelRef.current.style.opacity = `${Math.max(0, 1 - deltaY / 200)}`;
      }
    }
  };

  const endDrag = () => {
    if (!isDragging) return;
    setIsDragging(false);
    
    const deltaY = currentY - dragStartY;
    const threshold = 50; // Minimum drag distance to hide
    
    if (deltaY > threshold) {
      setIsVisible(false);
      if (panelRef.current) {
        panelRef.current.style.transform = 'translateY(100%)';
        panelRef.current.style.opacity = '0';
      }
    } else {
      // Snap back
      if (panelRef.current) {
        panelRef.current.style.transform = 'translateY(0)';
        panelRef.current.style.opacity = '1';
      }
    }
  };

  const handleSwipeAreaTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    startDrag(e.touches[0].clientY);
  };

  const handleSwipeAreaTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    updateDrag(e.touches[0].clientY);
  };

  const handleSwipeAreaTouchEnd = () => {
    endDrag();
  };

  // Mouse handler for desktop
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    startDrag(e.clientY);
  };

  // Add global mouse listeners when dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      updateDrag(e.clientY);
    };

    const handleGlobalMouseUp = () => {
      endDrag();
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragStartY, currentY]);

  const handleToggleVisibility = () => {
    setIsVisible(!isVisible);
  };

  // Reset transform when visibility changes
  useEffect(() => {
    if (panelRef.current) {
      if (isVisible) {
        panelRef.current.style.transform = 'translateY(0)';
        panelRef.current.style.opacity = '1';
      } else {
        panelRef.current.style.transform = 'translateY(100%)';
        panelRef.current.style.opacity = '0';
      }
    }
  }, [isVisible]);

  if (!isVisible) {
    // Show a small button to bring it back
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={handleToggleVisibility}
          className="w-12 h-12 rounded-full bg-primary-500 hover:bg-primary-600 active:bg-primary-700 flex items-center justify-center transition-colors shadow-lg"
          aria-label="Show timer controls"
        >
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div 
      ref={panelRef}
      className="fixed bottom-0 left-0 right-0 z-50 bg-surface-900 border-t border-surface-700 safe-area-inset-bottom transition-transform duration-300 ease-out"
    >
      {/* Swipe indicator - draggable area */}
      <div 
        className="w-full flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing"
        onTouchStart={handleSwipeAreaTouchStart}
        onTouchMove={handleSwipeAreaTouchMove}
        onTouchEnd={handleSwipeAreaTouchEnd}
        onMouseDown={handleMouseDown}
      >
        <div className="w-12 h-1 bg-surface-600 rounded-full" />
      </div>
      
      <div className="flex items-center justify-between max-w-lg mx-auto p-4">
        {/* Large Pause/Play button */}
        <button
          onClick={onToggle}
          className="w-24 h-24 rounded-full bg-surface-700 hover:bg-surface-600 active:bg-surface-500 flex items-center justify-center transition-colors"
        >
          <span className="text-surface-100 font-medium text-lg">
            {isRunning ? 'Pause' : isFinished ? 'Restart' : 'Start'}
          </span>
        </button>

        {/* Right side controls */}
        <div className="flex flex-col gap-2">
          {/* Hide panel button */}
          <button
            onClick={handleToggleVisibility}
            className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 transition-colors"
            aria-label="Hide timer controls"
          >
            <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>

          {/* Time adjustment buttons */}
          <div className="flex gap-1">
            <button
              onClick={() => onAddTime(-15)}
              className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 font-medium transition-colors"
            >
              −
            </button>
            <button
              onClick={() => onAddTime(15)}
              className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 font-medium transition-colors"
            >
              +
            </button>
          </div>

          {/* Reset button */}
          <button
            onClick={onReset}
            className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 font-medium transition-colors"
          >
            Reset
          </button>

          {/* Skip button */}
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white font-medium transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
