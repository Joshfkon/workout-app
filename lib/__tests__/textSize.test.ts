import config from '../../tailwind.config';
import {
  TEXT_SIZE_BOOT_SCRIPT,
  TEXT_SIZE_CSS,
  applyTextSizeToDocument,
  isTextSize,
  systemPreferredTextSize,
  textSizeForSystemBodyPx,
} from '../textSize';

describe('text size', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-text-size');
  });

  it('scales the root font size for Large and Larger only', () => {
    expect(TEXT_SIZE_CSS).toBe(
      'html[data-text-size="large"]{font-size:112.5%;}html[data-text-size="larger"]{font-size:125%;}'
    );
  });

  it('the pre-paint script stamps a saved size before anything renders', () => {
    localStorage.setItem('textSize', 'larger');
    new Function(TEXT_SIZE_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute('data-text-size')).toBe('larger');
  });

  it('the pre-paint script ignores Default, junk, and blocked storage', () => {
    localStorage.setItem('textSize', 'huge');
    new Function(TEXT_SIZE_BOOT_SCRIPT)();
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
    localStorage.setItem('textSize', 'default');
    new Function(TEXT_SIZE_BOOT_SCRIPT)();
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  });

  it('Default removes the attribute', () => {
    applyTextSizeToDocument('large');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
    applyTextSizeToDocument('default');
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  });

  it('validates stored values', () => {
    expect(isTextSize('large')).toBe(true);
    expect(isTextSize('16px')).toBe(false);
  });
});

describe('tailwind type scale', () => {
  // The tokens must be rem (so the root font size scales them) and keep
  // exactly their old pixel values at the default 16px root.
  const expectedPx: Record<string, [number, number]> = {
    display: [40, 44],
    'large-title': [32, 38],
    title: [22, 28],
    headline: [17, 22],
    body: [15, 20],
    subhead: [13, 18],
    caption: [12, 16],
  };
  const fontSize = (config.theme?.extend?.fontSize ?? {}) as Record<
    string,
    [string, { lineHeight: string }]
  >;
  const px = (rem: string) => {
    expect(rem).toMatch(/^[\d.]+rem$/);
    return parseFloat(rem) * 16;
  };

  it.each(Object.entries(expectedPx))('%s is %p px at a 16px root', (token, [size, lineHeight]) => {
    const [fs, opts] = fontSize[token];
    expect(px(fs)).toBe(size);
    expect(px(opts.lineHeight)).toBe(lineHeight);
  });

  describe('following the OS text size (iOS Dynamic Type) until a size is picked', () => {
    beforeEach(() => {
      localStorage.clear();
      document.documentElement.removeAttribute('data-text-size');
    });

    it('maps the -apple-system-body size: 17px default, 19px Large, 21px+ Larger', () => {
      expect(textSizeForSystemBodyPx(17)).toBe('default');
      expect(textSizeForSystemBodyPx(15)).toBe('default');
      expect(textSizeForSystemBodyPx(19)).toBe('large');
      expect(textSizeForSystemBodyPx(21)).toBe('larger');
      expect(textSizeForSystemBodyPx(28)).toBe('larger');
      expect(textSizeForSystemBodyPx(NaN)).toBe('default');
    });

    it('is Default where the keyword is unsupported (no signal)', () => {
      // jsdom, like non-Apple browsers, rejects the font keyword.
      expect(systemPreferredTextSize()).toBe('default');
      new Function(TEXT_SIZE_BOOT_SCRIPT)();
      expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
    });

    function withSystemBody(px: number, run: () => void) {
      const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'font');
      const getComputed = window.getComputedStyle;
      Object.defineProperty(CSSStyleDeclaration.prototype, 'font', {
        configurable: true,
        get: () => '-apple-system-body',
        set: () => {},
      });
      window.getComputedStyle = (() => ({ fontSize: `${px}px` })) as unknown as typeof window.getComputedStyle;
      try {
        run();
      } finally {
        if (desc) Object.defineProperty(CSSStyleDeclaration.prototype, 'font', desc);
        else delete (CSSStyleDeclaration.prototype as unknown as Record<string, unknown>).font;
        window.getComputedStyle = getComputed;
      }
    }

    it('follows a larger OS size before first paint when nothing was picked', () => {
      withSystemBody(19, () => {
        expect(systemPreferredTextSize()).toBe('large');
        new Function(TEXT_SIZE_BOOT_SCRIPT)();
      });
      expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
    });

    it('a picked size (Default included) always beats the OS size', () => {
      localStorage.setItem('textSize', 'default');
      withSystemBody(23, () => new Function(TEXT_SIZE_BOOT_SCRIPT)());
      expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
    });
  });
});
