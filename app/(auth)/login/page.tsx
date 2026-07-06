'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Banner from redirects like /login?message=... (post-register confirmation,
  // auth-callback failures). Read from window.location instead of
  // useSearchParams() so the page doesn't need a Suspense boundary.
  const [infoMessage, setInfoMessage] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get('message');
    if (message) {
      setInfoMessage(message);
      if (message.toLowerCase().includes('check your email')) {
        setNeedsConfirmation(true);
      }
    }
    // Post-register prefill comes via sessionStorage rather than a query
    // param so the email doesn't land in browser history or access logs.
    try {
      const pendingEmail = sessionStorage.getItem('ht-pending-confirmation-email');
      if (pendingEmail) setEmail(pendingEmail);
    } catch {
      // Storage unavailable — skip the prefill.
    }
  }, []);

  const handleResendConfirmation = async () => {
    if (!email) {
      setResendStatus('error');
      return;
    }
    setResendStatus('sending');
    try {
      const supabase = createClient();
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        },
      });
      setResendStatus(resendError ? 'error' : 'sent');
    } catch {
      setResendStatus('error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Map raw Supabase strings to human copy (P2-3)
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid login credentials')) {
          setError('Email or password is incorrect. Try again or reset your password.');
        } else if (msg.includes('missing email')) {
          setError('Please enter your email address.');
        } else if (msg.includes('email not confirmed')) {
          setError('Please confirm your email first — check your inbox for the confirmation link.');
          setNeedsConfirmation(true);
        } else if (/fetch|network/.test(msg)) {
          setError('Can’t reach the server — check your connection and try again.');
        } else {
          setError('Sign-in failed. Please try again.');
        }
      } else {
        try {
          sessionStorage.removeItem('ht-pending-confirmation-email');
        } catch {
          // Storage unavailable — nothing to clean up.
        }
        router.push('/dashboard/log');
        router.refresh();
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

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
          <h1 className="text-2xl font-bold text-surface-100">Welcome back</h1>
          <p className="text-surface-400 mt-1">Sign in to continue your training</p>
        </div>

        {infoMessage && (
          <div
            role="status"
            className={`p-3 rounded-lg mb-4 border ${
              needsConfirmation
                ? 'bg-success-500/10 border-success-500/20'
                : 'bg-danger-500/10 border-danger-500/20'
            }`}
          >
            <p className={`text-sm font-medium ${needsConfirmation ? 'text-success-400' : 'text-danger-400'}`}>
              {infoMessage}
            </p>
            {needsConfirmation && (
              <p className="text-sm text-surface-400 mt-1">
                You need to confirm your email before signing in.
              </p>
            )}
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

          <div>
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
            <div className="mt-1 text-right">
              <Link href="/forgot-password" className="text-xs text-primary-400 hover:text-primary-300">
                Forgot password?
              </Link>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
              <p className="text-sm text-danger-400">{error}</p>
            </div>
          )}

          {needsConfirmation && (
            <div className="text-center">
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendStatus === 'sending' || resendStatus === 'sent'}
                className="text-sm text-primary-400 hover:text-primary-300 font-medium underline disabled:opacity-60 disabled:no-underline"
              >
                {resendStatus === 'sending'
                  ? 'Sending…'
                  : resendStatus === 'sent'
                    ? 'Confirmation email sent ✓'
                    : 'Resend confirmation email'}
              </button>
              {resendStatus === 'error' && (
                <p className="text-xs text-danger-400 mt-1">
                  {email
                    ? 'Could not resend the email. Please try again in a minute.'
                    : 'Enter your email above first, then tap resend.'}
                </p>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" isLoading={isLoading}>
            Sign In
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-surface-400">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-primary-400 hover:text-primary-300 font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </Card>

    </div>
  );
}

