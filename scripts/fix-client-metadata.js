#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const clientComponentFiles = [
  'app/(dashboard)/dashboard/about/page.tsx',
  'app/(dashboard)/dashboard/ai-coach/page.tsx',
  'app/(dashboard)/dashboard/analytics/page.tsx',
  'app/(dashboard)/dashboard/blood-pressure/page.tsx',
  'app/(dashboard)/dashboard/body-composition/add/page.tsx',
  'app/(dashboard)/dashboard/body-composition/page.tsx',
  'app/(dashboard)/dashboard/coaching/page.tsx',
  'app/(dashboard)/dashboard/discover/[id]/page.tsx',
  'app/(dashboard)/dashboard/discover/page.tsx',
  'app/(dashboard)/dashboard/exercises/add/page.tsx',
  'app/(dashboard)/dashboard/exercises/page.tsx',
  'app/(dashboard)/dashboard/feed/page.tsx',
  'app/(dashboard)/dashboard/glossary/page.tsx',
  'app/(dashboard)/dashboard/history/page.tsx',
  'app/(dashboard)/dashboard/leaderboards/page.tsx',
  'app/(dashboard)/dashboard/learn/adaptive-tdee/page.tsx',
  'app/(dashboard)/dashboard/learn/adaptive-volume/page.tsx',
  'app/(dashboard)/dashboard/learn/data-explained/page.tsx',
  'app/(dashboard)/dashboard/learn/exercise-science/page.tsx',
  'app/(dashboard)/dashboard/learn/injury-prevention/page.tsx',
  'app/(dashboard)/dashboard/learn/mesocycle-science/page.tsx',
  'app/(dashboard)/dashboard/learn/page.tsx',
  'app/(dashboard)/dashboard/learn/progressive-overload/page.tsx',
  'app/(dashboard)/dashboard/learn/rpe-calibration/page.tsx',
  'app/(dashboard)/dashboard/learn/wearable-integration/page.tsx',
  'app/(dashboard)/dashboard/mesocycle/new/page.tsx',
  'app/(dashboard)/dashboard/mesocycle/page.tsx',
  'app/(dashboard)/dashboard/mesocycle/plan/page.tsx',
  'app/(dashboard)/dashboard/more/page.tsx',
  'app/(dashboard)/dashboard/motion/page.tsx',
  'app/(dashboard)/dashboard/nutrition/page.tsx',
  'app/(dashboard)/dashboard/phases/page.tsx',
  'app/(dashboard)/dashboard/pricing/page.tsx',
  'app/(dashboard)/dashboard/profile/edit/page.tsx',
  'app/(dashboard)/dashboard/profile/page.tsx',
  'app/(dashboard)/dashboard/profile/setup/page.tsx',
  'app/(dashboard)/dashboard/profile/[username]/page.tsx',
  'app/(dashboard)/dashboard/progress-photos/page.tsx',
  'app/(dashboard)/dashboard/recovery-debug/page.tsx',
  'app/(dashboard)/dashboard/science/page.tsx',
  'app/(dashboard)/dashboard/search/page.tsx',
  'app/(dashboard)/dashboard/settings/page.tsx',
  'app/(dashboard)/dashboard/templates/[id]/page.tsx',
  'app/(dashboard)/dashboard/templates/page.tsx',
  'app/(dashboard)/dashboard/train/page.tsx',
  'app/(dashboard)/dashboard/volume/page.tsx',
  'app/(dashboard)/dashboard/volume/review/page.tsx',
  'app/(dashboard)/dashboard/workout/[id]/page.tsx',
  'app/(dashboard)/dashboard/workout/new/page.tsx',
  'app/(dashboard)/dashboard/workout/quick/page.tsx',
];

// Skip files that are already fixed
const skipFiles = [
  'app/(dashboard)/dashboard/about/page.tsx',
  'app/(dashboard)/dashboard/ai-coach/page.tsx',
];

function extractTitle(content) {
  const match = content.match(/title:\s*'([^']+)'/);
  return match ? match[1] : null;
}

function findDefaultExportFunction(content) {
  const patterns = [
    /export default function (\w+)\(\)/,
    /export default function (\w+)\(/,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1];
  }
  return null;
}

clientComponentFiles.forEach(file => {
  if (skipFiles.includes(file)) {
    console.log(`Skipping ${file} (already fixed)`);
    return;
  }
  
  const filePath = path.join(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} (not found)`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Check if it has metadata export
  if (!content.includes('export const metadata')) {
    console.log(`Skipping ${file} (no metadata export)`);
    return;
  }
  
  const title = extractTitle(content);
  if (!title) {
    console.log(`Warning: Could not extract title from ${file}`);
    return;
  }
  
  console.log(`Fixing ${file} (title: "${title}")`);
  
  // Remove metadata import and export
  content = content.replace(/import type \{ Metadata \} from 'next';\n+/g, '');
  content = content.replace(/export const metadata: Metadata = \{[^}]+\};\n+/g, '');
  
  // Add useDocumentTitle import after other imports (before the first blank line or component)
  const firstImportMatch = content.match(/'use client';\n\n/);
  if (firstImportMatch) {
    const insertPoint = firstImportMatch.index + firstImportMatch[0].length;
    // Check if useDocumentTitle is already imported
    if (!content.includes('useDocumentTitle')) {
      const importStatement = `import { useDocumentTitle } from '@/hooks/useDocumentTitle';\n\n`;
      content = content.slice(0, insertPoint) + importStatement + content.slice(insertPoint);
    }
  }
  
  // Find the default export function and add useDocumentTitle call
  const functionName = findDefaultExportFunction(content);
  if (functionName) {
    const functionPattern = new RegExp(`(export default function ${functionName}[^{]*\\{\\s*)`, 's');
    const hookCall = `useDocumentTitle('${title}');\n  `;
    
    content = content.replace(functionPattern, `$1${hookCall}`);
  } else {
    console.log(`Warning: Could not find default export function in ${file}`);
  }
  
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`✓ Fixed ${file}`);
});

console.log('\nDone!');
