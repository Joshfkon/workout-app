'use client';

import Link from 'next/link';

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 px-4 bg-surface-950/80 backdrop-blur-lg border-b border-surface-800">
        <div className="max-w-4xl mx-auto h-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center group-hover:scale-105 transition-transform">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-lg font-bold text-white">HyperTrack</span>
          </Link>
          
          <Link 
            href="/dashboard"
            className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
          >
            Skip for now →
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="pt-16 min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

