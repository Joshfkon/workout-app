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
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
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
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased min-h-screen font-sans overflow-x-hidden`}
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

