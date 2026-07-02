'use client';

import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Button, LoadingAnimation } from '@/components/ui';
import { lookupBarcode, type BarcodeSearchResult } from '@/services/openFoodFactsService';
import { createUntypedClient } from '@/lib/supabase/client';

// ML Kit barcode scanning (native only) - loaded via dynamic import so the
// plugin never ends up in web bundles that don't need it.
type MLKitBarcodeModule = typeof import('@capacitor-mlkit/barcode-scanning');

/** Ignore repeat decodes of the same barcode within this window (ms). */
const SCAN_DEBOUNCE_MS = 3000;

const DEFAULT_SERVING_SIZE = '1 serving';

/**
 * Haptic + audio feedback on a successful decode.
 * Every path is best-effort: web without Capacitor, muted devices, and
 * browsers without WebAudio/vibrate all silently no-op.
 */
async function triggerScanFeedback(): Promise<void> {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(60);
      }
    } catch {
      // Vibration unavailable - ignore
    }
  }

  try {
    type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };
    const AudioCtx =
      window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 1250;
    gain.gain.value = 0.06;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.09);
    oscillator.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch {
    // Audio feedback is optional - ignore
  }
}

/** Fullscreen overlay shown during a native ML Kit scan session.
 * The camera preview renders behind the (hidden) WebView; this overlay is
 * the only visible DOM (see `barcode-scanner-active` CSS in globals.css). */
function NativeScanOverlay({
  torchAvailable,
  torchOn,
  onToggleTorch,
  onCancel,
}: {
  torchAvailable: boolean;
  torchOn: boolean;
  onToggleTorch: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="barcode-scanner-overlay fixed inset-0 z-[9999] flex flex-col">
      {/* Top bar: close + torch */}
      <div
        className="flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <button
          onClick={onCancel}
          aria-label="Close scanner"
          className="w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {torchAvailable && (
          <button
            onClick={onToggleTorch}
            aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
              torchOn ? 'bg-primary-500 text-white' : 'bg-black/50 text-white'
            }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
        )}
      </div>

      {/* Scan window (camera visible through the transparent center) */}
      <div className="flex-1 flex items-center justify-center">
        <div
          className="w-72 h-44 rounded-2xl border-2 border-white/80"
          style={{ boxShadow: '0 0 0 100vmax rgba(0, 0, 0, 0.45)' }}
        />
      </div>

      <p
        className="text-center text-white/90 text-sm"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2.5rem)' }}
      >
        Point your camera at a barcode
      </p>
    </div>
  );
}

/** Error / info notice with an optional "Create Custom Food" CTA. */
function ScanErrorNotice({
  message,
  type,
  showCreateCustom,
  onCreateCustom,
}: {
  message: string;
  type: 'info' | 'error';
  showCreateCustom: boolean;
  onCreateCustom: () => void;
}) {
  return (
    <div className={`p-3 rounded-lg ${
      type === 'error'
        ? 'bg-danger-500/10 border border-danger-500/20'
        : 'bg-surface-700/50'
    }`}>
      <div className="flex items-center gap-2">
        {type === 'error' ? (
          <svg className="w-4 h-4 text-danger-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        <p className={`text-sm ${type === 'error' ? 'text-danger-400' : 'text-surface-300'}`}>
          {message}
        </p>
      </div>

      {showCreateCustom && (
        <Button
          variant="outline"
          size="sm"
          onClick={onCreateCustom}
          className="mt-3 w-full"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Custom Food
        </Button>
      )}
    </div>
  );
}

// Support two modes:
// 1. onProductFound - scanner looks up barcode and returns full product
// 2. onScan - scanner just returns the barcode string, parent handles lookup
type BarcodeScannerProps = {
  onClose: () => void;
  onCreateCustom?: (barcode: string) => void; // Called when user wants to create custom food
} & (
  | { onProductFound: (product: NonNullable<BarcodeSearchResult['product']>) => void; onScan?: never }
  | { onScan: (barcode: string) => Promise<void>; onProductFound?: never }
);

export function BarcodeScanner(props: BarcodeScannerProps) {
  const { onClose, onCreateCustom } = props;
  const onProductFound = 'onProductFound' in props ? props.onProductFound : undefined;
  const onScan = 'onScan' in props ? props.onScan : undefined;
  // Silence unused-var: kept for backward-compatible prop API
  void onCreateCustom;

  const [isScanning, setIsScanning] = useState(false); // web (html5-qrcode) camera running
  const [isNativeScanning, setIsNativeScanning] = useState(false); // ML Kit fullscreen scan active
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'info' | 'error'>('info');
  const [manualBarcode, setManualBarcode] = useState('');
  const [debugInfo, setDebugInfo] = useState<string>('Waiting to scan...');
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false); // web torch
  const [nativeTorchAvailable, setNativeTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Custom food creation state (barcode-not-found micro-form)
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customFood, setCustomFood] = useState({
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });
  const [isSavingCustom, setIsSavingCustom] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mlkitRef = useRef<MLKitBarcodeModule | null>(null);
  const nativeListenersRef = useRef<PluginListenerHandle[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const isProcessingRef = useRef(false);
  // Time-based duplicate-scan debounce (barcode -> last seen timestamp).
  // Unlike a permanent identity check, this allows deliberately re-scanning
  // the same product after a short pause.
  const recentScansRef = useRef<Map<string, number>>(new Map());

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Stop web scanner
      const scanner = scannerRef.current;
      if (scanner) {
        scannerRef.current = null;
        scanner.stop().catch(() => {});
      }
      // Stop native scanner
      document.documentElement.classList.remove('barcode-scanner-active');
      document.body.classList.remove('barcode-scanner-active');
      const listeners = nativeListenersRef.current;
      nativeListenersRef.current = [];
      for (const listener of listeners) {
        listener.remove().catch(() => {});
      }
      const mlkit = mlkitRef.current;
      mlkitRef.current = null;
      if (mlkit) {
        mlkit.BarcodeScanner.stopScan().catch(() => {});
      }
    };
  }, []);

  /** Returns true if this decode should be processed (not a too-recent duplicate). */
  const shouldProcessScan = (barcode: string): boolean => {
    const now = Date.now();
    const lastSeen = recentScansRef.current.get(barcode) ?? 0;
    if (now - lastSeen < SCAN_DEBOUNCE_MS) return false;
    recentScansRef.current.set(barcode, now);
    return true;
  };

  // Check custom foods database first
  const checkCustomFoods = async (barcode: string): Promise<BarcodeSearchResult['product'] | null> => {
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = await supabase
        .from('custom_foods')
        .select('*')
        .eq('user_id', user.id)
        .eq('barcode', barcode)
        .single();

      if (data) {
        return {
          name: data.food_name,
          servingSize: data.serving_size || DEFAULT_SERVING_SIZE,
          servingQuantity: 1,
          calories: data.calories || 0,
          protein: data.protein || 0,
          carbs: data.carbs || 0,
          fat: data.fat || 0,
          barcode: barcode,
        };
      }
    } catch (error) {
      // Log unexpected errors - "not found" is handled by returning null from query
      console.debug('[BarcodeScanner] Custom food lookup error:', error);
    }
    return null;
  };

  // Save custom food with barcode, then immediately log it
  const saveCustomFood = async () => {
    if (!notFoundBarcode || !customFood.name.trim() || !customFood.calories) return;

    setIsSavingCustom(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      const { error } = await supabase.from('custom_foods').insert({
        user_id: user.id,
        food_name: customFood.name.trim(),
        serving_size: DEFAULT_SERVING_SIZE,
        calories: parseInt(customFood.calories) || 0,
        protein: parseFloat(customFood.protein) || 0,
        carbs: parseFloat(customFood.carbs) || 0,
        fat: parseFloat(customFood.fat) || 0,
        barcode: notFoundBarcode,
      });

      if (error) throw error;

      // Now pass the custom food to the parent so it gets logged
      if (onProductFound) {
        onProductFound({
          name: customFood.name.trim(),
          servingSize: DEFAULT_SERVING_SIZE,
          servingQuantity: 1,
          calories: parseInt(customFood.calories) || 0,
          protein: parseFloat(customFood.protein) || 0,
          carbs: parseFloat(customFood.carbs) || 0,
          fat: parseFloat(customFood.fat) || 0,
          barcode: notFoundBarcode,
        });
      }
    } catch (err) {
      setError('Failed to save custom food');
      setErrorType('error');
    } finally {
      setIsSavingCustom(false);
    }
  };

  // Process barcode lookup
  const processBarcode = async (barcode: string) => {
    if (isProcessingRef.current) {
      setDebugInfo(prev => prev + '\n[Skip: Already processing]');
      return;
    }
    isProcessingRef.current = true;

    setDebugInfo(`Processing: ${barcode}`);
    setIsLookingUp(true);
    setError(null);
    setNotFoundBarcode(null);
    setShowCustomForm(false);

    try {
      // Mode 1: Just pass barcode to parent
      if (onScan) {
        setDebugInfo(`Calling onScan(${barcode})...`);
        await onScan(barcode);
        if (isMountedRef.current) {
          setDebugInfo(`onScan complete`);
          setIsLookingUp(false);
        }
        return;
      }

      // Check custom foods first
      setDebugInfo(`Checking custom foods for: ${barcode}...`);
      const customFood = await checkCustomFoods(barcode);
      if (customFood) {
        setDebugInfo(`Found in custom foods: ${customFood.name}`);
        if (onProductFound) {
          onProductFound(customFood);
        }
        return;
      }

      // Mode 2: Look up barcode in public databases
      setDebugInfo(`Looking up in databases: ${barcode}...`);

      const result = await lookupBarcode(barcode);

      if (!isMountedRef.current) {
        return;
      }

      if (result && result.found && result.product) {
        setDebugInfo(`Found: ${result.product.name}`);

        if (onProductFound) {
          // This will cause parent to re-render and unmount us
          onProductFound(result.product);
        }
      } else {
        // Not found - offer to create custom food
        const resultInfo = result ? JSON.stringify(result, null, 2) : 'null';
        setDebugInfo(`Not found.\nBarcode: ${barcode}\nResult: ${resultInfo}`);
        setNotFoundBarcode(barcode);

        const errorText = result?.error || '';
        // Check for actual connection/server errors (not 404 which just means not found)
        const isConnectionError = errorText.includes('fetch') ||
                                   errorText.includes('network') ||
                                   errorText.includes('500') ||
                                   errorText.includes('503');

        if (isConnectionError) {
          setError('Unable to reach food database. Check your connection.');
          setErrorType('error');
        } else {
          // 404 or "not found" means the product just isn't in the database
          setError('Product not found. Create a custom entry?');
          setErrorType('info');
        }
        setIsLookingUp(false);
      }
    } catch (err) {
      if (!isMountedRef.current) {
        return;
      }
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setDebugInfo(`Error: ${msg}\nBarcode: ${barcode}`);
      setError('Something went wrong. See debug info.');
      setErrorType('error');
      setIsLookingUp(false);
    } finally {
      isProcessingRef.current = false;
      // Restart the debounce window once the lookup settles so the camera
      // doesn't immediately re-trigger on a barcode still in frame.
      recentScansRef.current.set(barcode, Date.now());
    }
  };

  // ---------------------------------------------------------------------------
  // Native path: ML Kit barcode scanning (Capacitor)
  // ---------------------------------------------------------------------------

  const stopNativeScanner = async () => {
    document.documentElement.classList.remove('barcode-scanner-active');
    document.body.classList.remove('barcode-scanner-active');
    if (isMountedRef.current) {
      setIsNativeScanning(false);
      setNativeTorchAvailable(false);
      setTorchOn(false);
    }
    const listeners = nativeListenersRef.current;
    nativeListenersRef.current = [];
    for (const listener of listeners) {
      try {
        await listener.remove();
      } catch {
        // Listener may already be removed
      }
    }
    const mlkit = mlkitRef.current;
    mlkitRef.current = null;
    if (mlkit) {
      try {
        await mlkit.BarcodeScanner.stopScan();
      } catch (err) {
        console.debug('[BarcodeScanner] Native stopScan error (usually safe to ignore):', err);
      }
    }
  };

  const startNativeScanner = async (): Promise<void> => {
    setDebugInfo('Starting native ML Kit scanner...');

    let mlkit: MLKitBarcodeModule;
    try {
      mlkit = await import('@capacitor-mlkit/barcode-scanning');
    } catch {
      // Plugin not installed in this native shell - fall back to the web scanner
      setDebugInfo('ML Kit plugin unavailable, falling back to web scanner');
      await startWebScanner();
      return;
    }

    const { BarcodeScanner: MLKitScanner, BarcodeFormat, LensFacing } = mlkit;

    try {
      const { supported } = await MLKitScanner.isSupported();
      if (!supported) {
        setDebugInfo('ML Kit not supported on this device, falling back to web scanner');
        await startWebScanner();
        return;
      }

      // Permission flow: check, then request if needed
      let permission = await MLKitScanner.checkPermissions();
      if (permission.camera !== 'granted' && permission.camera !== 'limited') {
        permission = await MLKitScanner.requestPermissions();
      }
      if (permission.camera !== 'granted' && permission.camera !== 'limited') {
        setErrorType('info');
        setError('Camera permission denied. Enter barcode manually below.');
        setDebugInfo(`Camera permission: ${permission.camera}`);
        return;
      }

      mlkitRef.current = mlkit;

      // Register listeners before starting the scan
      const scannedListener = await MLKitScanner.addListener('barcodesScanned', async (event) => {
        const barcode = event.barcodes[0];
        const value = barcode?.rawValue ?? barcode?.displayValue;
        if (!value) return;
        if (isProcessingRef.current) return;
        if (!shouldProcessScan(value)) return;

        void triggerScanFeedback();

        // Close the fullscreen camera before handing off to the lookup UI
        await stopNativeScanner();

        if (isMountedRef.current) {
          setDebugInfo(`Scanned (native): ${value}`);
          await processBarcode(value);
        }
      });
      nativeListenersRef.current.push(scannedListener);

      const errorListener = await MLKitScanner.addListener('scanError', async (event) => {
        console.warn('[BarcodeScanner] Native scan error:', event.message);
        await stopNativeScanner();
        if (isMountedRef.current) {
          setErrorType('error');
          setError('Scanner error. Try again or enter the barcode manually.');
          setDebugInfo(`Native scan error: ${event.message}`);
        }
      });
      nativeListenersRef.current.push(errorListener);

      // The camera renders BEHIND the WebView; CSS in globals.css hides the
      // app while `barcode-scanner-active` is set (our overlay stays visible).
      document.documentElement.classList.add('barcode-scanner-active');
      document.body.classList.add('barcode-scanner-active');
      setIsNativeScanning(true);

      await MLKitScanner.startScan({
        formats: [
          BarcodeFormat.Ean13,
          BarcodeFormat.Ean8,
          BarcodeFormat.UpcA,
          BarcodeFormat.UpcE,
          BarcodeFormat.Code128,
          BarcodeFormat.Code39,
        ],
        lensFacing: LensFacing.Back,
      });

      // Torch is only queryable during an active scan session
      try {
        const { available } = await MLKitScanner.isTorchAvailable();
        if (isMountedRef.current) setNativeTorchAvailable(available);
      } catch {
        // Torch not available on this device
      }

      setDebugInfo('Native camera ready. Point at barcode.');
    } catch (err) {
      await stopNativeScanner();
      const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setDebugInfo(`Native scanner error: ${errMsg}. Falling back to web scanner.`);
      // Defensive: any native failure falls back to the proven web path
      await startWebScanner();
    }
  };

  const toggleNativeTorch = async () => {
    const mlkit = mlkitRef.current;
    if (!mlkit) return;
    try {
      await mlkit.BarcodeScanner.toggleTorch();
      const { enabled } = await mlkit.BarcodeScanner.isTorchEnabled();
      if (isMountedRef.current) setTorchOn(enabled);
    } catch (err) {
      console.debug('[BarcodeScanner] Torch toggle error:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // Web path: html5-qrcode
  // ---------------------------------------------------------------------------

  const startWebScanner = async () => {
    if (!isMountedRef.current) return;

    setIsScanning(true);
    setDebugInfo('Starting camera...');

    try {
      // Only scan barcode formats commonly used on food products
      // This speeds up detection by not checking for QR codes
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,    // Most common for food (13-digit)
        Html5QrcodeSupportedFormats.EAN_8,     // Short EAN (8-digit)
        Html5QrcodeSupportedFormats.UPC_A,     // US/Canada products (12-digit)
        Html5QrcodeSupportedFormats.UPC_E,     // Compressed UPC (6-digit)
        Html5QrcodeSupportedFormats.CODE_128,  // Versatile barcode format
        Html5QrcodeSupportedFormats.CODE_39,   // Alphanumeric barcodes
      ];

      const html5QrCode = new Html5Qrcode('barcode-reader', {
        formatsToSupport,
        verbose: false,
        // Use native BarcodeDetector API if available (faster)
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
      });
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 15,  // Increased from 10 for faster scanning
          qrbox: { width: 300, height: 180 },  // Larger scan area for easier alignment
          aspectRatio: 1.777778,
        },
        (decodedText) => {
          // Time-based duplicate debounce + single lookup at a time
          if (isProcessingRef.current) return;
          if (!shouldProcessScan(decodedText)) return;

          void triggerScanFeedback();

          if (isMountedRef.current) {
            setDebugInfo(`Scanned: ${decodedText}`);
          }

          // Continuous scanning: keep the camera running while we look the
          // product up. On success the parent unmounts us (cleanup stops the
          // camera); on "not found" scanning resumes automatically.
          void processBarcode(decodedText);
        },
        () => {
          // Barcode not found in frame - fires continuously, ignore
        }
      );

      if (isMountedRef.current) {
        setDebugInfo('Camera ready. Point at barcode.');
      }

      // Feature-detect torch support (v2.3.8 camera capabilities API)
      try {
        const torchFeature = html5QrCode.getRunningTrackCameraCapabilities().torchFeature();
        if (isMountedRef.current) setTorchSupported(torchFeature.isSupported());
      } catch {
        if (isMountedRef.current) setTorchSupported(false);
      }
    } catch (err) {
      if (!isMountedRef.current) return;

      setIsScanning(false);
      const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setDebugInfo(`Camera error: ${errMsg}`);
      setErrorType('info');

      if (err instanceof Error) {
        if (err.message.includes('Permission')) {
          setError('Camera permission denied. Enter barcode manually below.');
        } else if (err.message.includes('NotFoundError')) {
          setError('No camera found. Enter barcode manually below.');
        } else {
          setError(`Camera unavailable: ${err.message}`);
        }
      } else {
        setError('Camera unavailable. Enter barcode manually below.');
      }
    }
  };

  const toggleWebTorch = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      const torchFeature = scanner.getRunningTrackCameraCapabilities().torchFeature();
      if (!torchFeature.isSupported()) return;
      const next = !(torchFeature.value() ?? false);
      await torchFeature.apply(next);
      if (isMountedRef.current) setTorchOn(next);
    } catch (err) {
      console.debug('[BarcodeScanner] Web torch toggle error:', err);
    }
  };

  const stopWebScanner = async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      scannerRef.current = null;
      try {
        await scanner.stop();
      } catch (error) {
        // Scanner stop can fail if already stopped or during cleanup - log for debugging
        console.debug('[BarcodeScanner] Scanner stop error (usually safe to ignore):', error);
      }
    }
    if (isMountedRef.current) {
      setIsScanning(false);
      setTorchSupported(false);
      setTorchOn(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Shared entry point: native ML Kit on device, html5-qrcode on web
  // ---------------------------------------------------------------------------

  const startScanner = async () => {
    if (!isMountedRef.current) return;

    setError(null);
    setShowCustomForm(false);

    if (Capacitor.isNativePlatform()) {
      await startNativeScanner();
    } else {
      await startWebScanner();
    }
  };

  const handleManualLookup = () => {
    if (!manualBarcode.trim()) return;
    processBarcode(manualBarcode.trim());
  };

  // Show custom food creation micro-form (barcode not found)
  if (showCustomForm && notFoundBarcode) {
    return (
      <div className="bg-surface-800 rounded-lg border border-surface-700 overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <span className="text-lg">📝</span>
            <span className="font-medium text-surface-100">New Food</span>
          </div>
          <button onClick={() => setShowCustomForm(false)} className="p-1 text-surface-400 hover:text-surface-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-surface-400">
            Barcode: <span className="font-mono text-surface-300">{notFoundBarcode}</span>
          </p>

          <input
            type="text"
            autoFocus
            value={customFood.name}
            onChange={(e) => setCustomFood(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Food name *"
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500"
          />

          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={customFood.calories}
            onChange={(e) => setCustomFood(prev => ({ ...prev, calories: e.target.value }))}
            placeholder="Calories (per serving) *"
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500"
          />

          {/* Optional macros - default to 0 when left blank */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-surface-500 mb-1">Protein (g)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={customFood.protein}
                onChange={(e) => setCustomFood(prev => ({ ...prev, protein: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Carbs (g)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={customFood.carbs}
                onChange={(e) => setCustomFood(prev => ({ ...prev, carbs: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Fat (g)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={customFood.fat}
                onChange={(e) => setCustomFood(prev => ({ ...prev, fat: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500"
              />
            </div>
          </div>

          <Button
            onClick={saveCustomFood}
            isLoading={isSavingCustom}
            disabled={!customFood.name.trim() || !customFood.calories}
            className="w-full"
          >
            Save &amp; log
          </Button>

          <p className="text-[10px] text-surface-500 text-center">
            Logged as {DEFAULT_SERVING_SIZE}. Saved to your foods — scanning this barcode again logs it instantly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-800 rounded-lg border border-surface-700 overflow-hidden">
      {isNativeScanning && (
        <NativeScanOverlay
          torchAvailable={nativeTorchAvailable}
          torchOn={torchOn}
          onToggleTorch={() => { void toggleNativeTorch(); }}
          onCancel={() => { void stopNativeScanner(); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          <span className="font-medium text-surface-100">Scan Barcode</span>
        </div>
        <button onClick={onClose} className="p-1 text-surface-400 hover:text-surface-200">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scanner area */}
      <div className="p-4 space-y-4">
        {isLookingUp && !isScanning ? (
          <div className="flex flex-col items-center justify-center py-8">
            <LoadingAnimation type="dots" size="md" />
            <p className="mt-3 text-surface-400">Looking up product...</p>
          </div>
        ) : (
          <>
            {/* Camera scanner */}
            <div
              ref={containerRef}
              className="relative bg-surface-900 rounded-lg overflow-hidden"
              style={{ minHeight: isScanning ? '200px' : 'auto' }}
            >
              <div id="barcode-reader" className={isScanning ? 'block' : 'hidden'} />

              {!isScanning && (
                <div className="flex flex-col items-center justify-center py-8 px-4">
                  <div className="w-16 h-16 rounded-full bg-primary-500/20 flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <Button onClick={startScanner} variant="primary" size="lg">
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                    Start Camera Scanner
                  </Button>
                  <p className="text-xs text-surface-500 mt-2 text-center">
                    Point your camera at a barcode to scan
                  </p>
                </div>
              )}

              {isScanning && (
                <>
                  {/* Lookup-in-progress banner (camera keeps running) */}
                  {isLookingUp && (
                    <div className="absolute top-2 left-2 right-2 flex items-center justify-center gap-2 bg-black/60 rounded-lg px-3 py-2">
                      <LoadingAnimation type="dots" size="sm" />
                      <span className="text-xs text-white">Looking up product...</span>
                    </div>
                  )}

                  {/* Torch toggle (only when the camera supports it) */}
                  {torchSupported && (
                    <button
                      onClick={() => { void toggleWebTorch(); }}
                      aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                      className={`absolute bottom-2 right-2 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                        torchOn ? 'bg-primary-500 text-white' : 'bg-black/50 text-white'
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </button>
                  )}

                  <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                    <Button onClick={stopWebScanner} variant="secondary" size="sm">
                      Stop Scanner
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Manual entry */}
            <div className="border-t border-surface-700 pt-4">
              <p className="text-sm text-surface-400 mb-2">Or enter barcode manually:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={manualBarcode}
                  onChange={(e) => setManualBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualLookup()}
                  placeholder="Enter barcode number"
                  className="flex-1 px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <Button onClick={handleManualLookup} disabled={!manualBarcode.trim()}>
                  Look Up
                </Button>
              </div>
            </div>

            {/* Error/Info message with Create Custom button */}
            {error && (
              <ScanErrorNotice
                message={error}
                type={errorType}
                showCreateCustom={!!notFoundBarcode && errorType === 'info'}
                onCreateCustom={() => setShowCustomForm(true)}
              />
            )}
          </>
        )}
      </div>

      {/* Tips */}
      <div className="px-4 pb-2">
        <div className="p-2 bg-surface-900/50 rounded-lg">
          <p className="text-xs text-surface-500">
            💡 Hold steady within the scan area. Works at an angle too!
          </p>
        </div>
      </div>

      {/* Debug info (development only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="px-4 pb-4">
          <div className="p-2 bg-black/50 rounded-lg border border-surface-700">
            <p className="text-[10px] text-yellow-400 font-mono mb-1">DEBUG:</p>
            <pre className="text-[10px] text-green-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {debugInfo}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
