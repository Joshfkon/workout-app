import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SplashProvider } from "@/components/providers/SplashProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HyperTrack - Intelligent Workout Tracker",
  description: "Science-based hypertrophy training with auto-regulation, volume tracking, and intelligent progression",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased min-h-screen font-sans`}
      >
        <SplashProvider>
          {children}
        </SplashProvider>
      </body>
    </html>
  );
}

