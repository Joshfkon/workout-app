'use client';

import { LiftDetailScreen } from '@/components/analytics/LiftDetailScreen';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/** "a@b" arrives encoded on some paths ("a%40b"); decode once, safely. */
function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** One lift's screen, pushed from its row on Progress › Strength. */
export default function LiftPage({ params }: { params: { key: string } }) {
  useDocumentTitle('Lift');
  return <LiftDetailScreen seriesKey={decodeKey(params.key)} />;
}
