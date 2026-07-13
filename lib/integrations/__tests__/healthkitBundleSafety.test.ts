/**
 * Web-bundle firewall for the HealthKit plugin.
 *
 * The native plugin must NEVER be statically imported: webpack would then
 * bundle it into the web/PWA build. The only sanctioned reference is the
 * Function-constructed dynamic import inside lib/integrations/healthkit.ts
 * (invisible to webpack's static analysis). This test walks the entire app
 * source and fails on any static import/require of the plugin package —
 * which is what would put HealthKit code into the web bundle.
 */

import * as fs from 'fs';
import * as path from 'path';
import { HEALTHKIT_PLUGIN_PACKAGE } from '@/lib/integrations/healthkit';

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'stores', 'types'];
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

describe('HealthKit web-bundle safety', () => {
  const staticImportPatterns = [
    // import ... from '@capgo/capacitor-health'  /  export ... from ...
    new RegExp(`(import|export)[^;]*from\\s+['"]${HEALTHKIT_PLUGIN_PACKAGE}['"]`),
    // bare side-effect import
    new RegExp(`import\\s+['"]${HEALTHKIT_PLUGIN_PACKAGE}['"]`),
    // require('@capgo/capacitor-health')
    new RegExp(`require\\(\\s*['"]${HEALTHKIT_PLUGIN_PACKAGE}['"]\\s*\\)`),
    // literal dynamic import('@capgo/capacitor-health') — webpack still
    // creates a chunk for these; only the Function-constructed form is safe.
    new RegExp(`import\\(\\s*['"]${HEALTHKIT_PLUGIN_PACKAGE}['"]\\s*\\)`),
  ];

  it('no source file statically imports the native plugin', () => {
    const offenders: string[] = [];
    for (const dir of SOURCE_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        if (file.includes(`__tests__${path.sep}`)) continue;
        const content = fs.readFileSync(file, 'utf8');
        if (!content.includes(HEALTHKIT_PLUGIN_PACKAGE)) continue;
        if (staticImportPatterns.some((pattern) => pattern.test(content))) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the plugin package is referenced only from the gated integration module', () => {
    const referencingFiles: string[] = [];
    for (const dir of SOURCE_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        if (file.includes(`__tests__${path.sep}`)) continue;
        if (fs.readFileSync(file, 'utf8').includes(HEALTHKIT_PLUGIN_PACKAGE)) {
          referencingFiles.push(path.relative(ROOT, file));
        }
      }
    }
    expect(referencingFiles).toEqual([path.join('lib', 'integrations', 'healthkit.ts')]);
  });

  it('the integration module loads the plugin via a webpack-invisible dynamic import', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'lib', 'integrations', 'healthkit.ts'),
      'utf8'
    );
    expect(content).toContain("new Function('modulePath', 'return import(modulePath)')");
  });
});
