import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SplashProvider } from "@/components/providers/SplashProvider";
import { NativeAppBehavior } from "@/components/providers/NativeAppBehavior";
import { ServiceWorkerRegistration } from "@/components/providers/ServiceWorkerRegistration";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Use system font stack for instant text rendering (no font download blocking)
// This significantly improves LCP (Largest Contentful Paint) and FCP (First Contentful Paint)
const systemFontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const monoFontStack = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const metadata: Metadata = {
  title: {
    default: "HyperTrack - Science-Based Workout Tracker",
    template: "%s | HyperTrack",
  },
  description: "The intelligent hypertrophy training app with auto-regulation, volume tracking, AI coaching, and science-backed progression. Build muscle smarter.",
  keywords: ["workout tracker", "hypertrophy", "fitness app", "muscle building", "strength training", "gym app", "workout planner"],
  authors: [{ name: "HyperTrack" }],
  creator: "HyperTrack",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://hypertrack.app"),
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "HyperTrack",
    title: "HyperTrack - Science-Based Workout Tracker",
    description: "The intelligent hypertrophy training app with auto-regulation, volume tracking, AI coaching, and science-backed progression.",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "HyperTrack - Science-Based Workout Tracker",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HyperTrack - Science-Based Workout Tracker",
    description: "Build muscle smarter with AI-powered workout planning, auto-regulation, and science-backed progression.",
    images: ["/api/og"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: { url: "/apple-icon.png", type: "image/png", sizes: "180x180" },
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={{ backgroundColor: '#09090b' }}>
      <head>
        {/* No-FOUC theme: apply the saved theme before first paint. Default is dark
            (no attribute); only light needs the data-theme set. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`,
          }}
        />
        {/* DNS prefetch for Supabase - loaded dynamically */}
        <link rel="dns-prefetch" href="https://*.supabase.co" />

        {/*
          CRITICAL: No render-blocking resources in <head>
          - Google Fonts preload REMOVED - it was causing 2s white screen by blocking first paint
          - Fonts now load lazily after splash is visible (see script below)
          - System fonts provide instant text rendering
        */}

        {/* Inline critical CSS for instant splash screen - prevents white flash */}
        {/* CRITICAL: Use !important to guarantee dark background before any other CSS loads */}
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --font-inter: ${systemFontStack};
            --font-mono: ${monoFontStack};
          }
          /* CRITICAL: Absolute fallback to prevent white screen - !important overrides everything */
          html {
            background-color: #09090b !important;
          }
          html[data-theme="light"] {
            background-color: #f8fafc !important;
          }
          html::before {
            content: '';
            position: fixed;
            inset: 0;
            background: linear-gradient(to bottom right, #09090b, #18181b, #09090b);
            z-index: -1;
          }
          html[data-theme="light"]::before {
            background: #f8fafc;
          }
          body {
            background-color: #09090b !important;
            font-family: var(--font-inter);
          }
          html[data-theme="light"] body {
            background-color: #f8fafc !important;
          }
          #static-splash {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(to bottom right, #09090b, #18181b, #09090b);
          }
          #static-splash .logo-container {
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          #static-splash svg {
            width: 96px;
            height: 96px;
            color: #0ea5e9;
            margin-bottom: 16px;
            animation: staticIconPulse 1.5s ease-in-out infinite, staticIconEnter 0.5s ease-out forwards;
          }
          #static-splash .app-name {
            font-size: 1.875rem;
            font-weight: 900;
            color: #fafafa;
            letter-spacing: 0.1em;
            opacity: 0;
            animation: staticTextEnter 0.4s ease-out 0.15s forwards;
          }
          #static-splash .tagline {
            margin-top: 12px;
            font-size: 0.875rem;
            color: #38bdf8;
            font-weight: 500;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            opacity: 0;
            animation: staticTextEnter 0.3s ease-out 0.3s forwards;
          }
          #static-splash .progress-bar {
            margin-top: 32px;
            width: 192px;
            height: 4px;
            background: #27272a;
            border-radius: 4px;
            overflow: hidden;
            opacity: 0;
            animation: staticTextEnter 0.2s ease-out 0.4s forwards;
          }
          #static-splash .progress-fill {
            height: 100%;
            width: 100%;
            background: linear-gradient(90deg, #0ea5e9, #8b5cf6, #0ea5e9);
            border-radius: 4px;
            transform: translateX(-100%);
            animation: staticProgressFill 2s ease-in-out 0.5s forwards;
          }
          #static-splash.hidden { display: none; }

          @keyframes staticIconEnter {
            from { transform: scale(0.8) translateY(10px); opacity: 0; }
            to { transform: scale(1) translateY(0); opacity: 1; }
          }
          @keyframes staticIconPulse {
            0%, 100% { filter: drop-shadow(0 0 8px rgba(14, 165, 233, 0.4)); }
            50% { filter: drop-shadow(0 0 20px rgba(14, 165, 233, 0.8)); }
          }
          @keyframes staticTextEnter {
            from { transform: translateY(10px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes staticProgressFill {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(0%); }
          }
        `}} />
      </head>
      <body
        className="antialiased min-h-screen font-sans overflow-x-hidden"
        style={{ fontFamily: systemFontStack }}
      >
        {/* Static splash screen - shows immediately before JS loads */}
        {/* Minimal static content - React splash will add animations */}
        <div id="static-splash">
          <div className="logo-container">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path
                d="M6.5 6.5V17.5M17.5 6.5V17.5M6.5 12H17.5M4 8V16M20 8V16M2 9.5V14.5M22 9.5V14.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="app-name">HYPERTROPHY</span>
            <span className="tagline">Train Smarter</span>
            <div className="progress-bar">
              <div className="progress-fill"></div>
            </div>
          </div>
        </div>

        {/* Lazy-load Google Fonts AFTER splash is visible (non-blocking) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Load fonts after first paint to avoid blocking initial render
              // This runs after the static splash is already visible
              if (typeof window !== 'undefined') {
                function loadGoogleFonts() {
                  // Create and inject the font stylesheet lazily
                  var link = document.createElement('link');
                  link.rel = 'stylesheet';
                  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap';
                  document.head.appendChild(link);
                }

                // Load after DOMContentLoaded to ensure splash is painted first
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', loadGoogleFonts);
                } else {
                  // Already loaded, defer slightly to prioritize paint
                  setTimeout(loadGoogleFonts, 0);
                }
              }
            `,
          }}
        />

        <ServiceWorkerRegistration />
        <NativeAppBehavior />
        <SplashProvider>
          {children}
        </SplashProvider>
      </body>
    </html>
  );
}

