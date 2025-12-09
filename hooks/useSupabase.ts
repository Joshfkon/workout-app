'use client';

import { useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

/**
 * Hook to get a typed Supabase client for use in client components
 */
export function useSupabase() {
  const supabase = useMemo(() => createClient(), []);
  return supabase;
}

/**
 * Hook to get the current user from Supabase auth
 */
export function useAuth() {
  const supabase = useSupabase();

  const getUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  };

  const getSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signUpWithEmail = async (email: string, password: string, metadata?: object) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    if (error) throw error;
    return data;
  };

  return {
    supabase,
    getUser,
    getSession,
    signOut,
    signInWithEmail,
    signUpWithEmail,
  };
}

