'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Modal } from '@/components/ui';
import { usePWA } from '@/hooks/usePWA';
import { AddToHomescreenGuide } from '@/components/onboarding/AddToHomescreenGuide';

export function InstallAppCard() {
  const { pwaContext, isInstalled, installPrefs, isLoading } = usePWA();
  const [showInstructions, setShowInstructions] = useState(false);

  // Don't show if already installed as PWA
  if (isLoading || isInstalled || pwaContext?.isStandalone) {
    return null;
  }

  // Don't show if user has already completed installation
  if (installPrefs.homescreenInstallCompleted) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Install App
          </CardTitle>
          <p className="text-sm text-surface-400 mt-1">
            Add HyperTrack to your homescreen for the best experience
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary-500/10 to-accent-500/10 rounded-lg border border-primary-500/20">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-200">Quick Access</p>
                  <p className="text-xs text-surface-500">Launch instantly from your homescreen</p>
                </div>
              </div>
              <ul className="space-y-1 ml-13">
                <li className="flex items-center gap-2 text-xs text-surface-400">
                  <svg className="w-3 h-3 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Works offline after first load
                </li>
                <li className="flex items-center gap-2 text-xs text-surface-400">
                  <svg className="w-3 h-3 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Full-screen experience
                </li>
              </ul>
            </div>
            <Button onClick={() => setShowInstructions(true)} size="sm">
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              View Instructions
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Install Instructions Modal */}
      <Modal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
        title=""
        size="lg"
      >
        <AddToHomescreenGuide
          onComplete={() => setShowInstructions(false)}
          onSkip={() => setShowInstructions(false)}
          showSkipOption={false}
        />
      </Modal>
    </>
  );
}
