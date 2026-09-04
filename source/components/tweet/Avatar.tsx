/** Round profile image with an initial+hue fallback when no avatar loads. */
export function Avatar({
  url,
  name,
  size = 40,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const hue = [...(name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  // pbs.twimg avatars arrive as `_normal` (48px); upgrade for crispness.
  const src = url ? url.replace('_normal', '_400x400') : null;
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: src ? 'var(--surface-3)' : `hsl(${hue}, 24%, 22%)`,
        color: `hsl(${hue}, 55%, 75%)`,
        border: '1px solid var(--hairline)',
        fontFamily: 'var(--mono)',
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          draggable={false}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </span>
  );
}
