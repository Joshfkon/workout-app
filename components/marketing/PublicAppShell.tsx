'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ThemeToggleCompact } from '@/components/settings/ThemeToggle';

interface PublicAppShellProps {
  children: React.ReactNode;
  /** Optional className for the main content wrapper */
  contentClassName?: string;
}

export function PublicAppShell({ children, contentClassName }: PublicAppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col">
      {/* Top navigation */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 md:px-6 md:py-4 bg-surface-950/95 backdrop-blur-sm border-b border-surface-800/50">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-surface-100 tracking-tight">HyperTrack</span>
        </Link>

        {/* Desktop navigation */}
        <div className="hidden md:flex items-center gap-6">
          <Link href="/learn" className="text-sm font-medium text-surface-300 hover:text-surface-100 transition-colors">
            Learn
          </Link>
          <Link href="/pricing" className="text-sm font-medium text-surface-300 hover:text-surface-100 transition-colors">
            Pricing
          </Link>
          <Link href="/support" className="text-sm font-medium text-surface-300 hover:text-surface-100 transition-colors">
            Support
          </Link>
          <div className="w-px h-5 bg-surface-700" />
          <ThemeToggleCompact />
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-medium text-surface-300 hover:text-surface-100 transition-colors"
          >
            Login
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-500 hover:bg-primary-600 text-white transition-colors"
          >
            Sign Up
          </Link>
        </div>

        {/* Mobile menu button */}
        <div className="md:hidden flex items-center gap-2">
          <ThemeToggleCompact />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-surface-300 hover:text-surface-100 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-surface-900 border-b border-surface-800">
          <div className="px-4 py-4 space-y-3">
            <Link
              href="/learn"
              className="block px-3 py-2 text-sm font-medium text-surface-300 hover:text-surface-100 hover:bg-surface-800 rounded-lg transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              Learn
            </Link>
            <Link
              href="/pricing"
              className="block px-3 py-2 text-sm font-medium text-surface-300 hover:text-surface-100 hover:bg-surface-800 rounded-lg transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pricing
            </Link>
            <Link
              href="/support"
              className="block px-3 py-2 text-sm font-medium text-surface-300 hover:text-surface-100 hover:bg-surface-800 rounded-lg transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              Support
            </Link>
            <div className="border-t border-surface-800 pt-3 mt-3 space-y-2">
              <Link
                href="/login"
                className="block px-3 py-2 text-sm font-medium text-center text-surface-300 hover:text-surface-100 border border-surface-700 rounded-lg transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Login
              </Link>
              <Link
                href="/register"
                className="block px-3 py-2 text-sm font-medium text-center rounded-lg bg-primary-500 hover:bg-primary-600 text-white transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className={contentClassName}>
        {children}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-surface-800/50">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-sm text-surface-400">© 2026 HyperTrack</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <Link href="/privacy" className="text-surface-400 hover:text-surface-200 transition-colors">
                Privacy
              </Link>
              <Link href="/terms" className="text-surface-400 hover:text-surface-200 transition-colors">
                Terms
              </Link>
              <Link href="/support" className="text-surface-400 hover:text-surface-200 transition-colors">
                Support
              </Link>
              <Link href="/pricing" className="text-surface-400 hover:text-surface-200 transition-colors">
                Pricing
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
