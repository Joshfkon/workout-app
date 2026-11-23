/**
 * Which secondary Progress sections a viewer has hidden (pure helpers).
 *
 * A per-viewer convenience, so it lives in localStorage (CLAUDE.md): it can
 * come back empty or throw (private window, blocked site data), and every
 * read and write here swallows that — the page then just shows the section.
 */

export type ProgressSectionId = 'strength-level' | 'photos' | 'phase';

export const SECTION_COLLAPSE_KEY_PREFIX = 'ht:progress-section-hidden:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSectionHidden(id: ProgressSectionId, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(SECTION_COLLAPSE_KEY_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

export function writeSectionHidden(
  id: ProgressSectionId,
  hidden: boolean,
  storage: StorageLike | null = defaultStorage()
): void {
  try {
    if (hidden) storage?.setItem(SECTION_COLLAPSE_KEY_PREFIX + id, '1');
    else storage?.removeItem(SECTION_COLLAPSE_KEY_PREFIX + id);
  } catch {
    // Storage unavailable: the choice lasts for this visit only.
  }
}
