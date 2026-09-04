'use client';

/**
 * The answer's atoms — the RENDER half (spec/10-system.md §1.4.1/.3/.4).
 * Soren-skin only: none of these mount unless `useSorenChat()` said so in
 * `AgentMarkdown`, so the classes below never appear flag-off.
 *
 * The number box is a <span>, not an anchor — a number is not a place to
 * go. The tags stay real links: the token tag keeps the /trade/ href and
 * new-tab behaviour of the chip it replaces, and the wallet tag keeps the
 * `#wallet=` sentinel so the conversation's existing click delegate opens
 * the wallet profile exactly as before.
 */

import { Solana } from '@/components/listen/icons/Icons';
import { formatAtom, type AtomInfo } from '@/lib/agent/atoms';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { shortAddress } from '@/lib/api/tracker';
import { useResolvedTokenImage } from '@/lib/token-image';
import { publishTokenHover } from '../../soren/hoverCard';

/** B·code 01 — the 20px glass container; colour lives in the TEXT only. */
export function NumberBox({ info }: { info: AtomInfo }) {
  const formatted = formatAtom(info);
  return (
    <span className="ag-atom-box" data-tone={formatted.tone} data-testid="agent-atom-num">
      {formatted.segments.map((segment, i) =>
        segment.role === 'unit' ? (
          <span key={i} className="ag-atom-u" data-u={segment.text}>
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
      {formatted.sol ? <Solana className="ag-atom-sol" aria-label="SOL" /> : null}
    </span>
  );
}

/**
 * A04.6 at prose size — the bold-frame rectangle: 16px letter-square art
 * (real coin art when the proxy has it), `$SYMBOL` at the prose weight.
 */
export function ProseTokenTag({ href, mint, label }: { href: string; mint: string; label: string }) {
  const image = useResolvedTokenImage(ingestionTokenImageUrl(mint), null, mint);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="ag-ttag"
      data-token-tag={mint}
      data-testid="agent-mention-token"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        publishTokenHover({ mint, label, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
      }}
      onMouseLeave={() => publishTokenHover(null)}
    >
      {image.isPlaceholder ? (
        <span aria-hidden className="ag-ttag-art ag-ttag-art--letter">
          {label.replace(/^\$/, '').slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          src={image.src}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          onError={image.onError}
          onLoad={image.onLoad}
          className="ag-ttag-art"
        />
      )}
      <span className="ag-ttag-sym">{label}</span>
    </a>
  );
}

/** W04 — the token tag's sibling: the wallet glyph and the short address.
 *  Clicking opens the wallet dossier via the conversation's `#wallet=`
 *  delegate; at the number box's 20px line the glyph steps to 12. */
export function ProseWalletTag({ href, address }: { href: string; address: string }) {
  return (
    <a href={href} className="ag-wtag" data-testid="agent-mention-wallet">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden className="ag-wtag-glyph">
        <rect x="1.5" y="3.5" width="13" height="9" rx="2" fill="none" stroke="#E8E8E2" strokeWidth="1.3" />
        <rect x="9.5" y="6.5" width="4" height="3" rx="1" fill="#E8E8E2" />
      </svg>
      <span className="ag-wtag-addr">{shortAddress(address)}</span>
    </a>
  );
}
