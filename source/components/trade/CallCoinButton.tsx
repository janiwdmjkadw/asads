'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { usePostCoinCall, useCallAudience, type CallRejectReason } from '@/lib/api/alpha-calls';
import { MAX_THESIS_LENGTH, MINT_REGEX, checkThesis } from '@/lib/api/alpha-calls-shared';
import type { MockToken, VolSnapshot } from './mockTrade';

// Slice "Call This Coin": trade-header entry point. Opens the call dialog,
// takes a thesis (1..280 chars), posts the call with a snapshot of the token
// as currently displayed. Subscribers (slug signups + wallet trackers) get an
// inbox notification and the call lands in the Discover alpha lane.
//
// Design: the button wears the house mini-mosaic at its top right (same
// pixels as the FRENS nav pill); the dialog is a small designed object —
// edition band, mono eyebrow, serif italic headline that says exactly who
// hears the call ("Call X to N frens", live audience count from
// /api/v1/alpha/audience), and a plate-tick meta row.

interface Props {
  token: MockToken;
  vol: VolSnapshot;
  /**
   * True while the trade page is still on a stub/loading snapshot: the mint
   * may already be real (it comes from the URL) but the display values are
   * placeholders — calling now would broadcast '—' / 'Live quote' as the
   * coin's immutable metadata snapshot.
   */
  disabled?: boolean;
}

const REJECT_COPY: Record<CallRejectReason, string> = {
  invalid_mint: 'this token cannot be called yet.',
  thesis_empty: 'write a thesis first.',
  thesis_too_long: `keep it under ${MAX_THESIS_LENGTH} characters.`,
  thesis_charset: 'remove the unsupported characters and try again.',
  thesis_links: 'only x.com links are allowed.',
  already_called: 'you already called this coin — edit your call instead.',
  cooldown: 'you already called this coin — edit your call instead.',
  insufficient_holding: 'hold at least 3 SOL of this coin to call it (just bought? give it a few seconds to confirm).',
  rate_limited: 'too many calls — slow down a moment.',
};

const CONFETTI = ['#37d67a', '#38bdf8', '#f052d2', '#fbbf24', '#8b5cf6'] as const;

function MegaphoneIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: 'block' }}
      aria-hidden
    >
      <path d="M3 11l14-6v14L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
    </svg>
  );
}

/** Mini confetti mosaic perched on the button — echo of the FRENS nav
 *  pill (reuses `.frens-pill-px` twinkle from listen.css). */
function ButtonMosaic() {
  const cells: ReadonlyArray<{ x: number; y: number; c: string; d: string }> = [
    { x: 4, y: 0, c: '#f052d2', d: '0s' },
    { x: 8, y: 0, c: '#8b5cf6', d: '1.4s' },
    { x: 0, y: 4, c: '#fbbf24', d: '2.6s' },
    { x: 4, y: 4, c: '#37d67a', d: '0.8s' },
    { x: 8, y: 4, c: '#38bdf8', d: '2s' },
  ];
  return (
    <span
      aria-hidden
      style={{ position: 'absolute', top: 3, right: 4, width: 11, height: 7, pointerEvents: 'none' }}
    >
      {cells.map((cell) => (
        <span
          key={`${cell.x}-${cell.y}`}
          className="frens-pill-px"
          style={{
            left: cell.x,
            top: cell.y,
            background: cell.c,
            boxShadow: `0 0 4px color-mix(in srgb, ${cell.c} 65%, transparent)`,
            animationDelay: cell.d,
          }}
        />
      ))}
    </span>
  );
}

export function CallCoinButton({ token, vol, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [thesis, setThesis] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const post = usePostCoinCall();
  // Live audience: how many frens this call would reach right now.
  const audience = useCallAudience(open);

  // Not callable until the mint parses AND the snapshot is real data.
  const callable = !disabled && MINT_REGEX.test(token.mintAddress);
  const check = checkThesis(thesis);
  const remaining = MAX_THESIS_LENGTH - thesis.trim().length;
  // Pre-flight hint for the one rule users hit by surprise: theses may
  // carry x.com links ONLY (they embed as TWEET chips on the alpha card).
  const preflightHint =
    !check.ok && check.reason === 'links' ? REJECT_COPY.thesis_links : null;

  // A new dialog session starts clean — including cancelling a pending
  // auto-close from the previous submission, which would otherwise snap the
  // reopened dialog shut mid-typing.
  useEffect(() => {
    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setNotice(null);
      post.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset() identity churns per render
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const submit = () => {
    if (!check.ok || post.isPending) return;
    setNotice(null);
    post.mutate(
      {
        mint: token.mintAddress,
        thesis: check.normalized,
        token: {
          ticker: token.ticker || token.symbol,
          name: token.name,
          imageUrl: token.imageUrl,
          marketCap: token.marketCap,
          marketCapUsd: token.marketCapUsd ?? null,
          volume: vol.vol,
          price: token.price,
          score: token.score,
          txns: token.txns,
        },
      },
      {
        onSuccess: (result) => {
          if (result.kind === 'reauth') {
            setNotice({ tone: 'err', text: 'session expired — sign in again to call.' });
            return;
          }
          if (result.kind === 'error') {
            setNotice({ tone: 'err', text: 'call failed to send — try again.' });
            return;
          }
          if (!result.data.accepted) {
            setNotice({ tone: 'err', text: REJECT_COPY[result.data.reason] });
            return;
          }
          const n = result.data.notified;
          setNotice({
            tone: 'ok',
            text: n === 0 ? 'call posted to your alpha lane.' : `call sent — ${n} fren${n === 1 ? '' : 's'} notified.`,
          });
          setThesis('');
          closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            setOpen(false);
          }, 1200);
        },
        onError: () => setNotice({ tone: 'err', text: 'call failed to send — try again.' }),
      },
    );
  };

  const ticker = (token.ticker || token.symbol).toUpperCase();

  return (
    <>
      {/* Fully rainbowized: the edition-band gradient IS the border (1px
          gradient shell around a dark core), the wordmark is confetti-
          gradient type, and the corner mosaic pixels twinkle on top. */}
      <button
        type="button"
        aria-label={`Call ${token.ticker || token.symbol}`}
        disabled={!callable}
        onClick={() => setOpen(true)}
        className="relative inline-flex shrink-0 rounded-[11px] p-px text-[11px] font-semibold uppercase transition-[filter] hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          border: 'none',
          background: 'linear-gradient(100deg, #37d67a, #38bdf8, #8b5cf6, #f052d2, #fbbf24)',
          boxShadow: '0 0 16px -8px #8b5cf6, 0 0 14px -9px #37d67a',
          letterSpacing: '0.12em',
        }}
      >
        <span
          className="inline-flex items-center gap-1.5 rounded-[10px] py-1.5 pl-2.5"
          style={{
            paddingRight: 18,
            backgroundColor: 'var(--surface-1)',
            backgroundImage:
              'radial-gradient(120% 120% at 0% 0%, rgba(56, 189, 248, 0.12), transparent 55%), radial-gradient(120% 120% at 100% 100%, rgba(240, 82, 210, 0.12), transparent 55%)',
          }}
        >
          <span style={{ color: '#fbbf24' }}>
            <MegaphoneIcon />
          </span>
          <span
            className="hidden md:inline font-bold"
            style={{
              backgroundImage: 'linear-gradient(90deg, #7ce85e, #38bdf8, #f052d2, #fbbf24)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Call
          </span>
        </span>
        <ButtonMosaic />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-md gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
          style={{
            borderRadius: 18,
            border: '1px solid var(--hairline-2)',
            boxShadow: '0 40px 110px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {/* Edition band + aurora. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 z-10 h-[3px]"
            style={{
              background: 'linear-gradient(90deg, #37d67a, #38bdf8, #8b5cf6, #f052d2, #fbbf24)',
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(100% 60% at 10% 0%, color-mix(in srgb, var(--accent-primary) 8%, transparent), transparent 60%)',
            }}
          />

          <div className="relative flex flex-col gap-3.5 px-5 pb-4 pt-[18px]">
            {/* Eyebrow: the broadcast stamp. */}
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-[11px] w-[3.5px] shrink-0 rounded-[2px]"
                style={{
                  background: 'var(--accent-primary)',
                  boxShadow: '0 0 8px -2px var(--accent-primary)',
                }}
              />
              <span
                className="text-[9.5px] font-bold uppercase tracking-[0.22em]"
                style={{ color: 'var(--ink-2)', fontFamily: 'var(--mono)' }}
              >
                Alpha call
              </span>
              <span
                aria-hidden
                className="size-[5px] rounded-full"
                style={{
                  background: 'var(--up)',
                  boxShadow: '0 0 8px color-mix(in srgb, var(--up) 80%, transparent)',
                }}
              />
            </div>

            {/* Headline: exactly who hears this. */}
            <DialogTitle asChild>
              <h2
                className="m-0 text-[24px] leading-[1.1]"
                style={{
                  fontFamily: 'var(--display)',
                  fontStyle: 'italic',
                  fontWeight: 400,
                  letterSpacing: '-0.01em',
                  color: 'var(--ink-0)',
                }}
              >
                Call <span style={{ color: 'var(--accent-primary)' }}>{ticker}</span>
                {audience !== null && audience > 0 ? (
                  <> to {audience} fren{audience === 1 ? '' : 's'}</>
                ) : null}
              </h2>
            </DialogTitle>
            <p className="m-0 -mt-1.5 text-[12px] leading-[1.55]" style={{ color: 'var(--ink-3)' }}>
              {audience !== null && audience > 0
                ? `Your ${audience} fren${audience === 1 ? '' : 's'} — slug signups and wallet trackers — get notified; the call lands in their alpha lane with your thesis.`
                : 'Your frens and wallet trackers get notified; the call lands in their alpha lane with your thesis.'}
            </p>

            <Textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder="why this coin, why now…"
              rows={4}
              maxLength={MAX_THESIS_LENGTH * 2}
              autoFocus
              className="resize-none rounded-[12px] text-[13px] leading-[1.5]"
              style={{
                background: 'var(--input-bg)',
                borderColor: 'color-mix(in srgb, var(--accent-primary) 22%, var(--hairline))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
              }}
            />

            <div className="flex items-center justify-between gap-3 text-[11px]" style={{ color: 'var(--ink-3)' }}>
              <span
                aria-live="polite"
                className="min-w-0 flex-1 truncate"
                style={
                  notice
                    ? { color: notice.tone === 'ok' ? 'var(--up)' : 'var(--down)' }
                    : preflightHint
                      ? { color: 'var(--down)' }
                      : undefined
                }
              >
                {notice?.text ?? preflightHint ?? ''}
              </span>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums"
                style={{
                  color: remaining < 0 ? 'var(--down)' : 'var(--ink-3)',
                  background: 'var(--input-bg)',
                  border: `1px solid ${remaining < 0 ? 'color-mix(in srgb, var(--down) 50%, transparent)' : 'var(--hairline)'}`,
                }}
              >
                {remaining}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              {/* Plate ticks — the signature. */}
              <span aria-hidden className="inline-flex gap-[3px]">
                {CONFETTI.map((c) => (
                  <span
                    key={c}
                    className="inline-block h-[8px] w-[3px] rounded-[1px]"
                    style={{ background: c, opacity: 0.55 }}
                  />
                ))}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-8 rounded-[10px] px-3 text-[12px]"
                  style={{ color: 'var(--ink-3)', cursor: 'pointer' }}
                >
                  cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!check.ok || post.isPending}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3.5 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-40"
                  style={
                    {
                      color: 'var(--accent-ink)',
                      background:
                        'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                      boxShadow: '0 0 18px -6px var(--accent-glow)',
                      cursor: 'pointer',
                    } as CSSProperties
                  }
                >
                  <MegaphoneIcon size={13} />
                  {post.isPending ? 'calling…' : 'call it'}
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
