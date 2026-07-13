'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

type OtpKind = 'signup' | 'recovery';

/**
 * Email-OTP entry screen — the fallback that works no matter which device
 * opens the email. Emailed links break when opened in a different browser
 * than the one that started the flow (PKCE: the code verifier lives in the
 * original browser), but the 6-digit {{ .Token }} printed in the same email
 * verifies anywhere via verifyOtp(). The auth callback routes its failure
 * cases here instead of dead-ending on "Authentication failed".
 */
export default function VerifyCodePage() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [kind, setKind] = useState<OtpKind>('signup');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Read from window.location instead of useSearchParams() so the page
    // doesn't need a Suspense boundary (same pattern as the login page).
    const params = new URLSearchParams(window.location.search);
    if (params.get('type') === 'recovery') setKind('recovery');
    setReason(params.get('reason') || '');
    // Email prefill comes via sessionStorage rather than a query param so the
    // address doesn't land in browser history or access logs.
    try {
      const pending =
        sessionStorage.getItem('ht-pending-recovery-email') ||
        sessionStorage.getItem('ht-pending-confirmation-email');
      if (pending) setEmail(pending);
    } catch {
      // Storage unavailable — skip the prefill.
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanToken = token.replace(/\s/g, '');
    if (!/^\d{6}$/.test(cleanToken)) {
      setError('Enter the 6-digit code from the email.');
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: kind,
        email,
        token: cleanToken,
      });

      if (verifyError) {
        const msg = verifyError.message.toLowerCase();
        if (msg.includes('expired') || msg.includes('invalid')) {
          setError(
            'That code is invalid or has expired. Codes are valid for 1 hour and only the most recent email counts — request a new one below.'
          );
        } else if (/fetch|network/.test(msg)) {
          setError('Can’t reach the server — check your connection and try again.');
        } else {
          setError('Verification failed. Please try again.');
        }
        return;
      }

      // Verified: the email is now confirmed and a session exists on THIS
      // device. Recovery continues to the new-password form; signup goes
      // straight into the app.
      try {
        sessionStorage.removeItem('ht-pending-confirmation-email');
        sessionStorage.removeItem('ht-pending-recovery-email');
      } catch {
        // Storage unavailable — nothing to clean up.
      }
      router.push(kind === 'recovery' ? '/reset-password' : '/onboarding');
      router.refresh();
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const banner =
    reason === 'cross_device'
      ? 'Opened the email on a different device? Links only work in the browser that started the process — the 6-digit code from the same email works here.'
      : reason === 'link_expired'
        ? 'That link has expired or was already used. If you have a newer email, enter its 6-digit code — or request a fresh one below.'
        : reason === 'link_failed'
          ? 'That link didn’t work, but the 6-digit code from the same email will.'
          : '';

  const resendHref = kind === 'recovery' ? '/forgot-password' : '/login';
  const resendLabel =
    kind === 'recovery' ? 'Request a new reset email' : 'Resend the confirmation email';

  return (
    <div className="w-full max-w-md animate-fade-in">
      {/* Logo */}
      <div className="text-center mb-8">
        <Link href="/" className="inline-flex items-center gap-3 group">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center group-hover:scale-105 transition-transform">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-2xl font-bold text-surface-100 tracking-tight">HyperTrack</span>
        </Link>
      </div>

      <Card variant="elevated" className="p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-surface-100">
            {kind === 'recovery' ? 'Enter your reset code' : 'Enter your confirmation code'}
          </h1>
          <p className="text-surface-400 mt-1">
            The email we sent contains a 6-digit code under the button.
          </p>
        </div>

        {banner && (
          <div role="status" className="p-3 rounded-lg mb-4 bg-warning-500/10 border border-warning-500/20">
            <p className="text-sm text-warning-400">{banner}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />

          <Input
            label="6-digit code"
            type="text"
            inputMode="numeric"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456"
            required
            autoComplete="one-time-code"
          />

          {error && (
            <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
              <p className="text-sm text-danger-400">{error}</p>
            </div>
          )}

          <Button type="submit" className="w-full" isLoading={isLoading}>
            {kind === 'recovery' ? 'Verify & Set New Password' : 'Confirm Account'}
          </Button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-surface-400">
            Don&apos;t have a code?{' '}
            <Link href={resendHref} className="text-primary-400 hover:text-primary-300 font-medium">
              {resendLabel}
            </Link>
          </p>
          <Link
            href="/login"
            className="inline-flex items-center text-sm text-primary-400 hover:text-primary-300 font-medium"
          >
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to login
          </Link>
        </div>
      </Card>
    </div>
  );
}
