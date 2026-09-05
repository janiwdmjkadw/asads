'use client';

/**
 * Terminal-styled streaming markdown for the model's OWN `text` parts —
 * and ONLY those. Tool payload strings are data and must never route
 * through here (F§ "tool results are data, never markup").
 *
 * Streamdown (the AI Elements `Response` engine) is used directly:
 * block-level memoization means the reducer's growing-string updates
 * re-render only the last, still-growing block. The element styling
 * lives in globals.css under `.agent-md` (Streamdown's `data-streamdown`
 * hooks); `caret="block"` shows Streamdown's own block cursor on the
 * open block while `isAnimating`, tinted flame by the same CSS.
 *
 * Plugins: shiki code blocks + CJK segmentation. Math and mermaid are
 * deliberately omitted — a trading agent never emits them and they pull
 * heavy chunks into the graph.
 */

import { memo, useCallback, useMemo } from 'react';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { Streamdown } from 'streamdown';
import { atomizeAgentText, parseAtomHref } from '@/lib/agent/atoms';
import {
  linkifyAgentText,
  mintFromTradeHref,
  walletFromHref,
  type LinkEntities,
} from '@/lib/agent/mint-links';
import { useSorenChat } from '@/lib/flags/useSorenChat';
import { NumberBox, ProseTokenTag, ProseWalletTag } from './atoms/atoms';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { shortAddress } from '@/lib/api/tracker';
import { truncateMint } from '@/lib/format';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import { useResolvedTokenImage } from '@/lib/token-image';

const plugins = { cjk, code };

/* ------------------------------------------------------------------ *
 * Mention chips (50-token-data mock D)
 *
 * A token named in prose is a place the user wants to GO, and a bare
 * flame-underlined address says nothing about which token it is. The
 * anchors linkification already produces are re-rendered as chips: art
 * + ticker in a hairline pill for a token, a quieter mono pill for a
 * wallet (an identifier, not an asset — it must not compete with token
 * chips in the same sentence).
 *
 * This is a RENDER change only. `linkifyAgentText` still decides what
 * links and where to; the href, the new-tab behaviour and the
 * wallet-modal click delegate are all untouched. Only anchors THIS
 * client generated become chips — the label has to be the mint itself
 * or a `$TICKER` — so a model-written markdown link can never dress
 * itself up as a resolved token.
 *
 * Deferred from mock D: the hover PREVIEW popover (price/mcap/holders
 * on hover). It needs a data fetch per mentioned mint, which is a tool
 * or endpoint question, not a rendering one.
 * ------------------------------------------------------------------ */

/* The app's own face, not the mono. Every figure in the chat used
   to be set in the printout voice the rest of the terminal has
   dropped — the zero gives it away beside any other number on
   screen. `tabular-nums` rides along wherever a figure needs its
   columns to line up, which is what the mono was really for. */
const MONO = { fontFamily: 'var(--sans)', fontVariantNumeric: 'tabular-nums' } as const;
const CHIP = 'inline-flex items-center align-baseline whitespace-nowrap rounded-full no-underline';
const ART = 'h-3.5 w-3.5 shrink-0 rounded-[4px] object-cover';
/** `$SYMBOL`, exactly what `linkifyAgentText` links (TICKER_RE). */
const TICKER_LABEL_RE = /^\$[A-Za-z][A-Za-z0-9_]{0,15}$/;

function TokenMentionChip({ href, mint, label }: { href: string; mint: string; label: string }) {
  // Proxy art needs only the mint, and the mint came out of the href —
  // never out of attacker-writable metadata.
  const image = useResolvedTokenImage(ingestionTokenImageUrl(mint), null, mint);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid="agent-mention-token"
      className={`${CHIP} gap-1 border border-[var(--hairline-2)] bg-[rgba(255,255,255,0.03)] py-px pl-0.5 pr-1.5 text-[11.5px] font-medium leading-[1.35] text-[var(--ink-0)] transition-colors hover:border-[var(--flame-soft)] hover:bg-[var(--flame-wash)] hover:text-[var(--flame)]`}
    >
      {image.isPlaceholder ? (
        <span
          aria-hidden
          className={`${ART} inline-flex items-center justify-center bg-[var(--flame-wash)] text-[8.5px] text-[var(--flame)]`}
          style={MONO}
        >
          {label.slice(0, 1).toUpperCase()}
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
          className={ART}
        />
      )}
      {label}
    </a>
  );
}

function WalletMentionChip({ href, address }: { href: string; address: string }) {
  return (
    <a
      href={href}
      data-testid="agent-mention-wallet"
      className={`${CHIP} border border-[var(--hairline)] px-1.5 py-[0.5px] text-[11px] leading-[1.4] text-[var(--ink-2)] transition-colors hover:text-[var(--ink-0)]`}
      style={MONO}
    >
      @{shortAddress(address)}
    </a>
  );
}

/** Single string child of an anchor, or null (chips need the label). */
function anchorLabel(children: React.ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') {
    return children[0];
  }
  return null;
}

/**
 * Streamdown's `a` renderer. Anything that is not one of our own
 * mentions falls through to the plain anchor Streamdown would have
 * rendered — same `data-streamdown` hook, so `.agent-md` keeps styling
 * model-written links exactly as before.
 */
export function AgentMentionLink({
  href,
  children,
  className,
  title,
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  // Unconditional, like every fail-closed gate in this tree. Flag off,
  // the `atom:` branch is dead code (the atomize pass never ran) and the
  // mention branches keep rendering the classic chips byte-for-byte.
  const soren = useSorenChat();
  // A number box is a <span> in link's clothing — the atomize pass rides
  // the markdown-link seam because Streamdown memoizes on plain strings,
  // but a datum is not a destination, so the anchor semantics stop here.
  const atom = href !== undefined ? parseAtomHref(href) : null;
  if (atom !== null) {
    return <NumberBox info={atom} />;
  }
  const wallet = href !== undefined ? walletFromHref(href) : null;
  if (wallet !== null && href !== undefined) {
    if (soren) return <ProseWalletTag href={href} address={wallet} />;
    return <WalletMentionChip href={href} address={wallet} />;
  }
  const mint = href !== undefined ? mintFromTradeHref(href) : null;
  const label = anchorLabel(children);
  if (mint !== null && href !== undefined && label !== null) {
    if (label === mint) {
      if (soren) return <ProseTokenTag href={href} mint={mint} label={truncateMint(mint)} />;
      return <TokenMentionChip href={href} mint={mint} label={truncateMint(mint)} />;
    }
    if (TICKER_LABEL_RE.test(label)) {
      // Sigil kept: 90-synthesis hero A p2 renders `$NOOM` in the chip,
      // and it is what the model actually wrote.
      if (soren) return <ProseTokenTag href={href} mint={mint} label={label} />;
      return <TokenMentionChip href={href} mint={mint} label={label} />;
    }
  }
  return (
    // Built explicitly rather than by spreading: react-markdown also
    // passes its hast `node`, which must never reach the DOM.
    <a
      href={href}
      title={title}
      rel="noreferrer"
      target="_blank"
      data-streamdown="link"
      className={className ?? 'wrap-anywhere font-medium underline'}
    >
      {children}
    </a>
  );
}

const components = { a: AgentMentionLink };

export const AgentMarkdown = memo(
  function AgentMarkdown({
    text,
    streaming = false,
    linkEntities,
  }: {
    text: string;
    streaming?: boolean;
    /** Link context from this turn's tool results (mint vs wallet, $TICKER map). */
    linkEntities?: LinkEntities;
  }) {
    const soren = useSorenChat();
    // Mints (and tickers this conversation resolved) become /trade/ links;
    // addresses the tool results typed as wallets carry the wallet-href
    // sentinel instead. Done on the TEXT, not via a renderer override, so
    // Streamdown's block memoization still sees a plain string and only the
    // growing block re-renders while streaming. Under the Soren skin the
    // atom pass runs FIRST (its own masking skips its output and the
    // links either pass produces, so composition order is safe either
    // way); `holdTail` keeps a still-growing trailing number out of a box
    // until it is whole. Flag off, the text is untouched.
    const linked = useMemo(() => {
      const source = soren ? atomizeAgentText(text, { holdTail: streaming }) : text;
      return linkifyAgentText(
        source,
        linkEntities === undefined
          ? {}
          : {
              symbolToMint: linkEntities.symbolToMint,
              mintIds: linkEntities.mintIds,
              walletIds: linkEntities.walletIds,
              chainByAddress: linkEntities.chainByAddress,
            },
      );
    }, [text, linkEntities, soren, streaming]);
    // Wallets have no page route — they open in the wallet-profile modal.
    // Delegated here (one handler for the whole part) rather than through a
    // Streamdown component override, for the same streaming-perf reason.
    const onClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest('a');
      if (anchor === null) return;
      const wallet = walletFromHref(anchor.getAttribute('href') ?? '');
      if (wallet === null) return;
      event.preventDefault();
      event.stopPropagation();
      openWalletProfile(wallet);
    }, []);
    return (
      <div data-testid="agent-part-text" onClickCapture={onClickCapture}>
        <Streamdown
          className="agent-md"
          mode="streaming"
          parseIncompleteMarkdown
          isAnimating={streaming}
          caret="block"
          controls={false}
          lineNumbers={false}
          linkSafety={{ enabled: false }}
          plugins={plugins}
          components={components}
        >
          {linked}
        </Streamdown>
      </div>
    );
  },
  (prev, next) =>
    prev.text === next.text &&
    prev.streaming === next.streaming &&
    prev.linkEntities === next.linkEntities,
);
