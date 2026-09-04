import type { TweetCard } from '@/lib/api/tweet';

/** Link-preview card (news-article embed, etc.): image + title + domain. */
export function LinkCard({ card }: { card?: TweetCard | null }) {
  if (!card?.url) return null;
  let domain = '';
  try {
    domain = new URL(card.url).hostname.replace(/^www\./, '');
  } catch {
    domain = '';
  }
  return (
    <a
      href={card.url}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-sm"
      style={{ border: '1px solid var(--hairline-2)' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {card.image ? (
        <img
          src={card.image}
          alt=""
          loading="lazy"
          draggable={false}
          className="block w-full object-cover"
          style={{ maxHeight: 150, background: 'var(--surface-3)' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <div className="flex flex-col gap-0.5 p-2.5">
        {domain ? (
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
            {domain}
          </span>
        ) : null}
        {card.title ? (
          <span className="text-xs font-medium leading-tight" style={{ color: 'var(--ink-1)' }}>
            {card.title}
          </span>
        ) : null}
      </div>
    </a>
  );
}
