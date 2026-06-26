'use client';

import type { SetLog } from '@/types/schema';
import type { ExerciseBlockWithExercise } from '../_lib/types';

interface FloatingDragPreviewProps {
  isDraggingBlock: boolean;
  draggedBlockIndex: number | null;
  dragPosition: { x: number; y: number } | null;
  draggedBlockRect: DOMRect | null;
  blocks: ExerciseBlockWithExercise[];
  getSetsForBlock: (blockId: string) => SetLog[];
}

export function FloatingDragPreview({
  isDraggingBlock,
  draggedBlockIndex,
  dragPosition,
  draggedBlockRect,
  blocks,
  getSetsForBlock,
}: FloatingDragPreviewProps) {
  if (!isDraggingBlock || draggedBlockIndex === null || !dragPosition) return null;

  return (
    <div
      className="fixed pointer-events-none z-50 transition-transform duration-75"
      style={{
        left: dragPosition.x,
        top: dragPosition.y,
        width: draggedBlockRect?.width ?? 'auto',
      }}
    >
      <div className="bg-surface-900 rounded-xl p-3 shadow-2xl shadow-black/50 ring-2 ring-primary-500 scale-[1.02]">
        <div className="flex items-center gap-3">
          {/* Drag handle */}
          <div className="flex flex-col gap-0.5 text-surface-400 p-1">
            <div className="w-4 h-0.5 bg-current rounded" />
            <div className="w-4 h-0.5 bg-current rounded" />
            <div className="w-4 h-0.5 bg-current rounded" />
          </div>
          {/* Exercise number circle */}
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-primary-500 text-white">
            {draggedBlockIndex + 1}
          </div>
          {/* Exercise name */}
          <div className="flex-1">
            <p className="font-medium text-surface-100">
              {blocks[draggedBlockIndex]?.exercise?.name}
            </p>
            <p className="text-xs text-surface-500">
              {getSetsForBlock(blocks[draggedBlockIndex]?.id).length}/{blocks[draggedBlockIndex]?.targetSets} sets
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
