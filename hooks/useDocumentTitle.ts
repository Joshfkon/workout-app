import { useEffect } from 'react';

/**
 * Set document title for client components.
 * The root layout template automatically appends "| HyperTrack".
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | HyperTrack`;
    return () => {
      // Reset to default on unmount
      document.title = 'HyperTrack - Science-Based Workout Tracker';
    };
  }, [title]);
}
