'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  Button,
  Input,
  Modal,
  ModalFooter,
  ConfirmModal,
  ErrorRetry,
  FullPageLoading,
} from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { resolveAuthState } from '@/lib/supabase/authState';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { getLocalDateString, kgToLbs, inputWeightToKg } from '@/lib/utils';
import { downscaleImageToJpeg } from '@/lib/images/downscaleImage';
import { ComparePhotos } from '@/components/progress-photos/ComparePhotos';
import type { ProgressPhoto } from '@/types/schema';

const AUTH_REQUIRED = { authRequired: true } as const;

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
// Longest edge for auto-compressed oversized photos. Plenty for a full-screen
// review while shrinking a >10MB screenshot PNG to ~1MB of JPEG.
const COMPRESS_MAX_EDGE = 2048;

function transformRow(photo: any): ProgressPhoto {
  return {
    id: photo.id,
    userId: photo.user_id,
    photoDate: photo.photo_date,
    photoUrl: photo.photo_url,
    weightKg: photo.weight_kg,
    bodyFatPercent: photo.body_fat_percent,
    notes: photo.notes,
    createdAt: photo.created_at,
  };
}

export default function ProgressPhotosPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { preferences } = useUserPreferences();
  const units = preferences.units;
  const weightUnit = units === 'lb' ? 'lbs' : 'kg';

  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<ProgressPhoto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProgressPhoto | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const photosQuery = useQuery({
    queryKey: ['analytics', 'photos', 'all'],
    queryFn: async () => {
      const supabase = createUntypedClient();
      const auth = await resolveAuthState(supabase);
      if (auth.status === 'unauthenticated') return AUTH_REQUIRED;
      if (auth.status === 'error') {
        throw auth.error instanceof Error
          ? auth.error
          : new Error('Could not verify your session');
      }
      const { data, error } = await supabase
        .from('progress_photos')
        .select('*')
        .eq('user_id', auth.userId)
        .order('photo_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows: any[] = data ?? [];
      const photos: ProgressPhoto[] = rows.map(transformRow);
      return { userId: auth.userId, photos };
    },
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (photosQuery.data && 'authRequired' in photosQuery.data) {
      router.push('/login');
    }
  }, [photosQuery.data, router]);

  const photos =
    photosQuery.data && !('authRequired' in photosQuery.data)
      ? photosQuery.data.photos
      : [];
  const userId =
    photosQuery.data && !('authRequired' in photosQuery.data)
      ? photosQuery.data.userId
      : null;

  // Signed URLs are short-lived, so they live in local state, not the query
  // cache. Fetched in one batch per photo list change.
  useEffect(() => {
    let cancelled = false;
    async function loadUrls() {
      if (photos.length === 0) return;
      const supabase = createUntypedClient();
      const paths = photos.map((p) => p.photoUrl).filter(Boolean);
      const { data } = await supabase.storage
        .from('progress-photos')
        .createSignedUrls(paths, 3600);
      if (cancelled || !data) return;
      const urls: Record<string, string> = {};
      photos.forEach((photo) => {
        const entry = data.find(
          (d: { path: string | null; signedUrl: string }) => d.path === photo.photoUrl
        );
        if (entry?.signedUrl) urls[photo.id] = entry.signedUrl;
      });
      setPhotoUrls(urls);
    }
    loadUrls();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photosQuery.dataUpdatedAt]);

  const invalidatePhotos = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['analytics', 'photos'] });
    // The Analytics page bundles its own copy of recent photos.
    queryClient.invalidateQueries({ queryKey: ['analytics', 'main'] });
  }, [queryClient]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const supabase = createUntypedClient();
      const { error } = await supabase
        .from('progress_photos')
        .delete()
        .eq('id', deleteTarget.id);
      if (error) throw error;
      // Best effort — an orphaned storage object is invisible to the app.
      if (deleteTarget.photoUrl) {
        await supabase.storage.from('progress-photos').remove([deleteTarget.photoUrl]);
      }
      setDeleteTarget(null);
      setViewingPhoto(null);
      invalidatePhotos();
    } catch (err) {
      console.error('Failed to delete progress photo:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const displayWeight = (kg: number) =>
    units === 'lb' ? `${kgToLbs(kg).toFixed(1)} lbs` : `${kg.toFixed(1)} kg`;

  const formatDate = (dateStr: string) =>
    new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  if (photosQuery.isLoading && !photosQuery.data) {
    return <FullPageLoading />;
  }

  if (photosQuery.isError) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <ErrorRetry
          message="Couldn't load your progress photos."
          onRetry={() => photosQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard/analytics"
            className="text-sm text-surface-400 hover:text-surface-200"
          >
            ← Analytics
          </Link>
          <h1 className="text-xl font-bold text-surface-100 mt-1">Progress Photos</h1>
        </div>
        <div className="flex gap-2">
          {photos.length >= 2 && (
            <Button variant="secondary" onClick={() => setIsCompareOpen(true)}>
              Compare
            </Button>
          )}
          <Button onClick={() => setIsAddOpen(true)}>Add Photo</Button>
        </div>
      </div>

      {/* Empty state */}
      {photos.length === 0 && (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-surface-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
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
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No progress photos yet</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Photos are the most honest progress tracker there is. Take them in
            consistent lighting and poses, and future you will thank you.
          </p>
          <Button className="mt-6" onClick={() => setIsAddOpen(true)}>
            Add Your First Photo
          </Button>
        </Card>
      )}

      {/* Gallery */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => {
            const url = photoUrls[photo.id];
            return (
              <button
                key={photo.id}
                onClick={() => setViewingPhoto(photo)}
                className="text-left group"
              >
                <div className="aspect-[3/4] rounded-lg overflow-hidden bg-surface-800 ring-1 ring-surface-700 group-hover:ring-primary-500 transition-shadow">
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={`Progress photo from ${formatDate(photo.photoDate)}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <div className="mt-1.5 px-0.5">
                  <p className="text-sm text-surface-200">{formatDate(photo.photoDate)}</p>
                  {(photo.weightKg != null || photo.bodyFatPercent != null) && (
                    <p className="text-xs text-surface-500">
                      {[
                        photo.weightKg != null ? displayWeight(photo.weightKg) : null,
                        photo.bodyFatPercent != null ? `${photo.bodyFatPercent}% BF` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Lightbox / detail view */}
      <Modal
        isOpen={viewingPhoto !== null}
        onClose={() => setViewingPhoto(null)}
        title={viewingPhoto ? formatDate(viewingPhoto.photoDate) : undefined}
        size="lg"
      >
        {viewingPhoto && (
          <div className="space-y-4">
            <div className="rounded-lg overflow-hidden bg-surface-900 flex items-center justify-center">
              {photoUrls[viewingPhoto.id] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={photoUrls[viewingPhoto.id]}
                  alt={`Progress photo from ${formatDate(viewingPhoto.photoDate)}`}
                  className="max-h-[60vh] w-auto object-contain"
                />
              ) : (
                <div className="h-64 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {(viewingPhoto.weightKg != null || viewingPhoto.bodyFatPercent != null) && (
              <p className="text-sm text-surface-300">
                {[
                  viewingPhoto.weightKg != null
                    ? `Weight: ${displayWeight(viewingPhoto.weightKg)}`
                    : null,
                  viewingPhoto.bodyFatPercent != null
                    ? `Body fat: ${viewingPhoto.bodyFatPercent}%`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {viewingPhoto.notes && (
              <p className="text-sm text-surface-400 whitespace-pre-wrap">{viewingPhoto.notes}</p>
            )}
            <ModalFooter>
              <Button variant="danger" onClick={() => setDeleteTarget(viewingPhoto)}>
                Delete
              </Button>
              <Button variant="secondary" onClick={() => setViewingPhoto(null)}>
                Close
              </Button>
            </ModalFooter>
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this photo?"
        message="This permanently removes the photo and its notes."
        confirmText="Delete"
        variant="danger"
        isLoading={isDeleting}
      />

      {/* Compare viewer */}
      <ComparePhotos
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        photos={photos}
        photoUrls={photoUrls}
        units={units}
      />

      {/* Add photo modal */}
      {userId && (
        <AddPhotoModal
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          userId={userId}
          units={units}
          weightUnit={weightUnit}
          onAdded={() => {
            setIsAddOpen(false);
            invalidatePhotos();
          }}
        />
      )}
    </div>
  );
}

function AddPhotoModal({
  isOpen,
  onClose,
  userId,
  units,
  weightUnit,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  units: 'kg' | 'lb';
  weightUnit: string;
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

  const resetForm = () => {
    setFile(null);
    setPreviewUrl(null);
    setPhotoDate(getLocalDateString());
    setWeightDisplay('');
    setBodyFatPercent('');
    setNotes('');
    setError(null);
  };

  const handleClose = () => {
    if (isSaving) return;
    resetForm();
    onClose();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    // Allow re-selecting the same file after an error.
    e.target.value = '';
    if (!selected) return;
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
        if (!compressed) {
          setError("Couldn't compress this image under 10MB. Try a smaller photo.");
          return;
        }
        chosen = compressed;
      } finally {
        setIsCompressing(false);
      }
    }

    setError(null);
    setFile(chosen);
    const reader = new FileReader();
    reader.onload = (event) => setPreviewUrl(event.target?.result as string);
    reader.readAsDataURL(chosen);
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
            onChange={(e) => setWeightDisplay(e.target.value)}
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
