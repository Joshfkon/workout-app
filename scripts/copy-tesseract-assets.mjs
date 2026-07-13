/**
 * Copies the tesseract.js worker + WASM core into public/ so the label-scanner
 * OCR runs fully self-hosted (no CDN): required for offline use and for the
 * Capacitor app bundle. Runs on postinstall so the copied files always match
 * the installed tesseract.js / tesseract.js-core versions.
 *
 * The copied files are gitignored; the English language data
 * (public/tessdata/eng.traineddata.gz) is committed since it doesn't come
 * from node_modules.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'tesseract');

// Only the LSTM cores are needed: the scanner initializes with OEM.LSTM_ONLY.
const assets = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
];

mkdirSync(outDir, { recursive: true });
for (const [src, dest] of assets) {
  const from = join(root, 'node_modules', src);
  if (!existsSync(from)) {
    console.warn(`[copy-tesseract-assets] missing ${src} — run npm install first`);
    process.exitCode = 1;
    continue;
  }
  copyFileSync(from, join(outDir, dest));
}
console.log(`[copy-tesseract-assets] copied ${assets.length} files to public/tesseract`);
