'use client';

/**
 * AI body fat estimate panel inside the progress-photo detail view.
 * Shows a stored estimate range when one exists and lets the user request
 * one (single tap — network/cost stays a user choice, like the label scan).
 * Estimates are display-only and clearly flagged as estimates.
 */

import { useState } from 'react';
import { Button } from '@/components/ui';
import { downscaleImageToJpeg } from '@/lib/images/downscaleImage';
import {
  estimateBodyFatFromPhoto,
  type BfEstimateSuccess,
} from '@/lib/actions/progress-photo-ai';
import type { ProgressPhoto } from '@/types/schema';

/**
 * Vision doesn't need full resolution — keep the request payload small.
 * The byte cap must leave headroom for base64 expansion (~4/3) plus the
 * server-action envelope under Next's default 1MiB body limit:
 * 600KB binary → ~800KB base64.
 */
const AI_IMAGE_MAX_EDGE = 1024;
const AI_IMAGE_MAX_BYTES = 600 * 1024;

interface BfEstimatePanelProps {
  photo: ProgressPhoto;
  /** Signed URL for the photo (already fetched by the page) */
  signedUrl: string | undefined;
  /** Called after a successful estimate so the page can refresh its cache */
  onEstimated: () => void;
}

export function BfEstimatePanel({ photo, signedUrl, onEstimated }: BfEstimatePanelProps) {
  const [isEstimating, setIsEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Freshest result wins over the (possibly stale) photo prop.
  const [result, setResult] = useState<BfEstimateSuccess | null>(null);

  const low = result?.low ?? photo.bfEstimateLow;
  const high = result?.high ?? photo.bfEstimateHigh;
  const hasEstimate = low != null && high != null;

  const handleEstimate = async () => {
    if (!signedUrl) return;
    setIsEstimating(true);
    setError(null);
    try {
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error('Could not load the photo');
      const blob = await response.blob();
      const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
      const downscaled = await downscaleImageToJpeg(file, {
        maxEdge: AI_IMAGE_MAX_EDGE,
        maxBytes: AI_IMAGE_MAX_BYTES,
      });
      if (!downscaled) throw new Error('Could not prepare the photo');

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const encoded = dataUrl.split(',')[1];
          if (encoded) resolve(encoded);
          else reject(new Error('Could not encode the photo'));
        };
        reader.onerror = () => reject(new Error('Could not encode the photo'));
        reader.readAsDataURL(downscaled);
      });

      const estimate = await estimateBodyFatFromPhoto(photo.id, base64, 'image/jpeg');
      if (!estimate.ok) {
        setError(estimate.error);
        return;
      }
      setResult(estimate);
      onEstimated();
    } catch (err) {
      console.error('Body fat estimation failed:', err);
      setError(err instanceof Error ? err.message : 'Estimation failed — try again');
    } finally {
      setIsEstimating(false);
    }
  };

  return (
    <div className="rounded-lg bg-surface-800/60 border border-surface-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500">
            AI body fat estimate
          </p>
          {hasEstimate ? (
            <p className="text-lg font-semibold text-surface-100">
              {low}–{high}%
              <span className="ml-2 text-xs font-normal text-surface-500">estimated</span>
            </p>
          ) : (
            <p className="text-sm text-surface-400">
              Get a rough body fat range from this photo.
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleEstimate}
          disabled={isEstimating || !signedUrl}
        >
          {isEstimating ? 'Estimating…' : hasEstimate ? 'Re-estimate' : 'Estimate'}
        </Button>
      </div>
      {result?.rationale && <p className="text-xs text-surface-400">{result.rationale}</p>}
      {result && (
        <p className="text-xs text-surface-500">
          {result.dexaCalibrated
            ? 'Calibrated against your DEXA scan history.'
            : 'Add a DEXA scan to calibrate future estimates to your body.'}
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-[11px] text-surface-600">
        Visual estimates carry a few points of error either way — trust the trend, not the number.
      </p>
    </div>
  );
}
