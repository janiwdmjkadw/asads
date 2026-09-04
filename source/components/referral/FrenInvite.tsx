'use client';

import type { ReactNode } from 'react';
import '@/components/landing/tokens.css';
import { WelcomePanel } from '@/components/onboarding/welcome/WelcomePanel';
import panel from '@/components/onboarding/welcome/welcome.module.css';
import { InviteGround } from './InviteGround';
import './fren-invite.css';

/**
 * The fren invite: the white panel, on a dark ground with one price line.
 *
 * THE CARD IS THE PRODUCT'S WHITE PANEL, the same object onboarding step 1
 * is printed on, mounted here with `autoHeight` because a sign-up card is
 * taller than the 560px board height that panel was measured to. That
 * couples this page to `onboarding/welcome/` — the component and its
 * stylesheet both live there — which is a good argument for moving the
 * panel somewhere neutral, and not a reason to draw a second white card
 * that is almost the same.
 *
 * THE GROUND IS BLACK, and the page paints that black itself rather than
 * relying on whatever is behind it. What has been tried and thrown out on
 * top of it, in order: a price line, candles, volume bars, a leaderboard,
 * a join feed, a trade tape, walls of usernames, a fee diagram, fourteen
 * conditional rules, a sweeping light, a horizon, rings, sliding strata,
 * and slabs. Every one of them was an OBJECT, and an object on a black
 * page is a thing you look at — which is the one job a background does not
 * have.
 *
 * WHAT IS NOT HERE, and why. The message a stranger needs — that this is
 * agentic trading — is not in the ground. Five passes tried to put it
 * there: a leaderboard, a join feed, a fee diagram, fourteen conditional
 * rules at 13px and 16% opacity, and the landing hero's own band lifted
 * whole. The first four were unreadable, and the last handed anyone
 * arriving from the landing page the identical band twice. A background
 * cannot carry a sentence.
 *
 * No buys, no sells, no wall of orders, and no invented activity: a join
 * feed or a leaderboard on a signup screen is fabricated events dressed as
 * live data, which is fake social proof however well drawn.
 *
 * The `lp` class is LOAD BEARING for the ground's tokens. Every `--lp-*`
 * is scoped to it and this mounts outside `LandingPage`.
 */

export function FrenInvite({
  slug,
  valid,
  state = 'invite',
  action,
  ground,
}: {
  slug: string;
  /** `null` while the slug is still being resolved. */
  valid: boolean | null;
  /**
   * The visitor is already signed in, or this is their own invite link.
   *
   * Both were dead ends. Signed in, the route redirected to `/` or showed
   * a confirmation modal, so the page never rendered; on your own link
   * nothing was checked at all, and you were invited to sign up through
   * yourself. Neither is an error — one is a person checking their own
   * link works, which is the single most likely way this page gets opened
   * by somebody who already has an account.
   */
  state?: 'invite' | 'signed-in' | 'own-code';
  /** The sign-up card. Backend owned, so it is passed in rather than built. */
  action: ReactNode;
  /** A ground behind the card. The lab passes candidates through here so
      what is compared is THIS page with its ground swapped, not a fork. */
  ground?: ReactNode;
}) {
  const found = valid !== false;

  /*
   * ONE PANEL, THREE READINGS OF IT. The card, the ground and the type
   * never change — only what the panel says and what it offers, because a
   * separate screen for each of these is three screens to keep in step.
   *
   * ALL FOUR SLOTS MOVE TOGETHER, and that is the whole point. The first
   * version changed only the eyebrow, so a page headed YOUR OWN LINK still
   * said "@you invited you to Listen" and still offered to sign you up
   * through yourself. A label that contradicts the sentence under it is
   * worse than no label, because the sentence is what gets read.
   */
  const copy = {
    invite: {
      eyebrow: 'FREN INVITE',
      verb: 'invited you to Listen',
      body: 'Listen is an agentic trading terminal for Solana. You describe what you want in plain language, and the agent watches the market and acts on it while you are away.',
      note: `Signing up through @${slug} means you will be repping them on every trade you make.`,
      link: null as { href: string; label: string } | null,
    },
    'signed-in': {
      eyebrow: 'FREN INVITE · YOU ARE SIGNED IN',
      verb: 'invited you to Listen',
      body: 'You already have an account, so there is nothing here to claim. Your fren was credited at the moment you signed up, and nothing about this link changes that.',
      note: null,
      link: { href: '/', label: 'Open the terminal' },
    },
    'own-code': {
      eyebrow: 'FREN INVITE · YOUR OWN LINK',
      /* Not "invited you". On your own link nobody invited anybody, and
         this is the one state where the page is a preview rather than an
         offer: it shows you what you are about to send. */
      verb: 'is your invite link',
      body: 'This is what your frens see when you send it to them. Anyone who signs up through it will be repping you on every trade they make.',
      note: null,
      link: { href: '/frens', label: 'See your frens' },
    },
  }[state];

  return (
    <main
      /* THE GUTTER IS IN CSS, not in Tailwind, and that is the whole
          point. It was `sm:px-6 sm:py-16`, and `sm` is 640 while the
          panel goes full bleed at 700 — so between those two widths the
          card was full width and full height while the page still held
          64px of padding, which put a black band above it and pushed an
          equal amount of it off the bottom. One decision cannot be split
          across two breakpoints. See `fren-invite.css`. */
      className="lp fi-page relative flex min-h-dvh flex-col items-center justify-center overflow-hidden"
      style={{ background: '#000000' }}
    >
      {ground ?? <InviteGround />}

      {/* `flex w-full justify-center`, NOT a bare wrapper. The panel's
          mobile rule is `width: 100%`, and a percentage resolves against
          the parent — inside a shrink-to-fit box that parent is only as
          wide as the sign-up card, so the panel came out 448px inside a
          375px phone and hung off both edges. A full-width flex parent
          gives the percentage the viewport to measure, and still centres
          the fixed 640 on desktop. */}
      <div
        className={`relative z-10 flex w-full justify-center${action ? '' : ' fi-short'}`}
      >
        <WelcomePanel
          autoHeight
          testId="fren-invite"
          eyebrow={found ? copy.eyebrow : 'FREN INVITE · NOT FOUND'}
          /* Stacked, and the handle nearly twice the verb: the name is the
             reason the link was opened, and at one size it read as the
             first half of a phrase rather than the subject of it. */
          headline={
            found ? (
              <>
                <span className="fi-name">@{slug}</span>
                <span className="fi-verb">{copy.verb}</span>
              </>
            ) : (
              'That invite did not check out'
            )
          }
          /* THE SENTENCE A STRANGER NEEDS, on the card. The invite alone
             does not say what it is an invite to: "@degenmike invited you
             / sign up to start trading" could be any exchange. Five
             earlier passes tried to carry this in the ground instead and
             every one was unreadable at the size a ground allows. It also
             fills the panel — the card was 560px tall with 340px of
             content in it, and the answer to a third of a card being empty
             is the thing it forgot to say, not a shorter card. */
          body={
            found ? copy.body : 'We could not verify that invite. You can still sign up and start trading.'
          }
          art={null}
        >
          <div className={panel.revealRegion}>
            {found && copy.note ? (
              <p
                style={{
                  margin: '0 0 20px',
                  fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
                  fontSize: 13,
                  lineHeight: '20px',
                  /* The panel's own third-level grey, from the pass that
                     took the turquoise out of this card. */
                  color: '#767676',
                }}
              >
                {copy.note}
              </p>
            ) : null}
            {action}
            {/* A WAY OUT for the two states that have no card. Without it
                the panel is a paragraph and then 200px of nothing, and a
                page that tells somebody their situation without offering
                them anywhere to go is a dead end wearing a nice card. */}
            {found && copy.link ? (
              <a className="fi-go" href={copy.link.href}>
                {copy.link.label}
                <span aria-hidden="true">&#8594;</span>
              </a>
            ) : null}
          </div>
        </WelcomePanel>
      </div>
    </main>
  );
}
