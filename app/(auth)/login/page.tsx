'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

const RESEND_COOLDOWN_SECONDS = 60;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Exactly one of these is ever shown: `error` is the red credentials/server
  // banner, `needsConfirmation` the amber confirm-your-email panel. Setting
  // one always clears the other — showing both at once was ticketed as
  // confusing ("is my password wrong or my email unconfirmed?").
  const [error, setError] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Banner from redirects like /login?message=... (non-confirmation messages
  // only). Read from window.location instead of useSearchParams() so the page
  // doesn't need a Suspense boundary.
  const [infoMessage, setInfoMessage] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendCooldown, setResendCooldown] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get('message');
    if (message) {
      if (message.toLowerCase().includes('check your email')) {
        setNeedsConfirmation(true);
      } else {
        setInfoMessage(message);
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

  // Tick the resend cooldown down once per second.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          setResendStatus('idle');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

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
      if (resendError) {
        setResendStatus('error');
      } else {
        setResendStatus('sent');
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch {
      setResendStatus('error');
    }
  };

  const goToVerifyCode = () => {
    try {
      if (email) sessionStorage.setItem('ht-pending-confirmation-email', email);
    } catch {
      // Storage unavailable — verify-code just won't prefill.
    }
    router.push('/verify-code?type=signup');
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
        if (msg.includes('email not confirmed')) {
          setNeedsConfirmation(true);
          setError('');
        } else {
          setNeedsConfirmation(false);
          if (msg.includes('invalid login credentials')) {
            setError('Email or password is incorrect. Try again or reset your password.');
          } else if (msg.includes('missing email')) {
            setError('Please enter your email address.');
          } else if (/fetch|network/.test(msg)) {
            setError('Can’t reach the server — check your connection and try again.');
          } else {
            setError('Sign-in failed. Please try again.');
          }
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

        {infoMessage && !needsConfirmation && (
          <div role="status" className="p-3 rounded-lg mb-4 bg-danger-500/10 border border-danger-500/20">
            <p className="text-sm font-medium text-danger-400">{infoMessage}</p>
          </div>
        )}

        {needsConfirmation && (
          <div
            role="status"
            data-testid="confirm-email-panel"
            className="p-3 rounded-lg mb-4 bg-warning-500/10 border border-warning-500/20"
          >
            <p className="text-sm font-medium text-warning-400">Confirm your email to sign in</p>
            <p className="text-sm text-surface-400 mt-1">
              {email ? (
                <>
                  We sent a confirmation link to{' '}
                  <span className="text-surface-200 font-medium">{email}</span>. Check your inbox
                  and spam folder.
                </>
              ) : (
                'Enter your email above, then resend the confirmation link.'
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendStatus === 'sending' || resendCooldown > 0}
                className="text-sm text-primary-400 hover:text-primary-300 font-medium underline disabled:opacity-60 disabled:no-underline"
              >
                {resendStatus === 'sending'
                  ? 'Sending…'
                  : resendCooldown > 0
                    ? `Sent ✓ — resend in ${resendCooldown}s`
                    : 'Resend confirmation email'}
              </button>
              <button
                type="button"
                onClick={goToVerifyCode}
                className="text-sm text-primary-400 hover:text-primary-300 font-medium underline"
              >
                Enter code instead
              </button>
            </div>
            {resendStatus === 'error' && (
              <p className="text-xs text-danger-400 mt-1">
                {email
                  ? 'Could not resend the email. Please try again in a minute.'
                  : 'Enter your email above first, then tap resend.'}
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

          {error && !needsConfirmation && (
            <div data-testid="login-error" className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
              <p className="text-sm text-danger-400">{error}</p>
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
