/**
 * Zero-dependency .env loader for the standalone scripts.
 *
 * Scripts run outside Next.js, so they don't get Next's automatic env loading.
 * This reads `.env.local` then `.env` from the current directory and populates
 * process.env for any key not already set (real environment wins over files,
 * and `.env.local` wins over `.env`). No dependency on dotenv.
 *
 * Both files are gitignored (`.env` / `.env*.local`), so secrets stay local.
 */
import * as fs from 'fs';
import * as path from 'path';

function parseAndApply(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.replace(/^export\s+/, '');
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue; // don't override
    let value = withoutExport.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** Load `.env.local` then `.env` from cwd (call once, before reading env). */
export function loadEnv(): void {
  const cwd = process.cwd();
  parseAndApply(path.join(cwd, '.env.local'));
  parseAndApply(path.join(cwd, '.env'));
}
