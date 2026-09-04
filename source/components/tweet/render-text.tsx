import type { ReactNode } from 'react';

const TOKEN_RE = /(https?:\/\/[^\s]+|@[A-Za-z0-9_]{1,15}|[#$][A-Za-z][A-Za-z0-9_]*)/g;

/**
 * Render tweet text as React nodes (never `dangerouslySetInnerHTML`),
 * linkifying URLs / @mentions / #hashtags / $cashtags into accent-tinted
 * spans. Newlines are preserved by the caller's `whitespace-pre-wrap`.
 */
export function renderTweetText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const token = match[0];
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (token.startsWith('http')) {
      nodes.push(
        <a
          key={key++}
          href={token}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--accent-primary)' }}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {token}
        </a>,
      );
    } else {
      nodes.push(
        <span key={key++} style={{ color: 'var(--accent-primary)' }}>
          {token}
        </span>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
