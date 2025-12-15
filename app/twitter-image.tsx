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
          position: 'relative',
        }}
      >
        {/* Background gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
          }}
        />

        {/* Glow effect */}
        <div
          style={{
            position: 'absolute',
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59, 130, 246, 0.2) 0%, transparent 70%)',
          }}
        />

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

        {/* Dumbbell Icon */}
        <div
          style={{
            display: 'flex',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 50, background: 'linear-gradient(180deg, #3b82f6, #8b5cf6)', borderRadius: 4 }} />
            <div style={{ width: 16, height: 70, background: 'linear-gradient(180deg, #3b82f6, #8b5cf6)', borderRadius: 4 }} />
            <div style={{ width: 100, height: 16, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', borderRadius: 8 }} />
            <div style={{ width: 16, height: 70, background: 'linear-gradient(180deg, #8b5cf6, #3b82f6)', borderRadius: 4 }} />
            <div style={{ width: 12, height: 50, background: 'linear-gradient(180deg, #8b5cf6, #3b82f6)', borderRadius: 4 }} />
          </div>
        </div>

        {/* App Name */}
        <div
          style={{
            display: 'flex',
            fontSize: 72,
            fontWeight: 900,
            color: '#ffffff',
            letterSpacing: -2,
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
            marginTop: 16,
            letterSpacing: 4,
          }}
        >
          TRAIN SMARTER • BUILD MUSCLE • TRACK PROGRESS
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

