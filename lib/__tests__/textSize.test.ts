import config from '../../tailwind.config';
import {
  TEXT_SIZE_BOOT_SCRIPT,
  TEXT_SIZE_CSS,
  applyTextSizeToDocument,
  isTextSize,
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
});
