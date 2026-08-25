'use client';

/**
 * Lightbox / detail view for a single progress photo: full image, stats,
 * notes, the AI body fat estimate panel, and delete.
 */

import { Modal, ModalFooter, Button } from '@/components/ui';
import { BfEstimatePanel } from '@/components/progress-photos/BfEstimatePanel';
import type { ProgressPhoto } from '@/types/schema';

interface PhotoDetailModalProps {
  photo: ProgressPhoto | null;
  signedUrl: string | undefined;
  formatDate: (dateStr: string) => string;
  displayWeight: (kg: number) => string;
  onClose: () => void;
  onDelete: (photo: ProgressPhoto) => void;
  onEstimated: () => void;
}

export function PhotoDetailModal({
  photo,
  signedUrl,
  formatDate,
  displayWeight,
  onClose,
  onDelete,
  onEstimated,
}: PhotoDetailModalProps) {
  return (
    <Modal
      isOpen={photo !== null}
      onClose={onClose}
      title={photo ? formatDate(photo.photoDate) : undefined}
      size="lg"
    >
      {photo && (
        <div className="space-y-4">
          <div className="rounded-lg overflow-hidden bg-surface-900 flex items-center justify-center">
            {signedUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={signedUrl}
                alt={`Progress photo from ${formatDate(photo.photoDate)}`}
                className="max-h-[60vh] w-auto object-contain"
              />
            ) : (
              <div className="h-64 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          {(photo.weightKg != null || photo.bodyFatPercent != null) && (
            <p className="text-sm text-surface-300">
              {[
                photo.weightKg != null ? `Weight: ${displayWeight(photo.weightKg)}` : null,
                photo.bodyFatPercent != null ? `Body fat: ${photo.bodyFatPercent}%` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {photo.notes && (
            <p className="text-sm text-surface-400 whitespace-pre-wrap">{photo.notes}</p>
          )}
          <BfEstimatePanel photo={photo} signedUrl={signedUrl} onEstimated={onEstimated} />
          <ModalFooter>
            <Button variant="danger" onClick={() => onDelete(photo)}>
              Delete
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
}
