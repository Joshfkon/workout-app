'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ 
        backgroundColor: '#0a0a0f', 
        color: 'white', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Something went wrong!</h2>
          <p style={{ color: '#888', marginBottom: '1.5rem' }}>{error.message}</p>
          <button 
            onClick={() => reset()}
            style={{
              backgroundColor: '#8b5cf6',
              color: 'white',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              cursor: 'pointer',
              marginRight: '0.5rem'
            }}
          >
            Try again
          </button>
          <button 
            onClick={() => window.location.href = '/'}
            style={{
              backgroundColor: '#333',
              color: 'white',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Go Home
          </button>
        </div>
      </body>
    </html>
  );
}

