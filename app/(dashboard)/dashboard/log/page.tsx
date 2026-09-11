/**
 * /dashboard/log — redirect to /dashboard/train.
 *
 * This route previously served as a "quick actions" landing page but created
 * information architecture confusion:
 * - Metadata said "Train" but heading said "Log"
 * - Duplicate start-workout CTAs with /dashboard/train
 * - Bottom nav didn't highlight Train (standalone surface)
 *
 * Unified as of 2026-09: /dashboard/train is the single workout home.
 * This redirect preserves deep links and Capacitor routing.
 */

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Train',
};

export default function LogPageRedirect() {
  redirect('/dashboard/train');
}
