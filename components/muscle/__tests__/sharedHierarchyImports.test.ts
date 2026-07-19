/**
 * Import assertion: the muscle hierarchy (coarse rows + expandable fine
 * children) must be rendered by the ONE shared component on every surface.
 * This was copy-pasted into a third card once — never again. If a surface
 * stops importing MuscleGroupList (or grows its own chevron/children loop),
 * this test fails before the hierarchies can drift apart.
 */

import * as fs from 'fs';
import * as path from 'path';

const SHARED_IMPORT = "@/components/muscle/MuscleGroupList";

const SURFACES = [
  // Volume page ("This Week's Volume" bars)
  'app/(dashboard)/dashboard/volume/page.tsx',
  // In-workout Muscle Readiness sheet (+ empty-workout inline placement)
  'components/workout/MuscleReadinessSheet.tsx',
];

describe('shared muscle hierarchy (import assertion)', () => {
  it.each(SURFACES)('%s renders the hierarchy via MuscleGroupList', (file) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(source).toContain(SHARED_IMPORT);
    // Imported AND rendered (not just referenced for types).
    expect(source).toMatch(/<MuscleGroupList[\s\n]/);
  });
});
