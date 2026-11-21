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
  // Goal is chosen in onboarding (with an explanation); sign-up sends the
  // neutral default so the profile row is complete either way.
  const goal: Goal = 'maintenance';
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
    // Match the password policy in supabase/config.toml
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    // Check for lowercase, uppercase, and digits
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    
    if (!hasLowercase || !hasUppercase || !hasDigit) {
      setError('Password must contain lowercase, uppercase letters, and digits');
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
        // Distinguish weak password from duplicate email
        const errorMsg = signUpError.message.toLowerCase();
        if (errorMsg.includes('password') && 
            (errorMsg.includes('weak') || errorMsg.includes('strength') || errorMsg.includes('requirement'))) {
          setError('Password does not meet security requirements. Use 8+ characters with lowercase, uppercase letters, and digits.');
        } else if (errorMsg.includes('already registered') ||
                   errorMsg.includes('already exists') ||
                   errorMsg.includes('user already')) {
          setError('EMAIL_EXISTS');
        } else if (signUpError.status === 422) {
          // 422 could be weak password or duplicate - check message
          if (errorMsg.includes('email')) {
            setError('EMAIL_EXISTS');
          } else {
            setError('Password does not meet security requirements. Use 8+ characters with lowercase, uppercase letters, and digits.');
          }
        } else {
          setError(signUpError.message);
        }
        return;
      }

      // An email that's already registered comes back as a "success" with no
      // identities and no email sent (Supabase hides which emails exist).
      // Without this the page waits for a code that never arrives.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError('EMAIL_EXISTS');
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
          <div className="w-12 h-12 rounded-xl bg-action flex items-center justify-center group-hover:scale-105 transition-transform">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-title font-bold text-ink tracking-tight">HyperTrack</span>
        </Link>
      </div>

      {sentTo ? (
        <Card variant="elevated" className="p-6">
          <div className="text-center space-y-4" data-testid="confirmation-sent">
            <div className="w-16 h-16 mx-auto rounded-full bg-status-ok/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-status-ok" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-headline font-bold text-ink">Confirm your email</h2>
            <p className="text-ink-2">
              We sent a confirmation link to{' '}
              <span className="text-ink font-medium">{sentTo}</span>
            </p>
            <p className="text-subhead text-ink-3">
              Not there after a couple of minutes? Check your spam folder. You can also enter the
              code from the email instead of clicking the link.
            </p>
            <div className="space-y-3 pt-2">
              <Link href="/verify-code?type=signup">
                <Button className="w-full">Enter code instead</Button>
              </Link>
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="text-subhead text-action font-medium underline"
              >
                Wrong address? Change email
              </button>
            </div>
            <p className="text-subhead text-ink-2 pt-2">
              Already confirmed?{' '}
              <Link href="/login" className="text-action font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </Card>
      ) : (
      <Card variant="elevated" className="p-6">
        <div className="text-center mb-6">
          <h1 className="text-title font-bold text-ink">Create your account</h1>
          <p className="text-ink-2 mt-1">Start your hypertrophy journey</p>
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
            hint="8+ characters with lowercase, uppercase letters, and digits"
            autoComplete="new-password"
            rightIcon={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="-m-2 p-2 text-ink-2 hover:text-ink transition-colors"
              >
                {showPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            }
          />

          <Select
            label="Experience level"
            value={experience}
            onChange={(e) => setExperience(e.target.value as Experience)}
            options={[
              { value: 'novice', label: 'Novice (< 1 year)' },
              { value: 'intermediate', label: 'Intermediate (1-3 years)' },
              { value: 'advanced', label: 'Advanced (3+ years)' },
            ]}
            hint="Sets how much training we suggest to start"
          />

          {error && (
            <div className="p-3 rounded-lg bg-status-bad/10 border border-status-bad/20">
              {error === 'EMAIL_EXISTS' ? (
                <div>
                  <p className="text-subhead text-status-bad font-medium">
                    An account with this email already exists.
                  </p>
                  <p className="text-subhead text-ink-2 mt-1">
                    <Link href="/login" className="text-action underline">
                      Sign in instead
                    </Link>
                    {' '}or{' '}
                    <Link href="/forgot-password" className="text-action underline">
                      reset your password
                    </Link>
                  </p>
                </div>
              ) : (
                <p className="text-subhead text-status-bad">{error}</p>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" isLoading={isLoading}>
            Create account
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-subhead text-ink-2">
            Already have an account?{' '}
            <Link href="/login" className="text-action font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </Card>
      )}

      <div className="mt-4 text-center space-y-2">
        <p className="text-subhead text-ink-3">
          Get full Elite access for 14 days—no credit card required.
        </p>
        <p className="text-caption text-ink-3">
          By signing up, you agree to our{' '}
          <Link href="/terms" className="text-ink-3 hover:text-ink-2 underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-ink-3 hover:text-ink-2 underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}

