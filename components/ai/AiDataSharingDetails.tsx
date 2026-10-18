import Link from 'next/link';

/**
 * What goes to which AI provider. Shown in the one-time consent prompt and the
 * Settings card so the user sees the same disclosure both times (App Store
 * Review Guideline 5.1.2(i)). Keep in sync with "AI Processing" in
 * app/privacy/page.tsx and the providers called from lib/actions.
 */
export function AiDataSharingDetails() {
  return (
    <div className="space-y-3 text-sm text-surface-300">
      <p>
        Some HyperTrack features use outside AI services. To use them, the app sends the data
        below to that provider. Nothing is sent unless you allow it.
      </p>
      <ul className="space-y-2">
        <li>
          <span className="font-medium text-surface-100">xAI (Grok)</span>: AI coach chat, workout
          coach notes and plan reviews. Sends your training history, body stats, goals and the
          messages you write.
        </li>
        <li>
          <span className="font-medium text-surface-100">Anthropic (Claude)</span>: meal
          descriptions, food-label scans, progress-photo body-fat estimates and new exercise
          details. Sends the text, photos and body stats used by that feature.
        </li>
      </ul>
      <p className="text-xs text-surface-500">
        The data is sent only to answer your request, and HyperTrack does not use it to train AI
        models. You can change this any time in Settings → Profile.{' '}
        <Link href="/privacy" className="text-primary-400 hover:text-primary-300 underline">
          Privacy Policy
        </Link>
      </p>
    </div>
  );
}
