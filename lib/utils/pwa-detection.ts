/**
 * PWA Detection Utility
 * Detects platform, browser, and PWA installation status
 */

export interface PWAContext {
  platform: 'ios' | 'android' | 'desktop' | 'unknown';
  browser: 'safari' | 'chrome' | 'firefox' | 'samsung' | 'edge' | 'other';
  isStandalone: boolean;  // Already running as installed PWA
  canPromptInstall: boolean;  // Browser supports beforeinstallprompt
}

/**
 * Detects the current PWA context including platform, browser, and installation status
 */
export function getPWAContext(): PWAContext {
  // Check if running in standalone mode (installed PWA)
  const isStandalone =
    typeof window !== 'undefined' && (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://')
    );

  const userAgent = typeof navigator !== 'undefined'
    ? navigator.userAgent.toLowerCase()
    : '';

  // Platform detection
  const isIOS = /iphone|ipad|ipod/.test(userAgent);
  const isAndroid = /android/.test(userAgent);
  const isMac = /macintosh|mac os x/.test(userAgent);
  const isWindows = /windows/.test(userAgent);

  // Browser detection
  const isSafari = /safari/.test(userAgent) && !/chrome/.test(userAgent) && !/chromium/.test(userAgent);
  const isChrome = /chrome/.test(userAgent) && !/edge/.test(userAgent) && !/edg\//.test(userAgent);
  const isFirefox = /firefox/.test(userAgent);
  const isSamsung = /samsungbrowser/.test(userAgent);
  const isEdge = /edge/.test(userAgent) || /edg\//.test(userAgent);

  // Determine platform
  let platform: PWAContext['platform'] = 'unknown';
  if (isIOS) {
    platform = 'ios';
  } else if (isAndroid) {
    platform = 'android';
  } else if (isMac || isWindows) {
    platform = 'desktop';
  }

  // Determine browser
  let browser: PWAContext['browser'] = 'other';
  if (isSafari) {
    browser = 'safari';
  } else if (isSamsung) {
    browser = 'samsung';
  } else if (isChrome) {
    browser = 'chrome';
  } else if (isFirefox) {
    browser = 'firefox';
  } else if (isEdge) {
    browser = 'edge';
  }

  // Check if browser supports beforeinstallprompt
  // This is primarily Chrome on Android/Desktop
  const canPromptInstall =
    typeof window !== 'undefined' &&
    'BeforeInstallPromptEvent' in window;

  return {
    platform,
    browser,
    isStandalone,
    canPromptInstall,
  };
}

/**
 * Check if the app should show installation instructions
 */
export function shouldShowInstallPrompt(pwaContext: PWAContext): boolean {
  // Don't show if already installed
  if (pwaContext.isStandalone) {
    return false;
  }

  // Show on mobile platforms and desktop browsers that support PWA
  return pwaContext.platform !== 'unknown';
}

/**
 * Get the appropriate install instructions based on platform/browser
 */
export function getInstallInstructions(pwaContext: PWAContext): InstallInstructions {
  const { platform, browser } = pwaContext;

  if (platform === 'ios') {
    return {
      type: 'manual',
      steps: [
        {
          stepNumber: 1,
          text: 'Tap the Share button',
          subtext: 'at the bottom of the screen',
          icon: 'share',
        },
        {
          stepNumber: 2,
          text: 'Scroll down and tap',
          subtext: '"Add to Home Screen"',
          icon: 'plus-square',
        },
        {
          stepNumber: 3,
          text: 'Tap "Add"',
          subtext: 'in the top right corner',
          icon: 'check',
        },
      ],
    };
  }

  if (platform === 'android') {
    if (browser === 'chrome' || browser === 'edge') {
      return {
        type: 'native-or-manual',
        steps: [
          {
            stepNumber: 1,
            text: 'Tap the menu button',
            subtext: '(three dots) in the top right',
            icon: 'more-vertical',
          },
          {
            stepNumber: 2,
            text: 'Tap "Add to Home screen"',
            subtext: 'or "Install app"',
            icon: 'plus-square',
          },
          {
            stepNumber: 3,
            text: 'Tap "Install"',
            subtext: 'to confirm',
            icon: 'check',
          },
        ],
      };
    }

    if (browser === 'samsung') {
      return {
        type: 'manual',
        steps: [
          {
            stepNumber: 1,
            text: 'Tap the menu button',
            subtext: '(three lines) at the bottom right',
            icon: 'menu',
          },
          {
            stepNumber: 2,
            text: 'Tap "Add page to"',
            subtext: 'then select "Home screen"',
            icon: 'plus-square',
          },
          {
            stepNumber: 3,
            text: 'Tap "Add"',
            subtext: 'to confirm',
            icon: 'check',
          },
        ],
      };
    }

    // Firefox on Android
    return {
      type: 'manual',
      steps: [
        {
          stepNumber: 1,
          text: 'Tap the menu button',
          subtext: '(three dots) at the bottom',
          icon: 'more-vertical',
        },
        {
          stepNumber: 2,
          text: 'Tap "Install"',
          subtext: 'or "Add to Home screen"',
          icon: 'plus-square',
        },
        {
          stepNumber: 3,
          text: 'Confirm installation',
          subtext: '',
          icon: 'check',
        },
      ],
    };
  }

  // Desktop
  return {
    type: 'desktop',
    steps: [
      {
        stepNumber: 1,
        text: 'Look for the install icon',
        subtext: 'in your browser\'s address bar',
        icon: 'plus-circle',
      },
      {
        stepNumber: 2,
        text: 'Click "Install"',
        subtext: 'when prompted',
        icon: 'download',
      },
    ],
  };
}

export interface InstallStep {
  stepNumber: number;
  text: string;
  subtext: string;
  icon: string;
}

export interface InstallInstructions {
  type: 'manual' | 'native-or-manual' | 'desktop';
  steps: InstallStep[];
}

/**
 * Benefits of installing the PWA
 */
export const installBenefits = [
  'Launch instantly from your homescreen',
  'Works offline after first load',
  'Full-screen experience',
  'Faster loading times',
] as const;
