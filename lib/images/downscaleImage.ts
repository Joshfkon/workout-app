/**
 * Client-side image downscaling for photo uploads.
 *
 * Screenshots and modern phone photos are routinely larger than upload
 * limits (an iPhone screenshot is a lossless PNG that can exceed 10MB).
 * Rather than reject them, re-encode to a bounded-size JPEG.
 */

export interface DownscaleOptions {
  /** Longest edge of the output image, in pixels. */
  maxEdge: number;
  /** Initial JPEG quality (0–1). Stepped down if the result is still too big. */
  quality?: number;
  /** Upper bound for the encoded output, in bytes. */
  maxBytes: number;
}

export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeToDrawable(
  file: Blob
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }
  // Older WebViews: fall back to an <img> element.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Re-encode an image as a JPEG no larger than `maxEdge` on its longest side
 * and no larger than `maxBytes` on disk. Returns `null` when the image cannot
 * be decoded or cannot be brought under `maxBytes`.
 *
 * Transparency is flattened onto white (progress photos have no meaningful
 * alpha channel).
 */
export async function downscaleImageToJpeg(
  file: File,
  { maxEdge, quality = 0.85, maxBytes }: DownscaleOptions
): Promise<File | null> {
  let decoded: Awaited<ReturnType<typeof decodeToDrawable>>;
  try {
    decoded = await decodeToDrawable(file);
  } catch {
    return null;
  }

  try {
    const { width, height } = computeScaledDimensions(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // PNG screenshots can carry transparency; JPEG has none, so flatten.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);

    // Step quality down until the encode fits, with a sane floor.
    for (let q = quality; q >= 0.5; q -= 0.15) {
      const blob = await canvasToJpegBlob(canvas, q);
      if (!blob) return null;
      if (blob.size <= maxBytes) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
        return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
      }
    }
    return null;
  } finally {
    decoded.cleanup();
  }
}
