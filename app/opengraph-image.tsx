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
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f0f0f',
        }}
      >
        {/* App Name */}
        <div
          style={{
            fontSize: 90,
            fontWeight: 900,
            color: '#ffffff',
            letterSpacing: -3,
          }}
        >
          HYPERTROPHY
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 32,
            color: '#3b82f6',
            marginTop: 20,
            letterSpacing: 8,
          }}
        >
          TRAIN SMARTER
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 24,
            color: '#666666',
            marginTop: 40,
          }}
        >
          Science-Based Workout Tracker
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

