import type { TweetMedia } from '@/lib/api/tweet';

/**
 * Tweet media: a single autoplay-muted-loop video, or a 1–4 image grid.
 * Shared by the main tweet and nested (quote/reply) cards.
 */
export function TweetMediaBlock({ media }: { media: TweetMedia }) {
  const video = media.videos[0] ?? null;
  const images = media.images.slice(0, 4);

  if (video) {
    return (
      <video
        src={video.url}
        poster={video.poster ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="w-full rounded-sm"
        style={{
          maxHeight: 220,
          objectFit: 'cover',
          border: '1px solid var(--hairline)',
          background: 'var(--surface-3)',
        }}
        onError={(e) => {
          (e.currentTarget as HTMLVideoElement).style.display = 'none';
        }}
      />
    );
  }

  if (images.length === 0) return null;

  return (
    <div
      className="grid gap-1 overflow-hidden rounded-sm"
      style={{
        gridTemplateColumns: images.length === 1 ? '1fr' : '1fr 1fr',
        border: '1px solid var(--hairline)',
      }}
    >
      {images.map((img, i) => (
        <img
          key={`${img.url}-${i}`}
          src={img.url}
          alt=""
          loading="lazy"
          draggable={false}
          className="block h-full w-full object-cover"
          style={{
            aspectRatio: images.length === 1 ? '16 / 10' : '1 / 1',
            background: 'var(--surface-3)',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ))}
    </div>
  );
}
