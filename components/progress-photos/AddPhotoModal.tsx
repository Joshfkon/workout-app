'use client';

/**
 * Add Progress Photo modal: file picker with automatic compression of
 * oversized images, ghost-overlay camera capture, and weight prefill from
 * the bodyweight log.
 */

import { useState, useEffect, useRef } from 'react';
import { Button, Input, Modal, ModalFooter } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString, kgToLbs, lbsToKg, inputWeightToKg } from '@/lib/utils';
import { downscaleImageToJpeg } from '@/lib/images/downscaleImage';
import { GhostCameraCapture } from '@/components/progress-photos/GhostCameraCapture';

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
// Longest edge for auto-compressed oversized photos. Plenty for a full-screen
// review while shrinking a >10MB screenshot PNG to ~1MB of JPEG.
const COMPRESS_MAX_EDGE = 2048;

export function AddPhotoModal({
  isOpen,
  onClose,
  userId,
  units,
  weightUnit,
  ghostUrl,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  units: 'kg' | 'lb';
  weightUnit: string;
  /** Signed URL of the most recent photo, used as the camera ghost overlay. */
  ghostUrl?: string;
  onAdded: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoDate, setPhotoDate] = useState(getLocalDateString());
  const [weightDisplay, setWeightDisplay] = useState('');
  const [bodyFatPercent, setBodyFatPercent] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  // Tracks whether the user typed a weight, so the prefill never overwrites it.
  const weightTouchedRef = useRef(false);
  // Invalidates in-flight compression when the modal closes or a newer file
  // is chosen, so a stale result can't write itself back into state.
  const acceptGenerationRef = useRef(0);

  // Prefill the weight field from the bodyweight log nearest (at or before)
  // the chosen photo date.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function prefill() {
      const supabase = createUntypedClient();
      const { data } = await supabase
        .from('weight_log')
        .select('weight, unit, logged_at')
        .eq('user_id', userId)
        .lte('logged_at', photoDate)
        .order('logged_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || weightTouchedRef.current) return;
      if (!data) {
        // No log at or before this date — clear any earlier auto-prefill so
        // the photo can't be saved with a weight measured after its date.
        setWeightDisplay('');
        return;
      }
      const rowUnit: 'kg' | 'lb' = data.unit === 'kg' ? 'kg' : 'lb';
      let display = data.weight as number;
      if (rowUnit !== units) {
        display = units === 'lb' ? kgToLbs(display) : lbsToKg(display);
      }
      setWeightDisplay(display.toFixed(1));
    }
    prefill();
    return () => {
      cancelled = true;
    };
  }, [isOpen, photoDate, userId, units]);

  const resetForm = () => {
    setFile(null);
    setPreviewUrl(null);
    setPhotoDate(getLocalDateString());
    setWeightDisplay('');
    setBodyFatPercent('');
    setNotes('');
    setError(null);
    weightTouchedRef.current = false;
  };

  const handleClose = () => {
    if (isSaving) return;
    acceptGenerationRef.current += 1;
    setIsCompressing(false);
    setIsCameraOpen(false);
    resetForm();
    onClose();
  };

  const acceptFile = async (selected: File) => {
    const generation = ++acceptGenerationRef.current;
    if (!VALID_IMAGE_TYPES.includes(selected.type)) {
      setError('Please select a JPEG, PNG, or WebP image.');
      return;
    }

    let chosen = selected;
    if (selected.size > MAX_FILE_SIZE) {
      // Screenshots and modern phone photos routinely exceed 10MB (an iPhone
      // screenshot is a lossless PNG). Compress instead of rejecting.
      setError(null);
      setIsCompressing(true);
      try {
        const compressed = await downscaleImageToJpeg(selected, {
          maxEdge: COMPRESS_MAX_EDGE,
          maxBytes: MAX_FILE_SIZE,
        });
        // The modal closed or a newer file was chosen while compressing —
        // discard this result entirely.
        if (generation !== acceptGenerationRef.current) return;
        if (!compressed) {
          setError("Couldn't compress this image under 10MB. Try a smaller photo.");
          return;
        }
        chosen = compressed;
      } finally {
        if (generation === acceptGenerationRef.current) setIsCompressing(false);
      }
    }

    if (generation !== acceptGenerationRef.current) return;
    setError(null);
    setFile(chosen);
    const reader = new FileReader();
    reader.onload = (event) => {
      if (generation !== acceptGenerationRef.current) return;
      setPreviewUrl(event.target?.result as string);
    };
    reader.readAsDataURL(chosen);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    // Allow re-selecting the same file after an error.
    e.target.value = '';
    if (!selected) return;
    void acceptFile(selected);
  };

  const handleCameraCapture = (captured: File) => {
    setIsCameraOpen(false);
    void acceptFile(captured);
  };

  const handleSave = async () => {
    if (!file) {
      setError('Choose a photo first.');
      return;
    }
    if (!photoDate) {
      setError('Pick the date the photo was taken.');
      return;
    }
    const bf = bodyFatPercent.trim() === '' ? null : parseFloat(bodyFatPercent);
    if (bf !== null && (isNaN(bf) || bf < 0 || bf > 100)) {
      setError('Body fat must be between 0 and 100.');
      return;
    }
    let weightKg: number | null = null;
    if (weightDisplay.trim() !== '') {
      const parsed = parseFloat(weightDisplay);
      if (isNaN(parsed) || parsed <= 0) {
        setError('Weight must be a positive number.');
        return;
      }
      weightKg = inputWeightToKg(parsed, units);
    }

    setIsSaving(true);
    setError(null);
    try {
      const supabase = createUntypedClient();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      // Leading folder must be the user id — storage RLS keys off it.
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('progress-photos')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('progress_photos').insert({
        user_id: userId,
        photo_date: photoDate,
        photo_url: path,
        weight_kg: weightKg,
        body_fat_percent: bf,
        notes: notes.trim() || null,
      });
      if (insertError) {
        // Don't strand the uploaded object if the row failed.
        await supabase.storage.from('progress-photos').remove([path]);
        throw insertError;
      }

      resetForm();
      onAdded();
    } catch (err) {
      console.error('Failed to add progress photo:', err);
      setError(err instanceof Error ? err.message : 'Failed to save the photo. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Progress Photo" size="md">
      <div className="space-y-4">
        {/* Photo picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
        {isCameraOpen && (
          <GhostCameraCapture
            ghostUrl={ghostUrl}
            onCapture={handleCameraCapture}
            onCancel={() => setIsCameraOpen(false)}
          />
        )}
        {!isCameraOpen && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isCompressing}
          className="w-full rounded-lg border-2 border-dashed border-surface-600 hover:border-primary-500 transition-colors overflow-hidden"
        >
          {isCompressing ? (
            <div className="py-10 flex flex-col items-center gap-2 text-surface-400">
              <div className="w-6 h-6 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Optimizing photo…</span>
            </div>
          ) : previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={previewUrl} alt="Selected progress photo" className="max-h-72 w-full object-contain bg-surface-900" />
          ) : (
            <div className="py-10 flex flex-col items-center gap-2 text-surface-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span className="text-sm">Tap to choose a photo</span>
              <span className="text-xs text-surface-500">
                JPEG, PNG or WebP · large photos are compressed automatically
              </span>
            </div>
          )}
        </button>
        )}
        {!isCameraOpen && !previewUrl && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setIsCameraOpen(true)}
            disabled={isCompressing}
          >
            Take Photo{ghostUrl ? ' (with pose overlay)' : ''}
          </Button>
        )}

        <Input
          label="Date"
          type="date"
          value={photoDate}
          max={getLocalDateString()}
          onChange={(e) => setPhotoDate(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Weight (${weightUnit})`}
            type="number"
            inputMode="decimal"
            placeholder="Optional"
            value={weightDisplay}
            onChange={(e) => {
              weightTouchedRef.current = true;
              setWeightDisplay(e.target.value);
            }}
          />
          <Input
            label="Body fat %"
            type="number"
            inputMode="decimal"
            placeholder="Optional"
            value={bodyFatPercent}
            onChange={(e) => setBodyFatPercent(e.target.value)}
          />
        </div>
        <Input
          label="Notes"
          placeholder="Lighting, pose, phase… (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <ModalFooter>
          <Button variant="secondary" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isCompressing || !file}>
            {isSaving ? 'Saving…' : 'Save Photo'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
