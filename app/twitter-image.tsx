import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'HyperTrack - Science-Based Workout Tracker';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          backgroundImage: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
        }}
      >
        {/* Decorative elements */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 400,
              height: 400,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
              position: 'absolute',
            }}
          />
        </div>

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          {/* Dumbbell Icon */}
          <svg
            width="100"
            height="100"
            viewBox="0 0 24 24"
            fill="none"
            stroke="url(#gradient)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <path d="M6.5 6.5V17.5M17.5 6.5V17.5M6.5 12H17.5M4 8V16M20 8V16M2 9.5V14.5M22 9.5V14.5" />
          </svg>

          {/* App Name */}
          <div
            style={{
              display: 'flex',
              fontSize: 64,
              fontWeight: 900,
              background: 'linear-gradient(135deg, #ffffff 0%, #a0a0a0 100%)',
              backgroundClip: 'text',
              color: 'transparent',
              marginTop: 20,
              letterSpacing: '-2px',
            }}
          >
            HYPERTROPHY
          </div>

          {/* Tagline */}
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              color: '#3b82f6',
              marginTop: 12,
              letterSpacing: '4px',
              textTransform: 'uppercase',
            }}
          >
            Train Smarter • Build Muscle • Track Progress
          </div>
        </div>

        {/* Corner accents */}
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 24,
            width: 60,
            height: 60,
            borderLeft: '3px solid #3b82f6',
            borderTop: '3px solid #3b82f6',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            right: 24,
            width: 60,
            height: 60,
            borderRight: '3px solid #8b5cf6',
            borderBottom: '3px solid #8b5cf6',
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}

