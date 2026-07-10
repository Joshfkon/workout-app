import {
  parseYouTubeVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeEmbedUrl,
} from '../youtube';

describe('parseYouTubeVideoId', () => {
  const ID = 'dQw4w9WgXcQ'; // 11-char valid ID

  it('returns a bare video ID unchanged', () => {
    expect(parseYouTubeVideoId(ID)).toBe(ID);
  });

  it('parses a standard watch URL', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('parses a watch URL with extra params', () => {
    expect(
      parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}&list=RD&index=2&t=42s`)
    ).toBe(ID);
  });

  it('parses a youtu.be short link with a timestamp (verification case)', () => {
    expect(parseYouTubeVideoId(`https://youtu.be/${ID}?t=30`)).toBe(ID);
  });

  it('parses an embed URL', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
  });

  it('parses a youtube-nocookie embed URL', () => {
    expect(parseYouTubeVideoId(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`)).toBe(ID);
  });

  it('parses a Shorts URL', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
  });

  it('parses an m.youtube.com URL', () => {
    expect(parseYouTubeVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('parses a URL pasted without a scheme', () => {
    expect(parseYouTubeVideoId(`youtu.be/${ID}`)).toBe(ID);
  });

  it('returns null for empty/whitespace/nullish input', () => {
    expect(parseYouTubeVideoId('')).toBeNull();
    expect(parseYouTubeVideoId('   ')).toBeNull();
    expect(parseYouTubeVideoId(null)).toBeNull();
    expect(parseYouTubeVideoId(undefined)).toBeNull();
  });

  it('returns null for a non-YouTube URL', () => {
    expect(parseYouTubeVideoId('https://vimeo.com/123456789')).toBeNull();
  });

  it('returns null for a YouTube URL without a valid id', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });

  it('returns null for a string that is not 11 valid chars', () => {
    expect(parseYouTubeVideoId('too-short')).toBeNull();
    expect(parseYouTubeVideoId('this-is-way-too-long-to-be-an-id')).toBeNull();
  });
});

describe('youtube URL builders', () => {
  it('builds the thumbnail URL', () => {
    expect(getYouTubeThumbnailUrl('abc123DEF_-')).toBe(
      'https://i.ytimg.com/vi/abc123DEF_-/hqdefault.jpg'
    );
  });

  it('builds the privacy-enhanced inline-autoplay embed URL', () => {
    expect(getYouTubeEmbedUrl('abc123DEF_-')).toBe(
      'https://www.youtube-nocookie.com/embed/abc123DEF_-?autoplay=1&playsinline=1'
    );
  });
});
