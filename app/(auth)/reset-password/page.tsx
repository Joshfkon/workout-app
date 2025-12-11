'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Card } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
  const [isProcessingToken, setIsProcessingToken] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const handleRecovery = async () => {
      const supabase = createClient();
      
      // Check if there's a hash fragment with tokens (Supabase recovery link format)
      if (typeof window !== 'undefined' && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');
        
        if (type === 'recovery' && accessToken) {
          // Set the session from the recovery tokens
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          });
          
          if (!error) {
            setIsValidSession(true);
            setIsProcessingToken(false);
            // Clear the hash from URL for cleaner appearance
            window.history.replaceState(null, '', window.location.pathname);
            return;
          }
        }
      }
      
      // Check for existing session (in case user already has one)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setIsValidSession(true);
        setIsProcessingToken(false);
        return;
      }
      
      // Listen for PASSWORD_RECOVERY event
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
          setIsValidSession(true);
          setIsProcessingToken(false);
        } else if (event === 'SIGNED_IN' && session) {
          // User signed in through recovery
          setIsValidSession(true);
          setIsProcessingToken(false);
        }
      });
      
      // Give it a moment to process any auth events
      setTimeout(() => {
        setIsProcessingToken(false);
      }, 2000);
      
      return () => subscription.unsubscribe();
    };
    
    handleRecovery();
  }, []);

  // Update isValidSession when processing is done
  useEffect(() => {
    if (!isProcessingToken && isValidSession === null) {
      setIsValidSession(false);
    }
  }, [isProcessingToken, isValidSession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
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
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess(true);
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          router.push('/dashboard');
        }, 2000);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while processing token
  if (isProcessingToken || isValidSession === null) {
    return (
      <div className="w-full max-w-md animate-fade-in">
        <Card variant="elevated" className="p-6 text-center">
          <div className="space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-primary-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <p className="text-surface-400">Verifying reset link...</p>
          </div>
        </Card>
      </div>
    );
  }

  // Invalid or expired session
  if (!isValidSession) {
    return (
      <div className="w-full max-w-md animate-fade-in">
        <Card variant="elevated" className="p-6 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-warning-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-surface-100">Invalid or expired link</h2>
          <p className="text-surface-400">
            This password reset link is invalid or has expired. Please request a new one.
          </p>
          <Link href="/forgot-password">
            <Button className="mt-4">Request New Link</Button>
          </Link>
        </Card>
      </div>
    );
  }

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
        {success ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-success-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">Password updated!</h2>
            <p className="text-surface-400">
              Your password has been successfully reset. Redirecting you to the dashboard...
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-surface-100">Set new password</h1>
              <p className="text-surface-400 mt-1">
                Enter your new password below
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="New Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                hint="Must be at least 6 characters"
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

              {error && (
                <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
                  <p className="text-sm text-danger-400">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full" isLoading={isLoading}>
                Reset Password
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
