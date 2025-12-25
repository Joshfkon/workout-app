/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Capacitor - disables Next.js image optimization
  // which requires a server. Images will be served as-is.
  images: {
    unoptimized: true,
  },

  // Capacitor notes:
  // - When ready for Capacitor, you may want to add `output: 'export'` for static builds
  // - However, this app uses API routes and server actions, so you'll likely want to:
  //   1. Keep the Next.js server running for API routes (Stripe, OAuth, etc.)
  //   2. Point Capacitor's WebView to your hosted server URL
  //   OR use `output: 'standalone'` for a self-contained server deployment
};

export default nextConfig;
