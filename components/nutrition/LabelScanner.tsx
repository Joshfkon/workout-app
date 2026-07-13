'use client';

/**
 * "Scan Label" capture flow: photograph an FDA Nutrition Facts panel, OCR it
 * on-device (tesseract.js WASM — works on web and inside the Capacitor
 * WebView), parse deterministically with `parseNutritionLabel`, and hand the
 * fields to the parent for review in the create-food form. Never saves
 * anything itself.
 *
 * When the deterministic parse comes back low-confidence (or misses core
 * fields), the user can choose a one-tap AI scan of the same photo — an
 * explicit choice, never automatic, and disabled offline.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, LoadingAnimation } from '@/components/ui';
import {
  parseNutritionLabel,
  type ParsedNutritionFields,
  type ParseNutritionLabelResult,
  type ConfidenceLevel,
  type NumericLabelField,
} from '@/lib/nutrition/labelParser';
import { scanLabelWithAi } from '@/lib/actions/label-ai';

/** What the create-food form receives for review. */
export interface LabelScanPrefill {
  fields: ParsedNutritionFields;
  confidence: ConfidenceLevel;
  fieldConfidence: Partial<Record<NumericLabelField, ConfidenceLevel>>;
  warnings: string[];
  source: 'ocr' | 'ai';
}

interface LabelScannerProps {
  onClose: () => void;
  /** Parsed fields ready for review in the create-food form. */
  onParsed: (prefill: LabelScanPrefill) => void;
}

type ScanStage = 'idle' | 'camera' | 'ocr' | 'ai' | 'review';

/** Long-edge cap for the image sent to the AI fallback (keeps the server
 * action body small; OCR always runs on the full capture). */
const AI_IMAGE_MAX_EDGE = 1280;

declare global {
  interface Window {
    /** Test hook: when set, OCR is skipped and this text is parsed instead. */
    __hypertrackMockLabelOcr?: string;
  }
}

type TesseractModule = typeof import('tesseract.js');
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

/** Camera capture stills benefit from the highest resolution available. */
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: 'environment',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

async function blobToResizedBase64(
  blob: Blob,
  maxEdge: number
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];
    return base64 ? { base64, mediaType: 'image/jpeg' } : null;
  } catch {
    return null;
  }
}

export function LabelScanner({ onClose, onParsed }: LabelScannerProps) {
  const [stage, setStage] = useState<ScanStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [result, setResult] = useState<ParseNutritionLabelResult | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<TesseractWorker | null>(null);
  const capturedBlobRef = useRef<Blob | null>(null);
  const isMountedRef = useRef(true);

  // Online state drives the AI-fallback button (disabled offline, with copy).
  useEffect(() => {
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCamera();
      const worker = workerRef.current;
      workerRef.current = null;
      worker?.terminate().catch(() => {});
    };
  }, [stopCamera]);

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setStage('camera');
      // Best-effort continuous autofocus (same trick as the barcode scanner).
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[] };
        if (caps.focusMode?.includes('continuous')) {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
        }
      } catch {
        // Focus tuning is optional
      }
    } catch (err) {
      const isPermission = err instanceof Error && /permission|notallowed/i.test(`${err.name} ${err.message}`);
      setError(
        isPermission
          ? 'Camera permission denied — you can take a photo instead.'
          : 'Camera unavailable — you can take a photo instead.'
      );
    }
  };

  // Attach the stream once the <video> is mounted (stage switch re-renders).
  useEffect(() => {
    if (stage === 'camera' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [stage]);

  const captureStill = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    stopCamera();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) {
      setError("Couldn't capture the photo. Try again.");
      setStage('idle');
      return;
    }
    await runOcr(blob);
  };

  const handlePhotoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    stopCamera();
    await runOcr(file);
  };

  // ---------------------------------------------------------------------------
  // Stage 2: on-device OCR + deterministic parse
  // ---------------------------------------------------------------------------

  const getWorker = async (): Promise<TesseractWorker> => {
    if (workerRef.current) return workerRef.current;
    const tesseract: TesseractModule = await import('tesseract.js');
    // Self-hosted assets (postinstall copies them into public/tesseract; the
    // language data lives in public/tessdata) so OCR needs no CDN and works
    // offline / inside the Capacitor bundle. Absolute URLs are required
    // because the worker itself runs from a blob: URL.
    const origin = window.location.origin;
    const worker = await tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, {
      workerPath: `${origin}/tesseract/worker.min.js`,
      corePath: `${origin}/tesseract/`,
      langPath: `${origin}/tessdata`,
      logger: (m) => {
        if (m.status === 'recognizing text' && isMountedRef.current) {
          setOcrProgress(Math.round(m.progress * 100));
        }
      },
    });
    // Nutrition panels are a single uniform block of text.
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK,
    });
    workerRef.current = worker;
    return worker;
  };

  const runOcr = async (blob: Blob) => {
    capturedBlobRef.current = blob;
    setError(null);
    setOcrProgress(0);
    setStage('ocr');

    try {
      let text: string;
      if (typeof window.__hypertrackMockLabelOcr === 'string') {
        // Test hook: deterministic OCR output without a real camera/WASM run.
        text = window.__hypertrackMockLabelOcr;
      } else {
        const worker = await getWorker();
        const recognized = await worker.recognize(blob);
        text = recognized.data.text;
      }
      if (!isMountedRef.current) return;

      const parsed = parseNutritionLabel(text.split('\n'));
      setResult(parsed);

      if (parsed.confidence === 'high') {
        // Confident read → straight into the create-food form for review.
        onParsed({
          fields: parsed.fields,
          confidence: parsed.confidence,
          fieldConfidence: parsed.fieldConfidence,
          warnings: parsed.warnings,
          source: 'ocr',
        });
        return;
      }
      setStage('review');
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('[LabelScanner] OCR failed:', err);
      setResult(null);
      setError("Couldn't read the label on this device.");
      setStage('review');
    }
  };

  // ---------------------------------------------------------------------------
  // Stage 3: user-triggered AI fallback
  // ---------------------------------------------------------------------------

  const runAiScan = async () => {
    const blob = capturedBlobRef.current;
    if (!blob) return;
    setError(null);
    setStage('ai');

    const resized = await blobToResizedBase64(blob, AI_IMAGE_MAX_EDGE);
    if (!resized) {
      if (!isMountedRef.current) return;
      setError("Couldn't prepare the photo for the AI scan. Try retaking it.");
      setStage('review');
      return;
    }

    try {
      const aiResult = await scanLabelWithAi(resized.base64, resized.mediaType);
      if (!isMountedRef.current) return;
      if (!aiResult.ok) {
        setError(aiResult.error);
        setStage('review');
        return;
      }
      // AI result goes to the same review form; low-confidence fields (via
      // the shared Atwater check) stay highlighted there.
      const fieldConfidence: LabelScanPrefill['fieldConfidence'] = {};
      if (aiResult.atwater.withinTolerance === false && aiResult.atwater.suspectField) {
        const key: NumericLabelField =
          aiResult.atwater.suspectField === 'calories'
            ? 'calories'
            : aiResult.atwater.suspectField === 'protein'
              ? 'proteinG'
              : aiResult.atwater.suspectField === 'carbs'
                ? 'totalCarbsG'
                : 'totalFatG';
        fieldConfidence[key] = 'low';
      }
      onParsed({
        fields: aiResult.fields,
        confidence: aiResult.confidence,
        fieldConfidence,
        warnings: aiResult.warnings,
        source: 'ai',
      });
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('[LabelScanner] AI scan failed:', err);
      setError("AI scan failed — try again, or enter the values manually.");
      setStage('review');
    }
  };

  const handleRetake = () => {
    setResult(null);
    setError(null);
    capturedBlobRef.current = null;
    setStage('idle');
  };

  /** Push a low-confidence OCR result into the form anyway (fields present). */
  const useOcrResultAnyway = () => {
    if (!result) return;
    onParsed({
      fields: result.fields,
      confidence: result.confidence,
      fieldConfidence: result.fieldConfidence,
      warnings: result.warnings,
      source: 'ocr',
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-surface-800 rounded-lg border border-surface-700 overflow-hidden" data-testid="label-scanner">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m-6-8h6M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" />
          </svg>
          <span className="font-medium text-surface-100">Scan Nutrition Label</span>
        </div>
        <button onClick={onClose} className="p-1 text-surface-400 hover:text-surface-200" aria-label="Close label scanner">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Hidden still-photo input (capture fallback + primary path on devices
          without getUserMedia) */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoSelected}
        className="hidden"
        data-testid="label-photo-input"
      />

      <div className="p-4 space-y-4">
        {stage === 'idle' && (
          <div className="flex flex-col items-center justify-center py-6 px-4">
            <div className="w-16 h-16 rounded-full bg-primary-500/20 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <Button onClick={startCamera} variant="primary" size="lg" data-testid="label-open-camera">
              Open Camera
            </Button>
            <Button
              onClick={() => photoInputRef.current?.click()}
              variant="outline"
              size="sm"
              className="mt-2"
              data-testid="label-take-photo"
            >
              Take Photo Instead
            </Button>
            <p className="text-xs text-surface-500 mt-3 text-center">
              Fit the Nutrition Facts panel in the frame — flat, well-lit, and filling most of the shot.
            </p>
          </div>
        )}

        {stage === 'camera' && (
          <div className="space-y-3">
            <div className="relative bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-[420px] object-contain"
              />
              {/* Framing guide: portrait rectangle matching a label panel */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-[85%] max-w-xs rounded-xl border-2 border-white/80"
                  style={{ boxShadow: '0 0 0 100vmax rgba(0,0,0,0.35)' }}
                />
              </div>
              <p className="absolute top-2 left-0 right-0 text-center text-white/90 text-xs px-4">
                Fit the Nutrition Facts panel inside the frame
              </p>
            </div>
            <div className="flex justify-center gap-3">
              <Button onClick={() => { stopCamera(); setStage('idle'); }} variant="secondary" size="sm">
                Cancel
              </Button>
              <Button onClick={captureStill} variant="primary" size="lg" data-testid="label-shutter">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8a4 4 0 100 8 4 4 0 000-8z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
                </svg>
                Capture
              </Button>
            </div>
          </div>
        )}

        {stage === 'ocr' && (
          <div className="flex flex-col items-center justify-center py-10" data-testid="label-ocr-progress">
            <LoadingAnimation type="dots" size="md" />
            <p className="mt-3 text-surface-400 text-sm">
              Reading label…{ocrProgress > 0 ? ` ${ocrProgress}%` : ''}
            </p>
            <p className="mt-1 text-xs text-surface-500">Runs on your device — nothing is uploaded.</p>
          </div>
        )}

        {stage === 'ai' && (
          <div className="flex flex-col items-center justify-center py-10" data-testid="label-ai-progress">
            <LoadingAnimation type="dots" size="md" />
            <p className="mt-3 text-surface-400 text-sm">Asking AI to read the label…</p>
          </div>
        )}

        {stage === 'review' && (
          <div className="space-y-3" data-testid="label-scan-review">
            {error ? (
              <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
                <p className="text-sm text-danger-400">{error}</p>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20 space-y-1">
                <p className="text-sm font-medium text-warning-400">
                  Couldn&apos;t read the label confidently
                </p>
                {result?.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-warning-400/90">
                    {warning}
                  </p>
                ))}
              </div>
            )}

            {/* What we did manage to read, so "use anyway" is an informed choice */}
            {result && result.hasCoreFields && (
              <div className="p-3 bg-surface-900/60 rounded-lg text-sm text-surface-300">
                {result.fields.calories} cal · {result.fields.proteinG}g P ·{' '}
                {result.fields.totalCarbsG}g C · {result.fields.totalFatG}g F
                {result.fields.servingSizeText ? ` · ${result.fields.servingSizeText}` : ''}
              </div>
            )}

            <div className="space-y-2">
              <Button
                onClick={runAiScan}
                variant="primary"
                className="w-full"
                disabled={!isOnline || !capturedBlobRef.current}
                data-testid="label-try-ai"
              >
                Try AI scan
              </Button>
              {!isOnline && (
                <p className="text-xs text-surface-500 text-center">
                  AI scan needs an internet connection — you&apos;re offline. Use the values below or enter them manually.
                </p>
              )}
              {result && result.hasCoreFields && (
                <Button onClick={useOcrResultAnyway} variant="outline" className="w-full" data-testid="label-use-anyway">
                  Use these values anyway
                </Button>
              )}
              <div className="flex gap-2">
                <Button onClick={handleRetake} variant="secondary" className="flex-1">
                  Retake photo
                </Button>
                <Button onClick={onClose} variant="secondary" className="flex-1" data-testid="label-enter-manually">
                  Enter manually
                </Button>
              </div>
            </div>
          </div>
        )}

        {stage !== 'review' && error && (
          <div className="p-3 rounded-lg bg-surface-700/50">
            <p className="text-sm text-surface-300">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
