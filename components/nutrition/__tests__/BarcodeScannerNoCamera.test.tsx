/**
 * When the camera can't start, manual barcode entry becomes the primary
 * option with a friendly line — not a small "Camera unavailable" error.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockStart = jest.fn();
jest.mock('html5-qrcode', () => ({
  Html5Qrcode: jest.fn().mockImplementation(() => ({
    start: (...args: unknown[]) => mockStart(...args),
    stop: () => Promise.resolve(),
    getRunningTrackCameraCapabilities: () => ({
      torchFeature: () => ({ isSupported: () => false }),
    }),
  })),
  Html5QrcodeSupportedFormats: { EAN_13: 0, EAN_8: 1, UPC_A: 2, UPC_E: 3, CODE_128: 4, CODE_39: 5 },
}));

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false },
}));
jest.mock('@/lib/supabase/client', () => ({ createUntypedClient: jest.fn() }));
jest.mock('@/services/openFoodFactsService', () => ({ lookupBarcode: jest.fn() }));
jest.mock('@/lib/actions/nutrition', () => ({ lookupBarcodeUsdaAction: jest.fn() }));

import { BarcodeScanner, canRetryCamera, classifyCameraError, precheckWebCamera } from '../BarcodeScanner';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('classifyCameraError', () => {
  it('sorts camera failures into denied / missing / failed', () => {
    expect(classifyCameraError(new Error('Permission denied'))).toBe('denied');
    expect(classifyCameraError(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toBe('denied');
    expect(classifyCameraError('NotFoundError: Requested device not found')).toBe('missing');
    expect(classifyCameraError(new Error('Camera streaming not supported by the browser.'))).toBe('missing');
    expect(classifyCameraError(new Error('Could not start video source'))).toBe('failed');
  });
});

describe('BarcodeScanner without a camera', () => {
  it('leads with manual entry and a friendly line', async () => {
    mockStart.mockRejectedValue(new Error('NotFoundError: Requested device not found'));
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    expect(await screen.findByText('Type the barcode number')).toBeInTheDocument();
    expect(screen.getByLabelText('Barcode number')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Look up barcode' })).toBeInTheDocument();
    // Says plainly that a typed number is looked up, like a scan.
    expect(screen.getByTestId('barcode-typed-lookup-note')).toHaveTextContent(
      'We look the number up in the food database, just like a scan'
    );
    // No small error line, no duplicate manual field, no "Start camera" hero.
    expect(screen.queryByText(/Camera unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText('Or enter barcode manually:')).not.toBeInTheDocument();
    expect(screen.queryByText('Start camera scanner')).not.toBeInTheDocument();
  });

  it('hides "Try the camera again" when there is no camera to retry', async () => {
    mockStart.mockRejectedValue(new Error('NotFoundError: Requested device not found'));
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    await screen.findByTestId('barcode-manual-first');
    expect(screen.queryByRole('button', { name: 'Try the camera again' })).not.toBeInTheDocument();
  });

  it('keeps the retry when access was only denied (it can be allowed)', async () => {
    mockStart.mockRejectedValue(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    expect(await screen.findByRole('button', { name: 'Try the camera again' })).toBeInTheDocument();
    expect(screen.getByTestId('barcode-camera-issue-detail')).toHaveTextContent('Camera access is off');
  });

  it('canRetryCamera: only a missing camera has nothing to retry', () => {
    expect(canRetryCamera('missing')).toBe(false);
    expect(canRetryCamera('denied')).toBe(true);
    expect(canRetryCamera('failed')).toBe(true);
  });

  it('looks up a typed barcode', async () => {
    const user = userEvent.setup();
    mockStart.mockRejectedValue(new Error('NotFoundError'));
    const onScan = jest.fn().mockResolvedValue(undefined);
    render(<BarcodeScanner onClose={jest.fn()} onScan={onScan} />);

    await user.type(await screen.findByLabelText('Barcode number'), '0123456789012');
    await user.click(screen.getByRole('button', { name: 'Look up barcode' }));
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('0123456789012'));
  });

  it('retries the camera on request after a failed start', async () => {
    const user = userEvent.setup();
    mockStart
      .mockRejectedValueOnce(new Error('Could not start video source'))
      .mockReturnValue(new Promise(() => {}));
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Try the camera again' }));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('barcode-manual-first')).not.toBeInTheDocument();
  });
});

describe('BarcodeScanner with a camera', () => {
  it('keeps typed entry secondary: collapsed until "Type the number"', async () => {
    const user = userEvent.setup();
    mockStart.mockReturnValue(new Promise(() => {}));
    render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);

    expect(screen.queryByLabelText('Barcode number')).not.toBeInTheDocument();
    // No duplicate inner title / close button: the sheet's tab names this view.
    expect(screen.queryByText('Scan barcode')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Type the number' }));
    expect(screen.getByLabelText('Barcode number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Type the number' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('starts the camera by default when the device lists one', async () => {
    mockStart.mockReturnValue(new Promise(() => {}));
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve([{ kind: 'videoinput' }, { kind: 'audioinput' }]) },
    });
    try {
      render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('barcode-manual-first')).not.toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });
});

describe('precheckWebCamera', () => {
  it('reports a missing camera only when devices are listed and none is video', async () => {
    const nav = (devices: Array<{ kind: string }>) => ({
      mediaDevices: { enumerateDevices: () => Promise.resolve(devices) },
    });
    expect(await precheckWebCamera(nav([{ kind: 'audioinput' }]))).toBe('missing');
    expect(await precheckWebCamera(nav([{ kind: 'videoinput' }]))).toBeNull();
    // An empty list (some browsers before permission) is not proof.
    expect(await precheckWebCamera(nav([]))).toBeNull();
    expect(await precheckWebCamera({})).toBeNull();
    expect(await precheckWebCamera(undefined)).toBeNull();
    expect(
      await precheckWebCamera({ mediaDevices: { enumerateDevices: () => Promise.reject(new Error('nope')) } })
    ).toBeNull();
  });
});

describe('BarcodeScanner on a computer without a webcam', () => {
  it('says so straight away and never asks for the camera', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve([{ kind: 'audioinput' }, { kind: 'audiooutput' }]) },
    });
    try {
      render(<BarcodeScanner onClose={jest.fn()} onProductFound={jest.fn()} />);
      expect(
        await screen.findByText('Type the barcode number')
      ).toBeInTheDocument();
      expect(screen.getByTestId('barcode-camera-issue-detail')).toHaveTextContent(
        'on a phone, Scan opens the camera'
      );
      expect(screen.getByLabelText('Barcode number')).toBeInTheDocument();
      expect(mockStart).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });
});
