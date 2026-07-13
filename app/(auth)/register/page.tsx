'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { Button, Input, Card, Select } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import type { Goal, Experience } from '@/types/schema';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [goal, setGoal] = useState<Goal>('maintenance');
  const [experience, setExperience] = useState<Experience>('intermediate');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Address a confirmation email was sent to. Renders the post-signup screen
  // in place instead of bouncing to /login, so the user can see exactly which
  // address it went to and fix a typo (a typo'd signup email is otherwise an
  // unrecoverable dead account — the confirmation goes to a mailbox nobody
  // owns).
  const [sentTo, setSentTo] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation (P2-6: no confirm-password field — the show-password
    // toggle lets users verify what they typed instead of retyping it)
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      
      // Sign up user with redirect to production URL - include next param for onboarding
      const redirectUrl = `${window.location.origin}/auth/callback?next=/onboarding`;
      
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            goal,
            experience,
          },
        },
      });

      if (signUpError) {
        // Check for duplicate email error
        if (signUpError.message.toLowerCase().includes('already registered') ||
            signUpError.message.toLowerCase().includes('already exists') ||
            signUpError.message.toLowerCase().includes('user already') ||
            signUpError.status === 422) {
          setError('EMAIL_EXISTS');
        } else {
          setError(signUpError.message);
        }
        return;
      }

      // If email confirmation is required
      if (data.user && !data.session) {
        // Hand the email to login/verify-code via sessionStorage, not the
        // URL — a query param would put PII in browser history and access logs.
        try {
          sessionStorage.setItem('ht-pending-confirmation-email', email);
        } catch {
          // Storage unavailable (private mode etc.) — those pages just won't prefill.
        }
        setSentTo(email);
        return;
      }

      // Direct login successful - redirect to onboarding for new users
      router.push('/onboarding');
      router.refresh();
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

      {sentTo ? (
        <Card variant="elevated" className="p-6">
          <div className="text-center space-y-4" data-testid="confirmation-sent">
            <div className="w-16 h-16 mx-auto rounded-full bg-success-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">Confirm your email</h2>
            <p className="text-surface-400">
              We sent a confirmation link to{' '}
              <span className="text-surface-200 font-medium">{sentTo}</span>
            </p>
            <p className="text-sm text-surface-500">
              Not there after a couple of minutes? Check your spam folder. You can also enter the
              6-digit code from the email instead of clicking the link.
            </p>
            <div className="space-y-3 pt-2">
              <Link href="/verify-code?type=signup">
                <Button className="w-full">Enter code instead</Button>
              </Link>
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="text-sm text-primary-400 hover:text-primary-300 font-medium underline"
              >
                Wrong address? Change email
              </button>
            </div>
            <p className="text-sm text-surface-400 pt-2">
              Already confirmed?{' '}
              <Link href="/login" className="text-primary-400 hover:text-primary-300 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </Card>
      ) : (
      <Card variant="elevated" className="p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-surface-100">Create your account</h1>
          <p className="text-surface-400 mt-1">Start your hypertrophy journey</p>
        </div>

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
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            hint="At least 6 characters"
            autoComplete="new-password"
            rightIcon={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="-m-2 p-2 text-surface-400 hover:text-surface-200 transition-colors"
              >
                {showPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            }
          />

          <Select
            label="Primary Goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
            options={[
              { value: 'bulk', label: 'Build Muscle (Bulk)' },
              { value: 'maintenance', label: 'Maintain / Recomp' },
              { value: 'cut', label: 'Lose Fat (Cut)' },
            ]}
          />

          <Select
            label="Experience Level"
            value={experience}
            onChange={(e) => setExperience(e.target.value as Experience)}
            options={[
              { value: 'novice', label: 'Novice (< 1 year)' },
              { value: 'intermediate', label: 'Intermediate (1-3 years)' },
              { value: 'advanced', label: 'Advanced (3+ years)' },
            ]}
            hint="This affects your default volume landmarks"
          />

          {error && (
            <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
              {error === 'EMAIL_EXISTS' ? (
                <div>
                  <p className="text-sm text-danger-400 font-medium">
                    An account with this email already exists.
                  </p>
                  <p className="text-sm text-surface-400 mt-1">
                    <Link href="/login" className="text-primary-400 hover:text-primary-300 underline">
                      Sign in instead
                    </Link>
                    {' '}or{' '}
                    <Link href="/forgot-password" className="text-primary-400 hover:text-primary-300 underline">
                      reset your password
                    </Link>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-danger-400">{error}</p>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" isLoading={isLoading}>
            Create Account
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-surface-400">
            Already have an account?{' '}
            <Link href="/login" className="text-primary-400 hover:text-primary-300 font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </Card>
      )}

      <div className="mt-4 text-center">
        <p className="text-xs text-surface-600">
          By signing up, you agree to our{' '}
          <Link href="/terms" className="text-surface-500 hover:text-surface-300 underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-surface-500 hover:text-surface-300 underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}

