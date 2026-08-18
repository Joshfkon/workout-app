/**
 * Client-side composite "before / after" share card for progress photos.
 * Renders a 1080x1350 (4:5) JPEG — the standard portrait social ratio —
 * with the two photos side by side and a stats caption bar.
 *
 * Images are fetched as blobs and decoded via createImageBitmap so the
 * canvas is never tainted by cross-origin signed URLs.
 */

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const CAPTION_BAR_HEIGHT = 120;

export interface ShareCardInput {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel: string;
  afterLabel: string;
  /** e.g. "224 days apart · −4.2 kg · −3.1% BF" */
  caption: string;
}

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load photo');
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/** drawImage with object-fit: cover semantics. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (bitmap.width - sw) / 2;
  const sy = (bitmap.height - sh) / 2;
  ctx.drawImage(bitmap, sx, sy, sw, sh, x, y, w, h);
}

function drawChip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 16;
  const height = 44;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.beginPath();
  ctx.roundRect(x, y, metrics.width + padX * 2, height, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y + height / 2 + 2);
}

export async function buildShareCard({
  beforeUrl,
  afterUrl,
  beforeLabel,
  afterLabel,
  caption,
}: ShareCardInput): Promise<Blob | null> {
  const [beforeBitmap, afterBitmap] = await Promise.all([
    fetchBitmap(beforeUrl),
    fetchBitmap(afterUrl),
  ]);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    const photoHeight = CARD_HEIGHT - CAPTION_BAR_HEIGHT;
    const half = CARD_WIDTH / 2;
    drawCover(ctx, beforeBitmap, 0, 0, half - 2, photoHeight);
    drawCover(ctx, afterBitmap, half + 2, 0, half - 2, photoHeight);

    drawChip(ctx, beforeLabel, 20, 20);
    const afterMetrics = (() => {
      ctx.font = '600 28px system-ui, -apple-system, sans-serif';
      return ctx.measureText(afterLabel);
    })();
    drawChip(ctx, afterLabel, CARD_WIDTH - 20 - (afterMetrics.width + 32), 20);

    // Caption bar
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, photoHeight, CARD_WIDTH, CAPTION_BAR_HEIGHT);
    ctx.fillStyle = '#f5f5f5';
    ctx.font = '600 34px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, CARD_WIDTH / 2, photoHeight + CAPTION_BAR_HEIGHT / 2 - 12);
    ctx.fillStyle = '#737373';
    ctx.font = '500 22px system-ui, -apple-system, sans-serif';
    ctx.fillText('HyperTrack', CARD_WIDTH / 2, photoHeight + CAPTION_BAR_HEIGHT - 26);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );
  } finally {
    beforeBitmap.close();
    afterBitmap.close();
  }
}

/** Share via the native sheet when available, otherwise download. */
export async function shareOrDownloadCard(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/jpeg' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      // User cancelled the sheet — nothing to do.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Fall through to download for anything else.
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
