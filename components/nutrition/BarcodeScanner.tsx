'use client';

import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button, LoadingAnimation } from '@/components/ui';
import { lookupBarcode, type BarcodeSearchResult } from '@/services/openFoodFactsService';

// Support two modes:
// 1. onProductFound - scanner looks up barcode and returns full product
// 2. onScan - scanner just returns the barcode string, parent handles lookup
type BarcodeScannerProps = {
  onClose: () => void;
} & (
  | { onProductFound: (product: NonNullable<BarcodeSearchResult['product']>) => void; onScan?: never }
  | { onScan: (barcode: string) => Promise<void>; onProductFound?: never }
);

export function BarcodeScanner(props: BarcodeScannerProps) {
  const { onClose } = props;
  const onProductFound = 'onProductFound' in props ? props.onProductFound : undefined;
  const onScan = 'onScan' in props ? props.onScan : undefined;
  const [isScanning, setIsScanning] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'info' | 'error'>('info');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      // Cleanup scanner on unmount
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const startScanner = async () => {
    setError(null);
    setIsScanning(true);
    setDebugInfo('Starting camera...');

    try {
      const html5QrCode = new Html5Qrcode('barcode-reader');
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          aspectRatio: 1.777778,
        },
        async (decodedText) => {
          // Wrap entire callback in try-catch to prevent crashes
          try {
            // Prevent duplicate scans
            if (decodedText === lastScanned) return;
            setLastScanned(decodedText);
            setDebugInfo(`Scanned: ${decodedText}`);

            // Stop scanner safely
            try {
              await html5QrCode.stop();
            } catch (stopErr) {
              console.warn('Scanner stop warning:', stopErr);
            }
            setIsScanning(false);

            // Look up the barcode
            await handleBarcodeLookup(decodedText);
          } catch (callbackErr) {
            const msg = callbackErr instanceof Error ? callbackErr.message : String(callbackErr);
            setDebugInfo(`Scan callback error: ${msg}\nBarcode: ${decodedText}`);
            setError('Error processing barcode. See debug info below.');
            setErrorType('error');
            setIsScanning(false);
          }
        },
        () => {
          // QR code not found - this fires continuously, ignore
        }
      );
      setDebugInfo('Camera ready. Point at barcode.');
    } catch (err) {
      setIsScanning(false);
      const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setDebugInfo(`Camera error: ${errMsg}`);
      setErrorType('info'); // Camera issues are informational, not critical errors
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

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Ignore errors when stopping
      }
    }
    setIsScanning(false);
  };

  const handleBarcodeLookup = async (barcode: string) => {
    setIsLookingUp(true);
    setError(null);
    setErrorType('info');
    setDebugInfo(`Scanning: ${barcode}`);

    try {
      // If using onScan mode, just pass the barcode to parent
      if (onScan) {
        try {
          await onScan(barcode);
        } catch (scanErr) {
          const msg = scanErr instanceof Error ? scanErr.message : String(scanErr);
          setDebugInfo(`onScan error: ${msg}\nBarcode: ${barcode}`);
          setError('Failed to process barcode.');
          setErrorType('error');
        }
        setIsLookingUp(false);
        return;
      }

      // If using onProductFound mode, look up the barcode ourselves
      setDebugInfo(`Looking up: ${barcode}...`);
      
      let result;
      try {
        result = await lookupBarcode(barcode);
      } catch (lookupErr) {
        const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
        setDebugInfo(`Lookup exception: ${msg}\nBarcode: ${barcode}`);
        setError('Failed to look up barcode.');
        setErrorType('error');
        setLastScanned(null);
        setIsLookingUp(false);
        return;
      }
      
      if (result && result.found && result.product && onProductFound) {
        setDebugInfo(`Found: ${result.product.name}`);
        try {
          onProductFound(result.product);
        } catch (cbErr) {
          const msg = cbErr instanceof Error ? cbErr.message : String(cbErr);
          setDebugInfo(`Callback error: ${msg}`);
          setError('Failed to add product.');
          setErrorType('error');
        }
      } else {
        // Show detailed debug info
        const resultStr = result ? JSON.stringify(result, null, 2) : 'null result';
        setDebugInfo(`Barcode: ${barcode}\nResult: ${resultStr}`);
        
        // Distinguish between "not found" and actual errors
        const errorText = result?.error || '';
        if (errorText.includes('API error') || errorText.includes('fetch') || errorText.includes('exception')) {
          setError('Unable to reach food database. Check your connection.');
          setErrorType('error');
        } else {
          setError('Product not found. Try searching by name instead.');
          setErrorType('info');
        }
        setLastScanned(null);
      }
    } catch (err) {
      // Catch-all for any unexpected errors
      const errorMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setDebugInfo(`Unexpected error: ${errorMsg}\nBarcode: ${barcode}`);
      setError('Something went wrong. See details below.');
      setErrorType('error');
      setLastScanned(null);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleManualLookup = async () => {
    if (!manualBarcode.trim()) return;
    await handleBarcodeLookup(manualBarcode.trim());
  };

  return (
    <div className="bg-surface-800 rounded-lg border border-surface-700 overflow-hidden">
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
        {isLookingUp ? (
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
                <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                  <Button onClick={stopScanner} variant="secondary" size="sm">
                    Stop Scanner
                  </Button>
                </div>
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

            {/* Error/Info message */}
            {error && (
              <div className={`p-2 rounded-lg flex items-center gap-2 ${
                errorType === 'error' 
                  ? 'bg-danger-500/10 border border-danger-500/20' 
                  : 'bg-surface-700/50'
              }`}>
                {errorType === 'error' ? (
                  <svg className="w-4 h-4 text-danger-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <p className={`text-sm ${errorType === 'error' ? 'text-danger-400' : 'text-surface-300'}`}>
                  {error}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Tips */}
      <div className="px-4 pb-4">
        <div className="p-3 bg-surface-900/50 rounded-lg">
          <p className="text-xs text-surface-500">
            💡 <span className="font-medium">Tip:</span> Make sure the barcode is well-lit and in focus. Most packaged foods have barcodes on the back or bottom.
          </p>
        </div>
      </div>

      {/* Debug info (always visible for troubleshooting) */}
      <div className="px-4 pb-4">
        <div className="p-2 bg-surface-900/80 rounded-lg border border-surface-700">
          <p className="text-[10px] text-surface-500 font-medium mb-1">🔍 Debug Log:</p>
          <pre className="text-[10px] text-surface-400 overflow-x-auto whitespace-pre-wrap break-all">
            {debugInfo || 'Waiting to scan...'}
          </pre>
        </div>
      </div>
    </div>
  );
}
