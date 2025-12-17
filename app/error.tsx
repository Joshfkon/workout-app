'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Something went wrong!</h2>
        <p className="text-surface-400 mb-4">
          {error.message || 'An unexpected error occurred.'}
        </p>
        
        {/* Debug details toggle */}
        <button 
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-surface-500 underline mb-4"
        >
          {showDetails ? 'Hide' : 'Show'} error details
        </button>
        
        {showDetails && (
          <div className="mb-6 p-3 bg-surface-900 rounded-lg text-left overflow-x-auto">
            <p className="text-xs text-surface-400 font-mono break-all whitespace-pre-wrap">
              <strong>Name:</strong> {error.name}
              {'\n'}
              <strong>Message:</strong> {error.message}
              {'\n'}
              <strong>Digest:</strong> {error.digest || 'N/A'}
              {'\n\n'}
              <strong>Stack:</strong>
              {'\n'}{error.stack || 'No stack trace'}
            </p>
          </div>
        )}
        
        <div className="flex gap-3 justify-center">
          <Button onClick={() => reset()}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.href = '/dashboard'}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

