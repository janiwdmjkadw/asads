'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useReverification } from '@clerk/nextjs';
import { IframeStamper } from '@turnkey/iframe-stamper';
import {
  beginExport,
  type BeginExportInput,
  type BeginExportResult,
  type BeginExportSuccess,
} from '@/lib/api/wallet-export';
import {
  isExportReverificationHint,
  resolveExportOutcome,
  setExportReverificationActive,
  toExportReverification,
  type ExportReverificationHint,
  type RevealOutcome,
} from '@/lib/wallet-export/exportReverification';
import {
  documentIframeSettings,
  revealedBarHeight,
  revealedContentHeight,
  revealedLineCount,
  revealedPadX,
  REVEAL_PAD_Y,
} from '@/lib/wallet-export/documentReveal';

/**
 * Slice T4'-C2: real Turnkey export iframe — wallet-level mnemonic.
 *
 * Calls Turnkey's `EXPORT_WALLET` activity and injects the encrypted
 * bundle via `injectWalletExportBundle`. The decrypted mnemonic ("recovery
 * key") renders ONLY inside the `export.turnkey.com` iframe's same-origin
 * DOM. The main-frame app never sees the plaintext.
 *
 * UX matches the Axiom-style recovery-key flow:
 *   1. Mount: iframe ready, warning visible, key area shows a placeholder
 *      blur with a `Reveal my key` button. NOTHING is requested yet.
 *   2. User clicks `Reveal my key`: we call /api/v1/wallet/export/begin,
 *      receive the encrypted bundle, and inject it via the iframe SDK.
 *   3. Iframe decrypts in its own origin and renders the mnemonic in
 *      place. The button hides, the iframe shows the words, and the
 *      caller's `onSuccess` fires (with NO key material) so the panel
 *      can auto-confirm backup or unlock the deposit address.
 *
 * Hard security properties (defence in depth at every layer):
 *   - Plaintext seed NEVER reaches the main-frame DOM (same-origin
 *     policy isolates the iframe's variables).
 *   - This component does NOT render the seed/bundle/target pubkey
 *     anywhere visible. The bundle lives in a local variable only
 *     long enough to call injectWalletExportBundle.
 *   - `onSuccess` is called with no payload — only the boolean signal.
 */
export interface WalletExportIframeProps {
  /**
   * Slice "Per-wallet export / recovery": Aurora UUID of the wallet
   * to export. The api/'s wallet-scoped route resolves this to a
   * specific `turnkey_wallet_id` server-side and binds it into the
   * HMAC envelope; the iframe never sees a wallet identifier
   * directly.
   *
   * May be `null` while the wallet is still provisioning. In that
   * case the iframe still pre-warms its embedded keypair, but the
   * `Reveal` button stays disabled and prefetch is deferred until a
   * concrete id arrives.
   */
  readonly walletAccountId: string | null;
  /**
   * Axiom-style instant reveal. When `true`, the encrypted export
   * bundle is fetched in the background as soon as the iframe keypair
   * is warm and a `walletAccountId` is available, then cached. The
   * user's `Reveal` click only has to inject the cached bundle (a
   * local iframe decrypt), so the mnemonic appears with no network
   * wait. `onSuccess` still fires ONLY on the actual reveal click —
   * prefetch never reveals or auto-confirms anything. Defaults to
   * `false` so existing lazy call sites are unchanged.
   */
  readonly prefetch?: boolean;
  /** Called once the mnemonic is successfully revealed inside the iframe. NO key material. */
  readonly onSuccess: () => void | Promise<void>;
  /** Called on any failure path (network, rate limit, Turnkey error, iframe error). */
  readonly onError?: (errorCode: string, message: string) => void;
  /** Test seam: inject a fake IframeStamper for unit tests. */
  readonly stamperFactory?: (
    container: HTMLElement,
    elementId: string,
  ) => Pick<IframeStamper, 'init' | 'injectWalletExportBundle' | 'clear'>;
  /**
   * Hide the built-in "Recovery Key" caption. Callers that supply
   * their own surrounding chrome (e.g. the onboarding card) set this
   * to avoid a duplicate label. Defaults to `false` so existing
   * call sites are unchanged.
   */
  readonly hideLabel?: boolean;
  /**
   * Hide the built-in red warning paragraph. The onboarding card
   * renders its own "Your Private Keys" explainer instead, so it
   * suppresses this to avoid a redundant warning. Defaults to
   * `false` so existing call sites keep the warning.
   */
  readonly hideWarning?: boolean;
  /**
   * Chrome treatment. `panel` (default) is the themed surface used by the
   * wallet panel and the classic onboarding modal. `document` is the
   * full-screen onboarding's white-paper look: the key surface becomes a
   * light REDACTION BAR with the reveal pill printed under it, and the
   * caller supplies whatever confirmation replaces that pill. Presentation
   * only — the export state machine is identical in both.
   */
  readonly appearance?: 'panel' | 'document';
}

type IframeState =
  | { kind: 'ready_to_reveal' }
  | { kind: 'initialising' }
  | { kind: 'awaiting_bundle' }
  | { kind: 'injecting' }
  | { kind: 'revealed' }
  /**
   * `plain` renders `message` on its own. A step-up outcome is a "prove
   * it is you and try again", not a fault, and `Error: step_up_required`
   * read as a dead end to the user.
   */
  | { kind: 'error'; errorCode: string; message: string; plain?: boolean };

const IFRAME_ELEMENT_ID = 'turnkey-export-iframe';
const IFRAME_URL = 'https://export.turnkey.com';

/** Widths of the six blurred word-slugs on the redaction bar, per the board. */
const REDACTION_SLUGS = [56, 84, 40, 104, 60, 72] as const;

export function WalletExportIframe(props: WalletExportIframeProps): React.ReactElement {
  const { getToken } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stamperRef = useRef<Pick<IframeStamper, 'init' | 'injectWalletExportBundle' | 'clear'> | null>(null);
  const targetPubKeyRef = useRef<string | null>(null);
  const initPromiseRef = useRef<Promise<string> | null>(null);
  // Axiom-style prefetch: cache the encrypted bundle so the reveal
  // click only injects (local, instant). `prefetchStartedRef` guards
  // against a double-fetch when the effect re-runs. The PROMISE is
  // cached too: a reveal click landing while the prefetch is still in
  // flight must await it rather than fire a second beginExport — the
  // duplicate burned 2 of the 5/hour per-wallet export budget and lost
  // the instant reveal in the most common timing window.
  const bundleRef = useRef<BeginExportSuccess | null>(null);
  const bundlePromiseRef = useRef<Promise<BeginExportSuccess | null> | null>(null);
  const prefetchStartedRef = useRef(false);
  const [state, setState] = useState<IframeState>({ kind: 'ready_to_reveal' });
  // Document appearance: the text column at this container width, and the
  // lines the words wrap to inside it. Measured once, when the iframe is
  // placed — both numbers are geometry, not state the user can change.
  const [revealLines, setRevealLines] = useState(2);
  const [revealPadX, setRevealPadX] = useState(18);

  // Pre-warm the iframe + embedded keypair so the user's click is fast.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stamper =
      props.stamperFactory?.(container, IFRAME_ELEMENT_ID) ??
      new IframeStamper({
        iframeUrl: IFRAME_URL,
        iframeElementId: IFRAME_ELEMENT_ID,
        iframeContainer: container,
      });
    stamperRef.current = stamper;
    initPromiseRef.current = stamper.init().then((pk) => {
      targetPubKeyRef.current = pk;
      return pk;
    });

    return () => {
      try {
        stamperRef.current?.clear();
      } catch {
        // best-effort teardown
      }
      stamperRef.current = null;
      targetPubKeyRef.current = null;
      initPromiseRef.current = null;
      bundleRef.current = null;
      bundlePromiseRef.current = null;
      prefetchStartedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Axiom-style prefetch. Once the iframe keypair is warm and we have a
  // concrete wallet id, fetch + cache the encrypted bundle so the
  // reveal click is instant. Runs at most once per mount; failures are
  // swallowed here and re-surfaced on the click path (which re-fetches
  // when the cache is empty).
  const { prefetch, walletAccountId } = props;
  useEffect(() => {
    if (!prefetch) return;
    if (!walletAccountId) return;
    if (prefetchStartedRef.current) return;
    const initPromise = initPromiseRef.current;
    if (!initPromise) return;
    prefetchStartedRef.current = true;
    const prefetchPromise = (async (): Promise<BeginExportSuccess | null> => {
      try {
        const targetPublicKey = await initPromise;
        // `prefetch: true` tells the api/ to skip the backup stamp —
        // this fetch is a click-warmer, not a user-seen reveal.
        const result = await beginExport(
          { targetPublicKey, walletAccountId, prefetch: true },
          { authToken: await getToken() },
        );
        // NOTE: never prompt for a factor from the prefetch path — it
        // fires on mount, so a reverification dialog here would appear
        // with no user gesture behind it. A `step_up_required` verdict
        // is left uncached and SILENT; the click path runs the real
        // reverification and retries there.
        if (result.kind === 'ok') {
          // Always cache a successful bundle — a re-run of this effect
          // (dep identity churn) must never discard a paid-for export.
          bundleRef.current = result;
          return result;
        }
        return null;
      } catch {
        // Click path will retry + surface any error.
        return null;
      } finally {
        bundlePromiseRef.current = null;
      }
    })();
    bundlePromiseRef.current = prefetchPromise;
  }, [prefetch, walletAccountId, getToken]);

  /**
   * Document appearance only: the bare <iframe> carries UA defaults
   * (300x150, a border) and Turnkey's own type styling, neither of which
   * belongs on a white paper document. Runs once the iframe is in the DOM.
   *
   * `applySettings` is honoured — Turnkey applies our styles to the element
   * it renders the mnemonic in — but it is ALL OR NOTHING: one value its
   * regex table refuses drops the whole request, and it answers with an
   * ERROR rather than a partial apply. `documentIframeSettings` is written
   * against that table and its test checks every value, so the words really
   * do render at 13/18 monospace, which is what the box is measured for.
   *
   * The geometry is re-derived whenever the container's width changes — a
   * rotation or a resize moves the line count, and a box measured once for
   * the wrong width is the whole bug this fixes.
   */
  const documentAppearance = props.appearance === 'document';
  useEffect(() => {
    if (!documentAppearance) return;
    const container = containerRef.current;
    const initPromise = initPromiseRef.current;
    if (!container || !initPromise) return;
    let cancelled = false;
    let initialised = false;
    let appliedHeight = -1;

    const apply = (): void => {
      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) return;
      const padX = revealedPadX(containerWidth);
      const lines = revealedLineCount(containerWidth - padX * 2);
      const contentHeight = revealedContentHeight(lines);
      setRevealPadX(padX);
      setRevealLines(lines);
      const frame = container.querySelector('iframe');
      if (frame) {
        frame.style.width = '100%';
        frame.style.height = `${contentHeight}px`;
        frame.style.border = '0';
        frame.style.display = 'block';
        frame.style.colorScheme = 'light';
      }
      // The type request only has to be re-sent when the box it is sized
      // for changes; before init there is no channel to send it on.
      if (!initialised || contentHeight === appliedHeight) return;
      appliedHeight = contentHeight;
      const stamper = stamperRef.current;
      const applySettings = (stamper as Partial<Pick<IframeStamper, 'applySettings'>> | null)
        ?.applySettings;
      if (typeof applySettings === 'function') {
        void Promise.resolve(
          applySettings.call(stamper, documentIframeSettings(contentHeight)),
        ).catch(() => undefined);
      }
    };

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (!cancelled) apply();
          });
    observer?.observe(container);
    void initPromise
      .then(() => {
        if (cancelled) return;
        initialised = true;
        apply();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [documentAppearance]);

  /**
   * Click-path export, wrapped in Clerk's reverification protocol.
   *
   * The api/ gates on `fva` (minutes since a factor was verified), which
   * only a real factor verification resets — so on `step_up_required`
   * the hook opens the factor dialog and repeats THIS call once the user
   * succeeds. `skipCache` is required on the token here and only here:
   * the repeat must carry a JWT minted after the verification, or it
   * would present the same stale `fva` and be refused identically.
   */
  const beginExportWithReverification = useReverification(
    async (input: BeginExportInput): Promise<BeginExportResult | ExportReverificationHint> => {
      const result = await beginExport(input, {
        authToken: await getToken({ skipCache: true }),
      });
      const mapped = toExportReverification(result);
      // Returning the hint is what makes Clerk open its prompt, so this
      // is the moment to announce it — an enclosing modal dialog has to
      // release the body before that prompt can be interacted with.
      setExportReverificationActive(isExportReverificationHint(mapped));
      return mapped;
    },
  );

  async function handleReveal(): Promise<void> {
    if (state.kind !== 'ready_to_reveal' && state.kind !== 'error') return;
    if (!walletAccountId) return;
    setState({ kind: 'initialising' });
    try {
      const stamper = stamperRef.current;
      const initPromise = initPromiseRef.current;
      if (!stamper || !initPromise) {
        throw new Error('iframe_not_mounted');
      }

      // Fast path: a prefetched bundle is already cached, so skip the
      // network round trip entirely and inject straight away. If the
      // prefetch is still IN FLIGHT, await it instead of issuing a
      // duplicate export (which would double-spend the rate budget).
      let bundle: BeginExportSuccess;
      let cached = bundleRef.current;
      if (!cached && bundlePromiseRef.current) {
        setState({ kind: 'awaiting_bundle' });
        cached = await bundlePromiseRef.current;
      }
      if (cached) {
        bundle = cached;
      } else {
        const targetPublicKey = await initPromise;
        setState({ kind: 'awaiting_bundle' });
        // On `step_up_required` this opens Clerk's factor dialog and
        // repeats the export itself once the user verifies, so a
        // successful step-up reveals the key with no second click and
        // no error text in between.
        let outcome: RevealOutcome;
        try {
          outcome = await resolveExportOutcome(() =>
            beginExportWithReverification({ targetPublicKey, walletAccountId }),
          );
        } finally {
          // The prompt is gone by every exit path — verified, cancelled
          // or failed. Never leave a dialog stuck non-modal.
          setExportReverificationActive(false);
        }
        if (outcome.kind === 'error') {
          setState({
            kind: 'error',
            errorCode: outcome.errorCode,
            message: outcome.message,
            plain: outcome.plain,
          });
          props.onError?.(outcome.errorCode, outcome.message);
          return;
        }
        bundle = outcome.bundle;
      }

      setState({ kind: 'injecting' });
      const ok = await stamper.injectWalletExportBundle(
        bundle.exportBundleHex,
        bundle.turnkeySuborgId,
      );
      if (!ok) {
        const errorCode = 'iframe_injection_failed';
        const message = 'Failed to inject export bundle into iframe.';
        // A stale prefetched bundle can fail injection; drop it so a
        // retry re-fetches a fresh one instead of looping on the cache.
        bundleRef.current = null;
        setState({ kind: 'error', errorCode, message });
        props.onError?.(errorCode, message);
        return;
      }
      setState({ kind: 'revealed' });
      await props.onSuccess();
    } catch (err) {
      const message = (err as Error)?.message ?? 'unexpected iframe error';
      setState({ kind: 'error', errorCode: 'iframe_error', message });
      props.onError?.('iframe_error', message);
    }
  }

  const isRevealed = state.kind === 'revealed';
  const isBusy =
    state.kind === 'initialising' ||
    state.kind === 'awaiting_bundle' ||
    state.kind === 'injecting';

  if (documentAppearance) {
    return (
      <div
        data-testid="wallet-export-iframe-root"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}
      >
        {/* The redaction bar: light paper stock with the words struck out
            until the user asks for them. The Turnkey iframe occupies this
            same region and becomes visible in place on reveal. */}
        <div
          data-testid="wallet-export-surface"
          style={{
            position: 'relative',
            width: '100%',
            minHeight: isRevealed ? revealedBarHeight(revealLines) : 52,
            borderRadius: 4,
            backgroundColor: '#E8ECEA',
            overflow: 'hidden',
          }}
        >
          <div
            ref={containerRef}
            data-testid="wallet-export-iframe-container"
            style={{
              visibility: isRevealed ? 'visible' : 'hidden',
              // Out of flow until it has something to show: a hidden
              // iframe still takes its UA-default 150px of layout, which
              // would swell the 52px redaction bar before the reveal.
              position: isRevealed ? 'static' : 'absolute',
              inset: isRevealed ? undefined : 0,
              // Equal above and below: this is the whitespace that makes the
              // words sit centred in the bar, and it is ours, not Turnkey's.
              padding: isRevealed ? `${REVEAL_PAD_Y}px ${revealPadX}px` : 0,
              minHeight: isRevealed ? revealedContentHeight(revealLines) : 0,
            }}
          />

          {!isRevealed ? (
            <div
              aria-hidden
              data-testid="wallet-export-placeholder"
              style={{
                position: 'absolute',
                left: 20,
                // ANCHORED ON BOTH SIDES, which is what makes the row
                // shrinkable at all. Left-only left it shrink to fit, so
                // its width was the sum of the six slugs and their gaps —
                // 466px, fixed — and inside a full width panel on a phone
                // the last two slugs sat off the screen entirely. A right
                // anchor gives the row a definite width, and only then can
                // the slugs below give any of it back.
                right: 20,
                top: 18,
                display: 'flex',
                gap: 10,
                filter: 'blur(6px)',
              }}
            >
              {REDACTION_SLUGS.map((width, i) => (
                <div
                  key={i}
                  style={{
                    // A BASIS, not a width. The six lengths are the board's
                    // rhythm rather than measurements of anything, so they
                    // are free to compress together on a narrow screen —
                    // and they compress in proportion, which keeps the
                    // uneven look that makes this read as words.
                    flex: `0 1 ${width}px`,
                    minWidth: 0,
                    height: 16,
                    borderRadius: 3,
                    backgroundColor: '#1B211F',
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>

        {/* Printed under the bar, not floating over it — and gone once the
            key is out, so the caller can put its confirmation in this slot. */}
        {!isRevealed ? (
          <button
            type="button"
            data-testid="wallet-export-reveal-btn"
            onClick={() => {
              void handleReveal();
            }}
            disabled={isBusy}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 32,
              marginTop: 14,
              paddingInline: 16,
              border: 0,
              borderRadius: 6,
              backgroundColor: '#0B0E14',
              color: '#FFFFFF',
              fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
              fontSize: 13,
              fontWeight: 500,
              lineHeight: '16px',
              cursor: isBusy ? 'wait' : 'pointer',
              opacity: isBusy ? 0.7 : 1,
            }}
          >
            Reveal my key
          </button>
        ) : null}

        {state.kind === 'error' ? (
          <p
            data-testid="wallet-export-error"
            style={{
              margin: '10px 0 0',
              color: '#B42318',
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              fontSize: 11,
              lineHeight: '16px',
            }}
          >
            {state.plain ? (
              state.message
            ) : (
              <>
                Error: {state.errorCode}
                {state.message && state.message !== state.errorCode ? ` (${state.message})` : ''}
              </>
            )}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="wallet-export-iframe-root" className="flex flex-col gap-3">
      {props.hideLabel ? null : (
        <p
          data-testid="wallet-export-label"
          style={{ color: 'var(--ink-3)', fontSize: 12, margin: 0, letterSpacing: '0.02em' }}
        >
          Recovery Key
        </p>
      )}

      {/*
       * Key surface: the Turnkey iframe ALWAYS occupies this region.
       * Before reveal, we overlay a blurred placeholder + the
       * `Reveal my key` button. After reveal, the iframe content
       * (the mnemonic) is visible.
       */}
      <div
        data-testid="wallet-export-surface"
        style={{
          position: 'relative',
          minHeight: 140,
          background: 'var(--input-bg)',
          border: '1px solid var(--hairline)',
          borderRadius: 10,
          padding: 8,
          overflow: 'hidden',
        }}
      >
        <div
          ref={containerRef}
          data-testid="wallet-export-iframe-container"
          style={{
            visibility: isRevealed ? 'visible' : 'hidden',
            minHeight: 124,
          }}
        />

        {!isRevealed ? (
          <div
            data-testid="wallet-export-placeholder"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 12,
            }}
          >
            <div
              aria-hidden
              style={{
                width: '90%',
                height: 56,
                borderRadius: 6,
                background:
                  'linear-gradient(90deg, color-mix(in srgb, var(--ink-2) 14%, transparent), color-mix(in srgb, var(--ink-2) 26%, transparent), color-mix(in srgb, var(--ink-2) 14%, transparent))',
                filter: 'blur(6px)',
                opacity: 0.55,
              }}
            />
            <button
              type="button"
              data-testid="wallet-export-reveal-btn"
              onClick={() => {
                void handleReveal();
              }}
              disabled={isBusy}
              style={{
                background: 'color-mix(in srgb, var(--ink-0) 16%, transparent)',
                color: 'var(--ink-0)',
                border: '1px solid var(--hairline-2)',
                padding: '10px 24px',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                cursor: isBusy ? 'wait' : 'pointer',
                opacity: isBusy ? 0.7 : 1,
              }}
            >
              Reveal my key
            </button>
          </div>
        ) : null}
      </div>

      {state.kind === 'error' ? (
        <p
          data-testid="wallet-export-error"
          style={{ color: 'var(--accent-down, #ef4444)', fontSize: 12, margin: 0 }}
        >
          {state.plain ? (
            state.message
          ) : (
            <>
              Error: {state.errorCode}
              {state.message && state.message !== state.errorCode ? ` (${state.message})` : ''}
            </>
          )}
        </p>
      ) : null}

      {props.hideWarning ? null : (
        <p
          data-testid="wallet-export-warning"
          style={{
            color: 'var(--accent-down, #ef4444)',
            fontSize: 12,
            lineHeight: 1.45,
            margin: 0,
          }}
        >
          <span aria-hidden style={{ marginRight: 6 }}>⚠</span>
          WARNING: Your recovery key can grant anyone access to your funds. NEVER SHARE IT WITH ANYONE. Save it in a secure, private location.
        </p>
      )}
    </div>
  );
}
