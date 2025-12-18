'use client';

import { useState, useRef, useCallback } from 'react';

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
}

export function SwipeableRow({ children, onDelete, deleteLabel = 'Delete' }: SwipeableRowProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const DELETE_THRESHOLD = -80; // Pixels to swipe to reveal delete
  const DELETE_WIDTH = 80;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = translateX;
    isDraggingRef.current = true;
  }, [translateX]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    
    const diff = e.touches[0].clientX - startXRef.current;
    let newTranslate = currentXRef.current + diff;
    
    // Limit the swipe range
    newTranslate = Math.max(-DELETE_WIDTH, Math.min(0, newTranslate));
    
    setTranslateX(newTranslate);
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    
    // Snap to either open or closed position
    if (translateX < DELETE_THRESHOLD / 2) {
      setTranslateX(-DELETE_WIDTH);
    } else {
      setTranslateX(0);
    }
  }, [translateX]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startXRef.current = e.clientX;
    currentXRef.current = translateX;
    isDraggingRef.current = true;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      
      const diff = e.clientX - startXRef.current;
      let newTranslate = currentXRef.current + diff;
      
      newTranslate = Math.max(-DELETE_WIDTH, Math.min(0, newTranslate));
      setTranslateX(newTranslate);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      
      if (translateX < DELETE_THRESHOLD / 2) {
        setTranslateX(-DELETE_WIDTH);
      } else {
        setTranslateX(0);
      }
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [translateX]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } catch (error) {
      setIsDeleting(false);
      setTranslateX(0);
    }
  };

  const closeSwipe = () => {
    setTranslateX(0);
  };

  return (
    <div 
      ref={containerRef}
      className="relative overflow-hidden rounded-lg"
    >
      {/* Delete button background */}
      <div 
        className="absolute inset-y-0 right-0 flex items-center justify-end bg-danger-500"
        style={{ width: DELETE_WIDTH }}
      >
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="h-full w-full flex items-center justify-center text-white font-medium text-sm"
        >
          {isDeleting ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Swipeable content */}
      <div
        className="relative bg-surface-900 transition-transform duration-150 ease-out"
        style={{ 
          transform: `translateX(${translateX}px)`,
          transitionDuration: isDraggingRef.current ? '0ms' : '150ms'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          // If swiped open, close on tap
          if (translateX < 0) {
            e.preventDefault();
            e.stopPropagation();
            closeSwipe();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

