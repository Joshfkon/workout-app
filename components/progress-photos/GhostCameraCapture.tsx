'use client';

/**
 * Camera capture with a "ghost" of the previous progress photo overlaid on
 * the live preview, so each new photo matches the last one's pose, distance,
 * and framing. Consistent framing is what makes photo comparisons honest.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';

interface GhostCameraCaptureProps {
  /** Signed URL of the most recent photo to align against (optional). */
  ghostUrl?: string;
  onCapture: (file: File) => void;
  onCancel: () => void;
}

export function GhostCameraCapture({ ghostUrl, onCapture, onCancel }: GhostCameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [ghostOpacity, setGhostOpacity] = useState(35);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      setIsReady(false);
      setError(null);
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1080 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setIsReady(true);
      } catch (err) {
        console.error('Camera access failed:', err);
        if (!cancelled) {
          setError("Couldn't access the camera — check permissions or choose a photo instead.");
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, stopStream]);

  // Mirror the front camera like a mirror; capture matches the preview so the
  // saved photo lines up with what the user aligned against the ghost.
  const mirrored = facingMode === 'user';

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (mirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) {
      setError("Couldn't capture the photo — try again.");
      return;
    }
    stopStream();
    onCapture(new File([blob], 'progress-photo.jpg', { type: 'image/jpeg' }));
  };

  const handleCancel = () => {
    stopStream();
    onCancel();
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
        />
        {ghostUrl && isReady && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={ghostUrl}
            alt="Previous photo overlay"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{ opacity: ghostOpacity / 100 }}
          />
        )}
        {!isReady && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-surface-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-sm text-red-400 text-center">{error}</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
          className="absolute top-2 right-2 rounded-full bg-black/60 text-white p-2"
          aria-label="Flip camera"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {ghostUrl && (
        <label className="flex items-center gap-2 text-xs text-surface-400">
          <span className="w-24 shrink-0">Ghost overlay</span>
          <input
            type="range"
            min={0}
            max={70}
            value={ghostOpacity}
            onChange={(e) => setGhostOpacity(Number(e.target.value))}
            className="flex-1 accent-primary-500"
            aria-label="Previous photo overlay opacity"
          />
        </label>
      )}
      {ghostUrl ? (
        <p className="text-xs text-surface-500">
          Line yourself up with your last photo, then capture.
        </p>
      ) : (
        <p className="text-xs text-surface-500">
          Your next photo will show here as a ghost overlay for consistent posing.
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={handleCancel}>
          Back
        </Button>
        <Button className="flex-1" onClick={handleCapture} disabled={!isReady}>
          Capture
        </Button>
      </div>
    </div>
  );
}
