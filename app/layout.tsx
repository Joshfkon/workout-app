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
        {/* Preconnect to critical origins for faster subsequent requests */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* DNS prefetch for Supabase - loaded dynamically */}
        <link rel="dns-prefetch" href="https://*.supabase.co" />

        {/* Load Google Fonts with display=swap for non-blocking render */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap"
        />

        {/* Inline critical CSS - dark background prevents white flash */}
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --font-inter: ${systemFontStack};
            --font-mono: ${monoFontStack};
          }
          html, body {
            background-color: #09090b;
            font-family: var(--font-inter);
          }
        `}} />
      </head>
      <body
        className="antialiased min-h-screen font-sans overflow-x-hidden"
        style={{ fontFamily: systemFontStack }}
      >
        <ServiceWorkerRegistration />
        <NativeAppBehavior />
        <SplashProvider>
          {children}
        </SplashProvider>
      </body>
    </html>
  );
}

