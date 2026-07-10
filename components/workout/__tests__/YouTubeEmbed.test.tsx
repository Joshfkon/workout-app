import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YouTubeEmbed } from '../YouTubeEmbed';

const ID = 'dQw4w9WgXcQ';

describe('YouTubeEmbed (facade first)', () => {
  it('renders only the thumbnail facade — no iframe — on initial render', () => {
    const { container } = render(<YouTubeEmbed videoId={ID} title="Bench form" />);

    const img = screen.getByRole('img', { name: 'Bench form' });
    expect(img).toHaveAttribute('src', `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);

    // The whole point of the facade: no YouTube iframe until the user taps.
    expect(container.querySelector('iframe')).toBeNull();
    // Subtle source label.
    expect(screen.getByText('YouTube')).toBeInTheDocument();
  });

  it('swaps in a youtube-nocookie iframe after the user taps play', async () => {
    const user = userEvent.setup();
    const { container } = render(<YouTubeEmbed videoId={ID} title="Bench form" />);

    await user.click(screen.getByRole('button', { name: /play/i }));

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&playsinline=1`
    );
    expect(iframe).toHaveAttribute(
      'allow',
      'autoplay; encrypted-media; picture-in-picture; fullscreen'
    );
    expect(iframe).toHaveAttribute('allowfullscreen');
  });

  it('falls back to the MuscleWiki demo when the thumbnail 404s', () => {
    const { container } = render(
      <YouTubeEmbed
        videoId={ID}
        title="Bench form"
        fallback={<div data-testid="musclewiki-fallback">MuscleWiki demo</div>}
      />
    );

    // Simulate the thumbnail image failing to load (deleted/invalid video).
    fireEvent.error(screen.getByRole('img', { name: 'Bench form' }));

    expect(screen.getByTestId('musclewiki-fallback')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('YouTube')).not.toBeInTheDocument();
  });

  // Note: the primary, dependable fallback signal is the thumbnail 404 above.
  // Cross-origin YouTube iframes don't fire a client-observable `error` event
  // (same-origin policy hides the embedded error page), so the iframe's
  // `onError` is best-effort only and intentionally not asserted here.
});
