'use client';

import { useRouter } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';

interface SignOutButtonProps {
  className?: string;
  showOnMobile?: boolean;
}

export function SignOutButton({ className, showOnMobile = false }: SignOutButtonProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createUntypedClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  if (showOnMobile) {
    return (
      <button
        onClick={handleSignOut}
        className={className || "lg:hidden p-2 text-surface-400 hover:text-surface-200 transition-colors"}
        title="Sign Out"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={handleSignOut}
      className={className || "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"}
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
      Sign Out
    </button>
  );
}
