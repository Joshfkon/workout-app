/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Only disable optimization for Capacitor builds (mobile apps)
    // Web builds benefit from automatic WebP/AVIF conversion, compression, and lazy loading
    unoptimized: process.env.CAPACITOR === 'true',
    // Allow Supabase storage images
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.supabaseusercontent.com',
      },
    ],
    // Prefer modern formats for better compression
    formats: ['image/avif', 'image/webp'],
  },

  // Capacitor notes:
  // - When ready for Capacitor, you may want to add `output: 'export'` for static builds
  // - However, this app uses API routes and server actions, so you'll likely want to:
  //   1. Keep the Next.js server running for API routes (Stripe, OAuth, etc.)
  //   2. Point Capacitor's WebView to your hosted server URL
  //   OR use `output: 'standalone'` for a self-contained server deployment
};

export default nextConfig;
