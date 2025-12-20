'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Card, CardContent } from '@/components/ui';
import { usePWA } from '@/hooks/usePWA';
import { installBenefits } from '@/lib/utils/pwa-detection';

interface AddToHomescreenGuideProps {
  onComplete: () => void;
  onSkip: () => void;
  showSkipOption?: boolean;
}

export function AddToHomescreenGuide({
  onComplete,
  onSkip,
  showSkipOption = true,
}: AddToHomescreenGuideProps) {
  const {
    pwaContext,
    instructions,
    canTriggerNativePrompt,
    triggerNativeInstallPrompt,
    markInstallDone,
    dismissPrompt,
  } = usePWA();

  const [isInstalling, setIsInstalling] = useState(false);
  const [showManualInstructions, setShowManualInstructions] = useState(false);

  const handleNativeInstall = async () => {
    setIsInstalling(true);
    const result = await triggerNativeInstallPrompt();
    setIsInstalling(false);

    if (result === 'accepted') {
      onComplete();
    } else if (result === 'unavailable') {
      // Fall back to manual instructions
      setShowManualInstructions(true);
    }
  };

  const handleDone = async () => {
    await markInstallDone();
    onComplete();
  };

  const handleMaybeLater = async () => {
    await dismissPrompt();
    onSkip();
  };

  // Loading state
  if (!pwaContext || !instructions) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If native prompt is available and not showing manual instructions
  if (canTriggerNativePrompt && !showManualInstructions) {
    return (
      <NativeInstallPrompt
        onInstall={handleNativeInstall}
        onSkip={handleMaybeLater}
        onShowManual={() => setShowManualInstructions(true)}
        isInstalling={isInstalling}
        showSkipOption={showSkipOption}
      />
    );
  }

  // Show platform-specific manual instructions
  return (
    <ManualInstallInstructions
      platform={pwaContext.platform}
      browser={pwaContext.browser}
      instructions={instructions}
      onDone={handleDone}
      onSkip={handleMaybeLater}
      showSkipOption={showSkipOption}
    />
  );
}

// Native install prompt UI (for Chrome/Edge on Android/Desktop)
function NativeInstallPrompt({
  onInstall,
  onSkip,
  onShowManual,
  isInstalling,
  showSkipOption,
}: {
  onInstall: () => void;
  onSkip: () => void;
  onShowManual: () => void;
  isInstalling: boolean;
  showSkipOption: boolean;
}) {
  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Install HyperTrack</h1>
        <p className="text-surface-400">
          Add to your homescreen for quick access and the best experience
        </p>
      </div>

      {/* Benefits */}
      <Card className="bg-surface-800/50">
        <CardContent className="p-4">
          <ul className="space-y-2">
            {installBenefits.slice(0, 2).map((benefit, i) => (
              <li key={i} className="flex items-center gap-3 text-sm text-surface-300">
                <svg className="w-5 h-5 text-success-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {benefit}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Install button */}
      <Button
        onClick={onInstall}
        className="w-full"
        size="lg"
        isLoading={isInstalling}
      >
        <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Install App
      </Button>

      {/* Secondary actions */}
      <div className="flex gap-3">
        {showSkipOption && (
          <Button onClick={onSkip} variant="ghost" className="flex-1">
            Maybe Later
          </Button>
        )}
        <Button onClick={onShowManual} variant="outline" className="flex-1">
          Show Steps
        </Button>
      </div>
    </div>
  );
}

// Manual installation instructions UI
function ManualInstallInstructions({
  platform,
  browser,
  instructions,
  onDone,
  onSkip,
  showSkipOption,
}: {
  platform: string;
  browser: string;
  instructions: { steps: { stepNumber: number; text: string; subtext: string; icon: string }[] };
  onDone: () => void;
  onSkip: () => void;
  showSkipOption: boolean;
}) {
  const [currentStep, setCurrentStep] = useState(0);

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Install HyperTrack</h1>
        <p className="text-surface-400">
          Add to your homescreen for the best experience
        </p>
      </div>

      {/* Platform indicator */}
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-surface-800 rounded-full text-xs text-surface-400">
          <PlatformIcon platform={platform} />
          {getPlatformName(platform, browser)}
        </span>
      </div>

      {/* Instructions card */}
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {instructions.steps.map((step, index) => (
              <motion.div
                key={step.stepNumber}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`flex gap-4 p-3 rounded-lg transition-colors ${
                  currentStep === index
                    ? 'bg-primary-500/10 border border-primary-500/30'
                    : 'hover:bg-surface-800/50'
                }`}
                onClick={() => setCurrentStep(index)}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  currentStep === index
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400'
                }`}>
                  {step.stepNumber}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-surface-200">{step.text}</p>
                  {step.subtext && (
                    <p className="text-sm text-surface-500 mt-0.5">{step.subtext}</p>
                  )}
                </div>
                <StepIcon icon={step.icon} isActive={currentStep === index} />
              </motion.div>
            ))}
          </div>

          {/* Visual hint for iOS */}
          {platform === 'ios' && (
            <AnimatePresence>
              {currentStep === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-6 p-4 bg-surface-800/50 rounded-lg"
                >
                  <div className="flex items-center justify-center gap-2 text-surface-400">
                    <motion.div
                      animate={{ y: [0, 5, 0] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    >
                      <ShareIcon />
                    </motion.div>
                    <span className="text-sm">Look for this icon at the bottom</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* Visual hint for Android */}
          {platform === 'android' && (
            <AnimatePresence>
              {currentStep === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-6 p-4 bg-surface-800/50 rounded-lg"
                >
                  <div className="flex items-center justify-center gap-2 text-surface-400">
                    <motion.div
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      <MoreVerticalIcon />
                    </motion.div>
                    <span className="text-sm">Tap the menu in the top right</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </CardContent>
      </Card>

      {/* Benefits reminder */}
      <div className="flex flex-wrap justify-center gap-2">
        {installBenefits.slice(0, 2).map((benefit, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-surface-800/50 rounded text-xs text-surface-400">
            <svg className="w-3 h-3 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {benefit}
          </span>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        {showSkipOption && (
          <Button onClick={onSkip} variant="ghost" className="flex-1">
            Maybe Later
          </Button>
        )}
        <Button onClick={onDone} className="flex-1">
          I&apos;ve Done This
          <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

// Helper components for icons
function PlatformIcon({ platform }: { platform: string }) {
  if (platform === 'ios') {
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    );
  }
  if (platform === 'android') {
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-1.17-.45-2.48-.73-3.87-.73-1.39 0-2.7.28-3.87.73L6.77 5.67c-.16-.28-.54-.37-.83-.22-.3.16-.42.54-.26.85L7.52 9.48C4.83 10.97 3 13.65 3 17h18c0-3.35-1.83-6.03-3.4-7.52zM9 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function getPlatformName(platform: string, browser: string): string {
  if (platform === 'ios') return 'iOS Safari';
  if (platform === 'android') {
    if (browser === 'chrome') return 'Android Chrome';
    if (browser === 'samsung') return 'Samsung Browser';
    if (browser === 'firefox') return 'Firefox';
    return 'Android';
  }
  if (platform === 'desktop') return 'Desktop';
  return 'Web';
}

function StepIcon({ icon, isActive }: { icon: string; isActive: boolean }) {
  const className = `w-5 h-5 ${isActive ? 'text-primary-400' : 'text-surface-500'}`;

  switch (icon) {
    case 'share':
      return <ShareIcon className={className} />;
    case 'plus-square':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      );
    case 'check':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'more-vertical':
      return <MoreVerticalIcon className={className} />;
    case 'menu':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case 'plus-circle':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'download':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      );
    default:
      return null;
  }
}

function ShareIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}

function MoreVerticalIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  );
}

export default AddToHomescreenGuide;
