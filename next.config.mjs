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

  // Compiler optimizations for smaller bundles
  compiler: {
    // Remove console.log in production (keeps console.error/warn)
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },

  // Modularize imports for smaller bundles - tree-shake heavy libraries
  modularizeImports: {
    // Optimize recharts imports
    'recharts': {
      transform: 'recharts/es6/{{member}}',
      skipDefaultConversion: true,
    },
    // Optimize date-fns if used
    'date-fns': {
      transform: 'date-fns/{{member}}',
    },
  },

  // Experimental features for better performance
  experimental: {
    // Optimize package imports automatically
    optimizePackageImports: ['recharts', 'framer-motion', '@supabase/supabase-js', 'zustand'],
  },

  // Capacitor notes:
  // - When ready for Capacitor, you may want to add `output: 'export'` for static builds
  // - However, this app uses API routes and server actions, so you'll likely want to:
  //   1. Keep the Next.js server running for API routes (Stripe, OAuth, etc.)
  //   2. Point Capacitor's WebView to your hosted server URL
  //   OR use `output: 'standalone'` for a self-contained server deployment
};

export default nextConfig;
