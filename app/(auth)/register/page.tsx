'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { Button, Input, Card } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import type { Goal } from '@/types/schema';
import { TRACKING_FOCUS_METADATA_KEY } from '@/lib/onboarding/trackingFocus';
import {
  LIFTING_OPTIONS,
  experienceForLiftingAnswer,
  LIFTING_ANSWER_METADATA_KEY,
  type LiftingAnswer,
} from '@/lib/onboarding/experienceOptions';
import { TextSizeQuickPicker } from '@/components/settings/TextSizeQuickPicker';

/*
 * "Do you lift weights?" is asked in plain language so it doesn't assume
 * lifting is why someone signed up: "No, food tracking" is a real answer, and
 * it tells Home to lead with food (lib/onboarding/trackingFocus). The finer
 * year ranges and their mapping onto the experience enum live in
 * lib/onboarding/experienceOptions. The question stays here (not in
 * onboarding) because the food-tracking answer shapes onboarding itself.
 */

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Goal is chosen in onboarding (with an explanation); sign-up sends the
  // neutral default so the profile row is complete either way.
  const goal: Goal = 'maintenance';
  // Optional: null = skipped, which signs up as SKIPPED_EXPERIENCE
  // (lib/onboarding/experienceOptions).
  const [liftingAnswer, setLiftingAnswer] = useState<LiftingAnswer | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Address a confirmation email was sent to. Renders the post-signup screen
  // in place instead of bouncing to /login, so the user can see exactly which
  // address it went to and fix a typo (a typo'd signup email is otherwise an
  // unrecoverable dead account — the confirmation goes to a mailbox nobody
  // owns).
  const [sentTo, setSentTo] = useState<string | null>(null);
  const router = useRouter();
  // Synchronous guard: a double tap or Enter+click lands two submit events
  // before the isLoading re-render disables the button, and each would call
  // signUp. The ref flips in the same tick.
  const submittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
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

    submittingRef.current = true;
    setIsLoading(true);
    // A successful direct sign-in navigates away; keep the button busy until
    // the route changes instead of re-enabling it under the user's finger.
    let navigating = false;

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
            experience: experienceForLiftingAnswer(liftingAnswer),
            // The exact answer too, so onboarding shows it back instead of
            // asking about experience a second time.
            ...(liftingAnswer ? { [LIFTING_ANSWER_METADATA_KEY]: liftingAnswer } : {}),
            ...(liftingAnswer === 'no' ? { [TRACKING_FOCUS_METADATA_KEY]: 'food' } : {}),
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
      navigating = true;
      router.push('/onboarding');
      router.refresh();
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      if (!navigating) {
        submittingRef.current = false;
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="w-full max-w-md animate-fade-in">
      {/* Text size FIRST, above everything else on the page, so someone who
          finds the text small can fix it before reading the form. Same
          localStorage key as Settings, so the choice carries into the new
          account (hooks/useTextSize). */}
      <div
        className="mb-4 flex items-center justify-center gap-3 rounded-card bg-card/80 px-3 py-1 shadow-card"
        data-testid="register-text-size"
      >
        <span className="text-body font-medium text-ink">Text size</span>
        <TextSizeQuickPicker />
      </div>

      {/* Logo */}
      <div className="text-center mb-6">
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
            <p className="text-body text-ink-3">
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
                className="text-body text-action font-medium underline"
              >
                Wrong address? Change email
              </button>
            </div>
            <p className="text-body text-ink-2 pt-2">
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
          <p className="text-headline font-normal text-ink-2 mt-1">Track your workouts and your food in one place.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            inputSize="large"
            autoComplete="email"
          />

          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            hint="8+ characters with lowercase, uppercase letters, and digits"
            inputSize="large"
            autoComplete="new-password"
            rightIcon={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="-m-2 p-2 text-ink-2 hover:text-ink transition-colors"
              >
                {showPassword ? <IconEyeOff size={22} /> : <IconEye size={22} />}
              </button>
            }
          />

          {/* Optional, plain-language, nothing preselected. "No" is a real
              answer, not a skip: it leads Home with food. */}
          <div role="radiogroup" aria-labelledby="lifting-question" aria-describedby="lifting-hint">
            <p id="lifting-question" className="block text-headline font-medium text-ink mb-2">
              Do you lift weights? If so, for how long?{' '}
              <span className="text-ink-2 font-normal">(optional)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {LIFTING_OPTIONS.map((option, index) => {
                const checked = liftingAnswer === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    data-testid={`experience-option-${option.value}`}
                    // Tapping the picked option again clears it (back to "skip").
                    onClick={() => setLiftingAnswer(checked ? null : option.value)}
                    // "No" and "Just started" span the row; the year ranges pair up.
                    className={`${index < 2 ? 'col-span-2 ' : ''}min-h-[48px] px-2 rounded-input border-2 text-headline font-medium transition-colors ${
                      checked ? 'border-action bg-action/10 text-ink' : 'border-sep bg-fill/50 text-ink-2 hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p id="lifting-hint" className="text-body text-ink-2 mt-1">
              Sets your starting weekly sets and first weight suggestions (under a year also turns on
              Beginner mode). Change it any time in Settings. Not sure? Skip it.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-status-bad/10 border border-status-bad/20">
              {error === 'EMAIL_EXISTS' ? (
                <div>
                  <p className="text-body text-status-bad font-medium">
                    An account with this email already exists.
                  </p>
                  <p className="text-body text-ink-2 mt-1">
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
                <p className="text-body text-status-bad">{error}</p>
              )}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" isLoading={isLoading} aria-busy={isLoading}>
            {isLoading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-body text-ink-2">
            Already have an account?{' '}
            <Link href="/login" className="text-action font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </Card>
      )}

      <div className="mt-4 text-center space-y-2">
        <p className="text-body text-ink-2">
          Get full Elite access for 14 days—no credit card required.
        </p>
        <p className="text-subhead text-ink-2">
          By signing up, you agree to our{' '}
          <Link href="/terms" className="text-ink-2 hover:text-ink underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-ink-2 hover:text-ink underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}

