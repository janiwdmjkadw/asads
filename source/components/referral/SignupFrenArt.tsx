'use client';

import type { CSSProperties, ReactElement } from 'react';
import type { BindResult } from '@/lib/api/referral';

// Slice "Referral & Rewards": every presentational piece of the
// /signup/fren/{slug} landing, in the listen confetti language. Lives
// OUTSIDE the page file because Next.js App Router pages may only
// export route fields (extra page exports fail the production build).

export type BindPhase =
  | { status: 'pending' }
  | { status: 'binding' }
  | { status: 'done'; result: BindResult };

/* ── The confetti system (same hand as every listen surface) ─────────── */

const CONFETTI = [
  '#37d67a',
  '#3b82f6',
  '#38bdf8',
  '#f052d2',
  '#fbbf24',
  '#22d3ee',
  '#8b5cf6',
  '#7ce85e',
] as const;

/** Same identity hash as the frens surfaces: the fren's color follows
 *  them onto their own invite. */
export function frenIdentity(label: string): { main: string; soft: string } {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  const index = ((hash % CONFETTI.length) + CONFETTI.length) % CONFETTI.length;
  return { main: CONFETTI[index]!, soft: CONFETTI[(index + 3) % CONFETTI.length]! };
}

export function SignupStyles(): ReactElement {
  return (
    <style>{`
      @keyframes sf-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      @keyframes sf-shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
      .sf-rise { animation: sf-rise 460ms cubic-bezier(0.16, 1, 0.3, 1) both; }
      .sf-shimmer { animation: sf-shimmer 1.4s linear infinite; }
      @media (prefers-reduced-motion: reduce) {
        .sf-rise, .sf-shimmer { animation: none; }
      }
    `}</style>
  );
}

/*
 * What used to be here: sf-drift, sf-float, sf-scatter, sf-land, sf-glint,
 * sf-pixel, sf-owl, sf-owl-f, sf-streak, sf-ghost-el, sf-desktop, and
 * sf-rise-2 / sf-rise-3. Every one of them drove a piece of the art field
 * this page no longer has, and CSS that nothing applies is invisible to
 * every tool that would otherwise tell you it is dead.
 */

export function InviteStatus({
  accessRedeemed,
}: {
  accessRedeemed: boolean | null;
}): ReactElement {
  if (accessRedeemed === false) {
    return (
      <div className="max-w-sm text-center">
        <div className="text-[20px]" style={{ color: 'var(--ink-0, #fff)' }}>
          Taking you to your invite code…
        </div>
        <p className="mt-2 text-[13px]" style={{ color: 'var(--ink-3, #888)' }}>
          Your fren invite is saved. Enter your invite code and we&apos;ll link it.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-sm text-center">
      <div className="text-[20px]" style={{ color: 'var(--ink-0, #fff)' }}>
        Almost there…
      </div>
    </div>
  );
}

export function ConfirmationModal({
  slug,
  identity,
  phase,
  onContinue,
  onRetry,
}: {
  slug: string;
  identity: { main: string; soft: string };
  phase: BindPhase;
  onContinue: () => void;
  onRetry: () => void;
}): ReactElement {
  const content = modalContent(slug, phase);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.74)', backdropFilter: 'blur(4px)' }} />
      <div
        className="sf-rise relative w-full max-w-[430px] overflow-hidden text-center"
        style={{
          borderRadius: 20,
          background: 'linear-gradient(180deg, #121217, #0d0d11)',
          border: `1px solid color-mix(in srgb, ${identity.main} 30%, rgba(255,255,255,0.08))`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.55), 0 0 60px -24px color-mix(in srgb, ${identity.main} 55%, transparent)`,
          padding: '0 28px 26px',
        }}
      >
        {/* Edition band + the fren's collage. */}
        <span
          aria-hidden
          style={{
            display: 'block',
            margin: '0 -28px',
            height: 3,
            background: 'linear-gradient(90deg, #37d67a, #38bdf8, #8b5cf6, #f052d2, #fbbf24)',
            opacity: 0.9,
          }}
        />
        <span aria-hidden style={{ position: 'absolute', top: -16, right: 34, width: 84, height: 30, borderRadius: 10, background: identity.main, opacity: 0.85, pointerEvents: 'none' }} />
        <span aria-hidden style={{ position: 'absolute', top: -4, right: 104, width: 34, height: 15, borderRadius: 6, background: identity.soft, opacity: 0.7, pointerEvents: 'none' }} />

        <div className="mt-7 text-[40px] leading-none">{content.emoji}</div>
        <div
          className="mt-3"
          style={{
            fontFamily: 'var(--display, ui-serif, Georgia, serif)',
            fontStyle: 'italic',
            fontSize: 25,
            lineHeight: 1.15,
            color: 'var(--ink-0, #f6f6f4)',
          }}
        >
          {content.title}
        </div>
        <p className="mt-2.5 text-[13.5px]" style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
          {content.body}
        </p>

        {content.showSpinner ? (
          <div className="mt-6 flex justify-center">
            <span
              aria-label="Loading"
              className="sf-shimmer"
              style={{
                width: 170,
                height: 2,
                borderRadius: 2,
                background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${identity.main} 65%, transparent), transparent)`,
                backgroundSize: '200% 100%',
              }}
            />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={onContinue}
              className="h-[44px] w-full rounded-[12px] text-[14px] font-bold"
              style={{
                color: '#0b0b10',
                background: `linear-gradient(135deg, ${identity.main}, color-mix(in srgb, ${identity.soft} 75%, ${identity.main}))`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 10px 28px -12px color-mix(in srgb, ${identity.main} 65%, transparent)`,
              }}
            >
              Enter Listen →
            </button>
            {content.showRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="h-[40px] w-full rounded-[12px] text-[13px] font-medium"
                style={{
                  color: 'rgba(255,255,255,0.7)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.09)',
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        )}

        {/* Plate mark. */}
        <div aria-hidden className="mt-5" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          <span style={{ width: 30, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12))' }} />
          {[identity.main, '#38bdf8', '#fbbf24'].map((c, i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: 2, background: c, opacity: 0.7 }} />
          ))}
          <span style={{ width: 30, height: 1, background: 'linear-gradient(90deg, rgba(255,255,255,0.12), transparent)' }} />
        </div>
      </div>
    </div>
  );
}

interface ModalContent {
  emoji: string;
  title: string;
  body: string;
  showSpinner: boolean;
  showRetry: boolean;
}

function modalContent(slug: string, phase: BindPhase): ModalContent {
  if (phase.status === 'pending' || phase.status === 'binding') {
    return {
      emoji: '🤝',
      title: 'Linking your invite…',
      body: `Setting up your fren connection with @${slug}.`,
      showSpinner: true,
      showRetry: false,
    };
  }

  const result = phase.result;
  if (result.kind === 'ok') {
    return {
      emoji: '🎉',
      title: "You're all set!",
      body: `Your fren is @${slug}. You're now repping them on every trade.`,
      showSpinner: false,
      showRetry: false,
    };
  }
  if (result.kind === 'reauth') {
    return {
      emoji: '🔑',
      title: 'Please sign in again',
      body: 'Your session expired before we could link the invite. Sign in and reopen the link.',
      showSpinner: false,
      showRetry: true,
    };
  }
  if (result.kind === 'error') {
    return {
      emoji: '⚠️',
      title: "That didn't go through",
      body: "We couldn't confirm your invite just now. Give it another try.",
      showSpinner: false,
      showRetry: true,
    };
  }
  // rejected — explain why, but let the user continue into the app.
  switch (result.reason) {
    case 'already_bound':
      return {
        emoji: '✅',
        title: 'Already repping a fren',
        body: "You're already linked to a fren — once applied, invites can't be changed.",
        showSpinner: false,
        showRetry: false,
      };
    case 'self_referral':
      return {
        emoji: '🪞',
        title: "That's your own link",
        body: "You can't refer yourself — share @" + slug + ' with frens instead!',
        showSpinner: false,
        showRetry: false,
      };
    case 'not_eligible':
      return {
        emoji: '⏳',
        title: "Invite can't be applied",
        body: 'Your account has already traded, so this invite can no longer be linked.',
        showSpinner: false,
        showRetry: false,
      };
    case 'slug_not_found':
      return {
        emoji: '🔍',
        title: 'Invite not found',
        body: "That fren link doesn't exist anymore, but your account is ready to go.",
        showSpinner: false,
        showRetry: false,
      };
    default:
      return {
        emoji: '⚠️',
        title: "Invite couldn't be linked",
        body: 'Your account is ready, but we could not confirm the invite. Try the link again in a moment.',
        showSpinner: false,
        showRetry: true,
      };
  }
}

