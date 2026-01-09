import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",  // Show fallback font immediately, swap when loaded
  preload: true,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",  // Prevent invisible text during font load
  preload: true,
});

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
    ],
    apple: "/apple-icon.svg",
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
        {/* Inline critical CSS for instant splash screen - prevents white flash */}
        <style dangerouslySetInnerHTML={{ __html: `
          html, body { background-color: #09090b; }
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
            animation: fadeIn 0.3s ease-out;
          }
          #static-splash svg {
            width: 96px;
            height: 96px;
            color: #0ea5e9;
            margin-bottom: 16px;
          }
          #static-splash .app-name {
            font-size: 1.875rem;
            font-weight: 900;
            color: #fafafa;
            letter-spacing: 0.1em;
          }
          #static-splash .tagline {
            margin-top: 12px;
            font-size: 0.875rem;
            color: #38bdf8;
            font-weight: 500;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          }
          #static-splash .loading-bar {
            margin-top: 32px;
            width: 192px;
            height: 4px;
            background: #27272a;
            border-radius: 9999px;
            overflow: hidden;
          }
          #static-splash .loading-progress {
            height: 100%;
            background: linear-gradient(to right, #0ea5e9, #d946ef, #0ea5e9);
            border-radius: 9999px;
            animation: progress 2s ease-in-out infinite;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes progress {
            0% { width: 0%; }
            50% { width: 70%; }
            100% { width: 100%; }
          }
          #static-splash.hidden { display: none; }
        `}} />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased min-h-screen font-sans overflow-x-hidden`}
      >
        {/* Static splash screen - shows immediately before JS loads */}
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
            <div className="loading-bar">
              <div className="loading-progress" />
            </div>
          </div>
        </div>
        <ServiceWorkerRegistration />
        <NativeAppBehavior />
        <SplashProvider>
          {children}
        </SplashProvider>
      </body>
    </html>
  );
}

