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
  const [manualBarcode, setManualBarcode] = useState('');
  const [debugInfo, setDebugInfo] = useState<string>('Waiting to scan...');
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const isProcessingRef = useRef(false);
  const lastScannedRef = useRef<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Stop scanner on unmount
      const scanner = scannerRef.current;
      if (scanner) {
        scannerRef.current = null;
        scanner.stop().catch(() => {});
      }
    };
  }, []);

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

    try {
      // Mode 1: Just pass barcode to parent
      if (onScan) {
        setDebugInfo(`Calling onScan(${barcode})...`);
        await onScan(barcode);
        if (isMountedRef.current) {
          setDebugInfo(`onScan complete`);
          setIsLookingUp(false);
        }
        isProcessingRef.current = false;
        return;
      }

      // Mode 2: Look up barcode and return product
      setDebugInfo(`Looking up: ${barcode}...`);
      
      const result = await lookupBarcode(barcode);
      
      if (!isMountedRef.current) {
        console.log('[Scanner] Unmounted during lookup');
        isProcessingRef.current = false;
        return;
      }

      if (result && result.found && result.product) {
        setDebugInfo(`Found: ${result.product.name}`);
        
        if (onProductFound) {
          // This will cause parent to re-render and unmount us
          onProductFound(result.product);
        }
      } else {
        // Not found
        const resultInfo = result ? JSON.stringify(result, null, 2) : 'null';
        setDebugInfo(`Not found.\nBarcode: ${barcode}\nResult: ${resultInfo}`);
        
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
          setError('Product not found in database. Try searching by name instead.');
          setErrorType('info');
        }
        setIsLookingUp(false);
      }
    } catch (err) {
      if (!isMountedRef.current) {
        isProcessingRef.current = false;
        return;
      }
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setDebugInfo(`Error: ${msg}\nBarcode: ${barcode}`);
      setError('Something went wrong. See debug info.');
      setErrorType('error');
      setIsLookingUp(false);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const startScanner = async () => {
    if (!isMountedRef.current) return;
    
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
          // Prevent duplicate scans
          if (decodedText === lastScannedRef.current) return;
          if (isProcessingRef.current) return;
          
          lastScannedRef.current = decodedText;
          
          if (isMountedRef.current) {
            setDebugInfo(`Scanned: ${decodedText}`);
          }

          // Stop scanner first
          const scanner = scannerRef.current;
          if (scanner) {
            scannerRef.current = null;
            try {
              await scanner.stop();
            } catch (e) {
              console.warn('[Scanner] Stop error:', e);
            }
          }
          
          if (isMountedRef.current) {
            setIsScanning(false);
            await processBarcode(decodedText);
          }
        },
        () => {
          // QR code not found - fires continuously, ignore
        }
      );
      
      if (isMountedRef.current) {
        setDebugInfo('Camera ready. Point at barcode.');
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

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      scannerRef.current = null;
      try {
        await scanner.stop();
      } catch {
        // Ignore
      }
    }
    if (isMountedRef.current) {
      setIsScanning(false);
    }
  };

  const handleManualLookup = () => {
    if (!manualBarcode.trim()) return;
    processBarcode(manualBarcode.trim());
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
      <div className="px-4 pb-2">
        <div className="p-2 bg-surface-900/50 rounded-lg">
          <p className="text-xs text-surface-500">
            💡 Make sure the barcode is well-lit and in focus.
          </p>
        </div>
      </div>

      {/* Debug info (always visible) */}
      <div className="px-4 pb-4">
        <div className="p-2 bg-black/50 rounded-lg border border-surface-700">
          <p className="text-[10px] text-yellow-400 font-mono mb-1">🔍 DEBUG:</p>
          <pre className="text-[10px] text-green-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
            {debugInfo}
          </pre>
        </div>
      </div>
    </div>
  );
}
