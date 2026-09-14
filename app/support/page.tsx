import Link from 'next/link';
import type { Metadata } from 'next';
import { PublicAppShell } from '@/components/marketing/PublicAppShell';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with HyperTrack.',
};

const SUPPORT_EMAIL = 'support@hypertrack.app';

export default function SupportPage() {
  return (
    <PublicAppShell>
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-black text-surface-100 mb-2">Support</h1>
        <p className="text-surface-400 mb-10">We&apos;re here to help.</p>

        <div className="space-y-10 text-surface-300 leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-2xl font-bold text-surface-100">Contact Us</h2>
            <p>
              For support, questions, or feedback, please email us at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary-400 hover:underline">
                {SUPPORT_EMAIL}
              </a>
              . We aim to respond within 24-48 hours.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-bold text-surface-100">Common Questions</h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">How do I reset my password?</h3>
                <p className="text-sm text-surface-400">
                  Use the &ldquo;Forgot Password&rdquo; link on the login page. You&apos;ll receive a password reset email.
                </p>
              </div>

              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">How do I delete my account?</h3>
                <p className="text-sm text-surface-400">
                  Log in and go to <em>Settings → Account → Delete Account</em>. This permanently deletes your data.
                </p>
              </div>

              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">Where can I manage my subscription?</h3>
                <p className="text-sm text-surface-400">
                  Subscriptions are managed on the web at <em>Settings → Subscription</em>. The mobile app does not sell or manage subscriptions.
                </p>
              </div>

              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">How do I disconnect a wearable integration?</h3>
                <p className="text-sm text-surface-400">
                  Go to <em>Analytics → Activity card → Connect Wearable button</em>, then disconnect from the modal.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-2xl font-bold text-surface-100">Additional Resources</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <Link href="/privacy" className="text-primary-400 hover:underline">
                  Privacy Policy
                </Link>
                {' — How we collect and use your data'}
              </li>
              <li>
                <Link href="/terms" className="text-primary-400 hover:underline">
                  Terms of Service
                </Link>
                {' — The terms governing your use of HyperTrack'}
              </li>
              <li>
                <Link href="/learn" className="text-primary-400 hover:underline">
                  Learn
                </Link>
                {' — Educational content about training and nutrition'}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </PublicAppShell>
  );
}
