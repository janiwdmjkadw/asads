'use client';

import type { ReactNode } from 'react';
import './invite-variants.css';

/*
 * ── REFERRAL · THE TOP OF THE TAB ────────────────────────────────────
 *
 * The board below now carries metal and reads well. The first screen
 * does not: a grey URL, a white square, and four figures. Every
 * coloured object on the tab is under the fold, so the tab opens on its
 * quietest moment and earns its way up.
 *
 * Cashback opens ON the roost. Points opens two lines above the medals.
 * Referral opens on a link.
 *
 *   1  Marked    the owl sits inside the QR; the code is the object
 *   2  Standing  YOUR referrer metal, struck from what you have earned
 *   3  Money     the claimable figure leads and the link comes second
 *   4  Beside    the top fren's medal moves up next to the link
 */

const METALS = [
  'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #aab2ba 48%, #6c747c 64%, #383d43 100%)',
  'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #e0a066 47%, #96552a 66%, #4d2711 100%)',
  'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, #f4f7fa 46%, #a8b0b9 66%, #5f666e 100%)',
  'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #f7dd8a 46%, #c09220 66%, #6b4806 100%)',
  'linear-gradient(145deg, #3d6d96 0%, #8ec6e8 27%, #e8f7ff 45%, #6fa9d2 68%, #315a80 100%)',
];
const NAMES = ['Base', 'Bronze', 'Silver', 'Gold', 'Platinum'];

/* 12.6 SOL earned from referrals, all time. */
const LIFETIME = 12.6;
const MINE = LIFETIME >= 25 ? 4 : LIFETIME >= 10 ? 3 : LIFETIME >= 2 ? 2 : LIFETIME >= 0.5 ? 1 : 0;

function Owl({ size, m, className }: { size: number; m: number; className?: string }) {
  return (
    <span
      className={className ? `iv-owl ${className}` : 'iv-owl'}
      aria-hidden
      style={{ width: size, height: size, background: METALS[m] }}
    />
  );
}

/* Stands in for the real code. */
function Qr({ mark }: { mark?: boolean }) {
  return (
    <div className="iv-qr">
      <div className="iv-qr-box">
        <span className="iv-qr-art" aria-hidden />
        {/*
         * A QR carries its own redundancy, so a mark in the middle is
         * not vandalism — it is what the error correction is FOR. It
         * costs a level: the real one moves from `M` to `H`, which
         * makes the code denser and still scannable with a fifth of it
         * covered.
         */}
        {mark ? <span className="iv-qr-mark" aria-hidden /> : null}
      </div>
      <span className="iv-cap">Scan to join</span>
    </div>
  );
}

function Figures({ lead }: { lead?: boolean }) {
  return (
    <div className={lead ? 'iv-figs iv-figs-lead' : 'iv-figs'}>
      <span>
        <i>Referrals</i>
        <b>14</b>
      </span>
      <span>
        <i>Volume, weekly</i>
        <b>4,212.8 SOL</b>
      </span>
      <span>
        <i>Earned, weekly</i>
        <b>12.6 SOL</b>
      </span>
      <span>
        <i>Claimable</i>
        <b>2.8 SOL</b>
        <u>0.4 SOL pending</u>
      </span>
      <span className="iv-figs-go">
        <button type="button" className="iv-go">
          Claim
        </button>
      </span>
    </div>
  );
}

function Link({ children }: { children?: ReactNode }) {
  return (
    <div className="iv-l">
      <span className="iv-lab">Your fren link</span>
      <div className="iv-url">
        <span className="iv-url-b">listen.local/fren/</span>
        <span className="iv-url-s">designer</span>
      </div>
      {children}
      <div className="iv-do">
        <button type="button" className="iv-go">
          Copy link
        </button>
        <span className="iv-quiet">You earn 30% of the 1% fee on every trade they make</span>
      </div>
    </div>
  );
}

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="iv-slot">
      <div className="iv-cap2">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="iv-frame">{children}</div>
    </div>
  );
}

/* ── 1 ── MARKED ──────────────────────────────────────────────────────
 * The owl inside the code. The QR stops being a white square and
 * becomes the one designed object on the first screen, and it is the
 * thing people actually photograph. */
function Marked() {
  return (
    <div className="iv-top">
      <Link />
      <Qr mark />
    </div>
  );
}

/* ── 2 ── STANDING ────────────────────────────────────────────────────
 * Your OWN referrer metal, struck from what you have earned all time.
 * The tab already tells every fren what they are worth; this tells you
 * what you are, which is the one status on the page that was missing.
 *
 * It also puts colour at the very top without inventing a new system. */
function Standing() {
  return (
    <div className="iv-top">
      <Link>
        <div className="iv-standing">
          <Owl size={40} m={MINE} />
          <div>
            <b>{NAMES[MINE]} referrer</b>
            <small>12.6 SOL earned from frens, all time</small>
          </div>
        </div>
      </Link>
      <Qr mark />
    </div>
  );
}

/* ── 3 ── MONEY ───────────────────────────────────────────────────────
 * The figures move above the link. The argument against it is the one I
 * made when the link went to display size: the link is what the page is
 * FOR. The argument for it is that you copy that string once and then
 * open this tab a hundred times to check a balance. */
function Money() {
  return (
    <div>
      <Figures lead />
      <div className="iv-rule" />
      <div className="iv-top">
        <Link />
        <Qr mark />
      </div>
    </div>
  );
}

/* ── 4 ── BESIDE ──────────────────────────────────────────────────────
 * The top fren's medal moves up beside the link, so the first screen
 * has a person on it rather than a URL and a square. The QR drops to a
 * small mark under the copy button. */
function Beside() {
  return (
    <div className="iv-top">
      <Link />
      <div className="iv-fren">
        <span className="iv-lab">Top fren, weekly</span>
        <div className="iv-fren-in">
          <Owl size={56} m={4} />
          <div>
            <div className="iv-fren-n">@aster</div>
            <div className="iv-fren-e">
              2.7000
              <span className="iv-fren-u">SOL to you</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InviteVariants() {
  return (
    <div className="iv">
      <h2>REFERRAL · THE TOP OF THE TAB</h2>
      <p className="iv-note">
        The board below carries metal now and reads well. The first screen does not: a grey URL, a
        white square, four figures. Every coloured object on the tab is under the fold, so it opens
        on its quietest moment. Cashback opens on the roost; points opens two lines above the
        medals; referral opens on a link.
      </p>

      <div className="iv-stack">
        <Slot i={1} name="Marked" note="the owl inside the QR; the code becomes the object">
          <Marked />
        </Slot>
        <Slot i={2} name="Standing" note="your own referrer metal, from what you have earned">
          <Standing />
        </Slot>
        <Slot i={3} name="Money" note="the figures lead and the link comes second">
          <Money />
        </Slot>
        <Slot i={4} name="Beside" note="the top fren's medal moves up next to the link">
          <Beside />
        </Slot>
      </div>
    </div>
  );
}
