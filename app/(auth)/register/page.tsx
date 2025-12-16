'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card, Select } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import type { Goal, Experience } from '@/types/schema';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [goal, setGoal] = useState<Goal>('maintenance');
  const [experience, setExperience] = useState<Experience>('intermediate');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

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
        router.push('/login?message=Check your email to confirm your account');
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
          <span className="text-2xl font-bold text-white tracking-tight">HyperTrack</span>
        </Link>
      </div>

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
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            hint="At least 6 characters"
            autoComplete="new-password"
          />

          <Input
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="new-password"
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

      <div className="mt-4 text-center">
        <p className="text-xs text-surface-600">
          By signing up, you agree to our Terms of Service
        </p>
      </div>
    </div>
  );
}

