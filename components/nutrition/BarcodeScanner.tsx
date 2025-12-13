'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { Button } from '@/components/ui/Button';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);

  useEffect(() => {
    startScanning();

    return () => {
      stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startScanning() {
    try {
      setError('');
      setIsScanning(true);

      const codeReader = new BrowserMultiFormatReader();
      codeReaderRef.current = codeReader;

      // Get available video devices
      const videoInputDevices = await codeReader.listVideoInputDevices();

      if (videoInputDevices.length === 0) {
        setError('No camera found. Please ensure your device has a camera and permissions are granted.');
        setIsScanning(false);
        return;
      }

      // Prefer back camera on mobile devices
      const selectedDevice = videoInputDevices.find(
        (device) => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('rear')
      ) || videoInputDevices[0];

      // Start decoding from video device
      await codeReader.decodeFromVideoDevice(
        selectedDevice.deviceId,
        videoRef.current!,
        (result, err) => {
          if (result) {
            const barcode = result.getText();
            onScan(barcode);
            stopScanning();
          }

          if (err && !(err instanceof NotFoundException)) {
            console.error('Barcode scanning error:', err);
          }
        }
      );
    } catch (err) {
      console.error('Failed to start camera:', err);
      setError('Failed to access camera. Please check permissions.');
      setIsScanning(false);
    }
  }

  function stopScanning() {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsScanning(false);
  }

  return (
    <div className="space-y-4">
      <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />

        {/* Scanning overlay */}
        {isScanning && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-64 h-64 border-2 border-primary-500 rounded-lg relative">
              {/* Scanning line animation */}
              <div className="absolute inset-x-0 top-0 h-1 bg-primary-500 animate-scan" />
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary-400" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary-400" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary-400" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary-400" />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        {error && (
          <Button variant="primary" onClick={startScanning} className="flex-1">
            Retry
          </Button>
        )}
      </div>

      <p className="text-sm text-surface-400 text-center">
        Position the barcode within the frame to scan
      </p>

      <style jsx>{`
        @keyframes scan {
          0%, 100% {
            top: 0;
          }
          50% {
            top: calc(100% - 4px);
          }
        }
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
